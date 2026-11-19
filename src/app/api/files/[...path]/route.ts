import fs from "node:fs";
import path from "node:path";
import { safeDataPath } from "@/lib/paths";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".srt": "application/x-subrip; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".ass": "text/plain; charset=utf-8", ".m4a": "audio/mp4",
};

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  let abs: string;
  try {
    abs = safeDataPath(parts.map(decodeURIComponent).join("/"));
  } catch {
    return new Response("No permitido", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("No encontrado", { status: 404 });
  const size = fs.statSync(abs).size;
  const type = TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const url = new URL(req.url);
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  if (url.searchParams.has("descargar")) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`;
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
