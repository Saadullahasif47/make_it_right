import Link from "next/link";

import { LocalTime } from "@/components/ui/local-time";
import { CATEGORY_LABELS, isComplaintCategory } from "@/features/complaints/categories";
import { cn } from "@/lib/utils/cn";

import {
  heatLevel,
  heatmapQuery,
  type Heatmap,
  type HeatmapFilters,
  type HeatmapRoom,
  type RoomCase,
} from "../schemas";

/** Fill per level: warm accent at rising strength; level 0 is an empty room. */
const LEVEL_FILL = [
  "fill-surface-muted",
  "fill-accent/20",
  "fill-accent/40",
  "fill-accent/65",
  "fill-accent",
] as const;
const LEVEL_LABELS = ["None", "Low", "Moderate", "High", "Highest"] as const;

const ROOM_W = 300;
const ROOM_H = 440;

/** Starts with the hotspot's visible text (room code, count), as WCAG "label in name" asks. */
function roomLabel(room: HeatmapRoom): string {
  return `${room.room_code} ${String(room.cases)} ${room.cases === 1 ? "case" : "cases"}, ${
    room.building_name
  }, floor ${String(room.floor)}, from ${String(room.reports)} ${
    room.reports === 1 ? "report" : "reports"
  }, weighted ${String(room.weighted)}, ${String(room.active)} still open`;
}

/**
 * One floor as an SVG plan (plan v2 F5.03). Each room is a link (keyboard reachable, with a full
 * accessible name) that opens its cases below the map.
 */
function FloorPlan({
  title,
  rooms,
  max,
  filters,
}: {
  readonly title: string;
  readonly rooms: readonly HeatmapRoom[];
  readonly max: number;
  readonly filters: HeatmapFilters;
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
      <svg
        viewBox="0 0 1000 1000"
        role="group"
        aria-label={`${title} floor plan`}
        className="w-full rounded-lg border border-line bg-surface"
      >
        {rooms.map((room) => {
          if (room.map_x === null || room.map_y === null) return null;
          const level = heatLevel(room.weighted, max);
          const selected = filters.room === room.location_id;
          const x = room.map_x - ROOM_W / 2;
          const y = room.map_y - ROOM_H / 2;
          return (
            <a
              key={room.location_id}
              href={`/admin/heatmap?${heatmapQuery(filters, { room: room.location_id })}#room-cases`}
              aria-label={roomLabel(room)}
              className="group outline-none"
            >
              <rect
                x={x + 10}
                y={y + 10}
                width={ROOM_W - 20}
                height={ROOM_H - 20}
                rx={24}
                className={cn(
                  LEVEL_FILL[level],
                  "stroke-line-strong stroke-[3] transition-[stroke] group-hover:stroke-ink group-focus-visible:stroke-brand group-focus-visible:stroke-[12]",
                  selected && "stroke-ink stroke-[10]",
                )}
              />
              <rect
                x={room.map_x - 90}
                y={room.map_y + 10}
                width={180}
                height={90}
                rx={45}
                className="fill-surface stroke-line"
              />
              {/*
                One text element, with a real space between room and count: the visible text then
                reads "LAB-204 3", which the accessible name starts with (WCAG label in name).
              */}
              <text
                x={room.map_x}
                y={room.map_y - 40}
                textAnchor="middle"
                className="fill-ink stroke-surface [stroke-width:14px] text-[52px] font-semibold [paint-order:stroke] [stroke-linejoin:round]"
              >
                {`${room.room_code} `}
                <tspan x={room.map_x} dy={112} className="stroke-none text-[56px] tabular-nums">
                  {room.cases}
                </tspan>
              </text>
            </a>
          );
        })}
      </svg>
    </figure>
  );
}

