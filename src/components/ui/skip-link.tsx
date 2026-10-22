import { mainContentHref, SKIP_LINK_LABEL } from "@/lib/ui/a11y";

/**
 * Skip-to-content link (DailyPlan Day 55 — Accessibility pass 1).
 *
 * WCAG 2.4.1 "Bypass Blocks": a keyboard or screen-reader user landing on any
 * page can jump straight past the header/primary nav to the page's content
 * instead of tabbing through every nav link first. Mounted once in the root
 * layout as the very first focusable element in the document; it targets the
 * single `#main-content` landmark that whichever page renders owns (every
 * `<main>` carries `MAIN_CONTENT_ID`), so it always lands on the current page.
 *
 * It is a plain in-page `<a>` (not a Next `<Link>` — this is a fragment jump,
 * not a route change). Visually hidden until focused (`sr-only` →
 * `focus:not-sr-only`), then it appears pinned to the top-left with a solid
 * surface, a navy label, and the same visible focus ring the rest of the app
 * uses — so it never clutters the layout but is always reachable by keyboard.
 */
export function SkipLink() {
  return (
    <a
      href={mainContentHref()}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:border focus:border-border focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy focus:shadow-[0_4px_12px_rgba(11,11,15,.12)] focus:outline-none focus:ring-2 focus:ring-royal-bright"
    >
      {SKIP_LINK_LABEL}
    </a>
  );
}
