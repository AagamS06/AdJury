/**
 * Primary navigation model — pure logic core (DailyPlan Day 54, nav/IA cleanup).
 *
 * The dashboard shell's top navigation used to be a flat, undifferentiated row
 * of links that gave no indication of *where you are* and mixed the everyday
 * review workflow in with the admin-only company-management surfaces. This module
 * owns the navigation's information architecture so it is unit-testable in the
 * node env with no DOM, mirroring the project's "pure core + thin client island"
 * pattern (cf. `toast.ts` / `components/ui/toast.tsx`, `scorecard-view.ts`): the
 * client island in `components/ui/primary-nav.tsx` only reads the current path
 * and renders.
 *
 * Two responsibilities live here:
 *  1. **Structure** — the canonical `NAV_ITEMS` inventory, grouped into coherent
 *     sections (the review *workspace*, admin-only *manage*, and the personal
 *     *account*) and filtered by role so a member never sees an admin link.
 *  2. **Active-route resolution** — `isNavItemActive` decides which item the
 *     current pathname lights up, so every page in the shell shows the user
 *     where they are (announced to assistive tech via `aria-current`, never by
 *     colour alone — Design.md §6). A detail route can light its conceptual
 *     parent (a saved review under `/review/<id>` highlights History) without
 *     also lighting the sibling that owns its path prefix (`/review`, the
 *     new-review form).
 */

import type { UserRole } from "@/types/db";

/** The coherent groupings the nav is organised into, in display order. */
export type NavSection = "workspace" | "manage" | "account";

export interface NavItem {
  /** Stable key for React lists and tests. */
  key: string;
  /** Visible label. */
  label: string;
  /** Destination path (no trailing slash). */
  href: string;
  /** Which section this item belongs to. */
  section: NavSection;
  /** Admin-only surfaces are hidden from members in the nav (the page itself
   *  still enforces the role server-side — defence in depth). */
  adminOnly?: boolean;
  /**
   * Extra **directory** prefixes (always written with a trailing `/`) whose
   * descendants also mark this item active — so a leaf detail route lights its
   * conceptual parent in the nav. A prefix matches `/<dir>/<child>` but **not**
   * the bare `/<dir>` path itself, so it never collides with a sibling item
   * that owns that exact path.
   */
  activePrefixes?: string[];
  /**
   * Only an exact pathname match is active (descendant paths excluded). Used by
   * a route like `/review` whose children (`/review/<id>`) belong to a different
   * item (History), so viewing a saved review must not light "New review".
   */
  exact?: boolean;
}

/**
 * The canonical navigation inventory. Order within a section is the display
 * order; `NAV_SECTION_ORDER` orders the sections themselves.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", section: "workspace" },
  {
    key: "review",
    label: "New review",
    href: "/review",
    section: "workspace",
    // `/review/<id>` is a saved-review detail page, not the submit form, so it
    // must not light this item — History claims it below.
    exact: true,
  },
  {
    key: "history",
    label: "History",
    href: "/history",
    section: "workspace",
    // A saved review's detail page belongs to History in the IA.
    activePrefixes: ["/review/"],
  },
  { key: "analytics", label: "Analytics", href: "/analytics", section: "workspace" },
  { key: "brand", label: "Brand", href: "/brand", section: "manage", adminOnly: true },
  { key: "team", label: "Team", href: "/team", section: "manage", adminOnly: true },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    section: "manage",
    adminOnly: true,
  },
  { key: "account", label: "Account", href: "/account", section: "account" },
];

/** The sections in display order. */
export const NAV_SECTION_ORDER: readonly NavSection[] = [
  "workspace",
  "manage",
  "account",
];

/** Human group labels (used as an accessible name for each nav sub-group). */
export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  workspace: "Workspace",
  manage: "Manage",
  account: "Account",
};

/** A nav section resolved for a specific role, with its items. */
export interface NavGroup {
  section: NavSection;
  label: string;
  items: NavItem[];
}

/** The flat list of items a given role may see (admin-only items dropped for members). */
export function navItemsForRole(role: UserRole): NavItem[] {
  const isAdmin = role === "admin";
  return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
}

/**
 * The role's items grouped into sections in display order. Empty sections (e.g.
 * "manage" for a member, who sees no admin links) are omitted so the nav never
 * renders an empty group or a stray divider.
 */
export function navGroupsForRole(role: UserRole): NavGroup[] {
  const items = navItemsForRole(role);
  return NAV_SECTION_ORDER.map((section) => ({
    section,
    label: NAV_SECTION_LABELS[section],
    items: items.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);
}

/**
 * Normalise a pathname for matching: drop any query/hash and a trailing slash
 * (except the root), so `/history/` and `/history?tab=x` both match `/history`.
 */
export function normalizePathname(pathname: string): string {
  const path = (pathname || "/").split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) {
    return path.replace(/\/+$/, "") || "/";
  }
  return path || "/";
}

/** True when `path` is `base` itself or a descendant segment of it. */
function isAtOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Whether a nav item should read as the active page for the current pathname.
 *
 * - An `exact` item matches only its own path (descendants excluded).
 * - Otherwise the item matches its path and any descendant of it.
 * - `activePrefixes` additionally match strict descendants of a directory (a
 *   detail route lighting its conceptual parent), never the bare prefix path.
 *
 * With the inventory above these rules never light two items for one path.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (path === item.href) return true;
  if (!item.exact && isAtOrUnder(path, item.href)) return true;
  if (item.activePrefixes) {
    for (const prefix of item.activePrefixes) {
      // `prefix` ends in `/`, so this matches descendants only, not the bare path.
      if (path.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * The key of the first nav item (in `NAV_ITEMS` order) that is active for the
 * given pathname, or `null` when the path maps to no nav item (e.g. a route
 * outside the shell). Handy for tests and for a single source of "where am I".
 */
export function activeNavKey(items: readonly NavItem[], pathname: string): string | null {
  for (const item of items) {
    if (isNavItemActive(item, pathname)) return item.key;
  }
  return null;
}
