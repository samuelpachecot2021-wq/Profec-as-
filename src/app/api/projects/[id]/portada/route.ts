import { getProject } from "@/lib/projects";
import { publicUrl } from "@/lib/paths";
import { ok, fail, body } from "@/lib/api";
import { coverStatus, startCover, clampCover } from "@/lib/cover";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

function view(s: ReturnType<typeof coverStatus>) {
  const { file, ...rest } = s;
  return { ...rest, download: file && s.ready ? `${publicUrl(file)}?descargar=1` : null };
}

/** Estado de la copia «video con portada integrada». */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getProject(id)) return fail("Proyecto no encontrado", 404);
  const d = new URL(req.url).searchParams.get("duracion");
  return ok(view(coverStatus(id, d ? clampCover(d) : undefined)));
}

/** Crea (o reutiliza) la copia con la miniatura principal al comienzo. Nunca modifica el video original. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("Proyecto no encontrado", 404);
    const { duration } = await body<{ duration?: number }>(req);
    startCover(id, duration);
    return ok(view(coverStatus(id, clampCover(duration))));
  } catch (e) {
    return fail(e);
  }
}
