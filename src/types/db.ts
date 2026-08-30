/**
 * Row types for the AdJury Postgres schema (Architecture.md §3,
 * supabase/migrations/0001_init.sql). Hand-written to mirror the SQL exactly;
 * if the migration changes, update these together. When the query layer grows
 * we can swap these for Supabase-generated types without touching call sites.
 */
import type { Confidence, Issue, PersonaName, Verdict } from "@/lib/schema/juror";

export type PlanTier = "free" | "pro" | "enterprise";
export type UserRole = "admin" | "member";
export type ContentType = "ad_copy" | "social_post" | "email" | "landing_page";
export type PersonaScoreStatus = "ok" | "error";

export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  plan_tier: PlanTier;
  created_at: string;
}

export interface UserRow {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface BrandProfileRow {
  id: string;
  company_id: string;
  tone_guide_text: string | null;
  embedding_ref: string | null;
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
