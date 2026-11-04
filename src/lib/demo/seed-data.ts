/**
 * Demo dataset for user testing (DailyPlan Day 68 — user-testing prep).
 *
 * This is a **pure, node-testable** definition of a realistic AdJury tenant — a
 * demo company, its brand guide, two users, and a spread of review scenarios —
 * with no network, no secrets, and no DB access. The thin `scripts/seed-demo.ts`
 * applies it to a dev Supabase project; `docs/USER_TEST_SCRIPT.md` walks a tester
 * through the core flow on top of it. Keeping the dataset here (not inline in the
 * script) means its integrity is a unit test, not a one-time eyeball: the scenarios
 * are proved schema-valid, the verdicts proved to cover pass/revise/fail under the
 * offline mock, and the caches proved bounded + fresh — so a tester always sees a
 * meaningful, full-range app, and drift in the mock or the cores is caught in CI.
 *
 * Follows the Week 9–10 "pure core + thin application" pattern (cf.
 * `lib/marketing/landing.ts`, `lib/onboarding/first-run.ts`).
 *
 * Honesty (Rules.md §1, §3): no real company or site is impersonated — the demo
 * uses RFC 2606 reserved `.example` hostnames/emails throughout, and the business
 * context is the deterministic offline summary (no invented facts). No credentials
 * live here; the seed script generates a throwaway password per user at run time
 * and prints it (Rules.md §4).
 */
import {
  ReviewInputSchema,
  type MediaType,
  type ReviewInput,
  type Verdict,
} from "@/lib/schema/juror";
import { computeBrandCache, type BrandCache } from "@/lib/company/brand-summary";
import {
  computeBusinessContextCache,
  type BusinessContextCache,
  type BusinessIdentity,
} from "@/lib/company/business-context";
import type { IndustryValue } from "@/lib/company/onboarding";
import type { ContentType, PlanTier, UserRole } from "@/types/db";

/** The demo company. `website_url` is a reserved `.example` host — never a real site. */
export interface DemoCompany {
  name: string;
  industry: IndustryValue;
  website_url: string;
  plan_tier: PlanTier;
}

export const DEMO_COMPANY: DemoCompany = {
  name: "Northwind Labs",
  industry: "saas",
  website_url: "https://northwind-labs.example",
  plan_tier: "pro",
};

/** A seeded user. No password lives here — the seed script generates one per run. */
export interface DemoUser {
  /** Stable handle used by the script + docs to refer to the user. */
  key: "admin" | "member";
  email: string;
  display_name: string;
  role: UserRole;
}

/**
 * Two users so a tester can exercise BOTH role paths (Rules.md §5, Design.md IA):
 * an admin who sees brand/team/settings, and a member who does not. Emails use the
 * reserved `.example` TLD so they can never collide with a real inbox.
 */
export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: "admin",
    email: "demo-admin@adjury.example",
    display_name: "Dana Rivera",
    role: "admin",
  },
  {
    key: "member",
    email: "demo-member@adjury.example",
    display_name: "Sam Okafor",
    role: "member",
  },
] as const;

/**
 * The demo brand guide (Day 26/27). Written in the brand's own measured, concrete
 * voice so the Brand Voice Guardian has something real to judge against. Fed through
 * `computeBrandCache` exactly as a real guide is, so the seeded cache is genuine.
 */
export const DEMO_BRAND_GUIDE = [
  "Voice: measured, expert, and trustworthy. We sound like a senior operator, not a hype marketer.",
  "Do: lead with a concrete outcome, use plain language, and name the specific benefit.",
  "Do: prefer short sentences and active voice; back claims with a number or a mechanism.",
  "Avoid: hype and absolutes ('guaranteed', 'the best', '#1', 'revolutionary'), exclamation marks, and emoji.",
  "Avoid: vague adjectives ('amazing', 'incredible') with nothing behind them.",
  "Audience: busy product and marketing leads at small-to-mid software teams who value clarity over noise.",
].join("\n");

/**
 * A valid 1×1 transparent PNG as a `data:` URL, for the image-ad scenario. Tiny and
 * inline so the dataset needs no binary asset; the offline mock reviews the
 * accompanying copy (which drives the verdict) and the visual is a stand-in.
 */
export const DEMO_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * One demo review to seed. `expected_verdict` is the verdict this content yields
 * **under the offline mock** (`AI_API_KEY` unset) — it is pinned by the unit test so
 * the dataset can't silently drift from a full pass/revise/fail spread. With a live
 * model the realized verdict may differ; the seed script stores whatever the model
 * returns either way.
 */