function Legend() {
  return (
    <ul
      aria-label="Colour scale"
      className="flex flex-wrap items-center gap-3 text-xs text-ink-muted"
    >
      {LEVEL_LABELS.map((label, level) => (
        <li key={label} className="flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
            <rect
              width="20"
              height="20"
              rx="4"
              className={cn(LEVEL_FILL[level], "stroke-line-strong")}
            />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The campus as floor plans, one per building floor, with the same numbers as a table (plan v2
 * F5.03: a table fallback must show the same data).
 */
export function CampusHeatmap({
  heatmap,
  filters,
}: {
  readonly heatmap: Heatmap;
  readonly filters: HeatmapFilters;
}) {
  const max = Math.max(0, ...heatmap.rooms.map((room) => room.weighted));
  const floors = new Map<string, HeatmapRoom[]>();
  for (const room of heatmap.rooms) {
    const key = `${room.building_name} · floor ${String(room.floor)}`;
    floors.set(key, [...(floors.get(key) ?? []), room]);
  }
  const busy = heatmap.rooms
    .filter((room) => room.cases > 0)
    .sort((a, b) => b.weighted - a.weighted || b.cases - a.cases);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          Colour shows a severity-weighted count (low 1, medium 2, high 3 per case), a display
          choice and not a safety score. The number in each room counts distinct cases.
        </p>
        <Legend />
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[...floors.entries()].map(([title, rooms]) => (
          <FloorPlan key={title} title={title} rooms={rooms} max={max} filters={filters} />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="px-4 pt-4 pb-2 text-left font-semibold text-ink">
            Rooms with cases, busiest first
          </caption>
          <thead className="border-y border-line bg-surface-muted text-xs text-ink-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Room
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Cases
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Reports
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Weighted
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Still open
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {busy.map((room) => (
              <tr key={room.location_id}>
                <th scope="row" className="px-4 py-2 font-normal">
                  <Link
                    href={`/admin/heatmap?${heatmapQuery(filters, { room: room.location_id })}#room-cases`}
                    className="underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    {room.display_name}
                  </Link>{" "}
                  <span className="text-ink-muted">(floor {room.floor})</span>
                </th>
                <td className="px-4 py-2 text-right tabular-nums">{room.cases}</td>
                <td className="px-4 py-2 text-right tabular-nums">{room.reports}</td>
                <td className="px-4 py-2 text-right tabular-nums">{room.weighted}</td>
                <td className="px-4 py-2 text-right tabular-nums">{room.active}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-2 font-normal text-ink-muted">
                Location unknown (not on the map)
              </th>
              <td className="px-4 py-2 text-right tabular-nums">{heatmap.unknown.cases}</td>
              <td className="px-4 py-2 text-right tabular-nums">{heatmap.unknown.reports}</td>
              <td className="px-4 py-2 text-right text-ink-muted">-</td>
              <td className="px-4 py-2 text-right text-ink-muted">-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function categoryLabel(category: string): string {
  return isComplaintCategory(category) ? CATEGORY_LABELS[category] : "Not classified";
}

/** The cases of the selected room (drilldown), each linking to a report of the case. */
export function RoomCases({
  room,
  cases,
}: {
  readonly room: HeatmapRoom | undefined;
  readonly cases: readonly RoomCase[];
}) {
  return (
    <section
      id="room-cases"
      aria-labelledby="room-cases-title"
      className="space-y-3 rounded-xl border border-line bg-surface p-5"
    >
      <h2 id="room-cases-title" className="text-base font-semibold text-ink">
        {room === undefined ? "Room" : `${room.display_name}, floor ${String(room.floor)}`}
      </h2>
      {cases.length === 0 ? (
        <p className="text-sm text-ink-muted">No cases in this view.</p>
      ) : (
        <ul className="divide-y divide-line">
          {cases.map((item) => (
            <li
              key={item.case_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              {item.complaint_id === null ? (
                <span className="font-mono">{item.reference}</span>
              ) : (
                <Link
                  href={`/admin/complaints/${item.complaint_id}`}
                  className="font-mono underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                >
                  {item.reference}
                </Link>
              )}
              <span className="text-ink">{categoryLabel(item.category)}</span>
              <span className="text-ink-muted">
                {item.status.replace("_", " ")} · {item.priority} priority · {item.reports}{" "}
                {item.reports === 1 ? "report" : "reports"}
                {item.asset_code === null ? "" : ` · ${item.asset_code}`}
              </span>
              <span className="text-xs text-ink-subtle">
                opened <LocalTime value={item.opened_at} />
                {item.synthetic ? " · demo history" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
