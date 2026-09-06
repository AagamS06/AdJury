/**
 * Pure presentation helpers for the Scorecard / JurorCard UI (DailyPlan
 * Days 9–10).
 *
 * Kept out of the React components (like `review-form.ts` for Day 8) so the
 * display logic — score/verdict formatting, the score→tone and verdict→tone
 * mappings, and the severity/confidence labels — is unit-testable in the node
 * test env without a browser.
 *
 * A "tone" is a semantic role, not a colour: the components map a tone to
 * Tailwind classes. Meaning is always carried by a text label too, never by
 * colour alone (Design.md §6).
 *
 * Day 10 formalises the verdict/score visual system: the full **5-tier**
 * score→colour mapping (Design.md §5), a paired text tier label for every
 * band, severity→tone for issue styling, and the **compliance-flag override**
 * (a compliance juror that flags issues always reads in the Burgundy/Danger
 * family, regardless of its numeric score — Design.md §2).
 */
import type { JurorSlot, Severity, Verdict } from "@/lib/schema/juror";

/**
 * Semantic colour roles used by the scorecard. `neutral` = not scored / N/A.
 * `warning-deep` is the distinct 3–4 score tier; `burgundy` is the
 * compliance-flag family (Design.md §2/§5).
 */
export type Tone =
  | "success"
  | "royal"
  | "warning"
  | "warning-deep"
  | "danger"
  | "burgundy"
  | "neutral";

/** The compliance/legal juror — its flags override the score→colour mapping. */
const COMPLIANCE_PERSONA = "compliance_legal_flagger";

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
 * Score (0–10) → chip tone. The full 5-tier mapping from Design.md §5:
 * 9–10 Success · 7–8 Royal · 5–6 Warning · 3–4 Warning-deep · 0–2 Danger.
 * This is the raw band; a compliance flag overrides it — see `jurorScoreTone`.
 */
export function scoreTone(score: number): Tone {
  if (score >= 9) return "success";
  if (score >= 7) return "royal";
  if (score >= 5) return "warning";
  if (score >= 3) return "warning-deep";
  return "danger";
}

/**
 * Score (0–10) → a short text tier label. The colour never travels alone
 * (Design.md §6): the chip shows the number and screen readers announce this
 * word, so the five bands are distinguishable without perceiving colour.
 */
export function scoreTierLabel(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Strong";
  if (score >= 5) return "Mixed";
  if (score >= 3) return "Weak";
  return "Failing";
}

/**
 * True when a juror slot is a compliance/legal flag that should override the
 * score→colour mapping: the compliance juror, scored, with at least one issue.
 * A clean compliance pass (no issues) keeps its normal score tone.
 */
export function hasComplianceFlags(juror: JurorSlot): boolean {
  return (
    juror.persona === COMPLIANCE_PERSONA &&
    juror.status === "ok" &&
    juror.issues.length > 0
  );
}

/**
 * The score-chip tone for a whole juror slot, applying the compliance-flag
 * override (Design.md §2: compliance flags always read Burgundy/Danger,
 * regardless of score). An errored slot has no score, so it reads neutral.
 */
export function jurorScoreTone(juror: JurorSlot): Tone {
  if (juror.status === "error") return "neutral";
  if (hasComplianceFlags(juror)) return "burgundy";
  return scoreTone(juror.score);
}

/**
 * Issue severity → tone (Design.md §5 issue-severity styling): high = Danger,
 * medium = Warning, low = neutral. A compliance flag overrides every severity
 * to the Burgundy family, so pass `compliance` for the compliance juror.
 */
export function issueTone(severity: Severity, compliance = false): Tone {
  if (compliance) return "burgundy";
  switch (severity) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "neutral";
  }
}

/** Severity → capitalised label (paired with, never replaced by, colour). */
export function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

/** Confidence → a short, screen-reader-friendly label for the juror header. */
export function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}
