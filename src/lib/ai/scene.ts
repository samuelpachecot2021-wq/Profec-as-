import path from "node:path";
import { getProject, projectSettings, updateProject, type SceneRow } from "../projects";
import { insertAsset } from "../media";
import { projectDir } from "../paths";
import { recordCost, monthSpent, monthlyBudget, assertCanSpend } from "../costs";
import { hash } from "../util";
import { imageModel, videoModel, imageCostUSD, videoCostUSD, clipSeconds, RUNWAY_CREDIT_USD } from "./pricing";
import { imagePrompt } from "./prompts";
import { generateImage } from "./images";
import { generateVideo } from "./videos";
import { runwayKey } from "./runway";

/** Estimación detallada para regenerar UNA escena con IA (se muestra antes de cobrar nada). */
export function sceneAiEstimate(projectId: string, sc: SceneRow, kind: "image" | "video") {
  const s = projectSettings(getProject(projectId)!);
  const im = imageModel(s.aiImageModel);
  const vm = videoModel(s.aiVideoModel);
  const needed = Math.max(2, sc.end - sc.start + 0.6);
  const seconds = clipSeconds(vm, needed);
  const items = [{ label: `Runway · 1 imagen (${im.label})`, cost: imageCostUSD(im) }];
  if (kind === "video") items.push({ label: `Runway · 1 clip de ${seconds} s (${vm.label})`, cost: videoCostUSD(vm, seconds) });
  const total = items.reduce((a, i) => a + i.cost, 0);
  return { items, total, free: false, notes: [`Proveedor: Runway (API oficial). Precio oficial: 1 crédito = 0,01 USD. Se registrará el costo real informado por Runway.`] };
}

export async function generateSceneAi(projectId: string, sc: SceneRow, kind: "image" | "video", userPrompt?: string) {
  if (!runwayKey()) throw new Error("Falta la clave de Runway en Ajustes.");
  const p = getProject(projectId)!;
  const s = projectSettings(p);
  const est = sceneAiEstimate(projectId, sc, kind);
  if (monthSpent() + est.total > monthlyBudget()) throw new Error("Se superaría el presupuesto mensual.");
  if (p.authorized_cost - p.spent_cost < est.total) updateProject(projectId, { authorized_cost: p.spent_cost + est.total + 0.001 });
  const im = imageModel(s.aiImageModel);
  const vm = videoModel(s.aiVideoModel);
  const meta = sc.queries ? (JSON.parse(sc.queries) as { meaning?: string }) : {};
  const { prompt, motion, theme } = imagePrompt({ text: userPrompt ? `${userPrompt}. ${sc.text}` : sc.text, meaning: meta.meaning, query: sc.query, format: s.format });
  const key = hash(sc.id, kind, Date.now());
  const dir = projectDir(projectId, "media");
  assertCanSpend(projectId, imageCostUSD(im));
  const img = await generateImage({ prompt, format: s.format, modelId: im.id, dest: path.join(dir, `ia-runway-${key}.png`) });
  recordCost({ projectId, provider: "runway", units: img.costUSD / RUNWAY_CREDIT_USD, unit: "créditos", cost: img.costUSD, note: `imagen IA de escena ${im.id}` });
  const lic = `Generado con IA (Runway)${theme.recreation ? " — recreación artística" : ""}`;
  const imageId = insertAsset(projectId, { provider: "runway-ia", kind: "image", externalId: key, license: lic, attribution: "Recreación artística generada con IA (Runway)", localPath: img.file, isAi: true });
  if (kind === "image") return imageId;
  assertCanSpend(projectId, videoCostUSD(vm, clipSeconds(vm, Math.max(2, sc.end - sc.start + 0.6))));
  const vid = await generateVideo({ imageFile: img.file, imageUrl: img.remoteUrl, prompt: motion, format: s.format, modelId: vm.id, neededSeconds: Math.max(2, sc.end - sc.start + 0.6), dest: path.join(dir, `ia-runway-video-${key}.mp4`) });
  recordCost({ projectId, provider: "runway", units: vid.costUSD / RUNWAY_CREDIT_USD, unit: "créditos", cost: vid.costUSD, note: `video IA de escena ${vm.id} ${vid.seconds} s` });
  return insertAsset(projectId, { provider: "runway-ia", kind: "video", externalId: `v-${key}`, license: lic, attribution: "Recreación artística generada con IA (Runway)", localPath: vid.file, isAi: true });
}
