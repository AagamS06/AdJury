import type { JurorSlot, PersonaName, Verdict } from "@/lib/schema/juror";

/** Default equal weights (PRD.md §5.2). Configurable per plan later. */
export const PERSONA_WEIGHTS: Record<PersonaName, number> = {
  brand_voice_guardian: 0.2,
  compliance_legal_flagger: 0.2,
  target_audience_fit: 0.2,
  seo_discoverability: 0.2,
  stop_scrolling: 0.2,
};

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
 */
export function computeAggregate(jurors: JurorSlot[]): number {
  const ok = jurors.filter(isOk);
  if (ok.length === 0) return 0;
  const totalWeight = ok.reduce((sum, j) => sum + PERSONA_WEIGHTS[j.persona], 0);
  if (totalWeight === 0) return 0;
  const weighted = ok.reduce(
    (sum, j) => sum + j.score * PERSONA_WEIGHTS[j.persona],
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
