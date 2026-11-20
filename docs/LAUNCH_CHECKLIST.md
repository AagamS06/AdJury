# AdJury — Launch Checklist & Testimonial Outreach

> **Purpose:** the final launch checklist for AdJury v1 and the testimonial
> outreach templates to send once it's live (DailyPlan Day 84 — launch checklist;
> DoD: launch-ready; Memory.md final for v1).
>
> This document is the human-readable face of the single source of truth in
> `src/lib/marketing/launch-checklist.ts`. The launch gates and the outreach
> templates are defined there and checked by `npm run launch:check`, so this
> checklist can't drift from the product: "launch-ready" is exactly the
> conjunction of the five Week-12 gates (each owning its own definition of done),
> and the outreach copy is proven well-formed and on-brand (known merge fields
> only, the product named correctly, the real jury size).

---

## How to read this

"Launch-ready" has two halves, the same honest split every Week-12 day draws:

- **Offline-provable (done here).** Each Week-12 gate has an offline half the
  repo proves with no credential — the migration set is apply-ready, the smoke
  plan is derived from the real routes, SEO is sound, the key-event catalog
  agrees with the source, the demo walkthrough exists. `npm run launch:check`
  rolls all five up and is green.
- **The live launch (needs a deploy / a person).** Promoting to prod, walking
  the core flow against the live URL, collecting testimonials, and announcing —
  reported as `manual` items, never auto-marked done.

Run `npm run launch:check` for the rolled-up gates + the readiness report.

---

## Launch gates (all five must be offline-ready before the live launch)

| Gate | Day | Offline half (proven here) | Live step(s) | Runbook |
|------|-----|----------------------------|--------------|---------|
| Production config & data | 78 | Migrations apply-ready, RLS defined in SQL, `.env.example` complete | Provision prod Supabase + bucket, apply migrations, wire Vercel env, verify live RLS | `docs/PRODUCTION_SETUP.md` |
| Deploy & production smoke | 79 | Standard Next target, route-derived smoke plan | `vercel` preview → prod, live smoke + core-flow walkthrough | `docs/DEPLOYMENT.md` |
| SEO / shareable pages | 80 | robots/sitemap/OG/favicon derived from the real routes | Attach the custom domain (`NEXT_PUBLIC_APP_URL`) | `docs/DEPLOYMENT.md` |
| Error + product monitoring | 81 | Analytics seam + catalog, error hook, emission reconcile | Register the Sentry/PostHog adapters with their keys | `docs/MONITORING.md` |
| Demo walkthrough | 83 | Timed script covering the whole core flow | Seed a tenant, screen-record, produce the file | `docs/DEMO_SCRIPT.md` |

Each gate's own live steps live in its runbook; this checklist only proves the
gate's offline half is green and counts the remaining live steps.

---

## The live launch (manual — in order)

1. **Finish every gate's live steps** above (prod infra → deploy → domain →
   monitoring adapters → demo recording).
2. **Walk the core flow against the live URL.** Run
   [USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md) (Day 68) end-to-end, signed in, on
   the deployed app — not just locally.
3. **Collect testimonials.** Send the templates below to early users; gather one
   or two sentences each, with explicit sign-off before anything goes public.
4. **Announce.** Publish the live URL + the demo video on the portfolio / README
   once the live walkthrough passes.

---

## Testimonial outreach templates

Merge fields are the named slots `{{first_name}}`, `{{company}}`, `{{your_name}}`,
`{{your_title}}`, `{{product_url}}`, `{{review_link}}`, `{{calendar_link}}` — fill
them in before sending. These mirror `OUTREACH_TEMPLATES` in the core; the
check proves no stray merge field sneaks in and the copy stays on-brand.

### 1. Beta testimonial ask (email)

> **Subject:** A quick favour about your AdJury reviews
>
> Hi {{first_name}},
>
> Thanks for putting AdJury through its paces at {{company}} these last few
> weeks. Before we open it up more widely, I'm collecting a few words from the
> people who've actually used it.
>
> Would you be up for one or two sentences on what AdJury changed for your team —
> a flagged compliance risk you caught before publishing, a rewrite you shipped,
> or just the time it saved? Anything specific is far more useful than a generic
> plug.
>
> If it's easier to talk it through, grab a slot here: {{calendar_link}}. Either
> way, no pressure, and thank you.
>
> Best,
> {{your_name}}, {{your_title}}

### 2. Reminder (email)

> **Subject:** Re: A quick favour about your AdJury reviews
>
> Hi {{first_name}},
>
> Just floating this back to the top of your inbox — if you have a spare minute, a
> sentence on how AdJury has fit into your pre-publish workflow would mean a lot
> as we launch.
>
> If now isn't the time, no worries at all; reply "later" and I'll check back
> after launch.
>
> Thanks again,
> {{your_name}}

### 3. Case-study ask (email)

> **Subject:** Would {{company}} be open to a short AdJury case study?
>
> Hi {{first_name}},
>
> {{company}} is one of the teams getting the most out of AdJury — the six jurors
> have run across a real volume of your content, and the history shows it.
>
> Would you be open to a short case study? Fifteen minutes on a call
> ({{calendar_link}}), and I'll draft it for your approval — nothing goes public
> without your sign-off, and you can pull a quote back any time.
>
> If that's a yes, your review history is the easiest starting point:
> {{review_link}}.
>
> Best,
> {{your_name}}, {{your_title}}

### 4. LinkedIn DM

> Hi {{first_name}} — thanks again for trying AdJury. We're launching soon, and a
> one-line note on what it did for your content reviews would help a lot. Totally
> fine to say no. You can point people at {{product_url}} if it's useful. —
> {{your_name}}

---

## Blocked / needs credentials

The **launch checklist and outreach templates exist and are verified** here
(`npm run launch:check` passes offline). The **live launch** needs a deploy and
real users this cloud build has none of:

- promoting to production + attaching the domain (the gates' own live steps —
  see each runbook);
- walking the core flow against the live URL (needs the deployed app + a seeded
  account);
- sending the outreach templates and collecting real testimonials (needs early
  users and their sign-off);
- announcing the launch with the live URL + demo video.

These are reported as `manual` readiness items by `npm run launch:check`.

---

_Related: [DailyPlan.md](../DailyPlan.md) · [Memory.md](../Memory.md) · [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [MONITORING.md](MONITORING.md) · [DEMO_SCRIPT.md](DEMO_SCRIPT.md) · [USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md) · `src/lib/marketing/launch-checklist.ts`_
