/**
 * User profile — pure domain pieces (DailyPlan Day 51).
 *
 * The account settings page (`/account`) lets a signed-in user edit their own
 * profile. Today that is a single field — the display name — which is how they
 * are shown in the app; email and role stay read-only there (email is a Supabase
 * Auth identity and role is changed only by an admin via team management, Day 25).
 * This module owns the pure, unit-testable parts — the save input contract and
 * the display-name fallback helper — so they need no database or React to test.
 * The DB write lives in `queries.ts` (`updateUserDisplayName`), the decision core
 * in `update-profile.ts`, the server action in `actions.ts`, and the form in
 * `components/user/user-settings-form.tsx`.
 */
import { z } from "zod";
import { MAX_DISPLAY_NAME_CHARS } from "@/lib/validation/limits";
import type { UserRow } from "@/types/db";

/**
 * User-profile input contract (Rules.md §3 — validate before trust). Only the
 * display name is editable here; it is optional (an empty value clears the name
 * back to the email fallback) and length-bounded (Day 45 — input hardening) so a
 * free-text field can't carry an essay. Identity (`id`/`company_id`) is never
 * part of this — it is derived from the session server-side (Rules.md §5): the
 * action only ever writes the signed-in user's own row.
 */
export const UserProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(
      MAX_DISPLAY_NAME_CHARS,
      `Display name must be ${MAX_DISPLAY_NAME_CHARS} characters or fewer.`,
    )
    .optional()
    .default(""),
});

export type UserProfileInput = z.infer<typeof UserProfileSchema>;

/** First human-readable validation message, for surfacing in the form. */
export function firstProfileIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/**
 * Normalize a validated (already-trimmed) display name to what is stored: a
 * non-empty name, or `null` when blank. Keeping this pure means the core and the
 * idempotency check agree on exactly one canonical form.
 */
export function normalizeDisplayName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * How a user is shown in the app: their display name when set, otherwise the
 * email. Pure so the page, nav, and any future roster use one fallback rule
 * (Design.md §1.4 — consistency is credibility).
 */
export function displayNameOrFallback(
  user: Pick<UserRow, "display_name" | "email">,
): string {
  const name = user.display_name?.trim();
  return name && name.length > 0 ? name : user.email;
}
