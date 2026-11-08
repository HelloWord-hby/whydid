/**
 * Grounding check — every number in an answer should appear in a tool
 * result. This scans the answer for numbers and looks for each one among
 * the numbers the tools returned, allowing only display formatting:
 * rounding to the shown precision, thousands separators, sign dropped for
 * "fell by", and fractions shown as % or pp.
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
const NUMBER =
  /(?<![A-Za-z_\d.-])(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s?(?:%|pp\b))?(?![A-Za-z_\d])/g;

export function extractNumbers(answer: string): Array<{ raw: string; value: number; decimals: number; percent: boolean }> {
  const text = answer.replace(REF, ' ').replace(ISO_DATETIME, ' ');
  const out: Array<{ raw: string; value: number; decimals: number; percent: boolean }> = [];
  for (const m of text.matchAll(NUMBER)) {
    const num = m[1]!;
    const percent = Boolean(m[2]);
    const value = Number(num.replace(/,/g, ''));
    const decimals = num.includes('.') ? num.split('.')[1]!.length : 0;
    if (!percent && decimals === 0 && Math.abs(value) < 10) continue;
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

function matches(shown: number, decimals: number, candidate: number): boolean {
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return Math.abs(Math.abs(candidate) - Math.abs(shown)) <= tolerance;
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
