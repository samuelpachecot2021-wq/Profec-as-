import { createProject } from "@/lib/projects";
import { checkAuthorization } from "@/lib/authorize";
import { enqueue } from "@/lib/queue";
import { estimateProject } from "@/lib/estimate";
import { ok, fail, body } from "@/lib/api";
import type { ProjectSettings } from "@/lib/options";

export const runtime = "nodejs";

/**
 * Producción masiva: crea un proyecto por artículo y los pone en la cola.
 * Los artículos se separan en la interfaz con una línea "---".
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ articles: string[]; settings?: Partial<ProjectSettings>; authorize?: boolean; ids?: string[] }>(req);
    let ids = b.ids;
    if (!ids?.length) {
      const arts = (b.articles || []).map((a) => a.trim()).filter((a) => a.length > 40);
      if (!arts.length) throw new Error("No se encontraron artículos (mínimo 40 caracteres cada uno).");
      if (arts.length > 12) throw new Error("Máximo 12 artículos por lote.");
      ids = arts.map((text) => createProject({ text, settings: b.settings }));
    }
    // estimación conjunta antes de cobrar nada
    let total = 0;
    const items: { label: string; cost: number }[] = [];
    for (const id of ids) {
      const e = await estimateProject(id, "video");
      total += e.total;
      items.push({ label: `Proyecto ${items.length + 1}`, cost: e.total });
    }
    if (total > 0.0005 && !b.authorize) return ok({ needsAuthorization: true, ids, estimate: { items, total, free: false, notes: [] } });
    const queued: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await checkAuthorization(id, "video", true);
        enqueue(id);
        queued.push(id);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return ok({ ids, queued, errors });
  } catch (e) {
    return fail(e);
  }
}
