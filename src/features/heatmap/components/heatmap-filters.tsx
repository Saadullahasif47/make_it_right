import { inputClassName } from "@/components/ui/field";
import { buttonClassName } from "@/components/ui/button";
import { CATEGORY_LABELS, COMPLAINT_CATEGORIES } from "@/features/complaints/categories";
import type { Department } from "@/features/complaints/repository";

import { HEATMAP_WINDOWS, type HeatmapFilters } from "../schemas";

const STATUS_LABELS = { all: "All cases", active: "Still open", done: "Resolved or closed" };

function Select({
  name,
  label,
  value,
  children,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-ink">
      {label}
      <select name={name} defaultValue={value} className={inputClassName}>
        {children}
      </select>
    </label>
  );
}

/** A plain GET form: every filter is in the URL, so a view can be shared and reloaded (F5.04). */
export function HeatmapFiltersForm({
  filters,
  buildings,
  floors,
  departments,
}: {
  readonly filters: HeatmapFilters;
  readonly buildings: readonly { readonly code: string; readonly name: string }[];
  readonly floors: readonly number[];
  readonly departments: readonly Department[];
}) {
  return (
    <form
      action="/admin/heatmap"
      method="get"
      aria-label="Heatmap filters"
      className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Select name="days" label="Opened in" value={String(filters.days)}>
        {HEATMAP_WINDOWS.map((days) => (
          <option key={days} value={days}>
            Last {days} days
          </option>
        ))}
      </Select>
      <Select name="building" label="Building" value={filters.building ?? ""}>
        <option value="">All buildings</option>
        {buildings.map((building) => (
          <option key={building.code} value={building.code}>
            {building.name}
          </option>
        ))}
      </Select>
      <Select
        name="floor"
        label="Floor"
        value={filters.floor === undefined ? "" : String(filters.floor)}
      >
        <option value="">All floors</option>
        {floors.map((floor) => (
          <option key={floor} value={floor}>
            Floor {floor}
          </option>
        ))}
      </Select>
      <Select name="status" label="Status" value={filters.status}>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select name="category" label="Category" value={filters.category ?? ""}>
        <option value="">All categories</option>
        {COMPLAINT_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </option>
        ))}
      </Select>
      <Select name="department" label="Department" value={filters.department ?? ""}>
        <option value="">All departments</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </Select>
      <Select name="synthetic" label="Demo history" value={filters.synthetic}>
        <option value="include">Include labelled demo cases</option>
        <option value="exclude">Real cases only</option>
      </Select>
      <div className="flex items-end">
        <button type="submit" className={buttonClassName({ variant: "primary", size: "md" })}>
          Apply filters
        </button>
      </div>
    </form>
  );
}
