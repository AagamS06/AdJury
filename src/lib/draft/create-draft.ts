/**
 * Core logic for `POST /api/draft` (DailyPlan Day 89 — the public Draft
 * Assistant surface).
 *
 * This is the server-side entry point for the optional, clearly-separate
 * ad-copy generator the PRD carves out (§6.3). It is kept out of the route
 * handler so it is unit-testable without Next's request plumbing or a live
 * model: the session and the generator are injected. The route
 * (`src/app/api/draft/route.ts`) wires the real dependencies; tests pass a fake
 * session and the deterministic offline generator.
 *
 * The separation from the jury is load-bearing and stays true here (Rules.md §1;
 * PRD §3/§6.3): this module imports **neither** the orchestrator (`runReview`)
 * **nor** any persona, exactly like `draft-assistant.ts`. Generation and
 * judgement remain two different code paths with no automatic loop between them —
 * a draft is plain copy a human edits and may *then* choose to submit as a NEW
 * review, never auto-graded. `draft-assistant-readiness.ts` proves this by
 * scanning this file's own source.
 *
 * Tenancy and auth follow the review endpoint (Rules.md §5/§6): the caller must
 * be signed in, and nothing here trusts a client-supplied identity (a draft is
 * not persisted, so there is no tenant row to key — but an anonymous caller is
 * still rejected so the generator is not an open, unauthenticated endpoint).
 * Errors are handled per Rules.md §6: a specific 400 for a bad/greedy request,
 * 401 when not signed in, and the bounded brief + single model call keep the
 * cost of a request small by construction (Rules.md §1).
 */
import type { SessionContext } from "@/lib/auth/session";
import { logError, errorContext } from "@/lib/observability/logger";
import {
  DraftRequestSchema,
  generateDrafts,
  offlineDraftGenerator,
  type DraftGenerator,
  type DraftResult,
} from "@/lib/draft/draft-assistant";

export type CreateDraftResult =
  | { ok: true; status: 200; result: DraftResult }
  | { ok: false; status: 400 | 401 | 500; error: string };

export interface CreateDraftDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * The generator to use. Injected so the deterministic offline generator can be
   * swapped for the live model-backed one (the route picks based on whether a key
   * is configured) without touching this logic. Defaults to the offline
   * generator, so this runs fully offline with no network or credential.
   */
  generator?: DraftGenerator;
}

export async function createDraft(
  body: unknown,
  deps: CreateDraftDeps,
): Promise<CreateDraftResult> {
  // 1. Auth: the Draft Assistant is a signed-in capability, not an open
  //    endpoint. Fail closed when there is no session (Rules.md §6).
  if (!deps.session) {
    return {
      ok: false,
      status: 401,
      error: "You must be signed in to use the Draft Assistant.",
    };
  }

  // 2. Validate the untrusted request at the boundary (Rules.md §6): right types,
  //    closed enums, bounded fields/arrays. This also caps the request so a
  //    greedy payload can't blow the cost budget before any model spend
  //    (Rules.md §1).
  const parsed = DraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Invalid draft request.",
    };
  }

  // 3. Generate. `generateDrafts` re-runs the domain guard (`checkDraftBrief` —
  //    the business rules a schema can't express, e.g. a must-avoid term that
  //    contradicts the brief's own copy) and then composes the drafts via the
  //    injected generator. It deliberately does NOT call the orchestrator / jury
  //    — generation and judgement stay separate paths.
  const generator = deps.generator ?? offlineDraftGenerator;
  try {
    const outcome = await generateDrafts(parsed.data, { generator });
    if (!outcome.ok) {
      return { ok: false, status: 400, error: outcome.message };
    }
    return { ok: true, status: 200, result: outcome.result };
  } catch (err) {
    // A generation failure (e.g. the live model errored or returned unparseable
    // output) must not crash the request or leak internals (Rules.md §6). Log
    // with redacted context — never the brief content or any secret — and return
    // a plain, retryable message.
    logError("draft generation failed", {
      op: "createDraft",
      companyId: deps.session.companyId,
      generator: generator.name,
      ...errorContext(err),
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't draft copy just now. Please try again.",
    };
  }
}
