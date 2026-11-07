import { z } from "zod";

const count = z.coerce.number().int().nonnegative();

export const RULES = [
  "REPEAT_30D",
  "RECENT_REOPEN",
  "BUILDING_CLUSTER",
  "LONG_UNRESOLVED",
] as const;
export type RuleCode = (typeof RULES)[number];

/** What each rule means and what it suggests (plan v2 F6, demo thresholds). */
export const RULE_TEXT: Readonly<
  Record<RuleCode, { readonly title: string; readonly rule: string; readonly suggestion: string }>
> = {
  REPEAT_30D: {
    title: "Repeat failures",
    rule: "3 or more separate cases on the same equipment within 30 days.",
    suggestion: "Consider a preventive inspection or a replacement review.",
  },
  RECENT_REOPEN: {
    title: "Reopened soon after repair",
    rule: "A case reopened within 7 days of being marked resolved.",
    suggestion: "The repair may have been incomplete; check what was done.",
  },
  BUILDING_CLUSTER: {
    title: "Building cluster",
    rule: "5 or more separate cases in one building within 30 days.",
    suggestion: "Look for a building-level cause (supply, wiring, cleaning schedule).",
  },
  LONG_UNRESOLVED: {
    title: "Past its target",
    rule: "An assigned case still being worked on beyond its category's target days.",
    suggestion: "Follow up with the department; this is not an emergency escalation.",
  },
};

export const insightsSchema = z.object({
  generated_at: z.string(),
  alerts: z.array(
    z.object({
      id: z.uuid(),
      rule_code: z.enum(RULES),
      level: z.enum(["notice", "warning"]),
      status: z.enum(["open", "acknowledged", "cleared"]),
      window_start: z.string(),
      window_end: z.string(),
      metric: z.record(z.string(), z.unknown()),
      first_seen_at: z.string(),
      last_seen_at: z.string(),
      refresh_count: count,
      acknowledged_at: z.string().nullable(),
      acknowledgement_note: z.string().nullable(),
      building_code: z.string().nullable(),
      asset: z.object({ code: z.string(), label: z.string() }).nullable(),
      location: z.string().nullable(),
      cases: z.array(
        z.object({
          case_id: z.uuid(),
          reference: z.string(),
          status: z.string(),
          opened_at: z.string(),
          synthetic: z.boolean(),
          complaint_id: z.uuid().nullable(),
        }),
      ),
    }),
  ),
  ranked_assets: z.array(
    z.object({
      asset_id: z.uuid(),
      code: z.string(),
      label: z.string(),
      location: z.string(),
      cases: count,
      latest: z.string(),
    }),
  ),
  trend: z.array(z.object({ week_start: z.string(), cases: count })),
  sla: z.array(z.object({ category: z.string(), target_days: count })),
});

export type Insights = z.infer<typeof insightsSchema>;
export type InsightAlert = Insights["alerts"][number];

/** One plain sentence with the numbers behind an alert. */
export function describeAlert(alert: InsightAlert): string {
  const metric = alert.metric;
  const number = (key: string) => (typeof metric[key] === "number" ? metric[key] : undefined);
  switch (alert.rule_code) {
    case "REPEAT_30D":
      return `${alert.asset?.code ?? "This equipment"} (${alert.asset?.label ?? "equipment"}) has ${String(number("cases") ?? alert.cases.length)} separate cases in 30 days.`;
    case "RECENT_REOPEN":
      return `Reopened ${String(number("gap_days") ?? "?")} days after it was marked resolved.`;
    case "BUILDING_CLUSTER":
      return `${typeof metric.building_name === "string" ? metric.building_name : (alert.building_code ?? "A building")} has ${String(number("cases") ?? alert.cases.length)} separate cases in 30 days.`;
    case "LONG_UNRESOLVED":
      return `Unresolved for ${String(number("age_days") ?? "?")} days against a ${String(number("target_days") ?? "?")}-day target.`;
  }
}
