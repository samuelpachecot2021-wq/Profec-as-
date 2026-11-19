import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { dims } from "./options";
import { getProject, getScenes, projectSettings, updateProject, type SceneRow } from "./projects";
import { generateScript, applyHouseRules, translateLines } from "./script";
import { splitScenes, planScenes, groupBlocks, type Overlay } from "./scenes";
import { synthesize, VoiceUnavailable } from "./tts";
import { findAssetForScene, getAsset } from "./media";
import { musicFor } from "./music";
import { buildAss, srtCues, toSrt, type TimedScene } from "./subtitles";
import { renderSegment, xfadeJoin, concatFiles, particlesLayer, finalPass, concatNarration, XFADE, segKey } from "./render";
import { makeThumbnails } from "./thumbnails";
import { generateSeo, fullDescription } from "./seo";
import { activeProvider } from "./llm";
import { projectDir } from "./paths";
import { ffprobeDuration, hash, exists } from "./util";

export type Reporter = (progress: number, step: string) => void;

const weight = (s: string) => s.length + (s.match(/\.\.\.|…/g) || []).length * 12 + 6;

/** Paso 1: guion (si aún no existe). */
export async function ensureScript(projectId: string, report: Reporter) {
  const p = getProject(projectId)!;
  if (p.script.trim()) return p.script;
  report(0.02, "Escribiendo el guion");
  const s = projectSettings(p);
  if (p.input_kind === "guion") {
    const script = applyHouseRules(p.input_text);
    updateProject(projectId, { script });
    return script;
  }
  const r = await generateScript(p.input_text, s.duration, projectId, p.input_kind === "transcripcion");
  updateProject(projectId, {
    script: r.script,
    title: r.title || p.title,
    source_lang: r.sourceLang,
    script_meta: JSON.stringify({ topic: r.topic, engine: r.engine, warnings: r.warnings }),
  });
  return r.script;
}

/** Paso 2: escenas. Si el guion no cambió, conserva las escenas (y las imágenes elegidas a mano). */
async function ensureScenes(projectId: string, script: string, speed: number, report: Reporter): Promise<SceneRow[]> {
  const texts = splitScenes(script, speed);
  const existing = getScenes(projectId);
  if (existing.length && existing.map((s) => s.text).join(" ") === texts.join(" ")) return existing;
  report(0.06, `Dividiendo en ${texts.length} escenas y planificando imágenes`);
  const p = getProject(projectId)!;
  const topic = p.script_meta ? JSON.parse(p.script_meta).topic ?? "" : "";
  const plan = await planScenes(texts, topic, projectId);
  // conserva el recurso de escenas con el mismo texto que fueron fijadas por la usuaria
  const lockedByText = new Map(existing.filter((s) => s.locked && s.asset_id).map((s) => [s.text, s.asset_id!]));
  const tx = db().transaction(() => {
    db().prepare("DELETE FROM scenes WHERE project_id = ?").run(projectId);
    const ins = db().prepare("INSERT INTO scenes (project_id, idx, text, query, overlay, keywords, asset_id, locked) VALUES (?,?,?,?,?,?,?,?)");
    plan.forEach((sc, i) => {
      const keep = lockedByText.get(sc.text);
      ins.run(projectId, i, sc.text, sc.query, sc.overlay ? JSON.stringify(sc.overlay) : null, JSON.stringify(sc.keywords), keep ?? null, keep ? 1 : 0);
    });
  });
  tx();
  return getScenes(projectId);
}

