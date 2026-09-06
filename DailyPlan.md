# AdJury — Day-by-Day Plan (7-day weeks × 12 weeks)

> **Status:** Active · **Last updated:** 2026-09-05 (Day 9 — Scorecard + JurorCard)
> The 12-week build ([Phases.md](Phases.md)) broken into **84 daily tasks (7 days/week)**, plus a Week 13 buffer. This is the source of truth for the **daily 4:30am routine**, which executes exactly **one** unchecked day per run and opens a PR.

## How the daily routine uses this file
1. Pull latest `main`; read [Memory.md](Memory.md) and this file.
2. Find the **first day with an unchecked `- [ ]` box** that does **not** already have an open PR.
3. Branch off `main` (or off the previous day's branch if that day's PR is still open, to preserve continuity).
4. Do that day's tasks per [Rules.md](Rules.md) / [Architecture.md](Architecture.md) / [Design.md](Design.md). Run `npm install`, `npm run typecheck`, `npm test`; fix failures.
5. Tick the day's box here, update [Memory.md](Memory.md), commit, and **open a PR** titled `Day NN — <title>`. Do **not** merge, and never commit secrets.
6. If blocked on credentials (live AI key / Supabase prod), do what's possible in offline/mock mode, note the blocker in the PR, and still open it. One day per run.

Legend: `- [x]` done · `- [ ]` pending. "DoD" = done when.

---

## Week 1 — Foundation & personas

### Day 1 — Scaffold & juror engine ✅
- [x] Next.js + TS + Tailwind scaffold; Zod juror schema; 5 persona prompts + rubrics; orchestrator; scoring + compliance veto; provider-abstracted client with offline mock; Supabase migration + RLS; e2e demo + Vitest suite.
- DoD: `npm test` (12 tests) and `npm run demo` green; typecheck clean. **Completed 2026-08-29.**

### Day 2 — DB data-access layer ✅
- [x] Implement `src/lib/db/queries.ts`: typed helpers for companies, users, brand_profiles, reviews, persona_scores (insert review + scores, fetch by id, list by company).
- [x] Add a `scripts/db-smoke.ts` that inserts and reads a review (runs against a dev Supabase if `.env.local` present; otherwise documents the manual steps).
- DoD: queries typecheck; smoke script documented/working; no secrets committed.

### Day 3 — Auth foundation ✅
- [x] Wire Supabase Auth (email/password); server session helper; signup provisions a `companies` row + admin `users` row.
- [x] Login / logout / signup pages (minimal, on-brand).
- DoD: a new signup creates company + user rows; session persists; typecheck/tests green. **Completed 2026-08-30.**

### Day 4 — Role-based access ✅
- [x] Route protection: unauthenticated → login; gate `/(dashboard)`; admin-only guard for brand/team routes.
- DoD: member cannot reach admin routes; unauth redirected; add a guard unit test. **Completed 2026-08-31.**

### Day 5 — Review endpoint ✅
- [x] `POST /api/reviews`: Zod-validate input, run orchestrator, persist `reviews` + `persona_scores`, return `ReviewResult`. Derive `company_id`/`submitted_by` from the session (never trust client). **Completed 2026-09-01.**
- DoD: endpoint returns a valid review and rows persist tenant-safely; add an endpoint test with the mock client.

### Day 6 — Fetch & list endpoints ✅
- [x] `GET /api/reviews/[id]` and a list endpoint, both scoped to the caller's company via RLS/serverClient. **Completed 2026-09-02.**
- DoD: fetch-by-id and list return only the company's rows; add tests.

### Day 7 — Week 1 hardening ✅
- [x] Expand tests (endpoint + tenancy); light persona-prompt calibration; refresh [Memory.md](Memory.md); write a short Week 1 summary. **Completed 2026-09-03.**
- DoD: all tests green; Memory.md current.

---

## Week 2 — Submission & scorecard UI

### Day 8 — Submission UI ✅
- [x] `/review` submission form: content textarea, content-type + platform selects, client-side Zod validation, calls `/api/reviews`. **Completed 2026-09-04.**
- DoD: a logged-in user can submit and receive a review payload.

