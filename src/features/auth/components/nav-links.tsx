"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

import { ROLE_NAVIGATION, type NavItem } from "../navigation";
import type { AppRole } from "../roles";

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The item whose most specific prefix matches is current, so nested routes never highlight two
 * items, and a page reached from a queue (`also`) highlights that queue.
 */
export function activeHref(pathname: string, items: readonly NavItem[]): string | undefined {
  let best: { href: string; length: number } | undefined;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      if (matches(pathname, prefix) && (best === undefined || prefix.length > best.length)) {
        best = { href: item.href, length: prefix.length };
      }
    }
  }
  return best?.href;
}

/**
 * The role's destinations. Below `lg` they are tabs under the top bar (one tap, never hidden in
 * a menu: no role has more than a handful); from `lg` they are the sidebar's vertical list.
 */
export function NavLinks({ role }: { readonly role: AppRole }) {
  const pathname = usePathname();
  const items = ROLE_NAVIGATION[role];
  const current = activeHref(pathname, items);

  return (
    <ul className="-mb-px flex items-center gap-1 overflow-x-auto px-2 lg:mb-0 lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible lg:px-3">
      {items.map(({ href, label, shortLabel, icon: Icon }) => {
        const active = href === current;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 items-center gap-2.5 px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
                "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full lg:after:hidden",
                "lg:h-9 lg:rounded-md lg:px-2.5",
                active
                  ? "text-ink after:bg-brand lg:bg-band-active lg:text-band-fg"
                  : "text-ink-muted hover:text-ink lg:text-band-muted lg:hover:bg-band-hover lg:hover:text-band-fg",
              )}
            >
              <Icon
                aria-hidden="true"
                strokeWidth={1.75}
                className={cn(
                  "hidden size-4 shrink-0 lg:block",
                  active ? "text-brand-on-band" : "text-band-muted",
                )}
              />
              {shortLabel === undefined ? (
                label
              ) : (
                <>
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
