/**
 * Pure PDF serialization for a single review (DailyPlan Day 38 — PDF: single
 * review; Day 39 — PDF polish). Turns a reconstructed `PersistedReview` into a
 * valid, downloadable, *enterprise-credible* PDF document (PDF 1.4) plus a safe
 * download filename.
 *
 * Hand-rolled with no new dependency, mirroring the hand-rolled CSV serializer
 * (Day 36) and the stack's stated preference for framework-native / standard
 * solutions over new packages (Rules.md §2; Architecture.md §1 lists CSV as
 * "hand-rolled"). PDF is a simple enough text format for a single-column report
 * built from one of the 14 standard fonts (Helvetica / Helvetica-Bold — no font
 * embedding), so a small, fully-testable generator is cheaper and lighter than
 * pulling in a rendering library. Day 39's polish (colour, logo, layout) is all
 * vector `re`/`f` rectangles + text, so it still needs no font embedding and no
 * image XObject — the document stays ASCII-only and byte-offset-exact.
 *
 * Kept pure (no Next / DB), like the other `src/lib/reviews/*` serializers, so
 * the layout, pagination, and byte assembly are unit-testable in the node test
 * env. The download route (`/api/reviews/[id]/export?format=pdf`) only resolves
 * the tenant-scoped review via the existing Day 6 read core and wires the bytes
 * + headers.
 *
 * Day 39 (PDF polish) applies the Design.md system to the Day 38 report:
 *  - a navy header band with a vector "AdJury" wordmark (monogram + name) — the
 *    brand logo, drawn as shapes so nothing is embedded;
 *  - **colour-coded verdict pills and score chips** using the exact Design.md
 *    palette and the *same* score→tone / verdict→tone mapping the on-screen
 *    scorecard uses (`scorecard-view.ts`), so a printed report reads like the
 *    web one. Meaning is never carried by colour alone (Design.md §6): every
 *    pill/chip still contains its word (verdict, tier, confidence), and white
 *    text on the dark tone fills clears WCAG AA contrast;
 *  - section rules, a per-juror accent underline in that juror's score tone,
 *    and a footer with page numbers.
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
  jurorScoreTone,
  scoreTierLabel,
  scoreTone,
  severityLabel,
  summarizeJurorHealth,
  verdictLabel,
  verdictTone,
  type Tone,
} from "@/lib/reviews/scorecard-view";
import { sanitizeFilenamePart, utcDateStamp } from "@/lib/reviews/csv";

// ── Page geometry (US Letter, in PDF points — 1pt = 1/72in) ────────────────
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54; // 0.75in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 504

// Header band / footer furniture (Day 39 layout).
const HEADER_H = 76; // tall brand band on page 1
const SLIM_HEADER_H = 30; // slim running band on later pages
const FOOTER_H = 28; // reserved strip for the footer rule + page number

type Rgb = [number, number, number];

/** Build an Rgb (0–1 components) from a `#rrggbb` hex string. */
function hex(value: string): Rgb {
  const n = parseInt(value.replace("#", ""), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

// Design.md palette (mirrors tailwind.config.ts / Design.md §2).
const NAVY = hex("#0A1F44");
const ROYAL = hex("#1E40AF");
const ROYAL_BRIGHT = hex("#2563EB");
const WHITE: Rgb = [1, 1, 1];
const BODY = hex("#344054"); // slate-700 body text
const MUTED = hex("#667085"); // slate-500 secondary/metadata text
const BORDER = hex("#E4E7EC"); // slate-200 rules/dividers
const SLATE_200 = hex("#E4E7EC"); // on-navy secondary text

// Semantic tones (Design.md §5 score/verdict colour system).
const TONE_COLORS: Record<Tone, Rgb> = {
  success: hex("#15803D"),
  royal: ROYAL,
  warning: hex("#B45309"),
  "warning-deep": hex("#9A3412"),
  danger: hex("#B91C1C"),
  burgundy: hex("#6B1F2A"),
  neutral: MUTED,
};

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
    .replace(/[‘’‚′]/g, "'") // ‘ ’ ‚ ′ → '
    .replace(/[“”„″]/g, '"') // “ ” „ ″ → "
    .replace(/[–—−]/g, "-") // – — − → -
    .replace(/…/g, "...") // … → ...
    .replace(/[   ]/g, " ") // nbsp / figure / narrow nbsp → space
    .replace(/[•·]/g, "-") // • · → -
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

/**
 * One laid-out item, before pagination assigns it a y-coordinate. A `text`
 * block is a single wrapped line; a `rule` block is a full-width hairline
 * divider that occupies a small slice of vertical space.
 */
interface Block {
  kind: "text" | "rule";
  text: string;
  size: number;
  bold: boolean;
  color: Rgb;
  /** Optional chip/pill fill drawn behind this line's text (score/verdict). */
  fill: Rgb | null;
  /**
   * Optional underline accent drawn just under this line. `full` spans the
   * content width (section rules); otherwise it spans only the text width
   * (a juror-name accent in that juror's score tone).
   */
  underline: Rgb | null;
  underlineFull: boolean;
  /** Extra vertical space (points) before this block. */
  gapBefore: number;
}

/** A low-level draw primitive placed at an absolute position on a page. */
type Prim =
  | { kind: "text"; x: number; y: number; text: string; size: number; bold: boolean; color: Rgb }
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: Rgb };

const BODY_SIZE = 10;
const LINE_GAP = 4; // leading added to font size
const CHIP_PAD_X = 7; // horizontal padding inside a chip/pill

/** A small builder that wraps and appends blocks to the document model. */
class BlockList {
  readonly blocks: Block[] = [];

  add(
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: Rgb;
      fill?: Rgb | null;
      underline?: Rgb | null;
      underlineFull?: boolean;
      gapBefore?: number;
    } = {},
  ): void {
    const size = opts.size ?? BODY_SIZE;
    const bold = opts.bold ?? false;
    const color = opts.color ?? BODY;
    const fill = opts.fill ?? null;
    const underline = opts.underline ?? null;
    const underlineFull = opts.underlineFull ?? false;
    const gapBefore = opts.gapBefore ?? 0;
    const wrapped = wrapParagraph(
      sanitizePdfText(text),
      // A chip/pill is padded, so wrap its text to a slightly narrower box.
      fill ? CONTENT_WIDTH - CHIP_PAD_X * 2 : CONTENT_WIDTH,
      size,
      bold,
    );
    wrapped.forEach((line, i) => {
      this.blocks.push({
        kind: "text",
        text: line,
        size,
        bold,
        color,
        fill,
        underline,
        underlineFull,
        gapBefore: i === 0 ? gapBefore : 0,
      });
    });
  }

  /** A full-width hairline divider (Design.md §4: borders over shadows). */
  addRule(gapBefore = 10, color: Rgb = BORDER): void {
    this.blocks.push({
      kind: "rule",
      text: "",
      size: 1,
      bold: false,
      color,
      fill: null,
      underline: null,
      underlineFull: false,
      gapBefore,
    });
  }
}

