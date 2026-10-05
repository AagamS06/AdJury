import { describe, it, expect } from "vitest";
import {
  HISTORY_CSV_HEADERS,
  historyCsvFilename,
  historyToCsv,
} from "@/lib/reviews/history-csv-export";
import { toHistoryRow } from "@/lib/reviews/history-view";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";

/**
 * CSV: history (DailyPlan Day 37). Pins the pure serialization — the column
 * layout, the per-cell labels (reused from the history view so the export reads
 * like the on-screen table), the never-scored handling (empty score, "Not
 * scored" verdict), escaping — and proves the output parses back as a well-formed
 * rectangular table. The download route's tenancy is the Day 6 `listReviews`
 * read core, already proven in tests/reviews-read.test.ts; the filtering is
 * proven in tests/history-filter.test.ts.
 */

function summary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    review_id: "00000000-0000-0000-0000-000000000001",
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: 7.2,
    verdict: "revise",
    created_at: "2026-10-01T12:00:00.000Z",
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

describe("historyToCsv", () => {
  it("emits a header row then one row per review, as a valid rectangular table", () => {
    const csv = historyToCsv([
      summary({ review_id: "a" }),
      summary({ review_id: "b" }),
      summary({ review_id: "c" }),
    ]);
    const rows = parseCsv(csv);

    expect(rows[0]).toEqual([...HISTORY_CSV_HEADERS]);
    expect(rows).toHaveLength(4); // header + 3 reviews
    for (const r of rows) {
      expect(r).toHaveLength(HISTORY_CSV_HEADERS.length);
    }
  });

  it("preserves the given order (the view's newest-first)", () => {
    const csv = historyToCsv([
      summary({ review_id: "newest" }),
      summary({ review_id: "middle" }),
      summary({ review_id: "oldest" }),
    ]);
    const rows = parseCsv(csv);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("fills each row with the same human labels the history view shows", () => {
    const review = summary({
      review_id: "r1",
      content_type: "social_post",
      platform: "instagram",
      aggregate_score: 7.2,
      verdict: "revise",
      created_at: "2026-10-01T12:00:00.000Z",
    });
    const [, row] = parseCsv(historyToCsv([review]));

    expect(row).toEqual([
      "r1",
      "Oct 1, 2026",
      "Social post",
      "Instagram",
      "7.2",
      "Revise",
    ]);

    // The cell values match what the on-screen row renders (same helpers).
    const view = toHistoryRow(review);
    expect(row[1]).toBe(view.date);
    expect(row[2]).toBe(view.contentType);
    expect(row[3]).toBe(view.platform);
    expect(row[5]).toBe(view.verdict);
  });

  it("renders a never-scored review with an empty score and 'Not scored' verdict", () => {
    const [, row] = parseCsv(
      historyToCsv([summary({ aggregate_score: null, verdict: null })]),
    );
    expect(row[4]).toBe(""); // score (null → empty, not "—" or 0)
    expect(row[5]).toBe("Not scored");
  });

  it("leaves the platform cell empty when the review has no platform", () => {
    const [, nullRow] = parseCsv(historyToCsv([summary({ platform: null })]));
    expect(nullRow[3]).toBe("");
    const [, blankRow] = parseCsv(historyToCsv([summary({ platform: "   " })]));
    expect(blankRow[3]).toBe("");
  });

  it("passes through an unknown free-form platform value", () => {
    const [, row] = parseCsv(historyToCsv([summary({ platform: "pinterest" })]));
    expect(row[3]).toBe("pinterest");
  });

  it("falls back to a neutral label for an unparseable date", () => {
    const [, row] = parseCsv(historyToCsv([summary({ created_at: "nope" })]));
    expect(row[1]).toBe("Unknown date");
  });

  it("emits a header-only file for an empty list (valid, clearly empty)", () => {
    const csv = historyToCsv([]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...HISTORY_CSV_HEADERS]);
  });

  it("escapes / guards a review id that could be read as a formula", () => {
    // Defensive: ids are server-generated UUIDs, but the escaper must still guard.
    const csv = historyToCsv([summary({ review_id: "=cmd" })]);
    const [, row] = parseCsv(csv);
    expect(row[0]).toBe("'=cmd");
  });

  it("uses CRLF between records (RFC 4180)", () => {
    const csv = historyToCsv([summary(), summary()]);
    expect(csv.split("\r\n")).toHaveLength(3); // header + 2 rows
  });
});

describe("historyCsvFilename", () => {
  it("builds a dated, safe filename from the given date (UTC)", () => {
    expect(historyCsvFilename(new Date("2026-10-04T23:30:00.000Z"))).toBe(
      "adjury-review-history-2026-10-04.csv",
    );
  });

  it("omits the date when the clock is unparseable", () => {
    expect(historyCsvFilename(new Date("not-a-date"))).toBe(
      "adjury-review-history.csv",
    );
  });
});
