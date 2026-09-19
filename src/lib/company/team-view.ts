/**
 * Pure presentation helpers for the team-management list (DailyPlan Day 23).
 *
 * Kept out of the React component (like `history-view.ts` / `scorecard-view.ts`)
 * so the display logic — role labels, the roster view-model, and the member
 * counts — is unit-testable in the node test env without a browser or a
 * database. Colour → Tailwind stays at the component layer; meaning is never
 * carried by colour alone (Design.md §6), so every role ships with a text label.
 */
import { formatHistoryDate } from "@/lib/reviews/history-view";
import type { UserRole, UserRow } from "@/types/db";

/** Human label for a role. */
export function roleLabel(role: UserRole): string {
  return role === "admin" ? "Admin" : "Member";
}

/**
 * Format a member's `created_at` as their "joined" date. Reuses the history
 * list's deterministic UTC-parts formatter so a joined date reads identically
 * to a review date across the app (Design.md §1.4 — consistency is credibility)
 * and is locale/timezone-independent for tests.
 */
export function formatJoinedDate(iso: string): string {
  return formatHistoryDate(iso);
}

/** A single team member prepared for rendering. */
export interface TeamMemberView {
  id: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  joined: string;
  /** Whether this row is the signed-in admin viewing the page. */
  isCurrentUser: boolean;
}

/** Project one `UserRow` into a `TeamMemberView`. */
export function toTeamMember(user: UserRow, currentUserId: string): TeamMemberView {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    roleLabel: roleLabel(user.role),
    joined: formatJoinedDate(user.created_at),
    isCurrentUser: user.id === currentUserId,
  };
}

/**
 * Build the ordered team roster: admins first (they run the company), then
 * members, and within each role the earliest-joined first. The order is a pure
 * function of the data (not insertion order), so the list is stable regardless
 * of how the query returned the rows.
 */
export function toTeamRoster(
  users: UserRow[],
  currentUserId: string,
): TeamMemberView[] {
  const roleRank = (role: UserRole): number => (role === "admin" ? 0 : 1);
  return [...users]
    .sort((a, b) => {
      const byRole = roleRank(a.role) - roleRank(b.role);
      if (byRole !== 0) return byRole;
      return a.created_at.localeCompare(b.created_at);
    })
    .map((user) => toTeamMember(user, currentUserId));
}

/** Summary counts for the team header. */
export interface TeamSummary {
  total: number;
  admins: number;
  members: number;
}

/** Count members by role for the page header (e.g. "3 members · 1 admin"). */
export function summarizeTeam(users: UserRow[]): TeamSummary {
  const admins = users.filter((u) => u.role === "admin").length;
  return {
    total: users.length,
    admins,
    members: users.length - admins,
  };
}
