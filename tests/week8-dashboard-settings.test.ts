import { describe, it, expect, vi } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { updateCompanySettings } from "@/lib/company/update-settings";
import { CompanySettingsSchema, DANGER_ZONE_ACTIONS } from "@/lib/company/settings";
import { updateUserProfile } from "@/lib/user/update-profile";
import {
  displayNameOrFallback,
  normalizeDisplayName,
  resolveNotificationPrefs,
  notificationPrefsEqual,
  DEFAULT_NOTIFICATION_PREFS,
} from "@/lib/user/profile";
import { updateNotificationPreferences } from "@/lib/user/update-notifications";
import {
  buildDashboardMetrics,
  passRate,
  RECENT_REVIEWS_LIMIT,
} from "@/lib/reviews/dashboard-view";
import {
  toneLabel,
  toastRole,
  toastAriaLive,
  createToast,
  type ToastTone,
} from "@/lib/ui/toast";
import {
  NAV_ITEMS,
  navItemsForRole,
  navGroupsForRole,
  isNavItemActive,
  activeNavKey,
  type NavItem,
} from "@/lib/ui/nav";
import {
  auditContrast,
  CONTRAST_CHECKS,
  MAIN_CONTENT_ID,
  mainContentHref,
} from "@/lib/ui/a11y";