### Day 9 — Scorecard + JurorCard ✅
- [x] Scorecard component: aggregate + verdict header; `JurorCard` (score chip, summary, issues, suggested rewrite) per [Design.md](Design.md). **Completed 2026-09-05.**
- DoD: a returned review renders as a full scorecard.

### Day 10 — Verdict/score visual system
- [ ] Score→color mapping, verdict pills, and issue-severity styling — always paired with text labels (never color-only, a11y).
- DoD: matches Design.md §5; labels present for screen readers.

### Day 11 — Review history
- [ ] `/history`: list past reviews (date, aggregate, verdict) linking to detail; company-scoped.
- DoD: history loads and is tenant-safe.

### Day 12 — Review detail page
- [ ] `/review/[id]`: render a persisted review from stored `reviews` + `persona_scores`.
- DoD: detail page reconstructs the full scorecard from the DB.

### Day 13 — States & resilience
- [ ] Loading / error / empty states across submit, scorecard, history; graceful single-juror `error` rendering.
- DoD: no unhandled states; matches Rules.md §6.

### Day 14 — Week 2 hardening
- [ ] UI-logic tests; accessibility spot-check; refresh Memory.md; Week 2 summary.
- DoD: tests green; Memory.md current.

---

## Week 3 — Core engine hardening

### Day 15 — Suggested-rewrite UX
- [ ] Copy-to-clipboard + before/after highlight of rewrite vs original.
- DoD: users can copy a rewrite; diff is legible.

### Day 16 — Configurable weighting
- [ ] Scaffold per-company juror weights (default equal); scoring reads weights.
- DoD: aggregate honors custom weights; default unchanged; tests updated.

### Day 17 — Rate limiting
- [ ] `src/lib/rate-limit.ts`: per-plan review limits enforced in `/api/reviews` (429 + reset info).
- DoD: exceeding the limit returns 429; add a test.

### Day 18 — Cost guardrails
- [ ] Enforce content size limits and a token budget; redacted logging of usage.
- DoD: oversized content rejected; no PII/secrets logged.

### Day 19 — Provider resilience
- [ ] Timeout/backoff on model calls; surface per-juror `error` cleanly to the UI.
- DoD: simulated failure degrades gracefully; review still returns.

### Day 20 — Platform-aware prompts
- [ ] SEO + Stop-Scrolling jurors adapt expectations to the selected platform.
- DoD: platform passed through; prompts reflect it.

### Day 21 — Week 3 hardening
- [ ] Tests + calibration; Memory.md; Week 3 summary.
- DoD: tests green; Memory.md current.

---

## Week 4 — Multi-tenant foundations

### Day 22 — Company onboarding
- [ ] First-admin onboarding: create/name company, set industry + plan tier.
- DoD: onboarding creates a usable company context.

### Day 23 — Team management UI
- [ ] Admin view: list team members and roles.
- DoD: admins see their company's members (tenant-safe).

### Day 24 — Invitations
- [ ] Invite-by-email token flow → join existing company (email send may be stubbed/logged).
- DoD: an invite token adds a member to the right company.

### Day 25 — Role management
- [ ] Admin can promote/demote members; enforced server-side.
- DoD: role changes persist and are authorized on the server.

### Day 26 — Brand profile CRUD
- [ ] Admin UI to create/edit the tone/style guide (`brand_profiles`).
- DoD: brand guide saves; admin-only via RLS.

### Day 27 — Brand voice in reviews
- [ ] Pass the stored brand guide as `brand_context` to Juror 1.
- DoD: reviews reference the company's brand profile.

### Day 28 — Week 4 hardening
- [ ] Tests + review; Memory.md; Week 4 summary.
- DoD: tests green; Memory.md current.

---

## Week 5 — Brand-voice caching & analytics

### Day 29 — Brand-voice cache (write)
- [ ] Compute a brand summary/embedding once per `brand_profiles` update; store `embedding_ref`.
- DoD: cache populated on brand edit; not recomputed per review.

### Day 30 — Brand-voice cache (read)
- [ ] Reviews use the cached summary instead of reprocessing the full guide.
- DoD: verified reuse; cost per review unchanged by guide size.

### Day 31 — Analytics data layer
- [ ] Query helpers: score/verdict trends over time per company + per juror.
- DoD: aggregates compute correctly; tests added.

