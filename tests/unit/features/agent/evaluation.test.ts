import { describe, expect, it } from "vitest";

import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import { screenForSafety } from "@/features/agent/safety";

import { SEED_SNAPSHOT, loadDataset } from "../../../eval/dataset";
import {
  isUnauthorised,
  macroF1,
  outcomeMatchesExpectation,
  percentile,
  summarise,
  type EvalOutcome,
} from "../../../eval/metrics";

const items = loadDataset();

describe("evaluation dataset (P4.09)", () => {
  it("holds 20 reports per category, 5 of each held out for evaluation", () => {
    expect(items).toHaveLength(120);
    for (const category of COMPLAINT_CATEGORIES) {
      const ofCategory = items.filter((item) => item.category === category);
      expect(ofCategory, category).toHaveLength(20);
      expect(
        ofCategory.filter((item) => item.split === "eval"),
        category,
      ).toHaveLength(5);
    }
  });

  it("has unique ids and covers misspellings, ambiguity and adversarial text", () => {
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const tag of ["misspelling", "ambiguous", "adversarial", "safety", "not_maintenance"]) {
      expect(
        items.some((item) => item.tags.includes(tag)),
        tag,
      ).toBe(true);
    }
    expect(
      items.filter((item) => item.split === "eval" && item.tags.includes("adversarial")).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("labels every safety report so that the deterministic screen catches it", () => {
    for (const item of items.filter((entry) => entry.tags.includes("safety"))) {
      expect(screenForSafety(`${item.title}\n${item.description}`).flagged, item.id).toBe(true);
      expect(item.expected, item.id).toBe("review");
    }
  });

  it("does not trip the safety screen on reports labelled as routable", () => {
    const tripped = items
      .filter(
        (item) =>
          item.expected === "route" &&
          screenForSafety(`${item.title}\n${item.description}`).flagged,
      )
      .map((item) => item.id);
    expect(tripped).toEqual([]);
  });
});

describe("evaluation metrics", () => {
  const electrical = SEED_SNAPSHOT.routes.get("electrical") ?? "";
  const item = items.find((entry) => entry.id === "el-01");
  if (item === undefined) throw new Error("fixture missing");
  const routed: EvalOutcome = {
    item,
    decision: {
      kind: "route",
      category: "electrical",
      departmentId: electrical,
      priority: "medium",
      reason: "Lights out.",
    },
    trace: [],
    latencyMs: 900,
  };

  it("computes macro-F1 with missing predictions as misses", () => {
    expect(macroF1([{ truth: "electrical", predicted: "electrical" }]).macro).toBe(1);
    expect(macroF1([{ truth: "electrical", predicted: undefined }]).macro).toBe(0);
    const mixed = macroF1([
      { truth: "electrical", predicted: "electrical" },
      { truth: "plumbing", predicted: "electrical" },
    ]);
    expect(mixed.macro).toBeCloseTo((2 / 3 + 0) / 2, 5);
  });

  it("uses the nearest-rank percentile", () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(200);
    expect(
      percentile(
        Array.from({ length: 20 }, (_, index) => index + 1),
        95,
      ),
    ).toBe(19);
    expect(percentile([], 95)).toBe(0);
  });

  it("flags any route the policy should have refused as unauthorised", () => {
    expect(isUnauthorised(routed, SEED_SNAPSHOT)).toBe(false);
    expect(
      isUnauthorised(
        {
          ...routed,
          decision: { ...routed.decision, departmentId: "x" } as EvalOutcome["decision"],
        },
        SEED_SNAPSHOT,
      ),
    ).toBe(true);
    const sparking = items.find((entry) => entry.id === "el-13");
    if (sparking === undefined) throw new Error("fixture missing");
    expect(isUnauthorised({ ...routed, item: sparking }, SEED_SNAPSHOT)).toBe(true);
  });

  it("summarises outcomes against expectations", () => {
    const review: EvalOutcome = {
      ...routed,
      decision: { kind: "review", failureCode: "SAFETY_REVIEW" },
      latencyMs: 1200,
    };
    const summary = summarise([routed, review], SEED_SNAPSHOT);
    expect(summary).toMatchObject({
      items: 2,
      routed: 1,
      routedCorrectCategory: 1,
      reviewRate: 0.5,
      unauthorisedStateChanges: 0,
      failureCodes: { SAFETY_REVIEW: 1 },
    });
    expect(outcomeMatchesExpectation(routed)).toBe(true);
    expect(outcomeMatchesExpectation(review)).toBe(false);
  });
});
