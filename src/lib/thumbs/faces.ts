import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { CACHE_DIR, ROOT } from "../paths";
import { run, hash } from "../util";

/**
 * Detección de rostros local y gratuita (face-api · Tiny Face Detector, modelo de 190 KB,
 * TensorFlow.js en JavaScript puro). Sirve para encuadrar las miniaturas sin cortar caras
 * y para preferir fotos con el rostro grande y visible. No identifica a nadie: solo
 * localiza dónde hay una cara. Si algo falla, devuelve «sin datos» y se usa el encuadre clásico.
 */

export type Face = { x: number; y: number; w: number; h: number; score: number }; // fracciones 0–1 de la imagen
export type FaceInfo = { faces: Face[]; width: number; height: number };

type FaceApi = {
  tf: {
    setBackend: (b: string) => Promise<boolean>;
    ready: () => Promise<void>;
    tensor3d: (v: Uint8Array, s: [number, number, number], d: string) => { dispose: () => void };
    io: { decodeWeights: (b: ArrayBuffer, specs: unknown) => unknown };
    engine: () => { startScope: () => void; endScope: () => void };
  };
  nets: { tinyFaceDetector: { loadFromWeightMap: (w: unknown) => Promise<void> } };
  detectAllFaces: (img: unknown, o: unknown) => Promise<{ score: number; box: { x: number; y: number; width: number; height: number } }[]>;
  TinyFaceDetectorOptions: new (o: { inputSize: number; scoreThreshold: number }) => unknown;
};

let loading: Promise<FaceApi | null> | null = null;

function pkgDir() {
  for (const d of [path.join(ROOT, "node_modules", "@vladmandic", "face-api"), path.join(process.cwd(), "node_modules", "@vladmandic", "face-api")]) if (fs.existsSync(d)) return d;
  return null;
}

/** Carga el detector una sola vez. El paquete trae TensorFlow.js incluido; se corrige su acceso a «util» de Node. */
function load(): Promise<FaceApi | null> {
  if (process.env.THUMB_FACES === "no") return Promise.resolve(null);
  loading ??= (async () => {
    const dir = pkgDir();
    if (!dir) return null;
    const src = fs.readFileSync(path.join(dir, "dist", "face-api.esm.js"), "utf8");
    const re = /this\.util=\w+\(\),this\.textEncoder=new this\.util\.TextEncoder/;
    if (!re.test(src)) throw new Error("versión de face-api no compatible");
    (globalThis as Record<string, unknown>).__pfNodeUtil = util;
    const file = path.join(os.tmpdir(), `profecia-face-api-${hash(src.length)}.mjs`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, src.replace(re, "this.util=globalThis.__pfNodeUtil,this.textEncoder=new this.util.TextEncoder"));
    // import dinámico real (sin que el empaquetador de Next lo transforme)
    const faceapi = (await new Function("u", "return import(u)")(pathToFileURL(file).href)) as FaceApi;
    await faceapi.tf.setBackend("cpu");
    await faceapi.tf.ready();
    const m = path.join(dir, "model");
    const manifest = JSON.parse(fs.readFileSync(path.join(m, "tiny_face_detector_model-weights_manifest.json"), "utf8"));
    const buf = fs.readFileSync(path.join(m, "tiny_face_detector_model.bin"));
    const weights = faceapi.tf.io.decodeWeights(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer, manifest[0].weights);
    await faceapi.nets.tinyFaceDetector.loadFromWeightMap(weights);
    return faceapi;
  })().catch((e) => {
    console.warn("Detector de rostros no disponible; se usa el encuadre clásico:", String(e).slice(0, 200));
    return null;
  });
  return loading;
}

const iou = (a: Face, b: Face) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h + b.w * b.h - x * y);
};

let queue: Promise<unknown> = Promise.resolve();

