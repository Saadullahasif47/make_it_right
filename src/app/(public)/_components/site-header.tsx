import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#who-its-for", label: "Who it's for" },
  { href: "/#ai-safety", label: "AI & safety" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="relative rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-200 after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-brand after:transition-transform after:duration-300 hover:text-ink hover:after:scale-x-100"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/student/complaints/new" size="sm">
            Report an issue
            <ArrowRight aria-hidden="true" className={buttonIconSlide} />
          </ButtonLink>
        </div>
      </Container>
    </header>
  );
}
