import fs from "node:fs";
import path from "node:path";
import { getProject, updateProject } from "@/lib/projects";
import { projectDir } from "@/lib/paths";
import { run, ffprobeDuration } from "@/lib/util";
import { ok, fail } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** Subir una narración propia (MP3, WAV, M4A…). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("Proyecto no encontrado", 404);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No se recibió el audio");
    const dir = projectDir(id, "audio");
    const raw = path.join(dir, `subido${path.extname(file.name).toLowerCase() || ".audio"}`);
    fs.writeFileSync(raw, Buffer.from(await file.arrayBuffer()));
    const out = path.join(dir, "narracion-propia.wav");
    await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
    fs.rmSync(raw, { force: true });
    const duration = await ffprobeDuration(out);
    updateProject(id, { narration_path: out, custom_narration: 1 });
    return ok({ duration });
  } catch (e) {
    return fail(e);
  }
}

/** Volver a la voz generada automáticamente. */
export async function DELETE(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  updateProject(id, { narration_path: null, custom_narration: 0 });
  return ok({ ok: true });
}
