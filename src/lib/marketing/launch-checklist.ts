/**
 * Launch checklist & testimonial outreach templates (DailyPlan Day 84 — Week 12).
 *
 * "Final launch checklist + outreach templates for testimonials; final Memory.md.
 *  DoD: launch-ready; Memory.md final for v1."
 *
 * The capstone of the Week-12 launch-prep run and the final numbered day of the
 * 12-week plan. Like every other Week 7–12 pass it is a pure, node-testable
 * single source of truth with no Next build, no DOM and no credential — and like
 * the Day 78–83 passes it draws the honest line between the half the repo can
 * prove offline and the half that genuinely needs a live deploy / a person.
 *
 * It is deliberately a COMPOSITION, not a restatement. "Launch-ready" is not a
 * fresh opinion here; it is exactly the conjunction of the five Week-12 gates
 * already built, each of which owns its own definition of done:
 *
 *   - Day 78 prod config   → {@link import("@/lib/deploy/prod-config").ProdReadiness}
 *   - Day 79 deploy         → {@link import("@/lib/deploy/deploy-plan").DeployReadiness}
 *   - Day 80 SEO/meta       → {@link import("@/lib/seo/metadata").SeoReconcileResult}
 *   - Day 81 prod monitoring→ {@link import("@/lib/observability/monitoring-audit").MonitoringReadiness}
 *   - Day 83 demo video     → {@link import("@/lib/marketing/demo-script").DemoReadiness}
 *
 * {@link buildLaunchChecklist} takes those five already-built reports as input and
 * rolls them up; it never re-derives a route list, an env surface or a juror
 * count. {@link reconcileLaunch} is the executable DoD + drift guard: every gate's
 * offline half is green, the gate set covers EXACTLY the Week-12 areas (so a new
 * launch-prep area must be wired in here, never silently dropped), and the
 * testimonial outreach templates are well-formed and on-brand.
 *
 * The genuine launch actions that need a live deploy or a real person — walking
 * the core flow against the public URL, collecting testimonials with the
 * templates below, and announcing the launch — are reported as `manual` items,
 * never auto-marked done, exactly as Days 78–83 report their credential-bound
 * steps.
 */

import type { ReadinessItem } from "@/lib/deploy/prod-config";
import type { ProdReadiness } from "@/lib/deploy/prod-config";
import type { DeployReadiness } from "@/lib/deploy/deploy-plan";
import type { SeoReconcileResult } from "@/lib/seo/metadata";
import type { MonitoringReadiness } from "@/lib/observability/monitoring-audit";
import type { DemoReadiness } from "@/lib/marketing/demo-script";
import { findJurorCountDrift, statesCorrectJurorCount } from "@/lib/marketing/readme-audit";
import { JUROR_COUNT, numberWord } from "@/lib/ui/copy";

// ── 1. The five Week-12 launch gates (composed, not restated) ────────────────

/**
 * The upstream Week-12 readiness reports the launch gate rolls up. Each is the
 * report its own day already produces (the script/test build them from disk),
 * so the launch checklist cannot disagree with the gate it depends on.
 */
export interface LaunchGateInput {
  /** Day 78 — prod config (`buildProdReadiness`). */
  prod: ProdReadiness;
  /** Day 79 — deploy plan (`buildDeployReadiness`). */
  deploy: DeployReadiness;
  /** Day 80 — SEO/meta (`reconcileSeo`). */
  seo: SeoReconcileResult;
  /** Day 81 — prod monitoring (`buildMonitoringReadiness`). */
  monitoring: MonitoringReadiness;
  /** Day 83 — demo video (`buildDemoReadiness`). */
  demo: DemoReadiness;
}

/** A launch-prep area whose gate the launch checklist rolls up. */
export type LaunchAreaId = "prod-config" | "deploy" | "seo" | "monitoring" | "demo";

interface LaunchAreaMeta {
  id: LaunchAreaId;
  area: string;
  /** The DailyPlan day that shipped this gate. */
  day: number;
  /** The runbook/doc the operator follows for this area. */
  runbook: string;
}

