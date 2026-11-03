import { readFileSync } from "node:fs";

import { z } from "zod";

import { COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import type { RoutingSnapshot } from "@/features/agent/routing";

import type { EvalItem } from "./metrics";

const datasetSchema = z.object({
  description: z.string(),
  items: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z]{2}-\d{2}$/),
      split: z.enum(["dev", "eval"]),
      category: z.enum(COMPLAINT_CATEGORIES),
      expected: z.enum(["route", "review", "either"]),
      tags: z.array(
        z.enum(["misspelling", "ambiguous", "adversarial", "safety", "not_maintenance"]),
      ),
      title: z.string().min(5).max(120),
      description: z.string().min(15).max(3000),
    }),
  ),
});

export function loadDataset(): readonly EvalItem[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("./fixtures/complaints.json", import.meta.url), "utf8"),
  );
  return datasetSchema.parse(raw).items;
}

/**
 * The seeded departments and default routes (supabase/seed.sql), with fixed fictional ids.
 * Evaluation never touches a database: it measures the model plus the policy.
 */
export const SEED_SNAPSHOT: RoutingSnapshot = (() => {
  const departments = [
    {
      id: "5eed0000-0000-4000-8000-000000000001",
      code: "electrical",
      name: "Electrical Maintenance",
    },
    { id: "5eed0000-0000-4000-8000-000000000002", code: "it_services", name: "IT Services" },
    { id: "5eed0000-0000-4000-8000-000000000003", code: "plumbing", name: "Plumbing" },
    {
      id: "5eed0000-0000-4000-8000-000000000004",
      code: "furniture",
      name: "Furniture and Fixtures",
    },
    {
      id: "5eed0000-0000-4000-8000-000000000005",
      code: "sanitation",
      name: "Sanitation and Cleaning",
    },
    { id: "5eed0000-0000-4000-8000-000000000006", code: "facilities", name: "Facilities Office" },
  ] as const;
  const byCode = (code: string) =>
    departments.find((department) => department.code === code)?.id ?? "";
  return {
    departments,
    routes: new Map([
      ["electrical", byCode("electrical")],
      ["it_equipment", byCode("it_services")],
      ["plumbing", byCode("plumbing")],
      ["furniture", byCode("furniture")],
      ["sanitation", byCode("sanitation")],
      ["other", byCode("facilities")],
    ]),
  };
})();
