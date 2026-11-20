import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getProject, projectSettings, type SceneRow } from "@/lib/projects";
import { isLibraryPath, downloadCandidate, generateAiForScene, insertAsset, isAllowedMediaUrl, searchCandidates, AI_IMAGE_PRICE, type Candidate } from "@/lib/media";
import { projectDir } from "@/lib/paths";
import { monthSpent, monthlyBudget } from "@/lib/costs";
import { updateProject } from "@/lib/projects";
import { hash } from "@/lib/util";
import { ok, fail } from "@/lib/api";
import { sceneAiEstimate, generateSceneAi } from "@/lib/ai/scene";
import type { Overlay } from "@/lib/scenes";

export const runtime = "nodejs";
export const maxDuration = 900;
type Ctx = { params: Promise<{ id: string; sceneId: string }> };

function scene(projectId: string, sceneId: string) {
  const s = db().prepare("SELECT * FROM scenes WHERE id = ? AND project_id = ?").get(Number(sceneId), projectId) as SceneRow | undefined;
  if (!s) throw new Error("Escena no encontrada");
  return s;
}

function setAsset(sceneId: number, assetId: number) {
  db().prepare("UPDATE scenes SET asset_id = ?, locked = 1 WHERE id = ?").run(assetId, sceneId);
}

/** Editar la búsqueda o el texto en pantalla de una escena. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id, sceneId } = await ctx.params;
    const s = scene(id, sceneId);
    const b = (await req.json()) as { query?: string; overlay?: Overlay | null; unlock?: boolean };
    if (typeof b.query === "string") db().prepare("UPDATE scenes SET query = ? WHERE id = ?").run(b.query.slice(0, 120), s.id);
    if (b.overlay !== undefined) db().prepare("UPDATE scenes SET overlay = ? WHERE id = ?").run(b.overlay ? JSON.stringify(b.overlay) : null, s.id);
    if (b.unlock) db().prepare("UPDATE scenes SET asset_id = NULL, locked = 0 WHERE id = ?").run(s.id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Acciones sobre la imagen de una escena:
 *  - multipart "file": subir imagen o video propio
 *  - { action: "search", query }: buscar alternativas
 *  - { action: "use", candidate }: usar una alternativa
 *  - { action: "ai", prompt, authorize }: generar con IA (de pago)
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id, sceneId } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("Proyecto no encontrado", 404);
    const s = scene(id, sceneId);
    const settings = projectSettings(p);
    const orientation = settings.format === "16:9" ? "landscape" : settings.format === "1:1" ? "square" : "portrait";

    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("No se recibió archivo");
      const ext = path.extname(file.name).toLowerCase();
      const isVideo = [".mp4", ".mov", ".webm", ".m4v"].includes(ext);
      if (!isVideo && ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Use una imagen (JPG, PNG, WEBP) o un video (MP4, MOV, WEBM)");
      const buf = Buffer.from(await file.arrayBuffer());
      const dest = path.join(projectDir(id, "media"), `propio-${hash(file.name, buf.length, Date.now())}${ext}`);
      fs.writeFileSync(dest, buf);
      const assetId = insertAsset(id, {
        provider: "propio",
        kind: isVideo ? "video" : "image",
        externalId: file.name,
        license: String(form.get("license") || "Material propio de la usuaria"),
        attribution: String(form.get("attribution") || "Material propio"),
        localPath: dest,
      });
      setAsset(s.id, assetId);
      return ok({ assetId });
    }

    const b = (await req.json()) as { action: string; query?: string; candidate?: Candidate; prompt?: string; authorize?: boolean };
    if (b.action === "search") {
      const cands = await searchCandidates({ projectId: id, query: b.query || s.query || "sky", orientation, preferVideo: settings.preferVideo, sources: settings.sources, exclude: new Set() });
      return ok({ candidates: cands.slice(0, 24) });
    }
    if (b.action === "use" && b.candidate) {
      if (b.candidate.provider === "biblioteca" ? !isLibraryPath(b.candidate.url) : !isAllowedMediaUrl(b.candidate.url)) throw new Error("Origen del recurso no permitido");
      const assetId = await downloadCandidate(id, b.candidate);
      setAsset(s.id, assetId);
      return ok({ assetId });
    }
    if (b.action === "ai-runway-image" || b.action === "ai-runway-video") {
      const kind = b.action === "ai-runway-video" ? "video" : "image";
      if (!b.authorize) return ok({ needsAuthorization: true, estimate: sceneAiEstimate(id, s, kind) });
      const assetId = await generateSceneAi(id, s, kind, b.prompt);
      setAsset(s.id, assetId);
      return ok({ assetId });
    }
    if (b.action === "ai") {
      if (!b.authorize) return ok({ needsAuthorization: true, estimate: { items: [{ label: "1 imagen generada con IA", cost: AI_IMAGE_PRICE }], total: AI_IMAGE_PRICE, free: false, notes: [] } });
      if (monthSpent() + AI_IMAGE_PRICE > monthlyBudget()) throw new Error("Se superaría el presupuesto mensual.");
      const fresh = getProject(id)!;
      if (fresh.authorized_cost - fresh.spent_cost < AI_IMAGE_PRICE) updateProject(id, { authorized_cost: fresh.spent_cost + AI_IMAGE_PRICE + 0.001 });
      const assetId = await generateAiForScene(id, s.idx, b.prompt || `${s.query}. ${s.text}`, orientation);
      setAsset(s.id, assetId);
      return ok({ assetId });
    }
    throw new Error("Acción no válida");
  } catch (e) {
    return fail(e);
  }
}
