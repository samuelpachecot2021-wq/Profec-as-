import { extractText } from "@/lib/extract";
import { detectLanguage, LANG_NAMES } from "@/lib/script";
import { ok, fail } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No se recibió ningún archivo");
    if (file.size > 50_000_000) throw new Error("El archivo supera 50 MB");
    const text = await extractText(file.name, Buffer.from(await file.arrayBuffer()));
    if (!text.trim()) throw new Error("No se encontró texto en el archivo (¿es un PDF escaneado?)");
    const lang = detectLanguage(text);
    return ok({ text, lang, langName: LANG_NAMES[lang] ?? lang });
  } catch (e) {
    return fail(e);
  }
}
