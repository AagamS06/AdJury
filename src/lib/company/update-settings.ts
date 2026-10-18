/**
 * Update-company-settings core (DailyPlan Day 50).
 *
 * Kept out of the server action (like `update-role.ts` / `save-brand-profile.ts`)
 * so the decision logic is unit-testable without Next's request plumbing or a
 * live database: identity and the DB write are injected. The action wires the
 * real dependency (the service-role client, since `companies` has no client write
 * policy — mirroring the Day 22 onboarding and Day 16 weights write paths).
 *
 * Authz + tenancy are non-negotiable (Rules.md §5): only an authenticated admin
 * may change company settings (401/403 fail closed), and the write is scoped to
 * the server-derived company id, never client input. The action re-derives the
 * caller with `requireAdmin()`; this core's 403 is defense-in-depth and the
 * directly-testable trust boundary. An unchanged plan is an idempotent no-op so
 * a resubmit doesn't issue a pointless write.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { CompanyRow, PlanTier } from "@/types/db";
import { CompanySettingsSchema, firstSettingsIssue } from "./settings";
import { logError, errorContext } from "@/lib/observability/logger";

export type UpdateSettingsResult =
  | { ok: true; status: 200; company: CompanyRow; changed: boolean }
  | { ok: false; status: 400 | 401 | 403 | 500; error: string };

export interface UpdateSettingsDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: { plan_tier: string };
  /** Persist the new plan tier, wired to `updateCompanyPlanTier`; company-scoped. */
  update: (params: {
    companyId: string;
    planTier: PlanTier;
  }) => Promise<CompanyRow>;
}

export async function updateCompanySettings(
  deps: UpdateSettingsDeps,
): Promise<UpdateSettingsResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Admin-only surface (Rules.md §5); enforced on the server, not just hidden
    // in the UI. Never write for a member even if the page gate were bypassed.
    return {
      ok: false,
      status: 403,
      error: "Only an admin can change company settings.",
    };
  }

  const parsed = CompanySettingsSchema.safeParse(deps.input);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstSettingsIssue(parsed.error) };
  }
  const { plan_tier: planTier } = parsed.data;
  const companyId = deps.session.companyId;

  // Idempotent no-op: already on the requested plan, so skip the write.
  if (deps.session.company.plan_tier === planTier) {
    return { ok: true, status: 200, company: deps.session.company, changed: false };
  }

  let company: CompanyRow;
  try {
    company = await deps.update({ companyId, planTier });
  } catch (err) {
    // Redacted log; plain user message (Rules.md §6).
    logError("company settings update failed", {
      op: "updateCompanySettings/update",
      companyId,
      ...errorContext(err),
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't save your settings. Please try again.",
    };
  }

  return { ok: true, status: 200, company, changed: true };
}
