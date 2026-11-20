import path from "node:path";
import { getProject, updateProject } from "../projects";
import { insertAsset, getAsset } from "../media";
import { projectDir } from "../paths";
import { assertCanSpend, recordCost, monthSpent, monthlyBudget } from "../costs";
import { hash, exists, sleep, isDiskFull } from "../util";
import { imageModel, videoModel, imageCostUSD, clipSeconds, videoCostUSD, PRICING_SOURCE, RUNWAY_CREDIT_USD, type Format } from "./pricing";
import { generateImage } from "./images";
import { createTask, waitTask, downloadOutput, RunwayError, runwayKey, imageDataUri } from "./runway";
import { imagePrompt, themeOf } from "./prompts";

export type VisualMode = "bancos" | "economico" | "premium" | "inteligente";

export type PlanItem = {
  key: string;
  gi: number; // índice de la toma
  /** tomas de más de 5,5 s se cubren con 2 escenas IA (mitad y mitad) para mantener cambios de 3–5 s */
  part: 1 | 2;
  sceneId: number;
  text: string;
  seconds: number; // duración de la toma en el video
  kind: "video" | "image" | "stock";
  /** solo modo inteligente: si no hay recurso gratuito adecuado, se genera una imagen IA (costo reservado) */
  fallbackImage?: boolean;
  importance: number;
  theme: string;
  recreation: boolean;
  prompt: string;
  motion: string;
  clipSeconds?: number;
  costUSD: number; // costo estimado del ítem (sin la reserva de respaldo)
  reserveUSD: number; // costo de la imagen de respaldo reservada (inteligente)
  status: "pendiente" | "imagen" | "hecho" | "error" | "gratis";
  imageAssetId?: number;
  imageUrl?: string | null;
  imageTaskId?: string;
  videoTaskId?: string;
  assetId?: number;
  realCostUSD?: number;
  error?: string;
};

export type AiPlan = {
  version: 1;
  hash: string;
  mode: VisualMode;
  provider: "runway";
  imageModel: string;
  videoModel: string;
  format: Format;
  budgetUSD: number;
  totalUSD: number; // estimado (videos + imágenes)
  maxUSD: number; // máximo incluyendo imágenes de respaldo
  alreadyPaidUSD: number; // ítems ya generados en intentos anteriores (no se vuelven a cobrar)
  images: number;
  clips: number;
  stock: number;
  approved: boolean;
  approvedAt?: string;
  createdAt: string;
  warnings: string[];
  pricingSource: string;
  items: PlanItem[];
};

/** La producción se detiene hasta que la usuaria autorice el costo exacto de las escenas IA. */
export class AwaitingAiAuthorization extends Error {
  constructor(public plan: AiPlan) {
    super(`Esperando autorización para generar escenas con IA (costo estimado ${plan.totalUSD.toFixed(2)} USD, máximo ${plan.maxUSD.toFixed(2)} USD).`);
  }
}

export function getPlan(projectId: string): AiPlan | null {
  const p = getProject(projectId);
  return p?.ai_plan ? (JSON.parse(p.ai_plan) as AiPlan) : null;
}

export function savePlan(projectId: string, plan: AiPlan | null) {
  updateProject(projectId, { ai_plan: plan ? JSON.stringify(plan) : null });
}

/** Importancia narrativa de una toma (decide dónde se usa video IA en el modo inteligente). */
function importance(gi: number, n: number, text: string, overlayVerse: boolean, seconds: number) {
  const t = themeOf(text);
  let s = t.importance;
  if (gi === 0) s += 6; // gancho de los primeros segundos
  if (gi >= n - 2 && /jes[uú]s|cristo|salv|esperanza|vida eterna/i.test(text)) s += 2; // cierre evangelístico
  if (overlayVerse) s += 1;
  if (seconds > 4) s += 1;
  return s;
}

/**
 * Crea el plan de escenas IA para las tomas del video, respetando el presupuesto máximo.
 * Reutiliza (sin volver a cobrar) los ítems ya generados en planes anteriores.
 */
