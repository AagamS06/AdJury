/**
 * Row types for the AdJury Postgres schema (Architecture.md §3,
 * supabase/migrations/0001_init.sql). Hand-written to mirror the SQL exactly;
 * if the migration changes, update these together. When the query layer grows
 * we can swap these for Supabase-generated types without touching call sites.
 */
import type { Confidence, Issue, PersonaName, Verdict } from "@/lib/schema/juror";
import type { PersonaWeightsConfig } from "@/lib/schema/weights";

export type PlanTier = "free" | "pro" | "enterprise";
export type UserRole = "admin" | "member";
export type ContentType = "ad_copy" | "social_post" | "email" | "landing_page";
export type PersonaScoreStatus = "ok" | "error";
/** Stored lifecycle of an invitation row (Day 24). Expiry is derived from
 * `expires_at`, not stored as a status, so a row is never "stuck" expired. */
export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  plan_tier: PlanTier;
  /** Per-company juror weights (Day 16); null = the equal default (0.2 each). */
  juror_weights: PersonaWeightsConfig | null;
  /** When the first admin completed onboarding (Day 22); null = not yet onboarded. */
  onboarded_at: string | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  /** SHA-256 hex of the raw token; the raw token is never stored (Day 24). */
  token_hash: string;
  status: InvitationStatus;
  /** The admin who sent the invite; null if that user was later removed. */
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface BrandProfileRow {
  id: string;
  company_id: string;
  tone_guide_text: string | null;
  /** Content-addressed cache key for the derived summary (Day 29); null = no cache. */
  embedding_ref: string | null;
  /** Cached bounded brand-voice summary (Day 29); null = no cache yet. */
  brand_summary: string | null;
  updated_at: string;
}

export interface ReviewRow {
  id: string;
  company_id: string;
  submitted_by: string;
  content_text: string;
  content_type: ContentType;
  platform: string | null;
  aggregate_score: number | null;
  verdict: Verdict | null;
  created_at: string;
}

export interface PersonaScoreRow {
  id: string;
  review_id: string;
  persona_name: PersonaName;
  score: number | null;
  confidence: Confidence | null;
  feedback_text: string | null;
  issues_json: Issue[];
  suggested_rewrite: string | null;
  status: PersonaScoreStatus;
}

/** A persisted review joined with its five persona_scores rows. */
export interface ReviewWithScores {
  review: ReviewRow;
  scores: PersonaScoreRow[];
}
