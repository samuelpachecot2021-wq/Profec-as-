import { runwayBalance, runwayKey } from "@/lib/ai/runway";
import { IMAGE_MODELS, VIDEO_MODELS, PRICING_SOURCE, RUNWAY_CREDIT_USD } from "@/lib/ai/pricing";
import { ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Estado de Runway: clave configurada, saldo real de créditos y precios de los modelos. */
export async function GET() {
  const base = { configured: !!runwayKey(), creditUSD: RUNWAY_CREDIT_USD, pricingSource: PRICING_SOURCE, imageModels: IMAGE_MODELS, videoModels: VIDEO_MODELS };
  if (!base.configured) return ok({ ...base, balance: null });
  try {
    const b = await runwayBalance();
    return ok({ ...base, balance: { credits: b.credits, usd: b.credits * RUNWAY_CREDIT_USD } });
  } catch (e) {
    return ok({ ...base, balance: null, error: e instanceof Error ? e.message : String(e) });
  }
}
