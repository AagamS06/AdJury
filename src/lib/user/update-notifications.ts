/**
 * Update-notification-preferences core (DailyPlan Day 51, Part 2).
 *
 * Mirrors `update-profile.ts`: the decision logic is unit-testable without Next
 * or a live database (identity, the current prefs, and the DB write are injected),
 * and the action wires the real service-role write (`users` has no client write
 * policy). A *self-edit* (Rules.md §5): there is no target to resolve — the write
 * is scoped to the session user's own id + company id, so a caller can only ever
 * change their own preferences. Unchanged preferences are an idempotent no-op.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { NotificationPreferences, UserRow } from "@/types/db";
import {
  NotificationPrefsSchema,
  notificationPrefsEqual,
  resolveNotificationPrefs,
} from "./profile";
import { logError, errorContext } from "@/lib/observability/logger";

export type UpdateNotificationsResult =
  | { ok: true; status: 200; user: UserRow; changed: boolean }
  | { ok: false; status: 400 | 401 | 500; error: string };

export interface UpdateNotificationsDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: unknown;
  /**
   * The user's current stored preferences (read from their row), used for the
   * idempotent no-op check. Injected so the core needs no DB to test.
   */
  current: NotificationPreferences;
  /** Persist the new preferences, wired to `updateUserNotificationPrefs`. */
  update: (params: {
    companyId: string;
    userId: string;
    prefs: NotificationPreferences;
  }) => Promise<UserRow>;
}

export async function updateNotificationPreferences(
  deps: UpdateNotificationsDeps,
): Promise<UpdateNotificationsResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }

  const parsed = NotificationPrefsSchema.safeParse(deps.input);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "We couldn't read those preferences. Please try again.",
    };
  }
  const prefs = parsed.data;

  const { authUserId: userId, companyId } = deps.session;

  // Idempotent no-op: nothing changed, so skip the write.
  if (notificationPrefsEqual(prefs, deps.current)) {
    return {
      ok: true,
      status: 200,
      user: sessionUser(deps.session, prefs),
      changed: false,
    };
  }

  let user: UserRow;
  try {
    user = await deps.update({ companyId, userId, prefs });
  } catch (err) {
    logError("notification preferences update failed", {
      op: "updateNotificationPreferences/update",
      companyId,
      userId,
      ...errorContext(err),
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't save your preferences. Please try again.",
    };
  }

  return { ok: true, status: 200, user, changed: true };
}

/** Build a `UserRow` view from the session for the no-op path (see update-profile.ts). */
function sessionUser(
  session: SessionContext,
  prefs: NotificationPreferences,
): UserRow {
  return {
    id: session.authUserId,
    company_id: session.companyId,
    email: session.email,
    role: session.role,
    display_name: session.displayName ?? null,
    notify_review_complete: prefs.review_complete,
    notify_weekly_digest: prefs.weekly_digest,
    notify_product_news: prefs.product_news,
    created_at: "",
  };
}

/** Re-export for the page's convenience (resolve a row → nested prefs). */
export { resolveNotificationPrefs };
