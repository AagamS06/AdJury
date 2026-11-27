import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { getModelClient } from "@/lib/ai/client";
import { createDraft } from "@/lib/draft/create-draft";
import { offlineDraftGenerator } from "@/lib/draft/draft-assistant";
import { modelDraftGenerator } from "@/lib/draft/draft-model";
import {
  checkDraftRateLimit,
  draftRateLimitHeaders,
} from "@/lib/draft/draft-rate-limit";

/**
 * POST /api/draft (DailyPlan Day 89) — the public Draft Assistant surface.
 *
 * The optional, clearly-separate ad-copy generator (PRD §6.3), distinct from the
 * review endpoint so the jury never grades AdJury's own drafts. This handler only
 * wires the real dependencies and translates the outcome to an HTTP response; the
 * validation, auth, and generation logic live in `createDraft`.
 *
 * Identity comes from the server session, never the request body (Rules.md §5).
 * The generator is chosen here: the live model-backed generator when a real
 * provider key is configured, otherwise the deterministic offline generator (the
 * same offline-first posture the review path takes — the mock produces juror
 * JSON only, so the model generator refuses to run on it). The review path and
 * the jury are untouched.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // Resolve the session server-side; treat any failure (e.g. missing Supabase
  // env) as "not signed in" so the endpoint fails closed rather than crashing.
  const session = await getSessionContext().catch(() => null);

  // Day 90: per-plan draft rate limit, enforced before any generation (a live
  // draft is one real model call — AI cost, Rules.md §1). Only meaningful for an
  // authenticated caller — an anon request falls through to createDraft's 401
  // below, so no company's slot is consumed for it.
  if (session) {
    const limited = checkDraftRateLimit({ session });
    if (!limited.ok) {
      return NextResponse.json(
        { error: limited.error, ...limited.rateLimit },
        { status: 429, headers: draftRateLimitHeaders(limited.rateLimit) },
      );
    }
  }

  // Pick the generator: live model when a key is set, otherwise the offline
  // deterministic generator. Built lazily after the handler starts so the choice
  // reflects the current env; the model generator itself refuses the mock.
  const client = getModelClient();
  const generator = client.isMock
    ? offlineDraftGenerator
    : modelDraftGenerator(client);

  const result = await createDraft(body, { session, generator });

  if (result.ok) {
    return NextResponse.json(result.result, { status: result.status });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
