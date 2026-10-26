/**
 * Landing-page content model — pure core (DailyPlan Day 57, landing hero).
 *
 * The public landing page is built over Week 9 (Day 57 hero → Day 58 body →
 * Day 59 CTA/footer). Keeping the page's copy and its call-to-action routing out
 * of the React layer — in a typed, framework-agnostic module — mirrors the
 * project's established "pure core + thin client/server component" pattern
 * (cf. `lib/ui/nav.ts`, `lib/reviews/dashboard-view.ts`): the component in
 * `components/marketing/landing-hero.tsx` only renders these values, so the
 * marketing copy and the session-aware CTA logic are node-testable with no DOM,
 * bundler, or credential.
 *
 * Scope note: this file owns the **hero + value proposition** (Day 57) and the
 * detailed **features / the jury / how-it-works** body (Day 58). The social
 * proof + CTA + footer is Day 59.
 */

import { PERSONAS } from "@/lib/ai/personas";
import type { PersonaName } from "@/lib/schema/juror";

/** A primary or secondary call-to-action button in the hero. */
export interface HeroCta {
  /** Stable key for React lists and tests. */
  key: string;
  /** Visible, action-first label. */
  label: string;
  /** Destination path (an existing in-app route; no trailing slash). */
  href: string;
  /**
   * Visual emphasis. Exactly one CTA is `primary` per auth state so the eye has
   * a single obvious next step; the rest are `secondary`.
   */
  variant: "primary" | "secondary";
}

/** A short value-proposition pillar reinforcing what AdJury does. */
export interface ValuePillar {
  /** Stable key for React lists and tests. */
  key: string;
  /** A few words naming the benefit. */
  title: string;
  /** One sentence of plain, specific support. */
  body: string;
}

/** The hero's static content (copy only — CTAs are resolved per auth state). */
export interface HeroContent {
  /** Small kicker above the headline. */
  eyebrow: string;
  /** The Display-size headline: what AdJury does, in one line. */
  headline: string;
  /** The value proposition expanded to a sentence or two. */
  subhead: string;
  /** Who the product is for (the "for whom" half of the Day 57 DoD). */
  audience: string;
  /** Three value pillars shown beneath the hero copy. */
  pillars: readonly ValuePillar[];
}

/**
 * The hero copy. Enterprise-credible and concrete (Design.md §7): it names the
 * product category (a pre-publish QA layer), what you submit, what you get back,
 * and that the human stays in control — never hype.
 */
export const HERO: HeroContent = {
  eyebrow: "Pre-publish content review",
  headline: "Six expert jurors review your marketing before you publish.",
  subhead:
    "AdJury is the QA layer for marketing teams. Submit ad copy, a social post, " +
    "an email, or an image ad and get per-juror scores, flagged risks, and " +
    "ready-to-use rewrites — grounded in your brand voice and your actual business.",
  audience:
    "Built for marketing directors and the copywriters, social managers, and " +
    "compliance reviewers who ship with them.",
  pillars: [
    {
      key: "one-pass",
      title: "Six angles, one pass",
      body:
        "Brand voice, compliance, audience fit, SEO, stopping power, and an " +
        "insider business read — on every submission, in a single request.",
    },
    {
      key: "grounded",
      title: "Grounded in your business",
      body:
        "Jurors judge against your brand guide and researched business context, " +
        "not a generic rubric — so the feedback fits your market.",
    },
    {
      key: "rewrites",
      title: "Rewrites, not just red ink",
      body:
        "Every flag comes with a constructive, ready-to-use suggested rewrite. " +
        "You stay in control of what ships.",
    },
  ],
} as const;

/**
 * The hero's call-to-action buttons, resolved for the viewer's auth state. A
 * signed-out visitor is pointed at sign-up (with log in as the quiet secondary);
 * a signed-in user — the landing page is still reachable while logged in — is
 * pointed back into the product. Every `href` is an existing route, so no CTA
 * dangles ahead of a page that isn't built yet. Exactly one `primary` is
 * returned either way.
 */
