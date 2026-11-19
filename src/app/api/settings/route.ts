import { publicSettings, saveSettings, type AnyKey } from "@/lib/settings";
import { monthSpent, monthlyBudget } from "@/lib/costs";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  return ok({ ...publicSettings(), monthSpent: monthSpent(), monthlyBudget: monthlyBudget() });
}

/** Guarda claves y preferencias. Un valor vacío ("") borra la clave guardada en la app. */
export async function POST(req: Request) {
  try {
    const b = await body<Record<string, string>>(req);
    saveSettings(b as Partial<Record<AnyKey, string>>);
    return ok({ ...publicSettings(), monthSpent: monthSpent(), monthlyBudget: monthlyBudget() });
  } catch (e) {
    return fail(e);
  }
}
