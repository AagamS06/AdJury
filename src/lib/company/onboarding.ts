/**
 * First-admin company onboarding (DailyPlan Day 22).
 *
 * A brand-new company is auto-provisioned at signup with only a name (Day 3).
 * Onboarding is where the first admin names/renames it and sets its industry +
 * plan tier, turning it into a usable, described company context. This module
 * owns the pure pieces — the option lists, the input contract, and the
 * "needs onboarding?" predicate — so they are unit-testable without a database
 * or React; the DB write lives in `queries.ts`, the server action in
 * `actions.ts`, and the form in `components/company/onboarding-form.tsx`.
 *
 * The plan tier chosen here is a scaffold selection, not a paid entitlement:
 * billing is wired later (PRD §6.3, Week 11). It drives the per-plan review
 * rate limits today (Day 17), so the option copy shows each tier's allowance.
 */
import { z } from "zod";
import { PLAN_RATE_LIMITS } from "@/lib/rate-limit";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * Industry select options. The `value` is what we store in `companies.industry`;
 * the `label` is display-only. A curated set keeps the field structured (useful
 * later for industry-aware compliance guidance) while `other` covers the rest.
 */
export const INDUSTRY_OPTIONS = [
  { value: "ecommerce", label: "E-commerce & DTC" },
  { value: "retail", label: "Retail & consumer goods" },
  { value: "saas", label: "SaaS & software" },
  { value: "technology", label: "Technology & hardware" },
  { value: "finance", label: "Finance & fintech" },
  { value: "healthcare", label: "Healthcare & wellness" },
  { value: "education", label: "Education & e-learning" },
  { value: "real_estate", label: "Real estate & property" },
  { value: "hospitality", label: "Hospitality & travel" },
  { value: "media", label: "Media & entertainment" },
  { value: "marketing_agency", label: "Marketing & creative agency" },
  { value: "nonprofit", label: "Nonprofit & public sector" },
  { value: "professional_services", label: "Professional services" },
  { value: "other", label: "Other" },
] as const;

export type IndustryValue = (typeof INDUSTRY_OPTIONS)[number]["value"];

const INDUSTRY_VALUES = INDUSTRY_OPTIONS.map((o) => o.value) as [
  IndustryValue,
  ...IndustryValue[],
];

/** The three plan tiers, ordered for display, with a short positioning line. */
export const PLAN_TIER_OPTIONS = [
  {
    value: "free",
    label: "Free",
    tagline: "Try AdJury and review your highest-stakes content.",
  },
  {
    value: "pro",
    label: "Pro",
    tagline: "For active teams shipping content across channels.",
  },
  {
    value: "enterprise",
    label: "Enterprise",
    tagline: "High-volume review for larger marketing orgs.",
  },
] as const satisfies readonly { value: PlanTier; label: string; tagline: string }[];

/**
 * Onboarding input contract (Rules.md §3 — validate before trust). The same
 * schema guards the server action so a malformed or spoofed submit is rejected
 * at the boundary. Tenancy (`company_id`) is never part of this — it is derived
 * from the session server-side (Rules.md §5).
 */
export const CompanyOnboardingSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(120, "Company name must be 120 characters or fewer."),
  industry: z.enum(INDUSTRY_VALUES, {
    errorMap: () => ({ message: "Choose your industry." }),
  }),
  plan_tier: z.enum(["free", "pro", "enterprise"], {
    errorMap: () => ({ message: "Choose a plan." }),
  }),
});

export type CompanyOnboardingInput = z.infer<typeof CompanyOnboardingSchema>;

/**
 * Whether a company still needs first-admin onboarding. `onboarded_at` is the
 * explicit signal stamped when the admin completes the form; null (or absent)
 * means not yet onboarded. Kept as a pure predicate so both the route gate and
 * tests read it the same way.
 */
export function needsOnboarding(
  company: Pick<CompanyRow, "onboarded_at">,
): boolean {
  return company.onboarded_at == null;
}

/** Display label for a stored industry value (unknown/absent → the raw value/null). */
export function industryLabel(value: string | null): string | null {
  if (!value) return null;
  return INDUSTRY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Display label for a plan tier. */
export function planTierLabel(tier: PlanTier): string {
  return PLAN_TIER_OPTIONS.find((o) => o.value === tier)?.label ?? tier;
}

/** Reviews per day a plan allows (from the rate-limit policy — single source). */
export function planReviewAllowance(tier: PlanTier): number {
  return PLAN_RATE_LIMITS[tier].limit;
}

/** First human-readable validation message, for surfacing in the form. */
export function firstOnboardingIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
