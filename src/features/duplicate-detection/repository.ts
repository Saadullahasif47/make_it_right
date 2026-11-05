import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export interface CaseReport {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly createdAt: string;
}

export interface CandidateCase {
  readonly id: string;
  readonly reference: string;
  readonly status: Enums["maintenance_case_status"];
  readonly version: number;
  readonly location: string | null;
  readonly department: string | null;
  readonly reports: readonly CaseReport[];
}

export interface MatchCandidate {
  readonly id: string;
  readonly decision: Enums["match_decision"];
  readonly similarity: number;
  readonly score: number;
  readonly sameBuilding: boolean;
  readonly sameRoom: boolean;
  readonly categoryMatch: boolean;
  readonly sameAsset: boolean;
  readonly model: string;
  readonly decidedAt: string | null;
  /** Null when the caller cannot see the candidate case (another department's). */
  readonly candidate: CandidateCase | null;
}

export const caseReference = (referenceNo: number): string => `MC-${String(referenceNo)}`;
const ticketReference = (referenceNo: number): string => `MIR-${String(referenceNo)}`;

const CASE_COLUMNS =
  "id, reference_no, status, version, location:maintenance_locations(display_name), department:departments(name), reports:case_reports(complaint:complaints(id, reference_no, title, created_at))";

interface CaseRow {
  readonly id: string;
  readonly reference_no: number;
  readonly status: Enums["maintenance_case_status"];
  readonly version: number;
  readonly location: { readonly display_name: string } | null;
  readonly department: { readonly name: string } | null;
  readonly reports: readonly {
    readonly complaint: {
      readonly id: string;
      readonly reference_no: number;
      readonly title: string;
      readonly created_at: string;
    } | null;
  }[];
}

function toCase(row: CaseRow): CandidateCase {
  return {
    id: row.id,
    reference: caseReference(row.reference_no),
    status: row.status,
    version: row.version,
    location: row.location?.display_name ?? null,
    department: row.department?.name ?? null,
    reports: row.reports
      .flatMap((report) => (report.complaint === null ? [] : [report.complaint]))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((complaint) => ({
        id: complaint.id,
        reference: ticketReference(complaint.reference_no),
        title: complaint.title,
        createdAt: complaint.created_at,
      })),
  };
}

/** Candidates for one report, best first; decided ones after pending ones. RLS-scoped. */
export async function listMatchCandidates(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<readonly MatchCandidate[]> {
  const { data, error } = await client
    .from("match_candidates")
    .select(
      `id, decision, similarity, score, same_building, same_room, category_match, same_asset, model, decided_at, candidate:maintenance_cases!match_candidates_candidate_case_id_fkey(${CASE_COLUMNS})`,
    )
    .eq("complaint_id", complaintId)
    .order("score", { ascending: false });
  if (error !== null) {
    throw new Error(`match_candidates query failed: ${error.code}`);
  }
  const rows = data as unknown as readonly (Omit<MatchCandidateRow, "candidate"> & {
    readonly candidate: CaseRow | null;
  })[];
  return rows
    .map((row) => ({
      id: row.id,
      decision: row.decision,
      similarity: row.similarity,
      score: row.score,
      sameBuilding: row.same_building,
      sameRoom: row.same_room,
      categoryMatch: row.category_match,
      sameAsset: row.same_asset,
      model: row.model,
      decidedAt: row.decided_at,
      candidate: row.candidate === null ? null : toCase(row.candidate),
    }))
    .sort((a, b) => Number(a.decision !== "pending") - Number(b.decision !== "pending"));
}

interface MatchCandidateRow {
  readonly id: string;
  readonly decision: Enums["match_decision"];
  readonly similarity: number;
  readonly score: number;
  readonly same_building: boolean;
  readonly same_room: boolean;
  readonly category_match: boolean;
  readonly same_asset: boolean;
  readonly model: string;
  readonly decided_at: string | null;
}

/** The case a report belongs to, when it is shared with other reports; null otherwise. */
export async function getSharedCase(
  client: AppSupabaseClient,
  complaintId: string,
): Promise<CandidateCase | null> {
  const { data, error } = await client
    .from("case_reports")
    .select(`case:maintenance_cases!case_reports_case_id_fkey(${CASE_COLUMNS})`)
    .eq("complaint_id", complaintId)
    .maybeSingle();
  if (error !== null) {
    throw new Error(`case_reports query failed: ${error.code}`);
  }
  const row = (data as unknown as { readonly case: CaseRow | null } | null)?.case ?? null;
  if (row === null) return null;
  const shared = toCase(row);
  return shared.reports.length > 1 ? shared : null;
}
