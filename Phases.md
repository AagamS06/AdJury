# AdJury — Build Phases

> **Status:** Draft v1 · **Last updated:** 2026-08-29
> 12-week plan, ~10 hrs/week (2–2.5 hrs/day, 4–5 days/week). Derived from the README's build plan and expanded with deliverables + acceptance criteria. Progress is tracked in [Memory.md](Memory.md).

---

## Overview

| Phase | Weeks | Theme | Outcome |
|---|---|---|---|
| **1** | 1–2 | Foundation & personas | Rubrics, prompts, JSON schema, stack, DB schema, auth, e2e test |
| **2** | 3–5 | Core review engine | Submit → 5 jurors → scorecard → history, in the UI |
| **3** | 6–8 | Multi-tenant & dashboard | Teams/roles, brand upload, analytics, export, cost controls |
| **4** | 9–10 | UI/UX polish | Landing page, full brand pass, responsive/a11y, user testing |
| **5** | 11–12 | Billing, deploy, launch | Stripe scaffold, pricing, deploy, portfolio writeup, demo, outreach |

---

## Phase 1 — Foundation & Personas (Weeks 1–2)

**Goal:** Prove the core mechanic end-to-end in the terminal, and lock the contracts everything else depends on.

**Deliverables**
- Finalized **scoring rubric** per juror — explicit anchors for what a 1/10 vs 10/10 looks like on each lens (Brand Voice, Compliance, Audience Fit, SEO, Stop-Scrolling).
- **System prompt** per juror in `src/lib/ai/personas/*` (one file each).
- **JSON output schema** (Zod) matching [PRD.md](PRD.md) §7, in `src/lib/schema/juror.ts`.
- Stack confirmed; project scaffolded per [Architecture.md](Architecture.md) §4.
- **DB schema** written as a Supabase migration; **auth** (email/password + roles) working.
- **`.env.example`** with all required keys (no secrets committed).
- **End-to-end test:** submit sample ad copy → call all 5 personas → return structured JSON in the console.

**Acceptance criteria**
- [ ] `npm test` runs `tests/e2e-review.test.ts` and returns 5 valid juror objects + aggregate + verdict.
- [ ] Every juror response validates against the Zod schema (contract test passes).
- [ ] Cost per test review is under the target (§ PRD Success Metrics).
- [ ] No secrets in the repo; `.env.example` documents every key.

---

## Phase 2 — Core Review Engine (Weeks 3–5)

**Goal:** Turn the terminal proof into a usable web flow.

**Deliverables**
- **Submission UI** — paste content, pick content type + platform.
- **`POST /api/reviews`** — runs the orchestrator, persists `reviews` + `persona_scores`.
- **Scorecard UI** — per-juror score, summary, issues, suggested rewrite; aggregate + verdict header.
- **Aggregate scoring** + verdict logic (`lib/scoring.ts`), unit-tested.
- **Review history** list per company.

**Acceptance criteria**
- [ ] A logged-in user can submit content and see a rendered scorecard.
- [ ] Reviews persist and appear in history.
- [ ] Scoring/verdict logic has unit tests covering pass/revise/fail and the compliance veto.
- [ ] A single failing juror degrades gracefully (marked `error`, review still returns).

---

## Phase 3 — Multi-Tenant & Dashboard (Weeks 6–8)

**Goal:** Make it a real multi-company product with the reporting enterprises expect.

**Deliverables**
- **Teams & roles** — admin vs member; team management; onboarding flow.
- **Brand-guide upload** + **embedding cache** (Juror 1 references cached brand voice).
- **Analytics dashboard** — score trends over time.
- **Export** — PDF + CSV of review results.
- **Cost controls** — per-plan rate limits, token budgeting.
- **Security pass** — RLS on all tenant tables, server-side authz audit.

**Acceptance criteria**
- [ ] Two companies cannot see each other's data (RLS verified).
- [ ] Admin can upload a brand guide; subsequent reviews reference the cached voice (no reprocessing).
- [ ] Reviews export to valid PDF and CSV.
- [ ] Rate limits enforced per plan tier (429 on exceed).

---

## Phase 4 — UI/UX Polish (Weeks 9–10)

**Goal:** Make it look and feel like a tool a marketing director trusts.

**Deliverables**
- **Landing page** communicating the value prop.
- **Full visual pass** using the brand palette in [Design.md](Design.md).
- **Responsive** layouts + **accessibility** pass (keyboard, contrast, semantics).
- **User testing** with a few real people; fix top friction points.

**Acceptance criteria**
- [ ] Passes an a11y check (contrast, focus states, labels) at WCAG AA for core flows.
- [ ] Works on mobile and desktop widths.
- [ ] Landing page clearly states what AdJury does and for whom.

---

## Phase 5 — Billing, Deploy, Launch Prep (Weeks 11–12)

**Goal:** Deployable, presentable, and ready to show to potential users.

**Deliverables**
- **Stripe scaffold** — subscription tiers wired to plan schema (payments may be test-mode).
- **Pricing page**.
- **Deploy** to Vercel + Supabase (prod).
- **Portfolio writeup**, **demo video**, and outreach to small businesses for testimonials.

**Acceptance criteria**
- [ ] App is live on a public URL.
- [ ] Plan tiers map to rate limits and (scaffolded) billing.
- [ ] A 2–3 minute demo video exists.
- [ ] README reflects the shipped product (see [README](README.md)).

---

## Cross-Phase Definition of Done

Every phase must also satisfy the per-feature **Definition of Done** in [Rules.md](Rules.md) §9 and keep [Memory.md](Memory.md) current.

---

_Related: [PRD.md](PRD.md) · [Architecture.md](Architecture.md) · [Rules.md](Rules.md) · [Memory.md](Memory.md)_
