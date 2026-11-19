import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "@/lib/media";
import { publicUrl } from "@/lib/paths";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const OK_EXT = /\.(jpe?g|png|webp|mp4|mov|webm)$/i;

/** Lista la biblioteca propia de imágenes y clips. */
export function GET() {
  const files = fs.readdirSync(LIBRARY_DIR).filter((f) => OK_EXT.test(f)).sort();
  return ok({ files: files.map((f) => ({ name: f, url: publicUrl(path.join(LIBRARY_DIR, f)), size: fs.statSync(path.join(LIBRARY_DIR, f)).size })) });
}

/** Sube uno o varios archivos. El nombre del archivo sirve para encontrarlo (ej. «jerusalen-muralla-noche.jpg»). */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const saved: string[] = [];
    for (const f of form.getAll("files")) {
      if (!(f instanceof File) || !OK_EXT.test(f.name)) continue;
      if (f.size > 300_000_000) throw new Error(`${f.name} supera 300 MB`);
      const name = path.basename(f.name).normalize("NFC").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 120);
      fs.writeFileSync(path.join(LIBRARY_DIR, name), Buffer.from(await f.arrayBuffer()));
      saved.push(name);
    }
    if (!saved.length) throw new Error("No se recibió ninguna imagen o video compatible (JPG, PNG, WEBP, MP4, MOV, WEBM).");
    return ok({ saved });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const { name } = await body<{ name?: string }>(req);
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) return fail("Nombre no válido");
  fs.rmSync(path.join(LIBRARY_DIR, name), { force: true });
  return ok({ ok: true });
}
