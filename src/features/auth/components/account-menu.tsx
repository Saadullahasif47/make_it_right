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

/**
 * Who is signed in, and the way out. Compact in the mobile top bar (role and avatar), a full row
 * at the foot of the desktop sidebar (name, role and a labelled sign-out button).
 */
export function AccountMenu({ user }: { readonly user: SessionUser }) {
  const name = user.displayName ?? user.email ?? "Signed in";

  return (
    <div className="flex items-center gap-2.5 lg:border-t lg:border-band-line lg:px-4 lg:py-4">
      <span
        aria-hidden="true"
        className="order-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong lg:order-none lg:bg-band-active lg:text-band-fg"
      >
        {initialsOf(user)}
      </span>
      <div className="order-1 min-w-0 text-right lg:order-none lg:flex-1 lg:text-left">
        <p className="hidden truncate text-sm font-medium text-band-fg lg:block">{name}</p>
        <p className="text-xs font-medium text-ink-muted lg:text-band-muted">
          {ROLE_LABELS[user.role]}
        </p>
      </div>
      <form action={signOutAction} className="order-3 lg:order-none">
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink lg:size-8 lg:text-band-muted lg:hover:bg-band-hover lg:hover:text-band-fg"
        >
          <LogOut aria-hidden="true" className="size-4" strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );
}
