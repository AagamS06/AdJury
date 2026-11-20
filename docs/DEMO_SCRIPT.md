# AdJury — Demo Video Script & Recording Guide

> **Purpose:** a tight, repeatable **2–3 minute** product demo — the shot list,
> the voice-over, and the setup needed to record it (DailyPlan Day 83 — demo
> video; DoD: a demo walkthrough exists).
>
> This document is the human-readable face of the single source of truth in
> `src/lib/marketing/demo-script.ts`. The scenes, their timings, and the
> recording setup are defined there and checked by `npm run demo:check`, so this
> script can't drift from the product: every scene points at a route that really
> exists, the runtime stays inside 2–3 minutes, the walkthrough covers the whole
> authenticated core flow, and the narration states the real jury size.

---

## Target

- **Runtime:** 2:40 (160s) — inside the 2–3 minute window.
- **Mode:** offline mock (no live model key), seeded demo tenant.
- **Audience:** a marketing director / hiring reviewer seeing AdJury for the
  first time. Voice is confident and concise — no hype, no emoji (Design.md §7).

Run `npm run demo:check` for the timed scene plan and the readiness report.

---

## Shot list & narration

| Time | Scene | On screen (route) | Narration |
|------|-------|-------------------|-----------|
| 0:00–0:18 | Open on the landing page | `/` | "This is AdJury — a review layer for marketing content. Before you publish an ad, six AI juror personas each score it from a different angle: brand voice, compliance, audience fit, SEO, scroll-stopping hook, and an insider business read. It critiques and rewrites; it never publishes for you." |
| 0:18–0:28 | Log in with the demo account | `/login` | "I'll log in with a seeded demo account. Everything you'll see runs on the deterministic offline mock — no live model key needed to follow along." |
| 0:28–0:50 | Submit an ad for review | `/review` | "On the New review screen I paste an ad, pick a content type and target platform, and submit. The same copy fans out to all six jurors in one request against one cost-efficient model — six prompts, not six providers." |
| 0:50–1:20 | Read the scorecard *(the heart of the demo)* | `/review` | "Here's the scorecard: an aggregate score and a plain verdict up top, then one card per juror with a score, a one-line summary, the specific issues it flagged, and a suggested rewrite. Notice the compliance juror has flagged an unsubstantiated claim — and a high-severity compliance flag vetoes the verdict to fail, no matter the average." |
| 1:20–1:35 | Open review history | `/history` | "Every review is saved per company. History lists them with date, score and verdict, and it's filterable — all scoped to your own tenant." |
| 1:35–1:50 | Reopen a past review | `/review/[id]` | "Opening a past review reconstructs the full scorecard from storage — same scores, same issues, same rewrites. I'll open a seeded pass, a revise and a fail so you can see the whole range." |
| 1:50–2:05 | Export the review | `/api/reviews/[id]/export` | "A review exports to CSV for a spreadsheet, or to an on-brand PDF a marketing director can forward to justify a decision." |
| 2:05–2:23 | Show the analytics dashboard | `/analytics` | "The analytics dashboard trends scores over time and breaks them down per juror lens, so a team can see whether their content is getting better — with an accessible data-table fallback behind every chart." |
| 2:23–2:40 | Close on pricing & the pitch | `/pricing` | "Multi-tenant and role-aware from day one, grounded in each company's own business context, under a cent a review. AdJury de-risks what marketing teams publish — and keeps the human in control." |

The seven middle scenes (log in → submit → scorecard → history → detail →
export → analytics) are the product's authenticated **core flow**, tied 1:1 to
the deploy smoke's `CORE_FLOW_STEPS` so the demo always shows exactly the flow
the product has.

---

## Recording setup

1. **Seed a dev tenant.** Point `.env.local` at a dev Supabase project, apply the
   migrations, then `npm run seed:demo` to create the Northwind Labs tenant, its
   admin + member accounts, a brand guide, and six reviews spanning pass / revise
   / fail (see [USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md) §0). Copy the printed
   passwords.
2. **Run on the offline mock.** Leave `AI_API_KEY` unset so reviews run on the
   deterministic offline mock — no credential, reproducible output, every take
   identical. Sanity-check engine output first with `npm run demo` (no DB needed).
3. **Start the app.** `npm run dev`, then record http://localhost:3000 in a clean
   browser profile (no extensions, no bookmarks bar).
4. **Capture settings.** 1920×1080, 30fps, cursor highlight on. Use a 1280px
   content width so text stays legible when the video is embedded small. Hide
   notifications.
5. **Use the compliance-fail scenario for the scorecard beat.** Submit (or open)
   the seeded Instagram ad with unsubstantiated medical claims — it reliably
   produces a high-severity compliance flag and a fail verdict, the most
   persuasive single shot in the demo.
6. **Drive it accessibly on camera.** Navigate submit → scorecard with the
   keyboard at least once to show the focus ring, the skip-to-content link, and
   that no verdict is colour-only (Design.md §6).

---

## Produce

Edit to the timings above, export a 2–3 minute file, and attach it to the
portfolio / README. Keep the scorecard scene the longest beat — it is the single
clearest demonstration of what AdJury does.

---

## Blocked / needs credentials

The **script, shot list, and setup instructions exist and are verified** here
(`npm run demo:check` passes offline). The **recording itself** needs a person
and a dev tenant this cloud build has none of:

- a dev Supabase project + `npm run seed:demo` to seed the tenant to record
  against (no DB in the cloud build);
- a human to screen-capture the walkthrough following this script;
- producing and attaching the final video file (a binary artifact that doesn't
  belong in the repo).

These are reported as `manual` readiness items by `npm run demo:check`.

---

_Related: [DailyPlan.md](../DailyPlan.md) · [USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md) · [Design.md](../Design.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · `src/lib/marketing/demo-script.ts`_