export function buildPlan(o: {
  mode: VisualMode;
  format: Format;
  budgetUSD: number;
  imageModelId?: string;
  videoModelId?: string;
  shots: { gi: number; sceneId: number; text: string; meaning?: string | null; query?: string | null; seconds: number; verse: boolean; locked?: boolean }[];
  previous?: AiPlan | null;
}): AiPlan {
  const im = imageModel(o.imageModelId);
  const vm = videoModel(o.videoModelId);
  const n = o.shots.length;
  const done = new Map((o.previous?.items ?? []).filter((x) => x.status === "hecho" && x.assetId).map((x) => [x.key, x]));
  const items: PlanItem[] = o.shots.flatMap((s) => {
    const { theme, prompt, motion } = imagePrompt({ text: s.text, meaning: s.meaning, query: s.query, format: o.format });
    const parts: (1 | 2)[] = s.seconds > LONG_SHOT && !s.locked ? [1, 2] : [1];
    return parts.map((part) => ({
      key: "",
      gi: s.gi,
      part,
      sceneId: s.sceneId,
      text: s.text,
      seconds: s.seconds / parts.length,
      kind: (s.locked ? "stock" : o.mode === "economico" ? "image" : o.mode === "premium" ? "video" : "stock") as PlanItem["kind"],
      fallbackImage: o.mode === "inteligente" && !s.locked,
      importance: importance(s.gi, n, s.text, s.verse, s.seconds),
      theme: theme.id,
      recreation: theme.recreation,
      prompt: part === 2 ? `${prompt} Alternative camera angle of the same scene, continuity with the previous shot.` : prompt,
      motion,
      costUSD: 0,
      reserveUSD: 0,
      status: "pendiente" as const,
    }));
  });
  // Modo inteligente: video IA en los momentos más importantes (~30 % de las tomas).
  if (o.mode === "inteligente") {
    const top = [...items].sort((a, b) => b.importance - a.importance).slice(0, Math.max(1, Math.ceil(n * 0.3)));
    const topGi = new Set(top.map((x) => x.gi));
    for (const it of items) if (topGi.has(it.gi) && it.importance >= 3 && it.fallbackImage) {
      it.kind = "video";
      it.fallbackImage = false;
    }
  }
  const price = (it: PlanItem) => {
    it.clipSeconds = it.kind === "video" ? clipSeconds(vm, it.seconds + 0.6) : undefined;
    it.costUSD = it.kind === "video" ? imageCostUSD(im) + videoCostUSD(vm, it.clipSeconds!) : it.kind === "image" ? imageCostUSD(im) : 0;
    it.reserveUSD = it.kind === "stock" && it.fallbackImage ? imageCostUSD(im) : 0;
    it.key = hash(it.text, it.part, it.kind, it.kind === "video" ? it.clipSeconds : 0, im.id, it.kind === "video" ? vm.id : "", o.format);
    const prev = done.get(it.key);
    if (prev) {
      // ya generado y pagado en un intento anterior
      Object.assign(it, { status: "hecho", assetId: prev.assetId, imageAssetId: prev.imageAssetId, realCostUSD: prev.realCostUSD });
    }
  };
  items.forEach(price);
  const pendingCost = () => items.filter((x) => x.status !== "hecho").reduce((a, x) => a + x.costUSD + x.reserveUSD, 0);
  const warnings: string[] = [];
  const wantedClips = items.filter((x) => x.kind === "video").length;
  const byLow = () => [...items].filter((x) => x.status !== "hecho").sort((a, b) => a.importance - b.importance);
  // Ajuste al presupuesto: 1) quitar reservas de respaldo, 2) video → imagen, 3) imagen → recurso gratuito.
  for (const step of ["reserve", "video", "image"] as const) {
    for (const it of byLow()) {
      if (pendingCost() <= o.budgetUSD + 1e-9) break;
      if (step === "reserve" && it.reserveUSD > 0) it.fallbackImage = false;
      else if (step === "video" && it.kind === "video") it.kind = "image";
      else if (step === "image" && it.kind === "image" && it.gi !== 0) {
        it.kind = "stock";
        it.fallbackImage = false;
      } else continue;
      price(it);
    }
  }
  const clips = items.filter((x) => x.kind === "video").length;
  if (clips < wantedClips) warnings.push(`El presupuesto alcanza para ${clips} de ${wantedClips} clips de video IA; el resto usa imágenes animadas o recursos gratuitos. Suba el presupuesto si desea más video.`);
  if (pendingCost() > o.budgetUSD + 1e-9) warnings.push("Ni siquiera la primera escena cabe en el presupuesto: súbalo o use el modo de bancos gratuitos.");
  const pending = items.filter((x) => x.status !== "hecho");
  const alreadyPaid = items.filter((x) => x.status === "hecho").reduce((a, x) => a + (x.realCostUSD ?? 0), 0);
  const plan: AiPlan = {
    version: 1,
    hash: "",
    mode: o.mode,
    provider: "runway",
    imageModel: im.id,
    videoModel: vm.id,
    format: o.format,
    budgetUSD: o.budgetUSD,
    totalUSD: round(pending.reduce((a, x) => a + x.costUSD, 0)),
    maxUSD: round(pendingCost()),
    alreadyPaidUSD: round(alreadyPaid),
    images: items.filter((x) => x.kind === "image" || x.kind === "video").length,
    clips,
    stock: items.filter((x) => x.kind === "stock").length,
    approved: false,
    createdAt: new Date().toISOString(),
    warnings,
    pricingSource: PRICING_SOURCE,
    items,
  };
  plan.hash = hash(items.map((x) => [x.key, x.kind, x.fallbackImage]), o.budgetUSD, o.mode);
  return plan;
}