/**
 * The canonical, ordered set of Week-12 launch areas. The reconcile proves the
 * rolled-up gates cover EXACTLY this set, so a future Week-12 area can't ship
 * without being wired into the launch checklist (and a removed one can't leave a
 * dangling gate).
 */
export const LAUNCH_AREAS: readonly LaunchAreaMeta[] = [
  { id: "prod-config", area: "Production config & data", day: 78, runbook: "docs/PRODUCTION_SETUP.md" },
  { id: "deploy", area: "Deploy & production smoke", day: 79, runbook: "docs/DEPLOYMENT.md" },
  { id: "seo", area: "SEO / shareable, indexable pages", day: 80, runbook: "docs/DEPLOYMENT.md" },
  { id: "monitoring", area: "Error + product-analytics monitoring", day: 81, runbook: "docs/MONITORING.md" },
  { id: "demo", area: "Demo walkthrough", day: 83, runbook: "docs/DEMO_SCRIPT.md" },
] as const;

/** A rolled-up launch gate: one Week-12 area's offline-ready state + remaining manual work. */
export interface LaunchGate {
  id: LaunchAreaId;
  area: string;
  day: number;
  /** True when the area's offline-verifiable half is green. */
  offlineReady: boolean;
  /** The area's remaining credential/person-bound steps. */
  manualSteps: number;
  runbook: string;
}

/**
 * Roll each Week-12 report up into a launch gate. SEO's report is a reconcile
 * (`ok`) with no manual half of its own — its one live step (attaching the
 * domain) is owned by the deploy gate, so it contributes no manual steps here to
 * avoid double-counting.
 */
export function buildLaunchGates(input: LaunchGateInput): LaunchGate[] {
  const readyById: Record<LaunchAreaId, { offlineReady: boolean; manualSteps: number }> = {
    "prod-config": { offlineReady: input.prod.ready, manualSteps: input.prod.manualSteps },
    deploy: { offlineReady: input.deploy.ready, manualSteps: input.deploy.manualSteps },
    seo: { offlineReady: input.seo.ok, manualSteps: 0 },
    monitoring: { offlineReady: input.monitoring.ready, manualSteps: input.monitoring.manualSteps },
    demo: { offlineReady: input.demo.ready, manualSteps: input.demo.manualSteps },
  };

  return LAUNCH_AREAS.map((meta) => ({
    id: meta.id,
    area: meta.area,
    day: meta.day,
    offlineReady: readyById[meta.id].offlineReady,
    manualSteps: readyById[meta.id].manualSteps,
    runbook: meta.runbook,
  }));
}

// ── 2. Testimonial outreach templates ────────────────────────────────────────

export type OutreachChannel = "email" | "linkedin";

/**
 * A testimonial-outreach template. Bodies use ONLY the named merge fields in
 * {@link OUTREACH_PLACEHOLDERS} (`{{first_name}}`, …); the reconcile proves no
 * other `{{token}}` sneaks in, so a typo'd merge field can't ship to a real
 * person as literal text. Copy is on the enterprise voice (Design.md §7) and any
 * statement of the jury size must be the real one (the reconcile proves it).
 */
export interface OutreachTemplate {
  id: string;
  channel: OutreachChannel;
  /** Who this message is for. */
  audience: string;
  /** What outcome it's aiming for. */
  purpose: string;
  /** Required for `email` templates; omitted for a DM. */
  subject?: string;
  body: string;
}

/**
 * The named merge fields a sender fills in. A `{{token}}` outside this set is a
 * mistake (a misspelled field that would be sent verbatim), which the reconcile
 * flags.
 */
export const OUTREACH_PLACEHOLDERS: readonly string[] = [
  "first_name",
  "company",
  "your_name",
  "your_title",
  "product_url",
  "review_link",
  "calendar_link",
] as const;

