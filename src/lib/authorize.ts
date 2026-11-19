import { estimateProject, type Estimate } from "./estimate";
import { getProject, updateProject } from "./projects";
import { monthSpent, monthlyBudget } from "./costs";

/**
 * Control de costos: si el paso puede generar cargos y la usuaria no lo
 * autorizó, devuelve la estimación para mostrarla. Si autoriza, se fija un
 * tope (estimación + 20 %) que el servidor nunca supera.
 */
export async function checkAuthorization(projectId: string, scope: "script" | "video", authorize: boolean): Promise<Estimate | null> {
  const est = await estimateProject(projectId, scope);
  if (est.free) return null;
  const p = getProject(projectId)!;
  const available = p.authorized_cost - p.spent_cost;
  if (available >= est.total) return null;
  if (!authorize) return est;
  if (monthSpent() + est.total > monthlyBudget())
    throw new Error(
      `Este paso costaría ~$${est.total.toFixed(2)} y se superaría el presupuesto mensual ($${monthlyBudget().toFixed(2)}). Auméntelo en Ajustes.`,
    );
  updateProject(projectId, { authorized_cost: p.spent_cost + est.total * 1.2 + 0.01 });
  return null;
}
