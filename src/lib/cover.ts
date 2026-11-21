import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { getProject } from "./projects";
import { run, hash } from "./util";
import { ffmpegProgress, verifyOutput } from "./render";
import { renderProfile, threadArgs } from "./resources";
import { ensureSpace } from "./disk";
import { loadThumbState, renderMainAt } from "./thumbnails";

/**
 * «Descargar video con portada integrada» (pensado para YouTube Shorts): una COPIA del MP4
 * terminado que empieza con la miniatura principal durante 0,5–1 s (en silencio) y sigue
 * con el video original completo, sin cambiar su velocidad ni su sincronía.
 *
 *  • Método preferido, sin pérdida: la portada se codifica con los mismos parámetros H.264/AAC
 *    que el video (leídos del propio archivo) y se une por copia directa: el video original
 *    no se vuelve a comprimir.
 *  • Si los parámetros no coinciden exactamente, se recodifica el conjunto una sola vez en
 *    alta calidad (crf 17), con hilos limitados según el servidor.
 * El video original nunca se modifica ni se borra. No se usa ElevenLabs, Runway ni ningún
 * servicio de pago.
 */

export const COVER_MIN = 0.5;
export const COVER_MAX = 1;
const VERSION = 1;

export type CoverStatus = {
  state: "idle" | "working" | "done" | "error";
  progress: number;
  step: string;
  error?: string;
  method?: "copia" | "recodificado";
  duration?: number;
  file?: string;
  key?: string;
  startedAt?: number;
};

type Meta = { key: string; method: "copia" | "recodificado"; duration: number; coverFrames: number; fps: number; createdAt: string; selected: number; bytes: number };

const tasks = new Map<string, CoverStatus>();
let globalQueue: Promise<unknown> = Promise.resolve(); // una creación a la vez en todo el servidor

const outFile = (projectId: string) => path.join(projectDir(projectId, "salida"), "video-con-portada.mp4");
const metaFile = (projectId: string) => path.join(projectDir(projectId, "salida"), "video-con-portada.json");
const tmpDirOf = (projectId: string) => path.join(projectDir(projectId, "salida"), "portada-tmp");

export function clampCover(d: unknown) {
  const n = Number(d);
  if (!Number.isFinite(n)) return COVER_MIN;
  return Math.round(Math.min(COVER_MAX, Math.max(COVER_MIN, n)) * 100) / 100;
}

type VProbe = { width: number; height: number; fps: number; fpsStr: string; timescale: number; pix: string; profile: string; level: number; extradata: string; duration: number; audio: { rate: number; channels: number; layout: string; bitrate: number } | null };

async function probe(file: string): Promise<VProbe> {
  const j = JSON.parse(
    await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,time_base,pix_fmt,profile,level,sample_rate,channels,channel_layout,bit_rate:format=duration", "-of", "json", file]),
  ) as { streams: Record<string, string | number>[]; format: { duration: string } };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  if (!v || v.codec_name !== "h264") throw new Error("El video terminado no es H.264; vuelva a renderizarlo.");
  const [n, d] = String(v.r_frame_rate).split("/").map(Number);
  const fps = d ? n / d : 30;
  const tb = String(v.time_base).split("/").map(Number);
  return {
    width: Number(v.width),
    height: Number(v.height),
    fps,
    fpsStr: String(v.r_frame_rate),
    timescale: tb[1] || 15360,
    pix: String(v.pix_fmt),
    profile: String(v.profile),
    level: Number(v.level),
    extradata: await extradata(file),
    duration: Number(j.format.duration),
    audio: a ? { rate: Number(a.sample_rate), channels: Number(a.channels), layout: String(a.channel_layout || (Number(a.channels) === 1 ? "mono" : "stereo")), bitrate: Number(a.bit_rate) || 192000 } : null,
  };
}

/** Parámetros del códec (SPS/PPS): si coinciden, la unión por copia es segura en cualquier reproductor. */
async function extradata(file: string) {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=extradata", "-show_data", "-of", "default=nw=1", file]);
  return hash(out.replace(/\s+/g, ""));
}

