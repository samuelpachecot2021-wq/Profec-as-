import path from "node:path";

/** Extrae el texto de un archivo TXT, PDF, DOCX, MD, SRT o VTT. */
export async function extractText(fileName: string, buf: Buffer): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") {
    // pdf-parse 1.x: se importa el módulo interno para evitar su modo de prueba.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (b: Buffer) => Promise<{ text: string }>;
    const r = await pdfParse(buf);
    return clean(r.text);
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return clean(r.value);
  }
  if (ext === ".doc") throw new Error("El formato .doc antiguo no es compatible. Guárdelo como .docx desde Word.");
  if ([".txt", ".md", ".text", ".srt", ".vtt", ""].includes(ext)) {
    let t = buf.toString("utf8");
    if (ext === ".srt" || ext === ".vtt") {
      t = t
        .replace(/^WEBVTT.*$/m, "")
        .replace(/^\d+\s*$/gm, "")
        .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "")
        .replace(/<[^>]+>/g, "");
    }
    return clean(t);
  }
  throw new Error(`Formato no compatible: ${ext}. Use TXT, PDF o DOCX.`);
}

function clean(t: string) {
  return t
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
