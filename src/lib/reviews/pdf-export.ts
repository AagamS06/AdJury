/**
 * Pure PDF serialization for a single review (DailyPlan Day 38 — PDF: single
 * review). Turns a reconstructed `PersistedReview` into a valid, downloadable
 * PDF document (PDF 1.4) plus a safe download filename.
 *
 * Hand-rolled with no new dependency, mirroring the hand-rolled CSV serializer
 * (Day 36) and the stack's stated preference for framework-native / standard
 * solutions over new packages (Rules.md §2; Architecture.md §1 lists CSV as
 * "hand-rolled"). PDF is a simple enough text format for a single-column report
 * built from one of the 14 standard fonts (Helvetica / Helvetica-Bold — no font
 * embedding), so a small, fully-testable generator is cheaper and lighter than
 * pulling in a rendering library.
 *
 * Kept pure (no Next / DB), like the other `src/lib/reviews/*` serializers, so
 * the layout, pagination, and byte assembly are unit-testable in the node test
 * env. The download route (`/api/reviews/[id]/export?format=pdf`) only resolves
 * the tenant-scoped review via the existing Day 6 read core and wires the bytes
 * + headers.
 *
 * Scope note (Day 38 vs Day 39): this day produces a *legible, correctly
 * structured, valid* PDF — metadata, aggregate + verdict, a degraded-review
 * notice, the submitted content, and one section per juror (score, confidence,
 * summary, issues, suggested rewrite), paginated so nothing is clipped. The
 * full Design.md palette (colour-coded score chips / verdict pills), the logo,
 * and refined layout are **Day 39 (PDF polish)** and are deliberately not
 * pulled forward; the only brand touch here is a navy document title.
 *
 * Output is ASCII-only by construction: non-ASCII input (smart quotes, dashes,
 * accents) is transliterated or dropped during sanitization. This keeps every
 * byte single-width so the cross-reference table offsets (which are byte
 * offsets) equal string indices — the route emits the string as a latin1 buffer
 * so no UTF-8 re-encoding shifts them.
 */
import {
  formatHistoryDate,
  contentTypeLabel,
  platformLabel,
} from "@/lib/reviews/history-view";
import { PERSONA_LABELS } from "@/lib/reviews/review-form";
import type { PersistedReview } from "@/lib/reviews/read-reviews";
import {
  formatAggregate,
  jurorHealthNotice,
  scoreTierLabel,
  severityLabel,
  summarizeJurorHealth,
  verdictLabel,
} from "@/lib/reviews/scorecard-view";
import { sanitizeFilenamePart, utcDateStamp } from "@/lib/reviews/csv";

// ── Page geometry (US Letter, in PDF points — 1pt = 1/72in) ────────────────
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54; // 0.75in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 504

// Navy (#0A1F44) for the document title — the one brand touch (see scope note).
const NAVY: Rgb = [0x0a / 255, 0x1f / 255, 0x44 / 255];
const BLACK: Rgb = [0, 0, 0];
// Slate-500 (#667085) for secondary/metadata text.
const MUTED: Rgb = [0x66 / 255, 0x70 / 255, 0x85 / 255];

type Rgb = [number, number, number];

/**
 * Helvetica glyph advance widths (units per 1000-em), ASCII 32–126. Used to
 * wrap text to the content width accurately rather than guessing by character
 * count. Helvetica-Bold is a touch wider; a small safety factor (see
 * `measureWidth`) covers bold headings without a second table.
 */
const HELVETICA_WIDTHS: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
  88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
  96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260,
  125: 334, 126: 584,
};

/** Fallback advance for any char not in the table (shouldn't happen post-sanitize). */
const DEFAULT_WIDTH = 556;

/**
 * Sanitize text to printable ASCII (plus newlines), transliterating the common
 * Unicode punctuation that marketing content carries (smart quotes, en/em
 * dashes, ellipsis, non-breaking spaces, bullets) to ASCII equivalents and
 * dropping anything else. Keeping the output single-byte guarantees the xref
 * byte offsets equal string indices.
 */
export function sanitizePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[•·]/g, "-")
    .replace(/\t/g, "    ")
    .replace(/[^\x20-\x7E\n]/g, "");
}

/** Escape a (already-sanitized) string for a PDF literal string: \ ( ) . */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Measure a sanitized string's rendered width in points. */
function measureWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (let i = 0; i < text.length; i += 1) {
    units += HELVETICA_WIDTHS[text.charCodeAt(i)] ?? DEFAULT_WIDTH;
  }
  // Helvetica-Bold runs ~5% wider than the regular metrics we table; pad so a
  // bold heading never overflows the content box.
  const factor = bold ? 1.05 : 1;
  return (units / 1000) * size * factor;
}

/**
 * Greedy word-wrap a single (newline-free) line to `maxWidth`. A single word
 * wider than the box is hard-broken by characters so nothing ever overflows.
 * An empty input yields a single empty line (preserving blank paragraph lines).
 */
