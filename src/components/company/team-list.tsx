import type { UserRow } from "@/types/db";
import { summarizeTeam, toTeamRoster } from "@/lib/company/team-view";

/**
 * TeamList (DailyPlan Day 23, Design.md §5 "Tables/history"): the company's
 * members as a quiet, bordered table — email, role, and joined date — admins
 * listed first. A pure, hook-free presentational component: it takes the
 * company-scoped `UserRow[]` the server page already loaded (tenant-safe by
 * construction) and the signed-in admin's id so it can mark their own row.
 *
 * Display logic lives in `team-view.ts`; colour never travels alone (Design.md
 * §6): the role badge carries its word, and the "You" marker is a text badge.
 */
export function TeamList({
  members,
  currentUserId,
}: {
  members: UserRow[];
  currentUserId: string;
}) {
  if (members.length === 0) {
    // A provisioned company always has at least its admin, so this is a defensive
    // fallback rather than an expected state.
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-10 text-center">
        <h2 className="text-lg font-semibold text-navy">No members yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Team members will appear here once they join your company.
        </p>
      </div>
    );
  }

  const rows = toTeamRoster(members, currentUserId);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Your company&apos;s team members and their roles.
          </caption>
          <thead>
            <tr className="border-b border-border bg-canvas text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">
                Member
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Role
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Joined
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border last:border-b-0 odd:bg-surface even:bg-canvas/40 hover:bg-canvas"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-body">{row.email}</span>
                  {row.isCurrentUser && (
                    <span className="ml-2 inline-block rounded-full bg-royal/10 px-2 py-0.5 text-xs font-semibold text-royal ring-1 ring-royal/30">
                      You
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      row.role === "admin"
                        ? "bg-navy/10 text-navy ring-1 ring-navy/20"
                        : "bg-canvas text-muted ring-1 ring-border"
                    }`}
                  >
                    <span className="sr-only">Role: </span>
                    {row.roleLabel}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-body">
                  {row.joined}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Small, screen-readable summary line for the page header. */
export function TeamSummaryLine({ members }: { members: UserRow[] }) {
  const { total, admins } = summarizeTeam(members);
  const memberWord = total === 1 ? "person" : "people";
  const adminWord = admins === 1 ? "admin" : "admins";
  return (
    <span>
      {total} {memberWord} · {admins} {adminWord}
    </span>
  );
}