const round = (x: number) => Math.round(x * 100) / 100;
/** Igual que SHOT_MAX de la producción: más largo que esto, la toma lleva 2 escenas. */
const LONG_SHOT = 5.5;

export function planSummary(plan: AiPlan) {
  const vm = videoModel(plan.videoModel);
  const im = imageModel(plan.imageModel);
  return {
    provider: "Runway",
    imageModel: im.label,
    videoModel: vm.label,
    images: plan.images,
    clips: plan.clips,
    stock: plan.stock,
    clipDurations: plan.items.filter((x) => x.kind === "video").map((x) => x.clipSeconds ?? 0),
    totalUSD: plan.totalUSD,
    maxUSD: plan.maxUSD,
    budgetUSD: plan.budgetUSD,
  };
}

/**
 * Autoriza el plan: fija el gasto máximo permitido del proyecto en lo que queda por generar.
 * Nunca se autoriza más que el presupuesto del video ni se supera el presupuesto mensual.
 */
export function approvePlan(projectId: string) {
  const plan = getPlan(projectId);
  if (!plan) throw new Error("No hay escenas IA pendientes de autorizar.");
  if (!runwayKey()) throw new Error("Falta la clave de Runway en Ajustes: sin ella no se pueden generar escenas IA.");
  if (monthSpent() + plan.maxUSD > monthlyBudget())
    throw new Error(`Se superaría el presupuesto mensual (${monthlyBudget().toFixed(2)} USD). Auméntelo en Ajustes o reduzca el presupuesto del video.`);
  const p = getProject(projectId)!;
  const available = Math.max(0, p.authorized_cost - p.spent_cost);
  updateProject(projectId, { authorized_cost: p.spent_cost + available + plan.maxUSD + 0.001 });
  plan.approved = true;
  plan.approvedAt = new Date().toISOString();
  savePlan(projectId, plan);
  return plan;
}

const ASSET_LICENSE = (model: string, recreation: boolean) =>
  `Generado con IA (Runway ${model})${recreation ? " — recreación artística, no es un hecho real" : ""}`;

/** Ejecuta una tarea de Runway reanudable: si ya se había creado (taskId guardado), solo espera su resultado. */
async function runOnce<T>(item: PlanItem, field: "imageTaskId" | "videoTaskId", create: () => Promise<string>, save: () => void, finish: (taskId: string) => Promise<T>): Promise<T> {
  if (!item[field]) {
    item[field] = await create();
    save(); // si el servidor se reinicia, al reanudar se espera esta misma tarea (no se paga dos veces)
  }
  return finish(item[field]!);
}

