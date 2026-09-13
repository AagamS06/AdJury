import type { JurorSlot, Verdict } from "@/lib/schema/juror";
import { PERSONA_NAMES } from "@/lib/schema/juror";
import type { PersonaWeights, PersonaWeightsConfig } from "@/lib/schema/weights";

/** Default equal weights (PRD.md §5.2): every juror counts the same (0.2). */
export const DEFAULT_PERSONA_WEIGHTS: PersonaWeights = {
  brand_voice_guardian: 0.2,
  compliance_legal_flagger: 0.2,
  target_audience_fit: 0.2,
  seo_discoverability: 0.2,
  stop_scrolling: 0.2,
};

/**
 * Resolve a stored per-company weight config into a complete, safe weight map
 * (DailyPlan Day 16). Starts from the equal default and overrides only the
 * jurors the config specifies with a valid value, so a partial config leaves
 * the rest at their default weight. Config is untrusted input (it may be null,
 * partial, or malformed jsonb), so each value is checked and an all-zero result
 * falls back to the equal default rather than producing a NaN aggregate later
 * (Rules.md §3/§6 — validate before trust, fail safe).
 */
export function resolveWeights(
  stored: PersonaWeightsConfig | null | undefined,
): PersonaWeights {
  const resolved: PersonaWeights = { ...DEFAULT_PERSONA_WEIGHTS };
  if (stored) {
    for (const persona of PERSONA_NAMES) {
      const value = stored[persona];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        resolved[persona] = value;
      }
    }
  }
  const total = PERSONA_NAMES.reduce((sum, persona) => sum + resolved[persona], 0);
  return total > 0 ? resolved : { ...DEFAULT_PERSONA_WEIGHTS };
}

type OkSlot = Extract<JurorSlot, { status: "ok" }>;

function isOk(slot: JurorSlot): slot is OkSlot {
  return slot.status === "ok";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Weighted mean of the juror scores. Error jurors are excluded and the
 * remaining weights are renormalized so the aggregate stays on a 0-10 scale.
 * `weights` defaults to the equal default, so existing callers are unchanged;
 * a per-company config (resolved via `resolveWeights`) makes the aggregate
 * honor custom weights (DailyPlan Day 16).
 */
export function computeAggregate(
  jurors: JurorSlot[],
  weights: PersonaWeights = DEFAULT_PERSONA_WEIGHTS,
): number {
  const ok = jurors.filter(isOk);
  if (ok.length === 0) return 0;
  const totalWeight = ok.reduce((sum, j) => sum + weights[j.persona], 0);
  if (totalWeight === 0) return 0;
  const weighted = ok.reduce(
    (sum, j) => sum + j.score * weights[j.persona],
    0,
  );
  return round1(weighted / totalWeight);
}

/**
 * Derive the verdict (PRD.md §5.2). The compliance juror can veto to `fail`
 * regardless of the aggregate.
 */
export function deriveVerdict(aggregate: number, jurors: JurorSlot[]): Verdict {
  const compliance = jurors
    .filter(isOk)
    .find((j) => j.persona === "compliance_legal_flagger");

  const complianceVeto =
    compliance !== undefined &&
    (compliance.score <= 2 ||
      compliance.issues.some((i) => i.severity === "high"));

  if (complianceVeto) return "fail";
  if (aggregate < 5.0) return "fail";
  if (aggregate < 7.5) return "revise";

  const anyMedium = jurors
    .filter(isOk)
    .some((j) => j.issues.some((i) => i.severity === "medium"));
  if (anyMedium) return "revise";

  return "pass";
}
