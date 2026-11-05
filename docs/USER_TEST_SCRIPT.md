# AdJury — User Test Script

> **Purpose:** a short, repeatable script so a tester can run AdJury's **core flow
> end-to-end** and report friction (DailyPlan Day 68 — user-testing prep; Day 69
> acts on what this surfaces). Pairs with the seed dataset in
> `src/lib/demo/seed-data.ts` and the `npm run seed:demo` script.

---

## 0. Set up (facilitator, ~10 min)

You need a dev Supabase project (hosted dev or local `supabase start`) because the
core flow is auth- + DB-backed.

1. Create the project and apply every migration in `supabase/migrations/` in order
   (`0001_init.sql` … latest).
2. Copy `.env.example` → `.env.local` and fill in the Supabase keys. Leave
   `AI_API_KEY` unset to run reviews on the **offline mock** (deterministic, free,
   no key) — that is enough for a UX test. Set a real key only if you want live
   model output.
3. Seed the demo tenant:
   ```bash
   node --env-file=.env.local --import tsx scripts/seed-demo.ts
   # or: npm run seed:demo   (if your Node loads .env.local itself)
   ```
   The script prints a throwaway password for each demo user — **copy them now**,
   they are shown once and never stored. Re-seeding is guarded; to start clean use
   `SEED_RESET=1 … scripts/seed-demo.ts`.
4. Start the app: `npm run dev`, then open http://localhost:3000.

### Demo accounts (passwords printed by the seed script)

| Role   | Email                       | Sees                                  |
|--------|-----------------------------|---------------------------------------|
| Admin  | `demo-admin@adjury.example`  | Everything, incl. Brand / Team / Settings |
| Member | `demo-member@adjury.example` | Workspace only (no admin management)  |

The seed also creates the **Northwind Labs** company, its brand guide, and six
reviews spanning **pass / revise / fail** so the scorecard range is visible from
the first login.

> **No live model needed.** Every step below works in offline-mock mode. Reviews
> created during the test are mock output; that is expected and fine for UX testing.

---

## 1. Tester tasks (core flow)

Give the tester the **member** account first, then the **admin** account for the
admin-only tasks. Ask them to think aloud and note anything confusing. Don't coach.

### A. Sign in & orient
1. Log in at `/login` with the member account.
2. **Expected:** you land on the dashboard with recent reviews and key metrics
   (reviews run, average score, pass rate) already populated.
   _Note: is it clear what AdJury does and what to do next?_

### B. Submit a review (the heart of the product)
3. Go to **New review**. Paste a short ad, e.g.
   _"Introducing our new planner — guaranteed to double your output overnight!"_
4. Choose a content type and platform, then submit.
5. **Expected:** a scorecard appears with an aggregate score + verdict pill and six
   juror cards (score, summary, issues, suggested rewrite). The compliance juror
   should flag the absolute claim.
   _Note: are the scores and the verdict understandable at a glance? Is the
   suggested rewrite useful?_

### C. Use a suggested rewrite
6. On any juror card, copy a suggested rewrite.
7. **Expected:** a clear copy confirmation; the before/after is legible.

### D. History & detail
8. Open **History**. Confirm your new review and the seeded ones are listed.
9. Click into one review.
10. **Expected:** the full scorecard reconstructs from storage (same scores,
    issues, rewrites). Try a seeded **pass**, a **revise**, and the **fail**.

### E. Export
11. From a review (or History), export to **CSV** and to **PDF**.
12. **Expected:** both download; the PDF is on-brand and readable; the CSV opens
    cleanly in a spreadsheet.

### F. Analytics
13. Open **Analytics**.
14. **Expected:** a score-trend chart and per-juror breakdown render from the
    seeded reviews, with an accessible data-table fallback.

### G. Admin-only (switch to the admin account)
15. Log out, log in as the admin. Confirm **Brand**, **Team**, and **Settings**
    now appear in the nav (they should NOT have appeared for the member).
16. **Brand:** open the brand guide, make a small edit, save.
    **Expected:** it saves and persists on reload.
17. **Team:** view the roster (admin + member).
18. **Settings:** confirm plan tier / company settings load and save.

### H. Accessibility spot-check (optional, any account)
19. Navigate the submit → scorecard flow using only the keyboard (Tab / Enter).
20. **Expected:** a visible focus ring on every control, a working "skip to
    content" link, and no verdict conveyed by colour alone (always a text label).

---

## 2. Facilitator capture sheet

For each task, record: **completed unaided / needed a hint / blocked**, plus any
quote. Roll friction up into these buckets for Day 69:

- [ ] **Comprehension** — did they understand the verdict/scores without help?
- [ ] **Submit flow** — any hesitation choosing type/platform or reading the result?
- [ ] **Rewrites** — did they find the suggested rewrite and see its value?
- [ ] **Navigation** — could they move between submit / history / analytics / admin?
- [ ] **Export** — did CSV/PDF meet expectations?
- [ ] **Trust** — did the app read as enterprise-credible (Design.md §1)?
- [ ] **Accessibility** — keyboard + non-colour-only verdicts held up?

Top friction items feed **Day 69 — Friction fixes**.

---

## 3. Quick smoke (no DB, ~30 s)

To sanity-check the review engine without a database, run the offline demo — it
sends sample copy through all six jurors and prints the structured result:

```bash
npm run demo
```

_Related: [DailyPlan.md](../DailyPlan.md) · [Design.md](../Design.md) · [Rules.md](../Rules.md) · `src/lib/demo/seed-data.ts` · `scripts/seed-demo.ts`_
