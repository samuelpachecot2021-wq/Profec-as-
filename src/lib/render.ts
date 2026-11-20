import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { run, exists, hash, ffprobeDuration, ProcessError, describeExit } from "./util";
import { renderProfile, threadArgs } from "./resources";
import { FONTS_DIR } from "./paths";

export const FPS = 30;

/**
 * Codificación de los archivos INTERMEDIOS (escenas y bloques), que luego se recodifican en el
 * render final. Antes: ultrafast + crf 15 (~7,4 MB por toma vertical de 4 s), lo que llenaba el
 * disco (FFmpeg código 228 = ENOSPC). Ahora: veryfast + crf 17 (~0,9 MB), visualmente sin pérdida
 * en un archivo intermedio. La calidad del MP4 final (crf 19, preset «faster») no cambia.
 */
const INTERMEDIATE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17"];
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
    p.on("close", (code, signal) =>
      code === 0 ? resolve() : reject(new ProcessError(describeExit("ffmpeg", code, signal, false, err), "ffmpeg", args, code, signal, err.slice(-4000))),
    );
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
  if (motion < 0) {
    // Impacto inicial: acercamiento rápido que se frena (ease-out), centrado.
    const fast = `(1-pow(1-min(1,on/${Math.round(frames * 0.6)}),3))`;
    return { z: `1.0+0.2*${fast}`, x: cx, y: cy };
  }
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
/**
 * Renderiza una escena. `threads` limita los hilos de FFmpeg (memoria contenida);
 * `safe` es el modo de reintento para servidores con muy poca memoria (misma calidad de salida).
 */
export async function renderSegment(
  seg: Segment,
  w: number,
  h: number,
  out: string,
  fade?: { in?: boolean; out?: boolean },
  opt: { threads?: number; safe?: boolean } = {},
) {
  if (exists(out)) return out;
  const th = threadArgs(opt.safe ? 1 : (opt.threads ?? renderProfile().threads));
  const frames = Math.max(2, Math.round(seg.duration * FPS));
  const fades = [fade?.in ? `fade=t=in:st=0:d=0.35` : "", fade?.out ? `fade=t=out:st=${Math.max(0, seg.duration - 0.35).toFixed(3)}:d=0.35` : ""].filter(Boolean).join(",");
  const tmp = `${out}.part.mp4`;
  const enc = [...INTERMEDIATE, "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", ...th.encode];
  if (seg.kind === "image") {
    const up = opt.safe ? 1.15 : 1.3;
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
    await run("ffmpeg", ["-y", "-v", "error", ...th.filter, ...th.input, "-i", seg.file, "-vf", vf, "-frames:v", String(frames), ...enc, tmp]).catch((e) => {
      fs.rmSync(tmp, { force: true });
      throw e;
    });
  } else {
    const W2 = Math.round((w * 1.08) / 2) * 2;
    const H2 = Math.round((h * 1.08) / 2) * 2;
    const dir = seg.motion % 2 === 0 ? `(iw-ow)*t/${seg.duration.toFixed(3)}` : `(iw-ow)*(1-t/${seg.duration.toFixed(3)})`;
    const vf = [
      // En modo seguro se reduce primero el clip (p. ej. 4K) a lo necesario, con menos memoria por fotograma.
      opt.safe ? `scale='min(iw,${Math.max(W2, H2) * 2})':-2:flags=fast_bilinear` : "",
      `fps=${FPS}`,
      `scale=${W2}:${H2}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:x='${dir}':y='(ih-oh)/2'`,
      GRADE_VIDEO,
      VIGNETTE,
      // Impacto inicial en clips: acercamiento rápido durante el primer segundo y medio.
      seg.motion < 0 ? `zoompan=z='1+0.16*(1-pow(1-min(1,on/45),3))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS}` : "",
      fades,
      "format=yuv420p",
    ].filter(Boolean).join(",");
    await run("ffmpeg", ["-y", "-v", "error", ...th.filter, ...th.input, "-stream_loop", "-1", "-i", seg.file, "-t", seg.duration.toFixed(3), "-vf", vf, ...enc, tmp]).catch((e) => {
      fs.rmSync(tmp, { force: true });
      throw e;
    });
  }
  fs.renameSync(tmp, out);
  return out;
}

/** Une segmentos con transiciones cinematográficas (xfade). */
export async function xfadeJoin(files: string[], durations: number[], out: string, seed: number, threads?: number) {
  if (exists(out)) return out;
  if (files.length === 1) {
    fs.copyFileSync(files[0], out);
    return out;
  }
  const th = threadArgs(threads ?? renderProfile().threads);
  // Cada entrada se decodifica con 1 hilo: con 8 escenas abiertas a la vez la memoria se mantiene baja.
  const inputs = files.flatMap((f) => ["-threads", "1", "-i", f]);
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
  await run("ffmpeg", ["-y", "-v", "error", ...th.filter, ...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", ...INTERMEDIATE, "-pix_fmt", "yuv420p", "-r", String(FPS), ...th.encode, tmp]).catch((e) => {
    fs.rmSync(tmp, { force: true });
    throw e;
  });
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
  /** Lista de bloques de video (se leen en orden, sin crear una copia unida en disco). */
  videoParts: string[];
  narration: string;
  music: { file: string; volume: number } | null;
  ass: string;
  particles: string | null;
  total: number;
  out: string;
  height: number;
  onProgress?: (p: number) => void;
  threads?: number;
};

