# AdJury — Live business research

> **Purpose:** how AdJury grounds every juror in *what business an ad is for* —
> and how the live, web-search-backed researcher swaps in behind the existing
> `BusinessResearcher` seam (DailyPlan Day 88 — a Week-13 backlog goal; PRD §4/§5,
> Day 23a).
>
> This document is the human-readable face of `src/lib/company/business-context.ts`,
> checked by `npm run research:check`. The deterministic offline researcher works
> fully here; the live web-search pass is the documented credential-gated step
> (see **Blocked / needs credentials**).

---

## Why this exists

Judging an ad well means knowing which business it is for — its field, what it
offers, and who its audience is (PRD §4/§5). A company records its name,
industry, and public website at onboarding; from that identity AdJury derives a
small, bounded **business summary**, caches it on the `companies` row
(`business_summary` + `business_context_ref`) once, and injects it into every
juror. The read path is a plain cache lookup, so **cost per review is independent
of the site's size** (Architecture.md §5; Rules.md §1 cost discipline).

## Two researchers, one seam

Research is injectable, so the honest offline floor and the live, grounded
researcher share one interface and the cache/read path never changes.

- **Offline researcher** (`offlineBusinessResearcher`, the default) is pure,
  deterministic, and needs no network or key. It states the business's name,
  field, and site from the inputs the company already gave — grounding, **not
  invention** (Rules.md §3): it fabricates no products, revenue, customers, or
  claims. This is what runs in this cloud build, and what every test pins.
- **Live researcher** (`modelBusinessResearcher`) makes **one** Claude call with
  the server-side `web_search` tool over the company's name + website (Rules.md §2
  — one provider behind `lib/ai/client.ts`). Grounding comes from the search: the
  system prompt tells the model to describe only what it can verify and to invent
  nothing, and the output is bounded to the same cache size. It refuses to run on
  the offline mock (which only produces juror JSON).

```
identity ─► [researcher] ─► bounded summary ─► cache (business_summary + ref)
            offline default: states name/field/site      │
            live swap-in: ONE web_search call, grounded   ▼
            in what the site actually says        every juror is grounded
                                                  (read path = cache lookup)
```

## Grounding and cost guards

| Guard | Rule |
|---|---|
| Grounded, not invented | Offline: states only the given identity. Live: system prompt forbids invention; grounding comes from `web_search`. (Rules.md §3) |
| Bounded summary | Every summary is capped at `MAX_BUSINESS_SUMMARY_CHARS` (500) before caching. |
| Bounded search | The live call caps searches at `MAX_RESEARCH_SEARCHES` and output at `RESEARCH_MAX_OUTPUT_TOKENS` (cost discipline, Rules.md §1). |
| Research once | `computeBusinessContextCacheAsync` runs on an identity change (write side), never per review. The identity-keyed `business_context_ref` makes an unchanged identity reuse the cache and any change recompute. |
| Fail-safe | `researchBusinessContext` prefers the live researcher but **always** falls back to the offline floor if no key is configured, the search turns up empty, or the call throws — a save never fails for lack of research (Rules.md §6). |

## Verify it offline

```
npm run research:check   # researches a sample business through the seam, prints the summary + readiness
npm test                 # tests/business-research.test.ts
```

With no `AI_API_KEY` the model client is the offline mock, so `research:check`
reports `Source: offline` and uses the deterministic summary — nothing is
fabricated, and the reconcile still proves the whole seam is wired correctly.

---

## Blocked / needs credentials

The offline researcher and the full live seam are complete and proven here. Two
steps remain, reported as `manual` items by `buildBusinessResearchReadiness`:

1. **Live web-search research** — `modelBusinessResearcher` is implemented in
   full; it needs a live `AI_API_KEY` **and outbound network** to run its one
   `web_search` Claude call (Rules.md §4 — never commit or fabricate a key).
   Without them the offline mock stands in and the deterministic summary is used,
   so the feature is fully exercisable without a credential.
2. **Wire live research into the save path** — the onboarding / website-save
   action (`src/lib/company/actions.ts`) currently calls the synchronous offline
   `computeBusinessContextCache`. To turn on live research, call
   `researchBusinessContext(identity, resolveLiveBusinessResearcher(getModelClient()))`
   there instead, so an identity change triggers one live pass with the offline
   floor as fallback. The review **read path is unchanged** either way — it only
   ever reads the cached summary. This is a small, safe swap left for the operator
   with a live key so the change can be verified against real search results.

---

_Related: [PRD.md](../PRD.md) §4/§5 · [Rules.md](../Rules.md) §1/§2/§3 · [Architecture.md](../Architecture.md) §5 · [DailyPlan.md](../DailyPlan.md) Day 88 · `src/lib/company/business-context.ts`_
