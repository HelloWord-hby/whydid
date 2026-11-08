/**
 * Board view — a grid of configured cards, a card library, drag-to-reorder,
 * drag-from-library, per-card width, and a per-board layout in localStorage.
 *
 * Generic over the catalog from GET /boards: nothing in this file knows
 * which cards exist. Card data comes from GET /cards/:id.
 */
(function () {
  'use strict';

  const W = window.W;
  const L = window.WhydidLayout;
  const DAY_OPTIONS = [7, 14, 30];
  const daysByBoard = {};
  const SAMPLE_PROVIDERS = ['low_score_samples', 'feedback_samples'];

  /** Preset questions per card, by what the card shows. A configured `ask` comes first. */
  function presetsFor(c, days) {
    const t = c.title;
    let list;
    if (SAMPLE_PROVIDERS.indexOf(c.provider) >= 0) {
      list = ['What do these cases have in common?', 'Where do these problems concentrate, by route or by release?'];
    } else if (c.display === 'stat') {
      list = ['Why did ' + t + ' change vs the previous ' + days + ' days?', 'Which segment drove the change in ' + t + '?'];
    } else if (c.display === 'line') {
      list = ['What changed in ' + t + ' over the last ' + days + ' days, and why?'];
    } else {
      list = ['What stands out in ' + t + '?', 'Which item changed most vs the previous period, and why?'];
    }
    return c.ask ? [c.ask].concat(list).slice(0, 3) : list;
  }

  function renderBoard(main, catalog, boardId, onAsk) {
    const board = catalog.boards.find(function (b) { return b.id === boardId; });
    const cards = catalog.cards.filter(function (c) { return c.board === boardId; });
    const cardById = new Map(cards.map(function (c) { return [c.id, c]; }));
    let layout = L.load(localStorage, board, cards);
    const days = daysByBoard[boardId] || 7;
    let libraryOpen = false;
    let drag = null; // { kind: 'card' | 'lib', id, el }

    const modeBadge =
      board.mode === 'demo'
        ? '<span class="badge demo" title="No LANGFUSE_* keys configured — showing the built-in synthetic dataset">Demo data</span>'
        : board.source_kind === 'model_output'
          ? '<span class="badge live">Live · Langfuse</span>'
          : '<span class="badge live">Live · PostgreSQL</span>';

    main.innerHTML =
      '<div class="board-head">' +
      '<div><div class="board-desc">' + W.esc(board.description || '') + '</div></div>' +
      '<div class="toolbar">' + modeBadge +
      '<div class="seg" id="days">' +
      DAY_OPTIONS.map(function (d) {
        return '<button data-days="' + d + '" class="' + (d === days ? 'on' : '') + '">' + d + 'd</button>';
      }).join('') +
      '</div>' +
      (W.agent ? '<button class="btn accent" id="analyze">✦ Analyze board</button>' : '') +
      '<button class="btn" id="lib-toggle">Card library</button>' +
      '<button class="btn subtle" id="reset">Reset layout</button>' +
      '</div></div>' +
      '<div class="board-body">' +
      '<div class="grid" id="grid"></div>' +
      '<aside class="library" id="library" hidden></aside>' +
      '</div>' +
      '<p class="foot">Last ' + days + ' full UTC days vs the ' + days +
      ' days before. Every number is computed server-side by deterministic code.</p>';

    const grid = main.querySelector('#grid');
    const library = main.querySelector('#library');

    function persist() { L.save(localStorage, boardId, layout); }

    // ── cards ─────────────────────────────────────────────────────────

    function cardShell(entry) {
      const c = cardById.get(entry.id);
      const el = document.createElement('section');
      el.className = 'bcard span-' + entry.size;
      el.dataset.id = c.id;
      el.innerHTML =
        '<header>' +
        '<span class="handle" title="Drag the header to move">⠿</span>' +
        '<div class="ttl"><h3>' + W.esc(c.title) + '</h3>' +
        (c.description ? '<p>' + W.esc(c.description) + '</p>' : '') + '</div>' +
        '<div class="acts">' +
        (W.agent ? '<button class="ask" title="Ask the agent about this card">✦ Ask</button>' : '') +
        '<button class="size" title="Change width">⇔</button>' +
        '<button class="rm" title="Remove from board">×</button>' +
        '</div></header>' +
        '<div class="body"><div class="skeleton"></div></div>';

      // The whole header is the drag zone (buttons excluded), so table
      // text in the body stays selectable.
      el.querySelector('header').addEventListener('mousedown', function (e) {
        if (!e.target.closest('button')) el.draggable = true;
      });
      el.addEventListener('mouseup', function () { el.draggable = false; });
      el.addEventListener('dragstart', function (e) {
        drag = { kind: 'card', id: c.id, el: el };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', c.id);
        requestAnimationFrame(function () { el.classList.add('dragging'); });
      });
      el.addEventListener('dragend', function () {
        el.draggable = false;
        el.classList.remove('dragging');
        if (drag && drag.kind === 'card') commitOrder();
        drag = null;
      });

      el.querySelector('.rm').onclick = function () {
        layout = L.remove(layout, c.id);
        persist();
        el.remove();
        renderLibrary();
        emptyState();
      };
      el.querySelector('.size').onclick = function () {
        layout = L.cycleSize(layout, c.id);
        persist();
        const e2 = layout.find(function (x) { return x.id === c.id; });
        el.className = 'bcard span-' + e2.size;
      };
      const ask = el.querySelector('.ask');
      if (ask) ask.onclick = function () { W.agent.askAboutCard(c, presetsFor(c, days)); };
      return el;
    }

    function loadCard(el, id) {
      const body = el.querySelector('.body');
      W.getJson('/cards/' + encodeURIComponent(id) + '?days=' + days)
        .then(function (r) { body.innerHTML = renderPayload(r.data) + notes(r.notes); })
        .catch(function (e) { body.innerHTML = '<p class="err">' + W.esc(e.message) + '</p>'; });
    }

    function notes(list) {
      return list && list.length ? '<p class="cap warn">⚠ ' + W.esc(list.join(' ')) + '</p>' : '';
    }

    function renderPayload(d) {
      if (d.display === 'stat') {
        const delta = W.deltaText(d);
        return (
          '<div class="stat-value">' + W.fmt(d.value, d.format) + '</div>' +
          '<div class="stat-delta"><span class="chip ' + delta.cls + '">' + delta.text + '</span>' +
          '<span class="muted">prev ' + W.fmt(d.previous, d.format) + '</span></div>' +
          (d.caption ? '<p class="cap">' + W.esc(d.caption) + '</p>' : '') +
          W.sparkline(d.spark)
        );
      }
      const cap = d.caption ? '<p class="cap">' + W.esc(d.caption) + '</p>' : '';
      if (d.display === 'line') return W.lineChart(d.series, d.format) + cap;
      if (d.display === 'bar') return W.barChart(d) + cap;
      if (d.display === 'pie') return W.pieChart(d) + cap;
      if (!d.rows.length) return '<div class="empty">No rows in this window.</div>';
      const head = d.columns.map(function (c) {
        return '<th class="' + (c.format === 'text' || c.format === 'datetime' ? '' : 'num') + '">' + W.esc(c.label) + '</th>';
      }).join('');
      const rows = d.rows.map(function (r) {
        return '<tr>' + d.columns.map(function (c) {
          const v = r[c.key];
          const isNum = !(c.format === 'text' || c.format === 'datetime');
          const bar = c.bar && typeof v === 'number'
            ? '<span class="tbar"><i style="width:' + Math.max(2, Math.min(100, v * 100)).toFixed(0) + '%"></i></span>'
            : '';
          return '<td class="' + (isNum ? 'num' : '') + (c.key === 'comment' ? ' wrap' : '') + '">' + bar + W.fmt(v, c.format) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="tablewrap"><table class="tbl"><thead><tr>' + head + '</tr></thead><tbody>' + rows +
        '</tbody></table></div>' + (d.caption ? '<p class="cap">' + W.esc(d.caption) + '</p>' : '');
    }

    function mountCard(entry, before) {
      const el = cardShell(entry);
      grid.insertBefore(el, before || null);
      loadCard(el, entry.id);
      return el;
    }

    function emptyState() {
      const has = grid.querySelector('.bcard:not(.placeholder)');
      let hint = grid.querySelector('.grid-empty');
      if (!has && !hint) {
        hint = document.createElement('div');
        hint.className = 'grid-empty';
        hint.textContent = 'This board is empty. Open the card library and drag cards here.';
        grid.appendChild(hint);
      } else if (has && hint) {
        hint.remove();
      }
    }

    // ── drag & drop ───────────────────────────────────────────────────

    function placeholderFor(size) {
      let ph = grid.querySelector('.placeholder');
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'bcard placeholder';
        grid.appendChild(ph);
      }
      ph.className = 'bcard placeholder span-' + size;
      return ph;
    }

    function moveNear(moving, e) {
      const target = e.target.closest ? e.target.closest('.bcard') : null;
      if (!target || target === moving || !grid.contains(target)) {
        if (!target && e.target === grid) grid.appendChild(moving);
        return;
      }
      const rect = target.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      const ref = after ? target.nextSibling : target;
      if (ref !== moving && moving.nextSibling !== ref) grid.insertBefore(moving, ref);
    }

    grid.addEventListener('dragover', function (e) {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = drag.kind === 'card' ? 'move' : 'copy';
      const moving = drag.kind === 'card' ? drag.el : placeholderFor(cardById.get(drag.id).size);
      moveNear(moving, e);
    });

    grid.addEventListener('drop', function (e) {
      if (!drag) return;
      e.preventDefault();
      if (drag.kind === 'lib') {
        const ph = grid.querySelector('.placeholder');
        const card = cardById.get(drag.id);
        mountCard({ id: card.id, size: card.size }, ph);
        if (ph) ph.remove();
        layout = L.add(layout, card, layout.length);
        commitOrder();
        renderLibrary();
        emptyState();
      }
    });

    grid.addEventListener('dragleave', function (e) {
      if (drag && drag.kind === 'lib' && !grid.contains(e.relatedTarget)) {
        const ph = grid.querySelector('.placeholder');
        if (ph) ph.remove();
      }
    });

    function commitOrder() {
      const ids = Array.prototype.map.call(grid.querySelectorAll('.bcard:not(.placeholder)'), function (el) {
        return el.dataset.id;
      });
      layout = L.reorder(layout, ids);
      persist();
    }

    // ── library ───────────────────────────────────────────────────────

    function renderLibrary() {
      const onBoard = new Set(layout.map(function (e) { return e.id; }));
      library.innerHTML =
        '<div class="lib-head"><b>Card library</b><span class="muted">' + cards.length + ' cards · drag onto the board</span></div>' +
        cards.map(function (c) {
          const added = onBoard.has(c.id);
          return '<div class="lib-item' + (added ? ' added' : '') + '" draggable="' + !added + '" data-id="' + W.esc(c.id) + '">' +
            '<div><div class="lib-title">' + W.esc(c.title) + '</div>' +
            '<div class="lib-meta">' + W.esc(c.display) + ' · ' + W.esc(c.provider) + '</div></div>' +
            (added ? '<span class="muted">On board</span>' : '<button class="btn small" data-add="' + W.esc(c.id) + '">Add</button>') +
            '</div>';
        }).join('');

      library.querySelectorAll('.lib-item[draggable="true"]').forEach(function (item) {
        item.addEventListener('dragstart', function (e) {
          drag = { kind: 'lib', id: item.dataset.id };
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', item.dataset.id);
        });
        item.addEventListener('dragend', function () {
          const ph = grid.querySelector('.placeholder');
          if (ph) ph.remove();
          drag = null;
        });
      });
      library.querySelectorAll('[data-add]').forEach(function (btn) {
        btn.onclick = function () {
          const card = cardById.get(btn.dataset.add);
          layout = L.add(layout, card);
          persist();
          mountCard({ id: card.id, size: card.size });
          renderLibrary();
          emptyState();
        };
      });
    }

    // ── toolbar ───────────────────────────────────────────────────────

    main.querySelector('#days').onclick = function (e) {
      const d = e.target.dataset && e.target.dataset.days;
      if (!d) return;
      daysByBoard[boardId] = Number(d);
      renderBoard(main, catalog, boardId, onAsk);
    };
    const analyze = main.querySelector('#analyze');
    if (analyze) {
      analyze.onclick = function () {
        W.agent.reviewBoard('Review the ' + board.title + ' board: what moved the most in the last ' + days + ' days, and why?');
      };
    }
    if (W.agent) W.agent.setBoard({ id: board.id, title: board.title, days: days });

    main.querySelector('#lib-toggle').onclick = function () {
      libraryOpen = !libraryOpen;
      library.hidden = !libraryOpen;
      main.querySelector('.board-body').classList.toggle('with-lib', libraryOpen);
      this.classList.toggle('on', libraryOpen);
    };
    main.querySelector('#reset').onclick = function () {
      L.reset(localStorage, boardId);
      renderBoard(main, catalog, boardId, onAsk);
    };

    layout.forEach(function (entry) { mountCard(entry); });
    renderLibrary();
    emptyState();
  }

  W.renderBoard = renderBoard;
})();