/** Genera, una por una, las escenas IA autorizadas que faltan. Devuelve el mapa toma → recurso. */
export async function executePlan(projectId: string, plan: AiPlan, report: (p: number, step: string) => void, log: (m: string) => void) {
  const im = imageModel(plan.imageModel);
  const vm = videoModel(plan.videoModel);
  const seed = parseInt(hash(projectId).slice(0, 8), 16) % 4294967295; // misma semilla en todo el video (consistencia)
  const dir = projectDir(projectId, "media");
  const save = () => savePlan(projectId, plan);
  const todo = plan.items.filter((x) => (x.kind === "video" || x.kind === "image") && x.status !== "hecho" && x.status !== "gratis");
  let k = 0;
  for (const it of todo) {
    k++;
    const label = it.kind === "video" ? `video ${it.clipSeconds} s` : "imagen";
    report(0.36 + (0.18 * k) / Math.max(1, todo.length), `Generando escena IA ${k}/${todo.length} (${label})`);
    try {
      // 1) imagen (fotograma) — necesaria también para el video
      if (!it.imageAssetId || !getAsset(it.imageAssetId) || !exists(getAsset(it.imageAssetId)!.local_path)) {
        assertCanSpend(projectId, imageCostUSD(im));
        const dest = path.join(dir, `ia-runway-${it.key}.png`);
        const r = await runOnce(it, "imageTaskId", () => createTask("/v1/text_to_image", imageBody(it, plan.format, im.id, seed)), save, async (taskId) => {
          const task = await withRetry(() => waitTask(taskId, { timeoutMs: 6 * 60_000 }));
          const ext = path.extname(new URL(task.output?.[0] ?? "https://x/a.png").pathname) || ".png";
          const file = dest.replace(/\.\w+$/, ext);
          const url = await downloadOutput(task, file);
          return { file, url, credits: task.cost?.credits ?? im.credits };
        });
        const cost = r.credits * RUNWAY_CREDIT_USD;
        recordCost({ projectId, provider: "runway", units: r.credits, unit: "créditos", cost, note: `imagen IA ${im.id}` });
        it.imageAssetId = insertAsset(projectId, { provider: "runway-ia", kind: "image", externalId: it.key, license: ASSET_LICENSE(im.id, it.recreation), attribution: it.recreation ? "Recreación artística generada con IA (Runway)" : "Imagen generada con IA (Runway)", localPath: r.file, isAi: true });
        it.imageUrl = r.url;
        it.realCostUSD = (it.realCostUSD ?? 0) + cost;
        it.status = "imagen";
        save();
        log(`Escena IA ${k}: imagen generada (${im.id}, ${r.credits} créditos = ${cost.toFixed(2)} USD)`);
      }
      if (it.kind === "image") {
        it.assetId = it.imageAssetId;
        it.status = "hecho";
        save();
        continue;
      }
      // 2) video a partir de la imagen
      assertCanSpend(projectId, videoCostUSD(vm, it.clipSeconds!));
      const imgAsset = getAsset(it.imageAssetId)!;
      const dest = path.join(dir, `ia-runway-video-${it.key}.mp4`);
      const r = await runOnce(
        it,
        "videoTaskId",
        async () => {
          const promptImage = it.imageUrl && /^https:\/\//.test(it.imageUrl) ? it.imageUrl : await imageDataUri(imgAsset.local_path);
          const body: Record<string, unknown> = { model: vm.id, promptImage, promptText: it.motion.slice(0, 1000), ratio: vm.ratio[plan.format], duration: it.clipSeconds };
          if (vm.id.startsWith("veo")) body.audio = false;
          try {
            return await createTask("/v1/image_to_video", body);
          } catch (e) {
            if (promptImage !== it.imageUrl) throw e;
            return createTask("/v1/image_to_video", { ...body, promptImage: await imageDataUri(imgAsset.local_path) }); // URL caducada
          }
        },
        save,
        async (taskId) => {
          const task = await withRetry(() => waitTask(taskId, { timeoutMs: 20 * 60_000 }));
          await downloadOutput(task, dest);
          return { credits: task.cost?.credits ?? Math.ceil(vm.creditsPerSecond * it.clipSeconds! + vm.extraCredits) };
        },
      );
      const cost = r.credits * RUNWAY_CREDIT_USD;
      recordCost({ projectId, provider: "runway", units: r.credits, unit: "créditos", cost, note: `video IA ${vm.id} ${it.clipSeconds} s` });
      it.assetId = insertAsset(projectId, { provider: "runway-ia", kind: "video", externalId: `v-${it.key}`, license: ASSET_LICENSE(vm.id, it.recreation), attribution: it.recreation ? "Recreación artística generada con IA (Runway)" : "Video generado con IA (Runway)", localPath: dest, isAi: true });
      it.realCostUSD = (it.realCostUSD ?? 0) + cost;
      it.status = "hecho";
      save();
      log(`Escena IA ${k}: video generado (${vm.id}, ${it.clipSeconds} s, ${r.credits} créditos = ${cost.toFixed(2)} USD)`);
    } catch (e) {
      const err = e instanceof RunwayError ? e : null;
      // Problemas de cuenta: se detiene todo (sin cambiar a otro proveedor de pago). Se puede reanudar.
      if (err && ["sin_clave", "clave_invalida", "sin_creditos"].includes(err.code ?? "")) throw e;
      // Disco lleno al guardar algo YA pagado: se detiene y se conserva la tarea de Runway,
      // para volver a descargar el mismo resultado al reanudar sin pagar otra vez.
      if (isDiskFull(e)) {
        save();
        throw e;
      }
      if (e instanceof Error && /supera lo autorizado|presupuesto mensual/.test(e.message)) throw e;
      // Fallo de una escena (moderación, error del modelo): esa escena usa un recurso GRATUITO.
      it.status = "gratis";
      it.error = e instanceof Error ? e.message : String(e);
      if (err?.costCredits) recordCost({ projectId, provider: "runway", units: err.costCredits, unit: "créditos", cost: err.costCredits * RUNWAY_CREDIT_USD, note: "generación fallida (cobrada por Runway)" });
      save();
      log(`Escena IA ${k}: ${it.error} → se usará un recurso gratuito (no se cambia a otro proveedor de pago).`);
    }
  }
}

