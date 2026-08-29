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
        success: "#15803D",
        warning: "#B45309",
        danger: "#B91C1C",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "16px",
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
