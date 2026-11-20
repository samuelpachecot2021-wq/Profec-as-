import { getProject, projectSettings, updateProject } from "@/lib/projects";
import { getPlan, savePlan, approvePlan, planSummary } from "@/lib/ai/plan";
import { enqueue } from "@/lib/queue";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Plan de escenas IA pendiente: proveedor, imágenes, clips, duraciones y costos. */
export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const plan = getPlan(id);
  if (!plan) return ok({ plan: null });
  return ok({
    plan: { ...plan, items: plan.items.map(({ key, gi, text, kind, seconds, clipSeconds, costUSD, reserveUSD, status, recreation, theme, realCostUSD, error }) => ({ key, gi, text, kind, seconds, clipSeconds, costUSD, reserveUSD, status, recreation, theme, realCostUSD, error })) },
    summary: planSummary(plan),
  });
}

/**
 * { action: "approve" } → autoriza el gasto exacto y continúa la producción.
 * { action: "free" }    → continúa sin IA de pago (solo recursos gratuitos).
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("Proyecto no encontrado", 404);
    const { action } = await body<{ action?: string }>(req);
    if (action === "approve") {
      const plan = approvePlan(id);
      const jobId = enqueue(id);
      return ok({ ok: true, jobId, authorizedUSD: plan.maxUSD });
    }
    if (action === "free") {
      updateProject(id, { settings: JSON.stringify({ ...projectSettings(p), visualMode: "bancos" }) });
      savePlan(id, null);
      const jobId = enqueue(id);
      return ok({ ok: true, jobId });
    }
    throw new Error("Acción no válida");
  } catch (e) {
    return fail(e);
  }
}
