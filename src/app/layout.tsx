import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
