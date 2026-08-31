import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_AUTHED_PATH,
  LOGIN_PATH,
  isAuthPage,
  isProtectedPath,
} from "@/lib/auth/access";

/**
 * Session-refresh + coarse route-gate middleware (Day 3 refresh, Day 4 gate).
 *
 * Two jobs:
 *  1. Refresh short-lived Supabase access tokens on every request and write the
 *     rotated cookies back so a signed-in session PERSISTS across navigations.
 *  2. Coarse route protection: bounce anonymous traffic away from protected
 *     URLs to `/login`, and signed-in users away from the auth pages back to
 *     the app. This is the first line only — role checks (admin-only brand /
 *     team routes) are enforced server-side in the page guards (`guard.ts`),
 *     since the role lives in the DB, not the token. Neither layer trusts the
 *     client (Rules.md §5).
 *
 * If the public Supabase env vars are absent (e.g. this cloud build with no
 * secrets), skip silently so the app still renders; auth simply won't be wired
 * until real keys are provided.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Resolve the auth user (this also triggers the token refresh). We gate on
  // presence only; the authoritative provisioned-session + role checks run in
  // the server components.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    return redirectPreservingCookies(request, response, LOGIN_PATH);
  }

  if (user && isAuthPage(pathname)) {
    return redirectPreservingCookies(request, response, DEFAULT_AUTHED_PATH);
  }

  return response;
}

/**
 * Build a redirect to `pathname` while carrying over any refreshed auth cookies
 * that were set on `response`, so a token rotation isn't lost on the redirect.
 */
function redirectPreservingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  const redirectResponse = NextResponse.redirect(target);
  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  return redirectResponse;
}

export const config = {
  // Run on all routes except static assets and image optimization files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
