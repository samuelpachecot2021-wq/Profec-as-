import { db } from "./db";
import { produce } from "./pipeline";
import { updateProject, type JobRow } from "./projects";
import { getSetting } from "./settings";
import { sleep } from "./util";

declare global {
  // eslint-disable-next-line no-var
  var __profeciaWorker: { running: boolean; current: number | null } | undefined;
}

class Cancelled extends Error {}

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

/** Recupera trabajos interrumpidos (por ejemplo, si se cerró la aplicación). */
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
  globalThis.__profeciaWorker = { running: true, current: null };
  recover();
  void loop();
}

async function loop() {
  const w = globalThis.__profeciaWorker!;
  for (;;) {
    const job = db().prepare("SELECT * FROM jobs WHERE status = 'en_cola' ORDER BY id LIMIT 1").get() as JobRow | undefined;
    if (!job) {
      await sleep(2000);
      continue;
    }
    w.current = job.id;
    db().prepare("UPDATE jobs SET status = 'procesando', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?").run(job.id);
    updateProject(job.project_id, { status: "procesando" });
    const log = (msg: string) =>
      db().prepare("UPDATE jobs SET log = substr(log || ? , -20000), updated_at = datetime('now') WHERE id = ?").run(`${new Date().toLocaleTimeString("es")} ${msg}\n`, job.id);
    let lastStep = "";
    const report = (progress: number, step: string) => {
      const st = db().prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string } | undefined;
      if (!st || st.status === "cancelado") throw new Cancelled("Cancelado por la usuaria");
      db().prepare("UPDATE jobs SET progress = ?, step = ?, updated_at = datetime('now') WHERE id = ?").run(progress, step, job.id);
      if (step.replace(/\(.*\)/, "") !== lastStep) {
        lastStep = step.replace(/\(.*\)/, "");
        log(step);
      }
    };
    try {
      await produce(job.project_id, report);
      db().prepare("UPDATE jobs SET status = 'completado', progress = 1, updated_at = datetime('now') WHERE id = ?").run(job.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Cancelled) {
        log("Cancelado");
      } else {
        console.error(`Trabajo ${job.id} falló:`, e);
        log(`ERROR: ${msg}`);
        db().prepare("UPDATE jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 2000), job.id);
        updateProject(job.project_id, { status: "error", error: msg.slice(0, 2000) });
      }
    } finally {
      w.current = null;
    }
  }
}
