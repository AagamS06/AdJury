import type { UserRole } from "@/types/db";

/**
 * Route-access policy (DailyPlan Day 4 — role-based access).
 *
 * The single source of truth for "who may reach what". It is a pure module —
 * no Next.js, no Supabase, no I/O — so the decision table is exhaustively unit
 * tested (see tests/auth-access.test.ts) and reused by both layers that enforce
 * it: the middleware coarse gate (is there a session at all?) and the
 * server-side guards in `guard.ts` (session + admin role, resolved from the DB).
 *
 * Defense in depth: middleware redirects anonymous traffic away from protected
 * URLs early, and the dashboard layout / admin pages re-check server-side with
 * the real role. Neither trusts the client (Rules.md §5).
 */

/** URL prefixes that require an authenticated, provisioned session. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/review",
  "/history",
  "/brand",
  "/team",
  "/settings",
] as const;

/**
 * URL prefixes that additionally require the `admin` role. These are the
 * company-management surfaces — brand profile and team — that a `member` must
 * never reach (Rules.md §5: admin-only actions are enforced on the server).
 */
export const ADMIN_PREFIXES = ["/brand", "/team"] as const;

/** Auth pages a signed-in user should be bounced away from, back to the app. */
export const AUTH_PAGES = ["/login", "/signup"] as const;

/** Where an authenticated user lands: the dashboard home. */
export const DEFAULT_AUTHED_PATH = "/dashboard";
/** Where an unauthenticated user is sent to sign in. */
export const LOGIN_PATH = "/login";

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * The minimal slice of the session the policy needs: whether the caller is
 * signed in, and their role. Kept structural so tests don't build a whole
 * `SessionContext`.
 */
export interface AccessPrincipal {
  role: UserRole;
}

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      redirectTo: string;
      reason: "unauthenticated" | "forbidden";
    };

/**
 * Decide whether `principal` may access a resource, given whether admin is
 * required. `principal` is `null` for an unauthenticated (or not-yet-
 * provisioned) caller.
 *
 * - No principal            → redirect to login ("unauthenticated").
 * - Admin required, member  → redirect to the dashboard ("forbidden"); we don't
 *   404 or reveal the resource, just deny access.
 * - Otherwise               → allowed.
 */
export function evaluateAccess(
  principal: AccessPrincipal | null,
  opts: { requireAdmin?: boolean } = {},
): AccessDecision {
  if (!principal) {
    return {
      allowed: false,
      redirectTo: LOGIN_PATH,
      reason: "unauthenticated",
    };
  }
  if (opts.requireAdmin && principal.role !== "admin") {
    return {
      allowed: false,
      redirectTo: DEFAULT_AUTHED_PATH,
      reason: "forbidden",
    };
  }
  return { allowed: true };
}
