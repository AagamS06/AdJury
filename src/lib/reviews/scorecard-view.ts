/**
 * Pure presentation helpers for the Scorecard / JurorCard UI (DailyPlan Day 9).
 *
 * Kept out of the React components (like `review-form.ts` for Day 8) so the
 * display logic — score/verdict formatting, the score→tone and verdict→tone
 * mappings, and the severity/confidence labels — is unit-testable in the node
 * test env without a browser.
 *
 * A "tone" is a semantic role, not a colour: the components map a tone to
 * Tailwind classes. Meaning is always carried by a text label too, never by
 * colour alone (Design.md §6). The full 5-tier score→colour system, the
 * compliance-flag override, and the issue-severity colour styling are formalised
 * on Day 10 — this Day-9 mapping is intentionally coarse.
 */
import type { Severity, Verdict } from "@/lib/schema/juror";

/** Semantic colour roles used by the scorecard. `neutral` = not scored / N/A. */
export type Tone = "success" | "royal" | "warning" | "danger" | "neutral";

/**
 * Format an aggregate score (0–10) for display. `null` — a persisted review
 * that was never scored — renders as an em dash rather than "0".
 */
export function formatAggregate(score: number | null): string {
  return score === null ? "—" : score.toFixed(1);
}

/** Verdict → human label (the word is always shown, never colour alone). */
export function verdictLabel(verdict: Verdict | null): string {
  switch (verdict) {
    case "pass":
      return "Pass";
    case "revise":
      return "Revise";
    case "fail":
      return "Fail";
    default:
      return "Not scored";
  }
}

/** Verdict → pill tone (Design.md §5: pass=Success, revise=Warning, fail=Danger). */
export function verdictTone(verdict: Verdict | null): Tone {
  switch (verdict) {
    case "pass":
      return "success";
    case "revise":
      return "warning";
    case "fail":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Score (0–10) → chip tone. Coarse Day-9 mapping onto the four palette tokens
 * we already have (Design.md §2): 9–10 Success · 7–8 Royal · 5–6 Warning ·
 * 0–4 Danger. Day 10 adds the distinct 3–4 tier and the compliance override.
 */
export function scoreTone(score: number): Tone {
  if (score >= 9) return "success";
  if (score >= 7) return "royal";
  if (score >= 5) return "warning";
  return "danger";
}

/** Severity → capitalised label (paired with, never replaced by, colour). */
export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

/** Confidence → a short, screen-reader-friendly label for the juror header. */
export function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}
