import { describe, it, expect } from "vitest";
import {
  exportErrorMessage,
  historyExportHref,
  parseContentDispositionFilename,
  reviewExportHref,
} from "@/lib/reviews/export-ui";

/**
 * Export UI logic (DailyPlan Day 41 — Export buttons + download UX). The buttons
 * live in a client island, but the logic they depend on — building the download
 * hrefs, reading a filename off a `Content-Disposition` header, and turning a
 * failed response into plain-language copy (Rules.md §6) — is a pure core, so it
 * is pinned here in the node env with no DOM (mirroring history-filter.test.ts).
 */

describe("reviewExportHref", () => {
  it("builds the single-review CSV/PDF download URLs", () => {
    expect(reviewExportHref("abc123", "csv")).toBe(
      "/api/reviews/abc123/export?format=csv",
    );
    expect(reviewExportHref("abc123", "pdf")).toBe(
      "/api/reviews/abc123/export?format=pdf",
    );
  });

  it("URL-encodes the review id so a stray char can't break the path", () => {
    expect(reviewExportHref("a/b c", "csv")).toBe(
      "/api/reviews/a%2Fb%20c/export?format=csv",
    );
  });
});

describe("historyExportHref", () => {
  it("defaults to a plain CSV history export with no filters", () => {
    expect(historyExportHref()).toBe("/api/reviews/export?format=csv");
  });

  it("forwards active history filters (record form)", () => {
    const href = historyExportHref({
      content_type: "ad_copy",
      platform: "instagram",
      verdict: "pass",
      from: "2026-10-01",
      to: "2026-10-07",
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/api/reviews/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("content_type")).toBe("ad_copy");
    expect(url.searchParams.get("platform")).toBe("instagram");
    expect(url.searchParams.get("verdict")).toBe("pass");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-07");
  });

  it("forwards active history filters (URLSearchParams form)", () => {
    const params = new URLSearchParams({ verdict: "fail" });
    const href = historyExportHref(params);
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("verdict")).toBe("fail");
    expect(url.searchParams.get("format")).toBe("csv");
  });

  it("drops empty values and ignores unknown params", () => {
    const href = historyExportHref({
      platform: "   ",
      verdict: "",
      unrelated: "x",
      content_type: "email",
    });
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("content_type")).toBe("email");
    expect(url.searchParams.has("platform")).toBe(false);
    expect(url.searchParams.has("verdict")).toBe(false);
    expect(url.searchParams.has("unrelated")).toBe(false);
  });

  it("collapses a repeated param to its first value", () => {
    const href = historyExportHref({ verdict: ["pass", "fail"] });
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("verdict")).toBe("pass");
  });
});

describe("parseContentDispositionFilename", () => {
  it("reads a plain quoted filename", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="adjury-review-abc-2026-10-08.csv"',
      ),
    ).toBe("adjury-review-abc-2026-10-08.csv");
  });

  it("reads an unquoted filename", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=report.pdf"),
    ).toBe("report.pdf");
  });

  it("prefers and percent-decodes the RFC 5987 extended form", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename=\"fallback.csv\"; filename*=UTF-8''adjury%20report.csv",
      ),
    ).toBe("adjury report.csv");
  });

  it("returns null for a missing or filename-less header", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename(undefined)).toBeNull();
    expect(parseContentDispositionFilename("attachment")).toBeNull();
  });
});

describe("exportErrorMessage", () => {
  it("surfaces the server message for a 429 rate limit", () => {
    const serverMsg =
      "Export limit reached (20 per hour). Try again in 12 minutes.";
    expect(exportErrorMessage(429, serverMsg)).toBe(serverMsg);
  });

  it("falls back to a friendly 429 message when the server gives none", () => {
    expect(exportErrorMessage(429)).toMatch(/export limit/i);
  });

  it("maps auth/permission/not-found statuses to actionable copy", () => {
    expect(exportErrorMessage(401)).toMatch(/sign in/i);
    expect(exportErrorMessage(403)).toMatch(/permission/i);
    expect(exportErrorMessage(404)).toMatch(/no longer available/i);
  });

  it("uses the server message for a 400 bad format", () => {
    expect(exportErrorMessage(400, 'Unsupported export format "xml".')).toMatch(
      /unsupported export format/i,
    );
  });

  it("gives a generic retry message for 5xx and network failures", () => {
    expect(exportErrorMessage(500)).toMatch(/try again/i);
    expect(exportErrorMessage(0)).toMatch(/try again/i);
  });

  it("never returns an empty string", () => {
    for (const status of [0, 400, 401, 403, 404, 429, 500, 502, 418]) {
      expect(exportErrorMessage(status)).not.toBe("");
      expect(exportErrorMessage(status, "   ")).not.toBe("");
    }
  });
});
