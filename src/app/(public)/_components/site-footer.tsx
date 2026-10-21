import { Logo, PRODUCT_TAGLINE } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm space-y-3">
          <Logo />
          <p className="text-sm text-ink-muted">{PRODUCT_TAGLINE}.</p>
        </div>
        <div className="max-w-md space-y-2 text-sm text-ink-muted sm:text-right">
          <p>
            A cloud computing coursework prototype. It is not an official reporting channel and does
            not handle emergencies, harassment, medical or disciplinary matters.
          </p>
          <p className="text-ink-subtle">Runs on Vercel, Supabase and the Gemini API.</p>
        </div>
      </Container>
    </footer>
  );
}
