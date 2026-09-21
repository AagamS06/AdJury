/**
 * Role management — pure domain logic (DailyPlan Day 25).
 *
 * An admin promotes a member to admin, or demotes an admin back to member
 * (PRD §6.1 auth + roles). This module owns the pieces that are unit-testable
 * without a database, React, or Next: the input contract, the "last admin"
 * safety predicate, and the small display helpers the toggle control uses. The
 * DB write lives in `queries.ts` (`updateUserRole`), the decision + authz logic
 * in the injectable core (`update-role.ts`), and the form/table in
 * `components`/`app`.
 *
 * Safety + tenancy (Rules.md §5): the change is authorized on the server (only
 * an admin may act), the target's `company_id` is server-derived, and a
 * company can never be left with zero admins — `wouldRemoveLastAdmin` is the
 * pure guard the core enforces.
 */
import { z } from "zod";
import type { UserRole, UserRow } from "@/types/db";

/**
 * Role-change input contract (Rules.md §3 — validate before trust). `userId`
 * identifies the target member; the acting admin and the company are derived
 * from the session server-side, never from this input (Rules.md §5).
 */
export const RoleChangeSchema = z.object({
  userId: z.string().trim().min(1, "Choose a teammate to update."),
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Choose a role." }),
  }),
});

export type RoleChangeInput = z.infer<typeof RoleChangeSchema>;

/** First human-readable validation message, for surfacing in the UI. */
export function firstRoleChangeIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please try again.";
}

/**
 * Whether applying `newRole` to `targetUserId` would leave the company with no
 * admins. True only when the target is currently the sole admin and is being
 * demoted to member — the one change that must be blocked so a company can't
 * lock itself out of admin-only management (Rules.md §5/§6, fail closed).
 *
 * Pure over the current roster so the core and any UI derive the same answer.
 */
export function wouldRemoveLastAdmin(
  members: Pick<UserRow, "id" | "role">[],
  targetUserId: string,
  newRole: UserRole,
): boolean {
  if (newRole === "admin") return false; // a promotion never removes an admin
  const target = members.find((m) => m.id === targetUserId);
  if (!target || target.role !== "admin") return false; // not demoting an admin
  const otherAdmins = members.filter(
    (m) => m.role === "admin" && m.id !== targetUserId,
  );
  return otherAdmins.length === 0;
}

/** The role a promote/demote toggle moves a member to (the opposite role). */
export function nextRole(current: UserRole): UserRole {
  return current === "admin" ? "member" : "admin";
}

/** Label for the toggle button given the member's current role. */
export function roleActionLabel(current: UserRole): string {
  return current === "admin" ? "Make member" : "Make admin";
}
