# AdJury — Draft Assistant (ad generation)

> **Purpose:** how AdJury's **optional, separate** Draft Assistant drafts ad copy
> on request (DailyPlan Day 87 — a Week-13 backlog goal; PRD §6.3).
>
> This document is the human-readable face of `src/lib/draft/draft-assistant.ts`,
> checked by `npm run draft:check`. The deterministic offline generator works
> fully here; live model-backed generation and the public `/draft` surface are the
> documented next steps (see **Blocked / needs credentials**).

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
- **Live generator** (`modelDraftGenerator`) makes **one** model call through the
  shared provider client (Rules.md §2 — one provider behind `lib/ai/client.ts`)
  and Zod-validates the output per draft. It produces richer copy behind the same
  interface. It refuses to run on the offline mock (which only knows juror JSON).

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
npm test              # tests/draft-assistant.test.ts
```

Everything above runs with **no key and no network**: the deterministic offline
generator makes the whole feature reproducible here, including the executable
proof that the core is separate from the jury.

---

## Blocked / needs credentials

The Draft Assistant core and its offline generator are complete and proven here.
Two steps remain, reported as `manual` items by `buildDraftAssistantReadiness`:

1. **Live model-backed generation** — `modelDraftGenerator` is implemented in
   full; it needs `AI_API_KEY` to make its one real Claude call (Rules.md §4 —
   never commit or fabricate a key). Offline, the deterministic generator stands
   in, so the feature is fully exercisable without a credential.
2. **Public Draft Assistant surface (`/draft` route + UI)** — wiring a separate,
   opt-in `/draft` page + endpoint (distinct from `/review`, so the jury path is
   untouched) is the next increment. This is a scope decision, **not** a
   credential blocker: the review endpoint and the jury are deliberately left
   unchanged this day, keeping the QA-layer core first and the generation mode
   clearly separate.

---

_Related: [PRD.md](../PRD.md) §6.3 · [Rules.md](../Rules.md) §1/§3 · [DailyPlan.md](../DailyPlan.md) Day 87 · `src/lib/draft/draft-assistant.ts`_