/**
 * The testimonial-outreach templates for launch. Short, specific and on the
 * product's enterprise voice — they ask a real early user for a sentence or two
 * about a result AdJury produced, never for a generic plug. Each names the
 * product and, where it describes the jury, states the real size.
 */
export const OUTREACH_TEMPLATES: readonly OutreachTemplate[] = [
  {
    id: "beta-testimonial",
    channel: "email",
    audience: "An early user who has run several reviews.",
    purpose: "Ask for a short testimonial about a concrete result.",
    subject: "A quick favour about your AdJury reviews",
    body: [
      "Hi {{first_name}},",
      "",
      "Thanks for putting AdJury through its paces at {{company}} these last few weeks. Before we open it up more widely, I'm collecting a few words from the people who've actually used it.",
      "",
      "Would you be up for one or two sentences on what AdJury changed for your team — a flagged compliance risk you caught before publishing, a rewrite you shipped, or just the time it saved? Anything specific is far more useful than a generic plug.",
      "",
      "If it's easier to talk it through, grab a slot here: {{calendar_link}}. Either way, no pressure, and thank you.",
      "",
      "Best,",
      "{{your_name}}, {{your_title}}",
    ].join("\n"),
  },
  {
    id: "testimonial-reminder",
    channel: "email",
    audience: "An early user who hasn't replied to the first testimonial ask.",
    purpose: "A light, single reminder — easy to ignore, easy to answer.",
    subject: "Re: A quick favour about your AdJury reviews",
    body: [
      "Hi {{first_name}},",
      "",
      "Just floating this back to the top of your inbox — if you have a spare minute, a sentence on how AdJury has fit into your pre-publish workflow would mean a lot as we launch.",
      "",
      "If now isn't the time, no worries at all; reply \"later\" and I'll check back after launch.",
      "",
      "Thanks again,",
      "{{your_name}}",
    ].join("\n"),
  },
  {
    id: "case-study-ask",
    channel: "email",
    audience: "A power user / admin whose team reviews content regularly.",
    purpose: "Ask for a longer, named case study rather than a one-liner.",
    subject: "Would {{company}} be open to a short AdJury case study?",
    body: [
      "Hi {{first_name}},",
      "",
      "{{company}} is one of the teams getting the most out of AdJury — the six jurors have run across a real volume of your content, and the history shows it.",
      "",
      "Would you be open to a short case study? Fifteen minutes on a call ({{calendar_link}}), and I'll draft it for your approval — nothing goes public without your sign-off, and you can pull a quote back any time.",
      "",
      "If that's a yes, your review history is the easiest starting point: {{review_link}}.",
      "",
      "Best,",
      "{{your_name}}, {{your_title}}",
    ].join("\n"),
  },
  {
    id: "linkedin-dm",
    channel: "linkedin",
    audience: "A connection who tried AdJury during the beta.",
    purpose: "A brief, low-friction DM ask.",
    body: [
      "Hi {{first_name}} — thanks again for trying AdJury. We're launching soon, and a one-line note on what it did for your content reviews would help a lot. Totally fine to say no. You can point people at {{product_url}} if it's useful. — {{your_name}}",
    ].join("\n"),
  },
] as const;

// ── 3. Outreach reconcile (templates are well-formed + on-brand) ─────────────

const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Every distinct `{{token}}` name used across the given template bodies/subjects. */
export function usedPlaceholders(templates: readonly OutreachTemplate[]): string[] {
  const out = new Set<string>();
  for (const t of templates) {
    for (const text of [t.subject ?? "", t.body]) {
      for (const m of text.matchAll(PLACEHOLDER_RE)) out.add(m[1].toLowerCase());
    }
  }
  return [...out].sort();
}

/** The concatenated prose of every template, for the brand/count scanners. */
function allTemplateText(templates: readonly OutreachTemplate[]): string {
  return templates.map((t) => `${t.subject ?? ""}\n${t.body}`).join("\n");
}

