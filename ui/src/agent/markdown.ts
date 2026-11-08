/**
 * Tiny markdown subset for agent answers (bold, lists, headings, tables,
 * paragraphs). Input is HTML-escaped first; [#n] citations become buttons.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function markdownToHtml(src: string): string {
  const out: string[] = [];
  let list = false;
  let table = false;
  const close = () => {
    if (list) out.push('</ul>');
    if (table) out.push('</table>');
    list = table = false;
  };
  for (const raw of esc(src).split('\n')) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^\s*$/.test(raw)) {
      close();
      continue;
    }
    if (/^#{1,3}\s/.test(raw)) {
      close();
      out.push(`<p><strong>${line.replace(/^#{1,3}\s/, '')}</strong></p>`);
    } else if (/^\s*[-*]\s/.test(raw)) {
      if (!list) {
        close();
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${line.replace(/^\s*[-*]\s/, '')}</li>`);
    } else if (/^\s*\|/.test(raw)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue;
      if (!table) {
        close();
        out.push('<table>');
        table = true;
      }
      out.push(`<tr><td>${line.replace(/^\s*\||\|\s*$/g, '').split('|').join('</td><td>')}</td></tr>`);
    } else {
      close();
      out.push(`<p>${line}</p>`);
    }
  }
  close();
  return out
    .join('')
    .replace(/\[#(\d+)\]/g, '<button type="button" class="cite" data-ref="$1">#$1</button>');
}
