# AdJury — Product Requirements Document (PRD)

> **Status:** Draft v1 · **Owner:** Aagam Shah · **Last updated:** 2026-08-29

---

## 1. Summary

**AdJury** is an AI-powered content critique platform. Businesses submit marketing content (ad copy, social posts, emails, landing-page copy) and it is reviewed by **five distinct AI "juror" personas**, each scoring and critiquing from a different professional angle. Every review returns per-juror scores, an aggregate score, flagged issues, and **actionable suggested rewrites**.

AdJury is a **review / QA layer**, not a content generator. Humans stay in control; AdJury slots into the pre-publish workflow that marketing teams already have.

---

## 2. Problem

Marketing teams ship content across many channels under time pressure. Before publishing, they need to know:
- Does this match our brand voice?
- Could this get us in legal/compliance trouble?
- Does it actually speak to our target audience?
- Is it discoverable (SEO / platform best practices)?
- Will anyone actually stop and engage?

Today this is done by ad-hoc human review, if at all. It is inconsistent, slow, and dependent on who happens to be looking. Generative tools ("write my ad") carry brand and compliance risk because they remove the human. AdJury keeps the human in the loop and de-risks what they publish.

---

## 3. Goals & Non-Goals

### Goals
- Deliver **5 distinct, sometimes-disagreeing** critiques from a single cost-efficient AI model.
- Return a **consistent, structured, storable** result for every review (see §7 JSON schema).
- Be **multi-tenant** and **role-aware** from day one (companies → teams → users).
- Keep **AI cost low** via single-model + multi-prompt, brand-voice caching, and per-tier rate limits.
- Read as an **enterprise-credible** tool a marketing director would trust.

### Non-Goals (v1)
- Generating original campaigns from scratch (we critique + rewrite, not ideate from zero).
- Real-time collaborative editing (Google-Docs-style).
- Live payment processing — billing is **scaffolded** (schema + tiers), not wired to Stripe in the first pass.
- Fine-tuning or hosting our own model.
- Mobile native apps (responsive web only).

---

## 4. Target Users

| Persona | Role | What they need |
|---|---|---|
| **Marketing Director / Manager** | Admin buyer | Consistency, risk reduction, exportable reports to justify decisions |
| **Content Marketer / Copywriter** | Member | Fast, specific, actionable feedback before publishing |
| **Social Media Manager** | Member | Hook/engagement critique and platform-fit checks |
| **Compliance / Legal reviewer** | Reviewer (later) | Flagged claims and missing disclaimers surfaced automatically |

**Primary buyer:** Marketing Director at an SMB or mid-market company (10–200 employees) that already pays for tools like Grammarly Business, Jasper, or Copy.ai.

---

## 5. The Five Jurors

Each juror is the **same model** with a different system prompt, rubric, and output contract.

| # | Juror | Lens | Flags / focuses on |
|---|---|---|---|
| 1 | **Brand Voice Guardian** | Consistency with the company's tone/style guide | Off-tone phrasing, forbidden words, voice drift (references the brand profile) |
| 2 | **Compliance & Legal Flagger** | Risk & substantiation | Unsubstantiated claims, missing disclaimers, industry red flags (finance, health, alcohol, etc.) |
| 3 | **Target Audience Fit** | Audience resonance | Whether copy speaks to the stated demographic/persona; jargon mismatch, wrong register |
| 4 | **SEO / Discoverability** | Findability | Keyword presence, platform-specific best practices, metadata/length |
| 5 | **"Would I Stop Scrolling"** | Engagement / hook | Weak hooks, buried value, boring openers — from a jaded-consumer POV |

### 5.1 Scoring rubric (applies to every juror)

Every juror scores **0–10** on its own lens. Shared anchors keep scores comparable:

| Score | Meaning |
|---|---|
| **9–10** | Excellent. Ship as-is; only nitpicks. |
| **7–8** | Good. Minor improvements suggested. |
| **5–6** | Mixed. Real issues; revise before publishing. |
| **3–4** | Weak. Significant problems on this lens. |
| **0–2** | Failing. Do not publish; major rework needed. |

Per-juror rubric detail (what a 1 vs a 10 looks like on each lens) is maintained in **[Phases.md](Phases.md)** under Phase 1 deliverables, since the exact prompt wording is a living artifact refined during Weeks 1–2.

### 5.2 Aggregate score & verdict

