/**
 * Demo video script & recording plan (DailyPlan Day 83 — Week 12 launch prep).
 *
 * "Demo script + recording assets/instructions (2–3 min).
 *  DoD: a demo walkthrough exists."
 *
 * The launch-prep sibling of the app's other "pure core + static audit +
 * reconcile drift guard" passes (`deploy-plan` Day 79, `seo-metadata` Day 80,
 * `readme-audit` Day 82): a pure, node-testable single source of truth for the
 * 2–3 minute product demo, with no Next build, no DOM and no credential.
 *
 * "A demo walkthrough exists" is split, like every other Week-12 DoD, into the
 * half the repo can prove offline and the half that genuinely needs a person:
 *
 *   - PROVABLE OFFLINE — the walkthrough itself: an ordered, timed set of scenes
 *     with narration whose total runtime lands inside the 2–3 minute target,
 *     whose every scene points at a REAL route on disk, which walks the WHOLE
 *     authenticated core flow (it reuses the Day-79 {@link CORE_FLOW_STEPS} as
 *     the source of truth, so the demo can't drift from the flow the product
 *     actually has), states the real jury size, and whose recording setup names
 *     only real npm scripts. {@link reconcileDemoScript} is the executable form
 *     of all of that.
 *
 *   - NEEDS A PERSON — the recording itself: seeding a dev tenant, screen-
 *     capturing the walkthrough, and producing the final video file. These are
 *     reported as `manual` readiness items (never auto-marked done), exactly as
 *     Days 78–81 report their credential-bound steps.
 *
 * It composes rather than restating: the route inventory + the core-flow steps
 * come from `deploy-plan` (Day 79), and the juror-count / script scanners come
 * from `readme-audit` (Day 82). Nothing here re-derives a route list, a flow, or
 * a juror count — a demo that disagrees with the shipped product is drift this
 * core catches.
 */

import {
  CORE_FLOW_STEPS,
  auditRoutePostures,
  routeForApiPath,
} from "@/lib/deploy/deploy-plan";
import {
  findJurorCountDrift,
  findUnknownScripts,
  statesCorrectJurorCount,
} from "@/lib/marketing/readme-audit";
import { JUROR_COUNT, numberWord } from "@/lib/ui/copy";
import type { ReadinessItem } from "@/lib/deploy/prod-config";

// ── Target runtime ─────────────────────────────────────────────────────────────

/** The demo must run 2–3 minutes (DailyPlan Day 83). Bounds are inclusive. */
export const DEMO_MIN_SECONDS = 120;
export const DEMO_MAX_SECONDS = 180;

// ── Scene model ──────────────────────────────────────────────────────────────

export interface DemoScene {
  /** Stable scene id. */
  id: string;
  /** Short on-screen / shot-list title. */
  title: string;
  /**
   * The route shown on screen during this scene — a real page route (e.g. "/",
   * "/review") or, for the export beat, the API path the download hits. The
   * reconcile proves every one resolves to a route on disk.
   */
  route: string;
  /** The spoken voice-over for this scene (plain, enterprise voice — Design.md §7). */
  narration: string;
  /** On-screen duration in whole seconds. */
  seconds: number;
  /**
   * When this scene walks a step of the authenticated core flow, the id of the
   * matching {@link CORE_FLOW_STEPS} step. The reconcile proves the demo's
   * core-flow scenes cover EXACTLY that flow — no step dropped, none invented.
   */
  coreFlowStepId?: string;
}

/**
 * The demo, scene by scene. An intro on the public landing page, the seven
 * authenticated core-flow beats (tied 1:1 to the Day-79 `CORE_FLOW_STEPS` via
 * `coreFlowStepId`), and an outro on the public pricing page. Total runtime is
 * 160s — inside the 2–3 minute window (the reconcile pins it).
 *
 * Narration is deliberately specific about the jury size ("six juror personas")
 * so the Day-82 juror-count scanner guards it: when a seventh juror is added,
 * this narration fails the reconcile until it's updated, the same way the README
 * does.
 */
