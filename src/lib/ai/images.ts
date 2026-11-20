import path from "node:path";
import { createTask, waitTask, downloadOutput, runwayKey } from "./runway";
import { imageModel, imageCostUSD, RUNWAY_CREDIT_USD, type Format } from "./pricing";

/** Módulo de proveedores de IMÁGENES. Hoy: Runway (API oficial). */
export type ImageResult = { file: string; remoteUrl: string; costUSD: number; provider: string; model: string };

export const imageProviders = [
  { id: "runway", label: "Runway", available: () => !!runwayKey(), help: "Clave en dev.runway.com → API Keys (pago mínimo de 10 USD en créditos)" },
];

export function estimateImageUSD(modelId?: string) {
  return imageCostUSD(imageModel(modelId));
}

export async function generateImage(o: { prompt: string; format: Format; modelId?: string; seed?: number; dest: string; onProgress?: (p: number) => void }): Promise<ImageResult> {
  const m = imageModel(o.modelId);
  const maxLen = m.id === "gen4_image" ? 1000 : 4000;
  const body: Record<string, unknown> = { model: m.id, promptText: o.prompt.slice(0, maxLen), ratio: m.ratio[o.format] };
  if (m.seed && typeof o.seed === "number") body.seed = o.seed;
  const id = await createTask("/v1/text_to_image", body);
  const task = await waitTask(id, { timeoutMs: 6 * 60_000, onProgress: o.onProgress });
  const ext = path.extname(new URL(task.output?.[0] ?? "https://x/a.png").pathname) || ".png";
  const file = o.dest.replace(/\.\w+$/, "") + ext;
  const remoteUrl = await downloadOutput(task, file);
  const credits = task.cost?.credits ?? m.credits;
  return { file, remoteUrl, costUSD: credits * RUNWAY_CREDIT_USD, provider: "runway", model: m.id };
}