### Day 32 — Analytics dashboard UI
- [ ] Score-trend chart on a dashboard page.
- DoD: chart renders company data.

### Day 33 — Per-juror breakdown
- [ ] Drill-down: trend per juror lens.
- DoD: per-juror trends render.

### Day 34 — Analytics states
- [ ] Empty/low-data and loading/error states for analytics.
- DoD: graceful with little/no data.

### Day 35 — Week 5 hardening
- [ ] Tests + review; Memory.md; Week 5 summary.
- DoD: tests green; Memory.md current.

---

## Week 6 — Export & reporting

### Day 36 — CSV: single review
- [ ] Export one review to CSV.
- DoD: valid CSV downloads.

### Day 37 — CSV: history
- [ ] Export filtered review history to CSV.
- DoD: filtered export matches the view.

### Day 38 — PDF: single review
- [ ] Server/client-rendered branded PDF of a review.
- DoD: valid PDF downloads.

### Day 39 — PDF polish
- [ ] Apply Design.md palette, logo, and layout to the PDF.
- DoD: report reads as enterprise-credible.

### Day 40 — Export authz
- [ ] `/api/export` tenancy + auth checks; rate-limit exports.
- DoD: only owners can export their data.

### Day 41 — Export UI
- [ ] Export buttons + download UX on review/history pages.
- DoD: one-click export from the UI.

### Day 42 — Week 6 hardening
- [ ] Tests + review; Memory.md; Week 6 summary.
- DoD: tests green; Memory.md current.

---

## Week 7 — Security & cost pass

### Day 43 — RLS audit
- [ ] Verify every tenant-table policy; add cross-tenant-isolation tests.
- DoD: no cross-company access; tests prove it.

### Day 44 — Authz audit
- [ ] Server-side authorization review across all `/api` routes.
- DoD: no route trusts client-supplied identity.

### Day 45 — Input hardening
- [ ] Validation/sanitization + size limits sweep on all inputs.
- DoD: malformed/oversized inputs rejected cleanly.

### Day 46 — Secrets review
- [ ] Confirm no service-role key or AI key reaches the client bundle; `.env.example` complete.
- DoD: secrets server-only; documented.

### Day 47 — Abuse protections
- [ ] Review rate limits + basic abuse safeguards end-to-end.
- DoD: limits enforced consistently.

### Day 48 — Observability
- [ ] Redacted structured logging + error-monitoring hooks.
- DoD: errors traceable without leaking content/secrets.

### Day 49 — Week 7 hardening
- [ ] Tests + review; Memory.md; Week 7 summary.
- DoD: tests green; Memory.md current.

---

## Week 8 — Dashboard & settings

### Day 50 — Company settings
- [ ] Company settings page (plan tier, brand link, danger zone stubs).
- DoD: settings load and save (admin).

### Day 51 — User settings
- [ ] Profile/account settings for the current user.
- DoD: profile edits persist.

### Day 52 — Dashboard home
- [ ] Landing dashboard: recent reviews, quick-submit, key metrics.
- DoD: dashboard summarizes company activity.

### Day 53 — Notifications
- [ ] Toast/notification system for actions and errors.
- DoD: consistent feedback across the app.

### Day 54 — Navigation/IA
- [ ] Clean up nav and information architecture.
- DoD: coherent navigation across all pages.

### Day 55 — Accessibility pass 1
- [ ] Keyboard nav, focus states, labels, contrast review.
- DoD: core flows keyboard-usable; issues logged/fixed.

### Day 56 — Week 8 hardening
- [ ] Tests + review; Memory.md; Week 8 summary.
- DoD: tests green; Memory.md current.

---

## Week 9 — Landing & brand

### Day 57 — Landing hero
- [ ] Hero + value proposition.
- DoD: hero communicates what AdJury does and for whom.

### Day 58 — Landing body
- [ ] Features, the 5 jurors, how-it-works sections.
- DoD: sections explain the product clearly.

### Day 59 — Landing CTA/footer
- [ ] Social proof placeholder, CTA, footer.
- DoD: complete landing page top-to-bottom.

### Day 60 — Full visual pass
- [ ] Apply Design.md tokens consistently across the app.
- DoD: consistent look; no off-palette colors.

