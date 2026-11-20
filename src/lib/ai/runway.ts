import fs from "node:fs";
import { getSetting } from "../settings";
import { fetchWithTimeout, downloadTo, run, sleep } from "../util";

/**
 * Cliente mínimo de la API oficial de Runway Dev (https://docs.dev.runwayml.com).
 * - Base: https://api.dev.runwayml.com · cabeceras: Authorization: Bearer … y X-Runway-Version: 2024-11-06
 * - Las generaciones son asíncronas: POST → { id } → GET /v1/tasks/{id} hasta SUCCEEDED/FAILED.
 * - Las URL de salida son temporales: se descargan de inmediato.
 */
export const runwayBase = () => process.env.RUNWAY_API_BASE || "https://api.dev.runwayml.com";
const VERSION = "2024-11-06";

export class RunwayError extends Error {
  constructor(message: string, public code?: string, public status?: number, public costCredits?: number) {
    super(message);
  }
  /** La moderación cobra igual y repetir puede suspender la cuenta: no se reintenta. */
  get moderated() {
    return /moderat|safety|content/i.test(`${this.code ?? ""} ${this.message}`);
  }
}

export function runwayKey() {
  return getSetting("RUNWAY_API_KEY");
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = runwayKey();
  if (!key) throw new RunwayError("Falta la clave de Runway. Añádala en Ajustes → Runway (instrucciones en Ayuda).", "sin_clave");
  const res = await fetchWithTimeout(
    `${runwayBase()}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": VERSION, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    90_000,
  );
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      msg = j.error || j.message || msg;
    } catch {}
    if (res.status === 401) throw new RunwayError("Runway: la clave no es válida. Revísela en Ajustes.", "clave_invalida", 401);
    if (res.status === 429) throw new RunwayError("Runway: demasiadas solicitudes o límite del nivel de uso alcanzado. Se reintentará.", "limite", 429);
    if (res.status === 400 && /credit/i.test(msg)) throw new RunwayError("Runway: no hay créditos suficientes en su cuenta. Recargue en dev.runway.com.", "sin_creditos", 400);
    throw new RunwayError(`Runway respondió ${res.status}: ${msg}`, "http", res.status);
  }
  return JSON.parse(text) as T;
}

export type RunwayTask = {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
  progress?: number;
  cost?: { credits: number };
  estimatedCost?: { credits: number };
};

export async function createTask(path: string, body: Record<string, unknown>) {
  const r = await call<{ id: string }>("POST", path, body);
  if (!r?.id) throw new RunwayError("Runway no devolvió el identificador de la tarea", "sin_id");
  return r.id;
}

/** Espera el resultado (Runway pide no consultar más de una vez cada 5 s). */
export async function waitTask(id: string, opts: { timeoutMs: number; onProgress?: (p: number) => void; pollMs?: number }): Promise<RunwayTask> {
  const start = Date.now();
  let wait = opts.pollMs ?? (parseInt(process.env.RUNWAY_POLL_MS || "", 10) || 5000);
  for (;;) {
    const t = await call<RunwayTask>("GET", `/v1/tasks/${encodeURIComponent(id)}`);
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELLED")
      throw new RunwayError(`Runway no pudo generar la escena: ${t.failure ?? t.status}${t.failureCode ? ` (${t.failureCode})` : ""}`, t.failureCode ?? t.status, undefined, t.cost?.credits);
    if (typeof t.progress === "number") opts.onProgress?.(t.progress);
    if (Date.now() - start > opts.timeoutMs) throw new RunwayError("Runway tardó demasiado; la tarea sigue en su cuenta y se reintentará al reanudar.", "tiempo");
    await sleep(wait);
    wait = Math.min(15000, Math.max(wait, Math.round(wait * 1.3)));
  }
}

/** Descarga la primera salida de una tarea terminada. */
export async function downloadOutput(task: RunwayTask, dest: string) {
  const url = task.output?.[0];
  if (!url) throw new RunwayError("Runway terminó sin archivo de salida", "sin_salida");
  await downloadTo(url, dest);
  return url;
}

/** Saldo de créditos del proyecto de Runway (comprueba también que la clave funciona). */
export async function runwayBalance() {
  const r = await call<{ creditBalance: number; tier?: { maxMonthlyCreditSpend?: number } }>("GET", "/v1/organization");
  return { credits: r.creditBalance, maxMonthly: r.tier?.maxMonthlyCreditSpend ?? null };
}

/**
 * Imagen local como data URI para «promptImage» (límite oficial: 5 MB codificado ≈ 3,3 MB).
 * Si pesa más, se convierte a JPEG de alta calidad.
 */
export async function imageDataUri(file: string) {
  let f = file;
  if (fs.statSync(f).size > 3_000_000 || !/\.(jpe?g|png|webp)$/i.test(f)) {
    f = `${file}.input.jpg`;
    await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", "scale='min(1920,iw)':-2", "-q:v", "3", f]);
  }
  const ext = f.toLowerCase().endsWith(".png") ? "png" : f.toLowerCase().endsWith(".webp") ? "webp" : "jpeg";
  return `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
}
