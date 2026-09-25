/**
 * Typed data-access helpers (Architecture.md §4, DailyPlan Day 2).
 *
 * Every helper takes an explicit `SupabaseClient` so the caller decides the
 * tenancy context: a request-scoped client relies on RLS, while the
 * service-role `serverClient()` bypasses RLS and MUST pass `companyId`
 * explicitly (never trust a client-supplied one — Rules.md §5). These helpers
 * never resolve `company_id` themselves; the API layer derives it from the
 * session and hands it in.
 *
 * Errors are surfaced, never swallowed (Rules.md §6): a failed query throws
 * with context but no user content or secrets.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JurorSlot, ReviewResult } from "@/lib/schema/juror";
import {
  PersonaWeightsInputSchema,
  type PersonaWeightsInput,
} from "@/lib/schema/weights";
import type {
  BrandProfileRow,
  CompanyRow,
  ContentType,
  InvitationRow,
  PersonaScoreRow,
  PlanTier,
  ReviewRow,
  ReviewWithScores,
  UserRole,
  UserRow,
} from "@/types/db";

/** Wrap a Supabase error into a thrown Error with operation context (no PII). */
function fail(op: string, error: { message: string; code?: string }): never {
  const code = error.code ? ` [${error.code}]` : "";
  throw new Error(`db.${op} failed${code}: ${error.message}`);
}

// ── companies ───────────────────────────────────────────────────────────

export async function getCompanyById(
  db: SupabaseClient,
  id: string,
): Promise<CompanyRow | null> {
  const { data, error } = await db
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getCompanyById", error);
  return (data as CompanyRow | null) ?? null;
}

export interface InsertCompanyParams {
  name: string;
  industry?: string | null;
  plan_tier?: PlanTier;
}

export async function insertCompany(
  db: SupabaseClient,
  params: InsertCompanyParams,
): Promise<CompanyRow> {
  const { data, error } = await db
    .from("companies")
    .insert({
      name: params.name,
      industry: params.industry ?? null,
      plan_tier: params.plan_tier ?? "free",
    })
    .select("*")
    .single();
  if (error) fail("insertCompany", error);
  return data as CompanyRow;
}

/**
 * Set a company's juror weights (DailyPlan Day 16 scaffold; admin-only edit UI
 * lands later). Tenancy is explicit and server-derived — `companyId` comes from
 * the session, never the client (Rules.md §5) — and the config is validated
 * against `PersonaWeightsInputSchema` before it touches the DB (Rules.md §3),
 * so a malformed weight map is rejected rather than stored. Passing `null`
 * clears the config back to the equal default.
 */
export async function updateCompanyJurorWeights(
  db: SupabaseClient,
  companyId: string,
  weights: PersonaWeightsInput | null,
): Promise<CompanyRow> {
  const juror_weights =
    weights === null ? null : PersonaWeightsInputSchema.parse(weights);
  const { data, error } = await db
    .from("companies")
    .update({ juror_weights })
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) fail("updateCompanyJurorWeights", error);
  return data as CompanyRow;
}

export interface CompleteOnboardingParams {
  name: string;
  industry: string;
  plan_tier: PlanTier;
}

/**
 * Complete first-admin onboarding for a company (DailyPlan Day 22): set the
 * name, industry, and plan tier, and stamp `onboarded_at` so the company reads
 * as onboarded from then on. Tenancy is explicit and server-derived — `companyId`
 * comes from the session, never the client (Rules.md §5) — and the fields are
 * pre-validated by `CompanyOnboardingSchema` in the calling action (Rules.md §3).
 * Runs under the service-role client because `companies` has no client write
 * policy (writes are server-side, admin-gated), mirroring the Day 16 weights
 * write path. `now` is injectable so the stamped timestamp is deterministic in
 * tests.
 */
export async function completeCompanyOnboarding(
  db: SupabaseClient,
  companyId: string,
  params: CompleteOnboardingParams,
  now: Date = new Date(),
): Promise<CompanyRow> {
  const { data, error } = await db
    .from("companies")
    .update({
      name: params.name,
      industry: params.industry,
      plan_tier: params.plan_tier,
      onboarded_at: now.toISOString(),
    })
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) fail("completeCompanyOnboarding", error);
  return data as CompanyRow;
}

// ── users ───────────────────────────────────────────────────────────────