### Day 61 — Responsive pass
- [ ] Mobile/tablet/desktop layouts.
- DoD: no horizontal overflow; usable at all widths.

### Day 62 — A11y AA verification
- [ ] Contrast + semantics to WCAG AA on core flows.
- DoD: AA checks pass on core pages.

### Day 63 — Week 9 hardening
- [ ] Tests + review; Memory.md; Week 9 summary.
- DoD: tests green; Memory.md current.

---

## Week 10 — UX polish & testing

### Day 64 — Micro-interactions
- [ ] Transitions/animations (respect `prefers-reduced-motion`).
- DoD: subtle, functional motion only.

### Day 65 — Copywriting pass
- [ ] UI text, error messages, empty states in the brand voice.
- DoD: consistent, professional copy.

### Day 66 — First-run experience
- [ ] Onboarding/first-run guidance for new users.
- DoD: a new user knows what to do first.

### Day 67 — Performance pass
- [ ] Bundle, image, and query optimizations.
- DoD: measurable improvement; no regressions.

### Day 68 — User-testing prep
- [ ] Seed demo data + test scripts for a small user test.
- DoD: a tester can run the core flow end-to-end.

### Day 69 — Friction fixes
- [ ] Fix top issues found in self/user testing.
- DoD: top friction items resolved.

### Day 70 — Week 10 hardening
- [ ] Tests + review; Memory.md; Week 10 summary.
- DoD: tests green; Memory.md current.

---

## Week 11 — Billing scaffold

### Day 71 — Stripe scaffold
- [ ] Stripe (test mode): products/prices config + customer model.
- DoD: test-mode Stripe wired; no live charges.

### Day 72 — Tier mapping
- [ ] Map subscription tiers to rate limits/features.
- DoD: plan tier drives limits.

### Day 73 — Pricing page
- [ ] Pricing page reflecting the tiers.
- DoD: pricing renders and matches config.

### Day 74 — Checkout (test)
- [ ] Test-mode checkout flow + webhook stub.
- DoD: a test subscription completes.

### Day 75 — Plan gating
- [ ] Feature flags per tier across the app.
- DoD: gated features respect the plan.

### Day 76 — Billing settings
- [ ] Manage-plan UI (test mode).
- DoD: user can view/change plan (test).

### Day 77 — Week 11 hardening
- [ ] Tests + review; Memory.md; Week 11 summary.
- DoD: tests green; Memory.md current.

---

## Week 12 — Deploy & launch prep

### Day 78 — Prod config
- [ ] Vercel + Supabase prod env wiring (secrets in dashboards, not repo).
- DoD: prod config documented and ready.

### Day 79 — Deploy
- [ ] Deploy to Vercel; smoke-test production.
- DoD: app live on a public URL; core flow works.

### Day 80 — SEO/meta
- [ ] Domain, OG/meta tags, favicon, sitemap basics.
- DoD: shareable, indexable pages.

### Day 81 — Prod monitoring
- [ ] Error monitoring + basic product analytics in prod.
- DoD: errors and key events are visible.

### Day 82 — Portfolio writeup
- [ ] Polish README + architecture summary for portfolio.
- DoD: README reflects the shipped product.

### Day 83 — Demo video
- [ ] Demo script + recording assets/instructions (2–3 min).
- DoD: a demo walkthrough exists.

### Day 84 — Launch checklist
- [ ] Final launch checklist + outreach templates for testimonials; final Memory.md.
- DoD: launch-ready; Memory.md final for v1.

---

## Week 13 — Buffer (optional, Days 85–91)

Reserved for overflow, bug-fixing, real-user feedback iteration, and any day above that slipped. Add explicit `- [ ]` day entries here if the routine reaches this point.

- [ ] Day 85 — Buffer / overflow
- [ ] Day 86 — Buffer / overflow
- [ ] Day 87 — Buffer / overflow
- [ ] Day 88 — Buffer / overflow
- [ ] Day 89 — Buffer / overflow
- [ ] Day 90 — Buffer / overflow
- [ ] Day 91 — Buffer / final polish

---

_Related: [Phases.md](Phases.md) · [Memory.md](Memory.md) · [Rules.md](Rules.md) · [Architecture.md](Architecture.md) · [Design.md](Design.md)_
