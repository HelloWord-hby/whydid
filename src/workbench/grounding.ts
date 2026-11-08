/**
 * Grounding check — every number in an answer should appear in a tool
 * result. This scans the answer for numbers and looks for each one among
 * the numbers the tools returned, allowing only display formatting:
 * rounding or truncating to the shown precision, thousands separators, sign
 * dropped for "fell by", and fractions shown as %, pp, "percentage points"
 * or 个百分点. Dates (ISO, written out in English or Chinese) are not numbers.
 *
 * It is a heuristic, not a proof: small bare integers (counts like "top 3")
 * are skipped, and a coincidental match counts as grounded. It runs in code,
 * not as an LLM judge, so it is cheap enough to run on every answer.
 */

export interface GroundingReport {
  checked: number;
  ungrounded: string[];
}

const REF = /\[#\d+\]/g;
const ISO_DATETIME = /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g;
// Dates written out in prose: "January 1–8, 2024", "December 25, 2023", "1 Nov 2026", "2024年1月8日".
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const PROSE_DATE = new RegExp(
  `\\b${MONTH}\\s+\\d{1,2}(?:\\s*[–-]\\s*(?:${MONTH}\\s+)?\\d{1,2})?(?:,?\\s*\\d{4})?|\\b\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?`,
  'gi'
);
const CJK_DATE = /\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
// "%", "pp", "percentage points" and "个百分点" all mark a fraction shown ×100.
const NUMBER =
  /(?<![A-Za-z_\d.-])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s?(?:%|pp\b|percentage[- ]points?\b|个?百分点))?(?![A-Za-z_\d])/g;

export function extractNumbers(answer: string): Array<{ raw: string; value: number; decimals: number; percent: boolean }> {
  const text = answer.replace(REF, ' ').replace(ISO_DATETIME, ' ').replace(PROSE_DATE, ' ').replace(CJK_DATE, ' ');
  const out: Array<{ raw: string; value: number; decimals: number; percent: boolean }> = [];
  for (const m of text.matchAll(NUMBER)) {
    const num = m[1]!;
    const percent = Boolean(m[2]);
    const value = Number(num.replace(/,/g, ''));
    const decimals = num.includes('.') ? num.split('.')[1]!.length : 0;
    if (!percent && decimals === 0 && Math.abs(value) < 10) continue;
    // A bare 4-digit integer in 1900–2100 is read as a year; counts are written with separators ("2,024").
    if (!percent && /^\d{4}$/.test(num) && value >= 1900 && value <= 2100) continue;
    out.push({ raw: m[0].trim(), value, decimals, percent });
  }
  return out;
}

export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

/** Shown value equals the candidate rounded, or truncated, to the shown precision. */
function matches(shown: number, decimals: number, candidate: number): boolean {
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  const s = Math.abs(shown);
  const c = Math.abs(candidate);
  if (Math.abs(c - s) <= tolerance) return true;
  const scale = 10 ** decimals;
  return Math.trunc(c * scale + 1e-9) === Math.round(s * scale);
}

export function checkGrounding(answer: string, toolResults: unknown[]): GroundingReport {
  const pool = collectNumbers(toolResults);
  const found = extractNumbers(answer);
  const ungrounded = found
    .filter(({ value, decimals, percent }) =>
      !pool.some((c) => matches(value, decimals, c) || (percent && matches(value, decimals, c * 100)))
    )
    .map((n) => n.raw);
  return { checked: found.length, ungrounded: [...new Set(ungrounded)] };
}
