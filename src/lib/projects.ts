import fs from "node:fs";
import { db } from "./db";
import { DEFAULT_SETTINGS, type ProjectSettings } from "./options";
import { uid } from "./util";
import { PROJECTS_DIR, projectDir, publicUrl } from "./paths";
import type { Overlay } from "./scenes";
import { getAsset } from "./media";
import type { Seo } from "./seo";

export type ProjectRow = {
  id: string;
  title: string;
  status: string;
  input_text: string;
  input_kind: string;
  source_lang: string | null;
  script: string;
  script_meta: string | null;
  settings: string;
  seo: string | null;
  thumbnails: string | null;
  output_path: string | null;
  srt_path: string | null;
  srt_en_path: string | null;
  narration_path: string | null;
  custom_narration: number;
  authorized_cost: number;
  spent_cost: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type SceneRow = {
  id: number;
  project_id: string;
  idx: number;
  text: string;
  start: number;
  end: number;
  query: string | null;
  overlay: string | null;
  keywords: string | null;
  queries: string | null;
  asset_id: number | null;
  locked: number;
};

export type JobRow = {
  id: number;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  step: string | null;
  log: string;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

export function createProject(input: { title?: string; text: string; kind?: string; settings?: Partial<ProjectSettings>; script?: string }) {
  const id = uid();
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  const title = (input.title || input.text.split(/\n|[.!?]/)[0] || "Proyecto sin título").trim().slice(0, 120);
  db()
    .prepare("INSERT INTO projects (id, title, input_text, input_kind, script, settings) VALUES (?,?,?,?,?,?)")
    .run(id, title, input.text, input.kind ?? "articulo", input.script ?? "", JSON.stringify(settings));
  projectDir(id);
  return id;
}

export function getProject(id: string) {
  return db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function projectSettings(p: ProjectRow): ProjectSettings {
  return { ...DEFAULT_SETTINGS, ...JSON.parse(p.settings || "{}") };
}

export function updateProject(id: string, fields: Partial<Omit<ProjectRow, "id">>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE projects SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...fields, id });
}

export function listProjects() {
  return db()
    .prepare(
      `SELECT p.id, p.title, p.status, p.created_at, p.updated_at, p.output_path, p.thumbnails, p.spent_cost, p.error,
        (SELECT status FROM jobs j WHERE j.project_id = p.id ORDER BY j.id DESC LIMIT 1) AS job_status,
        (SELECT progress FROM jobs j WHERE j.project_id = p.id ORDER BY j.id DESC LIMIT 1) AS job_progress,
        (SELECT step FROM jobs j WHERE j.project_id = p.id ORDER BY j.id DESC LIMIT 1) AS job_step
       FROM projects p ORDER BY p.updated_at DESC`,
    )
    .all() as (Pick<ProjectRow, "id" | "title" | "status" | "created_at" | "updated_at" | "output_path" | "thumbnails" | "spent_cost" | "error"> & {
    job_status: string | null;
    job_progress: number | null;
    job_step: string | null;
  })[];
}

export function deleteProject(id: string) {
  db().prepare("DELETE FROM projects WHERE id = ?").run(id);
  fs.rmSync(projectDir(id), { recursive: true, force: true });
  void PROJECTS_DIR;
}

export function getScenes(projectId: string) {
  return db().prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY idx").all(projectId) as SceneRow[];
}

export function latestJob(projectId: string) {
  return db().prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId) as JobRow | undefined;
}

/** Vista completa del proyecto para la interfaz (con URLs públicas). */
export function projectView(id: string) {
  const p = getProject(id);
  if (!p) return null;
  const scenes = getScenes(id).map((s) => {
    const a = getAsset(s.asset_id);
    return {
      id: s.id,
      idx: s.idx,
      text: s.text,
      start: s.start,
      end: s.end,
      query: s.query,
      locked: !!s.locked,
      overlay: s.overlay ? (JSON.parse(s.overlay) as Overlay) : null,
      asset: a
        ? { id: a.id, kind: a.kind, url: publicUrl(a.local_path), provider: a.provider, license: a.license, attribution: a.attribution, pageUrl: a.page_url, isAi: !!a.is_ai }
        : null,
    };
  });
  const job = latestJob(id);
  const thumbs = p.thumbnails ? (JSON.parse(p.thumbnails) as string[]) : [];
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    inputText: p.input_text,
    inputKind: p.input_kind,
    sourceLang: p.source_lang,
    script: p.script,
    scriptMeta: p.script_meta ? JSON.parse(p.script_meta) : null,
    settings: projectSettings(p),
    seo: p.seo ? (JSON.parse(p.seo) as Seo & { fullDescription?: string }) : null,
    thumbnails: thumbs.map((t) => publicUrl(t)),
    video: p.output_path && fs.existsSync(p.output_path) ? publicUrl(p.output_path) : null,
    srt: p.srt_path && fs.existsSync(p.srt_path) ? publicUrl(p.srt_path) : null,
    srtEn: p.srt_en_path && fs.existsSync(p.srt_en_path) ? publicUrl(p.srt_en_path) : null,
    narration: p.narration_path && fs.existsSync(p.narration_path) ? publicUrl(p.narration_path) : null,
    customNarration: !!p.custom_narration,
    authorizedCost: p.authorized_cost,
    spentCost: p.spent_cost,
    error: p.error,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    scenes,
    job: job ? { id: job.id, status: job.status, progress: job.progress, step: job.step, error: job.error, log: job.log.split("\n").slice(-60).join("\n") } : null,
  };
}

export type ProjectView = NonNullable<ReturnType<typeof projectView>>;