/** Build the ordered document model (wrapped lines) for a review. */
function buildReviewBlocks(review: PersistedReview): Block[] {
  const list = new BlockList();

  // Metadata (the title/logo now lives in the header band — Day 39).
  list.add(`Review ID: ${review.review_id}`, { size: 9, color: MUTED });
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

  list.addRule(12);

  // Verdict pill + aggregate score chip — colour-coded, Design.md §5. Each is
  // a filled pill/chip with its word inside, so meaning never rides on colour
  // alone (Design.md §6); white text on the dark tone fills clears AA contrast.
  list.add(`Verdict: ${verdictLabel(review.verdict)}`, {
    size: 13,
    bold: true,
    color: WHITE,
    fill: TONE_COLORS[verdictTone(review.verdict)],
    gapBefore: 16,
  });
  const aggregate = formatAggregate(review.aggregate_score);
  const scoreTier =
    review.aggregate_score === null
      ? ""
      : ` (${scoreTierLabel(review.aggregate_score)})`;
  const aggregateTone: Tone =
    review.aggregate_score === null ? "neutral" : scoreTone(review.aggregate_score);
  list.add(`Aggregate score: ${aggregate} / 10${scoreTier}`, {
    size: 11,
    bold: true,
    color: WHITE,
    fill: TONE_COLORS[aggregateTone],
    gapBefore: 10,
  });

  // Degraded-review notice (reuse the scorecard's health logic — Rules.md §6:
  // an errored juror is surfaced, never shown as a fake score). Coloured by its
  // tone (warning/danger) rather than muted grey so it reads as a real flag.
  const notice = jurorHealthNotice(summarizeJurorHealth(review.jurors));
  if (notice) {
    list.add(`Note: ${notice.message}`, {
      size: 9,
      color: TONE_COLORS[notice.tone],
      gapBefore: 12,
    });
  }

  // Submitted content.
  list.add("Submitted content", {
    size: 13,
    bold: true,
    color: NAVY,
    underline: BORDER,
    underlineFull: true,
    gapBefore: 22,
  });
  list.add(review.content_text.trim().length > 0 ? review.content_text : "(empty)", {
    gapBefore: 10,
  });

  // Jurors.
  list.add("Juror reviews", {
    size: 13,
    bold: true,
    color: NAVY,
    underline: BORDER,
    underlineFull: true,
    gapBefore: 22,
  });
  if (review.jurors.length === 0) {
    list.add("No juror results were recorded for this review.", { gapBefore: 10 });
  }
  review.jurors.forEach((juror, index) => {
    if (index > 0) list.addRule(14);
    const label = PERSONA_LABELS[juror.persona] ?? juror.persona;
    // Juror name underlined in its own score tone — a compliance flag reads
    // Burgundy, an errored slot neutral (jurorScoreTone handles the override).
    list.add(label, {
      size: 12,
      bold: true,
      color: NAVY,
      underline: TONE_COLORS[jurorScoreTone(juror)],
      gapBefore: 16,
    });

    if (juror.status === "ok") {
      // Score chip (colour-coded + tier word), then confidence as quiet text.
      list.add(
        `Score: ${juror.score} / 10 (${scoreTierLabel(juror.score)})  -  ${capitalize(juror.confidence)} confidence`,
        {
          size: 9,
          bold: true,
          color: WHITE,
          fill: TONE_COLORS[jurorScoreTone(juror)],
          gapBefore: 8,
        },
      );
      list.add(juror.summary, { gapBefore: 8 });

      if (juror.issues.length > 0) {
        list.add(`Issues (${juror.issues.length})`, { bold: true, color: NAVY, gapBefore: 8 });
        juror.issues.forEach((issue) => {
          list.add(
            `- ${severityLabel(issue.severity)}: "${issue.excerpt}" - ${issue.explanation}`,
            { gapBefore: 2 },
          );
        });
      } else {
        list.add("Issues: none flagged.", { color: MUTED, gapBefore: 8 });
      }

      list.add("Suggested rewrite", { bold: true, color: NAVY, gapBefore: 8 });
      list.add(juror.suggested_rewrite, { gapBefore: 2 });
    } else {
      // Errored juror: surface the failure, never a fabricated score.
      list.add("Status: Could not be scored", { size: 9, color: MUTED, gapBefore: 8 });
      list.add(juror.error, { gapBefore: 6 });
    }
  });

  return list.blocks;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

// ── Pagination ───────────────────────────────────────────────────────────

/** The first content baseline on a given page (below the header band). */
function contentTopForPage(pageIndex: number): number {
  const band = pageIndex === 0 ? HEADER_H : SLIM_HEADER_H;
  return PAGE_HEIGHT - band - (pageIndex === 0 ? 24 : 20);
}

/** The lowest a content baseline may sit before the footer strip. */
const CONTENT_BOTTOM = MARGIN + FOOTER_H;

/**
 * Flow the document blocks into pages, breaking when vertical space runs out.
 * Emits the chip/pill fills and underline accents as rectangles interleaved
 * with the text, so every decoration paginates with its line.
 */
function paginate(blocks: Block[]): Prim[][] {
  const pages: Prim[][] = [];
  let pageIndex = 0;
  let current: Prim[] = [];
  let y = contentTopForPage(pageIndex);

  for (const block of blocks) {
    const lineHeight = block.size + LINE_GAP;
    y -= block.gapBefore;
    if (y - lineHeight < CONTENT_BOTTOM) {
      // Out of room — start a new page. Drop the leading gap at the page top.
      pages.push(current);
      current = [];
      pageIndex += 1;
      y = contentTopForPage(pageIndex);
    }
    y -= lineHeight;

    if (block.kind === "rule") {
      current.push({ kind: "rect", x: MARGIN, y: y + 2, w: CONTENT_WIDTH, h: 0.7, color: block.color });
      continue;
    }

    if (block.text.length === 0) continue; // blank spacer line — nothing to draw

    const textWidth = measureWidth(block.text, block.size, block.bold);

    if (block.fill) {
      // A pill/chip: fill sits behind the text, text inset by the padding.
      const top = block.size * 0.75 + 3;
      const bottom = block.size * 0.3;
      current.push({
        kind: "rect",
        x: MARGIN,
        y: y - bottom,
        w: textWidth + CHIP_PAD_X * 2,
        h: top + bottom,
        color: block.fill,
      });
      current.push({
        kind: "text",
        x: MARGIN + CHIP_PAD_X,
        y,
        text: block.text,
        size: block.size,
        bold: block.bold,
        color: block.color,
      });
    } else {
      current.push({
        kind: "text",
        x: MARGIN,
        y,
        text: block.text,
        size: block.size,
        bold: block.bold,
        color: block.color,
      });
    }

    if (block.underline) {
      current.push({
        kind: "rect",
        x: MARGIN,
        y: y - 5,
        w: block.underlineFull ? CONTENT_WIDTH : textWidth,
        h: 0.8,
        color: block.underline,
      });
    }
  }

  pages.push(current);
  return pages;
}

// ── Page furniture (header band + footer) ───────────────────────────────────

/** Draw the brand wordmark (monogram box + "AdJury") inside the header band. */
function brandWordmark(prims: Prim[], bandBottom: number, bandHeight: number, big: boolean): void {
  const boxSize = big ? 34 : 20;
  const boxY = bandBottom + (bandHeight - boxSize) / 2;
  // Monogram tile (royal-bright on navy) with white "AJ".
  prims.push({ kind: "rect", x: MARGIN, y: boxY, w: boxSize, h: boxSize, color: ROYAL_BRIGHT });
  const ajSize = big ? 16 : 10;
  const ajWidth = measureWidth("AJ", ajSize, true);
  prims.push({
    kind: "text",
    x: MARGIN + (boxSize - ajWidth) / 2,
    y: boxY + (boxSize - ajSize * 0.72) / 2,
    text: "AJ",
    size: ajSize,
    bold: true,
    color: WHITE,
  });
  // Wordmark.
  const nameSize = big ? 22 : 13;
  const nameX = MARGIN + boxSize + (big ? 14 : 10);
  const center = bandBottom + bandHeight / 2;
  prims.push({
    kind: "text",
    x: nameX,
    y: big ? center + 2 : center - nameSize * 0.72 / 2 + 1,
    text: "AdJury",
    size: nameSize,
    bold: true,
    color: WHITE,
  });
  if (big) {
    prims.push({
      kind: "text",
      x: nameX,
      y: center - 14,
      text: "Content review report",
      size: 10,
      bold: false,
      color: SLATE_200,
    });
  }
}

/** The header band for a page (tall brand band on page 1, slim band after). */
function headerPrims(pageIndex: number): Prim[] {
  const prims: Prim[] = [];
  const bandHeight = pageIndex === 0 ? HEADER_H : SLIM_HEADER_H;
  const bandBottom = PAGE_HEIGHT - bandHeight;
  prims.push({ kind: "rect", x: 0, y: bandBottom, w: PAGE_WIDTH, h: bandHeight, color: NAVY });
  brandWordmark(prims, bandBottom, bandHeight, pageIndex === 0);
  if (pageIndex > 0) {
    const label = "Review report";
    const size = 9;
    prims.push({
      kind: "text",
      x: PAGE_WIDTH - MARGIN - measureWidth(label, size, false),
      y: bandBottom + bandHeight / 2 - size * 0.72 / 2 + 1,
      text: label,
      size,
      bold: false,
      color: SLATE_200,
    });
  }
  return prims;
}

/** The footer for a page: a hairline rule, a wordmark note, and a page number. */
function footerPrims(pageIndex: number, totalPages: number): Prim[] {
  const prims: Prim[] = [];
  const ruleY = MARGIN + 16;
  prims.push({ kind: "rect", x: MARGIN, y: ruleY, w: CONTENT_WIDTH, h: 0.6, color: BORDER });
  const baseline = MARGIN + 4;
  prims.push({
    kind: "text",
    x: MARGIN,
    y: baseline,
    text: "AdJury - AI content review",
    size: 8,
    bold: false,
    color: MUTED,
  });
  const pageLabel = `Page ${pageIndex + 1} of ${totalPages}`;
  prims.push({
    kind: "text",
    x: PAGE_WIDTH - MARGIN - measureWidth(pageLabel, 8, false),
    y: baseline,
    text: pageLabel,
    size: 8,
    bold: false,
    color: MUTED,
  });
  return prims;
}

// ── PDF byte assembly ──────────────────────────────────────────────────────

/** Format a number for the content stream (trim to at most 2 decimals). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** A fill-colour operator (also sets the fill colour used by text `Tj`). */
function colorOp(color: Rgb): string {
  return `${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])} rg`;
}

/**
 * Render one page's primitives into a content-stream body. Rectangles (fills,
 * chips, rules) are emitted first so text always paints on top of its chip.
 */
function renderContentStream(prims: Prim[]): string {
  const parts: string[] = [];
  let lastColor: string | null = null;

  const setColor = (color: Rgb) => {
    const op = colorOp(color);
    if (op !== lastColor) {
      parts.push(op);
      lastColor = op;
    }
  };

  for (const p of prims) {
    if (p.kind !== "rect") continue;
    setColor(p.color);
    parts.push(`${fmt(p.x)} ${fmt(p.y)} ${fmt(p.w)} ${fmt(p.h)} re`);
    parts.push("f");
  }
  for (const p of prims) {
    if (p.kind !== "text" || p.text.length === 0) continue;
    const font = p.bold ? "/F2" : "/F1";
    parts.push("BT");
    parts.push(`${font} ${p.size} Tf`);
    setColor(p.color);
    parts.push(`${fmt(p.x)} ${fmt(p.y)} Td`);
    parts.push(`(${escapePdfString(p.text)}) Tj`);
    parts.push("ET");
  }
  return parts.join("\n");
}

/**
 * Serialize a review to a complete PDF document string. ASCII-only; the route
 * emits it as a latin1 buffer so byte offsets match. The cross-reference table
 * is built from running byte offsets so the document is spec-valid.
 */
export function reviewToPdf(review: PersistedReview): string {
  const contentPages = paginate(buildReviewBlocks(review));
  const totalPages = contentPages.length;
  // Compose each page's furniture (header band + footer) around its content.
  const pages = contentPages.map((content, i) => [
    ...headerPrims(i),
    ...content,
    ...footerPrims(i, totalPages),
  ]);

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
  pages.forEach((prims, i) => {
    const stream = renderContentStream(prims);
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
