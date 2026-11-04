import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

import { SEARCH_LIMITS } from "../schemas";

/**
 * Ticket search as a plain GET form: results are a shareable URL and work without JavaScript.
 * `keep` carries the list's other settings (status, sort) through a new search.
 */
export function SearchForm({
  action,
  label,
  query,
  keep = {},
}: {
  readonly action: string;
  readonly label: string;
  readonly query?: string | undefined;
  readonly keep?: Readonly<Record<string, string>>;
}) {
  return (
    <form role="search" action={action} className="flex gap-2">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="relative min-w-0 flex-1">
        <label htmlFor="ticket-search" className="sr-only">
          {label}
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          id="ticket-search"
          type="search"
          name="q"
          defaultValue={query}
          maxLength={SEARCH_LIMITS.max}
          placeholder="Title, place or MIR-1234"
          autoComplete="off"
          className={cn(inputClassName, "pl-9")}
        />
      </div>
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}
