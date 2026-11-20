import { storageReport, freeSpace } from "@/lib/disk";
import { queueState } from "@/lib/queue";
import { ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uso del disco persistente por categorías. */
export function GET() {
  return ok(storageReport());
}

/**
 * Libera espacio seguro: temporales de renders interrumpidos, caché de búsquedas antigua y
 * escenas intermedias de proyectos que no se están produciendo. Nunca borra imágenes o
 * videos de Runway, recursos descargados, narraciones ni videos terminados.
 */
export function POST() {
  const active = queueState().find((j) => j.status === "procesando" || j.status === "en_cola");
  const r = freeSpace({ keepProject: active?.project_id });
  return ok({ ...r, report: storageReport() });
}
