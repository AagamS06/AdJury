import { redirect } from "next/navigation";
import { evaluateAccess, LOGIN_PATH } from "./access";
import { getSessionContext, type SessionContext } from "./session";

/**
 * Server-side route guards (DailyPlan Day 4 — role-based access).
 *
 * Call these at the top of a protected Server Component / layout. They resolve
 * the real session + role from the server (never the client — Rules.md §5),
 * apply the pure `evaluateAccess` policy, and `redirect()` when access is
 * denied. When they return, the session is guaranteed present (and admin, for
 * `requireAdmin`), so the caller can use it directly.
 *
 * `getSessionContext()` can throw if Supabase env vars are absent (e.g. the
 * cloud build with no secrets); we treat that as "no session" and send the
 * caller to log in, so protected pages fail closed rather than crash
 * (Rules.md §6 — fail closed on anything touching authz).
 */
async function loadSession(): Promise<SessionContext | null> {
  try {
    return await getSessionContext();
  } catch {
    return null;
  }
}

/**
 * Require any authenticated, provisioned user. Redirects to `/login` otherwise.
 * Returns the resolved session for the caller to use.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await loadSession();
  const decision = evaluateAccess(session);
  if (!decision.allowed) redirect(decision.redirectTo);
  // A permitted decision implies a session exists; this re-narrows for the
  // type checker (and can never actually fire).
  if (!session) redirect(LOGIN_PATH);
  return session;
}

/**
 * Require an authenticated user with the `admin` role. A member is redirected
 * to the dashboard (not shown the resource); an anonymous caller to `/login`.
 */
export async function requireAdmin(): Promise<SessionContext> {
  const session = await loadSession();
  const decision = evaluateAccess(session, { requireAdmin: true });
  if (!decision.allowed) redirect(decision.redirectTo);
  if (!session) redirect(LOGIN_PATH);
  return session;
}
