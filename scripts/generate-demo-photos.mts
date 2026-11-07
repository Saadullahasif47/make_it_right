/**
 * Drawn photos for the expo demo (plan v2 §17): a ceiling projector in LAB-204 showing its error
 * screen ("before") and the same projector working ("after"), plus a second "before" of the same
 * fault from another angle for the duplicate step. Fictional drawings, no real place or person.
 *
 *   node scripts/generate-demo-photos.mts
 *
 * Writes docs/demo/photos/*.png.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SCENES, STEEL, WHITE, room } from "./lib/scenes.mts";

const projectorWorking = () =>
  room()
    .rect(50, 30, 140, 80, WHITE)
    .rect(62, 42, 116, 10, [40, 90, 200])
    .rect(62, 60, 80, 6, [120, 126, 132])
    .rect(62, 72, 96, 6, [120, 126, 132])
    .rect(62, 84, 70, 6, [120, 126, 132])
    .rect(100, 0, 40, 14, STEEL);

const projectorError = SCENES.projector_error;
if (projectorError === undefined) throw new Error("missing projector scene");

const out = join(process.cwd(), "docs", "demo", "photos");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "projector-lab204-before.png"), projectorError().png());
writeFileSync(
  join(out, "projector-lab204-before-second-report.png"),
  projectorError().blur(1).png(),
);
writeFileSync(join(out, "projector-lab204-after.png"), projectorWorking().png());
process.stdout.write(`wrote 3 demo photos to ${out}\n`);
