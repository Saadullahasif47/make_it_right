const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface TicketAge {
  /** For a dense column: "12 min", "3 h", "4 d". */
  readonly short: string;
  /** For screen readers: "12 minutes", "3 hours", "4 days". */
  readonly long: string;
}

function unit(value: number, short: string, singular: string): TicketAge {
  return { short: `${value} ${short}`, long: `${value} ${singular}${value === 1 ? "" : "s"}` };
}

/** How long a ticket has waited, in its largest whole unit. Never negative. */
export function ticketAge(createdAt: string, nowMs: number): TicketAge {
  const elapsed = Math.max(0, nowMs - Date.parse(createdAt));
  if (elapsed < HOUR) return unit(Math.floor(elapsed / MINUTE), "min", "minute");
  if (elapsed < DAY) return unit(Math.floor(elapsed / HOUR), "h", "hour");
  return unit(Math.floor(elapsed / DAY), "d", "day");
}
