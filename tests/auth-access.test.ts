import { describe, it, expect } from "vitest";
import {
  evaluateAccess,
  isAdminPath,
  isAuthPage,
  isProtectedPath,
  DEFAULT_AUTHED_PATH,
  LOGIN_PATH,
} from "@/lib/auth/access";
import type { AccessPrincipal } from "@/lib/auth/access";

/**
 * Route-access policy tests (DailyPlan Day 4 — role-based access).
 *
 * The pure decision table behind both the middleware coarse gate and the
 * server-side guards. Proves the two guarantees the DoD calls out:
 *   • an unauthenticated caller is redirected to login, and
 *   • a member cannot reach an admin-only route.
 */
const ADMIN: AccessPrincipal = { role: "admin" };
const MEMBER: AccessPrincipal = { role: "member" };

describe("evaluateAccess", () => {
  it("redirects an unauthenticated caller to login", () => {
    const decision = evaluateAccess(null);
    expect(decision).toEqual({
      allowed: false,
      redirectTo: LOGIN_PATH,
      reason: "unauthenticated",
    });
  });

  it("redirects an unauthenticated caller to login even on admin routes", () => {
    const decision = evaluateAccess(null, { requireAdmin: true });
    expect(decision).toEqual({
      allowed: false,
      redirectTo: LOGIN_PATH,
      reason: "unauthenticated",
    });
  });

  it("allows any signed-in user on a non-admin route", () => {
    expect(evaluateAccess(MEMBER)).toEqual({ allowed: true });
    expect(evaluateAccess(ADMIN)).toEqual({ allowed: true });
  });

  it("denies a member on an admin-only route (redirect to dashboard, not login)", () => {
    const decision = evaluateAccess(MEMBER, { requireAdmin: true });
    expect(decision).toEqual({
      allowed: false,
      redirectTo: DEFAULT_AUTHED_PATH,
      reason: "forbidden",
    });
  });

  it("allows an admin on an admin-only route", () => {
    expect(evaluateAccess(ADMIN, { requireAdmin: true })).toEqual({
      allowed: true,
    });
  });
});

describe("path matchers", () => {
  it("treats dashboard surfaces as protected", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/anything",
      "/review",
      "/history",
      "/brand",
      "/team",
      "/settings",
    ]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it("leaves public routes unprotected", () => {
    for (const path of ["/", "/login", "/signup", "/about"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("flags only brand and team as admin paths", () => {
    expect(isAdminPath("/brand")).toBe(true);
    expect(isAdminPath("/brand/edit")).toBe(true);
    expect(isAdminPath("/team")).toBe(true);
    expect(isAdminPath("/dashboard")).toBe(false);
    expect(isAdminPath("/history")).toBe(false);
  });

  it("does not match a prefix as a substring of another segment", () => {
    // `/teams-directory` must not be treated as the `/team` admin route.
    expect(isAdminPath("/teams-directory")).toBe(false);
    expect(isProtectedPath("/brandish")).toBe(false);
  });

  it("recognises the auth pages", () => {
    expect(isAuthPage("/login")).toBe(true);
    expect(isAuthPage("/signup")).toBe(true);
    expect(isAuthPage("/dashboard")).toBe(false);
  });
});
