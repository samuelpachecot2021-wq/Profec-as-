import fs from "node:fs";
import path from "node:path";
import { run } from "../util";
import { FONTS_DIR } from "../paths";
import { textWidth } from "./fontmetrics";

/**
 * Diseño de miniaturas con FFmpeg (sin navegador): fotografía, degradados, titular con
 * letras grandes y gruesas ajustadas al píxel, palabras clave resaltadas en una caja
 * de color y etiquetas. Sin marcas de agua, logos ni textos decorativos.
 */

export type Design = "protagonista" | "acontecimiento" | "impacto";
export type ThumbStyle = "noticias" | "biblico";

export const DESIGN_LABEL: Record<Design, string> = {
  protagonista: "Protagonista",
  acontecimiento: "Acontecimiento",
  impacto: "Titular de alto impacto",
};

type Palette = { accent: string; box: string; boxText: string; text: string; tagText: string; grade: string; tint: string };
const PALETTE: Record<ThumbStyle, Palette> = {
  noticias: {
    accent: "0xE11D2A",
    box: "0xFFD60A",
    boxText: "0x0A0A0A",
    text: "white",
    tagText: "white",
    grade: "eq=contrast=1.12:saturation=1.12:brightness=0.01,unsharp=5:5:0.7",
    tint: "colorchannelmixer=rr=0.9:gg=0.55:bb=0.55",
  },
  biblico: {
    accent: "0xC9962B",
    box: "0xE8B845",
    boxText: "0x0A0A0A",
    text: "white",
    tagText: "0x111111",
    grade: "eq=contrast=1.1:saturation=1.08,colorbalance=rm=0.05:gm=0.02:bm=-0.05,unsharp=5:5:0.6",
    tint: "colorchannelmixer=rr=0.85:gg=0.68:bb=0.45",
  },
};

const HEAVY = "Inter-Black.otf";
const BOLD = "Inter-Bold.otf";
const CAP = 0.727; // altura de las mayúsculas de Inter (fracción del tamaño)

export type RenderInput = {
  design: Design;
  style: ThumbStyle;
  w: number;
  h: number;
  headline: string;
  highlight: string[];
  /** Foto principal (protagonista o acontecimiento). */
  photo?: string | null;
  /** Foto de fondo (lugar o acontecimiento); si falta, se usa la principal. */
  bg?: string | null;
  /** Etiqueta superior: país, lugar o tema (texto verificado en el guion). */
  tag?: string | null;
  /** Nombre del protagonista (rótulo sobre su foto). */
  name?: string | null;
  /** Encuadre vertical de la foto (0 = arriba, 0,5 = centro). */
  focusY?: number;
  out: string;
  tmpDir: string;
};

const ff = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const font = (f: string) => ff(path.join(FONTS_DIR, f));
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();

type Token = { text: string; hl: boolean; w: number };
type Line = { tokens: Token[]; width: number };
export type TextLayout = { size: number; lines: Line[]; lineGap: number; padX: number; padY: number; space: number };

/** Palabras del titular, agrupando las resaltadas contiguas en un solo bloque. */
function tokenize(headline: string, highlight: string[]) {
  const hl = new Set(highlight.flatMap((h) => h.split(/\s+/)).map(norm).filter(Boolean));
  const words = headline.toLocaleUpperCase("es").split(/\s+/).filter(Boolean);
  const out: { text: string; hl: boolean }[] = [];
  for (const w of words) {
    const isHl = hl.has(norm(w));
    const last = out[out.length - 1];
    if (last && last.hl && isHl && last.text.split(" ").length < 3) last.text += ` ${w}`;
    else out.push({ text: w, hl: isHl });
  }
  return out;
}

