import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";
import { renderProfile, resourceSummary } from "./resources";
import { ProcessError } from "./util";
import { db } from "./db";
import { produce, type Reporter } from "./pipeline";
import { getProject, updateProject, type JobRow } from "./projects";
import { getSetting } from "./settings";
import { notifyAll } from "./push";
import { sleep } from "./util";

declare global {
  // eslint-disable-next-line no-var
  var __profeciaWorker: { running: boolean; active: Set<number> } | undefined;
}

class Cancelled extends Error {}

/** Videos que se producen a la vez. Por defecto, según los núcleos del servidor. */
export function maxConcurrent() {
  // Según CPU y MEMORIA reales del contenedor (ver resources.ts): evita que el sistema detenga FFmpeg.
  return renderProfile().concurrency;
}

/** Guarda un registro detallado del error en el disco de datos (data/logs/). */
function writeErrorLog(job: JobRow, e: unknown) {
  try {
    const dir = path.join(DATA_DIR, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      `══ ${new Date().toISOString()} · proyecto ${job.project_id} · trabajo ${job.id} · intento ${job.attempts + 1}`,
      `Servidor: ${resourceSummary()}`,
      `Error: ${e instanceof Error ? e.message : String(e)}`,
    ];
    if (e instanceof ProcessError) {
      lines.push(`Proceso: ${e.cmd} · código ${e.code} · señal ${e.signal ?? "-"}`);
      lines.push(`Comando: ${e.cmd} ${e.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ").slice(0, 3000)}`);
      lines.push(`Salida de ${e.cmd} (final):\n${e.stderrTail}`);
    } else if (e instanceof Error && e.stack) lines.push(e.stack);
    const text = lines.join("\n") + "\n\n";
    fs.appendFileSync(path.join(dir, "errores.log"), text);
    fs.appendFileSync(path.join(dir, `proyecto-${job.project_id}.log`), text);
    // el archivo general no crece sin límite
    const general = path.join(dir, "errores.log");
    if (fs.statSync(general).size > 5_000_000) fs.writeFileSync(general, fs.readFileSync(general, "utf8").slice(-2_000_000));
  } catch (err) {
    console.warn("No se pudo escribir el registro de errores", err);
  }
}

export function enqueue(projectId: string, type = "produce") {
  const active = db().prepare("SELECT id FROM jobs WHERE project_id = ? AND status IN ('en_cola','procesando')").get(projectId) as { id: number } | undefined;
  if (active) return active.id;
  const today = db()
    .prepare("SELECT COUNT(DISTINCT project_id) AS n FROM jobs WHERE created_at >= date('now') AND project_id != ?")
    .get(projectId) as { n: number };
  const limit = parseInt(getSetting("DAILY_PROJECT_LIMIT") || "12", 10);
  if (today.n >= limit) throw new Error(`Se alcanzó el límite diario de ${limit} proyectos. Puede cambiarlo en Ajustes.`);
  const r = db().prepare("INSERT INTO jobs (project_id, type) VALUES (?, ?)").run(projectId, type);
  updateProject(projectId, { status: "en_cola", error: null });
  startWorker();
  return Number(r.lastInsertRowid);
}

export function cancelJob(projectId: string) {
  db().prepare("UPDATE jobs SET status = 'cancelado', updated_at = datetime('now') WHERE project_id = ? AND status IN ('en_cola','procesando')").run(projectId);
  updateProject(projectId, { status: "cancelado" });
}

export function queueState() {
  return db()
    .prepare(
      "SELECT j.*, p.title FROM jobs j JOIN projects p ON p.id = j.project_id WHERE j.status IN ('en_cola','procesando') OR j.updated_at >= datetime('now','-1 day') ORDER BY j.id DESC LIMIT 50",
    )
    .all() as (JobRow & { title: string })[];
}

