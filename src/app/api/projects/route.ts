import { createProject, listProjects } from "@/lib/projects";
import { publicUrl } from "@/lib/paths";
import { ok, fail, body } from "@/lib/api";
import type { ProjectSettings } from "@/lib/options";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = listProjects().map((p) => {
      const thumbs = p.thumbnails ? (JSON.parse(p.thumbnails) as string[]) : [];
      return { ...p, thumbnail: thumbs[0] ? publicUrl(thumbs[0]) : null, output_path: undefined, thumbnails: undefined };
    });
    return ok({ projects: rows });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await body<{ text: string; title?: string; kind?: string; settings?: Partial<ProjectSettings> }>(req);
    if (!b.text?.trim()) throw new Error("Pegue un artículo, una transcripción o un guion");
    const id = createProject({ text: b.text, title: b.title, kind: b.kind, settings: b.settings, script: b.kind === "guion" ? b.text : "" });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}
