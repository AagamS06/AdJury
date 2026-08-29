# AdJury — Project Rules & Conventions

> **Status:** Draft v1 · **Last updated:** 2026-08-29
> Ground rules for anyone (human or AI) contributing to AdJury. Read this before writing code.

---

## 1. Guiding Principles

1. **Ship the QA layer, not a content generator.** Every feature keeps the human in control. We critique and suggest; we do not auto-publish.
2. **Cost discipline is a feature.** One model, five prompts, caching, rate limits. Never fan out to multiple paid providers when one will do.
3. **Enterprise-credible over cute.** UI, copy, and defaults should read as a tool a marketing director trusts. See [Design.md](Design.md).
4. **Multi-tenant safety is non-negotiable.** No code path may leak one company's data to another.
5. **Small, working increments.** Prefer a thin end-to-end slice over a broad half-built layer. Follow the phase order in [Phases.md](Phases.md).

---

## 2. Tech & Library Choices

### Use
- **Next.js 15 (App Router) + TypeScript** — one repo for UI + API.
- **React + Tailwind CSS + shadcn/ui** — styling and accessible primitives.
- **Supabase** — Postgres, Auth, Row-Level Security.
- **Zod** — validate the juror JSON contract and every API input.
- **One AI provider at a time** behind `lib/ai/client.ts`. Default model: **Claude Haiku 4.5** (cost-efficient). Alternatives allowed via the same interface: another small Claude model, GPT-4o-mini, or a Groq-hosted open model.

### Avoid / don't reach for
- A second UI framework or CSS-in-JS system alongside Tailwind.
- Heavyweight state managers (Redux) before there's real shared state — start with React state + server components.
- A custom ORM abstraction early; use the Supabase client + SQL migrations. Add Drizzle only if queries get complex.
- New dependencies for things the stack already does. Justify every added package in the PR description.
- Calling multiple paid AI providers per review (defeats the core cost mechanic).

### Adding a dependency
Allowed when it removes real complexity **and** is actively maintained. Note *why* in the PR. Prefer standard-library / framework-native solutions first.

---

## 3. AI / Persona Boundaries

- **The AI critiques content; it does not make product decisions, run migrations, or touch billing.**
- Each juror must return **only** JSON conforming to the schema in [PRD.md](PRD.md) §7. No prose outside the JSON.
- Persona prompts live in `src/lib/ai/personas/*` — **one file per juror**. Prompt changes are code changes: reviewed, versioned, never edited live in prod.
- **Never send secrets, other companies' data, or full raw style guides** into a prompt. Juror 1 uses the cached brand summary/embedding, not arbitrary uploads verbatim.
- **Validate before trust.** Model output is untrusted input: parse, Zod-validate, retry once, then mark that juror `error`. A malformed juror must never crash a whole review or be stored unvalidated.
- **Determinism where it matters.** Use low temperature for scoring; keep rubrics explicit so scores are reproducible and defensible.
- **No PII harvesting.** Do not log full user content or model prompts/outputs in plaintext beyond what's needed for the review record. Redact where practical.

---

## 4. Secrets & Configuration

- **Never commit secrets.** `.env.local` is gitignored. Only `.env.example` (placeholders) is committed.
- All AI keys and the Supabase service-role key are used **server-side only** — never shipped to the browser bundle.
- Production secrets live in the Vercel and Supabase dashboards, not in the repo or in chat.
- If a secret is ever committed or pasted anywhere shared, **rotate it** immediately.

Required env keys (documented in `.env.example`):
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only
# AI provider
AI_PROVIDER=anthropic            # anthropic | openai | groq
AI_API_KEY=                      # server only
AI_MODEL=claude-haiku-4-5
```

---

## 5. Data & Multi-Tenancy Rules

- Every tenant table carries `company_id` and is protected by Row-Level Security.
- **Never trust a client-supplied `company_id`** — always derive it from the authenticated session server-side.
- Admin-only actions (brand profile edits, team management) are enforced on the server, not just hidden in the UI.
- Deletes cascade sensibly (`persona_scores` on `reviews`); never orphan rows.

---

## 6. Error Handling Procedure

Handle errors at the layer that can do something useful; surface a clear message to the user; never swallow silently.

| Failure | Behavior |
|---|---|
| **Invalid user input** (empty/oversized content, bad type) | Reject at the API boundary with a 4xx and a specific message. Validate with Zod. |
| **Auth / permission** | 401/403; never leak whether another company's resource exists. |
| **Single juror returns bad JSON** | Retry once with a corrective nudge; if still bad, store that juror as `status: error` and continue. The review still returns. |
| **All jurors fail** | Return a 502-style error to the user with a "try again" message; do not persist a partial review as complete. |
| **AI provider timeout / rate limit** | Fail the affected juror(s) gracefully; respect provider backoff; surface a retryable error. |
| **DB write failure** | Do not report success. Roll back / mark the review incomplete. |
| **Rate limit hit (plan tier)** | Return 429 with the plan's limit and reset time. |

**Rules:**
- No empty `catch {}`. Log with context (company, review id, juror) — but redact user content/secrets.
- User-facing errors are plain-language and actionable; internal detail goes to logs only.
- Fail closed on anything touching authz, tenancy, or secrets.

---

## 7. Code Style & Git

- **TypeScript strict mode on.** No `any` without a written reason.
- Keep AI, DB, and domain logic in `src/lib/*` — **not** inside React components.
- Match the surrounding code's naming and structure. Small, focused functions.
- **Commits:** small and descriptive (imperative mood: "add juror schema validation"). One logical change per commit.
- **Branches:** feature branches off `main`; open a PR — don't push straight to `main`.
- **Never** commit `.env.local`, secrets, or generated build output.
- Run type-check + tests before opening a PR.

---

## 8. Testing

- Every phase ships with at least the tests named in [Phases.md](Phases.md).
- **Contract test** (`tests/schema.test.ts`): juror output always validates against the Zod schema.
- **End-to-end test** (`tests/e2e-review.test.ts`): sample content → 5 jurors → valid aggregate JSON.
- Test the scoring/verdict logic in isolation (pure function, easy to assert).
- Don't mock away the schema validation — that's the contract we're protecting.

---

## 9. Definition of Done (per feature)

- [ ] Meets the acceptance criteria in [Phases.md](Phases.md).
- [ ] Type-checks; lint clean; relevant tests pass.
- [ ] No secrets committed; `.env.example` updated if new keys added.
- [ ] Tenant-safe (RLS + server-side authz where relevant).
- [ ] Errors handled per §6; no silent failures.
- [ ] [Memory.md](Memory.md) updated (what changed, what's next).

---

_Related: [PRD.md](PRD.md) · [Architecture.md](Architecture.md) · [Phases.md](Phases.md) · [Design.md](Design.md) · [Memory.md](Memory.md)_
