/**
 * Live business research — readiness + reconcile (DailyPlan Day 88).
 *
 * The executable "the business researcher stays grounded (offline) and the live
 * web-search path is wired correctly" check and its offline drift guard — sibling
 * to the core in `business-context.ts`, in the same pure-core + reconcile +
 * readiness shape the video days use (`short-form-readiness.ts`) and the Draft
 * Assistant uses (`draft-assistant-readiness.ts`). Everything here is pure and
 * runs with no network or credential; the live model call itself is the one
 * credential-bound step the readiness reports as `manual`.
 */
import type { ModelClient } from "@/lib/ai/client";
import {
  BUSINESS_RESEARCH_SYSTEM_PROMPT,
  MAX_BUSINESS_SUMMARY_CHARS,
  MAX_RESEARCH_SEARCHES,
  RESEARCH_MAX_OUTPUT_TOKENS,
  buildBusinessResearchPrompt,
  businessContextRef,
  hasBusinessIdentity,
  normalizeWebsiteUrl,
  offlineBusinessResearcher,
  type BusinessIdentity,
} from "./business-context";

/**
 * A representative identity — deliberately non-vacuous so the grounding check
 * proves something: the website carries a digit (`store24`) so the offline
 * summary legitimately contains "24", and the "invents no new number" check
 * passes *because* 24 is an input, not because the output has no digits.
 */
export function sampleBusinessIdentity(): BusinessIdentity {
  return {
    name: "North Peak Outfitters",
    industry: "outdoor retail",
    websiteUrl: "store24.example",
  };
}