/** Paso 3: narración. Devuelve la ruta del audio y los tiempos de cada escena. */
async function ensureNarration(projectId: string, scenes: SceneRow[], report: Reporter) {
  const p = getProject(projectId)!;
  const s = projectSettings(p);
  const dir = projectDir(projectId, "audio");
  let times: { start: number; end: number }[] = [];
  let narration: string;
  let total: number;

  if (p.custom_narration && exists(p.narration_path)) {
    narration = p.narration_path!;
    total = await ffprobeDuration(narration);
    const W = scenes.reduce((a, sc) => a + weight(sc.text), 0);
    let t = 0;
    times = scenes.map((sc) => {
      const d = (total * weight(sc.text)) / W;
      const r = { start: t, end: t + d };
      t += d;
      return r;
    });
  } else {
    const blocks = groupBlocks(scenes.map((x) => x.text));
    const results: { file: string; duration: number }[] = [];
    for (let b = 0; b < blocks.length; b++) {
      report(0.1 + (0.25 * b) / blocks.length, `Generando la voz en off (${b + 1}/${blocks.length})`);
      const text = blocks[b].map((i) => scenes[i].text).join(" ");
      const file = path.join(dir, `bloque-${hash(text, s.voiceId, s.speed, s.elevenVoiceId ?? "")}.wav`);
      let duration: number;
      try {
        duration = await synthesize({ text, voiceId: s.voiceId, elevenVoiceId: s.elevenVoiceId, speed: s.speed, out: file, projectId });
      } catch (e) {
        if (!(e instanceof VoiceUnavailable)) throw e;
        // Se cambia la voz de TODO el video para que no se mezclen voces distintas.
        console.warn(e.message);
        updateProject(projectId, { settings: JSON.stringify({ ...s, voiceId: e.fallbackVoiceId }) });
        report(0.1, "La voz en línea no respondió: se usa la voz Piper del servidor");
        return ensureNarration(projectId, scenes, report);
      }
      results.push({ file, duration });
    }
    narration = path.join(dir, "narracion.wav");
    const GAP = 0.35;
    const LEAD = 0.25;
    const { starts, total: tot } = await concatNarration(results, GAP, LEAD, narration);
    total = tot;
    times = new Array(scenes.length);
    blocks.forEach((idxs, b) => {
      const W = idxs.reduce((a, i) => a + weight(scenes[i].text), 0);
      let t = starts[b];
      idxs.forEach((i) => {
        const d = (results[b].duration * weight(scenes[i].text)) / W;
        times[i] = { start: t, end: t + d };
        t += d;
      });
    });
    updateProject(projectId, { narration_path: narration });
  }
  const up = db().prepare("UPDATE scenes SET start = ?, end = ? WHERE id = ?");
  db().transaction(() => scenes.forEach((sc, i) => up.run(times[i].start, times[i].end, sc.id)))();
  return { narration, total, times };
}

/** Paso 4: recursos visuales para cada escena. */
async function ensureMedia(projectId: string, scenes: SceneRow[], report: Reporter) {
  const p = getProject(projectId)!;
  const s = projectSettings(p);
  const { w, h } = dims(s.format, s.resolution);
  const orientation = s.format === "16:9" ? "landscape" : s.format === "1:1" ? "square" : "portrait";
  const used = db().prepare("SELECT provider, external_id FROM assets WHERE project_id = ?").all(projectId) as { provider: string; external_id: string }[];
  const exclude = new Set(used.map((u) => `${u.provider}:${u.external_id}`));
  const upd = db().prepare("UPDATE scenes SET asset_id = ? WHERE id = ?");
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const a = getAsset(sc.asset_id);
    if (a && fs.existsSync(a.local_path)) continue;
    report(0.35 + (0.2 * i) / scenes.length, `Buscando imágenes y clips (${i + 1}/${scenes.length})`);
    const id = await findAssetForScene({
      projectId,
      query: sc.query || "dramatic sky",
      orientation,
      preferVideo: s.preferVideo,
      sources: s.sources,
      exclude,
      sceneIdx: i,
      w,
      h,
      useAi: s.useAiImages,
      aiPrompt: `${sc.query}. Narration context: ${sc.text}`,
    });
    upd.run(id, sc.id);
    sc.asset_id = id;
  }
  reuseRealImages(scenes);
}

/**
 * Si se agotaron las imágenes nuevas y alguna escena quedó con un fondo generado,
 * se reutilizan fotos/clips reales del mismo video, sin repetirlos en escenas cercanas.
 */
