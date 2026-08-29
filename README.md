# AdJury

**AI-powered content critique for marketing teams.** Submit ad copy, social posts, emails, or landing-page content and get it reviewed by **five distinct AI "juror" personas** — each scoring and critiquing from a different professional angle, and each returning **actionable suggested rewrites**, not just criticism.

AdJury is a **review / QA layer** that fits into your existing pre-publish workflow. Humans stay in control — it critiques and improves content that's already being produced, rather than generating it from scratch.

> **Status:** 🚧 In active development (Week 1 of a 12-week build). Documentation-complete; implementation starting. See [Memory.md](Memory.md) for live status.

---

## Why AdJury

Marketing teams ship content across many channels under time pressure. Before publishing, they need to know it's on-brand, compliant, on-target, discoverable, and actually engaging. Today that review is ad-hoc and inconsistent. AdJury makes it fast, consistent, and defensible — and keeps a human in the loop, which lowers the risk that comes with pure "generate my content" tools.

---

## The Five Jurors

Each juror is the **same cost-efficient model** driven by a different system prompt — five distinct, sometimes-disagreeing perspectives without paying for five providers.

| Juror | Reviews for |
|---|---|
| 🎯 **Brand Voice Guardian** | Consistency with your tone/style guide |
| ⚖️ **Compliance & Legal Flagger** | Unsubstantiated claims, missing disclaimers, industry red flags |
| 👥 **Target Audience Fit** | Whether the copy actually speaks to your audience |
| 🔍 **SEO / Discoverability** | Keyword presence and platform best practices |
| 📱 **"Would I Stop Scrolling"** | Hook and engagement, from a jaded-consumer POV |

**Each review returns:** per-juror scores (0–10), an aggregate score, a verdict (`pass` / `revise` / `fail`), flagged issues, and suggested rewrites — in a consistent, storable JSON structure.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | React + Tailwind CSS + shadcn/ui |
| Database | Postgres (Supabase) |
| Auth | Supabase Auth + Row-Level Security |
| AI | One cost-efficient model (default **Claude Haiku 4.5**), provider-abstracted |
| Validation | Zod |
| Deploy | Vercel + Supabase |

**Cost is a design constraint:** one model + five prompts, cached brand-voice embeddings, and per-plan rate limits keep the per-review cost under a cent. See [Architecture.md](Architecture.md).

---

## Documentation

Start with [Memory.md](Memory.md) for a fast catch-up, then dig into the rest.

| Doc | What's inside |
|---|---|
| 📋 [PRD.md](PRD.md) | Product requirements — what to build, target users, features, the 5 rubrics, JSON output schema |
| 🏗️ [Architecture.md](Architecture.md) | App flow, tech stack, data model, folder structure, AI orchestration |
| 📐 [Rules.md](Rules.md) | Conventions, library choices, AI boundaries, secrets policy, error-handling procedure |
| 🗓️ [Phases.md](Phases.md) | The 12-week plan split into 5 phases with deliverables & acceptance criteria |
| 🎨 [Design.md](Design.md) | Color palette, typography, spacing, components, accessibility |
| 🧠 [Memory.md](Memory.md) | Onboarding + live status: what's done, in progress, and next |

---

## Getting Started

> The application scaffold is being built in Phase 1. These steps reflect the target setup.

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

---

## Roadmap

| Phase | Weeks | Focus |
|---|---|---|
| 1 | 1–2 | Foundation & personas — rubrics, prompts, JSON schema, DB, auth, e2e test |
| 2 | 3–5 | Core review engine — submit → 5 jurors → scorecard → history |
| 3 | 6–8 | Multi-tenant & dashboard — teams/roles, brand upload, analytics, export, cost controls |
| 4 | 9–10 | UI/UX polish — landing page, brand pass, responsive/a11y, user testing |
| 5 | 11–12 | Billing scaffold, pricing, deploy, launch prep |

Full detail in [Phases.md](Phases.md).

---

## Design

Professional and enterprise-credible — **not** a "cutesy AI startup." Palette: Navy `#0A1F44`, Royal Blue `#1E40AF`, Burgundy `#6B1F2A`, Black, White. Full system in [Design.md](Design.md).

---

## Contributing

This is currently a solo project and a portfolio piece. If you're picking it up: read [Memory.md](Memory.md) first, then follow the conventions in [Rules.md](Rules.md).

---

## License

TBD.
