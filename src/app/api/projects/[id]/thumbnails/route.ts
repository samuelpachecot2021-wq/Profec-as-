import { getProject } from "@/lib/projects";
import { publicUrl } from "@/lib/paths";
import { ok, fail } from "@/lib/api";
import { activeProvider, estimateClaudeCost } from "@/lib/llm";
import { db } from "@/lib/db";
import {
  loadThumbState,
  generateThumbnails,
  updateHeadline,
  replacePhoto,
  addOwnPhoto,
  searchPhotos,
  selectProposal,
  type ThumbState,
  type StyleSetting,
} from "@/lib/thumbnails";
import type { PhotoCandidate } from "@/lib/thumbs/photos";

export const runtime = "nodejs";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** Vista para el navegador: rutas públicas, nunca rutas internas del servidor. */
function photoView(c: PhotoCandidate | null) {
  if (!c) return null;
  const { localPath, url, ...rest } = c;
  void url;
  return { ...rest, preview: localPath ? publicUrl(localPath) : c.preview };
}

function view(st: ThumbState | null) {
  if (!st) return { state: null };
  return {
    state: {
      style: st.style,
      styleSetting: st.styleSetting,
      w: st.w,
      h: st.h,
      selected: st.selected,
      updatedAt: st.updatedAt,
      warnings: st.warnings,
      analysis: {
        engine: st.analysis.engine,
        styleReason: st.analysis.styleReason,
        topic: st.analysis.topic,
        people: st.analysis.people.map((p) => p.name),
        places: st.analysis.places.map((p) => p.name),
        event: st.analysis.event?.name ?? null,
      },
      proposals: st.proposals.map((p) => ({
        design: p.design,
        label: p.label,
        headline: p.headline,
        highlight: p.highlight,
        tag: p.tag,
        name: p.name,
        aiGenerated: p.aiGenerated,
        bytes: p.bytes,
        url: p.file ? `${publicUrl(p.file)}?v=${encodeURIComponent(p.updatedAt)}` : null,
        download: p.file ? `${publicUrl(p.file)}?descargar=1` : null,
        photo: photoView(p.photo),
        bg: photoView(p.bg),
      })),
      candidates: st.candidates.map(photoView),
    },
  };
}

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getProject(id)) return fail("Proyecto no encontrado", 404);
  return ok(view(loadThumbState(id)));
}

/**
 * Acciones:
 *  - multipart: file + index (+ license, author) → foto propia en esa propuesta
 *  - { action: "headline", index, headline, highlight }
 *  - { action: "photo", index, candidateId, role }
 *  - { action: "search", query, kind }
 *  - { action: "select", index }
 *  - { action: "regenerate", style, authorize }
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("Proyecto no encontrado", 404);
    const busy = db().prepare("SELECT 1 FROM jobs WHERE project_id = ? AND status = 'procesando'").get(id);

    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("No se recibió la imagen");
      if (file.size > 25_000_000) throw new Error("La imagen supera 25 MB");
      const st = await addOwnPhoto(id, Number(form.get("index")), { name: file.name, data: Buffer.from(await file.arrayBuffer()) }, String(form.get("license") || ""), String(form.get("author") || ""));
      return ok(view(st));
    }

    const b = (await req.json()) as { action: string; index?: number; headline?: string; highlight?: string[]; candidateId?: string; role?: "photo" | "bg"; query?: string; kind?: "person" | "place" | "event"; style?: StyleSetting; authorize?: boolean };
    switch (b.action) {
      case "headline": {
        const r = await updateHeadline(id, Number(b.index), String(b.headline ?? ""), b.highlight);
        return ok({ ...view(r.state), warning: r.warning });
      }
      case "photo":
        return ok(view(await replacePhoto(id, Number(b.index), String(b.candidateId ?? ""), b.role === "bg" ? "bg" : "photo")));
      case "search": {
        const r = await searchPhotos(id, String(b.query ?? ""), b.kind === "place" || b.kind === "event" ? b.kind : "person");
        return ok({ results: r.results.map(photoView), message: r.message });
      }
      case "select":
        return ok(view(await selectProposal(id, Number(b.index))));
      case "regenerate": {
        if (busy) throw new Error("Espere a que termine la producción del video para regenerar las miniaturas.");
        if (!p.script.trim() && !p.input_text.trim()) throw new Error("El proyecto no tiene guion");
        const prev = loadThumbState(id);
        // Solo hay costo si aún no existe un análisis guardado y la IA de texto es Claude (de pago).
        if (!prev?.analysis && (await activeProvider()) === "claude" && !b.authorize) {
          const cost = estimateClaudeCost(Math.min((p.script || p.input_text).length, 24000) + 2500, 1500);
          return ok({ needsAuthorization: true, estimate: { items: [{ label: "Análisis del guion para miniaturas (Claude)", cost }], total: cost, free: false, notes: ["Las fotos (Wikimedia Commons y recursos del video) y el diseño no tienen costo."] } });
        }
        if (!prev?.analysis && b.authorize) {
          const cost = estimateClaudeCost(Math.min((p.script || p.input_text).length, 24000) + 2500, 1500);
          db().prepare("UPDATE projects SET authorized_cost = MAX(authorized_cost, spent_cost + ?) WHERE id = ?").run(cost * 1.2, id);
        }
        const style = b.style && ["inteligente", "noticias", "biblico"].includes(b.style) ? b.style : undefined;
        const st = await generateThumbnails({ projectId: id, style, reuseAnalysis: true });
        return ok(view(st));
      }
      default:
        throw new Error("Acción no válida");
    }
  } catch (e) {
    return fail(e);
  }
}
