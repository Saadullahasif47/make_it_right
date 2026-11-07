/**
 * Generates the synthetic before/after evaluation set for plan v2 A5.04 / F4.06: 30 labelled
 * pairs of drawn campus repairs. No real photos, places or people (owner's decision for the
 * photo evaluations, 2026-11-05). Deterministic: the same files every run.
 *
 *   node scripts/generate-verification-dataset.mts
 *
 * Labels (what a careful person would say from the two pictures alone):
 *   visually_improved    the drawn fault is gone in the after picture
 *   possibly_unresolved  the fault, or part of it, is still visible
 *   inconclusive         the after picture is too dark or blurred to compare
 *   not_comparable       the after picture shows a different object
 *
 * Writes tests/eval/verification/images/*.png and tests/eval/verification/dataset.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BLACK,
  Canvas,
  DARK_WOOD,
  FLOOR,
  GROUT,
  SCENES,
  STEEL,
  W,
  WALL,
  WATER,
  WHITE,
  WOOD,
  rng,
  room,
  tiledWall,
  type Scene,
} from "./lib/scenes.mts";

// ------------------------------------------------------------------------------------------------
// After-repair scenes: the same places with the fault removed (or only partly removed)
// ------------------------------------------------------------------------------------------------
const AFTER: Readonly<Record<string, Scene>> = {
  sink_dry: () => tiledWall().rect(60, 70, 120, 80, WOOD).rect(60, 70, 120, 4, DARK_WOOD),
  sink_smaller_puddle: () =>
    tiledWall()
      .rect(60, 70, 120, 80, WOOD)
      .rect(60, 70, 120, 4, DARK_WOOD)
      .ellipse(130, 160, 30, 8, WATER),
  tap_dry: () => {
    const c = tiledWall().ellipse(120, 95, 70, 22, WHITE).ellipse(120, 92, 58, 14, [220, 224, 228]);
    return c.rect(112, 40, 16, 34, STEEL).rect(112, 40, 40, 10, STEEL);
  },
  pipe_dry: () => tiledWall().rect(0, 60, W, 14, STEEL).rect(110, 56, 20, 22, [120, 126, 132]),
  socket_ok: () =>
    tiledWall()
      .rect(90, 60, 60, 60, WHITE)
      .ellipse(108, 90, 6, 9, BLACK)
      .ellipse(132, 90, 6, 9, BLACK),
  light_ok: () =>
    new Canvas()
      .fill([236, 236, 230])
      .rect(0, 0, W, 30, [244, 244, 240])
      .line(120, 30, 120, 80, 3, STEEL)
      .polygon(
        [
          [90, 80],
          [150, 80],
          [140, 100],
          [100, 100],
        ],
        STEEL,
      )
      .ellipse(120, 108, 14, 12, [255, 250, 200]),
  tube_ok: () =>
    new Canvas()
      .fill([220, 222, 224])
      .rect(0, 0, W, 60, [244, 244, 240])
      .rect(40, 30, 160, 14, [255, 255, 230])
      .rect(36, 26, 168, 4, STEEL),
  chair_ok: () =>
    room()
      .rect(80, 50, 80, 12, WOOD)
      .rect(80, 50, 10, 60, WOOD)
      .rect(70, 100, 100, 10, WOOD)
      .rect(72, 110, 8, 40, WOOD)
      .rect(160, 110, 8, 40, WOOD),
  desk_ok: () =>
    room()
      .rect(30, 80, 180, 16, WOOD)
      .rect(40, 96, 10, 50, DARK_WOOD)
      .rect(190, 96, 10, 50, DARK_WOOD),
  window_ok: () =>
    room()
      .rect(50, 20, 140, 90, [160, 200, 230])
      .rect(50, 20, 140, 6, WHITE)
      .rect(117, 20, 6, 90, WHITE),
  bin_ok: () => room().rect(90, 70, 60, 70, [60, 120, 70]).ellipse(120, 70, 40, 14, [70, 70, 74]),
  bin_half: () => {
    const c = room().rect(90, 70, 60, 70, [60, 120, 70]).ellipse(120, 70, 40, 14, [70, 70, 74]);
    const r = rng(3);
    for (let i = 0; i < 6; i += 1)
      c.rect(60 + Math.floor(r() * 120), 130 + Math.floor(r() * 40), 10, 7, [200, 140, 90]);
    return c;
  },
  floor_clean: () => new Canvas().fill(FLOOR).tiles(40, [150, 144, 134]),
  tile_ok: () => new Canvas().fill(FLOOR).tiles(60, [150, 144, 134]),
  ceiling_ok: () => new Canvas().fill([236, 236, 232]).tiles(60, GROUT),
  ceiling_stain_faded: () =>
    new Canvas().fill([236, 236, 232]).tiles(60, GROUT).ellipse(120, 70, 40, 26, [220, 208, 180]),
  monitor_ok: () =>
    room().rect(30, 120, 180, 12, WOOD).rect(60, 30, 120, 80, BLACK).rect(112, 110, 16, 12, STEEL),
  door_ok: () =>
    room()
      .rect(70, 10, 100, 122, [120, 100, 80])
      .rect(80, 20, 80, 110, [176, 134, 92])
      .ellipse(150, 80, 4, 4, STEEL),
  wall_painted: () => new Canvas().fill([214, 196, 170]),
  toilet_clean: () =>
    new Canvas()
      .fill(WALL)
      .rect(0, 120, W, 60, [210, 214, 218])
      .rect(95, 40, 50, 40, WHITE)
      .ellipse(120, 110, 40, 26, WHITE)
      .ellipse(120, 106, 28, 14, [200, 220, 235]),
};

const scene = (name: string): Canvas => {
  const draw = AFTER[name] ?? SCENES[name];
  if (draw === undefined) throw new Error(`unknown scene ${name}`);
  return draw();
};

// ------------------------------------------------------------------------------------------------
// The labelled pairs
// ------------------------------------------------------------------------------------------------
type Label = "visually_improved" | "possibly_unresolved" | "inconclusive" | "not_comparable";
type Kind = "fixed" | "unfixed" | "partial" | "poor_after" | "different";

interface Pair {
  readonly id: string;
  readonly kind: Kind;
  readonly before: string;
  readonly after: string;
  /** How the after picture is degraded, if at all. */
  readonly degrade?: "dark" | "blurry";
  readonly title: string;
  readonly description: string;
  readonly label: Label;
}