export async function getUserById(
  db: SupabaseClient,
  id: string,
): Promise<UserRow | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getUserById", error);
  return (data as UserRow | null) ?? null;
}

export async function listUsersByCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<UserRow[]> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) fail("listUsersByCompany", error);
  return (data as UserRow[] | null) ?? [];
}

/**
 * Find a company member by email (case-insensitive), or null. Used to stop an
 * admin from inviting someone who is already on the team (Day 24). Tenancy is
 * explicit — `companyId` is server-derived (never the client — Rules.md §5).
 */
export async function findCompanyMemberByEmail(
  db: SupabaseClient,
  companyId: string,
  email: string,
): Promise<UserRow | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("company_id", companyId)
    .ilike("email", email)
    .maybeSingle();
  if (error) fail("findCompanyMemberByEmail", error);
  return (data as UserRow | null) ?? null;
}

/**
 * Change a user's role (DailyPlan Day 25 — promote/demote). Scoped by BOTH
 * `id` and `company_id`, both server-derived (never the client — Rules.md §5),
 * so a service-role write can never touch a user in another company even if
 * handed a foreign id. Runs under the service-role client because `users` has
 * no client write policy (writes are server-side, admin-gated). The authz
 * (admin-only) and last-admin guards live in `update-role.ts`; this helper just
 * writes the already-validated role.
 */
export async function updateUserRole(
  db: SupabaseClient,
  companyId: string,
  userId: string,
  role: UserRole,
): Promise<UserRow> {
  const { data, error } = await db
    .from("users")
    .update({ role })
    .eq("id", userId)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (error) fail("updateUserRole", error);
  return data as UserRow;
}

export interface InsertUserParams {
  /** Must match an existing auth.users id (users.id references auth.users). */
  id: string;
  company_id: string;
  email: string;
  role?: UserRole;
}

export async function insertUser(
  db: SupabaseClient,
  params: InsertUserParams,
): Promise<UserRow> {
  const { data, error } = await db
    .from("users")
    .insert({
      id: params.id,
      company_id: params.company_id,
      email: params.email,
      role: params.role ?? "member",
    })
    .select("*")
    .single();
  if (error) fail("insertUser", error);
  return data as UserRow;
}

// ── brand_profiles ──────────────────────────────────────────────────────

export async function getBrandProfileByCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<BrandProfileRow | null> {
  const { data, error } = await db
    .from("brand_profiles")
    .select("*")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("getBrandProfileByCompany", error);
  return (data as BrandProfileRow | null) ?? null;
}

export interface UpsertBrandProfileParams {
  company_id: string;
  tone_guide_text?: string | null;
  /** Brand-voice cache key (Day 29): version tag + hash of the normalized guide. */
  embedding_ref?: string | null;
  /** Cached, bounded brand-voice summary computed on save (Day 29). */
  brand_summary?: string | null;
}

/**
 * Insert the first brand profile for a company (DailyPlan Day 26). A company has
 * at most one guide; when one already exists, callers update it in place via
 * `updateBrandProfile` instead. `company_id` must come from the session, never
 * the client (Rules.md §5). The brand-voice cache (`embedding_ref` +
 * `brand_summary`, Day 29) is computed by the save core and stored here.
 */
export async function insertBrandProfile(
  db: SupabaseClient,
  params: UpsertBrandProfileParams,
): Promise<BrandProfileRow> {
  const { data, error } = await db
    .from("brand_profiles")
    .insert({
      company_id: params.company_id,
      tone_guide_text: params.tone_guide_text ?? null,
      embedding_ref: params.embedding_ref ?? null,
      brand_summary: params.brand_summary ?? null,
    })
    .select("*")
    .single();
  if (error) fail("insertBrandProfile", error);
  return data as BrandProfileRow;
}

export interface UpdateBrandProfileParams {
  tone_guide_text: string | null;
  /** Brand-voice cache key (Day 29). Passed together with `brand_summary`. */
  embedding_ref?: string | null;
  /** Recomputed brand-voice summary (Day 29). */
  brand_summary?: string | null;
}

/**
 * Update an existing brand profile's tone guide in place (DailyPlan Day 26).
 * Scoped by BOTH `id` and `company_id` so a service-role write can never touch
 * another company's row even if handed a foreign id (Rules.md §5) — the same
 * defense-in-depth as `updateUserRole`. `updated_at` is bumped explicitly since
 * an UPDATE does not re-run the column default. The brand-voice cache
 * (`embedding_ref` + `brand_summary`, Day 29) is recomputed by the save core and
 * written alongside the guide so the cache never drifts from the stored text;
 * both are only included when the caller supplies them.
 */