/** Recupera trabajos interrumpidos (reinicio del servidor, actualización, corte de luz…). */
function recover() {
  const stuck = db().prepare("SELECT * FROM jobs WHERE status = 'procesando'").all() as JobRow[];
  for (const j of stuck) {
    if (j.attempts >= 3) {
      db().prepare("UPDATE jobs SET status = 'error', error = 'Interrumpido demasiadas veces' WHERE id = ?").run(j.id);
      updateProject(j.project_id, { status: "error", error: "El trabajo se interrumpió varias veces." });
    } else {
      db().prepare("UPDATE jobs SET status = 'en_cola', step = 'Reanudando tras una interrupción…' WHERE id = ?").run(j.id);
    }
  }
}

export function startWorker() {
  if (globalThis.__profeciaWorker?.running) return;
  globalThis.__profeciaWorker = { running: true, active: new Set() };
  recover();
  void loop();
}

/** Toma el siguiente trabajo de la cola de forma atómica. */
function claim(): JobRow | undefined {
  return db()
    .prepare(
      "UPDATE jobs SET status = 'procesando', attempts = attempts + 1, updated_at = datetime('now') WHERE id = (SELECT id FROM jobs WHERE status = 'en_cola' ORDER BY id LIMIT 1) RETURNING *",
    )
    .get() as JobRow | undefined;
}

async function loop() {
  const w = globalThis.__profeciaWorker!;
  for (;;) {
    if (w.active.size < maxConcurrent()) {
      const job = claim();
      if (job) {
        w.active.add(job.id);
        void runJob(job).finally(() => w.active.delete(job.id));
        continue;
      }
    }
    await sleep(1500);
  }
}

async function runJob(job: JobRow) {
  updateProject(job.project_id, { status: "procesando" });
  const log = (msg: string) =>
    db().prepare("UPDATE jobs SET log = substr(log || ? , -20000), updated_at = datetime('now') WHERE id = ?").run(`${new Date().toLocaleTimeString("es")} ${msg}\n`, job.id);
  let lastStep = "";
  const report: Reporter = (progress: number, step: string) => {
    const st = db().prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string } | undefined;
    if (!st || st.status === "cancelado") throw new Cancelled("Cancelado por la usuaria");
    db().prepare("UPDATE jobs SET progress = ?, step = ?, updated_at = datetime('now') WHERE id = ?").run(progress, step, job.id);
    const k = step.replace(/\(.*\)/, "");
    if (k !== lastStep) {
      lastStep = k;
      log(step);
    }
  };
  report.log = log;
  log(`Inicio (intento ${job.attempts}). ${resourceSummary()}`);
  try {
    await produce(job.project_id, report);
    db().prepare("UPDATE jobs SET status = 'completado', progress = 1, updated_at = datetime('now') WHERE id = ?").run(job.id);
    const p = getProject(job.project_id);
    await notifyAll({ title: "✅ Video listo", body: p?.title ?? "Su video ya se puede ver y descargar.", url: `/proyecto/${job.project_id}`, tag: `p-${job.project_id}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Cancelled) {
      log("Cancelado");
    } else {
      console.error(`Trabajo ${job.id} falló:`, e);
      log(`ERROR: ${msg}`);
      if (e instanceof ProcessError && e.stderrTail) log(`Detalle de ${e.cmd}: ${e.stderrTail.trim().split("\n").slice(-4).join(" | ").slice(0, 600)}`);
      log("Puede pulsar «Reanudar producción»: la narración, las imágenes y las escenas ya hechas se reutilizan sin gastar créditos.");
      writeErrorLog(job, e);
      db().prepare("UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 2000), job.id);
      updateProject(job.project_id, { status: "error", error: msg.slice(0, 2000) });
      const p = getProject(job.project_id);
      await notifyAll({ title: "⚠️ No se pudo terminar el video", body: `${p?.title ?? "Proyecto"}: ${msg.slice(0, 120)}`, url: `/proyecto/${job.project_id}`, tag: `p-${job.project_id}` });
    }
  }
}
