"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils/cn";

import { applyTheme, currentTheme, type Theme } from "./theme";

/** Re-reads the theme whenever data-theme changes, so every toggle on the page stays in step. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    observer.disconnect();
  };
}

/** Switches between the light design (default) and the opt-in dark theme. */
export function ThemeToggle({ className }: { readonly className?: string }) {
  // The server always renders light; the browser reads the real choice after hydration.
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Switch to dark theme" : "Switch to light theme";
  const Icon = next === "dark" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
      }}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-md transition-colors",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </button>
  );
}
