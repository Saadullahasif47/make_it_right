"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;

const LOCAL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const UTC = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/**
 * Timestamps are stored in UTC and shown in the viewer's timezone (plan §4). The server and
 * the first client render agree on UTC, then the browser switches to local time, so hydration
 * never mismatches.
 */
export function LocalTime({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  const date = new Date(value);
  const text = useSyncExternalStore(
    noopSubscribe,
    () => LOCAL.format(date),
    () => `${UTC.format(date)} UTC`,
  );

  return (
    <time dateTime={value} className={className}>
      {text}
    </time>
  );
}
