import type { Config } from "tailwindcss";

// Palette mirrors Design.md — enterprise-credible, not "cutesy".
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0A1F44",
        royal: { DEFAULT: "#1E40AF", bright: "#2563EB" },
        burgundy: { DEFAULT: "#6B1F2A", bright: "#8B2635" },
        ink: "#0B0B0F",
        surface: "#FFFFFF",
        canvas: "#F7F8FA",
        border: "#E4E7EC",
        muted: "#667085",
        body: "#344054",
        success: { DEFAULT: "#15803D", deep: "#166534" },
        warning: { DEFAULT: "#B45309", deep: "#9A3412" },
        danger: "#B91C1C",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "16px",
      },
      // Elevation tokens — Design.md §4: "subtle only — 0 1px 2px rgba(11,11,15,.06)
      // for cards; deeper shadow reserved for modals/menus". The `rgba(11,11,15,…)`
      // channels are the ink/black token (#0B0B0F), so elevation stays on-palette.
      // Named here once instead of repeated as arbitrary `shadow-[…]` magic strings.
      boxShadow: {
        card: "0 1px 2px rgba(11,11,15,.06)",
        elevated: "0 4px 12px rgba(11,11,15,.10)",
      },
      // Motion tokens — Design.md §6 ("keep animation minimal and functional").
      // Canonical durations named once (see src/lib/ui/motion.ts), so motion is
      // subtle and consistent instead of ad-hoc magic numbers. `base` (150ms)
      // matches Tailwind's own default transition duration, so existing
      // `transition-colors` hovers stay on-token. A drift test pins these to
      // src/lib/ui/motion.ts.
      transitionDuration: {
        fast: "100ms",
        base: "150ms",
        slow: "250ms",
      },
      // The toast enter animation, tokenised out of a hand-written globals.css
      // keyframe (DailyPlan Day 53 → Day 64). Applied via the `motion-safe:`
      // variant (`motion-safe:animate-toast-in`) so it only plays when the user
      // has not asked for reduced motion.
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "toast-in": "toast-in 150ms ease-out",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
