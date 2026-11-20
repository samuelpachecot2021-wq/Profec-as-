import fs from "node:fs";
import os from "node:os";
import { diskInfo } from "./disk";

/**
 * Recursos REALES del contenedor (Railway, Docker…). os.cpus() devuelve los núcleos
 * del servidor físico (p. ej. 32–48), no los asignados: si FFmpeg abre un hilo por
 * cada uno, la memoria se dispara y el sistema lo detiene («código null» / SIGKILL).
 */

function readFirst(paths: string[]) {
  for (const p of paths) {
    try {
      return fs.readFileSync(p, "utf8").trim();
    } catch {}
  }
  return null;
}

/** Núcleos asignados al contenedor (cgroup v2/v1), o variable RENDER_CPUS. */
export function containerCpus(): number {
  const env = parseFloat(process.env.RENDER_CPUS || "");
  if (env > 0) return Math.max(1, Math.floor(env));
  const v2 = readFirst(["/sys/fs/cgroup/cpu.max"]);
  if (v2) {
    const [quota, period] = v2.split(/\s+/);
    if (quota !== "max" && +period > 0) return Math.max(1, Math.floor(+quota / +period));
  }
  const q = readFirst(["/sys/fs/cgroup/cpu/cpu.cfs_quota_us"]);
  const per = readFirst(["/sys/fs/cgroup/cpu/cpu.cfs_period_us"]);
  if (q && per && +q > 0 && +per > 0) return Math.max(1, Math.floor(+q / +per));
  return Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length);
}

/** Memoria límite del contenedor en MB (cgroup), o RENDER_MEMORY_MB, o la del sistema. */
export function containerMemoryMB(): number {
  const env = parseFloat(process.env.RENDER_MEMORY_MB || "");
  if (env > 0) return env;
  const raw = readFirst(["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]);
  const total = os.totalmem() / 1048576;
  if (raw && raw !== "max") {
    const mb = Number(raw) / 1048576;
    if (mb > 0 && mb < total * 4 && mb < 1e7) return Math.min(mb, total);
  }
  return total;
}

/** Memoria usada ahora por todo el contenedor (MB), si se puede leer. */
export function containerMemoryUsedMB(): number | null {
  const raw = readFirst(["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]);
  if (raw && /^\d+$/.test(raw)) return Math.round(Number(raw) / 1048576);
  return Math.round((os.totalmem() - os.freemem()) / 1048576);
}

export type RenderProfile = {
  threads: number; // hilos por proceso de FFmpeg
  lowMemory: boolean;
  chunk: number; // escenas que se unen a la vez con transiciones
  concurrency: number; // videos simultáneos
  cpus: number;
  memoryMB: number;
};

/** Perfil de render seguro según CPU y memoria disponibles. */
export function renderProfile(): RenderProfile {
  const cpus = containerCpus();
  const memoryMB = containerMemoryMB();
  const lowMemory = memoryMB < 3000;
  const envThreads = parseInt(process.env.FFMPEG_THREADS || "", 10);
  // ~300 MB por proceso con 2 hilos en vertical 1080p con clips 4K; se deja margen para Node.
  const threads = envThreads > 0 ? envThreads : Math.max(1, Math.min(cpus, lowMemory ? 2 : 4));
  const envConc = parseInt(process.env.MAX_CONCURRENT_JOBS || "", 10);
  const byMemory = Math.max(1, Math.floor((memoryMB - 400) / 1200));
  const byCpu = Math.max(1, Math.floor(cpus / 2));
  const auto = Math.min(3, byMemory, byCpu);
  const concurrency = envConc > 0 ? Math.min(envConc, 6, byMemory) : auto;
  return { threads, lowMemory, chunk: lowMemory ? 4 : 8, concurrency, cpus, memoryMB: Math.round(memoryMB) };
}

/** Argumentos de FFmpeg que limitan hilos (decodificación, filtros y codificación). */
export function threadArgs(threads: number) {
  return {
    input: ["-threads", String(threads)],
    filter: ["-filter_threads", String(threads), "-filter_complex_threads", String(threads)],
    encode: ["-threads", String(threads), "-x264-params", `threads=${threads}:lookahead-threads=1`],
  };
}

export function resourceSummary() {
  const p = renderProfile();
  const used = containerMemoryUsedMB();
  const d = diskInfo();
  const disk = Number.isFinite(d.freeMB) ? ` · disco libre: ${d.freeMB} / ${d.totalMB} MB` : "";
  return `CPU asignadas: ${p.cpus} · memoria: ${used ?? "?"} / ${p.memoryMB} MB · hilos FFmpeg: ${p.threads} · videos simultáneos: ${p.concurrency}${p.lowMemory ? " · modo memoria reducida" : ""}${disk}`;
}
