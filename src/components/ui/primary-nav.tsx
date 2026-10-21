"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isNavItemActive,
  navGroupsForRole,
  type NavItem,
} from "@/lib/ui/nav";
import type { UserRole } from "@/types/db";

/**
 * Primary navigation island (DailyPlan Day 54, nav/IA cleanup). Rendered inside
 * the server `(dashboard)` layout, it reads the current path and highlights the
 * active item so every page in the shell shows the user where they are.
 *
 * All structure and active-route logic lives in the pure `lib/ui/nav.ts` core
 * (role filtering, section grouping, the `isNavItemActive` matcher); this island
 * only resolves the pathname and renders. Coherence + accessibility (Design.md
 * §6): the active item is marked with `aria-current="page"` and a non-colour
 * cue (bold weight + a filled background), so it reads for assistive tech and
 * sighted users alike — never colour alone. The workspace / manage / account
 * groups are visually separated and each carries an accessible name. The link
 * row wraps (`flex-wrap`) so it stays usable at narrow widths without a
 * horizontal scrollbar.
 */
export function PrimaryNav({ role }: { role: UserRole }) {
  const pathname = usePathname() ?? "";
  const groups = navGroupsForRole(role);

  return (
    <nav
      aria-label="Primary"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-medium"
    >
      <Link
        href="/dashboard"
        className="rounded-sm px-2 py-1.5 font-semibold uppercase tracking-wide text-royal hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        AdJury
      </Link>

      {groups.map((group, index) => (
        <Fragment key={group.section}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:inline-block"
            />
          )}
          <ul
            aria-label={group.label}
            className="flex flex-wrap items-center gap-x-1 gap-y-1"
          >
            {group.items.map((item) => (
              <li key={item.key}>
                <NavLink item={item} active={isNavItemActive(item, pathname)} />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-sm bg-canvas px-2 py-1.5 font-semibold text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          : "rounded-sm px-2 py-1.5 text-body hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      }
    >
      {item.label}
    </Link>
  );
}