/**
 * Whole-word occurrences of the product name in ANY casing. A match whose exact
 * text is not the canonical "AdJury" is a mis-cased form. Written lowercase +
 * case-insensitive so this module's own source carries no mis-cased literal (the
 * Day-65 copy audit scans `src/` for exactly those).
 */
const PRODUCT_NAME_RE = /\badjury\b/gi;

export interface OutreachReconcile {
  /** ids unique, every email has a subject, bodies/audience/purpose non-empty. */
  allWellFormed: boolean;
  /** Every `{{token}}` is a known merge field (no typo'd field would ship literal). */
  placeholdersKnown: boolean;
  /** Unknown placeholder tokens, if any (for the report). */
  unknownPlaceholders: string[];
  /** No template misstates the jury size, and at least one states it correctly. */
  jurorCountAccurate: boolean;
  /** The product is named "AdJury" at least once, with no mis-cased form anywhere. */
  namesProduct: boolean;
  clean: boolean;
}

/**
 * Prove the testimonial templates are well-formed and on-brand: unique ids, every
 * email carries a subject, no empty copy, only known merge fields, the product
 * named correctly (and never mis-cased), and — crucially — any stated jury size
 * is the real one (reusing the Day-82 juror-count scanner, so a seventh juror
 * breaks these templates until they're updated, exactly like the README and the
 * demo narration).
 */
export function reconcileOutreach(
  templates: readonly OutreachTemplate[] = OUTREACH_TEMPLATES,
  allowed: readonly string[] = OUTREACH_PLACEHOLDERS,
  expectedJurorCount: number = JUROR_COUNT,
): OutreachReconcile {
  const ids = templates.map((t) => t.id);
  const idsUnique = new Set(ids).size === ids.length;
  const fieldsPresent = templates.every(
    (t) =>
      t.id.trim().length > 0 &&
      t.audience.trim().length > 0 &&
      t.purpose.trim().length > 0 &&
      t.body.trim().length > 0 &&
      (t.channel !== "email" || (t.subject ?? "").trim().length > 0),
  );
  const allWellFormed = templates.length > 0 && idsUnique && fieldsPresent;

  const allowedSet = new Set(allowed.map((p) => p.toLowerCase()));
  const unknownPlaceholders = usedPlaceholders(templates).filter((p) => !allowedSet.has(p));
  const placeholdersKnown = unknownPlaceholders.length === 0;

  const text = allTemplateText(templates);
  const jurorCountAccurate =
    findJurorCountDrift(text, expectedJurorCount).length === 0 &&
    statesCorrectJurorCount(text, expectedJurorCount);

  const brandTokens: string[] = text.match(PRODUCT_NAME_RE) ?? [];
  const namesProduct =
    brandTokens.includes("AdJury") && brandTokens.every((t) => t === "AdJury");

  return {
    allWellFormed,
    placeholdersKnown,
    unknownPlaceholders,
    jurorCountAccurate,
    namesProduct,
    clean: allWellFormed && placeholdersKnown && jurorCountAccurate && namesProduct,
  };
}

// ── 4. Launch readiness report ───────────────────────────────────────────────

export interface LaunchReadiness {
  items: ReadinessItem[];
  gates: LaunchGate[];
  outreach: OutreachReconcile;
  /** Every launch gate's offline half is green AND the outreach templates are clean. */
  ready: boolean;
  /** Total remaining credential/person-bound steps across every gate + launch actions. */
  manualSteps: number;
}

/**
 * The launch actions that can only happen once the product is live or that need a
 * real person — never auto-marked done. These are the human half of "launch-
 * ready", the counterpart to the gates' offline half.
 */
