import type { Metadata } from "next";
import "./globals.css";
import { SkipLink } from "@/components/ui/skip-link";
import { ToastProvider } from "@/components/ui/toast";
import { buildRootMetadata, resolveSiteUrl } from "@/lib/seo/metadata";

/**
 * Site-wide metadata (DailyPlan Day 80). Built once from the pure
 * `lib/seo/metadata.ts` core: `metadataBase` (so relative canonical/OG URLs
 * resolve to the configured domain), a `%s — AdJury` title template, the default
 * description, and the default OpenGraph + Twitter card. Per-page `metadata`
 * exports add their own canonical/OG; private pages override robots to `noindex`.
 * The origin comes from `NEXT_PUBLIC_APP_URL` (the Day-79 domain var).
 */
export const metadata: Metadata = buildRootMetadata(
  resolveSiteUrl(process.env.NEXT_PUBLIC_APP_URL).url,
);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Skip-to-content link (DailyPlan Day 55) — the first focusable element
            in the document, so a keyboard user can bypass the header/nav and
            jump to the current page's `#main-content` landmark. */}
        <SkipLink />
        {/* App-wide toast/notification layer (DailyPlan Day 53) — mounted once
            so every client surface can raise feedback via `useToast()`. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
