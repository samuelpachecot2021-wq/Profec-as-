import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PROJECTS_DIR, CACHE_DIR } from "./paths";

/**
 * Espacio en disco del almacenamiento persistente (/data en Railway).
 * Causa real del error «FFmpeg terminó con código 228» (= -28, ENOSPC: sin espacio en disco):
 * los archivos intermedios del render llenaban el volumen.
 */

export class DiskFullError extends Error {}

export function diskInfo(dir = DATA_DIR) {
  try {
    const s = fs.statfsSync(dir);
    const mb = (n: number) => Math.round((n * s.bsize) / 1048576);
    return { freeMB: mb(s.bavail), totalMB: mb(s.blocks) };
  } catch {
    return { freeMB: Number.POSITIVE_INFINITY, totalMB: 0 };
  }
}

export function dirSizeMB(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else
        try {
          total += fs.statSync(p).size;
        } catch {}
    }
  };
  walk(dir);
  return Math.round(total / 1048576);
}

/** Mbit/s medidos en renders reales a 1080×1920 (fotos ≈ 6,6; clips de video hasta ≈ 12). */
export function finalMbps(w: number, h: number, videoShare = 0.5) {
  return (7 + 5 * videoShare) * ((w * h) / (1080 * 1920));
}

/**
 * Espacio que necesitará todo el render (MB): una copia de los bloques intermedios
 * (≈1,8 Mbit/s con fotos, más con clips) + el MP4 final + un pequeño margen.
 */
export function estimateRenderMB(totalSec: number, w: number, h: number, videoShare = 0.5) {
  const interMbps = (1.8 + 4 * videoShare) * ((w * h) / (1080 * 1920));
  return Math.ceil(((interMbps + finalMbps(w, h, videoShare)) * totalSec) / 8) + 25;
}

/** Espacio para el render final (MP4 + margen). */
export function estimateFinalMB(totalSec: number, w: number, h: number, videoShare = 0.5) {
  return Math.ceil((finalMbps(w, h, videoShare) * totalSec) / 8) + 10;
}

/** Elimina restos de renders interrumpidos (archivos «.part»), en todo el almacenamiento. */
function removePartials(): number {
  let freed = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.part(\.\w+)?$|\.part\.mp4$|\.part\.wav$/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          if (Date.now() - st.mtimeMs < 120_000) continue; // puede estar escribiéndose ahora mismo
          freed += st.size;
          fs.rmSync(p, { force: true });
        } catch {}
      }
    }
  };
  walk(PROJECTS_DIR);
  walk(CACHE_DIR);
  return freed;
}

/**
 * Libera espacio de forma segura, de menos a más:
 *  1) archivos «.part» de renders interrumpidos
 *  2) caché de búsquedas de más de 1 día
 *  3) escenas intermedias de OTROS proyectos (solo se pierde velocidad al reanudarlos, nunca dinero)
 * Nunca se borran imágenes/videos de Runway, recursos descargados, narraciones ni videos terminados.
 */
export function freeSpace(o: { keepProject?: string; neededMB?: number } = {}): { freedMB: number; steps: string[] } {
  const steps: string[] = [];
  let freed = removePartials();
  if (freed) steps.push(`archivos temporales interrumpidos: ${Math.round(freed / 1048576)} MB`);
  const enough = () => o.neededMB === undefined || diskInfo().freeMB >= o.neededMB;
  if (enough() && o.neededMB !== undefined) return { freedMB: Math.round(freed / 1048576), steps };
  const searchDir = path.join(CACHE_DIR, "busquedas");
  let cache = 0;
  try {
    for (const f of fs.readdirSync(searchDir)) {
      const p = path.join(searchDir, f);
      const st = fs.statSync(p);
      if (Date.now() - st.mtimeMs > 86400_000) {
        cache += st.size;
        fs.rmSync(p, { force: true });
      }
    }
  } catch {}
  if (cache) steps.push(`caché de búsquedas: ${Math.round(cache / 1048576)} MB`);
  freed += cache;
  if (!enough() || o.neededMB === undefined) {
    let segs = 0;
    try {
      for (const id of fs.readdirSync(PROJECTS_DIR)) {
        if (id === o.keepProject) continue;
        const d = path.join(PROJECTS_DIR, id, "segmentos");
        if (!fs.existsSync(d)) continue;
        const mb = dirSizeMB(d);
        for (const f of fs.readdirSync(d)) if (!f.startsWith("particulas-")) fs.rmSync(path.join(d, f), { force: true });
        segs += mb;
        if (enough() && o.neededMB !== undefined) break;
      }
    } catch {}
    if (segs) steps.push(`escenas intermedias de otros proyectos: ${segs} MB`);
    freed += segs * 1048576;
  }
  return { freedMB: Math.round(freed / 1048576), steps };
}

/**
 * Comprueba que hay espacio para una fase del render; si no, libera lo seguro.
 * Si aun así no alcanza, se detiene ANTES de empezar con un mensaje claro.
 */
export function ensureSpace(neededMB: number, phase: string, log: (m: string) => void, keepProject?: string) {
  let d = diskInfo();
  if (d.freeMB >= neededMB) return d;
  log(`${phase}: espacio libre ${d.freeMB} MB, se necesitan ~${neededMB} MB. Liberando temporales…`);
  const r = freeSpace({ keepProject, neededMB });
  if (r.steps.length) log(`Liberado: ${r.steps.join(" · ")}`);
  d = diskInfo();
  if (d.freeMB >= neededMB) return d;
  throw new DiskFullError(
    `El disco del servidor está casi lleno: quedan ${d.freeMB} MB de ${d.totalMB} MB y ${phase.toLowerCase()} necesita ~${neededMB} MB. ` +
      `Borre proyectos antiguos (Mis proyectos) o amplíe el volumen en Railway (servicio → Settings → Volumes) y pulse «Reanudar producción». No se ha perdido nada de lo ya generado.`,
  );
}

/** Uso del almacenamiento por categorías (para Ajustes). */
export function storageReport() {
  const d = diskInfo();
  let segments = 0;
  let media = 0;
  let outputs = 0;
  try {
    for (const id of fs.readdirSync(PROJECTS_DIR)) {
      segments += dirSizeMB(path.join(PROJECTS_DIR, id, "segmentos"));
      media += dirSizeMB(path.join(PROJECTS_DIR, id, "media")) + dirSizeMB(path.join(PROJECTS_DIR, id, "audio"));
      outputs += dirSizeMB(path.join(PROJECTS_DIR, id, "salida"));
    }
  } catch {}
  return { ...d, segmentsMB: segments, mediaMB: media, outputsMB: outputs, cacheMB: dirSizeMB(CACHE_DIR), libraryMB: dirSizeMB(path.join(DATA_DIR, "biblioteca")) };
}
