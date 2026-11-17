import { ImageResponse } from "next/og";
import {
  SITE_NAME,
  DEFAULT_DESCRIPTION,
} from "@/lib/seo/metadata";

/**
 * Default social share image (DailyPlan Day 80 — "shareable … pages"). File-based
 * OpenGraph image route: Next renders this once and wires `og:image` (and the
 * Twitter card falls back to it) for every page that doesn't declare its own, so
 * a link to AdJury unfurls with a branded 1200×630 card instead of a bare URL.
 *
 * Drawn with the Design.md palette (Navy surface, white wordmark, Royal Blue
 * accent) using `next/og` — framework-native, no new dependency (Rules.md §2) and
 * no binary asset committed to the repo.
 */
export const alt = `${SITE_NAME} — AI content critique`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Design.md §2 tokens.
const NAVY = "#0A1F44";
const ROYAL = "#1E40AF";
const WHITE = "#FFFFFF";
const SLATE_200 = "#E4E7EC";

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: NAVY,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 24,
              height: 56,
              background: ROYAL,
              borderRadius: 6,
              marginRight: 24,
            }}
          />
          <div
            style={{
              color: WHITE,
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: WHITE,
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              maxWidth: 960,
            }}
          >
            Six expert jurors review your marketing before you publish.
          </div>
          <div
            style={{
              color: SLATE_200,
              fontSize: 30,
              lineHeight: 1.4,
              marginTop: 28,
              maxWidth: 960,
            }}
          >
            {DEFAULT_DESCRIPTION}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
