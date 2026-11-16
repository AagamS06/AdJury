/**
 * Auth route-group layout — centers the login/signup cards on the app canvas.
 * The route group `(auth)` keeps these pages out of the dashboard chrome added
 * later without adding a URL segment (routes stay `/login`, `/signup`).
 */
import type { Metadata } from "next";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";
import { NOINDEX_ROBOTS } from "@/lib/seo/metadata";

/**
 * The auth screens are public (reachable signed-out) but must never be indexed —
 * a login/signup form has no place in search results (DailyPlan Day 80). The
 * robots directive is set on the group layout so it covers both the `/login` and
 * `/signup` client pages, which cannot export `metadata` themselves.
 */
export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12"
    >
      {children}
    </main>
  );
}
