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
 * Scope note: this file owns the **hero + value proposition** only (Day 57). The
 * detailed features / six-jurors / how-it-works body is Day 58, and the social
 * proof + CTA + footer is Day 59.
 */

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
