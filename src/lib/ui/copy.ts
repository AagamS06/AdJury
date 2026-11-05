/**
 * Copy lexicon (DailyPlan Day 65 — Copywriting pass).
 *
 * "UI text, error messages, empty states in the brand voice.
 *  DoD: consistent, professional copy."
 *
 * The copywriting-pass sibling of the app's other "pure core + static audit"
 * passes (`palette-audit` Day 60, `responsive-audit` Day 61, `semantics-audit`
 * Day 62): this module is the single source of truth for the product's
 * **terminology**, and `copy-audit.ts` enforces it over the real source so
 * "consistent, professional copy" becomes a regression-proof check instead of a
 * one-time read-through. Design.md §7 (Voice & Tone) is the spec it encodes:
 * *confident, concise, professional; no hype; no emoji in product chrome.*
 *
 * It owns two things:
 *
 *  1. {@link AUTH_ACTION_LABELS} — the canonical button/link labels for the
 *     three auth actions, so prose and chrome name them the way their own
 *     screens do.
 *  2. {@link TERM_RULES} — the lexicon the audit enforces: a canonical term and
 *     the non-canonical **prose** variants that must not appear. Each variant is
 *     a RegExp written to match only the prose/separated form (a space or
 *     hyphen between words), never a code identifier — e.g. the auth rule's
 *     `sign in` / `sign-in` matches human copy but not the `signInAction`
 *     function name or the `/login` route, which carry no separator. The audit
 *     also strips comments before scanning, so a word used in a docstring is
 *     never flagged.
 *
 * Why these rules and not more: a rule earns its place only when the codebase
 * is already consistent on it (so it is a genuine guard, not a false-positive
 * generator) — the one real drift this pass fixes is "sign in" vs the login
 * screen's own "Log in". Hype words and emoji are already absent from the
 * chrome; the emoji ban is codified in the audit, and hype is left to review
 * rather than a brittle word-list.
 */

import { PERSONAS } from "@/lib/ai/personas";

/**
 * The size of the jury, derived from the real roster the orchestrator runs
 * ({@link PERSONAS}), so adding or removing a juror updates the single source of
 * truth in one place. The copy audit (`findJurorCountDrift`) enforces that
 * user-facing chrome states exactly this many jurors.
 *
 * This guard exists because of a real drift it caught (DailyPlan Day 69 —
 * friction fixes): the submit flow's intro, its "reviewing…" status, the
 * history empty state, and the site meta description all still said "five
 * jurors" after the Business Analyst (Day 23b) made the jury six, while the
 * scorecard rendered six juror cards — a comprehension/trust friction a tester
 * hits in the core flow. Prose hard-codes the number-word (as the landing page
 * already does); the audit keeps every such statement honest against the roster.
 */
export const JUROR_COUNT: number = PERSONAS.length;

/** Cardinal number-words 0–20, for stating small counts in prose. */
export const NUMBER_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

/**
 * The spelled cardinal for `n` when it is a small non-negative integer within
 * {@link NUMBER_WORDS}, else its decimal string. Lets the audit name the
 * expected count in prose ("six") instead of a bare digit.
 */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length
    ? NUMBER_WORDS[n]
    : String(n);
}

/** The canonical spelled jury size, e.g. `"six"`. */
export const JUROR_COUNT_WORD: string = numberWord(JUROR_COUNT);

/**
 * Canonical labels for the three authentication actions. Prose names an action
 * the way its screen/button is labelled, so these are the one spelling each
 * action gets in the UI.
 *
 * Note the verb/noun split English makes here: the **verb** is two words —
 * "log in" ("Log in to continue") — while the **noun/adjective** is one word
 * ("your login", "login details"). The audit bans only the wrong *term* for the
 * action ("sign in"); it does not police the verb/noun spelling, which review
 * handles.
 */
export const AUTH_ACTION_LABELS = {
  /** Enter existing credentials. The `/login` screen's own title. */
  logIn: "Log in",
  /** Create a new account. The `/signup` screen's own title. */
  signUp: "Sign up",
  /** End the session. */
  signOut: "Sign out",
} as const;

/** A canonical term and the prose variants that must not be used for it. */
export interface TermRule {
  /** Stable id (kebab-case), used in findings and tests. */
  id: string;
  /** The spelling the UI should use. */
  canonical: string;
  /**
   * Prose variants to flag. Each is written to match the human-copy form only
   * (a separator between words, or a specific wrong casing) so it never matches
   * a code identifier. The audit adds the global flag when scanning; the case
   * flag each RegExp carries is respected (the brand-name rule is
   * case-sensitive, so only the mis-cased forms are caught).
   */
  variants: readonly RegExp[];
  /** One line on why, surfaced in audit reports. */
  note: string;
}

/**
 * The enforced lexicon. Kept deliberately small: every rule is one the codebase
 * already satisfies (after this pass's fixes), so the audit is a guard against
 * future drift, not a backlog.
 */
export const TERM_RULES: readonly TermRule[] = [
  {
    id: "auth-log-in",
    canonical: AUTH_ACTION_LABELS.logIn,
    // The separated prose form only — "sign in", "sign-in". The `signInAction`
    // identifier and the `/login` route have no separator and are not matched.
    variants: [/\bsign[ -]in\b/i],
    note: "The credential-entry action is 'Log in' (its own screen's title); prose must not call it 'sign in'.",
  },
  {
    id: "email-one-word",
    canonical: "email",
    variants: [/\be-mail\b/i],
    note: "'email' is one word, no hyphen.",
  },
  {
    id: "brand-name",
    canonical: "AdJury",
    // Case-sensitive: only the mis-cased forms. The all-lowercase "adjury" used
    // in export *filenames* (`adjury-review-….csv`) is intentional and allowed.
    variants: [/\bAdjury\b/, /\bADJURY\b/, /\badJury\b/],
    note: "The product is 'AdJury' (capital A, capital J).",
  },
];