export const DEMO_SCENES: readonly DemoScene[] = [
  {
    id: "intro",
    title: "Open on the landing page",
    route: "/",
    narration:
      "This is AdJury — a review layer for marketing content. Before you publish an ad, six AI juror personas each score it from a different angle: brand voice, compliance, audience fit, SEO, scroll-stopping hook, and an insider business read. It critiques and rewrites; it never publishes for you.",
    seconds: 18,
  },
  {
    id: "log-in",
    title: "Log in with the demo account",
    route: "/login",
    narration:
      "I'll log in with a seeded demo account. Everything you'll see runs on the deterministic offline mock — no live model key needed to follow along.",
    seconds: 10,
    coreFlowStepId: "log-in",
  },
  {
    id: "submit",
    title: "Submit an ad for review",
    route: "/review",
    narration:
      "On the New review screen I paste an ad, pick a content type and target platform, and submit. The same copy fans out to all six jurors in one request against one cost-efficient model — six prompts, not six providers.",
    seconds: 22,
    coreFlowStepId: "submit",
  },
  {
    id: "scorecard",
    title: "Read the scorecard (the heart of the demo)",
    route: "/review",
    narration:
      "Here's the scorecard: an aggregate score and a plain verdict up top, then one card per juror with a score, a one-line summary, the specific issues it flagged, and a suggested rewrite. Notice the compliance juror has flagged an unsubstantiated claim — and a high-severity compliance flag vetoes the verdict to fail, no matter the average.",
    seconds: 30,
    coreFlowStepId: "scorecard",
  },
  {
    id: "history",
    title: "Open review history",
    route: "/history",
    narration:
      "Every review is saved per company. History lists them with date, score and verdict, and it's filterable — all scoped to your own tenant.",
    seconds: 15,
    coreFlowStepId: "history",
  },
  {
    id: "detail",
    title: "Reopen a past review",
    route: "/review/[id]",
    narration:
      "Opening a past review reconstructs the full scorecard from storage — same scores, same issues, same rewrites. I'll open a seeded pass, a revise and a fail so you can see the whole range.",
    seconds: 15,
    coreFlowStepId: "detail",
  },
  {
    id: "export",
    title: "Export the review",
    route: "/api/reviews/[id]/export",
    narration:
      "A review exports to CSV for a spreadsheet, or to an on-brand PDF a marketing director can forward to justify a decision.",
    seconds: 15,
    coreFlowStepId: "export",
  },
  {
    id: "analytics",
    title: "Show the analytics dashboard",
    route: "/analytics",
    narration:
      "The analytics dashboard trends scores over time and breaks them down per juror lens, so a team can see whether their content is getting better — with an accessible data-table fallback behind every chart.",
    seconds: 18,
    coreFlowStepId: "analytics",
  },
  {
    id: "outro",
    title: "Close on pricing & the pitch",
    route: "/pricing",
    narration:
      "Multi-tenant and role-aware from day one, grounded in each company's own business context, under a cent a review. AdJury de-risks what marketing teams publish — and keeps the human in control.",
    seconds: 17,
  },
] as const;

// ── Timed script ───────────────────────────────────────────────────────────────

export interface TimedScene extends DemoScene {
  /** Cumulative start offset in seconds (first scene starts at 0). */
  startsAt: number;
  /** Cumulative end offset in seconds. */
  endsAt: number;
}

export interface DemoScript {
  scenes: TimedScene[];
  totalSeconds: number;
  /** True when the total runtime is within [DEMO_MIN_SECONDS, DEMO_MAX_SECONDS]. */
  withinTarget: boolean;
  /** The core-flow step ids the scenes walk, in scene order. */
  coreFlowStepIds: string[];
}

/** Format a whole-second offset as `m:ss`. */
export function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Lay the scenes out on a timeline with cumulative start/end offsets and a total.
 * Pure — deterministic given the scenes.
 */
export function buildDemoScript(scenes: readonly DemoScene[] = DEMO_SCENES): DemoScript {
  const timed: TimedScene[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    timed.push({ ...scene, startsAt: cursor, endsAt: cursor + scene.seconds });
    cursor += scene.seconds;
  }
  const totalSeconds = cursor;
  const coreFlowStepIds = scenes
    .map((s) => s.coreFlowStepId)
    .filter((id): id is string => id !== undefined);
  return {
    scenes: timed,
    totalSeconds,
    withinTarget: totalSeconds >= DEMO_MIN_SECONDS && totalSeconds <= DEMO_MAX_SECONDS,
    coreFlowStepIds,
  };
}

// ── Recording assets / instructions ─────────────────────────────────────────────

export interface RecordingAsset {
  id: string;
  title: string;
  /** What to do / what to have ready. May reference real npm scripts. */
  detail: string;
}

/**
 * The recording setup — what a person needs in place before they screen-capture
 * the walkthrough above. Every npm script named here is real (the reconcile
 * proves it via the Day-82 script scanner), so the instructions can't rot into
 * telling a recorder to run a command that doesn't exist.
 */