/** Mejor reparto en `n` líneas: el que minimiza la línea más ancha (titulares cortos: búsqueda completa). */
function partition(tokens: Token[], n: number, space: number): Line[] | null {
  if (n > tokens.length) return null;
  let best: Line[] | null = null;
  let bestMax = Infinity;
  const rec = (start: number, left: number, acc: Line[]) => {
    if (left === 1) {
      const t = tokens.slice(start);
      const line = { tokens: t, width: t.reduce((a, x) => a + x.w, 0) + space * (t.length - 1) };
      const all = [...acc, line];
      const max = Math.max(...all.map((l) => l.width));
      // a igualdad, preferir la primera línea más corta (forma de pirámide invertida)
      if (max < bestMax - 0.5) {
        bestMax = max;
        best = all;
      }
      return;
    }
    for (let end = start + 1; end <= tokens.length - (left - 1); end++) {
      const t = tokens.slice(start, end);
      rec(end, left - 1, [...acc, { tokens: t, width: t.reduce((a, x) => a + x.w, 0) + space * (t.length - 1) }]);
    }
  };
  rec(0, n, []);
  return best;
}

/** Tamaño de letra más grande que cabe en la caja (ancho × alto) con hasta `maxLines` líneas. */
export function layoutText(headline: string, highlight: string[], boxW: number, boxH: number, maxLines: number, maxSize: number, minSize = 40): TextLayout {
  const raw = tokenize(headline, highlight);
  for (let size = maxSize; size >= minSize; size -= 2) {
    const padX = Math.round(size * 0.13);
    const padY = Math.round(size * 0.12);
    const space = textWidth(" ", HEAVY, size) * 1.05;
    const tokens = raw.map((t) => ({ ...t, w: textWidth(t.text, HEAVY, size) + (t.hl ? 2 * padX : 0) }));
    const lineGap = Math.round(size * CAP + 2 * padY + size * 0.2);
    for (let n = 1; n <= Math.min(maxLines, tokens.length); n++) {
      const lines = partition(tokens, n, space);
      if (!lines) continue;
      const height = n * lineGap - size * 0.2;
      if (Math.max(...lines.map((l) => l.width)) <= boxW && height <= boxH) return { size, lines, lineGap, padX, padY, space };
    }
  }
  // último recurso: tamaño mínimo y las líneas que hagan falta (se reduce horizontalmente al dibujar)
  const size = minSize;
  const padX = Math.round(size * 0.13);
  const padY = Math.round(size * 0.12);
  const space = textWidth(" ", HEAVY, size) * 1.05;
  const tokens = raw.map((t) => ({ ...t, w: textWidth(t.text, HEAVY, size) + (t.hl ? 2 * padX : 0) }));
  const lines = partition(tokens, Math.min(maxLines, tokens.length), space) ?? [{ tokens, width: tokens.reduce((a, t) => a + t.w, 0) }];
  return { size, lines, lineGap: Math.round(size * CAP + 2 * padY + size * 0.2), padX, padY, space };
}

/** Filtros drawbox/drawtext que dibujan el titular dentro de la caja. */
function drawHeadline(
  L: TextLayout,
  box: { x: number; y: number; w: number; h: number },
  align: "left" | "center",
  valign: "top" | "center" | "bottom",
  pal: Palette,
  tmpDir: string,
  prefix: string,
) {
  const f: string[] = [];
  const total = L.lines.length * L.lineGap - L.size * 0.2;
  let y0 = box.y;
  if (valign === "center") y0 = box.y + (box.h - total) / 2;
  if (valign === "bottom") y0 = box.y + box.h - total;
  const border = Math.max(3, Math.round(L.size * 0.05));
  const shadow = Math.max(2, Math.round(L.size * 0.035));
  let k = 0;
  L.lines.forEach((line, li) => {
    const baseline = Math.round(y0 + L.padY + L.size * CAP + li * L.lineGap);
    let x = align === "left" ? box.x : box.x + (box.w - line.width) / 2;
    for (const t of line.tokens) {
      const file = path.join(tmpDir, `${prefix}-${k++}.txt`);
      fs.writeFileSync(file, t.text);
      if (t.hl) {
        const bx = Math.round(x);
        const by = Math.round(baseline - L.size * CAP - L.padY);
        f.push(`drawbox=x=${bx + shadow}:y=${by + shadow}:w=${Math.round(t.w)}:h=${Math.round(L.size * CAP + 2 * L.padY)}:color=black@0.45:t=fill`);
        f.push(`drawbox=x=${bx}:y=${by}:w=${Math.round(t.w)}:h=${Math.round(L.size * CAP + 2 * L.padY)}:color=${pal.box}:t=fill`);
        f.push(`drawtext=fontfile='${font(HEAVY)}':textfile='${ff(file)}':fontsize=${L.size}:fontcolor=${pal.boxText}:x=${Math.round(x + L.padX)}:y=${baseline}:y_align=baseline`);
      } else {
        f.push(
          `drawtext=fontfile='${font(HEAVY)}':textfile='${ff(file)}':fontsize=${L.size}:fontcolor=${pal.text}:borderw=${border}:bordercolor=black:shadowx=${shadow}:shadowy=${shadow}:shadowcolor=black@0.55:x=${Math.round(x)}:y=${baseline}:y_align=baseline`,
        );
      }
      x += t.w + L.space;
    }
  });
  return { filters: f, top: Math.round(y0), bottom: Math.round(y0 + total) };
}

