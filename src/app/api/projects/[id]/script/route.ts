import { getProject, projectSettings, updateProject } from "@/lib/projects";
import { generateScript } from "@/lib/script";
import { checkAuthorization } from "@/lib/authorize";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("Proyecto no encontrado", 404);
    const { authorize } = await body<{ authorize?: boolean }>(req);
    const est = await checkAuthorization(id, "script", !!authorize);
    if (est) return ok({ needsAuthorization: true, estimate: est });
    const s = projectSettings(p);
    const r = await generateScript(p.input_text, s.duration, id, p.input_kind === "transcripcion");
    updateProject(id, {
      script: r.script,
      title: r.title || p.title,
      source_lang: r.sourceLang,
      script_meta: JSON.stringify({ topic: r.topic, engine: r.engine, warnings: r.warnings }),
      status: "guion",
    });
    return ok({ script: r.script, title: r.title, engine: r.engine, warnings: r.warnings, topic: r.topic });
  } catch (e) {
    return fail(e);
  }
}