export async function updateBrandProfile(
  db: SupabaseClient,
  id: string,
  companyId: string,
  params: UpdateBrandProfileParams,
): Promise<BrandProfileRow> {
  const patch: Record<string, unknown> = {
    tone_guide_text: params.tone_guide_text,
    updated_at: new Date().toISOString(),
  };
  if (params.embedding_ref !== undefined) patch.embedding_ref = params.embedding_ref;
  if (params.brand_summary !== undefined) patch.brand_summary = params.brand_summary;

  const { data, error } = await db
    .from("brand_profiles")
    .update(patch)
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .single();
  if (error) fail("updateBrandProfile", error);
  return data as BrandProfileRow;
}

// ── invitations ─────────────────────────────────────────────────────────

export interface InsertInvitationParams {
  company_id: string;
  email: string;
  role: UserRole;
  /** SHA-256 hex of the raw token (the raw token is never stored — Day 24). */
  token_hash: string;
  invited_by: string;
  expires_at: string;
}

/**
 * Create a pending invitation. Runs under the service-role client (invitations
 * has no client write policy — writes are server-side, admin-gated). The caller
 * derives `company_id`/`invited_by` from the session, never the client
 * (Rules.md §5), and passes only the token HASH.
 */
export async function insertInvitation(
  db: SupabaseClient,
  params: InsertInvitationParams,
): Promise<InvitationRow> {
  const { data, error } = await db
    .from("invitations")
    .insert({
      company_id: params.company_id,
      email: params.email,
      role: params.role,
      token_hash: params.token_hash,
      invited_by: params.invited_by,
      expires_at: params.expires_at,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) fail("insertInvitation", error);
  return data as InvitationRow;
}

/**
 * Look up an invitation by its token hash (the presented raw token is hashed
 * first — Day 24). Returns null when no invite matches. Acceptance uses the
 * service-role client because the invitee is typically not yet a company member
 * (RLS would otherwise hide the row); the token itself is the bearer credential.
 */
export async function getInvitationByTokenHash(
  db: SupabaseClient,
  tokenHash: string,
): Promise<InvitationRow | null> {
  const { data, error } = await db
    .from("invitations")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) fail("getInvitationByTokenHash", error);
  return (data as InvitationRow | null) ?? null;
}

/** List a company's invitations, newest first (index: invitations(company_id, created_at desc)). */
export async function listInvitationsByCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<InvitationRow[]> {
  const { data, error } = await db
    .from("invitations")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) fail("listInvitationsByCompany", error);
  return (data as InvitationRow[] | null) ?? [];
}

/**
 * Mark an invitation accepted and stamp `accepted_at`. Scoped by id (the invite
 * was already resolved from its token hash). `now` is injectable for
 * deterministic tests.
 */
