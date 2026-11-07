/**
 * A tiny dependency-free raster and the drawn campus scenes shared by the synthetic evaluation
 * sets (plan v2 A2.03 photos, A5.04 before/after pairs). Deterministic: same pixels every run.
 */
import { deflateSync } from "node:zlib";

export const W = 240;
export const H = 180;
export type Rgb = readonly [number, number, number];

// ------------------------------------------------------------------------------------------------
// A tiny raster: enough to draw recognisable scenes without any dependency.
// ------------------------------------------------------------------------------------------------
export class Canvas {
  readonly pixels = new Uint8Array(W * H * 3);

  set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (Math.floor(y) * W + Math.floor(x)) * 3;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
  }

  fill(color: Rgb): this {
    return this.rect(0, 0, W, H, color);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): this {
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j += 1)
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i += 1) this.set(i, j, color);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgb): this {
    for (let j = cy - ry; j <= cy + ry; j += 1)
      for (let i = cx - rx; i <= cx + rx; i += 1)
        if (((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2 <= 1) this.set(i, j, color);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgb): this {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let s = 0; s <= steps; s += 1) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      this.ellipse(x, y, width / 2, width / 2, color);
    }
    return this;
  }

  polygon(points: readonly (readonly [number, number])[], color: Rgb): this {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    for (let j = Math.min(...ys); j <= Math.max(...ys); j += 1)
      for (let i = Math.min(...xs); i <= Math.max(...xs); i += 1) {
        let inside = false;
        for (let a = 0, b = points.length - 1; a < points.length; b = a, a += 1) {
          const [xa, ya] = points[a] ?? [0, 0];
          const [xb, yb] = points[b] ?? [0, 0];
          if (ya > j !== yb > j && i < ((xb - xa) * (j - ya)) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) this.set(i, j, color);
      }
    return this;
  }

  tiles(spacing: number, color: Rgb, top = 0, bottom = H): this {
    for (let x = 0; x < W; x += spacing) this.line(x, top, x, bottom, 1, color);
    for (let y = top; y < bottom; y += spacing) this.line(0, y, W, y, 1, color);
    return this;
  }

  blur(radius: number): this {
    const source = this.pixels.slice();
    for (let y = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1)
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          let count = 0;
          for (let dy = -radius; dy <= radius; dy += 1)
            for (let dx = -radius; dx <= radius; dx += 1) {
              const sx = Math.min(W - 1, Math.max(0, x + dx));
              const sy = Math.min(H - 1, Math.max(0, y + dy));
              sum += source[(sy * W + sx) * 3 + c] ?? 0;
              count += 1;
            }
          this.pixels[(y * W + x) * 3 + c] = Math.round(sum / count);
        }
    return this;
  }

  darken(factor: number, noise: () => number): this {
    for (let i = 0; i < this.pixels.length; i += 1)
      this.pixels[i] = Math.max(
        0,
        Math.min(255, (this.pixels[i] ?? 0) * factor + (noise() - 0.5) * 18),
      );
    return this;
  }

  png(): Buffer {
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y += 1) {
      raw[y * (W * 3 + 1)] = 0;
      Buffer.from(this.pixels.subarray(y * W * 3, (y + 1) * W * 3)).copy(raw, y * (W * 3 + 1) + 1);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (data: Buffer) => {
      let c = 0xffffffff;
      for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE(crc(body));
      return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(W, 0);
    header.writeUInt32BE(H, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/** Seeded PRNG (mulberry32), so every run draws the same images. */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------
// Palette and scenes
// ------------------------------------------------------------------------------------------------
export const WALL: Rgb = [226, 229, 231];
export const GROUT: Rgb = [196, 200, 204];
export const FLOOR: Rgb = [176, 168, 156];
export const WOOD: Rgb = [128, 96, 64];
export const DARK_WOOD: Rgb = [90, 66, 46];
export const WATER: Rgb = [92, 150, 210];
export const WHITE: Rgb = [248, 248, 246];
export const STEEL: Rgb = [150, 156, 162];
export const BLACK: Rgb = [24, 24, 28];
export const SPARK: Rgb = [255, 214, 40];
export const STAIN: Rgb = [140, 110, 70];

export const room = (c = new Canvas()) =>
  c.fill(WALL).rect(0, 130, W, 50, FLOOR).line(0, 130, W, 130, 2, GROUT);
export const tiledWall = () => new Canvas().fill(WALL).tiles(40, GROUT);

export type Scene = () => Canvas;

export const SCENES: Readonly<Record<string, Scene>> = {
  sink_puddle: () =>
    tiledWall()
      .rect(60, 70, 120, 80, WOOD)
      .rect(60, 70, 120, 4, DARK_WOOD)
      .ellipse(120, 160, 70, 14, WATER),
  dripping_tap: () => {
    const c = tiledWall().ellipse(120, 95, 70, 22, WHITE).ellipse(120, 92, 58, 14, [220, 224, 228]);
    c.rect(112, 40, 16, 34, STEEL).rect(112, 40, 40, 10, STEEL);
    for (const y of [82, 104, 126, 148]) c.ellipse(148, y, 3, 5, WATER);
    return c.ellipse(150, 166, 30, 6, WATER);
  },
  pipe_leak: () => {
    const c = tiledWall().rect(0, 60, W, 14, STEEL).rect(110, 56, 20, 22, [120, 126, 132]);
    for (const dx of [-14, -6, 2, 10, 18]) c.line(120, 74, 120 + dx, 150, 2, WATER);
    return c.ellipse(120, 160, 60, 12, WATER);
  },
  toilet_overflow: () =>
    new Canvas()
      .fill(WALL)
      .rect(0, 120, W, 60, [210, 214, 218])
      .tiles(30, GROUT, 120)
      .rect(95, 40, 50, 40, WHITE)
      .ellipse(120, 110, 40, 26, WHITE)
      .ellipse(120, 106, 28, 14, WATER)
      .ellipse(120, 160, 90, 16, WATER),
  ceiling_leak_stain: () =>
    new Canvas()
      .fill([236, 236, 232])
      .tiles(60, GROUT)
      .ellipse(120, 70, 50, 34, [200, 180, 140])
      .ellipse(120, 70, 34, 22, STAIN)
      .ellipse(120, 120, 4, 7, WATER)
      .ellipse(120, 150, 4, 7, WATER),
  sparking_socket: () => {
    const c = tiledWall()
      .rect(90, 60, 60, 60, WHITE)
      .ellipse(108, 90, 6, 9, BLACK)
      .ellipse(132, 90, 6, 9, BLACK);
    c.ellipse(140, 80, 22, 16, [60, 50, 40]);
    c.line(150, 70, 170, 55, 3, SPARK)
      .line(170, 55, 162, 45, 3, SPARK)
      .line(150, 70, 180, 80, 3, SPARK);
    return c.line(180, 80, 190, 70, 3, SPARK);
  },
  exposed_wires: () => {
    const c = room().ellipse(120, 60, 34, 24, [80, 70, 60]);
    c.line(110, 60, 95, 120, 4, [200, 40, 40]).line(120, 60, 122, 125, 4, [40, 80, 200]);
    return c.line(130, 60, 150, 118, 4, [220, 200, 40]).ellipse(150, 120, 6, 4, SPARK);
  },
  broken_light: () =>
    new Canvas()
      .fill([210, 212, 214])
      .rect(0, 0, W, 30, [236, 236, 232])
      .line(120, 30, 100, 80, 3, STEEL)
      .polygon(
        [
          [70, 80],
          [130, 80],
          [120, 100],
          [80, 100],
        ],
        STEEL,
      )
      .ellipse(100, 108, 14, 12, [180, 180, 170])
      .line(92, 100, 108, 116, 2, BLACK)
      .line(108, 100, 94, 114, 2, BLACK),
  flickering_tube: () =>
    new Canvas()
      .fill([200, 202, 204])
      .rect(0, 0, W, 60, [236, 236, 232])
      .rect(40, 30, 160, 14, [255, 255, 230])
      .rect(120, 30, 80, 14, [70, 70, 74])
      .rect(36, 26, 168, 4, STEEL),
  broken_switch: () =>
    tiledWall()
      .rect(95, 55, 50, 70, WHITE)
      .line(95, 55, 145, 125, 2, BLACK)
      .rect(110, 75, 20, 30, [70, 70, 74])
      .line(116, 80, 124, 100, 2, [200, 40, 40]),
  cracked_monitor: () => {
    const c = room()
      .rect(30, 120, 180, 12, WOOD)
      .rect(60, 30, 120, 80, BLACK)
      .rect(112, 110, 16, 12, STEEL);
    c.line(120, 70, 70, 40, 2, WHITE)
      .line(120, 70, 170, 50, 2, WHITE)
      .line(120, 70, 100, 105, 2, WHITE);
    return c.line(120, 70, 160, 100, 2, WHITE);
  },
  projector_error: () =>
    room()
      .rect(50, 30, 140, 80, [40, 90, 200])
      .polygon(
        [
          [120, 45],
          [150, 95],
          [90, 95],
        ],
        WHITE,
      )
      .rect(117, 60, 6, 20, [40, 90, 200])
      .rect(117, 84, 6, 6, [40, 90, 200])
      .rect(100, 0, 40, 14, STEEL),
  broken_keyboard: () => {
    const c = new Canvas().fill(WOOD).rect(20, 60, 200, 70, [60, 62, 66]);
    for (let row = 0; row < 4; row += 1)
      for (let col = 0; col < 12; col += 1)
        if (!((row === 1 && col > 3 && col < 7) || (row === 2 && col === 9)))
          c.rect(28 + col * 16, 68 + row * 15, 12, 11, [220, 222, 226]);
    return c;
  },
  printer_jam: () =>
    room()
      .rect(60, 70, 120, 60, [210, 212, 214])
      .rect(70, 60, 100, 12, [180, 182, 186])
      .polygon(
        [
          [90, 60],
          [150, 40],
          [160, 66],
          [100, 72],
        ],
        WHITE,
      )
      .line(110, 52, 140, 58, 1, GROUT)
      .ellipse(165, 115, 5, 5, [220, 30, 30]),
  network_cable: () =>
    tiledWall()
      .rect(80, 50, 80, 50, WHITE)
      .ellipse(100, 75, 6, 6, BLACK)
      .ellipse(140, 75, 6, 6, BLACK)
      .line(100, 81, 90, 130, 4, [40, 120, 200])
      .line(84, 140, 70, 170, 4, [40, 120, 200])
      .ellipse(88, 135, 4, 4, [200, 160, 40]),
  broken_chair: () => {
    const c = room()
      .rect(80, 50, 80, 12, WOOD)
      .rect(80, 50, 10, 60, WOOD)
      .rect(70, 100, 100, 10, WOOD);
    c.rect(72, 110, 8, 40, WOOD).rect(160, 110, 8, 18, WOOD);
    return c.line(166, 140, 186, 160, 6, WOOD);
  },
  cracked_desk: () =>
    room()
      .rect(30, 80, 180, 16, WOOD)
      .rect(40, 96, 10, 50, DARK_WOOD)
      .rect(190, 96, 10, 50, DARK_WOOD)
      .polygon(
        [
          [110, 80],
          [128, 80],
          [118, 96],
          [104, 96],
        ],
        [60, 44, 30],
      ),
  door_off_hinge: () =>
    room()
      .rect(70, 10, 100, 122, [120, 100, 80])
      .polygon(
        [
          [80, 20],
          [158, 34],
          [148, 132],
          [70, 120],
        ],
        [176, 134, 92],
      )
      .ellipse(140, 80, 4, 4, STEEL),
  broken_window: () => {
    const c = room()
      .rect(50, 20, 140, 90, [160, 200, 230])
      .rect(50, 20, 140, 6, WHITE)
      .rect(117, 20, 6, 90, WHITE);
    return c
      .line(80, 40, 100, 70, 2, WHITE)
      .line(100, 70, 70, 95, 2, WHITE)
      .line(100, 70, 112, 50, 2, WHITE);
  },
  broken_cupboard: () =>
    room()
      .rect(70, 30, 100, 100, WOOD)
      .rect(75, 35, 42, 90, DARK_WOOD)
      .polygon(
        [
          [124, 36],
          [170, 48],
          [168, 132],
          [122, 126],
        ],
        [160, 120, 84],
      ),
  overflowing_bin: () => {
    const c = room().rect(90, 70, 60, 70, [60, 120, 70]).ellipse(120, 70, 40, 14, [70, 70, 74]);
    const r = rng(3);
    for (let i = 0; i < 18; i += 1)
      c.rect(60 + Math.floor(r() * 120), 130 + Math.floor(r() * 40), 10, 7, [
        180 + Math.floor(r() * 60),
        140,
        90,
      ]);
    return c;
  },
  dirty_floor: () => {
    const c = new Canvas().fill(FLOOR).tiles(40, [150, 144, 134]);
    const r = rng(5);
    for (let i = 0; i < 9; i += 1)
      c.ellipse(20 + r() * 200, 20 + r() * 140, 10 + r() * 14, 6 + r() * 8, STAIN);
    return c;
  },
  pests: () => {
    const c = new Canvas().fill(FLOOR).tiles(40, [150, 144, 134]).rect(0, 0, W, 50, WALL);
    const r = rng(7);
    for (let i = 0; i < 40; i += 1) c.ellipse(30 + r() * 180, 70 + r() * 100, 3, 2, BLACK);
    return c.ellipse(170, 120, 14, 8, [90, 80, 78]).line(184, 120, 200, 112, 2, [90, 80, 78]);
  },
  dirty_toilet: () =>
    new Canvas()
      .fill(WALL)
      .rect(0, 120, W, 60, [210, 214, 218])
      .rect(95, 40, 50, 40, WHITE)
      .ellipse(120, 110, 40, 26, WHITE)
      .ellipse(120, 106, 28, 14, STAIN)
      .ellipse(104, 128, 8, 5, STAIN),
  rubbish_bags: () =>
    room()
      .ellipse(80, 140, 30, 24, BLACK)
      .ellipse(130, 146, 28, 20, [40, 40, 44])
      .ellipse(170, 150, 22, 16, BLACK)
      .rect(110, 160, 14, 8, [200, 180, 60]),
  peeling_paint: () => {
    const c = new Canvas().fill([214, 196, 170]);
    return c
      .polygon(
        [
          [60, 40],
          [120, 30],
          [140, 80],
          [90, 100],
          [50, 80],
        ],
        [150, 130, 110],
      )
      .ellipse(170, 120, 26, 18, [150, 130, 110]);
  },
  broken_tile: () =>
    new Canvas()
      .fill(FLOOR)
      .tiles(60, [150, 144, 134])
      .line(70, 70, 110, 110, 2, BLACK)
      .line(90, 90, 116, 74, 2, BLACK)
      .polygon(
        [
          [98, 98],
          [112, 100],
          [106, 112],
        ],
        [90, 84, 76],
      ),
  missing_ceiling_tile: () =>
    new Canvas()
      .fill([236, 236, 232])
      .tiles(60, GROUT)
      .rect(61, 61, 59, 59, [40, 40, 44])
      .line(70, 70, 100, 110, 2, [120, 120, 124]),
  landscape: () =>
    new Canvas()
      .fill([150, 200, 240])
      .ellipse(190, 40, 18, 18, SPARK)
      .rect(0, 120, W, 60, [90, 160, 80])
      .rect(50, 80, 10, 40, DARK_WOOD)
      .ellipse(55, 70, 26, 22, [60, 130, 60]),
  blank_wall: () => new Canvas().fill([220, 222, 224]),
};
