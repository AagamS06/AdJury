import { requireAdmin } from "@/lib/auth/guard";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import {
  brandProfileUpdatedAt,
  hasBrandProfile,
  toneGuideText,
} from "@/lib/company/brand-profile";
import { getBrandProfileByCompany } from "@/lib/db/queries";
import { BrandProfileForm } from "@/components/company/brand-profile-form";
import type { BrandProfileRow } from "@/types/db";

/**
 * Brand profile — admin only (DailyPlan Day 26): create/edit the company's
 * tone/style guide that Juror 1 (Brand Voice Guardian) reviews content against.
 *
 * Tenant-safe by construction (Rules.md §5): `requireAdmin()` gates the page
 * server-side (a member → `/dashboard`, an anonymous caller → `/login`), and the
 * company is taken from the server-resolved session — never the client — and
 * passed explicitly to `getBrandProfileByCompany`. The read goes through the
 * request-scoped client so RLS (`brand_profiles_select`) is the primary tenancy
 * guard, mirroring the Day 23 team page; the write (in the form's action) is
 * likewise RLS-gated to admins. A load failure surfaces a plain-language message
 * rather than crashing (Rules.md §6).
 */
export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const session = await requireAdmin();

  let profile: BrandProfileRow | null = null;
  let loadError = false;
  try {
    const db = await createServerSupabase();
    profile = await getBrandProfileByCompany(db, session.companyId);
  } catch (err) {
    console.error("brand profile load failed", {
      op: "BrandPage",
      companyId: session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    loadError = true;
  }

  const configured = hasBrandProfile(profile);
  const updatedAt = brandProfileUpdatedAt(profile);

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Brand profile</h1>
      <p className="mt-2 max-w-2xl text-body">
        Manage {session.company.name}&apos;s tone &amp; style guide. Juror 1 (the
        Brand Voice Guardian) reviews every submission against it.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            configured
              ? "bg-success/10 text-success"
              : "bg-canvas text-muted"
          }`}
        >
          {configured ? "Guide set" : "Not set yet"}
        </span>
        {configured && updatedAt && (
          <span className="text-muted">Last updated {updatedAt}</span>
        )}
      </div>

      <div className="mt-8 max-w-3xl rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        {loadError ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            We couldn&apos;t load your brand profile. Please refresh and try
            again.
          </p>
        ) : (
          <BrandProfileForm initialText={toneGuideText(profile)} />
        )}
      </div>
    </div>
  );
}
