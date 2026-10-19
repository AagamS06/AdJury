"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { serverClient } from "@/lib/db/supabase";
import {
  getUserById,
  updateUserDisplayName,
  updateUserNotificationPrefs,
} from "@/lib/db/queries";
import { updateUserProfile } from "./update-profile";
import {
  resolveNotificationPrefs,
  updateNotificationPreferences,
} from "./update-notifications";
import {
  EmailChangeSchema,
  PasswordChangeSchema,
  firstSecurityIssue,
} from "./account-security";
import { logError, errorContext } from "@/lib/observability/logger";

/**
 * User-settings server action (DailyPlan Day 51). Logic lives here, not in the
 * form component (Rules.md §7). `requireSession()` re-derives the caller
 * server-side (an anonymous caller is redirected to `/login`), and the update
 * core validates the input and writes under the service-role client (`users` has
 * no client write policy). Both the id and company id come from the resolved
 * session, never the form (Rules.md §5) — so a user can only ever edit their own
 * profile. On success `/account` is revalidated so the page reflects the new name.
 */
export interface UserSettingsFormState {
  error?: string;
  /** Confirmation copy, set after a successful save. */
  notice?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function updateUserProfileAction(
  _prev: UserSettingsFormState,
  formData: FormData,
): Promise<UserSettingsFormState> {
  await requireSession();

  // Re-resolve for the core (owns the 401/400/500 mapping); the guard above has
  // already redirected any anonymous caller, so this is a non-null session here.
  const session = await getSessionContext().catch(() => null);
  const admin = serverClient();

  const result = await updateUserProfile({
    session,
    input: { display_name: field(formData, "display_name") },
    update: ({ companyId, userId, displayName }) =>
      updateUserDisplayName(admin, companyId, userId, displayName),
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/account");
  return {
    notice: result.changed
      ? "Profile saved."
      : "That's already your profile — nothing to change.",
  };
}

// ── notification preferences (DailyPlan Day 51, Part 2) ────────────────────

export interface NotificationPrefsFormState {
  error?: string;
  notice?: string;
}

/** An HTML checkbox is present in the form data only when checked. */
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) != null;
}

/**
 * Save the signed-in user's notification preferences (DailyPlan Day 51, Part 2).
 * `requireSession()` re-derives the caller server-side; the current preferences
 * are read from their own row for the idempotent no-op check, and the update core
 * writes under the service-role client scoped to that id + company id (Rules.md
 * §5). Unchecked checkboxes resolve to `false`.
 */
export async function updateNotificationPreferencesAction(
  _prev: NotificationPrefsFormState,
  formData: FormData,
): Promise<NotificationPrefsFormState> {
  await requireSession();

  const session = await getSessionContext().catch(() => null);
  const admin = serverClient();

  // Read the current preferences from the user's own row (defaults when absent).
  let current;
  try {
    const db = await createServerSupabase();
    const row = session ? await getUserById(db, session.authUserId) : null;
    current = resolveNotificationPrefs(row ?? {});
  } catch {
    // Fail closed to the defaults for the no-op check; the write below is the
    // source of truth, so a read blip can't corrupt the saved value.
    current = resolveNotificationPrefs({});
  }

  const result = await updateNotificationPreferences({
    session,
    input: {
      review_complete: checkbox(formData, "review_complete"),
      weekly_digest: checkbox(formData, "weekly_digest"),
      product_news: checkbox(formData, "product_news"),
    },
    current,
    update: ({ companyId, userId, prefs }) =>
      updateUserNotificationPrefs(admin, companyId, userId, prefs),
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/account");
  return {
    notice: result.changed
      ? "Notification preferences saved."
      : "Those are already your preferences — nothing to change.",
  };
}

// ── password & email changes (DailyPlan Day 51, Part 2) ────────────────────
//
// These are Supabase Auth operations (`updateUser`), so their effect needs a live
// project; the validation is still enforced at the boundary. Each re-derives the
// caller with `requireSession()` and acts on the current session's own account —
// no client-supplied identity is trusted for *who* is changing (Rules.md §5).

export interface AccountSecurityFormState {
  error?: string;
  notice?: string;
}

/**
 * Change the signed-in user's password. The active session is the proof of
 * identity for `updateUser` (no current-password round-trip). On success the
 * password is updated immediately; a plain message is returned on any failure
 * (internal detail stays in logs — Rules.md §6).
 */
export async function changePasswordAction(
  _prev: AccountSecurityFormState,
  formData: FormData,
): Promise<AccountSecurityFormState> {
  await requireSession();

  const parsed = PasswordChangeSchema.safeParse({
    password: field(formData, "password"),
    confirm: field(formData, "confirm"),
  });
  if (!parsed.success) return { error: firstSecurityIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    logError("password change failed", {
      op: "changePasswordAction",
      // Supabase's own message can be surfaced generically; don't echo it.
      errorName: error.name,
    });
    return {
      error: "We couldn't update your password. Please try again.",
    };
  }

  return { notice: "Password updated." };
}

/**
 * Change the signed-in user's email. Supabase sends a confirmation link to the
 * new address; the change takes effect only once it is confirmed, so an
 * unverified address never becomes the account's email. The `users.email` mirror
 * column is synced on confirmation by a DB trigger/webhook in production (see the
 * PR's "Blocked / needs credentials"), so this action does not touch it directly.
 */
export async function changeEmailAction(
  _prev: AccountSecurityFormState,
  formData: FormData,
): Promise<AccountSecurityFormState> {
  await requireSession();

  const parsed = EmailChangeSchema.safeParse({
    email: field(formData, "email"),
  });
  if (!parsed.success) return { error: firstSecurityIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({
    email: parsed.data.email,
  });
  if (error) {
    logError("email change failed", {
      op: "changeEmailAction",
      errorName: error.name,
    });
    return {
      error: "We couldn't start the email change. Please try again.",
    };
  }

  return {
    notice:
      "Check your new inbox to confirm the change. Your email updates once you confirm.",
  };
}
