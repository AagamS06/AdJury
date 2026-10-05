/**
 * Shared, framework-agnostic CSV primitives used by every export serializer
 * (DailyPlan Day 36 single-review export, Day 37 history export, …).
 *
 * Extracted so the RFC 4180 escaping, the formula-injection guard, and the
 * small shared cell/filename helpers live in exactly one place — the two export
 * serializers must escape identically, so duplicating this logic would be a
 * correctness hazard, not just repetition (Rules.md §7). Kept pure (no Next /
 * DB), so it is unit-testable in the node test env.
 */

/**
 * UTF-8 byte-order mark. Prepended by the download routes (not baked into the
 * serializers, which stay clean parseable strings) so Excel reliably reads
 * non-ASCII content (accented characters, smart quotes) as UTF-8 rather than
 * mojibake.
 */
export const UTF8_BOM = "﻿";

/** RFC 4180 record separator. */
export const CRLF = "\r\n";

/** Leading characters a spreadsheet may interpret as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Characters that force a field to be quoted under RFC 4180. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * Escape one field for CSV output:
 *  1. **Formula-injection guard** — a field whose first character could start a
 *     spreadsheet formula (`= + - @`, tab, CR) is prefixed with a single quote
 *     so Excel/Sheets treat it as text. Content here is user-supplied in a
 *     multi-tenant app, so this is a real safety concern (Rules.md §5), worth a
 *     minor, documented alteration of such values.
 *  2. **RFC 4180 quoting** — a field containing a quote, comma, CR, or LF is
 *     wrapped in double quotes with internal quotes doubled.
 */
export function escapeCsvField(raw: string): string {
  let value = raw;
  if (value.length > 0 && FORMULA_PREFIX.test(value)) {
    value = `'${value}`;
  }
  if (MUST_QUOTE.test(value)) {
    value = `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join a row of already-stringified fields into one escaped CSV record. */
export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * Format an aggregate score for a data cell: empty when the review was never
 * scored (never a fabricated 0 or an em-dash placeholder — a numeric data
 * column stays clean and honest, Rules.md §6).
 */
export function formatAggregateCell(score: number | null): string {
  return score === null ? "" : score.toFixed(1);
}

/** Replace any unsafe filename character with a hyphen. */
export function sanitizeFilenamePart(part: string): string {
  return part.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * Format a `Date` as `YYYY-MM-DD` from its UTC parts (deterministic across
 * locales/timezones), for use in a download filename.
 */
export function utcDateStamp(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
