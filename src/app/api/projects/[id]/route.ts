import { db } from "@/lib/db";
import { deleteProject, getProject, projectSettings, projectView, updateProject } from "@/lib/projects";
import { applyHouseRules } from "@/lib/script";
import { cancelJob } from "@/lib/queue";
import { ok, fail, body } from "@/lib/api";
import type { ProjectSettings } from "@/lib/options";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const v = projectView(id);
  return v ? ok(v) : fail("Proyecto no encontrado", 404);
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("Proyecto no encontrado", 404);
    const b = await body<{ title?: string; script?: string; inputText?: string; settings?: Partial<ProjectSettings> }>(req);
    const fields: Parameters<typeof updateProject>[1] = {};
    if (typeof b.title === "string") fields.title = b.title.slice(0, 200);
    if (typeof b.inputText === "string") fields.input_text = b.inputText;
    if (typeof b.script === "string") fields.script = applyHouseRules(b.script);
    if (b.settings) {
      const old = projectSettings(p);
      const next = { ...old, ...b.settings };
      fields.settings = JSON.stringify(next);
      // si cambia la voz o la velocidad, la narración anterior deja de ser válida
      if ((old.voiceId !== next.voiceId || old.speed !== next.speed || (old.elevenVoiceId ?? "") !== (next.elevenVoiceId ?? "")) && !p.custom_narration) fields.narration_path = null;
      // cambio de formato: los recursos se vuelven a elegir según la nueva orientación
      if (old.format !== next.format) db().prepare("UPDATE scenes SET asset_id = NULL WHERE project_id = ? AND locked = 0").run(id);
    }
    updateProject(id, fields);
    return ok(projectView(id));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    cancelJob(id);
    deleteProject(id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
