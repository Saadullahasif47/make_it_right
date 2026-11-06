import { z } from "zod";

/**
 * The coordinator's tool contract (plan v2 §08 F3.01). Four read tools and two final tools; the
 * model can ask for nothing else. Every call is validated against these schemas and scoped to
 * the case being coordinated before anything runs. There is deliberately no tool that writes:
 * a proposal is committed, or not, by code after the loop ends.
 */
export const CATEGORIES = [
  "electrical",
  "it_equipment",
  "plumbing",
  "furniture",
  "sanitation",
  "other",
] as const;

export const PRIORITIES = ["low", "medium", "high"] as const;

export const REVIEW_REASONS = [
  "AMBIGUOUS",
  "HAZARD",
  "CONTRADICTORY_EVIDENCE",
  "NO_SUITABLE_DEPARTMENT",
  "OTHER",
] as const;

const uuid = z.uuid();

export const TOOL_ARGUMENTS = {
  get_case_context: z.strictObject({ case_id: uuid }),
  get_asset_repair_history: z.strictObject({ asset_id: uuid }),
  get_department_capacity: z.strictObject({ department_id: uuid }),
  find_related_cases: z.strictObject({
    location_id: uuid,
    category: z.enum(CATEGORIES).optional(),
  }),
  propose_work_order: z.strictObject({
    case_id: uuid,
    department_id: uuid,
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES),
    rationale: z.string().trim().min(10).max(600),
  }),
  request_admin_review: z.strictObject({
    case_id: uuid,
    reason_code: z.enum(REVIEW_REASONS),
  }),
} as const;

export type ToolName = keyof typeof TOOL_ARGUMENTS;
export const TOOL_NAMES = Object.keys(TOOL_ARGUMENTS) as ToolName[];
export const READ_TOOLS: readonly ToolName[] = [
  "get_case_context",
  "get_asset_repair_history",
  "get_department_capacity",
  "find_related_cases",
];

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

const idParameter = (description: string) => ({ type: "string", format: "uuid", description });

/** Gemini function declarations (JSON Schema), mirroring TOOL_ARGUMENTS. */
export const TOOL_DECLARATIONS = [
  {
    name: "get_case_context",
    description:
      "Re-read the case: status, version, category, priority, room, equipment and its reports.",
    parametersJsonSchema: {
      type: "object",
      properties: { case_id: idParameter("The case being coordinated.") },
      required: ["case_id"],
    },
  },
  {
    name: "get_asset_repair_history",
    description: "Recent cases of the case's own equipment, to spot repeat failures.",
    parametersJsonSchema: {
      type: "object",
      properties: { asset_id: idParameter("The equipment id from the case context.") },
      required: ["asset_id"],
    },
  },
  {
    name: "get_department_capacity",
    description:
      "How many work orders a department has open, and which categories it is the approved route for.",
    parametersJsonSchema: {
      type: "object",
      properties: { department_id: idParameter("An approved department id.") },
      required: ["department_id"],
    },
  },
  {
    name: "find_related_cases",
    description: "Recent cases in the case's own room, optionally of one category.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        location_id: idParameter("The room id from the case context."),
        category: { type: "string", enum: [...CATEGORIES] },
      },
      required: ["location_id"],
    },
  },
  {
    name: "propose_work_order",
    description:
      "Final step: propose which approved department should take the case. Code checks it; a person approves anything risky.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        case_id: idParameter("The case being coordinated."),
        department_id: idParameter("The approved department for the category."),
        category: { type: "string", enum: [...CATEGORIES] },
        priority: { type: "string", enum: [...PRIORITIES] },
        rationale: {
          type: "string",
          description: "One or two sentences citing only facts from the context or tools.",
        },
      },
      required: ["case_id", "department_id", "category", "priority", "rationale"],
    },
  },
  {
    name: "request_admin_review",
    description:
      "Final step instead of a proposal: ask a person to decide (ambiguous, hazardous or contradictory cases).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        case_id: idParameter("The case being coordinated."),
        reason_code: { type: "string", enum: [...REVIEW_REASONS] },
      },
      required: ["case_id", "reason_code"],
    },
  },
] as const;
