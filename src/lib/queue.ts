import os from "node:os";
import { db } from "./db";
import { produce } from "./pipeline";
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
  const env = parseInt(process.env.MAX_CONCURRENT_JOBS || "", 10);
  if (env > 0) return Math.min(env, 6);
  return Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2)));
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
  const report = (progress: number, step: string) => {
    const st = db().prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string } | undefined;
    if (!st || st.status === "cancelado") throw new Cancelled("Cancelado por la usuaria");
    db().prepare("UPDATE jobs SET progress = ?, step = ?, updated_at = datetime('now') WHERE id = ?").run(progress, step, job.id);
    const k = step.replace(/\(.*\)/, "");
    if (k !== lastStep) {
      lastStep = k;
      log(step);
    }
  };
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
      db().prepare("UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 2000), job.id);
      updateProject(job.project_id, { status: "error", error: msg.slice(0, 2000) });
      const p = getProject(job.project_id);
      await notifyAll({ title: "⚠️ No se pudo terminar el video", body: `${p?.title ?? "Proyecto"}: ${msg.slice(0, 120)}`, url: `/proyecto/${job.project_id}`, tag: `p-${job.project_id}` });
    }
  }
}
