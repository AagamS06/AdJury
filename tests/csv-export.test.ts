import { describe, it, expect } from "vitest";
import {
  REVIEW_CSV_HEADERS,
  UTF8_BOM,
  escapeCsvField,
  reviewCsvFilename,
  reviewToCsv,
} from "@/lib/reviews/csv-export";
import type { PersistedReview } from "@/lib/reviews/read-reviews";
import type { JurorSlot } from "@/lib/schema/juror";

/**
 * CSV: single review (DailyPlan Day 36). Pins the pure serialization —
 * RFC 4180 escaping, the formula-injection guard, the column layout, the
 * errored-juror (no fake score) handling — and proves the output parses back as
 * a well-formed rectangular table. The download route's tenancy is the Day 6
 * read core, already proven in tests/reviews-read.test.ts.
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
    jurors: [okJuror()],
    content_text: "Introducing our new sleep supplement.",
    ...overrides,
  };
}

/**
 * A minimal RFC 4180 parser (handles quoted fields, doubled quotes, embedded
 * commas/CRLF) used only to prove the serializer's output is well-formed.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

describe("escapeCsvField", () => {
  it("leaves a plain value untouched", () => {
    expect(escapeCsvField("hello world")).toBe("hello world");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("quotes fields containing a comma or newline", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("guards against formula injection by prefixing a single quote", () => {
    expect(escapeCsvField("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("-cmd")).toBe("'-cmd");
    expect(escapeCsvField("@ref")).toBe("'@ref");
  });

  it("combines the formula guard with quoting when both apply", () => {
    // Leading '=' triggers the guard; the comma then forces quoting (guard inside).
    expect(escapeCsvField("=1,2")).toBe("\"'=1,2\"");
  });
});

describe("reviewToCsv", () => {
  it("emits a header row then one row per juror, as a valid rectangular table", () => {
    const csv = reviewToCsv(
      review({
        jurors: [
          okJuror({ persona: "brand_voice_guardian", score: 8 }),
          okJuror({ persona: "compliance_legal_flagger", score: 6 }),
        ],
      }),
    );
    const rows = parseCsv(csv);

    expect(rows[0]).toEqual([...REVIEW_CSV_HEADERS]);
    expect(rows).toHaveLength(3); // header + 2 jurors
    // Every row has the same column count — a well-formed table.
    for (const r of rows) {
      expect(r).toHaveLength(REVIEW_CSV_HEADERS.length);
    }
  });

  it("fills the review-level columns with human labels, repeated per juror row", () => {
    const csv = reviewToCsv(
      review({
        content_type: "social_post",
        platform: "instagram",
        aggregate_score: 7.2,
        verdict: "revise",
        jurors: [okJuror(), okJuror({ persona: "seo_discoverability" })],
      }),
    );
    const rows = parseCsv(csv);
    const [, first, second] = rows;

    // Review ID, Date, Content type, Platform, Aggregate, Verdict, Content
    expect(first.slice(0, 7)).toEqual([
      REVIEW_ID,
      "Oct 1, 2026",
      "Social post",
      "Instagram",
      "7.2",
      "Revise",
      "Introducing our new sleep supplement.",
    ]);
    // Repeated identically on the second juror row.
    expect(second.slice(0, 7)).toEqual(first.slice(0, 7));
  });

  it("writes the juror columns with label, status, score and confidence", () => {
    const csv = reviewToCsv(
      review({
        jurors: [
          okJuror({
            persona: "stop_scrolling",
            score: 9,
            confidence: "medium",
            summary: "Strong hook.",
            suggested_rewrite: "Stop scrolling — here's why.",
          }),
        ],
      }),
    );
    const [, row] = parseCsv(csv);
    // Juror, Status, Score, Confidence, Summary, Issue count, Issues, Rewrite
    expect(row.slice(7)).toEqual([
      "Would I Stop Scrolling",
      "Scored",
      "9",
      "Medium",
      "Strong hook.",
      "0",
      "",
      "Stop scrolling — here's why.",
    ]);
  });

  it("serializes issues with a count and a compact per-issue cell", () => {
    const csv = reviewToCsv(
      review({
        jurors: [
          okJuror({
            persona: "compliance_legal_flagger",
            issues: [
              {
                severity: "high",
                excerpt: "cures anxiety",
                explanation: "Unsubstantiated health claim.",
              },
              {
                severity: "medium",
                excerpt: "best ever",
                explanation: "Hyperbole.",
              },
            ],
          }),
        ],
      }),
    );
    const [, row] = parseCsv(csv);
    expect(row[12]).toBe("2"); // Issue count
    expect(row[13]).toBe(
      "High: cures anxiety — Unsubstantiated health claim. | Medium: best ever — Hyperbole.",
    );
  });

  it("never fabricates a score for an errored juror (Rules.md §6)", () => {
    const csv = reviewToCsv(
      review({
        jurors: [
          {
            persona: "seo_discoverability",
            status: "error",
            error: "provider timeout",
          },
        ],
      }),
    );
    const [, row] = parseCsv(csv);
    expect(row.slice(7)).toEqual([
      "SEO / Discoverability",
      "Error",
      "", // no score
      "", // no confidence
      "provider timeout", // reason in the summary column
      "", // no issue count
      "", // no issues
      "", // no rewrite
    ]);
  });

  it("renders a never-scored review with empty aggregate and 'Not scored' verdict", () => {
    const csv = reviewToCsv(
      review({ aggregate_score: null, verdict: null, platform: null }),
    );
    const [, row] = parseCsv(csv);
    expect(row[3]).toBe(""); // platform (null → empty)
    expect(row[4]).toBe(""); // aggregate (null → empty, not "—")
    expect(row[5]).toBe("Not scored");
  });

  it("still emits the review row when there are no jurors", () => {
    const csv = reviewToCsv(review({ jurors: [] }));
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2); // header + one metadata row
    expect(rows[1].slice(0, 7)).toEqual([
      REVIEW_ID,
      "Oct 1, 2026",
      "Ad copy",
      "Instagram",
      "7.2",
      "Revise",
      "Introducing our new sleep supplement.",
    ]);
    expect(rows[1].slice(7)).toEqual(["", "", "", "", "", "", "", ""]);
  });

  it("escapes content and rewrites containing commas, quotes and newlines", () => {
    const csv = reviewToCsv(
      review({
        content_text: 'Buy now, "limited" offer\nends soon',
        jurors: [okJuror({ suggested_rewrite: "Act today, before it's gone" })],
      }),
    );
    // The raw string must survive a parse round-trip intact.
    const [, row] = parseCsv(csv);
    expect(row[6]).toBe('Buy now, "limited" offer\nends soon');
    expect(row[14]).toBe("Act today, before it's gone");
  });

  it("guards user content that starts with a formula character", () => {
    const csv = reviewToCsv(review({ content_text: "=HYPERLINK(evil)" }));
    const [, row] = parseCsv(csv);
    expect(row[6]).toBe("'=HYPERLINK(evil)");
  });

  it("uses CRLF between records (RFC 4180)", () => {
    const csv = reviewToCsv(review({ jurors: [okJuror()] }));
    // header CRLF one data row, no stray lone LFs between records.
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("reviewCsvFilename", () => {
  it("builds a dated, safe filename", () => {
    expect(reviewCsvFilename(review())).toBe(
      `adjury-review-${REVIEW_ID}-2026-10-01.csv`,
    );
  });

  it("omits the date when created_at is unparseable", () => {
    expect(reviewCsvFilename(review({ created_at: "not-a-date" }))).toBe(
      `adjury-review-${REVIEW_ID}.csv`,
    );
  });

  it("sanitizes unsafe characters in the id", () => {
    expect(
      reviewCsvFilename(review({ review_id: "a/b c", created_at: "not-a-date" })),
    ).toBe("adjury-review-a-b-c.csv");
  });
});

describe("UTF8_BOM", () => {
  it("is the UTF-8 byte-order mark", () => {
    expect(UTF8_BOM).toBe("﻿");
    expect(UTF8_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});
