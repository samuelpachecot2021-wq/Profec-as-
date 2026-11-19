import fs from "node:fs";
import path from "node:path";
import { synthesize, voiceById, estimateTtsCost } from "@/lib/tts";
import { CACHE_DIR } from "@/lib/paths";
import { hash } from "@/lib/util";
import { monthSpent, monthlyBudget, recordCost } from "@/lib/costs";
import { fail } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

const SAMPLE =
  "Lo que está ocurriendo en el mundo... no es casualidad. Hace casi dos mil años, la Biblia lo anunció con una precisión asombrosa. Pero esta historia no termina en el miedo... termina en la esperanza en Jesucristo.";

/** Vista previa de una voz (se guarda en caché para no repetir cargos). */
export async function POST(req: Request) {
  try {
    const { voiceId, speed = 1, text, elevenVoiceId } = (await req.json()) as { voiceId: string; speed?: number; text?: string; elevenVoiceId?: string };
    const v = voiceById(voiceId);
    const t = (text || SAMPLE).slice(0, 400);
    const out = path.join(CACHE_DIR, `voz-${hash(v.id, speed, t, elevenVoiceId ?? "")}.wav`);
    if (!fs.existsSync(out)) {
      const cost = estimateTtsCost(v.id, t.length);
      if (cost > 0 && monthSpent() + cost > monthlyBudget()) throw new Error("Se superaría el presupuesto mensual.");
      await synthesize({ text: t, voiceId: v.id, speed, out, elevenVoiceId });
      if (cost > 0) recordCost({ provider: v.provider, units: t.length, unit: "caracteres", cost, note: "vista previa de voz" });
    }
    return new Response(fs.readFileSync(out), { headers: { "Content-Type": "audio/wav" } });
  } catch (e) {
    return fail(e);
  }
}
