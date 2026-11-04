"use client";

import { useEffect } from "react";

/**
 * Lets homepage sections below the fold rise into view, once, as they are reached. Sections opt
 * in with `data-reveal`; the animation itself is CSS (globals.css). Nothing is hidden unless this
 * script runs, motion is allowed, and the section has not been seen yet, so content never depends
 * on it: no-JavaScript visitors, reduced motion and screenshots all get every section at once.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal", "shown");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    for (const section of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      // Already on screen at load: it simply stays visible.
      if (section.getBoundingClientRect().top > window.innerHeight) {
        section.setAttribute("data-reveal", "pending");
        observer.observe(section);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
