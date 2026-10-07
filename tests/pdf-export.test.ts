import { describe, it, expect } from "vitest";
import {
  reviewPdfFilename,
  reviewToPdf,
  sanitizePdfText,
  wrapLine,
} from "@/lib/reviews/pdf-export";
import type { PersistedReview } from "@/lib/reviews/read-reviews";
import type { JurorSlot } from "@/lib/schema/juror";

/**
 * PDF: single review (DailyPlan Day 38). Pins the pure serialization — text
 * sanitization, width-aware wrapping, the errored-juror (no fake score)
 * handling, filename building — and proves the output is a *structurally valid*
 * PDF: the cross-reference byte offsets point at the right objects, the trailer
 * agrees with the object count, and the rendered text contains the review's
 * data. The download route's tenancy is the Day 6 read core, already proven in
 * tests/reviews-read.test.ts.
 */

const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

function okJuror(overrides: Partial<Extract<JurorSlot, { status?: "ok" }>> = {}): JurorSlot {
  return {
    persona: "brand_voice_guardian",
    status: "ok",
    score: 8,
    confidence: "high",
    summary: "On-brand and confident.",
    issues: [],
    suggested_rewrite: "One of the most effective tools we've tested.",
    ...overrides,
  } as JurorSlot;
}

function review(overrides: Partial<PersistedReview> = {}): PersistedReview {
  return {
    review_id: REVIEW_ID,
    content_type: "ad_copy",
    platform: "instagram",
    created_at: "2026-10-01T12:00:00.000Z",
    aggregate_score: 7.2,
    verdict: "revise",
    content_text: "Buy our thing today.",
    jurors: [okJuror()],
    ...overrides,
  };
}

// ── A tiny structural PDF validator ────────────────────────────────────────

/**
 * Parse the cross-reference table and assert every in-use entry's byte offset
 * points at the start of the matching `N 0 obj`. Also checks the header,
 * trailer `/Size`, and that `startxref` points at the `xref` keyword.
 */
function assertValidPdf(pdf: string): { objectCount: number; text: string } {
  expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

  const startxrefMatch = pdf.match(/startxref\n(\d+)\n%%EOF/);
  expect(startxrefMatch).not.toBeNull();
  const xrefStart = Number(startxrefMatch![1]);
  expect(pdf.slice(xrefStart, xrefStart + 4)).toBe("xref");

  // `xref\n0 SIZE\n` then SIZE 20-byte entries.
  const headerMatch = pdf.slice(xrefStart).match(/^xref\n0 (\d+)\n/);
  expect(headerMatch).not.toBeNull();
  const size = Number(headerMatch![1]);
  const entriesStart = xrefStart + headerMatch![0].length;

  // Entry 0 is the free head; entries 1..size-1 are in-use objects.
  for (let i = 1; i < size; i += 1) {
    const entry = pdf.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20);
    expect(entry).toMatch(/^\d{10} 00000 n \n$/);
    expect(entry.length).toBe(20);
    const offset = Number(entry.slice(0, 10));
    expect(pdf.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
  }

  const trailerMatch = pdf.match(/\/Size (\d+) \/Root 1 0 R/);
  expect(trailerMatch).not.toBeNull();
  expect(Number(trailerMatch![1])).toBe(size);

  return { objectCount: size - 1, text: extractText(pdf) };
}

/** Pull back the visible text by de-escaping every `(...) Tj` literal. */
function extractText(pdf: string): string {
  const out: string[] = [];
  const re = /\((.*?)\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf)) !== null) {
    out.push(m[1].replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\"));
  }
  return out.join("\n");
}

/** Count page objects (`/Type /Page ` with a /Parent — not the /Pages tree). */
function countPages(pdf: string): number {
  return (pdf.match(/\/Type \/Page \/Parent/g) ?? []).length;
}

// ── sanitizePdfText ─────────────────────────────────────────────────────────

