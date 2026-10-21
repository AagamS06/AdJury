import { describe, it, expect } from "vitest";
import {
  NAV_ITEMS,
  NAV_SECTION_ORDER,
  NAV_SECTION_LABELS,
  activeNavKey,
  isNavItemActive,
  navGroupsForRole,
  navItemsForRole,
  normalizePathname,
  type NavItem,
  type NavSection,
} from "@/lib/ui/nav";
import type { UserRole } from "@/types/db";

/**
 * Primary navigation model (DailyPlan Day 54, nav/IA cleanup). These pin the
 * *logic* the dashboard nav island renders — which items a role sees, how they
 * group, and which item the current path lights up — so the "coherent
 * navigation across all pages" DoD is proven rather than eyeballed. The island
 * (`components/ui/primary-nav.tsx`) is a thin `usePathname` + render wrapper with
 * no DOM-free unit, mirroring the untested toast/copy islands.
 */

const ALL_SECTIONS: NavSection[] = ["workspace", "manage", "account"];

/** Every route in the authenticated shell, for an exhaustive active-state sweep. */
const SHELL_PATHS = [
  "/dashboard",
  "/review",
  "/history",
  "/analytics",
  "/brand",
  "/team",
  "/settings",
  "/account",
  "/review/abc-123", // a saved-review detail page
];

describe("inventory integrity", () => {
  it("has unique keys and unique hrefs", () => {
    const keys = NAV_ITEMS.map((i) => i.key);
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every item a non-empty label, an absolute href, and a known section", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href.endsWith("/")).toBe(false); // hrefs carry no trailing slash
      expect(ALL_SECTIONS).toContain(item.section);
    }
  });

  it("writes every active prefix as a directory (trailing slash)", () => {
    for (const item of NAV_ITEMS) {
      for (const prefix of item.activePrefixes ?? []) {
        expect(prefix.endsWith("/")).toBe(true);
      }
    }
  });

  it("labels every section in the order list", () => {
    for (const section of NAV_SECTION_ORDER) {
      expect(NAV_SECTION_LABELS[section].trim().length).toBeGreaterThan(0);
    }
    expect([...NAV_SECTION_ORDER].sort()).toEqual([...ALL_SECTIONS].sort());
  });
});

describe("role filtering", () => {
  it("shows admins every item", () => {
    expect(navItemsForRole("admin")).toHaveLength(NAV_ITEMS.length);
  });

  it("hides admin-only items from members", () => {
    const memberItems = navItemsForRole("member");
    const adminOnlyKeys = NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.key);
    expect(adminOnlyKeys.length).toBeGreaterThan(0); // guard: the test means something
    for (const item of memberItems) {
      expect(item.adminOnly).not.toBe(true);
    }
    // Specifically the management surfaces are gone for a member.
    const memberKeys = memberItems.map((i) => i.key);
    for (const key of ["brand", "team", "settings"]) {
      expect(memberKeys).not.toContain(key);
    }
    // ...but the everyday workspace + account links remain.
    for (const key of ["dashboard", "review", "history", "analytics", "account"]) {
      expect(memberKeys).toContain(key);
    }
  });
});

describe("section grouping", () => {
  it("groups an admin's items into workspace → manage → account in order", () => {
    const groups = navGroupsForRole("admin");
    expect(groups.map((g) => g.section)).toEqual([
      "workspace",
      "manage",
      "account",
    ]);
    const manage = groups.find((g) => g.section === "manage");
    expect(manage?.items.map((i) => i.key)).toEqual(["brand", "team", "settings"]);
  });

  it("omits the empty manage group for a member (no stray divider)", () => {
    const groups = navGroupsForRole("member");
    expect(groups.map((g) => g.section)).toEqual(["workspace", "account"]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("every grouped item actually belongs to its section", () => {
    for (const role of ["admin", "member"] as UserRole[]) {
      for (const group of navGroupsForRole(role)) {
        expect(group.label).toBe(NAV_SECTION_LABELS[group.section]);
        for (const item of group.items) {
          expect(item.section).toBe(group.section);
        }
      }
    }
  });
});

describe("normalizePathname", () => {
  it("drops a query string and hash", () => {
    expect(normalizePathname("/history?tab=all")).toBe("/history");
    expect(normalizePathname("/analytics#top")).toBe("/analytics");
  });

  it("strips a trailing slash but keeps the root", () => {
    expect(normalizePathname("/history/")).toBe("/history");
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("")).toBe("/");
  });
});

describe("active-route resolution", () => {
  const byKey = (key: string): NavItem => {
    const item = NAV_ITEMS.find((i) => i.key === key);
    if (!item) throw new Error(`no nav item ${key}`);
    return item;
  };

  it("lights the exact page for each top-level route", () => {
    expect(isNavItemActive(byKey("dashboard"), "/dashboard")).toBe(true);
    expect(isNavItemActive(byKey("history"), "/history")).toBe(true);
    expect(isNavItemActive(byKey("analytics"), "/analytics")).toBe(true);
    expect(isNavItemActive(byKey("account"), "/account")).toBe(true);
  });

  it("lights History (not New review) on a saved-review detail page", () => {
    const path = "/review/abc-123";
    expect(isNavItemActive(byKey("history"), path)).toBe(true);
    expect(isNavItemActive(byKey("review"), path)).toBe(false);
  });

  it("lights New review only on the exact submit route", () => {
    expect(isNavItemActive(byKey("review"), "/review")).toBe(true);
    expect(isNavItemActive(byKey("review"), "/review/")).toBe(true); // normalised
    expect(isNavItemActive(byKey("review"), "/review/abc")).toBe(false);
  });

  it("ignores query/hash when matching", () => {
    expect(isNavItemActive(byKey("history"), "/history?filter=pass")).toBe(true);
    expect(isNavItemActive(byKey("analytics"), "/analytics#chart")).toBe(true);
  });

  it("does not false-match a sibling with a shared name prefix", () => {
    // `/analytics-export` must not light `/analytics`.
    expect(isNavItemActive(byKey("analytics"), "/analytics-export")).toBe(false);
    expect(isNavItemActive(byKey("review"), "/reviewer")).toBe(false);
  });

  it("lights exactly one item for every real shell path", () => {
    const items = navItemsForRole("admin");
    for (const path of SHELL_PATHS) {
      const active = items.filter((item) => isNavItemActive(item, path));
      expect(active, `path ${path} should light exactly one nav item`).toHaveLength(1);
    }
  });

  it("maps each shell path to the expected item via activeNavKey", () => {
    const items = navItemsForRole("admin");
    const expected: Record<string, string> = {
      "/dashboard": "dashboard",
      "/review": "review",
      "/history": "history",
      "/analytics": "analytics",
      "/brand": "brand",
      "/team": "team",
      "/settings": "settings",
      "/account": "account",
      "/review/abc-123": "history",
    };
    for (const [path, key] of Object.entries(expected)) {
      expect(activeNavKey(items, path)).toBe(key);
    }
  });

  it("returns null for a path outside the nav (e.g. onboarding)", () => {
    expect(activeNavKey(navItemsForRole("admin"), "/onboarding")).toBeNull();
    expect(activeNavKey(navItemsForRole("admin"), "/invite/tok")).toBeNull();
  });

  it("never lights an admin-only item for a member, even on its path", () => {
    // A member who somehow lands on /brand sees no nav item lit (the page itself
    // still enforces the role server-side).
    expect(activeNavKey(navItemsForRole("member"), "/brand")).toBeNull();
  });
});
