import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session-refresh middleware (Day 3 — auth foundation).
 *
 * Supabase access tokens are short-lived; this refreshes them on every request
 * and writes the rotated cookies back so a signed-in session PERSISTS across
 * navigations and server renders. It only refreshes — route protection
 * (redirecting unauthenticated users, gating the dashboard) lands in Day 4.
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

  // Touch the auth state to trigger a token refresh when needed. Do not gate on
  // the result here (that is Day 4); just let the refreshed cookies flow back.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on all routes except static assets and image optimization files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