import type { SessionContext } from "@/lib/auth/session";
import type {
  CompanyAnalytics,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import type {
  CompanyRow,
  UserRow,
  NotificationPreferences,
  PlanTier,
  UserRole,
} from "@/types/db";

/**
 * Week 8 hardening (DailyPlan Day 56) — dashboard & settings integration.
 *
 * Week 8 shipped seven surfaces, each proved in isolation by its own per-day
 * suite: Day 50 (company settings — `company-settings.test`), Day 51 (user
 * settings — `user-profile` / `user-notifications` / `account-security` tests),
 * Day 52 (dashboard home — `dashboard-view.test`), Day 53 (notifications —
 * `toast.test`), Day 54 (navigation/IA — `nav.test`), and Day 55 (accessibility
 * pass 1 — `a11y.test`). Each of those loads only its own slice of the codebase
 * and proves its own invariant in isolation.
 *
 * This is the week-end integration complement (mirroring the Day 7/14/21/28/35/
 * 42/49 passes): NO new product surface — it wires the REAL Week-8 cores together
 * and proves the week's invariants COMPOSE across the whole dashboard/settings
 * surface, and that the surfaces AGREE with one another — properties no single-day
 * suite can see because each reads only its own slice:
 *
 *  1. The three Week-8 write cores share ONE authz/tenancy model: all fail closed
 *     on no session (401, no write), all scope every write to the SERVER-derived
 *     identity (a spoofed id in the input never reaches the DB), and all no-op
 *     idempotently when nothing changed — driven by one shared session. The one
 *     admin-only surface (company settings) and the two self-edits differ in
 *     exactly one dimension (role), and this proves that difference is deliberate
 *     and consistent, which no per-day suite checks (each tests one core).
 *  2. The display-name fallback is ONE rule shared by the profile core and the
 *     nav/account surface: a name saved through `updateUserProfile` round-trips to
 *     exactly what `displayNameOrFallback` then shows, and the no-op check,
 *     `normalizeDisplayName`, and the fallback all agree on the canonical form.
 *  3. The dashboard reuses the Day-31 analytics numbers rather than recomputing:
 *     its pass-rate tile equals `passRate(dist)` and its reviews tile equals
 *     `totalReviews`, and with no data every tile stays honest ("—"/null, never a
 *     fabricated 0 — Rules.md §6).
 *  4. Accessibility composes across the Day-53 toast, the Day-54 nav, and the
 *     Day-55 contrast audit: the WHOLE palette (incl. the deep tokens the toast
 *     and chips use) clears AA together, every toast tone carries a text label +
 *     ARIA role (never colour-only, Design.md §6), exactly one nav item is active
 *     per shell route (so `aria-current="page"` lands on one), and the skip-link
 *     landmark is one shared constant.
 *  5. The Day-54 nav IA agrees with the real routes on disk AND with the Day-50/51
 *     authz cores: every nav href has a page directory under `src/app/(dashboard)`,
 *     the `adminOnly` flag on `/settings` matches its write core's 403-for-member,
 *     and `/account` being visible to all matches its cores accepting a member —
 *     a cross-day agreement neither the nav suite nor the settings suites can see.
 *
 * All offline (no live model/DB/bundler): the cores are the trust boundary and the
 * pure view/UI logic is deterministic, so exercising them together is faithful.
 */

// ── shared identity ──────────────────────────────────────────────────────────

const COMPANY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-1111-1111-111111111111";
/** A foreign id a malicious client might try to smuggle in the form body. */
const FOREIGN_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function companyRow(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Acme",
    industry: "saas",
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-09-18T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function session(
  opts: {
    role?: UserRole;
    plan?: PlanTier;
    displayName?: string | null;
  } = {},
): SessionContext {
  return {
    authUserId: USER_ID,
    email: "user@acme.test",
    companyId: COMPANY_ID,
    role: opts.role ?? "admin",
    displayName: opts.displayName ?? null,
    company: companyRow({ plan_tier: opts.plan ?? "free" }),
  };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    company_id: COMPANY_ID,
    email: "user@acme.test",
    role: "member",
    display_name: null,
    created_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

const ALL_PLANS: PlanTier[] = ["free", "pro", "enterprise"];
const ALL_TONES: ToastTone[] = ["success", "error", "info"];

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 8 hardening — dashboard & settings integration", () => {
  // ── 1. one authz/tenancy model across the three write cores ────────────────
  describe("the three Week-8 write cores share one authz/tenancy model", () => {
    it("all fail closed on no session (401) without writing", async () => {
      const companyUpdate = vi.fn();
      const profileUpdate = vi.fn();
      const notifyUpdate = vi.fn();

      const results = await Promise.all([
        updateCompanySettings({
          session: null,
          input: { plan_tier: "pro" },
          update: companyUpdate,
        }),
        updateUserProfile({
          session: null,
          input: { display_name: "Nope" },
          update: profileUpdate,
        }),
        updateNotificationPreferences({
          session: null,
          input: { review_complete: false, weekly_digest: true, product_news: false },
          current: DEFAULT_NOTIFICATION_PREFS,
          update: notifyUpdate,
        }),
      ]);

      for (const r of results) expect(r).toMatchObject({ ok: false, status: 401 });
      expect(companyUpdate).not.toHaveBeenCalled();
      expect(profileUpdate).not.toHaveBeenCalled();
      expect(notifyUpdate).not.toHaveBeenCalled();
    });

    it("scope every write to the server-derived identity — a spoofed id in the input is ignored", async () => {
      const companyUpdate = vi.fn().mockResolvedValue(companyRow({ plan_tier: "pro" }));
      const profileUpdate = vi.fn().mockResolvedValue(userRow({ display_name: "Renamed" }));
      const notifyUpdate = vi.fn().mockResolvedValue(userRow());

      // Each input carries a hostile `company_id`/`user_id` the client controls.
      await updateCompanySettings({
        session: session({ role: "admin", plan: "free" }),
        input: { plan_tier: "pro", company_id: FOREIGN_ID } as never,
        update: companyUpdate,
      });
      await updateUserProfile({
        session: session({ role: "member", displayName: null }),
        input: { display_name: "Renamed", user_id: FOREIGN_ID, company_id: FOREIGN_ID } as never,
        update: profileUpdate,
      });
      await updateNotificationPreferences({
        session: session({ role: "member" }),
        input: {
          review_complete: false,
          weekly_digest: true,
          product_news: false,
          user_id: FOREIGN_ID,
        } as never,
        current: DEFAULT_NOTIFICATION_PREFS,
        update: notifyUpdate,
      });

      // Every write targets the SESSION's company/user — never the foreign id.
      expect(companyUpdate).toHaveBeenCalledWith({ companyId: COMPANY_ID, planTier: "pro" });
      expect(profileUpdate).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: USER_ID,
        displayName: "Renamed",
      });
      expect(notifyUpdate).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: USER_ID,
        prefs: { review_complete: false, weekly_digest: true, product_news: false },
      });
      // and the foreign id reached no write.
      for (const spy of [companyUpdate, profileUpdate, notifyUpdate]) {
        const arg = JSON.stringify(spy.mock.calls[0]?.[0] ?? {});
        expect(arg).not.toContain(FOREIGN_ID);
      }
    });

    it("all no-op idempotently when nothing changed (no pointless write)", async () => {
      const companyUpdate = vi.fn();
      const profileUpdate = vi.fn();
      const notifyUpdate = vi.fn();
      const currentPrefs: NotificationPreferences = {
        review_complete: true,
        weekly_digest: false,
        product_news: true,
      };

      const company = await updateCompanySettings({
        session: session({ role: "admin", plan: "pro" }),
        input: { plan_tier: "pro" },
        update: companyUpdate,
      });
      const profile = await updateUserProfile({
        session: session({ role: "member", displayName: "Sam" }),
        input: { display_name: "Sam" },
        update: profileUpdate,
      });
      const notify = await updateNotificationPreferences({
        session: session({ role: "member" }),
        input: currentPrefs,
        current: currentPrefs,
        update: notifyUpdate,
      });

      for (const r of [company, profile, notify]) {
        expect(r).toMatchObject({ ok: true, status: 200, changed: false });
      }
      expect(companyUpdate).not.toHaveBeenCalled();
      expect(profileUpdate).not.toHaveBeenCalled();
      expect(notifyUpdate).not.toHaveBeenCalled();
    });

    it("differ in exactly one dimension: company settings is admin-only (403 for a member), the two self-edits accept a member", async () => {
      // Admin-only surface: a member is rejected and nothing is written.
      const companyUpdate = vi.fn();
      const companyAsMember = await updateCompanySettings({
        session: session({ role: "member", plan: "free" }),
        input: { plan_tier: "pro" },
        update: companyUpdate,
      });
      expect(companyAsMember).toMatchObject({ ok: false, status: 403 });
      expect(companyUpdate).not.toHaveBeenCalled();

      // Self-edit surfaces: the same member CAN change their own profile + prefs.
      const profileUpdate = vi.fn().mockResolvedValue(userRow({ display_name: "Sam" }));
      const notifyUpdate = vi.fn().mockResolvedValue(userRow());
      const profileAsMember = await updateUserProfile({
        session: session({ role: "member", displayName: null }),
        input: { display_name: "Sam" },
        update: profileUpdate,
      });
      const notifyAsMember = await updateNotificationPreferences({
        session: session({ role: "member" }),
        input: { review_complete: false, weekly_digest: false, product_news: false },
        current: DEFAULT_NOTIFICATION_PREFS,
        update: notifyUpdate,
      });
      expect(profileAsMember).toMatchObject({ ok: true, changed: true });
      expect(notifyAsMember).toMatchObject({ ok: true, changed: true });
      expect(profileUpdate).toHaveBeenCalledTimes(1);
      expect(notifyUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2. the display-name fallback is one shared rule ────────────────────────
  describe("display-name fallback is one rule shared by the profile core and the nav/account surface", () => {
    it("a name saved through the profile core round-trips to exactly what displayNameOrFallback shows", async () => {
      // Save "  Dana Lee  " — the schema trims, the core normalizes, and the
      // persisted row then renders through the SAME helper the nav/account uses.
      const update = vi.fn(async ({ displayName }) =>
        userRow({ display_name: displayName }),
      );
      const result = await updateUserProfile({
        session: session({ role: "member", displayName: null }),
        input: { display_name: "  Dana Lee  " },
        update,
      });
      expect(result).toMatchObject({ ok: true, changed: true });
      expect(update).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: USER_ID,
        displayName: "Dana Lee",
      });
      if (result.ok) {
        expect(displayNameOrFallback(result.user)).toBe("Dana Lee");
      }
    });

    it("clearing the name falls back to the email, consistently across normalize + fallback", async () => {
      const update = vi.fn(async ({ displayName }) =>
        userRow({ display_name: displayName }),
      );
      const result = await updateUserProfile({
        // Had a name; submitting blank clears it.
        session: session({ role: "member", displayName: "Old Name" }),
        input: { display_name: "   " },
        update,
      });
      expect(result).toMatchObject({ ok: true, changed: true });
      // normalize agrees: blank → null.
      expect(normalizeDisplayName("   ")).toBeNull();
      expect(update).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        userId: USER_ID,
        displayName: null,
      });
      if (result.ok) {
        // The fallback shows the email once the name is cleared.
        expect(displayNameOrFallback(result.user)).toBe("user@acme.test");
      }
    });

    it("the no-op check uses the same canonical form as what the fallback renders", async () => {
      // Session already shows "Dana Lee"; resubmitting the same (untrimmed) value
      // normalizes to the same canonical name, so it's a no-op — proving the
      // core's idempotency and the fallback agree on one canonical form.
      const update = vi.fn();
      const result = await updateUserProfile({
        session: session({ role: "member", displayName: "Dana Lee" }),
        input: { display_name: "Dana Lee" },
        update,
      });
      expect(result).toMatchObject({ ok: true, changed: false });
      expect(update).not.toHaveBeenCalled();
      expect(displayNameOrFallback(userRow({ display_name: "Dana Lee" }))).toBe("Dana Lee");
    });
  });

  // ── 3. the dashboard reuses the analytics numbers, honestly ────────────────
  describe("dashboard metrics reuse the Day-31 analytics numbers and stay honest", () => {
    function dist(pass: number, revise: number, fail: number): VerdictDistribution {
      return { pass, revise, fail, total: pass + revise + fail };
    }
    function analytics(overrides: Partial<CompanyAnalytics> = {}): CompanyAnalytics {
      return {
        granularity: "day",
        totalReviews: 0,
        overallAverageScore: null,
        verdictDistribution: dist(0, 0, 0),
        scoreTrend: [],
        verdictTrend: [],
        jurorTrends: [],
        ...overrides,
      };
    }

    it("with no data every tile stays honest — '—'/null, never a fabricated 0", () => {
      const metrics = buildDashboardMetrics(analytics());
      const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
      expect(byKey["reviews"].value).toBe("0");
      expect(byKey["average-score"].value).toBe("—");
      expect(byKey["average-score"].suffix).toBeUndefined();
      // Pass rate with no verdicts reads "—", not 0% (Rules.md §6).
      expect(byKey["pass-rate"].value).toBe("—");
      expect(passRate(dist(0, 0, 0))).toBeNull();
    });

    it("the pass-rate and reviews tiles equal the analytics numbers (no second computation)", () => {
      const a = analytics({
        totalReviews: 8,
        overallAverageScore: 7.4,
        verdictDistribution: dist(3, 1, 0),
      });
      const metrics = buildDashboardMetrics(a);
      const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
      expect(byKey["reviews"].value).toBe(String(a.totalReviews));
      // The tile is exactly passRate(dist) — the dashboard does not recompute.
      expect(byKey["pass-rate"].value).toBe(String(passRate(a.verdictDistribution)));
      expect(byKey["pass-rate"].value).toBe("75");
      expect(byKey["average-score"].value).toBe("7.4");
    });

    it("surfaces a bounded number of recent reviews before linking to full history", () => {
      expect(RECENT_REVIEWS_LIMIT).toBeGreaterThan(0);
      expect(RECENT_REVIEWS_LIMIT).toBeLessThanOrEqual(10);
    });
  });

  // ── 4. accessibility composes across toast + nav + contrast ────────────────
  describe("accessibility composes across the Day-53 toast, Day-54 nav, and Day-55 contrast audit", () => {
    it("the whole palette clears WCAG AA together (incl. the deep tokens the toast/chips use)", () => {
      const audit = auditContrast();
      expect(CONTRAST_CHECKS.length).toBeGreaterThan(10);
      expect(audit.failures, JSON.stringify(audit.failures)).toHaveLength(0);
      expect(audit.passes).toBe(true);
    });

    it("every toast tone carries a text label and an ARIA role (never colour-only, Design.md §6)", () => {
      for (const tone of ALL_TONES) {
        expect(toneLabel(tone).trim().length).toBeGreaterThan(0);
        expect(["alert", "status"]).toContain(toastRole(tone));
        expect(["assertive", "polite"]).toContain(toastAriaLive(tone));
        // A raised toast always keeps a non-empty title even if blank is passed.
        const toast = createToast({ tone, title: "" }, { id: () => "t", now: () => 0 });
        expect(toast.title.length).toBeGreaterThan(0);
      }
      // The error tone announces assertively; the others politely — meaning is in
      // the role, not the colour.
      expect(toastRole("error")).toBe("alert");
      expect(toastAriaLive("error")).toBe("assertive");
    });

    it("exactly one nav item is active per shell route (so aria-current lands on one)", () => {
      const routes = [
        "/dashboard",
        "/review",
        "/review/abc-123",
        "/history",
        "/analytics",
        "/brand",
        "/team",
        "/settings",
        "/account",
      ];
      for (const route of routes) {
        const active = NAV_ITEMS.filter((item) => isNavItemActive(item, route));
        expect(active, `${route} lit ${active.length} items`).toHaveLength(1);
      }
      // A saved review lights History, never the sibling "New review".
      expect(activeNavKey(NAV_ITEMS, "/review/abc-123")).toBe("history");
      expect(activeNavKey(NAV_ITEMS, "/review")).toBe("review");
    });

    it("the skip-link landmark is one shared constant the nav shell and every <main> use", () => {
      expect(MAIN_CONTENT_ID.length).toBeGreaterThan(0);
      expect(mainContentHref()).toBe(`#${MAIN_CONTENT_ID}`);
    });
  });

  // ── 5. the nav IA agrees with the real routes AND the authz cores ──────────
  describe("the Day-54 nav IA agrees with the real routes on disk and the Day-50/51 authz cores", () => {
    const dashboardDir = fileURLToPath(
      new URL("../src/app/(dashboard)", import.meta.url),
    );
    const routeDirs = new Set(
      readdirSync(dashboardDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => existsSync(`${dashboardDir}/${name}/page.tsx`)),
    );

    it("loaded a non-trivial route snapshot (so the agreement means something)", () => {
      expect(routeDirs.size).toBeGreaterThan(4);
    });

    it("every nav href points at a real page directory under src/app/(dashboard)", () => {
      for (const item of NAV_ITEMS) {
        const dir = item.href.replace(/^\//, "");
        expect(routeDirs.has(dir), `${item.href} has no page.tsx`).toBe(true);
      }
    });

    it("the nav's adminOnly flags match the authz cores: /settings is admin-gated, /account is open to all", async () => {
      const settingsItem = NAV_ITEMS.find((i) => i.href === "/settings") as NavItem;
      const accountItem = NAV_ITEMS.find((i) => i.href === "/account") as NavItem;
      expect(settingsItem.adminOnly).toBe(true);
      expect(accountItem.adminOnly).toBeFalsy();

      // Nav says /settings is admin-only → the settings write core agrees (403).
      const settingsAsMember = await updateCompanySettings({
        session: session({ role: "member", plan: "free" }),
        input: { plan_tier: "pro" },
        update: vi.fn(),
      });
      expect(settingsAsMember).toMatchObject({ ok: false, status: 403 });

      // Nav says /account is open to all → the account cores accept a member.
      const accountAsMember = await updateUserProfile({
        session: session({ role: "member", displayName: null }),
        input: { display_name: "Sam" },
        update: vi.fn().mockResolvedValue(userRow({ display_name: "Sam" })),
      });
      expect(accountAsMember.ok).toBe(true);
    });

    it("a member's nav never includes an admin-only item and drops the empty Manage group", () => {
      const memberItems = navItemsForRole("member");
      expect(memberItems.some((i) => i.adminOnly)).toBe(false);
      const memberGroups = navGroupsForRole("member");
      expect(memberGroups.some((g) => g.section === "manage")).toBe(false);

      // An admin sees the Manage group with every admin-only surface.
      const adminGroups = navGroupsForRole("admin");
      const manage = adminGroups.find((g) => g.section === "manage");
      expect(manage?.items.map((i) => i.href).sort()).toEqual(
        ["/brand", "/settings", "/team"].sort(),
      );
    });
  });

  // ── a sanity check on the danger-zone scaffold the settings page renders ───
  it("the company-settings schema + danger-zone catalogue remain well-formed", () => {
    for (const plan of ALL_PLANS) {
      expect(CompanySettingsSchema.safeParse({ plan_tier: plan }).success).toBe(true);
    }
    expect(CompanySettingsSchema.safeParse({ plan_tier: "platinum" }).success).toBe(false);
    expect(DANGER_ZONE_ACTIONS.length).toBeGreaterThan(0);
    const keys = DANGER_ZONE_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ── notification-preference defaults resolve consistently ──────────────────
  it("notification preferences resolve to the documented defaults and compare by value", () => {
    // A pre-migration row (no notify_* columns) resolves to the defaults.
    const resolved = resolveNotificationPrefs(userRow());
    expect(resolved).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(notificationPrefsEqual(resolved, DEFAULT_NOTIFICATION_PREFS)).toBe(true);
    expect(
      notificationPrefsEqual(resolved, { ...DEFAULT_NOTIFICATION_PREFS, weekly_digest: true }),
    ).toBe(false);
  });
});
