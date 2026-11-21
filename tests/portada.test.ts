import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

process.env.WM_MIN_GAP_MS = "0";

import { saveSettings } from "../src/lib/settings";
import { createProject, getProject, updateProject } from "../src/lib/projects";
import { produce, type Reporter } from "../src/lib/pipeline";
import { db } from "../src/lib/db";
import { DATA_DIR } from "../src/lib/paths";
import { generateThumbnails, selectProposal, loadThumbState } from "../src/lib/thumbnails";
import { startCover, coverStatus, clampCover } from "../src/lib/cover";

saveSettings({ LLM_PROVIDER: "local" });

// sin red: los bancos, Wikimedia y servicios de pago no se usan en estas pruebas
let paidCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (/elevenlabs|runwayml|anthropic|openai/.test(url)) paidCalls++;
  if (/^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(url)) throw new TypeError("sin red en pruebas");
  return realFetch(input, init);
}) as typeof fetch;

const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const probe = (f: string, entries: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", f]).toString().trim();
const reporter = (): Reporter => {
  const r: Reporter = () => undefined;
  r.log = () => undefined;
  return r;
};

async function waitCover(id: string) {
  for (let i = 0; i < 600; i++) {
    const s = coverStatus(id);
    if (s.state === "error") throw new Error(s.error);
    if (s.state === "done" && s.ready) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("La copia con portada no terminó");
}

/** Desfase (s) entre dos pistas de audio, por correlación (8 kHz mono). */
function audioLag(a: string, aStart: number, b: string, bStart: number, len = 4) {
  const pcm = (f: string, ss: number) => {
    const buf = execFileSync("ffmpeg", ["-v", "error", "-ss", ss.toFixed(3), "-i", f, "-t", String(len), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  };
  const x = pcm(a, aStart);
  const y = pcm(b, bStart);
  let best = 0;
  let bestLag = 0;
  for (let lag = -800; lag <= 800; lag += 1) {
    let s = 0;
    for (let i = 1000; i < Math.min(x.length, y.length) - 1000; i += 2) s += x[i] * y[i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag / 8000;
}

/** Instante del primer fotograma claro y del primer sonido fuerte. */
function flashAndBeep(f: string) {
  const v = execFileSync("sh", ["-c", `ffmpeg -i "$1" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" -an -f null - 2>&1`, "sh", f]).toString();
  let flash = -1;
  for (const b of v.split("frame:").slice(1)) {
    const t = Number(/pts_time:([\d.]+)/.exec(b)?.[1]);
    const y = Number(/YAVG=([\d.]+)/.exec(b)?.[1]);
    if (y > 200) {
      flash = t;
      break;
    }
  }
  const a = execFileSync("sh", ["-c", `ffmpeg -i "$1" -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -vn -f null - 2>&1`, "sh", f]).toString();
  let beep = -1;
  for (const b of a.split("frame:").slice(1)) {
    const t = Number(/pts_time:([\d.]+)/.exec(b)?.[1]);
    const lv = /RMS_level=(-?[\d.]+|-inf)/.exec(b)?.[1];
    if (lv && lv !== "-inf" && Number(lv) > -30) {
      beep = t;
      break;
    }
  }
  return { flash, beep };
}

function thumbsFor(id: string) {
  // recursos del proyecto para las miniaturas (sin red)
  const dir = path.join(DATA_DIR, "projects", id, "media");
  fs.mkdirSync(dir, { recursive: true });
  const ins = db().prepare("INSERT INTO scenes (project_id, idx, text, start, end, query, asset_id) VALUES (?,?,?,?,?,?,?)");
  const a = path.join(dir, "fondo.jpg");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1920x1080", "-frames:v", "1", a]);
  const r = db().prepare("INSERT INTO assets (project_id, provider, kind, external_id, license, attribution, local_path, is_ai) VALUES (?,?,?,?,?,?,?,0)").run(id, "pexels", "image", "f1", "Licencia Pexels", "Foto en Pexels", a);
  ins.run(id, 0, "a", 0, 4, "q", Number(r.lastInsertRowid));
}

test("video vertical real 1080×1920: copia con portada sin recomprimir, original intacto y audio sincronizado", async () => {
  const text = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8").slice(0, 900);
  const id = createProject({ text, settings: { duration: 20, resolution: 1080, format: "9:16", voiceId: "espeak-es", sources: { pexels: false, pixabay: false, unsplash: false, wikimedia: false, nasa: false, biblioteca: true } } as never });
  await produce(id, reporter());
  const p = getProject(id)!;
  assert.ok(p.output_path && fs.existsSync(p.output_path));
  assert.ok(loadThumbState(id), "las tres miniaturas se crean al terminar la producción");
  const before = sha(p.output_path);
  const origDur = Number(probe(p.output_path, "format=duration"));
  const calls = paidCalls;

  startCover(id, 0.5);
  const s = await waitCover(id);
  assert.equal(s.method, "copia", "la portada se une sin recomprimir el video");
  const out = s.file!;
  assert.notEqual(out, p.output_path);
  assert.equal(sha(p.output_path), before, "el video original no cambia");
  assert.equal(probe(out, "stream=codec_name,width,height").split("\n")[0], "h264,1080,1920");
  assert.match(probe(out, "stream=codec_name"), /aac/);
  assert.equal(probe(out, "stream=r_frame_rate").split("\n")[0], "30/1");
  const dur = Number(probe(out, "format=duration"));
  assert.ok(Math.abs(dur - (origDur + 0.5)) < 0.06, `duración ${dur} vs ${origDur + 0.5}`);
  // la imagen y la narración originales empiezan exactamente a los 0,5 s, a la vez
  const framesPts = (f: string) =>
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-read_intervals", "%+#40", "-of", "csv=p=0", f])
      .toString()
      .split("\n")
      .map((x) => parseFloat(x))
      .filter(Number.isFinite);
  const fc = framesPts(out);
  assert.ok(Math.abs(fc[0]) < 0.002, `primer fotograma (portada) en ${fc[0]} s: sin pantalla negra inicial`);
  const videoStart = fc[15] - framesPts(p.output_path)[0];
  assert.ok(Math.abs(videoStart - 0.5) < 0.002, `imagen original en ${videoStart} s`);
  const audioStart = 0.5 - audioLag(out, 0.5, p.output_path, 0);
  assert.ok(Math.abs(audioStart - videoStart) <= 0.012, `desfase imagen/sonido ${(audioStart - videoStart) * 1000} ms`);
  // sin errores de decodificación
  assert.equal(execFileSync("sh", ["-c", `ffmpeg -v error -i "$1" -f null - 2>&1`, "sh", out]).toString().trim(), "");
  assert.equal(paidCalls, calls, "no se usan servicios de pago al integrar la portada");

  // reutilización: misma miniatura y duración → no se vuelve a crear
  const mtime = fs.statSync(out).mtimeMs;
  const again = startCover(id, 0.5);
  assert.equal(again.state, "done");
  assert.equal(fs.statSync(out).mtimeMs, mtime);

  // cambiar la miniatura principal → la copia queda desactualizada y se regenera con la nueva portada
  await selectProposal(id, 2);
  assert.equal(coverStatus(id, 0.5).stale, true);
  startCover(id, 1);
  const s2 = await waitCover(id);
  assert.equal(s2.duration, 1);
  const dur2 = Number(probe(out, "format=duration"));
  assert.ok(Math.abs(dur2 - (origDur + 1)) < 0.06, `duración ${dur2}`);
  assert.equal(sha(p.output_path), before);
  assert.ok(!fs.existsSync(path.join(DATA_DIR, "projects", id, "salida", "portada-tmp")), "se limpian los temporales");
});

test("sincronía exacta: destello y pitido simultáneos siguen juntos tras la portada (también recodificando)", async () => {
  for (const [w, h, force] of [
    [1080, 1920, false],
    [720, 1280, false],
    [1080, 1920, true],
  ] as const) {
    const id = createProject({ text: "Prueba de sincronía", script: "Prueba de sincronía para la portada.", settings: { format: "9:16", resolution: Math.min(w, h) } as never });
    thumbsFor(id);
    await generateThumbnails({ projectId: id });
    const vid = path.join(DATA_DIR, "projects", id, "salida", `video-${w}.mp4`);
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", `color=c=gray:s=${w}x${h}:r=30:d=5`, "-f", "lavfi", "-i", "sine=f=1000:sample_rate=48000:d=5",
      "-filter_complex", "[0]drawbox=c=white:t=fill:enable='between(t,2,2.19)'[v];[1]volume=enable='not(between(t,2,2.2))':volume=0,aformat=channel_layouts=stereo[a]",
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "faster", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30",
      "-x264-params", "threads=2:lookahead-threads=1", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", vid,
    ]);
    updateProject(id, { output_path: vid, status: "listo" });
    const orig = flashAndBeep(vid);
    if (force) process.env.COVER_FORCE_REENCODE = "1";
    try {
      startCover(id, 0.5);
      const s = await waitCover(id);
      assert.equal(s.method, force ? "recodificado" : "copia");
      assert.equal(probe(s.file!, "stream=width,height").split("\n")[0], `${w},${h}`, "portada a la resolución exacta del video, sin barras ni deformación");
      const got = flashAndBeep(s.file!);
      assert.ok(Math.abs(got.flash - (orig.flash + 0.5)) <= 0.04, `destello ${got.flash} (original ${orig.flash})`);
      assert.ok(Math.abs(got.beep - (orig.beep + 0.5)) <= 0.03, `pitido ${got.beep} (original ${orig.beep})`);
      assert.ok(Math.abs(got.flash - got.beep - (orig.flash - orig.beep)) <= 0.035, "imagen y sonido siguen sincronizados");
    } finally {
      delete process.env.COVER_FORCE_REENCODE;
    }
  }
});

test("la duración de la portada se limita a 0,5–1 s y sin miniaturas no se puede crear", () => {
  assert.equal(clampCover(0.2), 0.5);
  assert.equal(clampCover(3), 1);
  assert.equal(clampCover("0.75"), 0.75);
  const id = createProject({ text: "Sin video" });
  assert.throws(() => startCover(id, 0.5), /video terminado/);
});