export const RECORDING_SETUP: readonly RecordingAsset[] = [
  {
    id: "seed",
    title: "Seed a dev tenant",
    detail:
      "Point `.env.local` at a dev Supabase project, apply the migrations, then `npm run seed:demo` to create the Northwind Labs tenant, its admin + member accounts, a brand guide, and six reviews spanning pass / revise / fail (docs/USER_TEST_SCRIPT.md §0). Copy the printed passwords.",
  },
  {
    id: "offline-mock",
    title: "Run on the offline mock",
    detail:
      "Leave AI_API_KEY unset so reviews run on the deterministic offline mock — no credential, reproducible output, every take identical. Verify engine output first with `npm run demo` (no DB needed).",
  },
  {
    id: "app",
    title: "Start the app",
    detail: "`npm run dev`, then record http://localhost:3000 in a clean browser profile (no extensions, no bookmarks bar).",
  },
  {
    id: "capture",
    title: "Capture settings",
    detail:
      "Record at 1920×1080, 30fps, cursor highlight on. Use a 1280px content width so text is legible when the video is embedded small. Hide notifications.",
  },
  {
    id: "fail-scenario",
    title: "Use the compliance-fail scenario for the scorecard beat",
    detail:
      "For the scorecard scene, submit (or open) the seeded Instagram ad with unsubstantiated medical claims — it reliably produces a high-severity compliance flag and a fail verdict, which is the most persuasive single shot in the demo.",
  },
  {
    id: "a11y",
    title: "Drive it accessibly on camera",
    detail:
      "Navigate submit → scorecard with the keyboard at least once to show the focus ring, the skip-to-content link, and that no verdict is colour-only (Design.md §6).",
  },
] as const;

// ── Readiness (ready vs. the manual recording step) ──────────────────────────────

export interface DemoReadiness {
  items: ReadinessItem[];
  script: DemoScript;
  /** Every offline-verifiable item passed (the walkthrough itself exists + is sound). */
  ready: boolean;
  manualSteps: number;
}

export interface DemoReconcileInput {
  /** Page paths from `src/app` (to resolve scene routes + the core-flow routes). */
  pagePaths: readonly string[];
  /** API `route.ts` paths from `src/app` (the export beat targets one). */
  apiPaths: readonly string[];
  /** package.json `scripts` keys (the recording setup references some). */
  availableScripts: Iterable<string>;
  /** Override the scene list (tests inject planted-bad ones). */
  scenes?: readonly DemoScene[];
  /** Override the expected jury size (defaults to {@link JUROR_COUNT}). */
  expectedJurorCount?: number;
}

/**
 * Compose the demo-readiness report. The `ready` items are what the repo proves
 * offline — the walkthrough is well-formed and timed within the 2–3 minute
 * window, every scene points at a real route, it covers the whole core flow, and
 * the narration states the real jury size. The `manual` items are the genuine
 * person-needed steps (seed a dev tenant, screen-record, produce the file),
 * never auto-marked done.
 */
export function buildDemoReadiness(input: DemoReconcileInput): DemoReadiness {
  const reconcile = reconcileDemoScript(input);
  const script = buildDemoScript(input.scenes ?? DEMO_SCENES);

  const items: ReadinessItem[] = [
    {
      id: "script-timed",
      title: "Demo script is well-formed and timed within 2–3 minutes",
      status: reconcile.withinTarget ? "ready" : "manual",
      detail: `${script.scenes.length} scenes, ${formatTimecode(script.totalSeconds)} total (target ${formatTimecode(
        DEMO_MIN_SECONDS,
      )}–${formatTimecode(DEMO_MAX_SECONDS)}).`,
    },
    {
      id: "routes-real",
      title: "Every scene points at a real route on disk",
      status: reconcile.sceneRoutesExist ? "ready" : "manual",
      detail: "Each scene's route resolves to a real page or API route (reuses the Day-79 route inventory).",
    },
    {
      id: "covers-core-flow",
      title: "The demo walks the whole authenticated core flow",
      status: reconcile.coversCoreFlow ? "ready" : "manual",
      detail: "Core-flow scenes cover exactly the Day-79 CORE_FLOW_STEPS (log in → submit → scorecard → history → detail → export → analytics).",
    },
    {
      id: "juror-count",
      title: "Narration states the real jury size",
      status: reconcile.jurorCountAccurate ? "ready" : "manual",
      detail: `States ${numberWord(input.expectedJurorCount ?? JUROR_COUNT)} jurors with no drift (reuses the Day-82 juror-count scanner).`,
    },
    {
      id: "assets-scripts",
      title: "Recording setup references only real npm scripts",
      status: reconcile.assetsReferenceRealScripts ? "ready" : "manual",
      detail: "Every `npm run <name>` in the recording instructions is a real package.json script.",
    },
    {
      id: "seed-tenant",
      title: "Seed a dev tenant to record against",
      status: "manual",
      detail: "Needs a dev Supabase project + `npm run seed:demo` (docs/USER_TEST_SCRIPT.md §0) — no DB in the cloud build.",
    },
    {
      id: "record",
      title: "Screen-capture the walkthrough",
      status: "manual",
      detail: "A person records the scenes above following the shot list + narration (docs/DEMO_SCRIPT.md).",
    },
    {
      id: "produce",
      title: "Produce and attach the final 2–3 min video file",
      status: "manual",
      detail: "Edit to the timings, export, and attach it to the portfolio / README — the artifact itself can't live in the repo as a build step.",
    },
  ];

  const OFFLINE_ITEM_IDS = [
    "script-timed",
    "routes-real",
    "covers-core-flow",
    "juror-count",
    "assets-scripts",
  ];
  const ready = items
    .filter((i) => OFFLINE_ITEM_IDS.includes(i.id))
    .every((i) => i.status === "ready");
  const manualSteps = items.filter((i) => i.status === "manual").length;

  return { items, script, ready, manualSteps };
}