/** Opciones con las que x264 codificó el video (las guarda dentro del propio archivo). */
function x264Options(file: string): Record<string, string> {
  const fd = fs.openSync(file, "r");
  try {
    const size = Math.min(fs.fstatSync(fd).size, 8_000_000);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    const txt = buf.toString("latin1");
    const m = txt.match(/x264 - core \d+[^\0]*?options: ([^\0]+)/);
    const o: Record<string, string> = {};
    for (const kv of (m?.[1] ?? "").split(" ")) {
      const i = kv.indexOf("=");
      if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return o;
  } finally {
    fs.closeSync(fd);
  }
}

/** Configuraciones candidatas para reproducir exactamente el SPS/PPS del original. */
function encoderCandidates(o: Record<string, string>, height: number) {
  const crf = o.crf ? String(Math.round(Number(o.crf) * 10) / 10) : height >= 1440 ? "20" : "19";
  const presetByRef = o.ref === "1" ? "veryfast" : o.ref === "2" ? "faster" : o.ref === "3" ? "medium" : height >= 1440 ? "veryfast" : "faster";
  const presets = [...new Set([presetByRef, height >= 1440 ? "veryfast" : "faster", "faster", "veryfast", "fast", "medium"])];
  return presets.map((preset) => ({ preset, crf }));
}

function key(projectId: string, duration: number) {
  const p = getProject(projectId)!;
  const st = fs.statSync(p.output_path!);
  const ts = loadThumbState(projectId);
  const sel = ts?.proposals[ts.selected];
  const selFile = sel?.file && fs.existsSync(sel.file) ? fs.statSync(sel.file) : null;
  return hash(VERSION, st.size, Math.round(st.mtimeMs), ts?.selected, sel?.updatedAt, selFile?.size, Math.round(selFile?.mtimeMs ?? 0), duration);
}

function readMeta(projectId: string): Meta | null {
  try {
    return JSON.parse(fs.readFileSync(metaFile(projectId), "utf8")) as Meta;
  } catch {
    return null;
  }
}

/** Estado actual: en proceso, lista (y si sigue al día con la miniatura principal) o sin crear. */
export function coverStatus(projectId: string, duration?: number) {
  const t = tasks.get(projectId);
  if (t?.state === "working") return { ...t, ready: false, stale: false };
  const meta = readMeta(projectId);
  const p = getProject(projectId);
  const exists = !!meta && fs.existsSync(outFile(projectId));
  let stale = false;
  if (exists && p?.output_path && fs.existsSync(p.output_path)) {
    try {
      stale = meta!.key !== key(projectId, duration ?? meta!.duration);
    } catch {
      stale = true;
    }
  }
  return {
    ...(t ?? { state: exists ? "done" : "idle", progress: exists ? 1 : 0, step: "" }),
    ready: exists && !stale,
    stale,
    file: exists ? outFile(projectId) : undefined,
    method: meta?.method,
    duration: meta?.duration,
    bytes: meta?.bytes,
  };
}

/** Comienza (o reutiliza) la copia con portada. Devuelve enseguida; el progreso se consulta con coverStatus. */
export function startCover(projectId: string, durationIn: unknown) {
  const duration = clampCover(durationIn);
  const p = getProject(projectId);
  if (!p) throw new Error("Proyecto no encontrado");
  if (!p.output_path || !fs.existsSync(p.output_path)) throw new Error("El proyecto todavía no tiene un video terminado.");
  const ts = loadThumbState(projectId);
  if (!ts?.proposals[ts.selected]?.file) throw new Error("Primero genere las miniaturas y elija la principal (★).");
  const cur = tasks.get(projectId);
  if (cur?.state === "working") return cur;
  const meta = readMeta(projectId);
  if (meta && fs.existsSync(outFile(projectId)) && meta.key === key(projectId, duration)) {
    const done: CoverStatus = { state: "done", progress: 1, step: "Copia con portada lista (reutilizada)", method: meta.method, duration, file: outFile(projectId), key: meta.key };
    tasks.set(projectId, done);
    return done;
  }
  const t: CoverStatus = { state: "working", progress: 0.01, step: "En espera…", duration, startedAt: Date.now() };
  tasks.set(projectId, t);
  const job = globalQueue.then(() => build(projectId, duration, t));
  globalQueue = job.catch(() => undefined);
  job.catch((e) => {
    t.state = "error";
    t.error = e instanceof Error ? e.message : String(e);
    t.step = "No se pudo crear la copia con portada";
    console.error(`Portada integrada (${projectId}):`, e);
  });
  return t;
}

async function build(projectId: string, duration: number, t: CoverStatus) {
  const set = (progress: number, step: string) => Object.assign(t, { progress, step });
  const p = getProject(projectId)!;
  const original = p.output_path!;
  const tmp = tmpDirOf(projectId);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const out = outFile(projectId);
  const part = `${out}.part.mp4`;
  try {
    set(0.03, "Analizando el video original");
    const v = await probe(original);
    const sizeMB = fs.statSync(original).size / 1048576;
    ensureSpace(Math.ceil(sizeMB * 1.15 + 30), "La copia con portada", () => undefined, projectId);
    const k = key(projectId, duration);
    const frames = Math.max(1, Math.round(duration * v.fps));
    const coverSec = frames / v.fps;

    set(0.08, `Preparando la portada a ${v.width}×${v.height}`);
    const coverJpg = path.join(tmp, "portada.jpg");
    const sel = await renderMainAt(projectId, v.width, v.height, coverJpg);
    // a PNG (RGB): la JPG arrastra datos de color JFIF a la cabecera H.264 e impediría la unión por copia
    const coverImg = path.join(tmp, "portada.png");
    await run("ffmpeg", ["-y", "-v", "error", "-i", coverJpg, "-pix_fmt", "rgb24", coverImg]);

    // 1) portada con los mismos parámetros del original → unión por copia (sin recomprimir el video)
    const prof = renderProfile();
    const th = threadArgs(prof.threads);
    const opts = x264Options(original);
    const audioArgs = v.audio ? ["-c:a", "aac", "-b:a", String(Math.round(v.audio.bitrate / 1000) * 1000 || 192000), "-ar", String(v.audio.rate), "-ac", String(v.audio.channels)] : [];
    let coverClip: string | null = null;
    let tries = 0;
    for (const c of process.env.COVER_FORCE_REENCODE === "1" ? [] : encoderCandidates(opts, v.height)) {
      if (tries++ >= 4) break;
      set(0.12 + tries * 0.05, "Codificando la portada con los parámetros del video");
      const clip = path.join(tmp, `portada-${c.preset}.mp4`);
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-loop", "1", "-framerate", v.fpsStr, "-i", coverImg,
        ...(v.audio ? ["-f", "lavfi", "-i", `anullsrc=r=${v.audio.rate}:cl=${v.audio.layout}`] : []),
        "-map", "0:v", ...(v.audio ? ["-map", "1:a"] : []),
        "-frames:v", String(frames), "-t", coverSec.toFixed(4),
        "-vf", `scale=${v.width}:${v.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${v.width}:${v.height},setsar=1,format=${v.pix}`,
        "-c:v", "libx264", "-preset", c.preset, "-crf", c.crf, "-profile:v", v.profile.toLowerCase().includes("high") ? "high" : "main", "-pix_fmt", v.pix, "-r", v.fpsStr,
        ...th.encode,
        ...audioArgs,
        "-video_track_timescale", String(v.timescale),
        clip,
      ], { timeoutMs: 120_000 });
      if ((await extradata(clip)) === v.extradata) {
        coverClip = clip;
        break;
      }
    }

    let method: Meta["method"];
    if (coverClip) {
      method = "copia";
      set(0.4, "Uniendo la portada y el video (copia directa, sin recomprimir la imagen)");
      const list = path.join(tmp, "lista.txt");
      fs.writeFileSync(list, `file '${coverClip.replace(/'/g, "'\\''")}'\nfile '${original.replace(/'/g, "'\\''")}'\n`);
      const vOnly = path.join(tmp, "imagen.mp4");
      await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v", "-c", "copy", vOnly], { timeoutMs: 30 * 60_000 });
      if (v.audio) {
        // Sonido exacto: silencio hasta el primer fotograma del video original y después su audio,
        // decodificado con el relleno inicial del AAC ya descontado (sin desfases).
        set(0.55, "Sincronizando el sonido con la imagen");
        const mainStart = await mainVideoStart(vOnly, frames);
        await run("ffmpeg", [
          "-y", "-v", "error", "-i", vOnly, "-i", original,
          "-filter_complex", `[1:a]aresample=${v.audio.rate},adelay=delays=${Math.round(mainStart * v.audio.rate)}S:all=1[a]`,
          "-map", "0:v", "-map", "[a]", "-c:v", "copy",
          "-c:a", "aac", "-b:a", String(Math.max(128000, Math.round(v.audio.bitrate / 1000) * 1000)), "-ar", String(v.audio.rate), "-ac", String(v.audio.channels),
          "-movflags", "+faststart", part,
        ], { timeoutMs: 30 * 60_000 });
      } else fs.renameSync(vOnly, part);
    } else {
      // 2) alternativa: recodificar una sola vez en alta calidad
      method = "recodificado";
      set(0.2, "Recodificando el video con la portada (alta calidad)");
      const total = coverSec + v.duration;
      const fc = v.audio
        ? `[0:v]scale=${v.width}:${v.height}:force_original_aspect_ratio=increase,crop=${v.width}:${v.height},setsar=1,fps=${v.fpsStr},format=${v.pix},trim=end_frame=${frames},setpts=PTS-STARTPTS[cv];` +
          `anullsrc=r=${v.audio.rate}:cl=${v.audio.layout},atrim=end=${coverSec.toFixed(4)},asetpts=PTS-STARTPTS[ca];` +
          `[1:v]setsar=1,format=${v.pix}[mv];[1:a]aresample=${v.audio.rate}[ma];[cv][ca][mv][ma]concat=n=2:v=1:a=1[v][a]`
        : `[0:v]scale=${v.width}:${v.height}:force_original_aspect_ratio=increase,crop=${v.width}:${v.height},setsar=1,fps=${v.fpsStr},format=${v.pix},trim=end_frame=${frames},setpts=PTS-STARTPTS[cv];[1:v]setsar=1,format=${v.pix}[mv];[cv][mv]concat=n=2:v=1:a=0[v]`;
      await ffmpegProgress(
        [
          "-y", "-v", "error", ...th.filter,
          "-loop", "1", "-framerate", v.fpsStr, "-t", (coverSec + 0.5).toFixed(3), "-i", coverImg,
          ...th.input, "-i", original,
          "-filter_complex", fc,
          "-map", "[v]", ...(v.audio ? ["-map", "[a]"] : []),
          "-c:v", "libx264", "-preset", v.height >= 1440 ? "veryfast" : "faster", "-crf", "17", "-profile:v", "high", "-pix_fmt", v.pix, "-r", v.fpsStr, ...th.encode,
          ...(v.audio ? ["-c:a", "aac", "-b:a", "192k", "-ar", String(v.audio.rate)] : []),
          "-movflags", "+faststart",
          part,
        ],
        total,
        (x) => set(0.2 + 0.55 * x, `Recodificando el video con la portada (${Math.round(x * 100)} %)`),
      );
    }

    set(0.8, "Comprobando el archivo (imagen, sonido, duración y sincronía)");
    await checkCover(part, original, coverImg, { w: v.width, h: v.height, coverSec, duration: v.duration, hasAudio: !!v.audio, threads: prof.threads });
    fs.renameSync(part, out);
    const meta: Meta = { key: k, method, duration, coverFrames: frames, fps: v.fps, createdAt: new Date().toISOString(), selected: sel.index, bytes: fs.statSync(out).size };
    fs.writeFileSync(metaFile(projectId), JSON.stringify(meta, null, 1));
    Object.assign(t, { state: "done", progress: 1, step: `Copia con portada lista (${method === "copia" ? "sin recomprimir el video" : "recodificada en alta calidad"})`, method, file: out, key: k });
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true }); // solo los temporales de esta función
  }
}

