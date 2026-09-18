import { requireAdmin } from "@/lib/auth/guard";
import { OnboardingForm } from "@/components/company/onboarding-form";

/**
 * First-admin company onboarding (DailyPlan Day 22).
 *
 * A standalone route (outside the `(dashboard)` group so the group's onboarding
 * redirect can't loop) with a focused, auth-style layout. `requireAdmin()` gates
 * it server-side — an anonymous caller goes to `/login`, a member to
 * `/dashboard` — and the resolved company row prefills the form so the admin
 * confirms/edits rather than re-typing. An already-onboarded admin can revisit
 * to edit; the form reads that from `onboarded_at` and adjusts its copy.
 */
export default async function OnboardingPage() {
  const session = await requireAdmin();
  const { company } = session;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <OnboardingForm
        companyName={company.name}
        industry={company.industry}
        planTier={company.plan_tier}
        alreadyOnboarded={company.onboarded_at != null}
      />
    </main>
  );
}
