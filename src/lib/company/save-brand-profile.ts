/**
 * Save-brand-profile core (DailyPlan Day 26).
 *
 * Kept out of the server action (like `update-role.ts` / `read-team.ts`) so the
 * decision logic is unit-testable without Next's request plumbing or a live
 * database: identity, the existing-profile read, and the insert/update writes
 * are injected. The action wires the real dependencies (a request-scoped client
 * so the `brand_profiles` admin-write RLS policy is the DB-level guard).
 *
 * Authz + tenancy are non-negotiable (Rules.md §5): only an authenticated admin
 * may edit the brand guide (401/403 fail closed), and every read/write is scoped
 * to the server-derived company id, never client input. The action re-derives the
 * caller with `requireAdmin()` and the DB enforces the same via RLS; this core's
 * 403 is defense-in-depth and the directly-testable trust boundary.
 *
 * Create-or-edit: a company has one brand guide. If one already exists we update
 * it in place (scoped by its id AND company_id); otherwise we insert the first
 * one. The existing `embedding_ref` is left untouched — the brand-voice cache
 * (write/read) is Days 29–30.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { BrandProfileRow } from "@/types/db";
import { BrandProfileSchema, firstBrandProfileIssue } from "./brand-profile";

export type SaveBrandProfileResult =
  | { ok: true; status: 200; profile: BrandProfileRow; created: boolean }
  | { ok: false; status: 400 | 401 | 403 | 500; error: string };

export interface SaveBrandProfileDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: { tone_guide_text: string };
  /** Fetch the company's current brand profile, wired to `getBrandProfileByCompany`. */
  getExisting: (companyId: string) => Promise<BrandProfileRow | null>;
  /** Insert the first brand profile, wired to `insertBrandProfile`. */
  insert: (params: {
    companyId: string;
    toneGuideText: string;
  }) => Promise<BrandProfileRow>;
  /** Update an existing brand profile, wired to `updateBrandProfile`; id + company scoped. */
  update: (params: {
    id: string;
    companyId: string;
    toneGuideText: string;
  }) => Promise<BrandProfileRow>;
}

export async function saveBrandProfile(
  deps: SaveBrandProfileDeps,
): Promise<SaveBrandProfileResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Admin-only surface (Rules.md §5); enforced on the server, not just hidden
    // in the UI. Never write for a member even if the page gate were bypassed.
    return {
      ok: false,
      status: 403,
      error: "Only an admin can edit the brand profile.",
    };
  }

  const parsed = BrandProfileSchema.safeParse(deps.input);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstBrandProfileIssue(parsed.error) };
  }
  const toneGuideText = parsed.data.tone_guide_text;
  const companyId = deps.session.companyId;

  let existing: BrandProfileRow | null;
  try {
    existing = await deps.getExisting(companyId);
  } catch (err) {
    return failure("saveBrandProfile/getExisting", companyId, err);
  }

  try {
    if (existing) {
      const profile = await deps.update({
        id: existing.id,
        companyId,
        toneGuideText,
      });
      return { ok: true, status: 200, profile, created: false };
    }
    const profile = await deps.insert({ companyId, toneGuideText });
    return { ok: true, status: 200, profile, created: true };
  } catch (err) {
    return failure("saveBrandProfile/write", companyId, err);
  }
}

function failure(
  op: string,
  companyId: string,
  err: unknown,
): SaveBrandProfileResult {
  // Redacted log; plain user message (Rules.md §6) — never log the guide text.
  console.error("brand profile save failed", {
    op,
    companyId,
    message: err instanceof Error ? err.message : "unknown error",
  });
  return {
    ok: false,
    status: 500,
    error: "We couldn't save your brand profile. Please try again.",
  };
}
