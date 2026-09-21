import {
  toInvitationList,
  type InvitationState,
} from "@/lib/company/invitations";
import type { InvitationRow } from "@/types/db";

/**
 * InvitationList (DailyPlan Day 24, Design.md §5 "Tables/history"): the company's
 * invitations as a quiet, bordered table — email, role, status, sent + expiry
 * dates — actionable ones first. A pure, hook-free presentational component
 * rendering the company-scoped `InvitationRow[]` the server page already loaded
 * (tenant-safe by construction). Ordering/labels live in `invitations.ts`;
 * colour never travels alone (Design.md §6): every status badge carries its word.
 */
const STATE_BADGE: Record<InvitationState, string> = {
  pending: "bg-royal/10 text-royal ring-1 ring-royal/30",
  expired: "bg-warning/10 text-warning ring-1 ring-warning/30",
  accepted: "bg-success/10 text-success ring-1 ring-success/30",
  revoked: "bg-canvas text-muted ring-1 ring-border",
};

export function InvitationList({ invitations }: { invitations: InvitationRow[] }) {
  if (invitations.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center">
        <h3 className="text-base font-semibold text-navy">No invitations yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Invite a teammate above and their pending invite will show here.
        </p>
      </div>
    );
  }

  const rows = toInvitationList(invitations);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Invitations sent to join your company, with their status.
          </caption>
          <thead>
            <tr className="border-b border-border bg-canvas text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Role
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Sent
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Expires
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
                </td>
                <td className="px-4 py-3 text-body">{row.roleLabel}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_BADGE[row.state]}`}
                  >
                    <span className="sr-only">Status: </span>
                    {row.stateLabel}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-body">
                  {row.invited}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-body">
                  {row.expires}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
