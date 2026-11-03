import { Info } from "lucide-react";

import { Container } from "@/components/ui/container";

/**
 * Required on the public page (master plan §1, §7): this is not an official channel. Quiet in
 * colour so it does not compete with the product, but always present and fully legible.
 */
export function PrototypeNotice() {
  return (
    <div role="note" aria-label="Prototype notice" className="border-b border-line bg-surface">
      <Container className="flex items-center justify-center gap-2 py-2 text-center text-xs text-ink-muted">
        <Info aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
        <p>
          Coursework prototype, not an official university reporting channel. Please use fictional
          details only.
        </p>
      </Container>
    </div>
  );
}
