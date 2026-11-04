import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classifyByKeywords } from "@/features/agent/keyword-router";
import { screenForSafety } from "@/features/agent/safety";

interface LabelledItem {
  readonly id: string;
  readonly category: string;
  readonly expected: "route" | "review" | "either";
  readonly title: string;
  readonly description: string;
}

const items = (
  JSON.parse(
    readFileSync(join(process.cwd(), "tests", "eval", "fixtures", "complaints.json"), "utf8"),
  ) as { items: LabelledItem[] }
).items;

describe("keyword fallback router", () => {
  it("never sends a labelled report to the wrong department", () => {
    const wrong: string[] = [];
    let routed = 0;
    for (const item of items) {
      const text = `${item.title}\n${item.description}`;
      if (screenForSafety(text).flagged) continue; // those always wait for a person
      const match = classifyByKeywords(text);
      if (match === undefined) continue;
      routed += 1;
      if (match.category !== item.category) wrong.push(`${item.id} → ${match.category}`);
    }
    expect(wrong).toEqual([]);
    // It is useful as well as safe: more than half of the labelled reports route.
    expect(routed).toBeGreaterThan(items.length / 2);
  });

  it("never routes a report the labels say a person should review", () => {
    // As in triage: the safety screen holds those back first; the keywords must not route the rest.
    const text = (item: LabelledItem) => `${item.title}\n${item.description}`;
    const reviews = items.filter((item) => item.expected === "review");
    const routedPastSafety = reviews
      .filter((item) => !screenForSafety(text(item)).flagged)
      .filter((item) => classifyByKeywords(text(item)) !== undefined)
      .map((item) => item.id);
    expect(routedPastSafety).toEqual([]);
    // And every review report the keywords would match is one the safety screen holds.
    for (const item of reviews.filter((entry) => classifyByKeywords(text(entry)) !== undefined)) {
      expect(screenForSafety(text(item)).flagged, item.id).toBe(true);
    }
  });

  // Wordings that are not in the labelled set, so the router was not tuned on them.
  it.each([
    ["Ceiling fan not working", "The fan in room 2.08 does not turn on.", "electrical"],
    [
      "No power in class",
      "None of the sockets in room 14 work and the lights are off.",
      "electrical",
    ],
    ["Wifi down in library", "The internet keeps dropping on the second floor.", "it_equipment"],
    ["Tap leaking", "The tap in the girls' washroom is leaking all day.", "plumbing"],
    ["Broken chair", "Two chairs in lecture hall B have broken legs.", "furniture"],
    ["Bins overflowing", "The bins outside the cafeteria are full of rubbish.", "sanitation"],
  ])("routes a clear report: %s", (title, description, category) => {
    expect(classifyByKeywords(`${title}\n${description}`)?.category).toBe(category);
  });

  it.each([
    ["Something is wrong", "Please send someone to look at room 12."],
    ["Desk light flickering", "The lamp on my desk flickers."],
    ["Side gate broken", "The gate by the sports ground will not close."],
    // Two kinds of fault at once (sockets and computers): a person decides.
    ["No power in lab", "None of the sockets in the computer lab have power."],
  ])("leaves an unclear or mixed report to a person: %s", (title, description) => {
    expect(classifyByKeywords(`${title}\n${description}`)).toBeUndefined();
  });
});
