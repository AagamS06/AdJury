# AdJury — Draft Assistant (ad generation)

> **Purpose:** how AdJury's **optional, separate** Draft Assistant drafts ad copy
> on request (DailyPlan Day 87 — a Week-13 backlog goal; PRD §6.3). The public
> `/draft` surface shipped in **Day 89**.
>
> This document is the human-readable face of `src/lib/draft/draft-assistant.ts`
> (the pure core), `src/lib/draft/draft-model.ts` (the live generator),
> `src/lib/draft/create-draft.ts` + `src/app/api/draft/route.ts` (the endpoint),
> and the `/draft` page, checked by `npm run draft:check`. The deterministic
> offline generator works fully here; only live model-backed generation is the
> documented credential-gated step (see **Blocked / needs credentials**).

## Using it (the `/draft` surface — Day 89)

A signed-in user opens **Draft assistant** in the workspace nav (`/draft`),
describes the brief (product, audience, key message, tone, content type,
platform, optional must-include / must-avoid phrases, and how many variants),
and submits. The page calls `POST /api/draft`, which:

1. requires a session (401 otherwise — the generator is not an open endpoint);
2. validates the request at the boundary with `DraftRequestSchema` (closed
   enums, bounded fields/arrays — a 400 with a specific message otherwise);
3. generates via the live model generator when `AI_API_KEY` is set, otherwise
   the deterministic offline generator (the same offline-first posture the review
   path takes);
4. returns the drafts + the standing disclaimer, which the page renders as
   variant cards with a prominent "not a review" notice.

The surface is deliberately **distinct from `/review`**: a draft is plain copy
with a link inviting the user to submit a chosen variant as a *new* review. The
review endpoint and the jury are untouched.

---

## Why this exists, and why it's safe

AdJury is, and stays, a **QA / review layer — not a content generator**
(Rules.md §1; PRD §1/§3). The Draft Assistant is the one deliberate exception the
PRD carves out (§6.3): an **optional** mode that drafts ad copy from a brief,
kept strictly *separate* from the jury so the critique never grades its own
output. It is additive, not a pivot.

The separation is a **load-bearing invariant**, not a convention:

- The Draft Assistant core imports **neither** the orchestrator (`runReview`)
  **nor** any persona. Generation therefore *cannot* invoke the jury. This is
  proven by `findJuryImports`, which scans the core's own source — the executable
  guarantee, surfaced in `npm run draft:check`.
- A generated **draft is plain copy** (headline / body / CTA). It carries no
  score, verdict, confidence, or persona — it can never be confused with, or fed
  back into, a jury result.
- Every result ships a standing disclaimer: drafts are AI-generated starting
  points a person edits and approves before publishing, and AdJury does **not**
  auto-grade its own drafts. To check a draft, a person submits it as a *new*
  review — a separate, human-initiated act.

```
brief ─► [generator] ─► AdDraft[]         (a person edits + approves)
         offline default: deterministic,     …and may THEN choose to submit a
         composes the brief into variants      draft as a NEW review — never done
         (invents no facts)                     automatically by this module
```

## What the generator does

- **Offline generator** (`offlineDraftGenerator`, the default) is deterministic
  and **invents nothing** (Rules.md §3 "grounded, not invented"): it composes the
  advertiser's own brief into N variants using different creative angles plus a
  fixed, claim-free tone/CTA vocabulary. No fabricated statistics, prices, dates,
  customers, or claims — every digit in a draft came from the brief. This is the
  honest offline floor; it needs no key or network.
- **Live generator** (`modelDraftGenerator`, in `src/lib/draft/draft-model.ts`)
  makes **one** model call through the shared provider client (Rules.md §2 — one
  provider behind `lib/ai/client.ts`) and Zod-validates the output per draft. It
  produces richer copy behind the same interface. It refuses to run on the offline
  mock (which only knows juror JSON). It lives in its **own module**, separate
  from the pure core, so the core (reached from the `/draft` client form) imports
  no credential-bearing code and the client bundle never pulls in `ai/client` —
  the secrets-audit (Day 46) proves this.

## The brief, and its guards (Rules.md §1 / §6)

`checkDraftBrief` validates a brief before any generation or model spend:

| Guard | Rule |
|---|---|
| Required fields | `product`, `audience`, `keyMessage` are present and within their caps. |
| Field length | Each free-text field obeys its character cap. |
| Constraints | At most `MAX_CONSTRAINT_ITEMS` must-include / must-avoid items, each bounded. |
| Variants | `MIN_DRAFT_VARIANTS`–`MAX_DRAFT_VARIANTS` (1–5). |
| No contradiction | A must-avoid term may not also appear in the brief's own copy. |

The offline generator additionally guarantees, per draft: every **must-include**
phrase appears (for non–social-post copy), and no **must-avoid** term is ever
emitted.

## Verify it offline

```
npm run draft:check   # runs a sample brief through the offline generator, prints the drafts + readiness
npm test              # tests/draft-assistant.test.ts, create-draft.test.ts, draft-form.test.ts, draft-surface.test.ts
```

Everything above runs with **no key and no network**: the deterministic offline
generator makes the whole feature reproducible here, including the executable
proof that the core is separate from the jury.

---

## Blocked / needs credentials

The Draft Assistant core, its offline generator, and the public `/draft` surface
are complete and proven here. One step remains, reported as the single `manual`
item by `buildDraftAssistantReadiness`:

1. **Live model-backed generation** — `modelDraftGenerator` is implemented in
   full; it needs `AI_API_KEY` to make its one real Claude call (Rules.md §4 —
   never commit or fabricate a key). Offline, the deterministic generator stands
   in, so the whole surface — form, endpoint, and rendered drafts — is fully
   exercisable without a credential.

### Follow-up (a reviewed scope decision, not a blocker)

- **A per-plan draft rate limit.** `POST /api/draft` is signed-in only, its
  request is capped by `DraftRequestSchema`, and the live generator makes one
  bounded model call per request (no six-juror fan-out), so a request's cost is
  small by construction. A dedicated per-plan draft limiter (like the review /
  export / read limiters) is a declared follow-up — recorded in the Day-47 abuse
  surface inventory as a reviewed exemption, never a silent gap. Offline, the
  deterministic generator has no model cost.

---

_Related: [PRD.md](../PRD.md) §6.3 · [Rules.md](../Rules.md) §1/§3 · [DailyPlan.md](../DailyPlan.md) Day 87 & 89 · `src/lib/draft/draft-assistant.ts` · `src/lib/draft/draft-model.ts` · `src/app/api/draft/route.ts`_