/** Rostros de una imagen (fracciones de su ancho/alto). Resultado en caché por archivo. */
export async function detectFaces(file: string): Promise<FaceInfo | null> {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const cacheDir = path.join(CACHE_DIR, "miniaturas", "rostros");
  const cacheFile = path.join(cacheDir, `${hash(path.resolve(file), st.size, Math.round(st.mtimeMs))}.json`);
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as FaceInfo;
  } catch {}
  // una detección a la vez: limita la memoria en servidores pequeños
  const job = queue.then(async () => {
    const api = await load();
    if (!api) return null;
    const probe = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file])).trim().split(",").map(Number);
    const [iw, ih] = probe;
    if (!(iw > 0 && ih > 0)) return null;
    const W = 512;
    const H = Math.max(16, Math.round((W * ih) / iw / 2) * 2);
    const raw = await rawRgb(file, W, H);
    const found: Face[] = [];
    // dos escalas: 224 encuentra primeros planos; 416, rostros medianos
    for (const inputSize of [224, 416]) {
      const img = api.tf.tensor3d(new Uint8Array(raw), [H, W, 3], "int32");
      try {
        const det = await api.detectAllFaces(img, new api.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.55 }));
        for (const d of det) {
          const f = { x: d.box.x / W, y: d.box.y / H, w: d.box.width / W, h: d.box.height / H, score: d.score };
          const dup = found.findIndex((g) => iou(f, g) > 0.3);
          if (dup < 0) found.push(f);
          else if (f.score > found[dup].score) found[dup] = f;
        }
      } finally {
        img.dispose();
      }
    }
    found.sort((a, b) => b.w * b.h - a.w * a.h);
    const info: FaceInfo = { faces: found.slice(0, 6), width: iw, height: ih };
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(info));
    } catch {}
    return info;
  });
  queue = job.catch(() => undefined);
  return job.catch(() => null);
}

function rawRgb(file: string, w: number, h: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg ${code}`))));
  });
}

/** Rostro principal (el más grande y fiable) o null. */
export function mainFace(info: FaceInfo | null): Face | null {
  if (!info?.faces.length) return null;
  return [...info.faces].sort((a, b) => b.w * b.h * b.score - a.w * a.h * a.score)[0];
}

/**
 * Recorte de la foto para un panel de w×h que no corta el rostro y lo agranda cuando es
 * pequeño (sin ampliar más de lo que la resolución permite). Devuelve la región en píxeles
 * de la foto original, o null si no hay rostro (encuadre clásico).
 */
export function faceCrop(info: FaceInfo | null, w: number, h: number, o: { faceFrac?: number; faceTop?: number; faceX?: number } = {}) {
  const f = mainFace(info);
  if (!info || !f) return null;
  const { width: iw, height: ih } = info;
  const ar = w / h;
  // región máxima con el aspecto del panel
  let cw = Math.min(iw, ih * ar);
  let ch = cw / ar;
  // acercar para que el rostro ocupe ~faceFrac de la altura, sin bajar de la resolución útil
  const wantFrac = o.faceFrac ?? 0.42;
  const faceHpx = f.h * ih;
  const minCh = Math.min(ch, Math.max(h * 0.62, faceHpx * 1.8)); // sin ampliar de más; cabeza completa (pelo + rostro + mentón)
  const targetCh = faceHpx / wantFrac;
  if (targetCh < ch) {
    ch = Math.max(minCh, targetCh);
    cw = ch * ar;
  }
  // colocar el rostro: centrado en X, con la frente a faceTop de la altura
  const cx = (f.x + f.w / 2) * iw;
  // margen sobre la frente para el pelo (medio rostro) y mentón siempre dentro
  const top = Math.max((o.faceTop ?? 0.16) * ch, 0.55 * faceHpx);
  let x = cx - cw * (o.faceX ?? 0.5);
  let y = f.y * ih - top;
  const chin = (f.y + f.h) * ih + 0.15 * faceHpx;
  if (y + ch < chin) y = chin - ch;
  x = Math.max(0, Math.min(iw - cw, x));
  y = Math.max(0, Math.min(ih - ch, y));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) };
}
