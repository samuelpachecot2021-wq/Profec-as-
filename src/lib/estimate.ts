import { activeProvider, estimateClaudeCost } from "./llm";
import { WPM } from "./options";
import { estimateTtsCost, voiceById } from "./tts";
import { getSetting } from "./settings";
import { AI_IMAGE_PRICE } from "./media";
import { getProject, getScenes, projectSettings } from "./projects";

export type Estimate = { items: { label: string; cost: number }[]; total: number; free: boolean; notes: string[] };

/** Estimación (al alza) de lo que costará producir el proyecto con los servicios elegidos. */
export async function estimateProject(projectId: string, scope: "script" | "video" = "video"): Promise<Estimate> {
  const p = getProject(projectId);
  if (!p) throw new Error("Proyecto no encontrado");
  const s = projectSettings(p);
  const items: { label: string; cost: number }[] = [];
  const notes: string[] = [];
  const provider = await activeProvider();
  const targetWords = (s.duration / 60) * WPM;
  const scriptChars = p.script.trim() ? p.script.length : targetWords * 6.5;
  const scenesCount = getScenes(projectId).length || Math.ceil(s.duration / 6);

  if (provider === "claude") {
    if (!p.script.trim() || scope === "script") items.push({ label: "Guion con Claude", cost: estimateClaudeCost(p.input_text.length + 3500, targetWords * 6.5) });
    if (scope === "video") {
      items.push({ label: "Planificación de escenas con Claude", cost: estimateClaudeCost(scriptChars + 1500, scenesCount * 160) });
      items.push({ label: "Títulos, descripción y capítulos (SEO)", cost: estimateClaudeCost(scriptChars + 2000, 4000) });
      if (s.translateSubsEn) items.push({ label: "Subtítulos en inglés", cost: estimateClaudeCost(scriptChars * 1.3, scriptChars * 1.1) });
    }
  } else if (provider === "ollama") notes.push("Guion y textos con Ollama (gratis, en su servidor).");
  else notes.push("Sin IA de texto configurada: se usará el modo local gratuito.");

  if (scope === "video") {
    const v = voiceById(s.voiceId);
    if (!p.custom_narration && v.paid) items.push({ label: `Voz (${v.label})`, cost: estimateTtsCost(v.id, scriptChars) });
    if (s.useAiImages && getSetting("OPENAI_API_KEY"))
      items.push({ label: `Imágenes IA (máximo, solo si faltan recursos: ${scenesCount} × $${AI_IMAGE_PRICE})`, cost: scenesCount * AI_IMAGE_PRICE });
    notes.push("Imágenes y videos de Pexels, Pixabay, Unsplash, Wikimedia y NASA: gratis.");
    notes.push("Música sintetizada y render con FFmpeg: gratis.");
  }
  const total = items.reduce((a, i) => a + i.cost, 0);
  return { items, total, free: total < 0.0005, notes };
}