export function heroCtasFor(isAuthenticated: boolean): readonly HeroCta[] {
  if (isAuthenticated) {
    return [
      {
        key: "dashboard",
        label: "Go to your dashboard",
        href: "/dashboard",
        variant: "primary",
      },
      {
        key: "new-review",
        label: "Start a review",
        href: "/review",
        variant: "secondary",
      },
    ];
  }
  return [
    {
      key: "signup",
      label: "Start a free review",
      href: "/signup",
      variant: "primary",
    },
    {
      key: "login",
      label: "Log in",
      href: "/login",
      variant: "secondary",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Day 58 — Landing body: features · the jury · how-it-works                   */
/* -------------------------------------------------------------------------- */

/** A section's heading and one-line intro. */
export interface SectionIntro {
  /** Stable key for React lists and tests. */
  key: string;
  /** Short kicker above the section heading. */
  eyebrow: string;
  /** The H2 section heading. */
  heading: string;
  /** One sentence framing the section. */
  intro: string;
}

/** A single product-capability card in the features section. */
export interface FeatureItem {
  /** Stable key for React lists and tests. */
  key: string;
  /** A few words naming the capability. */
  title: string;
  /** One or two sentences of plain, specific support. */
  body: string;
}

/** A juror as shown on the landing page — title + lens, no prompt text. */
export interface JurorSummary {
  /** The juror's stable machine name (matches the schema `PersonaName`). */
  name: PersonaName;
  /** Human-readable juror title. */
  title: string;
  /** One-line description of this juror's lens. */
  lens: string;
}

/** A numbered step in the how-it-works section. */
export interface HowItWorksStep {
  /** Stable key for React lists and tests. */
  key: string;
  /** 1-based position, shown as the step number. */
  step: number;
  /** A few words naming the step. */
  title: string;
  /** One or two sentences describing what happens in this step. */
  body: string;
}

/** The features section's heading + intro. */
export const FEATURES_INTRO: SectionIntro = {
  key: "features",
  eyebrow: "What you get",
  heading: "A full QA pass on every piece of marketing",
  intro:
    "One submission, one request — six expert lenses, scored and explained, " +
    "with a fix for every flag. You stay the editor.",
} as const;

/**
 * The product's headline capabilities. Each is a real, shipped behaviour (not a
 * roadmap promise): the six-juror fan-out, the brand/business grounding, the
 * constructive rewrites, multi-format inputs, compliance risk-flagging, and the
 * history/trends surface. Framed as benefits in the Design.md §7 voice — concise
 * and concrete, no hype.
 */
export const FEATURES: readonly FeatureItem[] = [
  {
    key: "six-jurors",
    title: "Six jurors, one pass",
    body:
      "Brand voice, compliance, audience fit, SEO, stopping power, and an " +
      "insider business read — every submission, scored 0–10 on each lens in a " +
      "single request.",
  },
  {
    key: "grounded",
    title: "Grounded in your business",
    body:
      "Jurors judge against your saved brand guide and a researched summary of " +
      "your actual business — so feedback fits your market, not a generic rubric.",
  },
  {
    key: "rewrites",
    title: "Rewrites, not just red ink",
    body:
      "Every flagged issue comes with a constructive, ready-to-use rewrite that " +
      "keeps your facts and intent intact. Copy it, edit it, or ignore it.",
  },
  {
    key: "multi-format",
    title: "Text and image ads",
    body:
      "Review ad copy, a social post, or an email — or upload an image ad and " +
      "the jury reads the creative itself. Pick the platform and the lenses adapt.",
  },
  {
    key: "compliance",
    title: "Risk flagged before you publish",
    body:
      "The Compliance & Legal juror surfaces unsubstantiated claims, missing " +
      "disclaimers, and industry red flags — a compliance miss can veto the verdict.",
  },
  {
    key: "trends",
    title: "History and trends",
    body:
      "Every review is saved to your company's history with score and verdict " +
      "trends over time, exportable to CSV and PDF for the stakeholders who need them.",
  },
] as const;

/** The jury section's heading + intro. */
export const JURY_INTRO: SectionIntro = {
  key: "jury",
  eyebrow: "The jury",
  heading: "Six jurors, six expert lenses",
  intro:
    "Each juror scores only its own lens, so you see exactly where a piece is " +
    "strong and where it needs work — never one blurred opinion.",
} as const;

/**
 * The jury as shown on the landing page, derived from the single source of
 * truth: the real `PERSONAS` array the orchestrator runs. Deriving it here (vs.
 * re-typing the roster in marketing copy) guarantees the landing page can never
 * drift out of sync with the jury that actually reviews content — if a juror is
 * added, renamed, or re-lensed, this list follows. Prompt text is deliberately
 * dropped; the landing page shows only the public title + lens.
 */
export function jurySummaries(): readonly JurorSummary[] {
  return PERSONAS.map((p) => ({
    name: p.name,
    title: p.title,
    lens: p.lens,
  }));
}

/** The how-it-works section's heading + intro. */
export const HOW_IT_WORKS_INTRO: SectionIntro = {
  key: "how-it-works",
  eyebrow: "How it works",
  heading: "From draft to decision in one step",
  intro:
    "AdJury is a review layer, not a publisher — it tells you what to fix and " +
    "hands you the fix, then gets out of your way.",
} as const;

/**
 * The three-step flow, in order. Kept honest to what the product does: you
 * submit, the jury reviews in parallel against your context, and you get an
 * actionable scorecard — the human stays in control of what ships (Rules.md §1).
 */
export const HOW_IT_WORKS: readonly HowItWorksStep[] = [
  {
    key: "submit",
    step: 1,
    title: "Submit your draft",
    body:
      "Paste ad copy, a post, or an email — or upload an image ad — and pick the " +
      "platform you're publishing to.",
  },
  {
    key: "review",
    step: 2,
    title: "The jury reviews it",
    body:
      "All six jurors review in parallel against your brand guide and business " +
      "context, each scoring and explaining its own lens.",
  },
  {
    key: "decide",
    step: 3,
    title: "Act on the scorecard",
    body:
      "Read per-juror scores, an overall verdict, flagged risks, and ready-to-use " +
      "rewrites — then decide what ships. Nothing publishes on its own.",
  },
] as const;