const LAUNCH_MANUAL_ITEMS: readonly ReadinessItem[] = [
  {
    id: "live-walkthrough",
    title: "Walk the core flow against the live production URL",
    status: "manual",
    detail: "Run docs/USER_TEST_SCRIPT.md (Day 68) end-to-end on the deployed app, signed in, before announcing.",
  },
  {
    id: "collect-testimonials",
    title: "Request testimonials from early users",
    status: "manual",
    detail: "Send the outreach templates below (docs/LAUNCH_CHECKLIST.md) to early users; collect quotes with sign-off.",
  },
  {
    id: "announce",
    title: "Announce the launch",
    status: "manual",
    detail: "Publish the live URL + demo video on the portfolio/README once the live walkthrough passes.",
  },
] as const;

/**
 * Compose the launch-readiness report. The `ready` roll-up is TRUE only when
 * every Week-12 gate's offline half is green and the outreach templates are
 * clean — i.e. everything the repo can prove offline is done. The remaining
 * `manual` items are each gate's own credential/person-bound steps plus the live-
 * launch actions above; `manualSteps` is their total, so the number only reaches
 * zero once a real operator has finished the live launch.
 */
export function buildLaunchChecklist(input: LaunchGateInput): LaunchReadiness {
  const gates = buildLaunchGates(input);
  const outreach = reconcileOutreach();

  const gateItems: ReadinessItem[] = gates.map((g) => ({
    id: `gate:${g.id}`,
    title: `${g.area} (Day ${g.day})`,
    status: g.offlineReady ? "ready" : "manual",
    detail: g.offlineReady
      ? `Offline-ready; ${g.manualSteps} live step(s) remain — see ${g.runbook}.`
      : `Offline checks NOT green — resolve before launch (${g.runbook}).`,
  }));

  const outreachItem: ReadinessItem = {
    id: "outreach-templates",
    title: "Testimonial outreach templates are well-formed and on-brand",
    status: outreach.clean ? "ready" : "manual",
    detail: `${OUTREACH_TEMPLATES.length} template(s); only known merge fields, product named correctly, jury size accurate.`,
  };

  const items: ReadinessItem[] = [...gateItems, outreachItem, ...LAUNCH_MANUAL_ITEMS];

  const ready = gates.every((g) => g.offlineReady) && outreach.clean;
  // Each gate's own manual steps + the live-launch actions here.
  const gateManual = gates.reduce((n, g) => n + g.manualSteps, 0);
  const manualSteps = gateManual + LAUNCH_MANUAL_ITEMS.length;

  return { items, gates, outreach, ready, manualSteps };
}

// ── 5. Reconcile (executable DoD + drift guard) ──────────────────────────────

export interface LaunchReconcile {
  /** Every Week-12 launch gate's offline half is green. */
  allGatesReady: boolean;
  /** The rolled-up gates cover exactly the canonical Week-12 areas (no missing/extra). */
  gatesCoverAllAreas: boolean;
  /** The testimonial outreach templates are well-formed and on-brand. */
  outreachClean: boolean;
  clean: boolean;
}

/**
 * Executable DoD + drift guard (the Day 43–83 "inventory + reconcile" pattern):
 * the product is launch-ready — every Week-12 gate's offline half is green, the
 * launch checklist still covers exactly the Week-12 areas (so nothing was dropped
 * or left unwired), and the testimonial outreach templates are sound and on-brand.
 * A clean result over the real reports is the executable form of the Day-84 DoD.
 */
export function reconcileLaunch(input: LaunchGateInput): LaunchReconcile {
  const gates = buildLaunchGates(input);
  const allGatesReady = gates.every((g) => g.offlineReady);

  const gateIds = gates.map((g) => g.id).sort();
  const areaIds = LAUNCH_AREAS.map((a) => a.id).sort();
  const gatesCoverAllAreas =
    gateIds.length === areaIds.length && gateIds.every((id, i) => id === areaIds[i]);

  const outreachClean = reconcileOutreach().clean;

  return {
    allGatesReady,
    gatesCoverAllAreas,
    outreachClean,
    clean: allGatesReady && gatesCoverAllAreas && outreachClean,
  };
}

/** A one-line human summary of the jury size, for the script banner. */
export function launchJurySummary(): string {
  return `${numberWord(JUROR_COUNT)} jurors`;
}
