/**
 * Built-in demo page served at GET / by `whydid serve`.
 *
 * One self-contained HTML string, no build step, no dependencies. It is a
 * reference client for the HTTP API: metric chips from /healthz, questions
 * through /ask, and the tool-call audit trail rendered next to the report
 * so every number can be traced to the call that produced it.
 */
export const DEMO_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>whydid</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --border: #262b36;
    --text: #e6e9ef; --muted: #8b93a3; --accent: #6ea8fe; --ok: #4ade80;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7f9; --panel: #ffffff; --border: #e3e6eb;
      --text: #1b1f27; --muted: #667085; --accent: #2563eb; --ok: #16a34a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 40px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.02em; }
  .sub { color: var(--muted); font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 22px; }
  .chip {
    font-size: 12px; padding: 3px 10px; border: 1px solid var(--border);
    border-radius: 999px; color: var(--muted); background: var(--panel);
  }
  .chip b { color: var(--text); font-weight: 500; }
  form { display: flex; gap: 8px; }
  input[type=text] {
    flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--panel); color: var(--text); font-size: 15px; outline: none;
  }
  input[type=text]:focus { border-color: var(--accent); }
  button {
    padding: 12px 22px; border-radius: 10px; border: none; cursor: pointer;
    background: var(--accent); color: #fff; font-size: 15px; font-weight: 500;
  }
  button:disabled { opacity: 0.5; cursor: wait; }
  .examples { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  .examples a { color: var(--accent); text-decoration: none; margin-right: 14px; cursor: pointer; }
  .status { margin: 26px 0 0; color: var(--muted); font-size: 14px; }
  .report {
    margin-top: 26px; background: var(--panel); border: 1px solid var(--border);
    border-radius: 14px; padding: 26px 30px;
  }
  .report h2 { font-size: 16px; margin: 18px 0 8px; }
  .report h3 { font-size: 14px; margin: 14px 0 6px; }
  .report p, .report li { font-size: 14.5px; }
  .report table { border-collapse: collapse; margin: 10px 0; font-size: 13.5px; }
  .report td, .report th { border: 1px solid var(--border); padding: 5px 10px; }
  .trail { margin-top: 18px; }
  .trail summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .call {
    margin: 8px 0; padding: 10px 14px; background: var(--panel);
    border: 1px solid var(--border); border-radius: 10px; font-size: 13px;
  }
  .call .name { color: var(--accent); font-family: ui-monospace, monospace; }
  .call .ms { color: var(--muted); float: right; }
  .call pre {
    margin: 8px 0 0; padding: 10px; overflow-x: auto; font-size: 12px;
    background: var(--bg); border-radius: 8px; color: var(--muted);
  }
  .meta { margin-top: 14px; color: var(--muted); font-size: 12.5px; }
  .err { color: #f87171; }
</style>
</head>
<body>
<div class="wrap">
  <header><h1>whydid</h1><span class="sub">deterministic-math attribution agent</span></header>
  <div class="sub" id="table-line">connecting&hellip;</div>
  <div class="chips" id="chips"></div>

  <form id="form">
    <input type="text" id="q" placeholder="why did the metric change?" autocomplete="off">
    <button type="submit" id="go">Ask</button>
  </form>
  <div class="examples" id="examples"></div>

  <div class="status" id="status"></div>
  <div id="out"></div>
</div>

<script>
(function () {
  var chipsEl = document.getElementById('chips');
  var statusEl = document.getElementById('status');
  var outEl = document.getElementById('out');
  var qEl = document.getElementById('q');
  var goEl = document.getElementById('go');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Tiny markdown renderer for the report: headings, bold, lists, tables, hr.
  function md(src) {
    var lines = esc(src).split('\\n');
    var html = [], inList = false, inTable = false;
    function closeAll() {
      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</table>'); inTable = false; }
    }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var t = l.replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
      if (/^\\s*$/.test(l)) { closeAll(); continue; }
      if (/^---+$/.test(l.trim())) { closeAll(); html.push('<hr>'); continue; }
      if (/^###\\s/.test(l)) { closeAll(); html.push('<h3>' + t.slice(4) + '</h3>'); continue; }
      if (/^##\\s/.test(l)) { closeAll(); html.push('<h2>' + t.slice(3) + '</h2>'); continue; }
      if (/^#\\s/.test(l)) { closeAll(); html.push('<h2>' + t.slice(2) + '</h2>'); continue; }
      if (/^\\s*[-*]\\s/.test(l)) {
        if (!inList) { html.push('<ul>'); inList = true; }
        html.push('<li>' + t.replace(/^\\s*[-*]\\s/, '') + '</li>');
        continue;
      }
      if (/^\\s*\\|/.test(l)) {
        if (/^\\s*\\|[\\s:|-]+\\|\\s*$/.test(l)) continue;
        if (!inTable) { html.push('<table>'); inTable = true; }
        var cells = t.replace(/^\\s*\\||\\|\\s*$/g, '').split('|');
        html.push('<tr><td>' + cells.join('</td><td>') + '</td></tr>');
        continue;
      }
      closeAll();
      html.push('<p>' + t + '</p>');
    }
    closeAll();
    return html.join('');
  }

  fetch('/healthz').then(function (r) { return r.json(); }).then(function (h) {
    document.getElementById('table-line').textContent =
      'table: ' + h.table + ' \\u00b7 ' + h.tools.length + ' deterministic tools';
    h.metrics.forEach(function (m) {
      var el = document.createElement('span');
      el.className = 'chip'; el.innerHTML = '<b>' + esc(m) + '</b>';
      chipsEl.appendChild(el);
    });
    var ex = document.getElementById('examples');
    var rate = h.metrics[3] || h.metrics[0];
    [
      'why did ' + rate + ' change in the last 3 days?',
      'why did ' + h.metrics[0] + ' change last week?'
    ].forEach(function (q) {
      var a = document.createElement('a');
      a.textContent = q;
      a.onclick = function () { qEl.value = q; };
      ex.appendChild(a);
    });
  }).catch(function () {
    document.getElementById('table-line').textContent = 'could not reach /healthz';
  });

  document.getElementById('form').onsubmit = function (e) {
    e.preventDefault();
    var q = qEl.value.trim();
    if (!q) return;
    goEl.disabled = true;
    outEl.innerHTML = '';
    var started = Date.now();
    statusEl.textContent = 'investigating\\u2026 (the agent is calling tools; typically 30\\u201360s)';
    var tick = setInterval(function () {
      statusEl.textContent = 'investigating\\u2026 ' + Math.round((Date.now() - started) / 1000) + 's';
    }, 1000);

    fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    }).then(function (r) { return r.json(); }).then(function (d) {
      clearInterval(tick);
      statusEl.textContent = '';
      goEl.disabled = false;
      if (d.error) {
        outEl.innerHTML = '<p class="err">' + esc(d.error) + '</p>';
        return;
      }
      var calls = d.tool_calls.map(function (c) {
        return '<div class="call"><span class="ms">' + c.duration_ms + 'ms</span>' +
          '<span class="name">' + esc(c.tool) + '</span> ' + esc(JSON.stringify(c.args)) +
          '<pre>' + esc(c.result.slice(0, 1200)) + '</pre></div>';
      }).join('');
      outEl.innerHTML =
        '<div class="report">' + md(d.report) + '</div>' +
        '<details class="trail"><summary>audit trail \\u00b7 ' + d.tool_calls.length +
        ' tool calls \\u00b7 every number traces to one of these</summary>' + calls + '</details>' +
        '<div class="meta">' + (d.usage.prompt_tokens + d.usage.completion_tokens) +
        ' tokens \\u00b7 ' + (d.duration_ms / 1000).toFixed(1) + 's</div>';
    }).catch(function (err) {
      clearInterval(tick);
      statusEl.textContent = '';
      goEl.disabled = false;
      outEl.innerHTML = '<p class="err">' + esc(String(err)) + '</p>';
    });
  };
})();
</script>
</body>
</html>
`;
