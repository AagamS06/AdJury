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
import type { NotificationPreferences, UserRow } from "@/types/db";

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

// ── notification preferences (Day 51, Part 2) ──────────────────────────────

/**
 * Default notification preferences, matching migration 0011. Applied by
 * `resolveNotificationPrefs` whenever a column is absent (a pre-migration row or
 * a test fixture), so a reader never sees an undefined preference.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  review_complete: true,
  weekly_digest: false,
  product_news: true,
};

/**
 * Resolve a user row's notification preferences to the nested shape the UI and
 * the update core use, applying the defaults for any absent column. Pure so the
 * page and the idempotency check read preferences the same way.
 */
export function resolveNotificationPrefs(
  user: Pick<
    UserRow,
    "notify_review_complete" | "notify_weekly_digest" | "notify_product_news"
  >,
): NotificationPreferences {
  return {
    review_complete:
      user.notify_review_complete ?? DEFAULT_NOTIFICATION_PREFS.review_complete,
    weekly_digest:
      user.notify_weekly_digest ?? DEFAULT_NOTIFICATION_PREFS.weekly_digest,
    product_news:
      user.notify_product_news ?? DEFAULT_NOTIFICATION_PREFS.product_news,
  };
}

/**
 * Notification-preferences input contract (Rules.md §3 — validate before trust).
 * Each opt-in is a strict boolean; the form's checkboxes are resolved to booleans
 * in the action (an unchecked box is simply `false`) before they reach this. As
 * with the rest of the account surface, identity is never part of the input — it
 * is the session user's own row (Rules.md §5).
 */
export const NotificationPrefsSchema = z.object({
  review_complete: z.boolean(),
  weekly_digest: z.boolean(),
  product_news: z.boolean(),
});

export type NotificationPrefsInput = z.infer<typeof NotificationPrefsSchema>;

/** Whether two preference sets are identical (for the idempotent no-op path). */
export function notificationPrefsEqual(
  a: NotificationPreferences,
  b: NotificationPreferences,
): boolean {
  return (
    a.review_complete === b.review_complete &&
    a.weekly_digest === b.weekly_digest &&
    a.product_news === b.product_news
  );
}
