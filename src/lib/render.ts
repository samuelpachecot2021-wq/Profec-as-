import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { run, exists, hash, ffprobeDuration } from "./util";
import { FONTS_DIR } from "./paths";

export const FPS = 30;
export const XFADE = 0.6; // duración de las transiciones (s)

const TRANSITIONS = ["fade", "dissolve", "fadeblack", "smoothleft", "fade", "circleopen", "fadewhite", "smoothup", "fade", "radial", "dissolve", "slideleft"];

export type Segment = { file: string; kind: "image" | "video"; duration: number; motion: number };

/** Ejecuta ffmpeg informando del progreso (0–1) según el tiempo de salida. */
export function ffmpegProgress(args: string[], totalSec: number, onProgress?: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostats", "-progress", "pipe:1", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString());
      if (m && onProgress && totalSec > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSec));
    });
    p.stderr.on("data", (d) => {
      err += d;
      if (err.length > 100_000) err = err.slice(-50_000);
    });
    p.on("error", (e) => reject(new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg falló (${code}): ${err.slice(-1500)}`))));
  });
}

// Corrección de color cinematográfica (sombras frías, altas luces cálidas).
// En fotos se aplica una sola vez a la imagen fija (rápido); en clips, una versión ligera por fotograma.
const GRADE_STILL = "eq=contrast=1.07:saturation=0.92:gamma=0.98,colorbalance=rs=-0.03:bs=0.05:rh=0.05:bh=-0.05";
const GRADE_VIDEO = "eq=contrast=1.07:saturation=0.9:gamma=0.98";
const VIGNETTE = "vignette=PI/5";

function kenBurns(motion: number, frames: number) {
  const p = `(0.5-0.5*cos(PI*on/${frames}))`; // movimiento suave (ease in-out)
  const cx = "iw/2-(iw/zoom/2)";
  const cy = "ih/2-(ih/zoom/2)";
  switch (motion % 6) {
    case 0:
      return { z: `1.0+0.14*${p}`, x: cx, y: cy }; // acercamiento progresivo
    case 1:
      return { z: `1.14-0.14*${p}`, x: cx, y: cy }; // alejamiento
    case 2:
      return { z: "1.12", x: `(iw-iw/zoom)*${p}`, y: cy }; // paneo izquierda → derecha
    case 3:
      return { z: "1.12", x: `(iw-iw/zoom)*(1-${p})`, y: cy }; // paneo derecha → izquierda
    case 4:
      return { z: `1.08+0.06*${p}`, x: cx, y: `(ih-ih/zoom)*(1-${p})` }; // inclinación hacia arriba
    default:
      return { z: `1.0+0.16*${p}`, x: cx, y: `(ih-ih/zoom)*0.3` }; // acercamiento al tercio superior
  }
}

/** Renderiza un segmento (imagen con Ken Burns o clip de video) a MP4 sin audio. */
export async function renderSegment(seg: Segment, w: number, h: number, out: string, fade?: { in?: boolean; out?: boolean }) {
  if (exists(out)) return out;
  const frames = Math.max(2, Math.round(seg.duration * FPS));
  const fades = [fade?.in ? `fade=t=in:st=0:d=0.35` : "", fade?.out ? `fade=t=out:st=${Math.max(0, seg.duration - 0.35).toFixed(3)}:d=0.35` : ""].filter(Boolean).join(",");
  const tmp = `${out}.part.mp4`;
  const enc = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an"];
  if (seg.kind === "image") {
    const up = 1.3;
    const W2 = Math.round((w * up) / 2) * 2;
    const H2 = Math.round((h * up) / 2) * 2;
    const kb = kenBurns(seg.motion, frames);
    const vf = [
      `scale=${W2}:${H2}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${W2}:${H2}`,
      GRADE_STILL,
      "vignette=PI/4.5",
      "format=yuv420p",
      `zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${frames}:s=${w}x${h}:fps=${FPS}`,
      fades,
      "format=yuv420p",
    ].filter(Boolean).join(",");
    await run("ffmpeg", ["-y", "-v", "error", "-i", seg.file, "-vf", vf, "-frames:v", String(frames), ...enc, tmp]);
  } else {
    const W2 = Math.round((w * 1.08) / 2) * 2;
    const H2 = Math.round((h * 1.08) / 2) * 2;
    const dir = seg.motion % 2 === 0 ? `(iw-ow)*t/${seg.duration.toFixed(3)}` : `(iw-ow)*(1-t/${seg.duration.toFixed(3)})`;
    const vf = [
      `fps=${FPS}`,
      `scale=${W2}:${H2}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:x='${dir}':y='(ih-oh)/2'`,
      GRADE_VIDEO,
      VIGNETTE,
      fades,
      "format=yuv420p",
    ].filter(Boolean).join(",");
    await run("ffmpeg", ["-y", "-v", "error", "-stream_loop", "-1", "-i", seg.file, "-t", seg.duration.toFixed(3), "-vf", vf, ...enc, tmp]);
  }
  fs.renameSync(tmp, out);
  return out;
}

/** Une segmentos con transiciones cinematográficas (xfade). */
export async function xfadeJoin(files: string[], durations: number[], out: string, seed: number) {
  if (exists(out)) return out;
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
    return out;
  }
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts: string[] = [];
  let prev = "[0:v]";
  let acc = durations[0];
  for (let i = 1; i < files.length; i++) {
    const t = TRANSITIONS[(seed + i) % TRANSITIONS.length];
    const offset = acc - XFADE;
    const label = i === files.length - 1 ? "[v]" : `[x${i}]`;
    parts.push(`${prev}[${i}:v]xfade=transition=${t}:duration=${XFADE}:offset=${offset.toFixed(3)}${label}`);
    prev = label;
    acc = offset + durations[i];
  }
  const tmp = `${out}.part.mp4`;
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS), tmp]);
  fs.renameSync(tmp, out);
  return out;
}

export async function concatFiles(files: string[], out: string) {
  const list = `${out}.txt`;
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  fs.rmSync(list, { force: true });
  return out;
}

/** Capa de partículas ambientales (polvo luminoso), generada una vez por tamaño. */
export async function particlesLayer(w: number, h: number, dir: string) {
  const out = path.join(dir, `particulas-${w}x${h}.png`);
  if (exists(out)) return out;
  const W = w * 2;
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=black@0:s=${W}x${h},format=rgba`,
    "-vf", `geq=r='255':g='225':b='170':a='if(lt(random(1),0.00035),255,0)',gblur=sigma=1.4,colorchannelmixer=aa=2`,
    "-frames:v", "1", out,
  ]);
  return out;
}

