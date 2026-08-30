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
import type {
  BrandProfileRow,
  CompanyRow,
  ContentType,
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
  embedding_ref?: string | null;
}

/**
 * Insert a brand profile for a company. (A richer upsert keyed on an existing
 * row lands with the brand-profile CRUD work in Week 4; for now a company has
 * at most one profile and this creates it.)
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
    })
    .select("*")
    .single();
  if (error) fail("insertBrandProfile", error);
  return data as BrandProfileRow;
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
