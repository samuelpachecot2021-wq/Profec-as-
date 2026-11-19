import { estimateProject } from "@/lib/estimate";
import { ok, fail } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const scope = new URL(req.url).searchParams.get("scope") === "script" ? "script" : "video";
    return ok(await estimateProject(id, scope));
  } catch (e) {
    return fail(e);
  }
}
