import type { Metadata } from "next";
import "./globals.css";
import { SkipLink } from "@/components/ui/skip-link";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "AdJury — AI content critique",
  description:
    "Five AI juror personas review your marketing content before you publish.",
};

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
