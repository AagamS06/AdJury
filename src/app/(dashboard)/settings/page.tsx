import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import {
  industryLabel,
  planReviewAllowance,
  planTierLabel,
} from "@/lib/company/onboarding";
import { CompanySettingsForm } from "@/components/company/company-settings-form";
import { DangerZone } from "@/components/company/danger-zone";

/**
 * Company settings — admin only (DailyPlan Day 50): manage the company's plan
 * tier, jump to the brand profile, and see the (not-yet-wired) danger zone.
 *
 * Tenant-safe by construction (Rules.md §5): `requireAdmin()` gates the page
 * server-side (a member → `/dashboard`, an anonymous caller → `/login`), and the
 * company is taken from the server-resolved session — never the client. The save
 * (in the form's action) re-derives the caller with `requireAdmin()` and writes
 * tenant-scoped (Rules.md §5). The plan tier chosen here drives the per-plan
 * review rate limit (Day 17); name/industry/website are edited in onboarding
 * (Day 22) and the brand guide in its own surface (Day 26), both linked from here.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAdmin();
  const { company } = session;
  const industry = industryLabel(company.industry);

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Settings</h1>
      <p className="mt-2 max-w-2xl text-body">
        Manage how AdJury works for {company.name}.
      </p>

      {/* Company details (read-only summary; edited in onboarding) */}
      <section className="mt-8 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Company</h2>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">Company name</dt>
              <dd className="mt-0.5 font-medium text-body">{company.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Industry</dt>
              <dd className="mt-0.5 font-medium text-body">
                {industry ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Current plan</dt>
              <dd className="mt-0.5 font-medium text-body">
                {planTierLabel(company.plan_tier)}{" "}
                <span className="font-normal text-muted">
                  · {planReviewAllowance(company.plan_tier)} reviews/day
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Website</dt>
              <dd className="mt-0.5 truncate font-medium text-body">
                {company.website_url ?? "Not set"}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm text-muted">
            <Link
              href="/onboarding"
              className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              Edit company details
            </Link>
          </p>
        </div>
      </section>

      {/* Plan tier (the editable setting) */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Plan</h2>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <CompanySettingsForm planTier={company.plan_tier} />
        </div>
      </section>

      {/* Brand link */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Brand &amp; voice</h2>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <p className="max-w-xl text-sm text-body">
            Manage the tone &amp; style guide the Brand Voice Guardian juror
            reviews every submission against.
          </p>
          <Link
            href="/brand"
            className="shrink-0 rounded-sm border border-border px-3 py-1.5 text-sm font-semibold text-navy hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Brand profile
          </Link>
        </div>
      </section>

      {/* Danger zone (stubs) */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-danger">Danger zone</h2>
        <p className="mt-1 max-w-2xl text-sm text-body">
          Irreversible, destructive actions. These aren&apos;t available yet.
        </p>
        <div className="mt-4">
          <DangerZone />
        </div>
      </section>
    </div>
  );
}
