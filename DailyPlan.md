# AdJury — Day-by-Day Plan (7-day weeks × 12 weeks)

> **Status:** Active · **Last updated:** 2026-10-25 (Day 58 — Landing body: replaced the interim jury preview on the public landing page with the real body — a **Features** section (six shipped-capability cards), **the jury** (six juror cards **derived from the real `PERSONAS` roster** so the page can't drift from the actual jury — title + lens only), and a three-step **how-it-works** flow (submit → jury reviews → act on the scorecard, human in control). Content lives in `src/lib/marketing/landing.ts` (extending the Day 57 hero core), rendered by the thin server component `src/components/marketing/landing-body.tsx` on brand (each section an `aria-labelledby` region, one `<h2>`, `<h3>` card/juror titles, semantic lists, nothing colour-only). Social proof / CTA / footer is Day 59. `tests/landing.test.ts` 8→17. Typecheck clean, `npm run build` compiles, full suite 937→946.)
> _Prior:_ 2026-10-24 (Day 57 — Landing hero: replaced the Phase-1 scaffold top of the public landing page with a real, **session-aware hero + value proposition**, Week 9 begins. Copy + CTA routing live in a pure, node-tested core `src/lib/marketing/landing.ts` (`HERO` — eyebrow / Display headline *what* / value-prop subhead / audience *for whom* / three value pillars; `heroCtasFor(isAuthenticated)` — signed-out → Start a free review (/signup) + Log in; signed-in → Go to your dashboard (/dashboard) + Start a review (/review); every href a real route, exactly one primary). The thin server component `src/components/marketing/landing-hero.tsx` lays it out on brand (Navy/white, Royal-Blue accent, Display scale; one `<h1>`, real-link CTAs with the standard focus ring, pillars as a semantic list — nothing colour-only). The detailed body (features / six jurors / how-it-works) is Day 58 and the CTA/footer Day 59; a light jury preview stands in below until then. `tests/landing.test.ts` (8) pin the content + CTA invariants. Typecheck clean, `npm run build` compiles, full suite 929→937.)
> _Prior:_ 2026-10-23 (Day 56 — Week 8 hardening: the week-end integration complement for the dashboard & settings week (Days 50–55), mirroring Day 7/14/21/28/35/42/49 — **no new product surface**. A `tests/week8-dashboard-settings.test.ts` suite (20 tests) wires the REAL Week-8 cores together over shared fixtures and proves they *agree*, properties no single-day suite sees: the three write cores (company settings, user profile, notification prefs) share one authz/tenancy model (401 fail-closed, server-derived identity only — a spoofed id never reaches a write, idempotent no-ops; admin-only vs self-edit differs by exactly the role dimension); the display-name fallback is one rule shared by the profile core and the nav/account surface (save round-trips to what `displayNameOrFallback` shows; clear → email); the dashboard reuses the Day-31 analytics numbers honestly ("—"/null, never a fabricated 0); accessibility composes across the toast + nav + contrast audit (whole palette clears AA, every toast tone carries a text label + ARIA role, exactly one nav item active per route, one shared skip-link landmark); and the nav IA agrees with the real routes on disk AND the authz cores (every href has a `page.tsx`; `/settings` adminOnly ↔ 403-for-member; `/account` open-to-all ↔ cores accept a member). Typecheck clean; 909→929 tests.)
> _Prior:_ 2026-10-22 (Day 55 — Accessibility pass 1: a pure, node-tested `src/lib/ui/a11y.ts` core for the keyboard-nav + contrast work — a shared `#main-content` landmark id + a `SkipLink` island mounted in the root layout (WCAG 2.4.1 "Bypass Blocks": jump past the header/nav to content on any page, every `<main>` now carries the id), plus WCAG 2.1 contrast maths + an sRGB tint compositor + a canonical `CONTRAST_CHECKS` inventory whose `auditContrast()` is the executable "contrast review". It caught a real AA miss — full-strength `text-success`/`text-warning` on their own `/10` wash (~4.1–4.4:1) — fixed by deepening that chip/badge/notice text to `text-success-deep` (#166534, new token) / `text-warning-deep` across all seven sites; focus rings + labels were already consistent and are now guarded. 888→909 tests.)
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

### Day 10 — Verdict/score visual system ✅
- [x] Score→color mapping, verdict pills, and issue-severity styling — always paired with text labels (never color-only, a11y). **Completed 2026-09-06.**
- DoD: matches Design.md §5; labels present for screen readers.

### Day 11 — Review history ✅
- [x] `/history`: list past reviews (date, aggregate, verdict) linking to detail; company-scoped. **Completed 2026-09-07.**
- DoD: history loads and is tenant-safe.

### Day 12 — Review detail page ✅
- [x] `/review/[id]`: render a persisted review from stored `reviews` + `persona_scores`. **Completed 2026-09-08.**
- DoD: detail page reconstructs the full scorecard from the DB.

### Day 13 — States & resilience ✅
- [x] Loading / error / empty states across submit, scorecard, history; graceful single-juror `error` rendering. **Completed 2026-09-09.**
- DoD: no unhandled states; matches Rules.md §6.

### Day 14 — Week 2 hardening ✅
- [x] UI-logic tests; accessibility spot-check; refresh Memory.md; Week 2 summary. **Completed 2026-09-10.**
- DoD: tests green; Memory.md current.

---

## Week 3 — Core engine hardening

### Day 15 — Suggested-rewrite UX ✅
- [x] Copy-to-clipboard + before/after highlight of rewrite vs original. **Completed 2026-09-11.**
- DoD: users can copy a rewrite; diff is legible.

### Day 15a — Multi-format input: image ads ✅ (merged goal)
> Merged into the plan at its original-goal position (core engine, Week 3) and implemented ahead of the current day, per the "reach the widest set of advertisers" goal. Text + image ship now; short- and long-form **video** are a later phase (see Week 13+ / PRD §6.3).
- [x] Review image ads as well as text: `media_type` (text|image) + optional image on the review contract; the creative is sent to each juror as a vision input (Claude multimodal); image size guard; `reviews.media_type` column; submission-form format toggle + image upload. **Completed 2026-10-12.**
- DoD: an image ad runs through all jurors and returns a valid review; text ads unchanged.

### Day 16 — Configurable weighting ✅
- [x] Scaffold per-company juror weights (default equal); scoring reads weights. **Completed 2026-09-12.**
- DoD: aggregate honors custom weights; default unchanged; tests updated.

### Day 17 — Rate limiting ✅
- [x] `src/lib/rate-limit.ts`: per-plan review limits enforced in `/api/reviews` (429 + reset info). **Completed 2026-09-13.**
- DoD: exceeding the limit returns 429; add a test.

### Day 18 — Cost guardrails ✅
- [x] Enforce content size limits and a token budget; redacted logging of usage. **Completed 2026-09-14.**
- DoD: oversized content rejected; no PII/secrets logged.

### Day 19 — Provider resilience ✅
- [x] Timeout/backoff on model calls; surface per-juror `error` cleanly to the UI. **Completed 2026-09-15.**
- DoD: simulated failure degrades gracefully; review still returns.

### Day 20 — Platform-aware prompts ✅
- [x] SEO + Stop-Scrolling jurors adapt expectations to the selected platform. **Completed 2026-09-16.**
- DoD: platform passed through; prompts reflect it.

### Day 21 — Week 3 hardening ✅
- [x] Tests + calibration; Memory.md; Week 3 summary. **Completed 2026-09-17.**
- DoD: tests green; Memory.md current.

---

## Week 4 — Multi-tenant foundations

### Day 22 — Company onboarding ✅
- [x] First-admin onboarding: create/name company, set industry + plan tier. **Completed 2026-09-18.**
- DoD: onboarding creates a usable company context.

### Day 23 — Team management UI ✅
- [x] Admin view: list team members and roles. **Completed 2026-09-19.**
- DoD: admins see their company's members (tenant-safe).

### Day 23a — Business context research ✅ (merged goal)
> Merged at its original-goal position (business/brand context, Week 4) and implemented ahead of the current day. Grounds reviews in the posting company so jurors know which business/field the ad is for (PRD §4/§5).
- [x] Capture the company's website at onboarding; research the business from public sources; condense to a bounded, cached `business_summary` + `business_context_ref` on the company row (mirrors the brand-voice cache — compute once, reuse per review); inject the context into every juror. Offline-deterministic researcher today; live web-search enrichment is a documented credential-gated seam. **Completed 2026-10-12.**
- DoD: reviews are grounded in the company's field/market; cost per review is independent of the site's size.

### Day 23b — Business Analyst juror ✅ (merged goal)
> Merged at its original-goal position (the persona set, extended) and implemented ahead of the current day. A sixth "insider" juror, per the request for a secondary in-house opinion.
- [x] Add a sixth juror — a Business Analyst briefed on the spot to stand in for the posting company, judging business/market fit. Grounded ONLY in the researched business context; forbidden from inventing company facts. Wires `PERSONA_NAMES`, scoring default weight, weights schema, the `persona_scores` CHECK constraint, and the UI label. **Completed 2026-10-12.**
- DoD: a `business_analyst` score appears in every review and counts in the aggregate; tests prove grounding + participation.

### Day 24 — Invitations ✅
- [x] Invite-by-email token flow → join existing company (email send may be stubbed/logged). **Completed 2026-09-20.**
- DoD: an invite token adds a member to the right company.

### Day 25 — Role management ✅
- [x] Admin can promote/demote members; enforced server-side. **Completed 2026-09-21.**
- DoD: role changes persist and are authorized on the server.

### Day 26 — Brand profile CRUD ✅
- [x] Admin UI to create/edit the tone/style guide (`brand_profiles`). **Completed 2026-09-22.**
- DoD: brand guide saves; admin-only via RLS.

### Day 27 — Brand voice in reviews ✅
- [x] Pass the stored brand guide as `brand_context` to Juror 1. **Completed 2026-09-23.**
- DoD: reviews reference the company's brand profile.

### Day 28 — Week 4 hardening ✅
- [x] Tests + review; Memory.md; Week 4 summary. **Completed 2026-09-24.**
- DoD: tests green; Memory.md current.

---

## Week 5 — Brand-voice caching & analytics

### Day 29 — Brand-voice cache (write) ✅
- [x] Compute a brand summary/embedding once per `brand_profiles` update; store `embedding_ref`. **Completed 2026-09-26.**
- DoD: cache populated on brand edit; not recomputed per review.

### Day 30 — Brand-voice cache (read) ✅
- [x] Reviews use the cached summary instead of reprocessing the full guide. **Completed 2026-09-27.**
- DoD: verified reuse; cost per review unchanged by guide size.

### Day 31 — Analytics data layer ✅
- [x] Query helpers: score/verdict trends over time per company + per juror. **Completed 2026-09-28.**
- DoD: aggregates compute correctly; tests added.

### Day 32 — Analytics dashboard UI ✅
- [x] Score-trend chart on a dashboard page. **Completed 2026-09-29.**
- DoD: chart renders company data.

### Day 33 — Per-juror breakdown ✅
- [x] Drill-down: trend per juror lens. **Completed 2026-09-30.**
- DoD: per-juror trends render.

### Day 34 — Analytics states ✅
- [x] Empty/low-data and loading/error states for analytics. **Completed 2026-10-01.**
- DoD: graceful with little/no data.

### Day 35 — Week 5 hardening ✅
- [x] Tests + review; Memory.md; Week 5 summary. **Completed 2026-10-02.**
- DoD: tests green; Memory.md current.

---

## Week 6 — Export & reporting

### Day 36 — CSV: single review ✅
- [x] Export one review to CSV. **Completed 2026-10-03.**
- DoD: valid CSV downloads.

### Day 37 — CSV: history ✅
- [x] Export filtered review history to CSV. **Completed 2026-10-04.**
- DoD: filtered export matches the view.

### Day 38 — PDF: single review ✅
- [x] Server/client-rendered branded PDF of a review. **Completed 2026-10-05.**
- DoD: valid PDF downloads.

### Day 39 — PDF polish ✅
- [x] Apply Design.md palette, logo, and layout to the PDF. **Completed 2026-10-06.**
- DoD: report reads as enterprise-credible.

### Day 40 — Export authz ✅
- [x] `/api/export` tenancy + auth checks; rate-limit exports. **Completed 2026-10-07.**
- DoD: only owners can export their data.

### Day 41 — Export UI ✅
- [x] Export buttons + download UX on review/history pages. **Completed 2026-10-08.**
- DoD: one-click export from the UI.

### Day 42 — Week 6 hardening ✅
- [x] Tests + review; Memory.md; Week 6 summary. **Completed 2026-10-09.**
- DoD: tests green; Memory.md current.

---

## Week 7 — Security & cost pass

### Day 43 — RLS audit ✅
- [x] Verify every tenant-table policy; add cross-tenant-isolation tests. **Completed 2026-10-10.**
- DoD: no cross-company access; tests prove it.

### Day 44 — Authz audit ✅
- [x] Server-side authorization review across all `/api` routes. **Completed 2026-10-11.**
- DoD: no route trusts client-supplied identity.

### Day 45 — Input hardening ✅
- [x] Validation/sanitization + size limits sweep on all inputs. **Completed 2026-10-12.**
- DoD: malformed/oversized inputs rejected cleanly.

### Day 46 — Secrets review ✅
- [x] Confirm no service-role key or AI key reaches the client bundle; `.env.example` complete. **Completed 2026-10-13.**
- DoD: secrets server-only; documented.

### Day 47 — Abuse protections ✅
- [x] Review rate limits + basic abuse safeguards end-to-end. **Completed 2026-10-14.**
- DoD: limits enforced consistently.

### Day 48 — Observability ✅
- [x] Redacted structured logging + error-monitoring hooks. **Completed 2026-10-15.**
- DoD: errors traceable without leaking content/secrets.

### Day 49 — Week 7 hardening ✅
- [x] Tests + review; Memory.md; Week 7 summary. **Completed 2026-10-16.**
- DoD: tests green; Memory.md current.

---

## Week 8 — Dashboard & settings

### Day 50 — Company settings ✅
- [x] Company settings page (plan tier, brand link, danger zone stubs). **Completed 2026-10-17.**
- DoD: settings load and save (admin).

### Day 51 — User settings ✅
- [x] Profile/account settings for the current user. **Completed 2026-10-19.**
- DoD: profile edits persist.
> Shipped in two PRs on the same day: **Part 1 (basic)** — an `/account` page any signed-in user reaches, with an editable **display name** that saves and persists. **Part 2 (full)** — adds **notification preferences** (review-complete / weekly-digest / product-news opt-ins, persisted) and the **password / email changes** (wired to Supabase Auth, validated at the boundary; the live Auth effect needs a real project — see the Part 2 PR's "Blocked / needs credentials"). Email/role/company remain read-only; role is managed by an admin on `/team`.

### Day 52 — Dashboard home ✅
- [x] Landing dashboard: recent reviews, quick-submit, key metrics. **Completed 2026-10-19.**
- DoD: dashboard summarizes company activity.
> Replaced the Day 4 placeholder dashboard with a real landing surface: three key-metric tiles (reviews run, average score, pass rate), a prominent quick-submit, the most recent reviews (reusing the Day 11 `HistoryList`), and shortcuts into the rest of the app plus admin-only management. Metrics come from the Day 31 `getCompanyAnalytics` core and recent reviews from the Day 6 `listReviewsForCompany` core — both tenant-safe (session-derived company, RLS-guarded) with per-read plain-language error states. Key-metric logic lives in a pure, node-tested `dashboard-view.ts` (honest empty states: "—" and a null pass rate rather than a fabricated zero). Added a `loading.tsx` skeleton. 841→850 tests.

### Day 53 — Notifications ✅
- [x] Toast/notification system for actions and errors. **Completed 2026-10-20.**
- DoD: consistent feedback across the app.
> Added an app-wide toast/notification layer. Logic lives in a pure, node-tested `src/lib/ui/toast.ts` (tone→label/ARIA-role/live-region mapping, per-tone auto-dismiss windows, identical-toast dedupe, and a 4-toast visible cap that drops the oldest); the thin client island (`src/components/ui/toast.tsx`: `ToastProvider` + `useToast()` + the bottom-anchored viewport) is mounted once in the **root layout** so every surface can raise feedback. Tones carry a **text badge** (never colour-only, Design.md §6), errors announce assertively (`role="alert"`) and confirmations politely (`role="status"`), hover/focus pauses auto-dismiss, and the enter motion is gated on `prefers-reduced-motion`. Wired the client-action surfaces through it: the review submit (success verdict + failure), copy-rewrite, replacing their bespoke transient feedback; inline field/form validation stays where it belongs. 850→868 tests.

### Day 54 — Navigation/IA ✅
- [x] Clean up nav and information architecture. **Completed 2026-10-21.**
- DoD: coherent navigation across all pages.
> Reworked the dashboard shell's primary nav into a coherent, active-aware information architecture. A new **pure, node-tested** `src/lib/ui/nav.ts` owns the structure + routing logic — a canonical `NAV_ITEMS` inventory grouped into three sections (**Workspace**: Dashboard / New review / History / Analytics; **Manage**: admin-only Brand / Team / Settings; **Account**), `navItemsForRole`/`navGroupsForRole` (members never see admin links; the empty Manage group is dropped so there's no stray divider), and an `isNavItemActive` matcher so every page shows *where you are*: it lights the exact page, maps a saved-review detail route (`/review/<id>`) to its conceptual parent **History** (never the sibling "New review" form, which stays exact-match), ignores query/hash + trailing slashes, and never false-matches a shared-name-prefix sibling — proven to light **exactly one** item per shell path. The thin `src/components/ui/primary-nav.tsx` client island reads `usePathname()` and renders, marking the active item with `aria-current="page"` **and** a non-colour cue (bold + filled background, Design.md §6) and visually separating the groups; the link row `flex-wrap`s so it stays usable at narrow widths. The server `(dashboard)/layout.tsx` now mounts the island (staying a server component, keeping its auth + onboarding gate). `tests/nav.test.ts` (20) pin inventory integrity, role filtering, grouping/order, path normalisation, and the exactly-one-active-per-path invariant across every shell route. 868→888 tests.

### Day 55 — Accessibility pass 1 ✅
- [x] Keyboard nav, focus states, labels, contrast review. **Completed 2026-10-22.**
- DoD: core flows keyboard-usable; issues logged/fixed.
> First accessibility pass across the shell. **Keyboard nav (WCAG 2.4.1 "Bypass Blocks"):** a new pure core `src/lib/ui/a11y.ts` owns the shared `MAIN_CONTENT_ID`/`SKIP_LINK_LABEL`/`mainContentHref()`, a `SkipLink` island (`src/components/ui/skip-link.tsx`) is mounted once in the **root layout** as the first focusable element (hidden via `sr-only` until focused, then a pinned surface with the app's standard focus ring), and every page's `<main>` (landing, auth, dashboard shell, onboarding, invite) now carries `id={MAIN_CONTENT_ID}` so a keyboard user can bypass the header/primary nav straight to content on any page. **Contrast review (Design.md §6):** the same core adds WCAG 2.1 contrast maths + an sRGB alpha compositor (so a tinted `bg-x/10` wash is scored against the real pixels) and a canonical `CONTRAST_CHECKS` inventory of every text/UI pairing; `auditContrast()` is the executable review. It surfaced a **real, systematic AA miss** — full-strength `text-success` (#15803D) / `text-warning` (#B45309) on their own `/10` wash only reach ~4.1–4.4:1, below the 4.5:1 floor for the small tier-label/severity/badge text they carry — fixed by deepening that text to `text-success-deep` (new token **#166534**) / `text-warning-deep` (#9A3412, already defined) across all seven sites (`tone-classes.ts` chip+badge, `toast-classes.ts`, `rewrite-panel.tsx`, `scorecard.tsx` notice, `invitation-list.tsx`, `brand/page.tsx`, `invite/page.tsx`); tint backgrounds (and the tier's colour identity) are unchanged and the solid white-on-fill pills already passed. **Focus states / labels** were already applied consistently (a `focus-visible:ring-royal-bright` ring on every interactive element; icon buttons like the toast dismiss already labelled) — confirmed and now guarded. `tests/a11y.test.ts` (21) pin the contrast primitives (black/white = 21:1, compositing, the 4.5/3 thresholds), prove the whole palette passes AA, prove the fix *matters* (old colours fail, deep colours pass), reconcile `PALETTE` against the committed `tailwind.config.ts`/`globals.css` tokens, and verify the skip-link contract + that every `<main>` carries the shared id by reading the real source. No new deps, no live-credential needs; typecheck clean, `npm run build` compiles, full suite **888→909** (+21).

### Day 56 — Week 8 hardening ✅
- [x] Tests + review; Memory.md; Week 8 summary. **Completed 2026-10-23.**
- DoD: tests green; Memory.md current.
> Week 8 (dashboard & settings) week-end hardening, mirroring the Day 7/14/21/28/35/42/49 pattern: **no new product surface — a `tests/week8-dashboard-settings.test.ts` integration suite (20 tests) that wires the REAL Week-8 cores together and proves the week's invariants compose**, plus this doc refresh + the Week 8 summary. The per-day suites each prove one surface in isolation; this proves they **agree**. (1) The three Week-8 write cores (Day 50 company settings, Day 51 user profile + notification prefs) share **one authz/tenancy model** — all fail closed on no session (401, no write), all scope every write to the server-derived identity (a spoofed `company_id`/`user_id` in the input never reaches the DB), all no-op idempotently; the admin-only company-settings surface (403 for a member) and the two self-edits differ in exactly the role dimension, proven deliberate. (2) The **display-name fallback is one rule** shared by the profile core and the nav/account surface: a name saved through `updateUserProfile` round-trips to exactly what `displayNameOrFallback` renders, and `normalizeDisplayName` + the no-op check + the fallback agree on one canonical form (clearing → email). (3) The **dashboard reuses the Day-31 analytics numbers** — its pass-rate tile equals `passRate(dist)`, its reviews tile equals `totalReviews`, and with no data every tile stays honest ("—"/null, never a fabricated 0). (4) **Accessibility composes** across the Day-53 toast + Day-54 nav + Day-55 contrast: the whole palette (incl. the deep tokens the toast/chips use) clears AA together, every toast tone carries a text label + ARIA role (never colour-only), exactly one nav item is active per shell route (so `aria-current` lands on one), and the skip-link landmark is one shared constant. (5) The **nav IA agrees with the real routes on disk AND the authz cores** — every nav href has a `page.tsx` under `src/app/(dashboard)`, `/settings` being `adminOnly` matches its write core's 403-for-member, and `/account` open-to-all matches its cores accepting a member. All offline (no live model/DB/bundler); typecheck clean, full suite **909→929** (+20).

---

## Week 9 — Landing & brand

### Day 57 — Landing hero ✅
- [x] Hero + value proposition. **Completed 2026-10-24.**
- DoD: hero communicates what AdJury does and for whom.
> Replaced the Phase-1 scaffold top of the public landing page (`src/app/page.tsx`) with a real, **session-aware hero + value proposition**. All copy and the CTA routing live in a pure, node-tested core `src/lib/marketing/landing.ts` (the established "pure core + thin component" pattern, cf. `lib/ui/nav.ts`): `HERO` owns the eyebrow / Display-size headline (*what* — six jurors review your marketing before you publish) / value-prop subhead (scores, flagged risks, ready-to-use rewrites, grounded in your brand + business) / audience line (*for whom* — marketing directors and the copywriters, social, and compliance reviewers with them) / three value pillars; `heroCtasFor(isAuthenticated)` resolves the buttons — a signed-out visitor gets **Start a free review** (/signup, primary) + **Log in** (/login), a signed-in user gets **Go to your dashboard** (/dashboard) + **Start a review** (/review) — every href an existing route so nothing dangles ahead of Day 58/59, and exactly one primary per state. The thin server component `src/components/marketing/landing-hero.tsx` only lays this out on brand (Design.md: Navy/white, Royal-Blue accent, Display scale, borders over shadows; one `<h1>`, real-link CTAs with the standard focus ring, pillars as a semantic list — nothing colour-only). The detailed body (features / the six jurors / how-it-works) stays **Day 58** and the social-proof/CTA/footer **Day 59**; a light jury preview stands in below the hero until then. `tests/landing.test.ts` (8) pin the content invariants (what + for whom, not a content generator, 3 pillars) and the CTA logic (correct primary/secondary + hrefs per auth state, no dangling routes). Typecheck clean, `npm run build` compiles, full suite **929→937** (+8).

### Day 58 — Landing body ✅
- [x] Features, the 5 jurors, how-it-works sections. **Completed 2026-10-25.**
- DoD: sections explain the product clearly.
> Replaced the interim jury preview in `src/app/page.tsx` with the real landing body — three sections built on the established "pure core + thin server component" pattern. All copy/structure lives in `src/lib/marketing/landing.ts` (extending the Day 57 hero core): a **Features** section (`FEATURES_INTRO` + six `FEATURES` cards — six-juror pass, business grounding, rewrites-not-red-ink, text+image ads, compliance risk-flagging, history/trends — every one a shipped behaviour, framed as a benefit, never positioning AdJury as a content generator); **the jury** (`JURY_INTRO` + `jurySummaries()`, which **derives the roster from the real `PERSONAS` array** so the landing page can never drift from the jury that actually reviews content — title + lens only, no prompt text; the plan said "5 jurors" but the shipped jury is six since Day 23b, so all six are shown, matching the hero); and **how-it-works** (`HOW_IT_WORKS_INTRO` + three ordered `HOW_IT_WORKS` steps: submit → jury reviews in parallel → act on the scorecard, human stays in control). The thin server component `src/components/marketing/landing-body.tsx` lays it out on brand (Design.md: Navy/white, Royal-Blue accent, borders over shadows; each section an `aria-labelledby` region with one `<h2>`, card titles/juror names as `<h3>`, semantic `<ul>`/`<ol>` lists, decorative `aria-hidden` step numbers — nothing colour-only). Social proof / CTA / footer stays **Day 59**. `tests/landing.test.ts` grew 8→17 (section-intro integrity, feature copy + QA-layer-not-generator guard, the jury-matches-`PERSONAS` no-drift proof + prompt-text-not-leaked check, ordered-steps + submit→decide copy). Typecheck clean, `npm run build` compiles (`/` builds), full suite **937→946** (+9).

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

> **Monetization target (to finalise here):** entry plan **AUD $20/month**, with a public free trial and **cancel anytime**. Trial shape is still being decided — either a general **3-month** promo trial (easy to advertise) or a **1-month** trial limited to **one account per business, one-time only**. Build the trial as a Stripe trial period so the choice is a config value, and keep the per-plan rate limits on the trial tier so a long free window can't run up model cost.

### Day 71 — Stripe scaffold
- [ ] Stripe (test mode): products/prices config + customer model. Model the AUD $20/mo price + a configurable trial period (see the monetization note above).
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

> **Production data & hosting (monetization-grade):** this is a paid product, so stand up a **secure managed Postgres (Supabase prod)** with RLS verified against the real DB (apply all migrations incl. 0006 RLS fix), and an **object-storage bucket** (Supabase Storage, tenant-scoped) for uploaded **image/video creatives** — image ads currently pass the creative inline per request; durable storage is the production upgrade. Deploy progression: **Vercel (test) → custom domain → prod**. Secrets live only in the Vercel/Supabase dashboards (Rules.md §4).

### Day 78 — Prod config
- [ ] Vercel + Supabase prod env wiring (secrets in dashboards, not repo). Provision the prod Postgres + a media-storage bucket (see the note above); apply all migrations.
- DoD: prod config documented and ready; RLS verified against the live DB.

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

### Merged-in future goals (post-v1 formats & modes)
> Captured from product direction and slotted here because their original-goal position is **after** the current build point. Promote to numbered days when the routine reaches them.
- [ ] **Short-form video ads** — a media pipeline: transcribe audio + sample keyframes (as images) + read on-image text, then run the existing jurors. Extends `media_type` to `video_short`.
- [ ] **Long-form video ads** — the same pipeline at scale; needs a cost/latency strategy (sampling, chunking) because it breaks the <$0.01/review and <15s targets if done naively. Extends `media_type` to `video_long`.
- [ ] **Draft Assistant (ad generation)** — an optional, clearly-separate mode that drafts ad copy on request, distinct from the jury so AdJury never grades its own output (PRD §3/§6.3). The "improve my ad" rewrite path already ships via each juror's `suggested_rewrite`; this is net-new *generation*, a deliberate addition, not a pivot away from the QA-layer identity.
- [ ] **Live business research** — swap the offline business-context researcher for a web-search-backed one (Claude web_search over the company's site), behind the existing `BusinessResearcher` seam. Needs a live model key + outbound network.

- [ ] Day 85 — Buffer / overflow
- [ ] Day 86 — Buffer / overflow
- [ ] Day 87 — Buffer / overflow
- [ ] Day 88 — Buffer / overflow
- [ ] Day 89 — Buffer / overflow
- [ ] Day 90 — Buffer / overflow
- [ ] Day 91 — Buffer / final polish

---

_Related: [Phases.md](Phases.md) · [Memory.md](Memory.md) · [Rules.md](Rules.md) · [Architecture.md](Architecture.md) · [Design.md](Design.md)_