/** All digit sequences in a string. */
function digits(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

export interface BusinessResearchReconcile {
  clean: boolean;
  failures: string[];
}

/**
 * Prove the business researcher is internally coherent and grounded, and that the
 * live web-search seam is wired honestly (the executable DoD, minus the live
 * model call the readiness covers as `manual`):
 *  - the cost/size bounds are sane;
 *  - the offline researcher is deterministic, non-empty + bounded for a real
 *    identity, and empty for an empty one;
 *  - it is **grounded** — the summary names the business, its field, and its site,
 *    and introduces no digit absent from the identity inputs (invents nothing);
 *  - the live research prompt is grounded *by construction* — the system prompt
 *    forbids invention and asks for web search, and the user prompt carries the
 *    website being researched;
 *  - the cache ref is stable for an identity and identity-keyed.
 */
export function reconcileBusinessResearch(
  identity: BusinessIdentity = sampleBusinessIdentity(),
): BusinessResearchReconcile {
  const failures: string[] = [];

  if (!(MAX_BUSINESS_SUMMARY_CHARS > 0)) failures.push("MAX_BUSINESS_SUMMARY_CHARS must be > 0");
  if (!(MAX_RESEARCH_SEARCHES >= 1)) failures.push("MAX_RESEARCH_SEARCHES must be ≥ 1");
  if (!(RESEARCH_MAX_OUTPUT_TOKENS > 0)) failures.push("RESEARCH_MAX_OUTPUT_TOKENS must be > 0");

  if (!hasBusinessIdentity(identity)) {
    failures.push("the sample identity must be non-empty");
    return { clean: failures.length === 0, failures };
  }

  // Deterministic.
  const s1 = offlineBusinessResearcher.research(identity);
  const s2 = offlineBusinessResearcher.research(identity);
  if (s1 !== s2) failures.push("offline researcher must be deterministic");

  // Non-empty + bounded for a real identity.
  if (s1.length === 0) failures.push("offline researcher must produce a summary for a real identity");
  if (s1.length > MAX_BUSINESS_SUMMARY_CHARS) {
    failures.push(`offline summary exceeds ${MAX_BUSINESS_SUMMARY_CHARS} chars`);
  }

  // Empty identity → empty summary.
  if (offlineBusinessResearcher.research({ name: "", industry: null, websiteUrl: null }) !== "") {
    failures.push("offline researcher must return '' for an empty identity");
  }

  // Grounded: names the business + field + site; invents no new number.
  const name = identity.name.trim();
  if (name.length > 0 && !s1.includes(name)) {
    failures.push("offline summary must name the business (grounding)");
  }
  const website = normalizeWebsiteUrl(identity.websiteUrl);
  if (website && !s1.includes(website)) {
    failures.push("offline summary must state the business's website (grounding)");
  }
  const inputDigits = new Set(
    digits([identity.name, identity.industry ?? "", website ?? ""].join(" ")),
  );
  for (const d of digits(s1)) {
    if (!inputDigits.has(d)) {
      failures.push(`offline summary introduced a number not in the identity: ${d}`);
    }
  }

  // Live research prompt is grounded by construction.
  const sys = BUSINESS_RESEARCH_SYSTEM_PROMPT.toLowerCase();
  if (!sys.includes("web_search")) failures.push("research system prompt must ask for web search");
  if (!sys.includes("never invent")) failures.push("research system prompt must forbid invention");
  const userPrompt = buildBusinessResearchPrompt(identity);
  if (website && !userPrompt.includes(website)) {
    failures.push("research prompt must carry the website being researched");
  }

  // Cache ref: stable + identity-keyed.
  if (businessContextRef(identity) !== businessContextRef({ ...identity })) {
    failures.push("cache ref must be stable for the same identity");
  }
  if (businessContextRef(identity) === businessContextRef({ ...identity, name: `${identity.name} 2` })) {
    failures.push("cache ref must change when the identity changes");
  }

  return { clean: failures.length === 0, failures };
}

export type ReadinessStatus = "ready" | "manual";
export interface ReadinessItem {
  status: ReadinessStatus;
  title: string;
  detail: string;
}
export interface BusinessResearchReadiness {
  /** True when every offline (`ready`) check holds — i.e. the reconcile is clean. */
  ready: boolean;
  items: ReadinessItem[];
  /** How many `manual` items (live-credential / wiring steps) remain. */
  manualSteps: number;
  /** Whether a live model client is configured in this environment (reporting only). */
  liveConfigured: boolean;
}

/**
 * The readiness report: what live business research proves offline today, and
 * what still needs a live credential or the save-path wiring. Manual items are
 * never auto-marked done. When a live `client` is passed, its mode is reported
 * (live vs offline mock) so the operator can see whether research can run here.
 */
export function buildBusinessResearchReadiness(
  client?: ModelClient,
  identity: BusinessIdentity = sampleBusinessIdentity(),
): BusinessResearchReadiness {
  const reconcile = reconcileBusinessResearch(identity);
  const liveConfigured = client ? !client.isMock : false;

  const items: ReadinessItem[] = [
    {
      status: "ready",
      title: "Offline business summary is grounded and bounded",
      detail: reconcile.clean
        ? "Deterministic; names the business, field, and site; invents no new facts; bounded to the cache size."
        : `Reconcile FAILED: ${reconcile.failures.join("; ")}`,
    },
    {
      status: "ready",
      title: "Live research is grounded by construction",
      detail:
        "The research call uses the web_search tool and a system prompt that forbids invention and bounds the output — the same one provider behind lib/ai/client.",
    },
    {
      status: "manual",
      title: "Live web-search research (needs AI_API_KEY + outbound network)",
      detail: liveConfigured
        ? "A live model client is configured; modelBusinessResearcher can run web-search research."
        : "No live key in this environment, so the mock stands in and the deterministic offline summary is used.",
    },
    {
      status: "manual",
      title: "Wire live research into onboarding / website save",
      detail:
        "Call researchBusinessContext(identity, resolveLiveBusinessResearcher(getModelClient())) from the save action so an identity change triggers one live research pass (offline floor as fallback); the review read path is unchanged.",
    },
  ];

  return {
    ready: reconcile.clean,
    items,
    manualSteps: items.filter((i) => i.status === "manual").length,
    liveConfigured,
  };
}
