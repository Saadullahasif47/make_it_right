import { ArrowLeft, MapPinOff } from "lucide-react";
import type { Metadata } from "next";

import { StatusScreen } from "@/components/layout/status-screen";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusScreen
      icon={MapPinOff}
      code="404"
      title="This page does not exist"
      description="The link may be broken, or the page may have moved. Head back to the start and try again."
      actions={
        <ButtonLink href="/" variant="secondary">
          <ArrowLeft
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
          />
          Back to home
        </ButtonLink>
      }
    />
  );
}
