import { db } from "./db";
import { getSetting } from "./settings";

export function recordCost(c: { projectId?: string; provider: string; units: number; unit: string; cost: number; note?: string }) {
  db()
    .prepare("INSERT INTO cost_ledger (project_id, provider, units, unit, cost, note) VALUES (?,?,?,?,?,?)")
    .run(c.projectId ?? null, c.provider, c.units, c.unit, c.cost, c.note ?? null);
  if (c.projectId) db().prepare("UPDATE projects SET spent_cost = spent_cost + ? WHERE id = ?").run(c.cost, c.projectId);
}

export function monthSpent() {
  const r = db().prepare("SELECT COALESCE(SUM(cost),0) AS s FROM cost_ledger WHERE created_at >= date('now','start of month')").get() as { s: number };
  return r.s;
}

export function monthlyBudget() {
  return parseFloat(getSetting("MONTHLY_BUDGET_USD") || "10") || 0;
}

/** Comprueba que un gasto cabe en lo autorizado para el proyecto y en el presupuesto mensual. */
export function assertCanSpend(projectId: string, amount: number) {
  if (amount <= 0) return;
  const p = db().prepare("SELECT authorized_cost, spent_cost FROM projects WHERE id = ?").get(projectId) as
    | { authorized_cost: number; spent_cost: number }
    | undefined;
  if (!p) throw new Error("Proyecto no encontrado");
  if (p.spent_cost + amount > p.authorized_cost + 0.0001)
    throw new Error(
      `Este paso costaría ~$${amount.toFixed(3)} y supera lo autorizado para el proyecto ($${p.authorized_cost.toFixed(2)}). Autorice un costo mayor o use opciones gratuitas.`,
    );
  if (monthSpent() + amount > monthlyBudget())
    throw new Error(`Se alcanzaría el presupuesto mensual ($${monthlyBudget().toFixed(2)}). Auméntelo en Ajustes o use opciones gratuitas.`);
}