/** Etiqueta en una píldora de color (lugar, país, tema o nombre). */
function pill(text: string, x: number, y: number, size: number, bg: string, color: string, tmpDir: string, name: string, anchor: "left" | "right" | "center" = "left") {
  const t = text.toLocaleUpperCase("es").slice(0, 40);
  const file = path.join(tmpDir, `${name}.txt`);
  fs.writeFileSync(file, t);
  const tw = textWidth(t, BOLD, size);
  const padX = Math.round(size * 0.55);
  const padY = Math.round(size * 0.42);
  const w = Math.round(tw + 2 * padX);
  const h = Math.round(size * CAP + 2 * padY);
  const bx = anchor === "left" ? x : anchor === "right" ? x - w : x - w / 2;
  return {
    filters: [
      `drawbox=x=${Math.round(bx)}:y=${y}:w=${w}:h=${h}:color=${bg}:t=fill`,
      `drawtext=fontfile='${font(BOLD)}':textfile='${ff(file)}':fontsize=${size}:fontcolor=${color}:x=${Math.round(bx + padX)}:y=${Math.round(y + padY + size * CAP)}:y_align=baseline`,
    ],
    w,
    h,
  };
}

/** Escala y recorta una foto para cubrir w×h, con el encuadre vertical indicado. */
const cover = (w: number, h: number, fy = 0.3) => `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-${w})/2:(ih-${h})*${fy.toFixed(2)},setsar=1`;

/** Capa negra con transparencia en degradado (expresión de alfa en X/Y). */
const shade = (w: number, h: number, alpha: string) => `color=c=black:s=${w}x${h}:d=1,format=rgba,geq=r=0:g=0:b=0:a='${alpha}'`;

