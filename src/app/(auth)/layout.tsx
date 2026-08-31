/**
 * Auth route-group layout — centers the login/signup cards on the app canvas.
 * The route group `(auth)` keeps these pages out of the dashboard chrome added
 * later without adding a URL segment (routes stay `/login`, `/signup`).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      {children}
    </main>
  );
}
