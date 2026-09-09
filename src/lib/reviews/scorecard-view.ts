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

/**
 * A count of how a review's jurors fared (DailyPlan Day 13 — states &
 * resilience). A single juror that fails to return valid JSON is stored as an
 * `error` slot (Rules.md §6), so a rendered review can legitimately carry a mix
 * of scored and errored jurors — the scorecard needs to say so rather than
 * silently showing fewer cards.
 */
export interface JurorHealth {
  /** Total juror slots on the review. */
  total: number;
  /** Slots that returned a valid, scored result. */
  scored: number;
  /** Slots that failed and were recorded as `error`. */
  errored: number;
  /** Every slot errored (and there is at least one slot). */
  allErrored: boolean;
  /** Some — but not all — slots errored. */
  someErrored: boolean;
}

/** Summarise how many jurors scored vs. errored for a review. */
export function summarizeJurorHealth(jurors: JurorSlot[]): JurorHealth {
  const total = jurors.length;
  const errored = jurors.reduce(
    (n, j) => (j.status === "error" ? n + 1 : n),
    0,
  );
  return {
    total,
    scored: total - errored,
    errored,
    allErrored: total > 0 && errored === total,
    someErrored: errored > 0 && errored < total,
  };
}

/** A degraded-review banner: a plain-language message with a semantic tone. */
export interface JurorHealthNotice {
  tone: "warning" | "danger";
  message: string;
}

/**
 * The banner (if any) a scorecard should show above its juror cards. `null`
 * means every juror scored — no banner needed. A partial failure is a
 * `warning` (the review is still useful); no jurors at all — an empty review or
 * every juror failing — is a `danger` state that invites a retry (Rules.md §6).
 */
export function jurorHealthNotice(health: JurorHealth): JurorHealthNotice | null {
  if (health.total === 0) {
    return {
      tone: "danger",
      message: "This review has no juror results to show. Try running it again.",
    };
  }
  if (health.allErrored) {
    return {
      tone: "danger",
      message: `None of the ${health.total} jurors could be scored for this review. Try running it again.`,
    };
  }
  if (health.someErrored) {
    // `someErrored` implies total ≥ 2, so "jurors" always agrees with the total.
    return {
      tone: "warning",
      message: `${health.errored} of ${health.total} jurors couldn't be scored. The aggregate reflects only the jurors that returned a result.`,
    };
  }
  return null;
}
