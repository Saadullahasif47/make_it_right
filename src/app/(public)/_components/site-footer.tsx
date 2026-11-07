import Link from "next/link";

import { Logo, PRODUCT_TAGLINE } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#ai-safety", label: "AI and safety" },
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Create a student account" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="grid gap-8 py-12 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-md space-y-3">
          <Logo />
          <p className="text-sm text-ink-muted">{PRODUCT_TAGLINE}.</p>
          <p className="text-sm text-pretty text-ink-muted">
            For campus maintenance problems. It does not handle emergencies, harassment, medical or
            disciplinary matters.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid gap-2 text-sm">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-ink-muted transition-colors hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  );
}