export async function markInvitationAccepted(
  db: SupabaseClient,
  id: string,
  now: Date = new Date(),
): Promise<InvitationRow> {
  const { data, error } = await db
    .from("invitations")
    .update({ status: "accepted", accepted_at: now.toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail("markInvitationAccepted", error);
  return data as InvitationRow;
}

// ── reviews + persona_scores ────────────────────────────────────────────

/**
 * Map one composed juror slot to a persona_scores insert row. Pure and
 * exported so the mapping is unit-testable without a database. An `error`
 * juror stores its diagnostic in feedback_text and null scores (Rules.md §6:
 * a failed juror is recorded, never dropped or reported as success).
 */
export function jurorSlotToScoreRow(
  reviewId: string,
  slot: JurorSlot,
): Omit<PersonaScoreRow, "id"> {
  if (slot.status === "ok") {
    return {
      review_id: reviewId,
      persona_name: slot.persona,
      score: slot.score,
      confidence: slot.confidence,
      feedback_text: slot.summary,
      issues_json: slot.issues,
      suggested_rewrite: slot.suggested_rewrite,
      status: "ok",
    };
  }
  return {
    review_id: reviewId,
    persona_name: slot.persona,
    score: null,
    confidence: null,
    feedback_text: slot.error,
    issues_json: [],
    suggested_rewrite: null,
    status: "error",
  };
}

export interface InsertReviewParams {
  companyId: string;
  submittedBy: string;
  content_text: string;
  /** The composed result from the orchestrator (its review_id becomes the row id). */
  review: ReviewResult;
}

/**
 * Persist a review and its five persona_scores. The review row's id is the
 * orchestrator's `review_id`, so the API response and the stored row share one
 * identifier. If the persona_scores write fails, the review row is removed so
 * we never leave a review without its scores (Rules.md §6 — DB write failure).
 */
export async function insertReviewWithScores(
  db: SupabaseClient,
  params: InsertReviewParams,
): Promise<ReviewWithScores> {
  const { review } = params;

  const { data: reviewRow, error: reviewErr } = await db
    .from("reviews")
    .insert({
      id: review.review_id,
      company_id: params.companyId,
      submitted_by: params.submittedBy,
      content_text: params.content_text,
      content_type: review.content_type as ContentType,
      platform: review.platform,
      aggregate_score: review.aggregate_score,
      verdict: review.verdict,
    })
    .select("*")
    .single();
  if (reviewErr) fail("insertReviewWithScores/review", reviewErr);
  const persistedReview = reviewRow as ReviewRow;

  const scoreRows = review.jurors.map((slot) =>
    jurorSlotToScoreRow(persistedReview.id, slot),
  );

  const { data: scores, error: scoreErr } = await db
    .from("persona_scores")
    .insert(scoreRows)
    .select("*");
  if (scoreErr) {
    // Roll back the orphaned review; persona_scores cascade on delete.
    await db.from("reviews").delete().eq("id", persistedReview.id);
    fail("insertReviewWithScores/scores", scoreErr);
  }

  return { review: persistedReview, scores: (scores as PersonaScoreRow[]) ?? [] };
}

/**
 * Fetch a review with its persona_scores. Pass `companyId` when using a
 * service-role client to enforce tenancy explicitly; returns null if the row
 * is absent or belongs to another company (never reveal cross-tenant existence
 * — Rules.md §6).
 */
export async function getReviewById(
  db: SupabaseClient,
  id: string,
  companyId?: string,
): Promise<ReviewWithScores | null> {
  let query = db.from("reviews").select("*").eq("id", id);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: reviewRow, error: reviewErr } = await query.maybeSingle();
  if (reviewErr) fail("getReviewById/review", reviewErr);
  if (!reviewRow) return null;
  const review = reviewRow as ReviewRow;

  const { data: scores, error: scoreErr } = await db
    .from("persona_scores")
    .select("*")
    .eq("review_id", review.id);
  if (scoreErr) fail("getReviewById/scores", scoreErr);

  return { review, scores: (scores as PersonaScoreRow[]) ?? [] };
}

/** Review usage within a rolling rate-limit window (DailyPlan Day 17). */
export interface ReviewRateUsage {
  /** Reviews the company created at or after `sinceIso`. */
  count: number;
  /** ISO created_at of the oldest review in the window, or null if none. */
  oldest: string | null;
}

/**
 * Count a company's reviews created since `sinceIso` and return the oldest one's
 * timestamp, for per-plan rate limiting (`src/lib/rate-limit.ts`). Tenancy is
 * explicit: `companyId` is server-derived (never the client — Rules.md §5). A
 * single exact-count query returns the total (independent of the row limit) plus
 * the oldest row, so only one row crosses the wire regardless of the count.
 */
export async function getReviewRateUsage(
  db: SupabaseClient,
  companyId: string,
  sinceIso: string,
): Promise<ReviewRateUsage> {
  const { data, error, count } = await db
    .from("reviews")
    .select("created_at", { count: "exact" })
    .eq("company_id", companyId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) fail("getReviewRateUsage", error);
  const oldest = (data as { created_at: string }[] | null)?.[0]?.created_at ?? null;
  return { count: count ?? 0, oldest };
}

export interface ListReviewsOptions {
  limit?: number;
}

/** List a company's reviews, newest first (index: reviews(company_id, created_at desc)). */
export async function listReviewsByCompany(
  db: SupabaseClient,
  companyId: string,
  options: ListReviewsOptions = {},
): Promise<ReviewRow[]> {
  const limit = options.limit ?? 50;
  const { data, error } = await db
    .from("reviews")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("listReviewsByCompany", error);
  return (data as ReviewRow[] | null) ?? [];
}