export type FinalOpts = {
  video: string;
  narration: string;
  music: { file: string; volume: number } | null;
  ass: string;
  particles: string | null;
  total: number;
  out: string;
  height: number;
  onProgress?: (p: number) => void;
};

/** Pasada final: partículas + subtítulos/gráficos + mezcla de audio con ducking + H.264/AAC. */
export async function finalPass(o: FinalOpts) {
  const args = ["-y", "-i", o.video, "-i", o.narration];
  let idx = 2;
  let musicIdx = -1;
  let partIdx = -1;
  if (o.music) {
    args.push("-stream_loop", "-1", "-t", o.total.toFixed(2), "-i", o.music.file);
    musicIdx = idx++;
  }
  if (o.particles) {
    args.push("-i", o.particles);
    partIdx = idx++;
  }
  const assPath = o.ass.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const fontsDir = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");
  const f: string[] = [];
  let v = "[0:v]";
  if (partIdx >= 0) {
    f.push(`[${partIdx}:v]format=rgba,colorchannelmixer=aa=0.55,loop=loop=-1:size=1:start=0,fps=${FPS}[pt]`);
    f.push(`${v}[pt]overlay=x='-mod(t*14,overlay_w-main_w)':y='-mod(t*3,20)':shortest=1[vp]`);
    v = "[vp]";
  }
  f.push(`${v}ass='${assPath}':fontsdir='${fontsDir}',format=yuv420p[vout]`);
  f.push(`[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${o.total.toFixed(2)}[vo]`);
  if (musicIdx >= 0 && o.music) {
    const vol = (0.12 + 0.5 * o.music.volume).toFixed(3);
    f.push(`[vo]asplit=2[voice][key]`);
    f.push(`[${musicIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=2,afade=t=out:st=${Math.max(0, o.total - 3).toFixed(2)}:d=3[mus]`);
    f.push(`[mus][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=450:makeup=1[duck]`);
    f.push(`[voice][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  } else {
    f.push(`[vo]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
  }
  const preset = o.height >= 1440 ? "veryfast" : "faster";
  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-t", o.total.toFixed(2),
    "-c:v", "libx264", "-preset", preset, "-crf", o.height >= 1440 ? "20" : "19", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    `${o.out}.part.mp4`,
  );
  await ffmpegProgress(args, o.total, o.onProgress);
  fs.renameSync(`${o.out}.part.mp4`, o.out);
  return o.out;
}

/** Concatena bloques de narración con pausas breves; devuelve los inicios de cada bloque. */
export async function concatNarration(blocks: { file: string; duration: number }[], gap: number, lead: number, out: string) {
  const starts: number[] = [];
  let t = lead;
  for (const b of blocks) {
    starts.push(t);
    t += b.duration + gap;
  }
  const inputs = blocks.flatMap((b) => ["-i", b.file]);
  const filter =
    `aevalsrc=0:d=${lead}:s=44100[lead];` +
    blocks.map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,apad=pad_dur=${gap}[b${i}]`).join(";") +
    `;[lead]${blocks.map((_, i) => `[b${i}]`).join("")}concat=n=${blocks.length + 1}:v=0:a=1[a]`;
  const tmp = `${out}.part.wav`;
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filter, "-map", "[a]", "-c:a", "pcm_s16le", tmp]);
  fs.renameSync(tmp, out);
  return { starts, total: await ffprobeDuration(out) };
}

export function segKey(...parts: unknown[]) {
  return hash(...parts);
}
