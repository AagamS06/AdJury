# AdJury

# AdJury — Claude Code Project Prompt

Paste everything below into Claude Code to kick off the project.

---

## Project Overview

I'm building **AdJury** — an AI-powered content critique tool for businesses. Companies submit ad copy, social posts, or marketing content, and it gets reviewed by 5 distinct AI "juror" personas, each scoring and critiquing from a different angle. The goal is a real SaaS product I can eventually sell to businesses, and a strong portfolio/resume piece.

**Core mechanic:** Rather than paying for 5 separate AI API providers, use ONE cost-efficient model (e.g. GPT-4o-mini, Claude Haiku, or a Groq-hosted open model) with 5 different system prompts/personas. This keeps API costs low while still producing 5 distinct, disagreeing perspectives.

### The 5 Jurors
1. **Brand Voice Guardian** — checks consistency with the company's tone/style guide (business uploads brand examples once; referenced per review)
2. **Compliance & Legal Flagger** — flags unsubstantiated claims, missing disclaimers, industry-specific red flags (finance, health, alcohol, etc.)
3. **Target Audience Fit** — evaluates whether the content actually speaks to the stated demographic/persona
4. **SEO / Discoverability** — checks keyword presence and platform-specific best practices
5. **"Would I Stop Scrolling"** — pure engagement/hook critique from a jaded-consumer perspective

**Output per review:** individual scores per juror, an aggregate score, flagged issues, and actionable suggested rewrites (not just criticism — this is what makes it worth paying for).

### Why this matters for the pitch
Marketing teams already pay for tools like Grammarly Business, Jasper, and Copy.ai. AdJury is a *review/QA layer* for content that's already being produced — lower risk than "generate your content" since humans stay in control, and it plugs into an existing pre-publish workflow.

---

## Target Architecture

- **Multi-tenant from day one:** companies → teams → users → brand profiles → reviews → persona_scores
- **Auth with roles:** admin (sets brand guidelines, manages team) vs. member (submits reviews)
- **Cost control:** cache/reuse brand-voice embeddings per client instead of reprocessing the style guide every review; rate limits per plan tier
- **Billing scaffold:** structure DB/auth to support Stripe subscription tiers later, even if payments aren't wired up in the first pass
- **Exportable reports:** PDF/CSV export of review results for enterprise buyers to share internally

### Suggested stack (adjust if you have a strong preference)
- Frontend: React + Tailwind (or Next.js for combined frontend/backend)
- Backend: Node/Express or Next.js API routes
- DB: Postgres (Supabase is a good managed option for auth + DB together)
- AI: one cheap/fast model provider, called with different system prompts per persona
- Deploy: Vercel (frontend) + Supabase/Railway (DB)

### Rough DB schema to start from
- `companies` (id, name, industry, plan_tier)
- `users` (id, company_id, email, role)
- `brand_profiles` (id, company_id, tone_guide_text, embedding_ref)
- `reviews` (id, company_id, submitted_by, content_text, content_type, created_at)
- `persona_scores` (id, review_id, persona_name, score, feedback_text, suggested_rewrite)

---

## Design preferences
- Color palette: Navy Blue, Royal Blue, Black, White, Burgundy
- Should feel professional/enterprise-credible, not "cutesy AI startup" — this needs to read as a tool a marketing director would trust

---

## Constraints
- Solo developer, ~10 hours/week, first-year CS (AI major) student — comfortable with Python, C++, HTML/CSS/JS; still building depth in full-stack frameworks
- Tight AI API budget — architecture must minimize cost (single model + multiple prompts, caching, rate limits)
- 12-week timeline total (see phase breakdown below) — I want to work in a 4-5 day/week rhythm, ~2-2.5 hrs/day

---

## 12-Week Build Plan (for context — we're starting Week 1 today)

**Weeks 1–2 — Foundation & personas:** define juror rubrics, write/test system prompts, finalize JSON output schema, pick stack, DB schema, auth setup
**Weeks 3–5 — Core review engine:** submission UI, review endpoint, scorecard UI, suggested rewrites, aggregate scoring, review history
**Weeks 6–8 — Multi-tenant & dashboard:** teams/roles, onboarding flow, brand-guide upload/embedding, analytics, export, cost controls, security pass
**Weeks 9–10 — UI/UX polish:** landing page, full visual pass with brand palette, responsive/accessibility, user testing
**Weeks 11–12 — Billing, deploy, launch prep:** Stripe scaffold, pricing page, deploy, portfolio writeup, demo video, outreach to small businesses for testimonials

---

## What I need from you today (Week 1, Day 1)

1. Help me finalize the exact scoring rubric and system prompt for each of the 5 jurors (be specific — what does a 1/10 vs 10/10 look like for each?)
2. Propose a standardized JSON output schema that all 5 personas will return, so scores/feedback can be stored and rendered consistently
3. Scaffold the project repo with the stack above (confirm or suggest alternatives), including folder structure
4. Set up a basic `.env` structure for API keys and DB connection (don't commit secrets)
5. Get one working end-to-end test: submit a sample piece of ad copy → call all 5 personas → return structured JSON output in the terminal/console

Let's start with step 1 — walk me through refining the 5 rubrics before writing any code.
