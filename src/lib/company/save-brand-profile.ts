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
 * one.
 *
 * Brand-voice cache (DailyPlan Day 29): on every save we compute a bounded
 * brand-voice summary + a cache key from the submitted guide and store them
 * (`brand_summary` + `embedding_ref`), so a review reuses the cached summary
 * instead of reprocessing the full guide (Day 30 reads it). The computation is
 * skipped when the guide is unchanged from the stored one (`isBrandCacheFresh`),
 * so the summary is computed once per real change, not on every idempotent save.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { BrandProfileRow } from "@/types/db";
import {
  computeBrandVoiceCache,
  isBrandCacheFresh,
  type BrandVoiceCache,
} from "./brand-cache";
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
  /**
   * Insert the first brand profile, wired to `insertBrandProfile`. The
   * brand-voice cache (`embeddingRef` + `summary`, Day 29) is computed here and
   * stored alongside the guide.
   */
  insert: (params: {
    companyId: string;
    toneGuideText: string;
    embeddingRef: string;
    summary: string;
  }) => Promise<BrandProfileRow>;
  /**
   * Update an existing brand profile, wired to `updateBrandProfile`; id + company
   * scoped. The recomputed brand-voice cache is written alongside the guide so
   * the cache never drifts from the stored text (Day 29).
   */
  update: (params: {
    id: string;
    companyId: string;
    toneGuideText: string;
    embeddingRef: string;
    summary: string;
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

  // Compute the brand-voice cache once per real change (Day 29). When the stored
  // guide is unchanged, reuse its cached artifacts rather than recomputing — the
  // summary is computed once per update, and an idempotent save does no extra
  // work. `isBrandCacheFresh` guards on the version tag too, so a summarizer
  // bump recomputes even an unchanged guide.
  const cache: BrandVoiceCache =
    existing && isBrandCacheFresh(existing, toneGuideText)
      ? { embeddingRef: existing.embedding_ref!, summary: existing.brand_summary! }
      : computeBrandVoiceCache(toneGuideText);

  try {
    if (existing) {
      const profile = await deps.update({
        id: existing.id,
        companyId,
        toneGuideText,
        embeddingRef: cache.embeddingRef,
        summary: cache.summary,
      });
      return { ok: true, status: 200, profile, created: false };
    }
    const profile = await deps.insert({
      companyId,
      toneGuideText,
      embeddingRef: cache.embeddingRef,
      summary: cache.summary,
    });
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