const pair = (
  kind: Kind,
  before: string,
  after: string,
  title: string,
  description: string,
  label: Label,
  degrade?: "dark" | "blurry",
): Omit<Pair, "id"> => ({
  kind,
  before,
  after,
  title,
  description,
  label,
  ...(degrade === undefined ? {} : { degrade }),
});

const PAIRS: readonly Omit<Pair, "id">[] = [
  // Fixed (14): the fault is gone.
  pair(
    "fixed",
    "sink_puddle",
    "sink_dry",
    "Water under the sink",
    "A puddle forms under the sink cabinet.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "dripping_tap",
    "tap_dry",
    "Dripping tap",
    "The tap drips all day.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "pipe_leak",
    "pipe_dry",
    "Leaking pipe",
    "Water sprays from a joint in the pipe.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "sparking_socket",
    "socket_ok",
    "Socket sparks",
    "The wall socket sparks and is scorched.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "broken_light",
    "light_ok",
    "Broken light fitting",
    "The light fitting is broken and hanging.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "flickering_tube",
    "tube_ok",
    "Tube light half dark",
    "Half of the tube light is dark.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "broken_chair",
    "chair_ok",
    "Broken chair",
    "A chair leg has snapped off.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "cracked_desk",
    "desk_ok",
    "Cracked desk",
    "The desk top has a broken piece.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "broken_window",
    "window_ok",
    "Cracked window",
    "The window pane is cracked.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "overflowing_bin",
    "bin_ok",
    "Rubbish around the bin",
    "Rubbish is scattered around the bin.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "dirty_floor",
    "floor_clean",
    "Stained floor",
    "The floor has dirty stains.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "broken_tile",
    "tile_ok",
    "Cracked floor tile",
    "A floor tile is cracked and chipped.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "missing_ceiling_tile",
    "ceiling_ok",
    "Missing ceiling tile",
    "A ceiling tile is missing.",
    "visually_improved",
  ),
  pair(
    "fixed",
    "door_off_hinge",
    "door_ok",
    "Door off its hinge",
    "The door hangs off its top hinge.",
    "visually_improved",
  ),
  // Unfixed (5): the same fault is still there.
  pair(
    "unfixed",
    "sink_puddle",
    "sink_puddle",
    "Water under the sink",
    "A puddle forms under the sink cabinet.",
    "possibly_unresolved",
  ),
  pair(
    "unfixed",
    "cracked_monitor",
    "cracked_monitor",
    "Cracked monitor",
    "The monitor screen is cracked.",
    "possibly_unresolved",
  ),
  pair(
    "unfixed",
    "broken_chair",
    "broken_chair",
    "Broken chair",
    "A chair leg has snapped off.",
    "possibly_unresolved",
  ),
  pair(
    "unfixed",
    "peeling_paint",
    "peeling_paint",
    "Peeling paint",
    "Paint is peeling off the wall.",
    "possibly_unresolved",
  ),
  pair(
    "unfixed",
    "dirty_toilet",
    "dirty_toilet",
    "Dirty toilet",
    "The toilet bowl is stained.",
    "possibly_unresolved",
  ),
  // Partly fixed (3): some of the fault remains.
  pair(
    "partial",
    "sink_puddle",
    "sink_smaller_puddle",
    "Water under the sink",
    "A puddle forms under the sink cabinet.",
    "possibly_unresolved",
  ),
  pair(
    "partial",
    "overflowing_bin",
    "bin_half",
    "Rubbish around the bin",
    "Rubbish is scattered around the bin.",
    "possibly_unresolved",
  ),
  pair(
    "partial",
    "ceiling_leak_stain",
    "ceiling_stain_faded",
    "Ceiling stain",
    "A brown leak stain on the ceiling.",
    "possibly_unresolved",
  ),
  // Poor after picture (4): fixed, but too dark or blurred to tell.
  pair(
    "poor_after",
    "dripping_tap",
    "tap_dry",
    "Dripping tap",
    "The tap drips all day.",
    "inconclusive",
    "dark",
  ),
  pair(
    "poor_after",
    "broken_chair",
    "chair_ok",
    "Broken chair",
    "A chair leg has snapped off.",
    "inconclusive",
    "dark",
  ),
  pair(
    "poor_after",
    "broken_window",
    "window_ok",
    "Cracked window",
    "The window pane is cracked.",
    "inconclusive",
    "blurry",
  ),
  pair(
    "poor_after",
    "sparking_socket",
    "socket_ok",
    "Socket sparks",
    "The wall socket sparks and is scorched.",
    "inconclusive",
    "blurry",
  ),
  // Different object (4): the after picture shows something else.
  pair(
    "different",
    "sink_puddle",
    "chair_ok",
    "Water under the sink",
    "A puddle forms under the sink cabinet.",
    "not_comparable",
  ),
  pair(
    "different",
    "broken_light",
    "desk_ok",
    "Broken light fitting",
    "The light fitting is broken and hanging.",
    "not_comparable",
  ),
  pair(
    "different",
    "dirty_toilet",
    "window_ok",
    "Dirty toilet",
    "The toilet bowl is stained.",
    "not_comparable",
  ),
  pair(
    "different",
    "cracked_desk",
    "wall_painted",
    "Cracked desk",
    "The desk top has a broken piece.",
    "not_comparable",
  ),
];

const root = join(process.cwd(), "tests", "eval", "verification");
mkdirSync(join(root, "images"), { recursive: true });

const pairs: Pair[] = PAIRS.map((item, index) => ({
  id: `r${String(index + 1).padStart(2, "0")}-${item.kind}`,
  ...item,
}));
for (const item of pairs) {
  const before = scene(item.before);
  const after = scene(item.after);
  // An unfixed pair is a second photo of the same scene: same drawing, slight sensor noise.
  if (item.kind === "unfixed") after.darken(0.97, rng(17));
  if (item.degrade === "dark") after.darken(0.16, rng(11));
  if (item.degrade === "blurry") after.blur(5);
  writeFileSync(join(root, "images", `${item.id}-before.png`), before.png());
  writeFileSync(join(root, "images", `${item.id}-after.png`), after.png());
}
writeFileSync(
  join(root, "dataset.json"),
  `${JSON.stringify({ version: 1, synthetic: true, pairs }, null, 2)}\n`,
);
process.stdout.write(`wrote ${String(pairs.length)} pairs to ${root}\n`);