export interface DemoReviewScenario {
  /** Stable handle for the doc/walkthrough. */
  key: string;
  /** Short human title shown in the seed summary + user-test script. */
  title: string;
  /** The verdict this scenario produces under the offline mock. */
  expected_verdict: Verdict;
  content_type: ContentType;
  platform: string | null;
  media_type: MediaType;
  content_text: string;
  /** Present only for an image ad; the schema requires it when media_type is "image". */
  image?: { data_url: string; mime_type: string };
}

/**
 * Six scenarios chosen to cover every content type (ad copy / social / landing /
 * email), both ad formats (text + image), and the full verdict range so a tester
 * sees a real scorecard spread, not six near-identical passes:
 *  - a clean passing ad and social post,
 *  - a landing page and an email that land in "revise",
 *  - a compliance-vetoed "fail" (absolute medical claims), and
 *  - an image ad with a generic opener that lands in "revise".
 * Verdicts are pinned by `tests/seed-data.test.ts` running each through the mock.
 */
export const DEMO_REVIEW_SCENARIOS: readonly DemoReviewScenario[] = [
  {
    key: "pass-ad-copy",
    title: "Google search ad — clean, concrete (pass)",
    expected_verdict: "pass",
    content_type: "ad_copy",
    platform: "google",
    media_type: "text",
    content_text:
      "Plan the week in one place. Clear owners, clear deadlines, fewer status meetings for busy product teams.",
  },
  {
    key: "pass-social-post",
    title: "LinkedIn post — insight-led (pass)",
    expected_verdict: "pass",
    content_type: "social_post",
    platform: "linkedin",
    media_type: "text",
    content_text:
      "We asked 200 teams what slows delivery. The top answer was unclear ownership. Here is how clearer ownership shortened their cycle time.",
  },
  {
    key: "revise-landing-page",
    title: "Landing page hero — solid but improvable (revise)",
    expected_verdict: "revise",
    content_type: "landing_page",
    platform: "website",
    media_type: "text",
    content_text:
      "Ship projects on time. Our planning workspace gives small teams one clear view of deadlines, owners, and blockers so nothing slips. Start a free trial and see your first plan in minutes.",
  },
  {
    key: "revise-email",
    title: "Lifecycle email — needs a sharper hook (revise)",
    expected_verdict: "revise",
    content_type: "email",
    platform: "email",
    media_type: "text",
    content_text:
      "A calmer release week starts here. Give reviewers one checklist, one owner per task, and a clear cutoff so launches stop sliding.",
  },
  {
    key: "fail-compliance",
    title: "Instagram ad — unsubstantiated medical claims (fail)",
    expected_verdict: "fail",
    content_type: "ad_copy",
    platform: "instagram",
    media_type: "text",
    content_text:
      "Introducing our new sleep supplement — guaranteed to cure insomnia in 3 days, 100% risk-free!",
  },
  {
    key: "revise-image-ad",
    title: "Instagram image ad — generic opener (revise)",
    expected_verdict: "revise",
    content_type: "social_post",
    platform: "instagram",
    media_type: "image",
    content_text:
      "Introducing our new project dashboard. See every deadline at a glance and keep your team aligned all week.",
    image: { data_url: DEMO_IMAGE_DATA_URL, mime_type: "image/png" },
  },
] as const;

/** The demo company's identity, in the shape the business-context core expects. */
export function demoBusinessIdentity(): BusinessIdentity {
  return {
    name: DEMO_COMPANY.name,
    industry: DEMO_COMPANY.industry,
    websiteUrl: DEMO_COMPANY.website_url,
  };
}

/** The brand-voice cache for the demo guide (what the seed writes to `brand_profiles`). */
export function demoBrandCache(): BrandCache {
  return computeBrandCache(DEMO_BRAND_GUIDE);
}

/** The business-context cache for the demo identity (what the seed writes to `companies`). */
export function demoBusinessContextCache(): BusinessContextCache {
  return computeBusinessContextCache(demoBusinessIdentity());
}

/**
 * Build the orchestrator input for a scenario, grounded exactly as the real review
 * path grounds a live submission: the Brand Voice Guardian gets the cached brand
 * summary and every juror gets the cached business summary. Parsed through
 * `ReviewInputSchema` so a malformed scenario fails loudly here rather than at the
 * model boundary (Rules.md §3). The injected context does not change the offline
 * mock's verdict (the mock scores only the content itself), so the pinned verdicts
 * stay deterministic.
 */
export function demoReviewInput(scenario: DemoReviewScenario): ReviewInput {
  const brand = demoBrandCache();
  const business = demoBusinessContextCache();
  return ReviewInputSchema.parse({
    content_text: scenario.content_text,
    content_type: scenario.content_type,
    platform: scenario.platform,
    media_type: scenario.media_type,
    image: scenario.media_type === "image" ? (scenario.image ?? null) : null,
    brand_context: brand.summary,
    business_context: business.summary,
  });
}
