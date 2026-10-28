import Link from "next/link";
import {
  FOOTER_COLUMNS,
  FOOTER_TAGLINE,
  footerCopyright,
} from "@/lib/marketing/landing";

/**
 * Landing footer (DailyPlan Day 59). The page's closing `<footer>` landmark — a
 * thin, presentational server component rendering the footer content from
 * `lib/marketing/landing.ts` (owned + tested there). Every link is an existing
 * route or an in-page anchor, so nothing dangles.
 *
 * Laid out on brand (Design.md): a light surface separated by a top border
 * (borders over shadows), the brand mark + tagline alongside titled link
 * columns, and a quiet bottom bar carrying the copyright and the product's
 * human-in-control promise.
 *
 * Accessibility (Design.md §6): a real `<footer>` landmark, each link column a
 * labelled `<nav>` with a semantic list, and the standard Royal-bright focus
 * ring on every link — nothing relies on colour alone.
 */
export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-royal">
              AdJury
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-body">
              {FOOTER_TAGLINE}
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.key} aria-label={column.title}>
              <h2 className="text-sm font-semibold text-navy">{column.title}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      className="rounded-sm text-sm text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>{footerCopyright(year)}</p>
          <p>A pre-publish QA layer — you always stay in control of what ships.</p>
        </div>
      </div>
    </footer>
  );
}