export function wrapLine(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let current = "";

  const pushWord = (word: string) => {
    let candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measureWidth(candidate, size, bold) <= maxWidth) {
      current = candidate;
      return;
    }
    // Doesn't fit on the current line.
    if (current.length > 0) {
      lines.push(current);
      current = "";
      candidate = word;
    }
    if (measureWidth(word, size, bold) <= maxWidth) {
      current = word;
      return;
    }
    // A single word is too wide — hard-break it by characters.
    let chunk = "";
    for (const ch of word) {
      if (measureWidth(chunk + ch, size, bold) <= maxWidth) {
        chunk += ch;
      } else {
        if (chunk.length > 0) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  };

  for (const word of text.split(" ")) pushWord(word);
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * Wrap a (possibly multi-line) paragraph: split on newlines, then word-wrap
 * each segment. A blank segment is preserved as an empty line.
 */
function wrapParagraph(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
): string[] {
  return text
    .split("\n")
    .flatMap((segment) => wrapLine(segment, maxWidth, size, bold));
}

// ── Document model ─────────────────────────────────────────────────────────

/** One laid-out text line, before pagination assigns it a y-coordinate. */
interface Block {
  text: string;
  size: number;
  bold: boolean;
  color: Rgb;
  /** Extra vertical space (points) before this block. */
  gapBefore: number;
}

/** A text draw operation at an absolute position on a page. */
interface DrawOp {
  x: number;
  y: number;
  text: string;
  size: number;
  bold: boolean;
  color: Rgb;
}

const BODY_SIZE = 10;
const LINE_GAP = 4; // leading added to font size

/** A small builder that wraps and appends blocks to the document model. */
class BlockList {
  readonly blocks: Block[] = [];

  add(
    text: string,
    opts: { size?: number; bold?: boolean; color?: Rgb; gapBefore?: number } = {},
  ): void {
    const size = opts.size ?? BODY_SIZE;
    const bold = opts.bold ?? false;
    const color = opts.color ?? BLACK;
    const gapBefore = opts.gapBefore ?? 0;
    const wrapped = wrapParagraph(
      sanitizePdfText(text),
      CONTENT_WIDTH,
      size,
      bold,
    );
    wrapped.forEach((line, i) => {
      this.blocks.push({
        text: line,
        size,
        bold,
        color,
        gapBefore: i === 0 ? gapBefore : 0,
      });
    });
  }
}

/** Build the ordered document model (wrapped lines) for a review. */
function buildReviewBlocks(review: PersistedReview): Block[] {
  const list = new BlockList();

  // Title (the one brand touch — navy; full palette/logo is Day 39).
  list.add("AdJury - Review Report", { size: 20, bold: true, color: NAVY });

  // Metadata.
  list.add(`Review ID: ${review.review_id}`, {
    size: 9,
    color: MUTED,
    gapBefore: 12,
  });
  list.add(`Date: ${formatHistoryDate(review.created_at)}`, {
    size: 9,
    color: MUTED,
  });
  list.add(`Content type: ${contentTypeLabel(review.content_type)}`, {
    size: 9,
    color: MUTED,
  });
  list.add(`Platform: ${platformLabel(review.platform) ?? "Not specified"}`, {
    size: 9,
    color: MUTED,
  });

  // Verdict + aggregate.
  const aggregate = formatAggregate(review.aggregate_score);
  const scoreTier =
    review.aggregate_score === null
      ? ""
      : ` (${scoreTierLabel(review.aggregate_score)})`;
  list.add(`Verdict: ${verdictLabel(review.verdict)}`, {
    size: 13,
    bold: true,
    gapBefore: 16,
  });
  list.add(`Aggregate score: ${aggregate} / 10${scoreTier}`, {
    size: 11,
    gapBefore: 2,
  });

  // Degraded-review notice (reuse the scorecard's health logic — Rules.md §6:
  // an errored juror is surfaced, never shown as a fake score).
  const notice = jurorHealthNotice(summarizeJurorHealth(review.jurors));
  if (notice) {
    list.add(`Note: ${notice.message}`, { size: 9, color: MUTED, gapBefore: 8 });
  }

  // Submitted content.
  list.add("Submitted content", { size: 13, bold: true, color: NAVY, gapBefore: 20 });
  list.add(review.content_text.trim().length > 0 ? review.content_text : "(empty)", {
    gapBefore: 6,
  });

  // Jurors.
  list.add("Juror reviews", { size: 13, bold: true, color: NAVY, gapBefore: 20 });
  if (review.jurors.length === 0) {
    list.add("No juror results were recorded for this review.", { gapBefore: 6 });
  }
  review.jurors.forEach((juror) => {
    const label = PERSONA_LABELS[juror.persona] ?? juror.persona;
    list.add(label, { size: 12, bold: true, gapBefore: 16 });

    if (juror.status === "ok") {
      list.add(
        `Score: ${juror.score} / 10 (${scoreTierLabel(juror.score)})  -  ${capitalize(juror.confidence)} confidence`,
        { size: 9, color: MUTED, gapBefore: 2 },
      );
      list.add(juror.summary, { gapBefore: 6 });

      if (juror.issues.length > 0) {
        list.add(`Issues (${juror.issues.length})`, { bold: true, gapBefore: 8 });
        juror.issues.forEach((issue) => {
          list.add(
            `- ${severityLabel(issue.severity)}: "${issue.excerpt}" - ${issue.explanation}`,
            { gapBefore: 2 },
          );
        });
      } else {
        list.add("Issues: none flagged.", { color: MUTED, gapBefore: 8 });
      }

      list.add("Suggested rewrite", { bold: true, gapBefore: 8 });
      list.add(juror.suggested_rewrite, { gapBefore: 2 });
    } else {
      // Errored juror: surface the failure, never a fabricated score.
      list.add("Status: Could not be scored", { size: 9, color: MUTED, gapBefore: 2 });
      list.add(juror.error, { gapBefore: 6 });
    }
  });

  return list.blocks;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

// ── Pagination ───────────────────────────────────────────────────────────

/** Flow the document blocks into pages, breaking when vertical space runs out. */
function paginate(blocks: Block[]): DrawOp[][] {
  const pages: DrawOp[][] = [];
  let current: DrawOp[] = [];
  const top = PAGE_HEIGHT - MARGIN;
  let y = top;

  for (const block of blocks) {
    const lineHeight = block.size + LINE_GAP;
    y -= block.gapBefore;
    if (y - lineHeight < MARGIN) {
      // Out of room — start a new page. Drop the leading gap at the page top.
      pages.push(current);
      current = [];
      y = top;
    }
    y -= lineHeight;
    current.push({
      x: MARGIN,
      y,
      text: block.text,
      size: block.size,
      bold: block.bold,
      color: block.color,
    });
  }

  pages.push(current);
  return pages;
}

// ── PDF byte assembly ──────────────────────────────────────────────────────

/** Render one page's draw ops into a content-stream body. */
function renderContentStream(ops: DrawOp[]): string {
  const parts: string[] = [];
  let lastColor: string | null = null;
  for (const op of ops) {
    if (op.text.length === 0) continue; // blank spacer line — nothing to draw
    const font = op.bold ? "/F2" : "/F1";
    const color = `${fmt(op.color[0])} ${fmt(op.color[1])} ${fmt(op.color[2])} rg`;
    parts.push("BT");
    parts.push(`${font} ${op.size} Tf`);
    if (color !== lastColor) {
      parts.push(color);
      lastColor = color;
    }
    parts.push(`${fmt(op.x)} ${fmt(op.y)} Td`);
    parts.push(`(${escapePdfString(op.text)}) Tj`);
    parts.push("ET");
  }
  return parts.join("\n");
}

/** Format a number for the content stream (trim to at most 2 decimals). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Serialize a review to a complete PDF document string. ASCII-only; the route
 * emits it as a latin1 buffer so byte offsets match. The cross-reference table
 * is built from running byte offsets so the document is spec-valid.
 */
export function reviewToPdf(review: PersistedReview): string {
  const pages = paginate(buildReviewBlocks(review));

  // Object numbering: 1 Catalog, 2 Pages, 3 F1 (Helvetica), 4 F2 (Helvetica-Bold),
  // then for each page i (0-based): page object (5 + 2i), content object (6 + 2i).
  const pageObjNum = (i: number) => 5 + 2 * i;
  const contentObjNum = (i: number) => 6 + 2 * i;
  const totalObjects = 4 + pages.length * 2;

  const offsets: number[] = new Array(totalObjects + 1).fill(0);
  let pdf = "%PDF-1.4\n";

  const addObject = (num: number, body: string): void => {
    offsets[num] = pdf.length;
    pdf += `${num} 0 obj\n${body}\nendobj\n`;
  };

  // 1: Catalog
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");

  // 2: Pages
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");
  addObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  // 3 & 4: standard fonts (no embedding; WinAnsi so ASCII renders as itself).
  addObject(
    3,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  addObject(
    4,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  // Page + content objects.
  pages.forEach((ops, i) => {
    const stream = renderContentStream(ops);
    addObject(
      pageObjNum(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>`,
    );
    addObject(
      contentObjNum(i),
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  // Cross-reference table + trailer.
  const xrefStart = pdf.length;
  const size = totalObjects + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return pdf;
}

/**
 * A safe, descriptive download filename for a single review's PDF, e.g.
 * `adjury-review-<id>-2026-10-01.pdf`. The date (UTC) is omitted if
 * `created_at` is unparseable, so the name never contains "NaN" (mirrors
 * `reviewCsvFilename`).
 */
export function reviewPdfFilename(review: PersistedReview): string {
  const id = sanitizeFilenamePart(review.review_id) || "review";
  const parsed = new Date(review.created_at);
  if (Number.isNaN(parsed.getTime())) {
    return `adjury-review-${id}.pdf`;
  }
  return `adjury-review-${id}-${utcDateStamp(parsed)}.pdf`;
}
