"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils/cn";

import type { NavItem } from "../navigation";

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific matching item is current, so nested routes never highlight two tabs. */
export function activeHref(pathname: string, items: readonly NavItem[]): string | undefined {
  return items
    .filter((item) => matches(pathname, item.href))
    .reduce<string | undefined>(
      (best, item) => (best === undefined || item.href.length > best.length ? item.href : best),
      undefined,
    );
}

export function NavLinks({ items }: { readonly items: readonly NavItem[] }) {
  const pathname = usePathname();
  const current = activeHref(pathname, items);

  return (
    <ul className="flex items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = item.href === current;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-11 items-center px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand after:transition-transform after:duration-300",
                active
                  ? "text-ink after:scale-x-100"
                  : "text-ink-muted after:scale-x-0 hover:text-ink hover:after:scale-x-50",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