/** Genera una miniatura JPEG; si supera 2 MB (límite de YouTube) se recomprime. */
export async function renderThumbnail(i: RenderInput): Promise<{ file: string; bytes: number }> {
  fs.mkdirSync(i.tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(i.out), { recursive: true });
  const { w: W, h: H } = i;
  const vertical = H > W;
  const pal = PALETTE[i.style];
  const prefix = `${path.basename(i.out, ".jpg")}-${Date.now()}`;
  const inputs: string[] = [];
  const chains: string[] = [];
  const photo = i.photo ?? null;
  const bg = i.bg ?? photo;
  const fy = i.focusY ?? 0.3;
  let draws: string[] = [];
  const m = Math.round(Math.min(W, H) * 0.055); // margen
  const unit = Math.min(W, H);

  const addInput = (p: string) => {
    inputs.push("-i", p);
    return inputs.length / 2 - 1;
  };

  // ── Fondo ──
  if (bg) {
    const b = addInput(bg);
    if (i.design === "protagonista" && photo && bg === photo) chains.push(`[${b}:v]${cover(W, H, fy)},gblur=sigma=${Math.round(unit / 40)},eq=brightness=-0.12:saturation=0.8[bg]`);
    else if (i.design === "protagonista") chains.push(`[${b}:v]${cover(W, H, 0.4)},gblur=sigma=${Math.round(unit / 90)},${pal.grade},eq=brightness=-0.06[bg]`);
    else if (i.design === "impacto") chains.push(`[${b}:v]${cover(W, H, fy)},${pal.grade},${pal.tint},eq=brightness=-0.07:contrast=1.1,vignette=PI/3.6[bg]`);
    else chains.push(`[${b}:v]${cover(W, H, fy)},${pal.grade},vignette=PI/4.2[bg]`);
  } else {
    // sin foto: fondo oscuro con un resplandor del color del estilo
    chains.push(`color=c=0x0B0B0F:s=${W}x${H}:d=1,format=rgb24,geq=r='clip(11+${i.style === "noticias" ? 120 : 110}*exp(-((X-W*0.7)^2+(Y-H*0.35)^2)/(2*(W*0.35)^2)),0,255)':g='clip(11+${i.style === "noticias" ? 12 : 70}*exp(-((X-W*0.7)^2+(Y-H*0.35)^2)/(2*(W*0.35)^2)),0,255)':b='clip(15+${i.style === "noticias" ? 18 : 20}*exp(-((X-W*0.7)^2+(Y-H*0.35)^2)/(2*(W*0.35)^2)),0,255)'[bg]`);
  }
  let cur = "bg";
  const over = (label: string, x: number | string, y: number | string) => {
    const next = `o${chains.length}`;
    chains.push(`[${cur}][${label}]overlay=${x}:${y}:format=auto[${next}]`);
    cur = next;
  };

  // ── Composición ──
  let textBox: { x: number; y: number; w: number; h: number };
  let align: "left" | "center" = "left";
  let valign: "top" | "center" | "bottom" = "center";
  let maxLines = 3;
  let maxSize = Math.round(unit * (vertical ? 0.15 : 0.175));

  if (i.design === "protagonista") {
    if (vertical) {
      const ph = Math.round(H * 0.6);
      if (photo) {
        const p = addInput(photo);
        chains.push(`[${p}:v]${cover(W, ph, Math.min(fy, 0.2))},${pal.grade},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip((H-Y)/(H*0.28),0,1)'[ph]`);
        over("ph", 0, 0);
      }
      chains.push(`${shade(W, H, `255*clip((Y-H*0.45)/(H*0.3),0,0.88)`)}[sh]`);
      over("sh", 0, 0);
      textBox = { x: m, y: Math.round(H * (i.tag ? 0.655 : 0.61)), w: W - 2 * m, h: Math.round(H * (i.tag ? 0.24 : 0.27)) };
      align = "center";
      valign = "top";
      maxLines = 3;
      if (i.name) {
        const pl = pill(i.name, W / 2, Math.round(H * 0.525), Math.round(unit * 0.04), "black@0.75", "white", i.tmpDir, `${prefix}-name`, "center");
        draws.push(...pl.filters);
      }
    } else {
      const pw = Math.round(W * 0.56);
      if (photo) {
        const p = addInput(photo);
        chains.push(`[${p}:v]${cover(pw, H, Math.min(fy, 0.2))},${pal.grade},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(X/(W*0.32),0,1)'[ph]`);
        over("ph", W - pw, 0);
      }
      chains.push(`${shade(W, H, `255*clip(1-X/(W*0.62),0,0.86)`)}[sh]`);
      over("sh", 0, 0);
      textBox = { x: m + Math.round(unit * 0.01), y: Math.round(H * 0.2), w: Math.round(W * 0.5), h: Math.round(H * 0.68) };
      maxLines = 3;
      if (i.name) {
        const pl = pill(i.name, W - m, H - m - Math.round(unit * 0.07), Math.round(unit * 0.036), "black@0.75", "white", i.tmpDir, `${prefix}-name`, "right");
        draws.push(...pl.filters);
      }
    }
    if (i.tag) {
      const pl = pill(i.tag, vertical ? Math.round(W / 2) : textBox.x, vertical ? Math.round(H * 0.6) : m, Math.round(unit * 0.05), pal.accent, pal.tagText, i.tmpDir, `${prefix}-tag`, vertical ? "center" : "left");
      draws.push(...pl.filters);
    }
  } else if (i.design === "acontecimiento") {
    chains.push(`${shade(W, H, vertical ? `255*clip((Y-H*0.4)/(H*0.35),0,0.9)` : `255*clip((Y-H*0.35)/(H*0.5),0,0.9)`)}[sh]`);
    over("sh", 0, 0);
    if (vertical) {
      textBox = { x: m, y: Math.round(H * 0.58), w: W - 2 * m, h: Math.round(H * 0.3) };
      align = "center";
      valign = "bottom";
      maxLines = 4;
    } else {
      textBox = { x: m + Math.round(unit * 0.01), y: Math.round(H * 0.48), w: Math.round(W * 0.88), h: Math.round(H * 0.42) };
      valign = "bottom";
      maxLines = 2;
    }
    if (i.tag) {
      const pl = pill(i.tag, vertical ? Math.round(W / 2) : m + Math.round(unit * 0.01), vertical ? Math.round(H * 0.05) : m, Math.round(unit * 0.05), pal.accent, pal.tagText, i.tmpDir, `${prefix}-tag`, vertical ? "center" : "left");
      draws.push(...pl.filters);
    }
  } else {
    // impacto: titular gigante centrado con barras de acento
    chains.push(`${shade(W, H, `255*clip(0.18+0.36*abs(Y-H/2)/(H/2),0,0.55)`)}[sh]`);
    over("sh", 0, 0);
    textBox = vertical
      ? { x: m, y: Math.round(H * 0.24), w: W - 2 * m, h: Math.round(H * 0.5) }
      : { x: Math.round(W * 0.06), y: Math.round(H * 0.16), w: Math.round(W * 0.88), h: Math.round(H * 0.66) };
    align = "center";
    valign = "center";
    maxLines = vertical ? 4 : 3;
    maxSize = Math.round(unit * (vertical ? 0.17 : 0.2));
  }

  const L = layoutText(i.headline, i.highlight, textBox.w, textBox.h, maxLines, maxSize, Math.round(unit * 0.05));
  const hd = drawHeadline(L, textBox, align, valign, pal, i.tmpDir, `${prefix}-h`);
  // barra de acento junto al titular
  const barH = Math.max(8, Math.round(unit * 0.012));
  if (i.design === "impacto") {
    const bw = Math.round(Math.min(textBox.w, Math.max(...L.lines.map((l) => l.width))) * 0.5);
    draws.push(`drawbox=x=${Math.round(W / 2 - bw / 2)}:y=${hd.top - barH * 3}:w=${bw}:h=${barH}:color=${pal.accent}:t=fill`);
    draws.push(`drawbox=x=${Math.round(W / 2 - bw / 2)}:y=${hd.bottom + barH * 2}:w=${bw}:h=${barH}:color=${pal.accent}:t=fill`);
    if (i.tag) {
      const pl = pill(i.tag, Math.round(W / 2), Math.max(m, hd.top - barH * 3 - Math.round(unit * 0.12)), Math.round(unit * 0.042), pal.accent, pal.tagText, i.tmpDir, `${prefix}-tag`, "center");
      draws.push(...pl.filters);
    }
  } else if (align === "left") {
    draws.push(`drawbox=x=${textBox.x}:y=${hd.bottom + barH * 2}:w=${Math.round(Math.min(textBox.w, unit * 0.32))}:h=${barH}:color=${pal.accent}:t=fill`);
  } else {
    const bw = Math.round(unit * 0.3);
    draws.push(`drawbox=x=${Math.round(W / 2 - bw / 2)}:y=${hd.bottom + barH * 2}:w=${bw}:h=${barH}:color=${pal.accent}:t=fill`);
  }
  draws = [...draws, ...hd.filters];
  chains.push(`[${cur}]${draws.join(",")},format=yuvj420p[out]`);

  const encode = async (q: number) => {
    await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-frames:v", "1", "-q:v", String(q), i.out], { timeoutMs: 120_000 });
    return fs.statSync(i.out).size;
  };
  try {
    let bytes = await encode(2);
    for (const q of [4, 6, 9]) {
      if (bytes <= 1_950_000) break;
      bytes = await encode(q);
    }
    return { file: i.out, bytes };
  } finally {
    for (const f of fs.readdirSync(i.tmpDir)) if (f.startsWith(prefix)) fs.rmSync(path.join(i.tmpDir, f), { force: true });
  }
}
