# AdJury

**AI-powered content critique for marketing teams.** Submit ad copy, a social post, an email, a landing page, or an image ad and get it reviewed by **six distinct AI "juror" personas** — each scoring and critiquing from a different professional angle, and each returning **actionable suggested rewrites**, not just criticism.

AdJury is the **QA layer for marketing teams** — a review stage that fits into your existing pre-publish workflow. Humans stay in control: it flags risks and hands you rewrites, but it never publishes anything itself.

> **Status:** v1 feature-complete — in launch preparation (Week 12 of the 12-week build). The full review engine, multi-tenant dashboard, analytics, exports, and billing scaffold are implemented and covered by an extensive automated test suite. See [Memory.md](Memory.md) for live status.

---

## Why AdJury

Marketing teams ship content across many channels under time pressure. Before publishing, they need to know it's on-brand, compliant, on-target, discoverable, engaging, and a believable fit for the actual business. Today that review is ad-hoc and inconsistent. AdJury makes it fast, consistent, and defensible — and keeps a human in the loop, which lowers the risk that comes with pure "generate my content" tools.

---

## The Six Jurors

Each juror is the **same cost-efficient model** driven by a different system prompt — six distinct, sometimes-disagreeing perspectives without paying for six providers. Five focus on the craft — voice, compliance, audience, SEO, and the hook — and the sixth, the Business Analyst, adds an insider read grounded in the company's real business.

| Juror | Reviews for |
|---|---|
| **Brand Voice Guardian** | Consistency with your tone/style guide |
| **Compliance & Legal Flagger** | Unsubstantiated claims, missing disclaimers, industry red flags |
| **Target Audience Fit** | Whether the copy actually speaks to your audience |
| **SEO / Discoverability** | Keyword presence and platform best practices |
| **"Would I Stop Scrolling"** | Hook and engagement, from a jaded-consumer POV |
| **Business Analyst (Insider)** | Whether the ad reflects what the company really offers — grounded in business context researched from public sources, never invented |

**Each review returns:** per-juror scores (0–10), an aggregate score, a verdict (`pass` / `revise` / `fail`), flagged issues with severities, and suggested rewrites — in a consistent, Zod-validated, storable JSON structure. A high-severity compliance flag can veto the verdict to `fail` regardless of the average.

---

## What's shipped

