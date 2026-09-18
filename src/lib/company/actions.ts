"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { completeCompanyOnboarding } from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import {
  CompanyOnboardingSchema,
  firstOnboardingIssue,
} from "./onboarding";

/**
 * Company onboarding server action (DailyPlan Day 22). Logic lives here, not in
 * the form component (Rules.md §7). It re-derives the caller server-side —
 * `requireAdmin()` guarantees an authenticated *admin* and redirects otherwise,
 * so onboarding can never be completed by an unauthenticated or member caller —
 * validates the input with Zod, and writes with the service-role client
 * (companies has no client write policy). The `company_id` comes from the
 * resolved session, never the form (Rules.md §5).
 */
export interface OnboardingFormState {
  error?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function completeOnboardingAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const session = await requireAdmin();

  const parsed = CompanyOnboardingSchema.safeParse({
    name: field(formData, "name"),
    industry: field(formData, "industry"),
    plan_tier: field(formData, "plan_tier"),
  });
  if (!parsed.success) return { error: firstOnboardingIssue(parsed.error) };

  const admin = serverClient();
  try {
    await completeCompanyOnboarding(admin, session.companyId, parsed.data);
  } catch (err) {
    // Surface a plain message; keep internal detail in logs, no secrets/PII
    // (Rules.md §6).
    console.error("company onboarding failed", {
      op: "completeOnboardingAction",
      companyId: session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      error: "We couldn't save your company details. Please try again.",
    };
  }

  redirect("/dashboard");
}
