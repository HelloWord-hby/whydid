/**
 * whydid dashboard — router and the classic views.
 *
 * Tabs: one per board from GET /boards (see boards.js), plus Metrics (every
 * metric of the main semantic config, with drill-down and decomposition)
 * and Ask (full agent investigations). All numbers come from the server's
 * deterministic tools; only Ask spends LLM tokens.
 *
 * Point it at a remote whydid instance with ?api=https://host:port. If the
 * server sets WHYDID_SERVE_TOKEN, pass ?token=... once (kept in sessionStorage).
 */
(function () {
  'use strict';

  const W = window.W;
  const API = W.API;
  const headers = W.headers;
  const getJson = W.getJson;
  const md = W.md;

  function tool(name, args) {
    return W.postJson('/tool', { name: name, args: args }).then(function (b) { return b.result; });
  }

  // ── dates: UTC full days, half-open [from, to) ──────────────────────

  function isoDay(d) {
    return d.toISOString().slice(0, 10);
  }
  function daysAgo(n) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  }
  /** Last n full days: [today-n, today). */
  function lastDays(n) {
    return { from: isoDay(daysAgo(n)), to: isoDay(daysAgo(0)) };
  }

  // ── formatting ──────────────────────────────────────────────────────

  const esc = W.esc;

  function fmtValue(metric, v) {
    if (v == null) return '—';
    if (metric.kind === 'additive') return Math.round(v).toLocaleString('en-US');
    const abs = Math.abs(v);
    const s = abs >= 100 ? v.toFixed(0) : abs >= 1 ? v.toFixed(2) : v.toFixed(3);
    return metric.unit ? s + ' ' + metric.unit : s;
  }

  function deltaHtml(deltaPct, delta) {
    if (delta == null) return '<span class="delta flat">no baseline</span>';
    if (delta === 0) return '<span class="delta flat">flat vs prev</span>';
    const cls = delta > 0 ? 'up' : 'down';
    const arrow = delta > 0 ? '▲' : '▼';
    const pct = deltaPct == null ? '' : ' ' + Math.abs(deltaPct).toFixed(1) + '%';
    return '<span class="delta ' + cls + '">' + arrow + pct + ' vs prev period</span>';
  }

  // ── svg charts (hand-rolled, no deps) ───────────────────────────────

  function scale(points) {
    const vals = points.map(function (p) { return p.value; });
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  }

  function sparkline(points) {
    if (points.length < 2) return '';
    const w = 200, h = 36;
    const s = scale(points);
    const pts = points.map(function (p, i) {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.value - s.min) / (s.max - s.min)) * h;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="1.6" points="' +
      pts.join(' ') + '"/></svg>'
    );
  }

  function lineChart(points, metric) {
    if (points.length < 2) return '<div class="empty">Not enough data points.</div>';
    const w = 720, h = 190, padL = 46, padB = 20, padT = 10, padR = 10;
    const iw = w - padL - padR, ih = h - padT - padB;
    const s = scale(points);
    function px(i) { return padL + (i / (points.length - 1)) * iw; }
    function py(v) { return padT + ih - ((v - s.min) / (s.max - s.min)) * ih; }

    const line = points
      .map(function (p, i) { return px(i).toFixed(1) + ',' + py(p.value).toFixed(1); })
      .join(' ');

    let dots = '';
    points.forEach(function (p, i) {
      if (p.outlier) {
        dots +=
          '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(p.value).toFixed(1) +
          '" r="4" fill="var(--' + (p.outlier === 'high' ? 'warn' : 'down') + ')">' +
          '<title>' + esc(p.bucket) + ': ' + esc(fmtValue(metric, p.value)) +
          ' (' + p.outlier + ' outlier)</title></circle>';
      }
    });

    const yTop = fmtValue(metric, s.max), yBottom = fmtValue(metric, s.min);
    const xFirst = points[0].bucket, xLast = points[points.length - 1].bucket;

    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '">' +
      '<text class="axis" x="' + (padL - 6) + '" y="' + (padT + 8) + '" text-anchor="end">' + esc(yTop) + '</text>' +
      '<text class="axis" x="' + (padL - 6) + '" y="' + (padT + ih) + '" text-anchor="end">' + esc(yBottom) + '</text>' +
      '<text class="axis" x="' + padL + '" y="' + (h - 4) + '">' + esc(xFirst) + '</text>' +
      '<text class="axis" x="' + (w - padR) + '" y="' + (h - 4) + '" text-anchor="end">' + esc(xLast) + '</text>' +
      '<line x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (w - padR) + '" y2="' + (padT + ih) + '" stroke="var(--border)"/>' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="' + line + '"/>' +
      dots +
      '</svg>'
    );
  }

  function bar(share, positive) {
    const width = Math.max(2, Math.round(Math.abs(share) * 90));
    return '<span class="bar ' + (positive ? 'pos' : 'neg') + '" style="width:' + width + 'px"></span>';
  }

  // ── state & routing ─────────────────────────────────────────────────

  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  let health = null;
  let catalog = null;
  let askPrefill = '';
  let askBoard = null;

  function metricByName(name) {
    return health.metrics.find(function (m) { return m.name === name; }) || null;
  }

  function renderNav(active) {
    const tabs = (catalog ? catalog.boards : []).map(function (b) {
      return { href: '#/b/' + b.id, label: b.title, key: 'b/' + b.id };
    });
    tabs.push({ href: '#/metrics', label: 'Metrics', key: 'metrics' });
    tabs.push({ href: '#/ask', label: 'Ask', key: 'ask' });
    nav.innerHTML = tabs.map(function (t) {
      return '<a href="' + t.href + '" class="' + (t.key === active ? 'active' : '') + '">' + esc(t.label) + '</a>';
    }).join('');
  }

  function onAsk(card, board) {
    askPrefill = card.ask;
    askBoard = board.id;
    location.hash = '#/ask';
  }

  function route() {
    if (!health) return;
    const hash = location.hash || '';
    let m;
    if ((m = hash.match(/^#\/b\/([a-z0-9_]+)$/)) && catalog &&
        catalog.boards.some(function (b) { return b.id === m[1]; })) {
      renderNav('b/' + m[1]);
      return W.renderBoard(main, catalog, m[1], onAsk);
    }
    if (W.agent) W.agent.clearBoard();
    if (hash === '#/ask') { renderNav('ask'); return renderAsk(); }
    if ((m = hash.match(/^#\/m\/(.+)$/)) && metricByName(decodeURIComponent(m[1]))) {
      renderNav('metrics');
      return renderMetric(decodeURIComponent(m[1]));
    }
    if (hash === '#/metrics' || !catalog) { renderNav('metrics'); return renderOverview(); }
    location.replace('#/b/' + catalog.boards[0].id);
  }

  window.addEventListener('hashchange', route);

  Promise.all([getJson('/healthz'), getJson('/boards').catch(function () { return null; })])
    .then(function (r) {
      health = r[0];
      catalog = r[1];
      document.getElementById('subline').textContent = 'deterministic numbers · LLM only explains';
      route();
    })
    .catch(function (e) {
      main.innerHTML =
        '<div class="panel"><p class="err">Cannot reach the whydid API (' + esc(e.message) + ').</p>' +
        '<p class="note">Is <code>whydid serve</code> running? For a remote instance, open with ?api=&lt;url&gt;.</p></div>';
    });

  // ── overview ────────────────────────────────────────────────────────

  function renderOverview() {
    main.innerHTML =
      '<p class="board-desc">Every metric in <code>' + esc(health.table) + '</code> (from whydid.config.yaml).</p><div class="cards">' +
      health.metrics
        .map(function (m) {
          return (
            '<div class="card" id="card-' + esc(m.name) + '" onclick="location.hash=\'#/m/' +
            encodeURIComponent(m.name) + '\'">' +
            '<div class="label">' + esc(m.label) + '</div>' +
            '<div class="value">…</div><div class="delta flat">loading</div><svg></svg></div>'
          );
        })
        .join('') +
      '</div>' +
      '<p class="note">Last 7 full days (UTC) vs the previous 7. Click a metric to decompose it.</p>';

    health.metrics.forEach(function (m) {
      const card = document.getElementById('card-' + m.name);
      Promise.all([
        tool('compare_periods', { metric: m.name, period_b: lastDays(7), compare_to: 'prev_period' }),
        tool('get_metric_trend', { metric: m.name, period: lastDays(14), granularity: 'day' }),
      ])
        .then(function (r) {
          const cmp = r[0], trend = r[1];
          card.querySelector('.value').textContent = fmtValue(m, cmp.period_b_total);
          card.querySelector('.delta').outerHTML = deltaHtml(cmp.delta_pct, cmp.delta);
          card.querySelector('svg').outerHTML = sparkline(trend.points);
        })
        .catch(function (e) {
          card.querySelector('.delta').outerHTML = '<span class="delta flat err">' + esc(e.message) + '</span>';
        });
    });
  }

  // ── metric detail ───────────────────────────────────────────────────

  const detailState = { days: 7, dimension: null };

  function renderMetric(name) {
    const m = metricByName(name);
    if (!detailState.dimension && health.dimensions.length) {
      detailState.dimension = health.dimensions[0].name;
    }
    const days = detailState.days;

    const windows = [7, 14, 30]
      .map(function (d) {
        return '<a class="' + (d === days ? 'active' : '') + '" data-days="' + d + '">' + d + 'd</a>';
      })
      .join('');
    const dims = health.dimensions
      .map(function (d) {
        return (
          '<option value="' + esc(d.name) + '"' +
          (d.name === detailState.dimension ? ' selected' : '') + '>' + esc(d.label) + '</option>'
        );
      })
      .join('');

    main.innerHTML =
      '<div class="crumb"><a href="#/metrics">Metrics</a> / ' + esc(m.label) + '</div>' +
      '<div class="panel"><h2>' + esc(m.label) +
      '<span class="softtag">' + m.kind + (m.unit ? ' · ' + esc(m.unit) : '') + '</span></h2>' +
      '<div class="controls">' +
      '<div class="group" id="win">' + windows + '</div>' +
      '<select id="dim">' + dims + '</select>' +
      '<div class="spacer"></div>' +
      '<button class="ghost" id="explain">Ask the agent to explain →</button>' +
      '</div>' +
      '<div class="stats" id="stats"></div>' +
      '<div class="bigchart" id="chart"><div class="empty">Loading trend…</div></div>' +
      '</div>' +
      '<div class="panel"><h2>Decomposition' +
      '<span class="softtag">last ' + days + 'd vs previous ' + days + 'd, by dimension</span></h2>' +
      '<div id="decomp"><div class="empty">Loading…</div></div></div>';

    document.getElementById('win').onclick = function (e) {
      if (e.target.dataset && e.target.dataset.days) {
        detailState.days = Number(e.target.dataset.days);
        renderMetric(name);
      }
    };
    document.getElementById('dim').onchange = function (e) {
      detailState.dimension = e.target.value;
      renderMetric(name);
    };
    document.getElementById('explain').onclick = function () {
      askBoard = null;
      askPrefill =
        'why did ' + name + ' change in the last ' + days + ' days compared to the previous ' +
        days + ' days? which ' + detailState.dimension + ' drove it?';
      location.hash = '#/ask';
    };

    const current = lastDays(days);

    tool('compare_periods', { metric: name, period_b: current, compare_to: 'prev_period' })
      .then(function (cmp) {
        document.getElementById('stats').innerHTML =
          '<div class="stat">current (' + cmp.period_b.from + ' → ' + cmp.period_b.to + ')<b>' +
          fmtValue(m, cmp.period_b_total) + '</b></div>' +
          '<div class="stat">baseline (' + cmp.period_a.from + ' → ' + cmp.period_a.to + ')<b>' +
          fmtValue(m, cmp.period_a_total) + '</b></div>' +
          '<div class="stat">change<b>' + deltaHtml(cmp.delta_pct, cmp.delta) + '</b></div>';
      })
      .catch(showErr('stats'));

    tool('get_metric_trend', {
      metric: name,
      period: lastDays(days * 2),
      granularity: days >= 30 ? 'week' : 'day',
    })
      .then(function (trend) {
        document.getElementById('chart').innerHTML = lineChart(trend.points, m);
      })
      .catch(showErr('chart'));

    if (!m.decompose || !detailState.dimension) {
      document.getElementById('decomp').innerHTML =
        '<div class="empty">Decomposition is not available for this metric.</div>';
      return;
    }

    const decompTool = m.kind === 'additive' ? 'decompose_change_additive' : 'decompose_change_rate';
    tool(decompTool, {
      metric: name,
      period_a: { from: shift(current.from, -days), to: current.from },
      period_b: current,
      dimension: detailState.dimension,
      top_n: 12,
    })
      .then(function (d) {
        document.getElementById('decomp').innerHTML =
          m.kind === 'additive' ? additiveTable(m, d) : rateTable(m, d);
      })
      .catch(showErr('decomp'));
  }

  function shift(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return isoDay(d);
  }

  function showErr(id) {
    return function (e) {
      document.getElementById(id).innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    };
  }

  function segLabel(d) {
    return esc(d.label ? d.label + ' (' + d.segment + ')' : d.segment);
  }

  function additiveTable(m, d) {
    const drivers = d.growth_drivers.concat(d.drag_drivers);
    drivers.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    if (!drivers.length) return '<div class="empty">No segment changes in this window.</div>';

    const unstable = d.stability === 'unstable';
    const rows = drivers
      .map(function (x) {
        const share = unstable
          ? (x.abs_contribution_share * 100).toFixed(0) + '% of movement'
          : x.contribution_share == null
            ? '—'
            : (x.contribution_share * 100).toFixed(0) + '% of change';
        return (
          '<tr><td>' + segLabel(x) + '</td>' +
          '<td class="num">' + fmtValue(m, x.period_a) + '</td>' +
          '<td class="num">' + fmtValue(m, x.period_b) + '</td>' +
          '<td class="num">' + (x.delta > 0 ? '+' : '') + fmtValue(m, x.delta) + '</td>' +
          '<td>' + bar(x.abs_contribution_share, x.delta > 0) + ' <span class="note">' + share + '</span></td></tr>'
        );
      })
      .join('');

    return (
      (unstable
        ? '<p class="note">⚠ Total change is under 1% of baseline — shares of change are unreliable; ranking by share of absolute movement instead.</p>'
        : '') +
      '<table class="grid"><tr><th>segment</th><th class="num">baseline</th><th class="num">current</th>' +
      '<th class="num">Δ</th><th>contribution</th></tr>' + rows + '</table>'
    );
  }

  function rateTable(m, d) {
    if (!d.drivers.length) return '<div class="empty">No data in one of the periods.</div>';
    const chips =
      '<div class="stats">' +
      '<div class="stat">mix effect<b>' + fmtSigned(d.mix_effect) + '</b></div>' +
      '<div class="stat">behavior effect<b>' + fmtSigned(d.behavior_effect) + '</b></div>' +
      '<div class="stat">interaction<b>' + fmtSigned(d.interaction) + '</b></div>' +
      '</div>' +
      (d.interaction_warning
        ? '<p class="note">⚠ Interaction term is large — treat the mix/behavior split as approximate.</p>'
        : '');

    const maxAbs = Math.max.apply(null, d.drivers.map(function (x) { return Math.abs(x.total_contribution); })) || 1;
    const rows = d.drivers
      .map(function (x) {
        return (
          '<tr><td>' + segLabel(x) + '</td>' +
          '<td class="num">' + fmtValue(m, x.rate_a) + ' → ' + fmtValue(m, x.rate_b) + '</td>' +
          '<td class="num">' + (x.weight_a * 100).toFixed(0) + '% → ' + (x.weight_b * 100).toFixed(0) + '%</td>' +
          '<td class="num">' + fmtSigned(x.behavior_contribution) + '</td>' +
          '<td class="num">' + fmtSigned(x.mix_contribution) + '</td>' +
          '<td class="num">' + fmtSigned(x.interaction_contribution) + '</td>' +
          '<td>' + bar(x.total_contribution / maxAbs, x.total_contribution > 0) + '</td></tr>'
        );
      })
      .join('');

    return (
      chips +
      '<table class="grid"><tr><th>segment</th><th class="num">rate</th><th class="num">share of traffic</th>' +
      '<th class="num">behavior</th><th class="num">mix</th><th class="num">interaction</th><th>total contribution</th></tr>' + rows + '</table>'
    );
  }

  function fmtSigned(v) {
    if (v == null) return '—';
    const s = Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
    return (v > 0 ? '+' : '') + s;
  }

  // ── ask ─────────────────────────────────────────────────────────────

  function renderAsk() {
    const rate = health.metrics.find(function (m) { return m.kind === 'rate'; });
    const board = askBoard && catalog ? catalog.boards.find(function (b) { return b.id === askBoard; }) : null;
    const examples = board ? [] : [
      'why did ' + (rate ? rate.name : health.metrics[0].name) + ' change in the last 7 days?',
      'why did ' + health.metrics[0].name + ' change last week?',
    ];

    main.innerHTML =
      '<div class="panel">' +
      '<form class="askform" id="form">' +
      '<input type="text" id="q" placeholder="why did the metric change?" autocomplete="off" value="' + esc(askPrefill) + '">' +
      '<button class="primary" type="submit" id="go">Ask</button></form>' +
      '<div class="examples" id="examples">' +
      (board ? 'Investigating the <b>' + esc(board.title) + '</b> data · <a id="clear-board">switch to ' + esc(health.table) + '</a>' : '') +
      '</div>' +
      '<div class="status" id="status"></div>' +
      '<div id="out"></div></div>';
    askPrefill = '';
    const clear = document.getElementById('clear-board');
    if (clear) clear.onclick = function () { askBoard = null; renderAsk(); };

    const ex = document.getElementById('examples');
    examples.forEach(function (q) {
      const a = document.createElement('a');
      a.textContent = q;
      a.onclick = function () { document.getElementById('q').value = q; };
      ex.appendChild(a);
    });

    document.getElementById('form').onsubmit = function (e) {
      e.preventDefault();
      const q = document.getElementById('q').value.trim();
      if (!q) return;
      const goEl = document.getElementById('go');
      const statusEl = document.getElementById('status');
      const outEl = document.getElementById('out');
      goEl.disabled = true;
      outEl.innerHTML = '';
      const started = Date.now();
      const tick = setInterval(function () {
        statusEl.textContent =
          'investigating… ' + Math.round((Date.now() - started) / 1000) + 's (the agent is calling tools)';
      }, 1000);

      fetch(API + '/ask', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(askBoard ? { question: q, board: askBoard } : { question: q }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          clearInterval(tick);
          statusEl.textContent = '';
          goEl.disabled = false;
          if (d.error) {
            outEl.innerHTML = '<p class="err">' + esc(d.error) + '</p>';
            return;
          }
          const calls = d.tool_calls
            .map(function (c) {
              return (
                '<div class="call"><span class="ms">' + c.duration_ms + 'ms</span>' +
                '<span class="name">' + esc(c.tool) + '</span> ' + esc(JSON.stringify(c.args)) +
                '<pre>' + esc(c.result.slice(0, 1200)) + '</pre></div>'
              );
            })
            .join('');
          outEl.innerHTML =
            '<div class="report">' + md(d.report) + '</div>' +
            '<details class="trail"><summary>audit trail · ' + d.tool_calls.length +
            ' tool calls · every number traces to one of these</summary>' + calls + '</details>' +
            '<div class="meta">' + (d.usage.prompt_tokens + d.usage.completion_tokens) +
            ' tokens · ' + (d.duration_ms / 1000).toFixed(1) + 's</div>';
        })
        .catch(function (err) {
          clearInterval(tick);
          statusEl.textContent = '';
          goEl.disabled = false;
          outEl.innerHTML = '<p class="err">' + esc(String(err)) + '</p>';
        });
    };
  }
})();