- **Multi-format review** — paste text or upload an **image ad** (reviewed as a vision input alongside its caption/headline/CTA). Short- and long-form video are a planned later format.
- **Business grounding** — capture the company's name + website once; AdJury researches the business from public sources, caches a bounded summary, and grounds every juror in the right market.
- **Scorecard UI** — per-juror score, summary, issues, and a suggested rewrite with a diff view; aggregate score and verdict up top.
- **Review history & analytics** — per-company history with filtering, plus a dashboard of score trends over time.
- **Exports** — download any review as **PDF** or **CSV** for stakeholder reporting.
- **Multi-tenant & role-aware** — companies → teams → users, admin vs. member, invitations and onboarding, enforced by Postgres **Row-Level Security**.
- **Brand profile** — admins upload a tone/style guide once; its summary/embedding is cached and reused by the Brand Voice Guardian instead of being reprocessed every review.
- **Cost controls** — one model + six prompts, brand-voice caching, and per-plan rate limits keep the per-review cost under a cent.
- **Billing scaffold** — Stripe-backed subscription tiers, a pricing page, and server-enforced feature gating (billing is scaffolded, not a live payment flow in v1).
- **Deploy-ready** — production config, deploy smoke checks, error/event monitoring, and SEO (OG/meta, sitemap, robots) are all implemented and offline-verifiable; the live deploy itself is a documented operator step (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

---

## Architecture at a glance

A single Next.js 15 codebase serves both the UI and the API. A review request flows:

```
Browser ─▶ /api/reviews ─▶ authz (Supabase session → company_id, role) ─▶ rate limit
                            │
                            ├─ load brand profile (cached summary) + business context
                            ├─ assemble 6 persona prompts
                            ├─ AI orchestrator: fan out 6 calls in parallel (one model)
                            ├─ validate each juror vs. the Zod contract (retry once, else mark `error`)
                            ├─ aggregate (weighted mean + compliance veto) → verdict
                            └─ persist reviews + persona_scores (RLS-protected)
                            │
Scorecard UI ◀─────────────┘
```

**Design decisions worth calling out (portfolio notes):**

- **One provider, six prompts, behind one interface.** `lib/ai/client.ts` exposes a single `complete()` so the model/provider is swappable; the orchestrator just maps the six personas over it. This is the core cost mechanic — six expert lenses for roughly the price of one small-model call.
- **Model output is untrusted input.** Every juror response is parsed and Zod-validated against the PRD §7 contract; a malformed juror is retried once, then recorded as `error` without failing the whole review.
- **Deterministic offline mock.** The AI client falls back to a deterministic mock when no `AI_API_KEY` is set, so the entire jury, scoring, and persistence run — and the whole test suite passes — with no network and no secret. Try it with `npm run demo`.
- **Multi-tenant safety is enforced server-side.** `company_id` is always derived from the authenticated session, never trusted from the client, and every tenant table is fenced by RLS.
- **Documentation and config claims are executable.** A recurring engineering pattern across the build is a *pure core + static audit + reconcile drift guard* — palette, copy, SEO, routes, prod config, and this README each have a node-testable audit that fails if the shipped reality drifts from what's documented.

Full detail in [Architecture.md](Architecture.md).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript (strict) |
| UI | React + Tailwind CSS + shadcn/ui |
| Database | Postgres (Supabase) + Row-Level Security |
| Auth | Supabase Auth (email/password + roles) |
| AI | One cost-efficient model (default **Claude Haiku 4.5**), provider-abstracted |
| Validation | Zod |
| Billing | Stripe (subscription scaffold) |
| Deploy | Vercel + Supabase |

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (never commit real secrets)
cp .env.example .env.local
# then fill in Supabase + AI provider keys in .env.local

# 3. Run the dev server
npm run dev
```

Required environment variables are documented in `.env.example`. Secrets live only in `.env.local` (gitignored) and your hosting dashboards — see [Rules.md](Rules.md) §4.

**No keys? No problem.** The AI client ships a deterministic offline mock, so you can see a full six-juror review without any provider key:

```bash
npm run demo        # run one review end-to-end against the offline mock
npm test            # the full automated test suite (offline, deterministic)
npm run typecheck   # TypeScript strict type-check
```

Other useful scripts: `npm run build`, `npm run seed:demo`, `npm run db:smoke`, `npm run prod:check`, `npm run deploy:smoke`, `npm run monitor:check`.

---

## Documentation

Start with [Memory.md](Memory.md) for a fast catch-up, then dig into the rest.

| Doc | What's inside |
|---|---|
| [PRD.md](PRD.md) | Product requirements — target users, features, the six jurors, scoring rubric, JSON output schema |
| [Architecture.md](Architecture.md) | App flow, tech stack, data model, folder structure, AI orchestration |
| [Rules.md](Rules.md) | Conventions, library choices, AI boundaries, secrets policy, error-handling procedure |
| [Phases.md](Phases.md) | The 12-week plan split into 5 phases with deliverables & acceptance criteria |
| [Design.md](Design.md) | Color palette, typography, spacing, components, accessibility |
| [Memory.md](Memory.md) | Onboarding + live status: what's done, in progress, and next |

Operational runbooks live in [docs/](docs/): [DEPLOYMENT.md](docs/DEPLOYMENT.md), [PRODUCTION_SETUP.md](docs/PRODUCTION_SETUP.md), [MONITORING.md](docs/MONITORING.md), and [USER_TEST_SCRIPT.md](docs/USER_TEST_SCRIPT.md).

---

## Roadmap

| Phase | Weeks | Focus | Status |
|---|---|---|---|
| 1 | 1–2 | Foundation & personas — rubrics, prompts, JSON schema, DB, auth, e2e test | Done |
| 2 | 3–5 | Core review engine — submit → six jurors → scorecard → history | Done |
| 3 | 6–8 | Multi-tenant & dashboard — teams/roles, brand upload, analytics, export, cost controls | Done |
| 4 | 9–10 | UI/UX polish — landing page, brand pass, responsive/a11y, user testing | Done |
| 5 | 11–12 | Billing scaffold, pricing, deploy, launch prep | In progress |

Planned after v1: short- and long-form **video ad review**, an optional and clearly-separate **Draft Assistant** (generation, kept distinct from the jury), and **live business research** backed by web search. Full detail in [Phases.md](Phases.md) and [DailyPlan.md](DailyPlan.md).

---

## Design

Professional and enterprise-credible — **not** a "cutesy AI startup." Palette: Navy `#0A1F44`, Royal Blue `#1E40AF`, Burgundy `#6B1F2A`, Black, White. Verdicts and score tiers always carry a text label, never color alone (WCAG 2.1 AA). Full system in [Design.md](Design.md).

---

## Contributing

This is currently a solo project and a portfolio piece. If you're picking it up: read [Memory.md](Memory.md) first, then follow the conventions in [Rules.md](Rules.md).

---

## License

**Proprietary — All Rights Reserved.** © 2026 Aagam Shah. The source is public for
demonstration and portfolio purposes only; no rights to use, copy, modify, deploy,
or distribute are granted. See [LICENSE](LICENSE).
