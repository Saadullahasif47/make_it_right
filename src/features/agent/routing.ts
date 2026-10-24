import type { ComplaintCategory } from "@/features/complaints/categories";

/** The approved reference data a triage attempt may use, read once per attempt. */
export interface RoutingSnapshot {
  /** Active departments only. */
  readonly departments: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  /** Enabled routing rules that point at an active department. */
  readonly routes: ReadonlyMap<ComplaintCategory, string>;
}

export function departmentById(snapshot: RoutingSnapshot, id: string) {
  return snapshot.departments.find((department) => department.id === id);
}

export function approvedRoute(snapshot: RoutingSnapshot, category: ComplaintCategory) {
  const id = snapshot.routes.get(category);
  return id === undefined ? undefined : departmentById(snapshot, id);
}