- **Aggregate** = weighted mean of the five juror scores. Default weights are equal (0.2 each); weights are configurable per plan/company later.
- **Verdict** is derived from the aggregate and any high-severity compliance flag:
  - `pass` — aggregate ≥ 7.5 **and** no high-severity compliance issue
  - `revise` — aggregate 5.0–7.4, **or** any medium issue
  - `fail` — aggregate < 5.0 **or** any high-severity compliance issue (compliance can veto)

---

## 6. Core Features

### 6.1 v1 (MVP — must have)
- **Submit content** for review (paste text; choose content type + target platform).
- **Run the 5 jurors** against the content in one request.
- **Scorecard UI** — per-juror score, summary, issues, and suggested rewrite; aggregate + verdict up top.
- **Review history** per company.
- **Auth + roles** — admin vs member.
- **Brand profile** — admin uploads tone/style guide once; Juror 1 references it.

### 6.2 v1.5 (should have)
- **Team management** & onboarding flow.
- **Brand-voice embedding cache** (avoid reprocessing the style guide every review).
- **Analytics dashboard** — score trends over time.
- **Export** review results to **PDF / CSV**.
- **Cost controls** — per-tier rate limits, token budgeting.

### 6.3 v2 (later / nice to have)
- **Stripe billing** wired to subscription tiers.
- Custom juror weights per company.
- Additional/custom jurors defined by the customer.
- Integrations (Slack, browser extension, CMS pre-publish hook).

---

## 7. Output Contract (JSON schema)

All five personas return objects conforming to a single schema so results store and render consistently. Canonical schema:

```json
{
  "review_id": "uuid",
  "content_type": "ad_copy",
  "platform": "instagram",
  "model": "claude-haiku-4-5",
  "created_at": "2026-08-29T00:00:00Z",
  "aggregate_score": 7.2,
  "verdict": "revise",
  "jurors": [
    {
      "persona": "brand_voice_guardian",
      "score": 8,
      "confidence": "high",
      "summary": "On-brand and confident, with two off-tone phrases.",
      "issues": [
        {
          "severity": "medium",
          "excerpt": "literally the best thing ever",
          "explanation": "Hyperbolic slang conflicts with the stated 'measured, expert' tone."
        }
      ],
      "suggested_rewrite": "One of the most effective tools we've tested this year."
    }
  ]
}
```

**Rules for the contract**
- `persona` ∈ `brand_voice_guardian | compliance_legal_flagger | target_audience_fit | seo_discoverability | stop_scrolling`.
- `score` is an integer 0–10; `confidence` ∈ `high | medium | low`.
- `severity` ∈ `high | medium | low`. `issues` may be an empty array.
- `suggested_rewrite` is required (may equal the original if nothing to change — but must be present).
- The API validates every juror object against this schema; a non-conforming juror response is retried once, then recorded as `error` for that juror without failing the whole review.

See **[Architecture.md](Architecture.md)** for how this maps to the `reviews` / `persona_scores` tables.

---

## 8. Success Metrics

| Metric | Target (first pass) |
|---|---|
| End-to-end review latency | < 15s for all 5 jurors |
| Cost per review | < $0.01 (single small model, cached brand voice) |
| Schema-valid juror responses | > 98% (after 1 retry) |
| Reviews per active company / week | ≥ 5 (engagement signal) |
| Suggested-rewrite usefulness (user thumbs-up) | ≥ 70% |

---

## 9. Constraints & Assumptions

- **Solo developer**, ~10 hrs/week, first-year CS student (strong Python/C++/JS, building full-stack depth).
- **Tight AI budget** — architecture must minimize cost (one model, many prompts; caching; rate limits).
- **12-week timeline**, ~2–2.5 hrs/day, 4–5 days/week (see [Phases.md](Phases.md)).
- Users bring their own content and brand guidelines; we do not scrape or source content.
- English-first for v1.

---

## 10. Open Questions

- Final per-juror prompt wording and calibration examples (owned in Phase 1).
- Default aggregate weighting — equal vs. compliance-weighted?
- Which AI provider is primary vs. fallback (see [Rules.md](Rules.md) §Libraries)?
- PDF export: server-rendered vs. client-rendered?

---

_Related docs: [Architecture.md](Architecture.md) · [Rules.md](Rules.md) · [Phases.md](Phases.md) · [Design.md](Design.md) · [Memory.md](Memory.md)_
