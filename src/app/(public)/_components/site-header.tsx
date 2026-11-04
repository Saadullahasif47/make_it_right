"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import { useRef } from "react";

import { Logo } from "@/components/brand/logo";
import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#ai-safety", label: "AI and safety" },
  { href: "/#roles", label: "For campus teams" },
] as const;

const navLinkClassName =
  "rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink";

/**
 * The public header. The primary action stays visible at every width; on small screens the
 * section links and sign-in move into a native <dialog> drawer, which traps focus and closes
 * on Escape without extra code.
 */
export function SiteHeader() {
  const drawer = useRef<HTMLDialogElement>(null);
  const close = () => {
    drawer.current?.close();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-0.5">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={navLinkClassName}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden md:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/student/complaints/new" size="sm">
            Report an issue
            <ArrowRight aria-hidden="true" className={buttonIcon} />
          </ButtonLink>
          <button
            type="button"
            aria-label="Open menu"
            aria-haspopup="dialog"
            onClick={() => drawer.current?.showModal()}
            className="flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink md:hidden"
          >
            <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </button>
        </div>
      </Container>

      <dialog
        ref={drawer}
        aria-label="Menu"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none translate-x-4 border-l border-line bg-surface p-0 text-ink opacity-0 transition-[opacity,translate,display,overlay] transition-discrete duration-(--motion-slow) ease-(--ease-exit) backdrop:bg-transparent backdrop:transition-[background-color,display,overlay] backdrop:transition-discrete backdrop:duration-(--motion-slow) open:translate-x-0 open:opacity-100 open:ease-(--ease-enter) open:backdrop:bg-ink/25 md:hidden starting:open:translate-x-4 starting:open:opacity-0 starting:open:backdrop:bg-transparent"
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-4">
          <span className="text-sm font-medium text-ink-muted">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X aria-hidden="true" className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <nav aria-label="Sections" className="p-3">
          <ul className="space-y-0.5">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} onClick={close} className={`${navLinkClassName} block`}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-line p-4">
          <ButtonLink href="/login" variant="secondary" className="w-full">
            Sign in
          </ButtonLink>
        </div>
      </dialog>
    </header>
  );
}