/**
 * Instante (s, en la línea de tiempo del archivo) del primer fotograma del video original
 * dentro de la unión: el fotograma número `frames` en orden de presentación.
 */
async function mainVideoStart(file: string, frames: number) {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-read_intervals", "%+#" + String(frames + 40), "-of", "csv=p=0", file]);
  const pts = out.split("\n").map((l) => parseFloat(l)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (pts.length <= frames) throw new Error("No se pudo localizar el inicio del video original en la unión");
  // relativo al primer fotograma: al combinar con el audio, FFmpeg sitúa ese fotograma en el instante 0
  return pts[frames] - pts[0];
}

/** PSNR (dB) entre un fotograma del archivo y una referencia (imagen o fotograma de otro video). */
async function psnr(file: string, at: number, ref: string, refAt: number | null, w: number, h: number) {
  const dir = path.dirname(file);
  const tag = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const a = path.join(dir, `psnr-a-${tag}.png`);
  const b = path.join(dir, `psnr-b-${tag}.png`);
  try {
    // se extrae cada fotograma a una imagen y después se comparan dos imágenes fijas
    await run("ffmpeg", ["-y", "-v", "error", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, a]);
    if (refAt === null) await run("ffmpeg", ["-y", "-v", "error", "-i", ref, "-frames:v", "1", "-vf", `scale=${w}:${h}`, b]);
    else await run("ffmpeg", ["-y", "-v", "error", "-ss", refAt.toFixed(3), "-i", ref, "-frames:v", "1", "-vf", `scale=${w}:${h}`, b]);
    const outp = await run("sh", ["-c", `ffmpeg -v info -nostats -i "$1" -i "$2" -filter_complex "[0:v]format=yuv420p[x];[1:v]format=yuv420p[y];[x][y]psnr" -f null - 2>&1`, "sh", a, b]);
    const m = outp.match(/average:(inf|[\d.]+)/);
    return m ? (m[1] === "inf" ? 99 : Number(m[1])) : 0;
  } finally {
    fs.rmSync(a, { force: true });
    fs.rmSync(b, { force: true });
  }
}

/**
 * Comprobaciones del archivo final: H.264 a la resolución del video, AAC audible, duración =
 * original + portada, la portada al principio (sin pantalla negra), el contenido original
 * intacto justo después y decodificación completa sin errores.
 */
export async function checkCover(file: string, original: string, coverImg: string, o: { w: number; h: number; coverSec: number; duration: number; hasAudio: boolean; threads: number }) {
  const total = o.coverSec + o.duration;
  if (o.hasAudio) await verifyOutput(file, { w: o.w, h: o.h, total });
  const first = await psnr(file, 0, coverImg, null, 360, Math.round((360 * o.h) / o.w / 2) * 2);
  if (first < 24) throw new Error(`El primer fotograma no coincide con la portada (PSNR ${first.toFixed(1)} dB).`);
  const mid = await psnr(file, Math.max(0, o.coverSec - 0.05), coverImg, null, 360, Math.round((360 * o.h) / o.w / 2) * 2);
  if (mid < 24) throw new Error(`La portada no se mantiene hasta el final de su segmento (PSNR ${mid.toFixed(1)} dB).`);
  const probeT = Math.min(0.5, o.duration / 2);
  const after = await psnr(file, o.coverSec + probeT, original, probeT, 360, Math.round((360 * o.h) / o.w / 2) * 2);
  if (after < 28) throw new Error(`El video original no empieza correctamente después de la portada (PSNR ${after.toFixed(1)} dB).`);
  const errs = await run("sh", ["-c", `ffmpeg -v error -threads ${o.threads} -i "$1" -f null - 2>&1 | head -5`, "sh", file]);
  if (errs.trim()) throw new Error(`El archivo tiene errores de decodificación: ${errs.trim().slice(0, 200)}`);
}
