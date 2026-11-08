/**
 * Agent panel — docked on the right of every board.
 *
 * Talks to /agent/sessions over a streamed POST (Server-Sent Events).
 * Shows each tool call live, folds them into a summary when the answer
 * arrives, turns [#n] citations into links to the exact tool call, and
 * shows the server's grounding check (numbers not found in tool results).
 */
(function () {
  'use strict';

  const W = window.W;
  const STORE_KEY = 'whydid.agent.session';
  const panel = document.getElementById('agent');
  const log = document.getElementById('agent-log');
  const form = document.getElementById('agent-form');
  const input = document.getElementById('agent-input');
  const presetsEl = document.getElementById('agent-presets');
  const ctxEl = document.getElementById('agent-ctx');

  let status = null;
  let sessionId = localStorage.getItem(STORE_KEY);
  let running = false;
  let board = null; // { id, title, days }
  let card = null; // { id, title }

  // ── helpers ──────────────────────────────────────────────────────────

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function argsSummary(args) {
    const s = JSON.stringify(args || {});
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }

  function pretty(json) {
    try { return JSON.stringify(JSON.parse(json), null, 2); } catch (_) { return json; }
  }

  function setRunning(on) {
    running = on;
    form.querySelector('button').disabled = on;
    input.disabled = on || !(status && status.llm_configured);
    panel.classList.toggle('busy', on);
  }

  // ── context chip & presets ───────────────────────────────────────────

  function renderContext() {
    const parts = [];
    if (board) parts.push('<span class="chipctx">Board · ' + W.esc(board.title) + ' · ' + board.days + 'd</span>');
    if (card) parts.push('<span class="chipctx card">Card · ' + W.esc(card.title) + ' <a data-clear="1" title="Ask without this card">×</a></span>');
    ctxEl.innerHTML = parts.join('');
    const clear = ctxEl.querySelector('[data-clear]');
    if (clear) clear.onclick = function () { card = null; presetsEl.innerHTML = ''; renderContext(); };
  }

  function renderPresets(list) {
    presetsEl.innerHTML = '';
    (list || []).forEach(function (q) {
      const b = el('button', 'preset', W.esc(q));
      b.type = 'button';
      b.onclick = function () { send(q); };
      presetsEl.appendChild(b);
    });
  }

  // ── run rendering ────────────────────────────────────────────────────

  function userBubble(text) {
    log.appendChild(el('div', 'msg user', W.esc(text)));
  }

  /** Returns an event handler that renders one agent turn into a new block. */
  function runBlock() {
    const block = el('div', 'msg agent');
    const steps = el('div', 'steps');
    const stepsHead = el('button', 'steps-head', '<span class="spin"></span> Working…');
    stepsHead.type = 'button';
    const stepsBody = el('div', 'steps-body');
    steps.appendChild(stepsHead);
    steps.appendChild(stepsBody);
    const answer = el('div', 'answer');
    const foot = el('div', 'foot-meta');
    block.appendChild(steps);
    block.appendChild(answer);
    block.appendChild(foot);
    log.appendChild(block);
    stepsHead.onclick = function () { steps.classList.toggle('open'); };
    steps.classList.add('open');
    const rows = {};

    return function onEvent(e) {
      if (e.type === 'tool_start') {
        const row = el('div', 'step running');
        row.dataset.ref = e.ref;
        row.innerHTML =
          '<div class="step-line"><span class="dot"></span><b>#' + e.ref + '</b> <code>' + W.esc(e.tool) + '</code>' +
          (e.injected ? '<span class="tag">context</span>' : '') +
          '<span class="args">' + W.esc(argsSummary(e.args)) + '</span><span class="ms"></span></div>' +
          '<pre class="detail" hidden>args ' + W.esc(JSON.stringify(e.args, null, 2)) + '</pre>';
        row.querySelector('.step-line').onclick = function () {
          const d = row.querySelector('.detail');
          d.hidden = !d.hidden;
        };
        rows[e.ref] = row;
        stepsBody.appendChild(row);
      } else if (e.type === 'tool_end') {
        const row = rows[e.ref];
        if (row) {
          row.className = 'step ' + (e.ok ? 'ok' : 'fail');
          row.querySelector('.ms').textContent = e.ms + ' ms';
          row.querySelector('.detail').textContent += '\n\nresult ' + pretty(e.result);
        }
      } else if (e.type === 'text') {
        stepsBody.appendChild(el('div', 'step-text', W.esc(e.text)));
      } else if (e.type === 'answer') {
        answer.innerHTML = W.md(e.text).replace(/\[#(\d+)\]/g, '<a class="cite" data-ref="$1">#$1</a>');
        answer.querySelectorAll('.cite').forEach(function (a) {
          a.onclick = function () { revealRef(a.dataset.ref); };
        });
        if (e.partial) answer.classList.add('partial');
      } else if (e.type === 'done') {
        const n = Object.keys(rows).length;
        steps.classList.remove('open');
        stepsHead.innerHTML = '▸ ' + n + ' tool call' + (n === 1 ? '' : 's') + ' · show steps';
        const g = e.grounding || { checked: 0, ungrounded: [] };
        const ground = g.ungrounded.length
          ? '<span class="ground warn" title="Numbers in the answer that no tool returned">⚠ ' + g.ungrounded.length +
            ' number' + (g.ungrounded.length === 1 ? '' : 's') + ' not found in tool results: ' + W.esc(g.ungrounded.join(', ')) + '</span>'
          : '<span class="ground ok">✓ ' + g.checked + ' numbers checked against tool results</span>';
        foot.innerHTML = ground + '<span>' + (e.usage.prompt_tokens + e.usage.completion_tokens).toLocaleString('en-US') +
          ' tokens · prompt ' + W.esc(e.prompt_version) + '</span>';
      } else if (e.type === 'error') {
        steps.classList.remove('open');
        stepsHead.innerHTML = '▸ stopped';
        answer.innerHTML = '<p class="err">' + W.esc(e.message) + '</p>';
      }
      scrollDown();
    };
  }

  function revealRef(ref) {
    const rows = log.querySelectorAll('.step[data-ref="' + ref + '"]');
    const row = rows[rows.length - 1];
    if (!row) return;
    const steps = row.closest('.steps');
    steps.classList.add('open');
    row.querySelector('.detail').hidden = false;
    row.classList.add('flash');
    setTimeout(function () { row.classList.remove('flash'); }, 1200);
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── transport ────────────────────────────────────────────────────────

  async function ensureSession() {
    if (sessionId) return sessionId;
    const r = await W.postJson('/agent/sessions', {});
    sessionId = r.id;
    localStorage.setItem(STORE_KEY, sessionId);
    return sessionId;
  }

  async function stream(body, onEvent) {
    const r = await fetch(W.API + '/agent/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: W.headers(),
      body: JSON.stringify(body),
    });
    if (r.status === 404) {
      // Session expired (or the server restarted): start over once.
      sessionId = null;
      localStorage.removeItem(STORE_KEY);
      await ensureSession();
      return stream(body, onEvent);
    }
    if (!r.ok || !r.body) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch (_) { /* not JSON */ }
      onEvent({ type: 'error', message: msg });
      return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split('\n').filter(function (l) { return l.indexOf('data: ') === 0; })
          .map(function (l) { return l.slice(6); }).join('');
        if (data) onEvent(JSON.parse(data));
      }
    }
  }

  async function send(text, entry) {
    text = (text || '').trim();
    if (!text || running) return;
    if (!status || !status.llm_configured) return;
    const body = { text: text, entry: entry || (card ? 'card' : 'chat') };
    if (board) { body.board = board.id; body.days = board.days; }
    if (body.entry === 'card' && card) body.card = card.id;
    if (body.entry !== 'card') delete body.card;
    // The card's data is injected once; follow-ups are plain chat.
    if (body.entry === 'card') { card = null; presetsEl.innerHTML = ''; renderContext(); }

    userBubble(text);
    input.value = '';
    setRunning(true);
    const onEvent = runBlock();
    scrollDown();
    try {
      await ensureSession();
      await stream(body, onEvent);
    } catch (err) {
      onEvent({ type: 'error', message: String(err && err.message || err) });
    } finally {
      setRunning(false);
      input.focus();
    }
  }

  // ── restore & status ─────────────────────────────────────────────────

  function restore() {
    if (!sessionId) return Promise.resolve();
    return W.getJson('/agent/sessions/' + sessionId)
      .then(function (s) {
        s.transcript.forEach(function (item) {
          if (item.role === 'user') userBubble(item.text);
          else { const on = runBlock(); item.events.forEach(on); }
        });
      })
      .catch(function () {
        sessionId = null;
        localStorage.removeItem(STORE_KEY);
      });
  }

  function intro() {
    if (status && !status.llm_configured) {
      log.innerHTML =
        '<div class="setup"><b>No LLM configured.</b><p>Set <code>WHYDID_LLM_API_KEY</code> (any OpenAI-compatible endpoint) and restart <code>whydid serve</code>.</p>' +
        '<p>To try the workbench without a key, run the scripted mock: <code>npx tsx scripts/mock-llm.ts</code> and start the server with <code>WHYDID_LLM_BASE_URL=http://localhost:4010/v1 WHYDID_LLM_API_KEY=mock</code>.</p></div>';
      return;
    }
    if (!log.children.length) {
      log.innerHTML =
        '<div class="hint">Ask about anything on the dashboard. Every number in an answer links to the tool call that produced it.</div>';
    }
  }

  W.getJson('/agent/status')
    .then(function (s) {
      status = s;
      document.getElementById('agent-model').textContent = s.llm_configured ? s.model || '' : 'not configured';
      setRunning(false);
      return restore();
    })
    .then(intro)
    .catch(function () {
      document.getElementById('agent-toggle').hidden = true;
    });

  // ── public API ───────────────────────────────────────────────────────

  function open() {
    panel.hidden = false;
    document.body.classList.add('agent-open');
    document.getElementById('agent-toggle').classList.add('on');
    setTimeout(function () { input.focus(); }, 0);
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove('agent-open');
    document.getElementById('agent-toggle').classList.remove('on');
  }

  form.onsubmit = function (e) { e.preventDefault(); send(input.value); };
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  document.getElementById('agent-close').onclick = close;
  document.getElementById('agent-toggle').onclick = function () { panel.hidden ? open() : close(); };
  document.getElementById('agent-new').onclick = function () {
    if (running) return;
    sessionId = null;
    localStorage.removeItem(STORE_KEY);
    log.innerHTML = '';
    intro();
  };

  W.agent = {
    /** Called by the board view so free-text questions carry the board context. */
    setBoard: function (b) { board = b; renderContext(); },
    clearBoard: function () { board = null; card = null; renderContext(); presetsEl.innerHTML = ''; },
    /** Open the panel focused on one card, with preset questions. */
    askAboutCard: function (c, presets) {
      card = { id: c.id, title: c.title };
      renderContext();
      renderPresets(presets);
      open();
    },
    /** Open the panel and run a board review. */
    reviewBoard: function (text) { open(); send(text, 'board'); },
  };
})();
