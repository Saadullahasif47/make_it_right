"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 8_000;
const MAX_REFRESHES = 15;

/**
 * While a photo is being analysed, re-reads the page every few seconds (about two minutes in
 * all), so the result appears without the reporter reloading. A reload loses nothing either:
 * the job and its result are stored server-side.
 */
export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= MAX_REFRESHES) {
        clearInterval(timer);
      }
    }, INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [router]);
  return null;
}
