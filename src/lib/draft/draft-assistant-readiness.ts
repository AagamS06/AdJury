/**
 * Draft Assistant — readiness + reconcile (DailyPlan Day 87).
 *
 * The executable "the Draft Assistant drafts honest copy, and stays separate
 * from the jury" check and its offline drift guard — sibling to the core in
 * `draft-assistant.ts`, in the same pure-core + reconcile + readiness shape the
 * video days use (`short-form-readiness.ts`) and the Week-12 days use
 * (`demo-script.ts`). Everything here is pure and sync so it runs with no
 * network or credential; the only input the boundary scan needs is the core's
 * own source text, which the caller (`npm run draft:check` / the tests) reads —
 * exactly how the `*-audit` modules take source as input rather than reading it
 * themselves.
 */
import {
  AdDraftSchema,
  DRAFT_DISCLAIMER,
  MAX_BODY_CHARS,
  MAX_CTA_CHARS,
  MAX_DRAFT_VARIANTS,
  MAX_HEADLINE_CHARS,
  MIN_DRAFT_VARIANTS,
  checkDraftBrief,
  composeOfflineDrafts,
  offlineDraftGenerator,
  type AdDraft,
  type DraftBrief,
} from "./draft-assistant";

/**
 * A representative, well-formed brief — deliberately non-vacuous so the checks
 * prove something: a must-include phrase, a must-avoid word, and a digit in the
 * copy (so the "invents no new numbers" property is not vacuously true).
 */
export function sampleDraftBrief(): DraftBrief {
  return {
    product: "a weighted blanket",
    audience: "people who struggle to switch off at night",
    keyMessage: "fall asleep faster and wake up less, in about 2 weeks",
    tone: "empathetic",
    content_type: "ad_copy",
    platform: "instagram",
    mustInclude: ["Free returns"],
    mustAvoid: ["cure", "guaranteed"],
    variants: 3,
  };
}

