import { LogOut } from "lucide-react";

import { signOutAction } from "../actions";
import { ROLE_LABELS } from "../roles";
import type { SessionUser } from "../session";

function initialsOf(user: SessionUser): string {
  const source = user.displayName ?? user.email ?? "?";
  const parts = source.split(/[\s@._-]+/).filter((part) => part.length > 0);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : source.slice(0, 2);
  return letters.toUpperCase();
}

export function AccountMenu({ user }: { readonly user: SessionUser }) {
  const name = user.displayName ?? user.email ?? "Signed in";

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="hidden max-w-48 truncate text-sm font-semibold text-ink sm:block">{name}</p>
        <p className="text-xs font-medium text-brand-strong">{ROLE_LABELS[user.role]}</p>
      </div>
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong ring-2 ring-surface"
      >
        {initialsOf(user)}
      </span>
      <form action={signOutAction}>
        <button
          type="submit"
          className="group inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:bg-surface-muted hover:text-ink"
        >
          <LogOut
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
          />
          <span className="sr-only sm:not-sr-only">Sign out</span>
        </button>
      </form>
    </div>
  );
}