describe("sanitizePdfText", () => {
  it("transliterates common Unicode punctuation to ASCII", () => {
    expect(sanitizePdfText("“smart” ‘quotes’")).toBe('"smart" \'quotes\'');
    expect(sanitizePdfText("en–dash em—dash")).toBe("en-dash em-dash");
    expect(sanitizePdfText("wait…")).toBe("wait...");
    expect(sanitizePdfText("a b")).toBe("a b");
    expect(sanitizePdfText("• bullet")).toBe("- bullet");
  });

  it("drops remaining non-ASCII but keeps newlines, yielding single-byte output", () => {
    const out = sanitizePdfText("café 😀\nnext");
    expect(out).toBe("caf \nnext");
    // Every character is single-byte so xref byte offsets equal string indices.
    for (let i = 0; i < out.length; i += 1) {
      expect(out.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it("normalizes CRLF and tabs", () => {
    expect(sanitizePdfText("a\r\nb\tc")).toBe("a\nb    c");
  });
});

// ── wrapLine ─────────────────────────────────────────────────────────────

describe("wrapLine", () => {
  it("keeps short text on one line", () => {
    expect(wrapLine("hello world", 504, 10, false)).toEqual(["hello world"]);
  });

  it("wraps long text to multiple lines within the width budget", () => {
    const text = "word ".repeat(80).trim();
    const lines = wrapLine(text, 504, 10, false);
    expect(lines.length).toBeGreaterThan(1);
    // No reconstructed line should obviously blow past a generous char budget.
    for (const line of lines) expect(line.length).toBeLessThan(120);
    // Round-trips to the same words (wrapping only changes spacing).
    expect(lines.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("hard-breaks a single word wider than the box", () => {
    const giant = "x".repeat(400);
    const lines = wrapLine(giant, 504, 10, false);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(giant);
  });

  it("preserves an empty line", () => {
    expect(wrapLine("", 504, 10, false)).toEqual([""]);
  });
});

// ── reviewToPdf ─────────────────────────────────────────────────────────

describe("reviewToPdf", () => {
  it("produces a structurally valid PDF with one page for a small review", () => {
    const pdf = reviewToPdf(review());
    const { text } = assertValidPdf(pdf);
    expect(countPages(pdf)).toBe(1);

    // Metadata + verdict + aggregate present.
    expect(text).toContain(`Review ID: ${REVIEW_ID}`);
    expect(text).toContain("Verdict: Revise");
    expect(text).toContain("Aggregate score: 7.2 / 10 (Strong)");
    // Content and juror detail present.
    expect(text).toContain("Buy our thing today.");
    expect(text).toContain("Brand Voice Guardian");
    expect(text).toContain("Score: 8 / 10 (Strong)  -  High confidence");
    expect(text).toContain("On-brand and confident.");
    expect(text).toContain("Suggested rewrite");
  });

  it("renders a never-scored review without a fabricated score", () => {
    const pdf = reviewToPdf(
      review({ aggregate_score: null, verdict: null }),
    );
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("Verdict: Not scored");
    // The em-dash placeholder is sanitized to an ASCII hyphen in the PDF.
    expect(text).toContain("Aggregate score: - / 10");
    // No tier word when there is no score.
    expect(text).not.toMatch(/Aggregate score: .* \(Excellent\)/);
  });

  it("surfaces an errored juror instead of a fake score (Rules.md §6)", () => {
    const pdf = reviewToPdf(
      review({
        jurors: [
          okJuror(),
          {
            persona: "compliance_legal_flagger",
            status: "error",
            error: "The model did not return valid JSON.",
          },
        ],
      }),
    );
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("Compliance & Legal Flagger");
    expect(text).toContain("Status: Could not be scored");
    expect(text).toContain("The model did not return valid JSON.");
    // The errored juror never prints a Score line.
    expect(text).not.toContain("Score:  / 10");
    // The degraded-review notice is included.
    expect(text).toContain("Note:");
  });

  it("lists issues with severity labels", () => {
    const pdf = reviewToPdf(
      review({
        jurors: [
          okJuror({
            issues: [
              {
                severity: "high",
                excerpt: "best thing ever",
                explanation: "Unsubstantiated superlative.",
              },
            ],
          }),
        ],
      }),
    );
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("Issues (1)");
    expect(text).toContain('- High: "best thing ever" - Unsubstantiated superlative.');
  });

  it("handles a review with no juror slots", () => {
    const pdf = reviewToPdf(review({ jurors: [] }));
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("No juror results were recorded for this review.");
    // Empty-review health notice (danger) is surfaced.
    expect(text).toContain("Note:");
  });

  it("paginates a long review across multiple pages, all offsets valid", () => {
    const longRewrite = "sentence ".repeat(200).trim();
    const jurors: JurorSlot[] = [
      okJuror({ persona: "brand_voice_guardian", suggested_rewrite: longRewrite }),
      okJuror({ persona: "compliance_legal_flagger", suggested_rewrite: longRewrite }),
      okJuror({ persona: "target_audience_fit", suggested_rewrite: longRewrite }),
      okJuror({ persona: "seo_discoverability", suggested_rewrite: longRewrite }),
      okJuror({ persona: "stop_scrolling", suggested_rewrite: longRewrite }),
    ];
    const pdf = reviewToPdf(review({ jurors, content_text: longRewrite }));
    assertValidPdf(pdf); // validates every page object's xref offset
    expect(countPages(pdf)).toBeGreaterThan(1);
  });

  it("escapes PDF-special characters in content so the document stays valid", () => {
    const pdf = reviewToPdf(
      review({ content_text: "Price (USD) \\ 50% off )(" }),
    );
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("Price (USD) \\ 50% off )(");
  });

  it("transliterates non-ASCII content and keeps the PDF ASCII/single-byte", () => {
    const pdf = reviewToPdf(
      review({ content_text: "“Café” — best …" }),
    );
    assertValidPdf(pdf);
    for (let i = 0; i < pdf.length; i += 1) {
      expect(pdf.charCodeAt(i)).toBeLessThan(256);
    }
  });
});

// ── reviewPdfFilename ───────────────────────────────────────────────────

describe("reviewPdfFilename", () => {
  it("builds a dated, safe filename", () => {
    expect(reviewPdfFilename(review())).toBe(
      `adjury-review-${REVIEW_ID}-2026-10-01.pdf`,
    );
  });

  it("omits the date when created_at is unparseable", () => {
    expect(reviewPdfFilename(review({ created_at: "not-a-date" }))).toBe(
      `adjury-review-${REVIEW_ID}.pdf`,
    );
  });

  it("sanitizes an unsafe id", () => {
    expect(reviewPdfFilename(review({ review_id: "a/b c" }))).toContain(
      "adjury-review-a-b-c-",
    );
  });
});
