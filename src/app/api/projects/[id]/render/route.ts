import { getProject, projectSettings } from "@/lib/projects";
import { runwayKey } from "@/lib/ai/runway";
import { checkAuthorization } from "@/lib/authorize";
import { enqueue, cancelJob } from "@/lib/queue";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("Proyecto no encontrado", 404);
    const { authorize } = await body<{ authorize?: boolean }>(req);
    const st = projectSettings(getProject(id)!);
    if (st.visualMode && st.visualMode !== "bancos" && !runwayKey())
      throw new Error("El modo de producción visual con IA necesita la clave de Runway (Ajustes → Runway; cómo obtenerla en Ayuda). Mientras tanto, elija «Solo bancos gratuitos».");
    const est = await checkAuthorization(id, "video", !!authorize);
    if (est) return ok({ needsAuthorization: true, estimate: est });
    const jobId = enqueue(id);
    return ok({ jobId });
  } catch (e) {
    return fail(e);
  }
}

/** Cancela la producción en curso. */
export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  cancelJob(id);
  return ok({ ok: true });
}
