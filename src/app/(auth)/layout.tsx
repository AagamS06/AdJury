/**
 * Auth route-group layout — centers the login/signup cards on the app canvas.
 * The route group `(auth)` keeps these pages out of the dashboard chrome added
 * later without adding a URL segment (routes stay `/login`, `/signup`).
 */
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";

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