/** Pasada final: partículas + subtítulos/gráficos + mezcla de audio con ducking + H.264/AAC. */
export async function finalPass(o: FinalOpts) {
  const th = threadArgs(o.threads ?? renderProfile().threads);
  const list = `${o.out}.bloques.txt`;
  fs.writeFileSync(list, o.videoParts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const args = ["-y", ...th.filter, ...th.input, "-f", "concat", "-safe", "0", "-i", list, "-i", o.narration];
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
    "-c:v", "libx264", "-preset", preset, "-crf", o.height >= 1440 ? "20" : "19", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(FPS), ...th.encode,
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    `${o.out}.part.mp4`,
  );
  try {
    await ffmpegProgress(args, o.total, o.onProgress);
  } catch (e) {
    fs.rmSync(`${o.out}.part.mp4`, { force: true }); // no deja un MP4 a medias ocupando disco
    throw e;
  } finally {
    fs.rmSync(list, { force: true });
  }
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

// ───────────────────────── Verificaciones ─────────────────────────

type Probe = { streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; duration?: string }[]; format?: { duration?: string } };

async function probe(file: string): Promise<Probe> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt,duration:format=duration", "-of", "json", file]);
  return JSON.parse(out) as Probe;
}

/** Duración de un video intermedio (o null si está dañado o incompleto). */
export async function validDuration(file: string): Promise<number | null> {
  try {
    if (!exists(file)) return null;
    const p = await probe(file);
    const v = p.streams?.find((x) => x.codec_type === "video");
    const d = parseFloat(p.format?.duration ?? v?.duration ?? "");
    return v && isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

const SAFE_PIX = /^(yuvj?4[2-4][0-4]p|rgb24|bgr24|rgba|bgra|argb|abgr|gray|ya8|pal8)$/;

/**
 * Compatibilidad de imágenes: si una imagen no se puede leer de forma segura (formato raro,
 * 16 bits, CMYK, tamaño enorme), se convierte UNA vez a JPEG de alta calidad al tamaño
 * necesario. Las imágenes normales se usan tal cual (sin pérdida). Devuelve la ruta a usar.
 */
export async function compatibleStill(file: string, w: number, h: number): Promise<string> {
  let p: Probe;
  try {
    p = await probe(file);
  } catch (e) {
    throw new Error(`La imagen ${path.basename(file)} no se puede leer (archivo dañado o formato no compatible): ${e instanceof Error ? e.message.slice(0, 200) : e}`);
  }
  const v = p.streams?.find((x) => x.codec_type === "video");
  if (!v?.width || !v.height) throw new Error(`La imagen ${path.basename(file)} no contiene datos de imagen válidos.`);
  const huge = v.width * v.height > 24_000_000;
  if (SAFE_PIX.test(v.pix_fmt ?? "") && !huge) return file;
  const out = `${file}.compatible.jpg`;
  if (!exists(out)) {
    const W2 = Math.round(w * 1.3);
    const H2 = Math.round(h * 1.3);
    await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `scale=${W2}:${H2}:force_original_aspect_ratio=increase:flags=lanczos,format=rgb24`, "-frames:v", "1", "-q:v", "2", out]);
  }
  return out;
}

/**
 * Verifica el MP4 final: imagen H.264 del tamaño correcto, sonido AAC con volumen real,
 * duración esperada y último fotograma legible. Lanza un error con el motivo exacto.
 */
export async function verifyOutput(file: string, o: { w: number; h: number; total: number }) {
  const p = await probe(file);
  const v = p.streams?.find((x) => x.codec_type === "video");
  const a = p.streams?.find((x) => x.codec_type === "audio");
  const dur = parseFloat(p.format?.duration ?? "0");
  const problems: string[] = [];
  if (!v || v.codec_name !== "h264") problems.push("sin pista de video H.264");
  else if (v.width !== o.w || v.height !== o.h) problems.push(`tamaño ${v.width}×${v.height} en lugar de ${o.w}×${o.h}`);
  if (!a || a.codec_name !== "aac") problems.push("sin pista de sonido AAC");
  if (!(Math.abs(dur - o.total) <= 0.75)) problems.push(`duración ${dur.toFixed(2)} s en lugar de ${o.total.toFixed(2)} s`);
  let meanDb = -99;
  if (a) {
    // volumedetect escribe su resultado en stderr: se redirige a stdout para leerlo
    const vd = await run("sh", ["-c", 'ffmpeg -v info -nostats -i "$1" -map 0:a:0 -af volumedetect -f null - 2>&1', "sh", file]).catch((e: Error) => e.message);
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(String(vd));
    meanDb = m ? parseFloat(m[1]) : -99;
    if (meanDb < -55) problems.push(`sonido prácticamente mudo (${meanDb} dB)`);
  }
  try {
    await run("ffmpeg", ["-v", "error", "-ss", Math.max(0, dur - 1).toFixed(2), "-i", file, "-frames:v", "1", "-f", "null", "-"]);
  } catch {
    problems.push("el final del video no se puede decodificar");
  }
  if (problems.length) throw new Error(`El MP4 final no superó la verificación: ${problems.join("; ")}.`);
  return { duration: dur, meanDb, width: v!.width!, height: v!.height! };
}
