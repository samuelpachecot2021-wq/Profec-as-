import fs from "node:fs";
import path from "node:path";
import { MUSIC_DIR } from "@/lib/paths";
import { MUSIC_STYLES } from "@/lib/options";
import { musicFor, userTracks } from "@/lib/music";
import { publicUrl } from "@/lib/paths";
import { ok, fail } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const preview = new URL(req.url).searchParams.get("preview");
  if (preview) {
    try {
      const m = await musicFor(preview);
      if (!m) return fail("Sin música", 404);
      return ok({ url: publicUrl(m.file), label: m.label });
    } catch (e) {
      return fail(e);
    }
  }
  return ok({
    styles: MUSIC_STYLES.filter((s) => s.value !== "ninguna").map((s) => ({ ...s, tracks: userTracks(s.value).map((t) => path.basename(t)) })),
  });
}

/** Añadir una pista propia (con licencia comercial) a un estilo. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const style = String(form.get("style") || "");
    if (!MUSIC_STYLES.some((s) => s.value === style && s.value !== "ninguna")) throw new Error("Estilo no válido");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No se recibió archivo");
    if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) throw new Error("Formato de audio no compatible");
    const dir = path.join(MUSIC_DIR, style);
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(file.name).replace(/[^\w.\- ]+/g, "_");
    fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