/** All digit sequences in a string. */
function digits(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

export interface DraftReconcile {
  clean: boolean;
  failures: string[];
}

/**
 * Prove the Draft Assistant is internally coherent, honest, and jury-separated
 * (the executable DoD, minus the live model call the doc/readiness cover):
 *  - the variant + size bounds are sane;
 *  - the offline generator is deterministic and produces exactly the requested
 *    number of schema-valid, distinctly-labelled drafts;
 *  - it **invents nothing** — no draft introduces a digit absent from the brief,
 *    never emits a must-avoid term, and includes every must-include phrase;
 *  - a draft is plain copy — it carries NO juror fields (score / verdict /
 *    confidence / persona), so it cannot be confused with a jury result;
 *  - the standing disclaimer states the separation (not a review; not
 *    auto-graded) and names the product correctly.
 */
export function reconcileDraftAssistant(
  brief: DraftBrief = sampleDraftBrief(),
): DraftReconcile {
  const failures: string[] = [];

  if (!(MIN_DRAFT_VARIANTS >= 1)) failures.push("MIN_DRAFT_VARIANTS must be ≥ 1");
  if (!(MAX_DRAFT_VARIANTS >= MIN_DRAFT_VARIANTS)) {
    failures.push("MAX_DRAFT_VARIANTS must be ≥ MIN_DRAFT_VARIANTS");
  }
  for (const [label, cap] of [
    ["MAX_HEADLINE_CHARS", MAX_HEADLINE_CHARS],
    ["MAX_BODY_CHARS", MAX_BODY_CHARS],
    ["MAX_CTA_CHARS", MAX_CTA_CHARS],
  ] as const) {
    if (!(cap > 0)) failures.push(`${label} must be > 0`);
  }

  // The sample must pass the guard, else everything below is moot (non-vacuous).
  if (!checkDraftBrief(brief).ok) {
    failures.push("the sample brief must pass checkDraftBrief");
    return { clean: failures.length === 0, failures };
  }

  // Deterministic.
  const d1 = composeOfflineDrafts(brief);
  const d2 = composeOfflineDrafts(brief);
  if (JSON.stringify(d1) !== JSON.stringify(d2)) {
    failures.push("offline generator must be deterministic");
  }

  // Exactly the requested count; each schema-valid; distinct labels.
  if (d1.length !== brief.variants) {
    failures.push(`expected ${brief.variants} drafts, got ${d1.length}`);
  }
  const labels = new Set<string>();
  for (const draft of d1) {
    if (!AdDraftSchema.safeParse(draft).success) {
      failures.push(`draft "${draft.variantLabel}" is not schema-valid`);
    }
    labels.add(draft.variantLabel);
    assertDraftHonesty(draft, brief, failures);
    assertNotJurorShaped(draft, failures);
  }
  if (labels.size !== d1.length) failures.push("draft variant labels must be distinct");

  // Disclaimer: states the separation + names the product correctly.
  const disc = DRAFT_DISCLAIMER.toLowerCase();
  if (!disc.includes("not a review")) failures.push("disclaimer must say drafts are not a review");
  if (!(disc.includes("grade") || disc.includes("grades"))) {
    failures.push("disclaimer must state the jury does not grade AdJury's own drafts");
  }
  if (!DRAFT_DISCLAIMER.includes("AdJury")) failures.push("disclaimer must name the product 'AdJury'");

  // Provenance of the offline generator is the stable "offline" label.
  if (offlineDraftGenerator.name !== "offline") {
    failures.push("offlineDraftGenerator.name must be 'offline'");
  }

  return { clean: failures.length === 0, failures };
}

/** Honesty: invents no new digits, emits no must-avoid term, includes every must-include phrase. */
function assertDraftHonesty(draft: AdDraft, brief: DraftBrief, failures: string[]): void {
  const copy = `${draft.headline} ${draft.body} ${draft.cta}`;
  const briefDigits = new Set(
    digits([brief.product, brief.audience, brief.keyMessage, ...brief.mustInclude].join(" ")),
  );
  for (const d of digits(copy)) {
    if (!briefDigits.has(d)) {
      failures.push(`draft "${draft.variantLabel}" introduced a number not in the brief: ${d}`);
    }
  }
  const hay = copy.toLowerCase();
  for (const avoid of brief.mustAvoid) {
    const term = avoid.trim().toLowerCase();
    if (term.length > 0 && hay.includes(term)) {
      failures.push(`draft "${draft.variantLabel}" used a must-avoid term: "${avoid}"`);
    }
  }
  // Must-include phrases are woven into the body for every non-social draft.
  if (brief.content_type !== "social_post") {
    for (const inc of brief.mustInclude) {
      if (inc.trim().length > 0 && !copy.includes(inc.trim())) {
        failures.push(`draft "${draft.variantLabel}" is missing a must-include phrase: "${inc}"`);
      }
    }
  }
}

/** A draft must not carry any juror-result field — it is copy, not a verdict. */
const JUROR_FIELDS = ["score", "verdict", "confidence", "persona", "issues", "aggregate_score"] as const;
function assertNotJurorShaped(draft: AdDraft, failures: string[]): void {
  for (const field of JUROR_FIELDS) {
    if (field in (draft as unknown as Record<string, unknown>)) {
      failures.push(`a draft must not carry the juror field "${field}"`);
    }
  }
}

/**
 * Scan the Draft Assistant core's source for any coupling to the jury. The
 * separation ("the critique never grades its own output") is only real if
 * generation literally cannot reach the jury, so this proves the core imports
 * neither the orchestrator (`runReview`) nor any persona. Pure: the caller
 * passes the source text (the script/tests read it with `fs`, matching the
 * `*-audit` modules). Returns the offending references; empty ⇒ fully separated.
 */
export function findJuryImports(source: string): string[] {
  const hits: string[] = [];
  // Only inspect import statements, so a word in a comment/docstring (this file
  // and the core both *mention* the jury in prose) is never a false positive.
  const importLines = source
    .split("\n")
    .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+["']/.test(line));
  const forbidden: ReadonlyArray<{ pattern: RegExp; label: string }> = [
    { pattern: /@\/lib\/ai\/orchestrator/, label: "@/lib/ai/orchestrator" },
    { pattern: /@\/lib\/ai\/personas/, label: "@/lib/ai/personas" },
    { pattern: /\brunReview\b/, label: "runReview" },
  ];
  for (const line of importLines) {
    for (const { pattern, label } of forbidden) {
      if (pattern.test(line)) hits.push(label);
    }
  }
  return [...new Set(hits)];
}

export type ReadinessStatus = "ready" | "manual";
export interface ReadinessItem {
  status: ReadinessStatus;
  title: string;
  detail: string;
}
export interface DraftAssistantReadiness {
  /** True when every offline (`ready`) check holds — i.e. the reconcile is clean. */
  ready: boolean;
  items: ReadinessItem[];
  /** How many `manual` items (live-credential / next-increment steps) remain. */
  manualSteps: number;
}

/**
 * The readiness report: what the Draft Assistant proves offline today, and what
 * still needs a live credential or the next increment (the model-backed
 * generator; a separate `/draft` route + UI). Manual items are never auto-marked
 * done. The jury-separation item is `ready` only when the passed-in core source
 * shows no jury import.
 */
export function buildDraftAssistantReadiness(
  coreSource: string,
  brief: DraftBrief = sampleDraftBrief(),
): DraftAssistantReadiness {
  const reconcile = reconcileDraftAssistant(brief);
  const juryImports = findJuryImports(coreSource);

  const items: ReadinessItem[] = [
    {
      status: "ready",
      title: "Drafts are honest and well-formed (offline)",
      detail: reconcile.clean
        ? "Deterministic generator; exactly the requested count; invents no new facts; respects must-include / must-avoid."
        : `Reconcile FAILED: ${reconcile.failures.join("; ")}`,
    },
    {
      status: "ready",
      title: "Generation is separate from the jury",
      detail:
        juryImports.length === 0
          ? "The Draft Assistant core imports neither the orchestrator nor any persona — the jury can never grade AdJury's own drafts."
          : `COUPLED to the jury via: ${juryImports.join(", ")}`,
    },
    {
      status: "manual",
      title: "Live model-backed generation",
      detail:
        "modelDraftGenerator makes one real Claude call via lib/ai/client; needs AI_API_KEY. Offline, the deterministic generator stands in.",
    },
    {
      status: "manual",
      title: "Public Draft Assistant surface (/draft route + UI)",
      detail:
        "Wire a separate, opt-in /draft page + endpoint (distinct from /review) so a user can request drafts; the review path stays untouched.",
    },
  ];

  const offlineReady = reconcile.clean && juryImports.length === 0;
  return {
    ready: offlineReady,
    items,
    manualSteps: items.filter((i) => i.status === "manual").length,
  };
}
