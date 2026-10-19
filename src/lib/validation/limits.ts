/**
 * Shared input bounds (DailyPlan Day 45 — input hardening).
 *
 * Single source of truth for the size limits on the user-supplied inputs that
 * didn't already have one. The sweep (Rules.md §6 — "reject invalid/oversized
 * input at the API boundary with a specific message") found several free-text
 * fields that were validated for *format* but not *length*: a free-form string
 * with no `.max()` lets a client push an arbitrarily large value through the
 * boundary — into the database, the model prompt, or a hashing call — defeating
 * the content/cost caps the rest of the stack is careful about (Rules.md §1).
 *
 * These constants are consumed by the input schemas (`auth/schema.ts`,
 * `company/invitations.ts`, `company/role-management.ts`, `schema/juror.ts`) and
 * the invite-token guard in `company/actions.ts`, so every bound has exactly one
 * definition and the input-hardening audit (`input-audit.ts`) can assert against
 * them. Fields that already had a cap keep their own local constant
 * (`MAX_CONTENT_CHARS`, `MAX_TONE_GUIDE_CHARS`, the onboarding name/website caps);
 * this module only adds the ones that were missing.
 */

/**
 * Max length of an email address. RFC 5321's practical ceiling (a 64-char local
 * part + "@" + a 253-char domain is 254). A valid address is always far shorter;
 * this just stops an unbounded string reaching Supabase Auth / the DB.
 */
export const MAX_EMAIL_CHARS = 254;

/** Password bounds. The floor is the existing policy; the ceiling is new. */
export const MIN_PASSWORD_CHARS = 8;
/**
 * Max password length. Generous for a real passphrase while bounding the string
 * that gets hashed server-side — an unbounded password is a cheap way to make a
 * server do expensive hashing work (a long-input hashing DoS). 128 is well above
 * any effective key-derivation input length.
 */
export const MAX_PASSWORD_CHARS = 128;

/**
 * Max length of the free-form `platform` on a review. The curated platform
 * values are a single word; this leaves room for a custom label while keeping
 * the field — which is persisted and injected into the platform-aware prompts —
 * from carrying an essay (the token budget does not count `platform`, so an
 * unbounded value would slip past the content cap).
 */
export const MAX_PLATFORM_CHARS = 64;

/**
 * Max length of a client-supplied user id (the role-change target). A UUID is 36
 * characters; this bounds a field that is otherwise `min(1)` only, so a junk id
 * is rejected cheaply at the boundary before the roster read.
 */
export const MAX_USER_ID_CHARS = 64;

/**
 * Max length of a presented invite token before we hash it. The generated token
 * is 64 hex characters (`INVITE_TOKEN_BYTES` × 2); this generous ceiling rejects
 * an absurdly large bearer value at the boundary so it never reaches the hash.
 */
export const MAX_INVITE_TOKEN_CHARS = 256;

/**
 * Max length of a user's display name (DailyPlan Day 51 — user settings). A
 * generous ceiling for a real name while bounding a free-text field that is
 * persisted and shown in the app chrome, so a pasted essay can't land in it.
 */
export const MAX_DISPLAY_NAME_CHARS = 80;
