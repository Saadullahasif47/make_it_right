import { z } from "zod";

import { sanitizeForModel } from "../text/sanitize.ts";

/** What worker_case_context returns: the case, its place and equipment, and its reports. */
export const caseContextSchema = z.object({
  case_id: z.uuid(),
  reference: z.string(),
  status: z.string(),
  version: z.number().int().positive(),
  category: z.string(),
  priority: z.string(),
  opened_at: z.string(),
  location: z.object({ location_id: z.uuid(), building: z.string(), room: z.string() }).nullable(),
  asset: z.object({ asset_id: z.uuid(), code: z.string(), label: z.string() }).nullable(),
  department: z.object({ department_id: z.uuid(), name: z.string() }).nullable(),
  reports: z.array(
    z.object({
      reference: z.string(),
      title: z.string(),
      description: z.string(),
      building: z.string(),
      room: z.string().nullable(),
    }),
  ),
  report_count: z.number().int().nonnegative(),
});

export type CaseContext = z.infer<typeof caseContextSchema>;

export const approvedRoutesSchema = z.array(
  z.object({ category: z.string(), department_id: z.uuid(), department: z.string() }),
);

export type ApprovedRoute = z.infer<typeof approvedRoutesSchema>[number];

/**
 * The context the model sees: structured facts plus the reports' text, cleaned of identifiers
 * and fenced. Reporter identities never reach this function (the SQL does not return them).
 */
export function modelView(context: CaseContext): Readonly<Record<string, unknown>> {
  return {
    case_id: context.case_id,
    reference: context.reference,
    status: context.status,
    version: context.version,
    category: context.category,
    priority: context.priority,
    opened_at: context.opened_at,
    location: context.location,
    asset: context.asset,
    current_department: context.department,
    report_count: context.report_count,
    reports: context.reports.map((report) => ({
      reference: report.reference,
      title: sanitizeForModel(report.title, 120),
      description: sanitizeForModel(report.description, 600),
      place: sanitizeForModel([report.building, report.room ?? ""].filter(Boolean).join(", "), 80),
    })),
  };
}

/** All report text, for the deterministic safety screen. */
export function reportText(context: CaseContext): string {
  return context.reports.map((report) => `${report.title}\n${report.description}`).join("\n");
}
