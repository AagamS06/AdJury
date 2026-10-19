"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { serverClient } from "@/lib/db/supabase";
import { updateUserDisplayName } from "@/lib/db/queries";
import { updateUserProfile } from "./update-profile";

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
