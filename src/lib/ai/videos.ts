import { createTask, waitTask, downloadOutput, runwayKey, imageDataUri } from "./runway";
import { videoModel, videoCostUSD, clipSeconds, RUNWAY_CREDIT_USD, type Format } from "./pricing";

/** Módulo de proveedores de VIDEO. Hoy: Runway (API oficial, imagen → video). */
export type VideoResult = { file: string; costUSD: number; seconds: number; provider: string; model: string };

export const videoProviders = [
  { id: "runway", label: "Runway", available: () => !!runwayKey(), help: "Clave en dev.runway.com → API Keys (pago mínimo de 10 USD en créditos)" },
];

export function estimateVideo(modelId: string | undefined, neededSeconds: number) {
  const m = videoModel(modelId);
  const seconds = clipSeconds(m, neededSeconds);
  return { seconds, costUSD: videoCostUSD(m, seconds), model: m };
}

/**
 * Anima una imagen (fotograma inicial) con movimiento real: personajes, nubes, agua, cámara.
 * `imageUrl` (salida reciente de Runway) evita volver a subir la imagen; si no, se usa el archivo local.
 */
export async function generateVideo(o: { imageFile: string; imageUrl?: string | null; prompt: string; format: Format; modelId?: string; neededSeconds: number; dest: string; onProgress?: (p: number) => void }): Promise<VideoResult> {
  const m = videoModel(o.modelId);
  const seconds = clipSeconds(m, o.neededSeconds);
  const promptImage = o.imageUrl && /^https:\/\//.test(o.imageUrl) ? o.imageUrl : await imageDataUri(o.imageFile);
  const body: Record<string, unknown> = { model: m.id, promptImage, promptText: o.prompt.slice(0, 1000), ratio: m.ratio[o.format], duration: seconds };
  if (m.id.startsWith("veo")) body.audio = false;
  let id: string;
  try {
    id = await createTask("/v1/image_to_video", body);
  } catch (e) {
    // la URL temporal pudo caducar: se reintenta una vez con la imagen local
    if (promptImage === o.imageUrl) id = await createTask("/v1/image_to_video", { ...body, promptImage: await imageDataUri(o.imageFile) });
    else throw e;
  }
  const task = await waitTask(id, { timeoutMs: 20 * 60_000, onProgress: o.onProgress });
  await downloadOutput(task, o.dest);
  const credits = task.cost?.credits ?? Math.ceil(m.creditsPerSecond * seconds + m.extraCredits);
  return { file: o.dest, costUSD: credits * RUNWAY_CREDIT_USD, seconds, provider: "runway", model: m.id };
}

export { videoCostUSD };
