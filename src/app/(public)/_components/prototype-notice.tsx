import { FlaskConical } from "lucide-react";

import { Container } from "@/components/ui/container";

/** Required on the public page (master plan §1, §7): this is not an official channel. */
export function PrototypeNotice() {
  return (
    <div
      role="note"
      aria-label="Prototype notice"
      className="border-b border-accent/30 bg-accent-soft"
    >
      <Container className="flex items-center justify-center gap-2 py-2 text-center text-xs font-medium text-accent-ink sm:text-sm">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
        <p>
          Coursework prototype, not an official university reporting channel. Please use fictional
          details only.
        </p>
      </Container>
    </div>
  );
}
