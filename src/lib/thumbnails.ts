import fs from "node:fs";
import path from "node:path";
import { run, exists } from "./util";
import { FONTS_DIR } from "./paths";

const W = 1280;
const H = 720;

function lines(title: string, maxChars: number, maxLines = 3): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of title.toUpperCase().split(/\s+/)) {
    if (cur && (cur + " " + w).length > maxChars) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  if (out.length > maxLines) {
    const head = out.slice(0, maxLines - 1);
    head.push(out.slice(maxLines - 1).join(" "));
    return head;
  }
  return out;
}

const font = (f: string) => path.join(FONTS_DIR, f).replace(/\\/g, "/").replace(/:/g, "\\:");
const tf = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** Extrae un fotograma si el recurso es un video. */
async function frameOf(src: string, dir: string, i: number) {
  if (!/\.(mp4|mov|webm)$/i.test(src)) return src;
  const out = path.join(dir, `frame-${i}.jpg`);
  if (!exists(out)) await run("ffmpeg", ["-y", "-v", "error", "-ss", "1.5", "-i", src, "-frames:v", "1", "-q:v", "2", out]);
  return out;
}

/**
 * Genera 3 miniaturas 16:9 (1280×720) con estilos diferentes:
 *  A) texto amarillo/blanco a la izquierda con barra roja
 *  B) texto centrado grande con caja roja
 *  C) marco dorado, texto dorado abajo y viñeta intensa
 */
export async function makeThumbnails(opts: { images: string[]; titles: string[]; dir: string; isAi: boolean[] }) {
  fs.mkdirSync(opts.dir, { recursive: true });
  const results: string[] = [];
  for (let i = 0; i < 3; i++) {
    const src = await frameOf(opts.images[i % opts.images.length], opts.dir, i);
    const title = opts.titles[i % opts.titles.length] || "PROFECÍA";
    const out = path.join(opts.dir, `miniatura-${i + 1}.jpg`);
    const ls = lines(title, i === 1 ? 14 : 12, 3);
    const size = ls.length >= 3 ? 92 : ls.length === 2 ? 110 : 130;
    const files = ls.map((l, k) => {
      const p = path.join(opts.dir, `t${i}-${k}.txt`);
      fs.writeFileSync(p, l);
      return p;
    });
    const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=contrast=1.25:saturation=1.25:brightness=0.02,unsharp=5:5:0.8`;
    const draws: string[] = [];
    const gap = size * 1.08;
    if (i === 0) {
      draws.push(`drawbox=x=0:y=0:w=${W * 0.62}:h=${H}:color=black@0.55:t=fill`);
      const y0 = H / 2 - (gap * ls.length) / 2;
      files.forEach((f, k) =>
        draws.push(`drawtext=fontfile='${font("Inter-Black.otf")}':textfile='${tf(f)}':fontsize=${size}:fontcolor=${k === 0 ? "0xFFE500" : "white"}:borderw=8:bordercolor=black:x=50:y=${Math.round(y0 + k * gap)}`),
      );
      draws.push(`drawbox=x=50:y=${Math.round(y0 + gap * ls.length + 10)}:w=${Math.round(W * 0.35)}:h=16:color=0xC81C1C:t=fill`);
    } else if (i === 1) {
      draws.push("vignette=PI/3.2");
      const y0 = H / 2 - (gap * ls.length) / 2;
      files.forEach((f, k) => {
        if (k === 0) draws.push(`drawtext=fontfile='${font("Inter-Black.otf")}':textfile='${tf(f)}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0xC81C1C@0.95:boxborderw=18:x=(w-text_w)/2:y=${Math.round(y0 + k * gap)}`);
        else draws.push(`drawtext=fontfile='${font("Inter-Black.otf")}':textfile='${tf(f)}':fontsize=${size}:fontcolor=0xFFE500:borderw=9:bordercolor=black:x=(w-text_w)/2:y=${Math.round(y0 + k * gap + 14)}`);
      });
    } else {
      draws.push("vignette=PI/2.6");
      draws.push(`drawbox=x=0:y=${H * 0.55}:w=${W}:h=${H * 0.45}:color=black@0.5:t=fill`);
      draws.push(`drawbox=x=12:y=12:w=${W - 24}:h=${H - 24}:color=0xD4A64A:t=10`);
      const y0 = H - 50 - gap * ls.length;
      files.forEach((f, k) =>
        draws.push(`drawtext=fontfile='${font("Inter-Black.otf")}':textfile='${tf(f)}':fontsize=${size}:fontcolor=${k === ls.length - 1 ? "0xE8B845" : "white"}:borderw=8:bordercolor=black:x=(w-text_w)/2:y=${Math.round(y0 + k * gap)}`),
      );
    }
    if (opts.isAi[i % opts.isAi.length])
      draws.push(`drawtext=fontfile='${font("Inter-Bold.otf")}':text='Imagen ilustrativa IA':fontsize=20:fontcolor=white@0.8:x=w-text_w-24:y=h-34`);
    await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", [base, ...draws].join(","), "-frames:v", "1", "-q:v", "2", out]);
    files.forEach((f) => fs.rmSync(f, { force: true }));
    results.push(out);
  }
  return results;
}
