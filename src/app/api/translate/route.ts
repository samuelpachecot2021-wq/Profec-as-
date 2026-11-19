import { translateToSpanish, detectLanguage } from "@/lib/script";
import { activeProvider, estimateClaudeCost } from "@/lib/llm";
import { monthSpent, monthlyBudget } from "@/lib/costs";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(req: Request) {
  try {
    const { text, authorize } = await body<{ text: string; authorize?: boolean }>(req);
    if (!text?.trim()) throw new Error("No hay texto para traducir");
    if (detectLanguage(text) === "es") return ok({ text, note: "El texto ya está en español." });
    const provider = await activeProvider();
    if (provider === "claude") {
      const cost = estimateClaudeCost(text.length + 500, text.length * 1.1);
      if (!authorize) return ok({ needsAuthorization: true, estimate: { items: [{ label: "Traducción con Claude", cost }], total: cost, free: false, notes: [] } });
      if (monthSpent() + cost > monthlyBudget()) throw new Error("Se superaría el presupuesto mensual configurado en Ajustes.");
    }
    return ok({ text: await translateToSpanish(text) });
  } catch (e) {
    return fail(e);
  }
}
