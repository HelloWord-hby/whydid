/**
 * Release log parsing — turn a README or CHANGELOG into dated entries.
 *
 * An entry is a heading plus the text under it. The entry level is the
 * highest heading level whose text carries a version or a date, so both
 * Keep-a-Changelog files (`## [1.2.0] - 2026-11-04` with `### Added`
 * underneath) and READMEs (`### v1.9 (2026-11-04)`) work. Headings inside
 * code fences are ignored. Entries without a date are kept but flagged:
 * the agent cannot line them up with a metric change.
 */

export interface ReleaseEntry {
  id: string;
  version: string | null;
  /** ISO date (YYYY-MM-DD) or null when the heading has none. */
  date: string | null;
  title: string;
  body: string;
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

const ISO_LIKE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const CJK_DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/;
const VERSION = /\bv?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]+)?\b/i;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function validDate(y: string, m: string, d: string): string | null {
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Date and version found in a heading. The date is removed before looking for a version. */
export function readHeading(text: string): { date: string | null; version: string | null } {
  let rest = text;
  let date: string | null = null;
  for (const re of [CJK_DATE, ISO_LIKE]) {
    const m = re.exec(rest);
    if (m) {
      date = validDate(m[1]!, m[2]!, m[3]!);
      if (date) {
        rest = rest.replace(m[0], ' ');
        break;
      }
    }
  }
  const v = VERSION.exec(rest);
  return { date, version: v ? v[0] : null };
}

/** Strip link and bracket syntax: `[1.2.0](url)` → `1.2.0`. */
function plainHeading(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[[\]]/g, '')
    .replace(/[*_`]/g, '')
    .trim();
}

function headingsOf(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = HEADING.exec(line);
    if (m) out.push({ level: m[1]!.length, text: plainHeading(m[2]!), line: i });
  });
  return out;
}

export function parseReleaseLog(markdown: string): ReleaseEntry[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const headings = headingsOf(lines);
  const marked = headings.filter((h) => {
    const r = readHeading(h.text);
    return r.date !== null || r.version !== null;
  });

  if (marked.length === 0) {
    const body = markdown.trim();
    if (!body) return [];
    return [{ id: 'r1', version: null, date: null, title: headings[0]?.text ?? 'Notes', body }];
  }

  const level = Math.min(...marked.map((h) => h.level));
  const starts = headings.filter((h) => h.level === level);
  return starts.map((h, i) => {
    const next = headings.find((x) => x.line > h.line && x.level <= level);
    const body = lines
      .slice(h.line + 1, next ? next.line : lines.length)
      .join('\n')
      .trim();
    const { date, version } = readHeading(h.text);
    return { id: `r${i + 1}`, version, date, title: h.text, body };
  });
}

/** Dated entries newest first, then undated ones in document order. */
export function sortEntries(entries: ReleaseEntry[]): ReleaseEntry[] {
  const dated = entries.filter((e) => e.date).sort((a, b) => (a.date! < b.date! ? 1 : a.date! > b.date! ? -1 : 0));
  return [...dated, ...entries.filter((e) => !e.date)];
}
