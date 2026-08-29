# AdJury — Project Memory (Onboarding & Status)

> **Purpose:** The single catch-up doc for anyone (human or AI) joining AdJury. Read **this first** — it tells you what AdJury is, what's done, what's in progress, and what's next, so you don't have to read the whole codebase to get oriented.
>
> **Keep this file current.** Update the status tables at the end of every work session (per [Rules.md](Rules.md) §9).
>
> **Last updated:** 2026-08-29

---

## 1. What is AdJury? (30-second version)

An **AI content-critique SaaS**. Businesses paste marketing content (ad copy, social posts, emails, landing pages); **five AI "juror" personas** each score and critique it from a different angle, returning per-juror scores, an aggregate score + verdict, flagged issues, and **suggested rewrites**. It's a **review/QA layer**, not a content generator — humans stay in control.

**Core cost mechanic:** ONE cost-efficient model (default **Claude Haiku 4.5**) called with **five different system prompts**, instead of five paid providers.

**The 5 jurors:** Brand Voice Guardian · Compliance & Legal Flagger · Target Audience Fit · SEO / Discoverability · "Would I Stop Scrolling".

**Read next:** [PRD.md](PRD.md) (what & why) → [Architecture.md](Architecture.md) (how it's built) → [Rules.md](Rules.md) (conventions) → [Phases.md](Phases.md) (plan) → [Design.md](Design.md) (look & feel).

---

## 2. Key Facts (don't re-derive these)

- **Owner / dev:** Aagam Shah (aagamshah250506@gmail.com). Solo, ~10 hrs/week, first-year CS (AI) student. Strong Python/C++/JS; building full-stack depth.
- **Timeline:** 12 weeks, 5 phases. Started Week 1 (~late Aug 2026).
- **Recommended stack:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres/Auth/RLS) + one AI provider behind `lib/ai/client.ts`. See [Architecture.md](Architecture.md) §1. *(This is a recommendation the owner can override — confirm before deep work.)*
- **Output contract:** the juror JSON schema in [PRD.md](PRD.md) §7 is the thing everything depends on. Don't break it silently.
- **Constraints that shape decisions:** tight AI budget (one model, caching, rate limits); multi-tenant safety is non-negotiable; enterprise-credible design, not "cutesy."
- **Palette:** Navy `#0A1F44`, Royal Blue `#1E40AF`, Burgundy `#6B1F2A`, Black `#0B0B0F`, White. See [Design.md](Design.md).

---

## 3. Current Status

**Phase:** 1 (Foundation & personas) — *just beginning.*

### ✅ Done
- Project documentation set authored: PRD, Architecture, Rules, Phases, Design, this Memory doc, and README.
- Core concept, 5-juror definitions, scoring rubric anchors, and JSON output contract specified in [PRD.md](PRD.md).
- Tech stack, data model, folder structure, and AI orchestration flow defined in [Architecture.md](Architecture.md).

### 🚧 In progress / next up (Phase 1)
- [ ] Confirm the stack with the owner (Next.js + Supabase + Claude Haiku) or adjust.
- [ ] Scaffold the repo (Next.js + TS + Tailwind) per [Architecture.md](Architecture.md) §4.
- [ ] Write the 5 persona system prompts in `src/lib/ai/personas/*` and refine each rubric (1/10 vs 10/10 detail).
- [ ] Implement the Zod juror schema in `src/lib/schema/juror.ts`.
- [ ] Write the Supabase migration for the DB schema; set up auth + roles.
- [ ] Create `.env.example` (no secrets).
- [ ] Build the end-to-end test: sample ad copy → 5 jurors → structured JSON in console.

### ⏭️ Later phases (not started)
- Phase 2 — Core review engine (submit UI, review endpoint, scorecard, history).
- Phase 3 — Multi-tenant & dashboard (teams/roles, brand upload + embedding cache, analytics, export, cost controls, security pass).
- Phase 4 — UI/UX polish (landing page, brand pass, responsive/a11y, user testing).
- Phase 5 — Billing scaffold, pricing, deploy, portfolio writeup, demo video, outreach.

See [Phases.md](Phases.md) for full deliverables and acceptance criteria.

---

## 4. Decisions Log

Record notable choices here so they aren't relitigated. Newest first.

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-29 | Recommend **Next.js + Supabase** single stack (vs. separate React + Express backend) | Fewer moving parts for a solo dev; one deploy target; Supabase bundles Postgres + Auth + RLS. |
| 2026-08-29 | Default AI model **Claude Haiku 4.5**, provider abstracted | Cost-efficient; matches README's "one cheap/fast model" mechanic; swappable via `lib/ai/client.ts`. |
| 2026-08-29 | **Compliance juror can veto** to `fail` regardless of aggregate | Legal risk should block publishing even if other scores are high. |
| 2026-08-29 | Authored full docs set before writing code | Locks contracts (JSON schema, data model) that everything else depends on. |

---

## 5. Gotchas & Watch-outs

- **Never break the juror JSON contract** without updating [PRD.md](PRD.md) §7, the Zod schema, and the persistence mapping together.
- **Multi-tenancy:** always derive `company_id` from the session server-side; never trust the client. RLS on every tenant table.
- **Secrets:** only `.env.example` is committed; real keys live in `.env.local` and hosting dashboards. AI/service-role keys are server-side only.
- **Cost:** don't fan out to multiple paid providers per review — that defeats the whole point.

---

## 6. How to Update This File

At the end of a session: move finished items from "In progress" to "Done," add anything non-obvious to the Decisions Log, and bump the **Last updated** date. Keep it skimmable — this is the file that saves everyone from reading the whole repo.

---

_Related: [PRD.md](PRD.md) · [Architecture.md](Architecture.md) · [Rules.md](Rules.md) · [Phases.md](Phases.md) · [Design.md](Design.md)_
