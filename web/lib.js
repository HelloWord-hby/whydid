/**
 * Shared helpers for the whydid dashboard: API client, display formatting
 * and hand-rolled SVG charts. Formatting only — the browser never derives
 * a number that the server did not send.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const API = (params.get('api') || '').replace(/\/+$/, '');
  if (params.get('token')) sessionStorage.setItem('whydid_token', params.get('token'));
  const TOKEN = sessionStorage.getItem('whydid_token') || '';

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (TOKEN) h.Authorization = 'Bearer ' + TOKEN;
    return h;
  }

  async function getJson(path) {
    const r = await fetch(API + path, { headers: headers() });
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON error page */ }
    if (!r.ok) throw new Error((body && body.error) || 'HTTP ' + r.status + ' on ' + path);
    return body;
  }

  async function postJson(path, payload) {
    const r = await fetch(API + path, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
    const body = await r.json();
    if (body.error) throw new Error(body.error);
    return body;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Format a server-computed value for display. */
  function fmt(v, format) {
    if (v == null || v === '') return '—';
    switch (format) {
      case 'text': return esc(v);
      case 'int': return Math.round(v).toLocaleString('en-US');
      case 'pct': return (v * 100).toFixed(1) + '%';
      case 'ms': return Math.round(v).toLocaleString('en-US') + ' ms';
      case 'sec': return v.toFixed(2) + ' s';
      case 'usd': return '$' + (Math.abs(v) < 0.1 ? v.toFixed(4) : v.toFixed(2));
      case 'datetime': return esc(String(v).slice(5, 16).replace('T', ' '));
      default: {
        const a = Math.abs(v);
        return a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
      }
    }
  }

  /** Render a change. Percent-format metrics show percentage points. */
  function deltaText(data) {
    if (data.delta == null) return { text: 'no baseline', cls: 'flat' };
    if (data.delta === 0) return { text: 'flat', cls: 'flat' };
    const up = data.delta > 0;
    const arrow = up ? '▲' : '▼';
    let size;
    if (data.format === 'pct') size = Math.abs(data.delta * 100).toFixed(1) + ' pp';
    else if (data.delta_pct != null) size = Math.abs(data.delta_pct * 100).toFixed(1) + '%';
    else size = fmt(Math.abs(data.delta), data.format);
    let cls = 'flat';
    if (data.good_direction === 'up') cls = up ? 'good' : 'bad';
    if (data.good_direction === 'down') cls = up ? 'bad' : 'good';
    return { text: arrow + ' ' + size, cls: cls };
  }

  const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

  function sparkline(points) {
    if (!points || points.length < 2) return '';
    const w = 200, h = 34;
    const vals = points.map(function (p) { return p.v; });
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const coords = points.map(function (p, i) {
      return ((i / (points.length - 1)) * w).toFixed(1) + ',' + (h - 2 - ((p.v - min) / (max - min)) * (h - 4)).toFixed(1);
    });
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' +
      coords.join(' ') + '"/></svg>';
  }

  /** Multi-series line chart; null points break the line. */
  function lineChart(series, format) {
    const all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { if (p.v != null) all.push(p.v); }); });
    const n = series.length ? series[0].points.length : 0;
    if (all.length < 2 || n < 2) return '<div class="empty">Not enough data points.</div>';
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;
    const w = 640, h = 200, L = 52, R = 8, T = 8, B = 22;
    const iw = w - L - R, ih = h - T - B;
    const px = function (i) { return L + (i / (n - 1)) * iw; };
    const py = function (v) { return T + ih - ((v - min) / (max - min)) * ih; };

    let grid = '';
    for (let g = 0; g <= 3; g++) {
      const v = min + ((max - min) * g) / 3;
      const y = py(v).toFixed(1);
      grid += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + y + '" y2="' + y + '" class="gridline"/>' +
        '<text class="axis" x="' + (L - 6) + '" y="' + (Number(y) + 3) + '" text-anchor="end">' + fmt(v, format) + '</text>';
    }
    const first = series[0].points[0].t, last = series[0].points[n - 1].t;
    grid += '<text class="axis" x="' + L + '" y="' + (h - 5) + '">' + esc(first.slice(5)) + '</text>' +
      '<text class="axis" x="' + (w - R) + '" y="' + (h - 5) + '" text-anchor="end">' + esc(last.slice(5)) + '</text>';

    let lines = '';
    series.forEach(function (s, si) {
      const color = PALETTE[si % PALETTE.length];
      let path = '', pen = false;
      s.points.forEach(function (p, i) {
        if (p.v == null) { pen = false; return; }
        path += (pen ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(p.v).toFixed(1);
        pen = true;
        lines += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(p.v).toFixed(1) + '" r="2.4" fill="' + color +
          '"><title>' + esc(s.name) + ' · ' + esc(p.t) + ': ' + fmt(p.v, format) + '</title></circle>';
      });
      lines = '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' + lines;
    });

    const legend = series.length > 1
      ? '<div class="legend">' + series.map(function (s, si) {
          return '<span><i style="background:' + PALETTE[si % PALETTE.length] + '"></i>' + esc(s.name) + '</span>';
        }).join('') + '</div>'
      : '';
    return legend + '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '">' + grid + lines + '</svg>';
  }

  /**
   * Horizontal bars. Bar length is drawing scale only (value / largest
   * value); the numbers and shares printed are the server's.
   */
  function barChart(d) {
    const vals = d.items.map(function (it) { return it.value == null ? 0 : Math.abs(it.value); });
    const max = Math.max.apply(null, vals.concat([0])) || 1;
    const rows = d.items.map(function (it) {
      const width = it.value == null ? 0 : Math.max(1, (Math.abs(it.value) / max) * 100);
      const share = it.share == null ? '' : '<em>' + fmt(it.share, 'pct') + '</em>';
      return (
        '<div class="bar-row" title="' + esc(it.label) + '">' +
        '<span class="bar-label">' + esc(it.label) + '</span>' +
        '<span class="bar-track"><i style="width:' + width.toFixed(1) + '%"></i></span>' +
        '<span class="bar-val">' + fmt(it.value, d.format) + share + '</span></div>'
      );
    }).join('');
    const head = d.share_label ? '<div class="bar-head"><span></span><span>% ' + esc(d.share_label) + '</span></div>' : '';
    return d.items.length ? '<div class="bars">' + head + rows + '</div>' : '<div class="empty">No data in this window.</div>';
  }

  /** Donut chart. Slice angles come straight from the server's `share`. */
  function pieChart(d) {
    if (!d.slices.length) return '<div class="empty">No data in this window.</div>';
    const R = 60, r = 38, C = 70;
    let angle = -Math.PI / 2;
    function pt(rad, a) { return (C + rad * Math.cos(a)).toFixed(2) + ' ' + (C + rad * Math.sin(a)).toFixed(2); }
    const arcs = d.slices.map(function (s, i) {
      const color = PALETTE[i % PALETTE.length];
      const tip = '<title>' + esc(s.label) + ': ' + fmt(s.value, d.format) + ' (' + fmt(s.share, 'pct') + ')</title>';
      if (s.share >= 0.9999) {
        return '<circle cx="' + C + '" cy="' + C + '" r="' + ((R + r) / 2) + '" fill="none" stroke="' + color +
          '" stroke-width="' + (R - r) + '">' + tip + '</circle>';
      }
      const a0 = angle, a1 = angle + s.share * 2 * Math.PI;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return '<path fill="' + color + '" d="M ' + pt(R, a0) + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + pt(R, a1) +
        ' L ' + pt(r, a1) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + pt(r, a0) + ' Z">' + tip + '</path>';
    }).join('');
    const legend = d.slices.map(function (s, i) {
      return '<li><i style="background:' + PALETTE[i % PALETTE.length] + '"></i><span class="pl">' + esc(s.label) +
        '</span><span class="pv">' + fmt(s.value, d.format) + '</span><span class="ps">' + fmt(s.share, 'pct') + '</span></li>';
    }).join('');
    return (
      '<div class="pie"><svg viewBox="0 0 140 140">' + arcs +
      '<text x="70" y="68" text-anchor="middle" class="pie-total">' + fmt(d.total, d.format) + '</text>' +
      '<text x="70" y="84" text-anchor="middle" class="axis">total</text></svg>' +
      '<ul class="pie-legend">' + legend + '</ul></div>'
    );
  }

  /** Tiny markdown subset for /ask reports. */
  function md(src) {
    const lines = esc(src).split('\n');
    const out = [];
    let inList = false, inTable = false;
    function closeAll() {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inTable) { out.push('</table>'); inTable = false; }
    }
    lines.forEach(function (l) {
      const t = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if (/^\s*$/.test(l)) { closeAll(); return; }
      if (/^---+$/.test(l.trim())) { closeAll(); out.push('<hr>'); return; }
      if (/^###\s/.test(l)) { closeAll(); out.push('<h3>' + t.slice(4) + '</h3>'); return; }
      if (/^##\s/.test(l)) { closeAll(); out.push('<h2>' + t.slice(3) + '</h2>'); return; }
      if (/^#\s/.test(l)) { closeAll(); out.push('<h2>' + t.slice(2) + '</h2>'); return; }
      if (/^\s*[-*]\s/.test(l)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + t.replace(/^\s*[-*]\s/, '') + '</li>');
        return;
      }
      if (/^\s*\|/.test(l)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) return;
        if (!inTable) { out.push('<table>'); inTable = true; }
        const cells = t.replace(/^\s*\||\|\s*$/g, '').split('|');
        out.push('<tr><td>' + cells.join('</td><td>') + '</td></tr>');
        return;
      }
      closeAll();
      out.push('<p>' + t + '</p>');
    });
    closeAll();
    return out.join('');
  }

  window.W = {
    API: API,
    headers: headers,
    getJson: getJson,
    postJson: postJson,
    esc: esc,
    fmt: fmt,
    deltaText: deltaText,
    sparkline: sparkline,
    lineChart: lineChart,
    barChart: barChart,
    pieChart: pieChart,
    md: md,
  };
})();