function reuseRealImages(scenes: SceneRow[]) {
  const assetOf = (sc: SceneRow) => getAsset(sc.asset_id);
  const real = [...new Set(scenes.map((sc) => assetOf(sc)).filter((a) => a && !["local"].includes(a.provider)).map((a) => a!.id))];
  if (real.length < 4) return; // muy pocas: mejor fondos variados que repeticiones evidentes
  const uses = new Map<number, number>(real.map((id) => [id, 0]));
  scenes.forEach((sc) => sc.asset_id && uses.has(sc.asset_id) && uses.set(sc.asset_id, uses.get(sc.asset_id)! + 1));
  const upd = db().prepare("UPDATE scenes SET asset_id = ? WHERE id = ?");
  scenes.forEach((sc, i) => {
    if (sc.locked || assetOf(sc)?.provider !== "local") return;
    const near = new Set(scenes.slice(Math.max(0, i - 3), i + 4).map((x) => x.asset_id));
    const pick = real.filter((id) => !near.has(id)).sort((a, b) => uses.get(a)! - uses.get(b)!)[0];
    if (!pick) return;
    uses.set(pick, uses.get(pick)! + 1);
    sc.asset_id = pick;
    upd.run(pick, sc.id);
  });
}

/** Producción completa del video. */
export async function produce(projectId: string, report: Reporter) {
  const started = Date.now();
  const script = await ensureScript(projectId, report);
  let p = getProject(projectId)!;
  const s = projectSettings(p);
  const { w, h } = dims(s.format, s.resolution);

  let scenes = await ensureScenes(projectId, script, s.speed, report);
  const { narration, total: narrTotal } = await ensureNarration(projectId, scenes, report);
  scenes = getScenes(projectId);
  await ensureMedia(projectId, scenes, report);
  scenes = getScenes(projectId);

  // ── Segmentos de video ──
  const total = narrTotal + 1.5; // cola final para respirar
  const segDir = projectDir(projectId, "segmentos");
  const D = scenes.map((sc, i) => (i < scenes.length - 1 ? scenes[i + 1].start : total) - (i === 0 ? 0 : sc.start));
  const CHUNK = 8;
  const chunks: string[] = [];
  const keep = new Set<string>();
  const nChunks = Math.ceil(scenes.length / CHUNK);
  for (let c = 0; c < nChunks; c++) {
    const idxs = scenes.map((_, i) => i).slice(c * CHUNK, (c + 1) * CHUNK);
    const files: string[] = [];
    const durs: number[] = [];
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      report(0.55 + (0.3 * i) / scenes.length, `Editando escena ${i + 1} de ${scenes.length}`);
      const a = getAsset(scenes[i].asset_id)!;
      const last = k === idxs.length - 1;
      const dur = D[i] + (last ? 0 : XFADE);
      const fade = { in: k === 0 && c > 0, out: last && c < nChunks - 1 };
      const key = segKey(a.local_path, dur.toFixed(3), i, w, h, fade, "v4");
      const out = path.join(segDir, `escena-${String(i).padStart(4, "0")}-${key}.mp4`);
      await renderSegment({ file: a.local_path, kind: a.kind, duration: dur, motion: i * 7 + (i % 3) }, w, h, out, fade);
      files.push(out);
      durs.push(dur);
      keep.add(out);
    }
    const chunkOut = path.join(segDir, `bloque-${c}-${segKey(files, durs)}.mp4`);
    await xfadeJoin(files, durs, chunkOut, c * 5);
    chunks.push(chunkOut);
    keep.add(chunkOut);
  }
  // limpieza de segmentos obsoletos (de renders anteriores)
  for (const f of fs.readdirSync(segDir)) {
    const full = path.join(segDir, f);
    if (!keep.has(full)) fs.rmSync(full, { force: true });
  }
  const joined = path.join(segDir, "unido.mp4");
  fs.rmSync(joined, { force: true });
  await concatFiles(chunks, joined);

  // ── Subtítulos y gráficos ──
  report(0.86, "Añadiendo subtítulos, textos y música");
  const timed: TimedScene[] = scenes.map((sc) => ({
    text: sc.text,
    start: sc.start,
    end: sc.end,
    overlay: sc.overlay ? (JSON.parse(sc.overlay) as Overlay) : null,
    keywords: sc.keywords ? (JSON.parse(sc.keywords) as string[]) : [],
    isAi: !!getAsset(sc.asset_id)?.is_ai,
  }));
  const outDir = projectDir(projectId, "salida");
  const assFile = path.join(outDir, "graficos.ass");
  fs.writeFileSync(assFile, buildAss({ scenes: timed, w, h, subtitles: s.subtitles, position: s.subPosition, title: p.title }));
  const music = await musicFor(s.music, projectId.charCodeAt(0));
  const particles = await particlesLayer(w, h, segDir);
  keep.add(particles);

  const safeName = p.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";
  const out = path.join(outDir, `${safeName}-${s.format.replace(":", "x")}-${s.resolution}p.mp4`);
  fs.rmSync(out, { force: true });
  await finalPass({
    video: joined,
    narration,
    music: music ? { file: music.file, volume: s.musicVolume } : null,
    ass: assFile,
    particles,
    total,
    out,
    height: Math.min(w, h),
    onProgress: (x) => report(0.86 + 0.1 * x, `Render final (${Math.round(x * 100)} %)`),
  });
  fs.rmSync(joined, { force: true });
  // Ahorro de espacio en el servidor: los segmentos intermedios ocupan ~1 GB por video.
  if (process.env.KEEP_SEGMENTS !== "si") {
    for (const f of fs.readdirSync(segDir)) if (!f.startsWith("particulas-")) fs.rmSync(path.join(segDir, f), { force: true });
  }

  // ── Subtítulos SRT ──
  report(0.96, "Exportando subtítulos SRT");
  const cues = srtCues(timed);
  const srt = path.join(outDir, "subtitulos-es.srt");
  fs.writeFileSync(srt, toSrt(cues));
  let srtEn: string | null = null;
  if (s.translateSubsEn) {
    if ((await activeProvider()) !== "none") {
      try {
        const en = await translateLines(cues.map((c) => c.text), "en", projectId);
        srtEn = path.join(outDir, "subtitles-en.srt");
        fs.writeFileSync(srtEn, toSrt(cues.map((c, i) => ({ ...c, text: en[i] }))));
      } catch (e) {
        console.warn("Traducción de subtítulos fallida", e);
      }
    }
  }

  // ── SEO, créditos y miniaturas ──
  report(0.97, "Creando títulos, descripción y capítulos");
  p = getProject(projectId)!;
  const topic = p.script_meta ? JSON.parse(p.script_meta).topic ?? "" : "";
  const seo = await generateSeo({ projectId, title: p.title, topic, script: p.script, scenes: timed, duration: total });
  const assets = scenes.map((sc) => getAsset(sc.asset_id)!).filter(Boolean);
  const credits = [...new Set(assets.filter((a) => !["local", "propio"].includes(a.provider)).map((a) => `• ${a.attribution}${a.page_url ? ` — ${a.page_url}` : ""} (${a.license})`))];
  if (music) credits.push(`• Música: ${music.label}`);
  const desc = fullDescription(seo, credits);
  fs.writeFileSync(path.join(outDir, "creditos-y-licencias.txt"), credits.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "descripcion-youtube.txt"), desc);

  report(0.985, "Diseñando miniaturas");
  const imgs = assets
    .map((a) => ({ a, score: (a.kind === "image" ? 2 : 1) + (a.provider === "local" ? -5 : 0) + (a.is_ai ? 1 : 0) }))
    .sort((x, y) => y.score - x.score);
  const picks = [imgs[0], imgs[Math.floor(imgs.length / 2)], imgs[imgs.length - 1]].filter(Boolean).map((x) => x.a);
  const thumbs = await makeThumbnails({
    images: picks.map((a) => a.local_path),
    isAi: picks.map((a) => !!a.is_ai),
    titles: seo.thumbnailTitles,
    dir: path.join(outDir, "miniaturas"),
  });

  updateProject(projectId, {
    output_path: out,
    srt_path: srt,
    srt_en_path: srtEn,
    thumbnails: JSON.stringify(thumbs),
    seo: JSON.stringify({ ...seo, fullDescription: desc }),
    status: "listo",
    error: null,
  });
  report(1, `Video listo en ${Math.round((Date.now() - started) / 1000)} s`);
  return out;
}