function imageBody(it: PlanItem, format: Format, modelId: string, seed: number) {
  const m = imageModel(modelId);
  const body: Record<string, unknown> = { model: m.id, promptText: it.prompt.slice(0, m.id === "gen4_image" ? 1000 : 4000), ratio: m.ratio[format] };
  if (m.seed) body.seed = seed;
  return body;
}

/** Reintenta errores pasajeros (límite de peticiones, red) sin repetir la tarea ya creada. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const transient = e instanceof RunwayError ? e.code === "limite" || (e.status ?? 0) >= 500 : e instanceof TypeError;
      if (!transient) throw e;
      await sleep(10_000 * (i + 1));
    }
  }
  throw last;
}

/** Genera una imagen IA de respaldo para una toma (modo inteligente) dentro de lo autorizado. */
export async function fallbackImageFor(projectId: string, plan: AiPlan, item: PlanItem, log: (m: string) => void) {
  const im = imageModel(plan.imageModel);
  try {
    assertCanSpend(projectId, imageCostUSD(im));
    const r = await generateImage({ prompt: item.prompt, format: plan.format, modelId: im.id, dest: path.join(projectDir(projectId, "media"), `ia-runway-${item.key}.png`) });
    recordCost({ projectId, provider: "runway", units: r.costUSD / RUNWAY_CREDIT_USD, unit: "créditos", cost: r.costUSD, note: `imagen IA de respaldo ${im.id}` });
    const id = insertAsset(projectId, { provider: "runway-ia", kind: "image", externalId: item.key, license: ASSET_LICENSE(im.id, item.recreation), attribution: "Imagen generada con IA (Runway)", localPath: r.file, isAi: true });
    Object.assign(item, { status: "hecho", assetId: id, imageAssetId: id, realCostUSD: r.costUSD });
    savePlan(projectId, plan);
    log(`Toma ${item.gi + 1}: sin recurso gratuito adecuado → imagen IA de respaldo (${r.costUSD.toFixed(2)} USD).`);
    return id;
  } catch (e) {
    if (isDiskFull(e)) throw e; // disco lleno: se detiene (no se oculta)
    log(`Toma ${item.gi + 1}: imagen IA de respaldo no disponible (${e instanceof Error ? e.message : e}); se mantiene el recurso gratuito.`);
    return null;
  }
}


/** Espacio (MB) que ocuparán las escenas IA pendientes del plan (imágenes ≈ 4 MB, clips ≈ 12 MB). */
export function planDiskMB(plan: AiPlan) {
  return plan.items.reduce((a, x) => (x.status === "hecho" || x.status === "gratis" ? a : a + (x.kind === "video" ? 16 : x.kind === "image" ? 4 : x.reserveUSD > 0 ? 4 : 0)), 0);
}