// ── Reconcile (executable DoD + drift guard) ─────────────────────────────────────

export interface DemoScriptReconcile {
  /** Total runtime is within the 2–3 minute window. */
  withinTarget: boolean;
  /** Every scene route resolves to a real page or API route on disk. */
  sceneRoutesExist: boolean;
  /** The core-flow scenes cover exactly `CORE_FLOW_STEPS` (none dropped/invented). */
  coversCoreFlow: boolean;
  /** Narration states the real jury size with no drift. */
  jurorCountAccurate: boolean;
  /** Every npm script named in the recording setup exists. */
  assetsReferenceRealScripts: boolean;
  clean: boolean;
}

/** The full narration text of the demo, for the juror-count scanner. */
function allNarration(scenes: readonly DemoScene[]): string {
  return scenes.map((s) => s.narration).join("\n");
}

/** The full recording-setup text, for the script scanner. */
function allAssetText(assets: readonly RecordingAsset[]): string {
  return assets.map((a) => `${a.title}\n${a.detail}`).join("\n");
}

/**
 * Executable DoD + drift guard (the Day 43–82 "inventory + reconcile" pattern):
 * the demo walkthrough exists AND agrees with the shipped product — it runs 2–3
 * minutes, every scene shows a route that really exists, it walks the whole
 * core flow, it states the real jury size, and its recording instructions name
 * only real scripts. A clean result is the executable form of the Day-83 DoD.
 */
export function reconcileDemoScript(input: DemoReconcileInput): DemoScriptReconcile {
  const scenes = input.scenes ?? DEMO_SCENES;
  const expected = input.expectedJurorCount ?? JUROR_COUNT;
  const script = buildDemoScript(scenes);

  // Routes: a scene may show a page route or (the export beat) an API route.
  const postures = auditRoutePostures(input.pagePaths);
  const realPageRoutes = new Set(postures.pages.map((p) => p.route));
  const realApiRoutes = new Set(
    input.apiPaths
      .map((p) => routeForApiPath(p))
      .filter((r): r is string => r !== null),
  );
  const sceneRoutesExist =
    scenes.length > 0 &&
    scenes.every((s) => realPageRoutes.has(s.route) || realApiRoutes.has(s.route));

  // Core-flow coverage: the set of core-flow step ids the scenes walk must equal
  // the set of CORE_FLOW_STEPS ids — exactly, so a dropped or invented step fails.
  const flowIds = new Set(CORE_FLOW_STEPS.map((s) => s.id));
  const sceneFlowIds = new Set(script.coreFlowStepIds);
  const coversCoreFlow =
    sceneFlowIds.size === flowIds.size &&
    [...flowIds].every((id) => sceneFlowIds.has(id)) &&
    script.coreFlowStepIds.length === sceneFlowIds.size; // no duplicate step

  // Juror count: no drift, and positively stated at least once.
  const narration = allNarration(scenes);
  const jurorCountAccurate =
    findJurorCountDrift(narration, expected).length === 0 &&
    statesCorrectJurorCount(narration, expected);

  // Recording scripts all exist.
  const assetsReferenceRealScripts =
    findUnknownScripts(allAssetText(RECORDING_SETUP), input.availableScripts).length === 0;

  return {
    withinTarget: script.withinTarget,
    sceneRoutesExist,
    coversCoreFlow,
    jurorCountAccurate,
    assetsReferenceRealScripts,
    clean:
      script.withinTarget &&
      sceneRoutesExist &&
      coversCoreFlow &&
      jurorCountAccurate &&
      assetsReferenceRealScripts,
  };
}
