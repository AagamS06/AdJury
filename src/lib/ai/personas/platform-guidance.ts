import type { PersonaName } from "@/lib/schema/juror";

/**
 * Platform-aware persona guidance (DailyPlan Day 20).
 *
 * The SEO / Discoverability and "Would I Stop Scrolling" jurors judge on lenses
 * whose expectations genuinely change with the target platform — a Google search
 * ad, an Instagram caption, and a newsletter subject line are discoverable and
 * "scroll-stopping" in very different ways. This module owns the per-platform,
 * per-persona guidance that the orchestrator injects into those two jurors' user
 * prompts at review time.
 *
 * It lives under `src/lib/ai/personas/*` because it is prompt content, and prompt
 * content is reviewed code (Rules.md §3). It is a pure module (no I/O), so the
 * mapping is unit-testable in the node test env like the other view/domain
 * modules. The other three jurors (brand voice, compliance, audience fit) are
 * deliberately NOT platform-aware here — their lenses don't shift by channel, so
 * scoping stays tight (no work pulled forward).
 */

/** The two jurors whose expectations shift with the selected platform. */
export const PLATFORM_AWARE_PERSONAS = [
  "seo_discoverability",
  "stop_scrolling",
] as const;
export type PlatformAwarePersona = (typeof PLATFORM_AWARE_PERSONAS)[number];

export function isPlatformAwarePersona(
  name: PersonaName,
): name is PlatformAwarePersona {
  return (PLATFORM_AWARE_PERSONAS as readonly string[]).includes(name);
}

/** Per-platform guidance for the two platform-aware jurors. */
interface PlatformGuidance {
  /** Human-readable platform name, echoed into the prompt block. */
  label: string;
  seo_discoverability: string;
  stop_scrolling: string;
}

/**
 * Guidance keyed by a normalized platform slug. Keys mirror the curated
 * `PLATFORM_OPTIONS` values in the submission form so a selected platform maps
 * cleanly; `normalizePlatform` also folds a few common aliases onto these keys.
 */
export const PLATFORM_GUIDANCE: Record<string, PlatformGuidance> = {
  google: {
    label: "Google",
    seo_discoverability:
      "Search ads/results: match the searcher's intent and query keywords; " +
      "front-load the primary keyword; respect tight limits (headlines ~30 " +
      "chars, descriptions ~90 chars) and include a clear, specific CTA.",
    stop_scrolling:
      "The audience is actively searching, not idly scrolling — the 'hook' is " +
      "relevance: the headline must mirror the query and promise the answer " +
      "immediately, not tease it.",
  },
  facebook: {
    label: "Facebook",
    seo_discoverability:
      "Front-load the first ~125 characters shown before 'See more'; use at " +
      "most a couple of relevant hashtags; keep a clear link/CTA and avoid " +
      "keyword stuffing.",
    stop_scrolling:
      "A mixed personal-and-ads feed — the opening line (paired with the " +
      "image) must earn attention with a relatable, specific hook rather than " +
      "leading with a pitch.",
  },
  instagram: {
    label: "Instagram",
    seo_discoverability:
      "Caption keywords and alt text drive discovery; 3-5 focused hashtags " +
      "beat 30 generic ones; put the value before the caption truncation fold.",
    stop_scrolling:
      "A visual-first, fast feed — the first line must hook in under a second; " +
      "no throat-clearing and no generic superlatives.",
  },
  linkedin: {
    label: "LinkedIn",
    seo_discoverability:
      "Use professional, industry-relevant keywords; the first 2-3 lines " +
      "before 'see more' carry it; keep hashtags sparing and specific; land a " +
      "clear takeaway.",
    stop_scrolling:
      "A professional audience — a credible, specific hook (a concrete result " +
      "or a contrarian insight) beats hype; avoid clickbait and reward the " +
      "scroll with substance.",
  },
  x: {
    label: "X (Twitter)",
    seo_discoverability:
      "A tight character budget; 1-2 precise hashtags at most; put the keyword " +
      "and the payoff in the first line since links and threads get truncated.",
    stop_scrolling:
      "An extremely fast, text-first feed — the first few words are " +
      "everything; be punchy and specific with no wind-up.",
  },
  tiktok: {
    label: "TikTok",
    seo_discoverability:
      "Discovery leans on caption plus on-screen text keywords and a few " +
      "trend-aligned hashtags; keep hooks concise and searchable.",
    stop_scrolling:
      "The first 1-2 seconds decide everything — open with a pattern-interrupt " +
      "and an immediate payoff, zero preamble.",
  },
  youtube: {
    label: "YouTube",
    seo_discoverability:
      "Use a keyword-rich title and description with the main keyword " +
      "front-loaded; state the value in the first line of the description; add " +
      "relevant tags and a CTA.",
    stop_scrolling:
      "The title and first line must promise a specific payoff to beat the " +
      "thumbnail's competition; avoid vague curiosity gaps that read as bait.",
  },
  email: {
    label: "Email / newsletter",
    seo_discoverability:
      "The subject line and preheader are the discoverability surface — keep " +
      "them concise, specific, and keyword-relevant; avoid spam-trigger " +
      "phrasing; keep the body scannable.",
    stop_scrolling:
      "In a crowded inbox the subject line is the whole hook — make it " +
      "specific and benefit-led (not clickbait), and let the first line " +
      "justify the open.",
  },
  website: {
    label: "Website / blog",
    seo_discoverability:
      "Use headings and front-loaded keywords, a scannable structure, a " +
      "meta-worthy title/summary, and internal-link/CTA anchors; keep keyword " +
      "placement natural (no stuffing).",
    stop_scrolling:
      "The above-the-fold headline and subhead must convey the value at a " +
      "glance — skimmers decide in seconds, so lead with the payoff.",
  },
};

/** Common aliases folded onto the canonical platform keys above. */
const PLATFORM_ALIASES: Record<string, string> = {
  twitter: "x",
  "twitter/x": "x",
  newsletter: "email",
  blog: "website",
  web: "website",
  site: "website",
  yt: "youtube",
  ig: "instagram",
  fb: "facebook",
};

/**
 * Normalize a free-form platform string to a canonical guidance key, or `null`
 * when no platform was selected. Platform is a free-form nullable field in the
 * contract, so this trims, lowercases, and folds a few aliases; an unrecognized
 * (but non-empty) value is returned lowercased so callers can still name it.
 */
export function normalizePlatform(platform: string | null): string | null {
  if (platform == null) return null;
  const key = platform.trim().toLowerCase();
  if (key === "") return null;
  return PLATFORM_ALIASES[key] ?? key;
}

/**
 * The platform-specific guidance block for one juror, or `null` when there is
 * nothing to add. Returns `null` for personas that don't adapt by platform and
 * when no platform is selected. For a recognized platform it returns the curated
 * per-persona guidance; for an unrecognized (but named) platform it returns a
 * generic nudge that still tells the juror to adapt to that channel's
 * conventions — so "the prompt reflects the platform" either way (Day 20 DoD).
 */
export function platformGuidanceFor(
  persona: PersonaName,
  platform: string | null,
): string | null {
  if (!isPlatformAwarePersona(persona)) return null;
  const key = normalizePlatform(platform);
  if (key == null) return null;

  const known = PLATFORM_GUIDANCE[key];
  if (known) return known[persona];

  // Unrecognized platform: still reflect it rather than ignoring it.
  return `Adapt your expectations to the conventions of "${key}" — its typical length limits, formatting, and how people encounter content there.`;
}
