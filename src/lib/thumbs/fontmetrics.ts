import fs from "node:fs";
import path from "node:path";
import { FONTS_DIR } from "../paths";

/**
 * Medición exacta del ancho de un texto con las fuentes incluidas (tablas cmap + hmtx
 * del archivo OpenType). Permite ajustar los titulares de las miniaturas al píxel:
 * letras lo más grandes posible sin salirse del diseño.
 */
type Metrics = { unitsPerEm: number; advances: number[]; glyph: Map<number, number>; ascender: number; descender: number };
const cache = new Map<string, Metrics>();

function parse(file: string): Metrics {
  const d = fs.readFileSync(file);
  const n = d.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < n; i++) tables.set(d.toString("latin1", 12 + 16 * i, 16 + 16 * i), d.readUInt32BE(12 + 16 * i + 8));
  const head = tables.get("head")!;
  const hhea = tables.get("hhea")!;
  const hmtx = tables.get("hmtx")!;
  const maxp = tables.get("maxp")!;
  const cmap = tables.get("cmap")!;
  const unitsPerEm = d.readUInt16BE(head + 18);
  const ascender = d.readInt16BE(hhea + 4);
  const descender = d.readInt16BE(hhea + 6);
  const numH = d.readUInt16BE(hhea + 34);
  const numGlyphs = d.readUInt16BE(maxp + 4);
  const advances: number[] = [];
  for (let g = 0; g < numGlyphs; g++) advances.push(d.readUInt16BE(hmtx + 4 * Math.min(g, numH - 1)));
  const glyph = new Map<number, number>();
  const subs = d.readUInt16BE(cmap + 2);
  let best = -1;
  let bestFmt = 0;
  for (let i = 0; i < subs; i++) {
    const pid = d.readUInt16BE(cmap + 4 + 8 * i);
    const eid = d.readUInt16BE(cmap + 6 + 8 * i);
    const off = cmap + d.readUInt32BE(cmap + 8 + 8 * i);
    const fmt = d.readUInt16BE(off);
    if ((pid === 3 && (eid === 1 || eid === 10)) || pid === 0) {
      if (fmt === 12 || (fmt === 4 && bestFmt !== 12)) {
        best = off;
        bestFmt = fmt;
      }
    }
  }
  if (bestFmt === 4) {
    const segX2 = d.readUInt16BE(best + 6);
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = d.readUInt16BE(ends + 2 * s);
      const start = d.readUInt16BE(starts + 2 * s);
      const delta = d.readInt16BE(deltas + 2 * s);
      const ro = d.readUInt16BE(ranges + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + 2 * s + ro + 2 * (c - start);
          g = d.readUInt16BE(gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) glyph.set(c, g);
      }
    }
  } else if (bestFmt === 12) {
    const groups = d.readUInt32BE(best + 12);
    for (let i = 0; i < groups; i++) {
      const o = best + 16 + 12 * i;
      const s = d.readUInt32BE(o);
      const e = d.readUInt32BE(o + 4);
      const g0 = d.readUInt32BE(o + 8);
      for (let c = s; c <= e && c - s < 70000; c++) glyph.set(c, g0 + (c - s));
    }
  }
  return { unitsPerEm, advances, glyph, ascender, descender };
}

function metrics(font: string) {
  let m = cache.get(font);
  if (!m) {
    m = parse(path.join(FONTS_DIR, font));
    cache.set(font, m);
  }
  return m;
}

/** Ancho en píxeles de `text` dibujado con `font` a `size` px (tamaño de FFmpeg drawtext). */
export function textWidth(text: string, font: string, size: number) {
  const m = metrics(font);
  let units = 0;
  for (const ch of text) {
    const g = m.glyph.get(ch.codePointAt(0)!) ?? 0;
    units += m.advances[g] ?? m.unitsPerEm * 0.6;
  }
  return (units / m.unitsPerEm) * size;
}

/** Alto de línea (ascendente + descendente) en píxeles. */
export function lineHeight(font: string, size: number) {
  const m = metrics(font);
  return ((m.ascender - m.descender) / m.unitsPerEm) * size;
}

export function ascent(font: string, size: number) {
  const m = metrics(font);
  return (m.ascender / m.unitsPerEm) * size;
}
