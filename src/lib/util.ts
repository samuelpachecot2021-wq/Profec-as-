import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { containerMemoryMB, containerMemoryUsedMB } from "./resources";

export function uid() {
  return crypto.randomBytes(6).toString("hex");
}

export function hash(...parts: unknown[]) {
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class UserError extends Error {}

/** Ejecuta un proceso y devuelve stdout. Lanza un error legible si falla. */
/** Error de un proceso externo (FFmpeg…) con todos los detalles para el registro. */
export class ProcessError extends Error {
  constructor(
    message: string,
    public cmd: string,
    public args: string[],
    public code: number | null,
    public signal: NodeJS.Signals | null,
    public stderrTail: string,
    public killedByTimeout = false,
  ) {
    super(message);
  }
  /** Detenido por el sistema (memoria agotada u otra señal), no por un error del archivo. */
  get killedBySystem() {
    return this.code === null && !this.killedByTimeout;
  }
}

function describeExit(cmd: string, code: number | null, signal: NodeJS.Signals | null, timedOut: boolean, err: string) {
  const name = cmd === "ffmpeg" ? "FFmpeg" : cmd;
  if (timedOut) return `${name} superó el tiempo máximo y se detuvo.`;
  if (code === null) {
    const mem = ` (memoria del servidor: ${containerMemoryUsedMB() ?? "?"} / ${Math.round(containerMemoryMB())} MB)`;
    return `${name} fue detenido por el sistema (señal ${signal ?? "desconocida"}), casi siempre por falta de memoria${mem}.`;
  }
  const lines = err.trim().split("\n").filter(Boolean);
  return `${name} terminó con código ${code}: ${lines.slice(-6).join(" | ").slice(-900)}`;
}

/** Ejecuta un proceso y devuelve stdout. Lanza ProcessError con detalles si falla. */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    const t = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    p.on("error", (e) => {
      if (t) clearTimeout(t);
      reject(new Error(`No se pudo ejecutar ${cmd}: ${e.message}. ¿Está instalado?`));
    });
    p.on("close", (code, signal) => {
      if (t) clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new ProcessError(describeExit(cmd, code, signal, timedOut, err), cmd, args, code, signal, err.slice(-4000), timedOut));
    });
    p.stdin.on("error", () => undefined);
    if (opts.input) p.stdin.end(opts.input);
    else p.stdin.end();
  });
}

export { describeExit };

export async function ffprobeDuration(file: string) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error(`No se pudo leer la duración de ${file}`);
  return d;
}

export async function ffprobeSize(file: string): Promise<{ w: number; h: number }> {
  const out = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
  const [w, h] = out.trim().split("\n")[0].split("x").map(Number);
  return { w: w || 0, h: h || 0 };
}

export function exists(p?: string | null): p is string {
  return !!p && fs.existsSync(p) && fs.statSync(p).size > 0;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Descarga en streaming a disco (sin cargar el archivo entero en memoria). */
export async function downloadTo(url: string, dest: string, headers: Record<string, string> = {}, maxBytes = 400_000_000) {
  const res = await fetchWithTimeout(url, { headers }, 120000);
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status}) ${url}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error("Archivo demasiado grande");
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let total = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error("Archivo demasiado grande");
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    if (total === 0) throw new Error("Descarga vacía");
    fs.renameSync(tmp, dest);
    return dest;
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};
