import type { Metadata } from "next";
import "./globals.css";
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
        {/* App-wide toast/notification layer (DailyPlan Day 53) — mounted once
            so every client surface can raise feedback via `useToast()`. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
