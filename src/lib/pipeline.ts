import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { dims } from "./options";
import { getProject, getScenes, projectSettings, updateProject, type SceneRow } from "./projects";
import { generateScript, applyHouseRules, translateLines } from "./script";
import { splitScenes, planScenes, groupBlocks, type Overlay } from "./scenes";
import { synthesize, VoiceUnavailable, voiceCacheKey } from "./tts";
import { findAssetForScene, getAsset } from "./media";
import { musicFor } from "./music";
import { buildAss, srtCues, toSrt, type TimedScene } from "./subtitles";
import { renderSegment, xfadeJoin, particlesLayer, finalPass, concatNarration, XFADE, segKey, validDuration, compatibleStill, verifyOutput } from "./render";
import { ensureSpace, estimateRenderMB, estimateFinalMB, freeSpace, diskInfo, DiskFullError } from "./disk";
import { generateThumbnails, thumbCredits } from "./thumbnails";
import { generateSeo, fullDescription } from "./seo";
import { activeProvider } from "./llm";
import { projectDir } from "./paths";
import { ffprobeDuration, hash, exists, ProcessError, isDiskFull } from "./util";
import { renderProfile, resourceSummary, containerMemoryUsedMB } from "./resources";
import { buildPlan, executePlan, fallbackImageFor, getPlan, savePlan, planDiskMB, AwaitingAiAuthorization, type AiPlan } from "./ai/plan";

/** Informa el progreso; `log` (opcional) añade una línea al registro detallado del trabajo. */
export type Reporter = ((progress: number, step: string) => void) & { log?: (msg: string) => void };

const logOf = (r: Reporter) => (msg: string) => r.log?.(msg);

/** Archivo de caché de un bloque de narración (mismo texto + misma voz = mismo archivo). */
export function narrationBlockFile(projectId: string, text: string, s: { voiceId: string; elevenVoiceId?: string; speed: number }) {
  return path.join(projectDir(projectId, "audio"), `bloque-${hash(text, voiceCacheKey(s.voiceId, s.elevenVoiceId), s.speed)}.wav`);
}

/**
 * Caracteres de narración que aún NO están generados (y costarían créditos).
 * Si la narración ya se generó en un intento anterior, devuelve 0.
 */
export function pendingNarrationChars(projectId: string): number | null {
  const p = getProject(projectId);
  if (!p || p.custom_narration) return 0;
  const s = projectSettings(p);
  const existing = getScenes(projectId);
  const texts = existing.length && existing.map((x) => x.text).join(" ") === splitScenes(p.script, s.speed).join(" ") ? existing.map((x) => x.text) : p.script.trim() ? splitScenes(p.script, s.speed) : null;
  if (!texts) return null;
  return groupBlocks(texts)
    .map((b) => b.map((i) => texts[i]).join(" "))
    .filter((t) => !exists(narrationBlockFile(projectId, t, s)))
    .reduce((a, t) => a + t.length, 0);
}

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
  const { scenes: plan, hookTitle } = await planScenes(texts, topic, projectId);
  const meta = p.script_meta ? JSON.parse(p.script_meta) : {};
  updateProject(projectId, { script_meta: JSON.stringify({ ...meta, hook: hookTitle }) });
  // conserva el recurso de escenas con el mismo texto que fueron fijadas por la usuaria
  const lockedByText = new Map(existing.filter((s) => s.locked && s.asset_id).map((s) => [s.text, s.asset_id!]));
  const tx = db().transaction(() => {
    db().prepare("DELETE FROM scenes WHERE project_id = ?").run(projectId);
    const ins = db().prepare("INSERT INTO scenes (project_id, idx, text, query, queries, overlay, keywords, asset_id, locked) VALUES (?,?,?,?,?,?,?,?,?)");
    plan.forEach((sc, i) => {
      const keep = lockedByText.get(sc.text);
      ins.run(projectId, i, sc.text, sc.query, JSON.stringify({ queries: sc.queries, meaning: sc.meaning ?? null }), sc.overlay ? JSON.stringify(sc.overlay) : null, JSON.stringify(sc.keywords), keep ?? null, keep ? 1 : 0);
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
      const file = narrationBlockFile(projectId, text, s);
      const cached = exists(file);
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
      logOf(report)(`Voz bloque ${b + 1}/${blocks.length}: ${cached ? "reutilizada (sin gastar créditos)" : "generada"} · ${duration.toFixed(1)} s`);
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
/** Duración visual de cada escena (la primera empieza en 0; la última llega al final). */
function visualDurations(scenes: { start: number }[], total: number) {
  return scenes.map((sc, i) => (i < scenes.length - 1 ? scenes[i + 1].start : total) - (i === 0 ? 0 : sc.start));
}

export const SHOT_MIN = 3;
export const SHOT_MAX = 5.5;
export const FIRST_SHOT_MAX = 3.2;

/**
 * Tomas visuales según el ritmo REAL de la narración: se agrupan fragmentos cortos para que
 * cada imagen dure 3–5 s; la primera, como máximo ~3 s (impacto inicial). Las escenas con
 * imagen elegida a mano (fijadas) forman su propia toma.
 */
export function shotGroups(scenes: { start: number; locked?: number }[], total: number): number[][] {
  if (!scenes.length) return [];
  const D = visualDurations(scenes, total);
  const groups: number[][] = [];
  let cur = [0];
  let dur = D[0];
  for (let i = 1; i < scenes.length; i++) {
    const maxDur = groups.length === 0 ? FIRST_SHOT_MAX : SHOT_MAX;
    if (dur < SHOT_MIN && dur + D[i] <= maxDur && !scenes[i].locked && !scenes[cur[0]].locked) {
      cur.push(i);
      dur += D[i];
    } else {
      groups.push(cur);
      cur = [i];
      dur = D[i];
    }
  }
  groups.push(cur);
  // una última toma muy corta se une a la anterior
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lastDur = last.reduce((a, i) => a + D[i], 0);
    const prevDur = groups[groups.length - 2].reduce((a, i) => a + D[i], 0);
    if (lastDur < 1.5 && prevDur + lastDur <= SHOT_MAX + 1 && !scenes[last[0]].locked) groups[groups.length - 2].push(...groups.pop()!);
  }
  return groups;
}

type SceneExtra = { queries?: string[]; meaning?: string | null; asset2?: number | null };
const extraOf = (sc: SceneRow): SceneExtra => (sc.queries ? (JSON.parse(sc.queries) as SceneExtra) : {});

/** Paso 4: recursos visuales para cada toma (sin repetir dentro del video). */
async function ensureMedia(projectId: string, scenes: SceneRow[], total: number, report: Reporter) {
  const p = getProject(projectId)!;
  const s = projectSettings(p);
  const { w, h } = dims(s.format, s.resolution);
  const orientation = s.format === "16:9" ? "landscape" : s.format === "1:1" ? "square" : "portrait";
  const used = db().prepare("SELECT provider, external_id FROM assets WHERE project_id = ?").all(projectId) as { provider: string; external_id: string }[];
  const exclude = new Set(used.map((u) => `${u.provider}:${u.external_id}`));
  const upd = db().prepare("UPDATE scenes SET asset_id = ? WHERE id = ?");
  const updExtra = db().prepare("UPDATE scenes SET queries = ? WHERE id = ?");
  const D = visualDurations(scenes, total);
  const groups = shotGroups(scenes, total);
  const usedIds = new Set<number>();
  const search = (g: number[], gi: number, offset = 0) => {
    const lead = scenes[g[0]];
    const ex = extraOf(lead);
    // Si la usuaria editó la búsqueda de la escena, esa va primero.
    const queries = [lead.query, ...(ex.queries ?? []), ...g.slice(1).flatMap((i) => extraOf(scenes[i]).queries?.slice(0, 1) ?? [])]
      .filter((q): q is string => !!q)
      .filter((q, k, arr) => arr.indexOf(q) === k)
      .slice(offset);
    const text = g.map((i) => scenes[i].text).join(" ");
    return findAssetForScene({
      projectId,
      query: queries[0] || "dramatic sky",
      queries,
      sceneText: `${text} ${ex.meaning ?? ""}`,
      impact: gi === 0,
      orientation,
      preferVideo: s.preferVideo,
      sources: s.sources,
      exclude,
      sceneIdx: g[0] + offset * 1000,
      w,
      h,
      useAi: s.useAiImages,
      aiPrompt: `${queries[0] ?? lead.query}. Narration context: ${text}`,
    });
  };
  // ── Escenas generadas con IA (modos económico, premium e inteligente) ──
  let plan: AiPlan | null = null;
  const log = logOf(report);
  if (s.visualMode && s.visualMode !== "bancos") {
    const shots = groups.map((g, gi) => {
      const lead = scenes[g[0]];
      return {
        gi,
        sceneId: lead.id,
        text: g.map((i) => scenes[i].text).join(" "),
        meaning: extraOf(lead).meaning ?? null,
        query: lead.query,
        seconds: g.reduce((acc, i) => acc + D[i], 0),
        verse: g.some((i) => (scenes[i].overlay ?? "").includes('"verse"')),
        locked: !!lead.locked,
      };
    });
    const previous = getPlan(projectId);
    const fresh = buildPlan({ mode: s.visualMode, format: s.format, budgetUSD: s.aiBudget ?? 5, imageModelId: s.aiImageModel, videoModelId: s.aiVideoModel, shots, previous });
    if (previous && previous.approved && previous.hash === fresh.hash) plan = previous;
    else if (fresh.maxUSD <= 0.0001) plan = { ...fresh, approved: true, approvedAt: new Date().toISOString() };
    else {
      savePlan(projectId, fresh);
      throw new AwaitingAiAuthorization(fresh);
    }
    savePlan(projectId, plan);
    log(`Escenas IA (${plan.mode}): ${plan.clips} clips de video, ${plan.images - plan.clips} imágenes, ${plan.stock} con recursos gratuitos · autorizado hasta ${plan.maxUSD.toFixed(2)} USD`);
    // Antes de pagar nada: debe haber disco para las escenas IA y para todo el render.
    const shareVideo = plan.items.filter((x) => x.kind === "video").length / Math.max(1, plan.items.length);
    ensureSpace(planDiskMB(plan) + estimateRenderMB(total, w, h, shareVideo), "La generación de escenas IA y el render", log, projectId);
    await executePlan(projectId, plan, report, log);
    // asigna a cada toma su escena IA ya generada
    for (const it of plan.items) {
      if (it.status !== "hecho" || !it.assetId) continue;
      const lead = scenes[groups[it.gi][0]];
      if (it.part === 2) {
        // segunda mitad de una toma larga: segundo recurso de la toma
        const ex = extraOf(lead);
        if (ex.asset2 !== it.assetId) {
          updExtra.run(JSON.stringify({ ...ex, asset2: it.assetId }), lead.id);
          lead.queries = JSON.stringify({ ...ex, asset2: it.assetId });
        }
        continue;
      }
      if (lead.asset_id !== it.assetId) upd.run(it.assetId, lead.id);
      lead.asset_id = it.assetId;
    }
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const lead = scenes[g[0]];
    report(0.35 + (0.2 * gi) / groups.length, `Buscando imágenes y clips (${gi + 1}/${groups.length})`);
    let a = getAsset(lead.asset_id);
    // un recurso ya usado por otra toma de este video no se repite (salvo que se fijara a mano)
    if (!a || !fs.existsSync(a.local_path) || (!lead.locked && usedIds.has(a.id))) {
      let id = await search(g, gi);
      // modo inteligente: si no hubo recurso gratuito adecuado, imagen IA de respaldo (ya autorizada)
      const item = plan?.items.find((x) => x.gi === gi && x.part !== 2);
      if (plan && item && item.kind === "stock" && item.fallbackImage && getAsset(id)?.provider === "local") {
        const ai = await fallbackImageFor(projectId, plan, item, log);
        if (ai) id = ai;
      }
      upd.run(id, lead.id);
      lead.asset_id = id;
      a = getAsset(id)!;
    }
    usedIds.add(a.id);
    for (const i of g.slice(1)) {
      if (scenes[i].asset_id !== a.id) upd.run(a.id, scenes[i].id);
      scenes[i].asset_id = a.id;
    }
    // Toma larga (> 5,5 s): un segundo clip distinto para que la imagen cambie a mitad.
    const dur = g.reduce((acc, i) => acc + D[i], 0);
    // las escenas IA de tomas largas ya traen su segunda escena del plan; si no la hay, se busca gratis
    const planned2 = plan?.items.find((x) => x.gi === gi && x.part === 2 && x.status === "hecho" && x.assetId);
    if (dur > SHOT_MAX && planned2) usedIds.add(planned2.assetId!);
    else if (dur > SHOT_MAX) {
      const ex = extraOf(lead);
      const a2 = getAsset(ex.asset2 ?? null);
      if (!a2 || !fs.existsSync(a2.local_path) || usedIds.has(a2.id)) {
        const id2 = await search(g, gi, 1);
        updExtra.run(JSON.stringify({ ...ex, asset2: id2 }), lead.id);
        lead.queries = JSON.stringify({ ...ex, asset2: id2 });
        usedIds.add(id2);
      } else usedIds.add(a2.id);
    }
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
  const log = logOf(report);
  const prof = renderProfile();
  log(`Servidor: ${resourceSummary()}`);
  const script = await ensureScript(projectId, report);
  let p = getProject(projectId)!;
  const s = projectSettings(p);
  const { w, h } = dims(s.format, s.resolution);
  log(`Proyecto: ${s.format} ${w}×${h} · ${Math.round(s.duration / 60 * 10) / 10} min · voz ${voiceCacheKey(s.voiceId, s.elevenVoiceId)} a ${s.speed}`);

  let scenes = await ensureScenes(projectId, script, s.speed, report);
  const { narration, total: narrTotal } = await ensureNarration(projectId, scenes, report);
  scenes = getScenes(projectId);
  await ensureMedia(projectId, scenes, narrTotal + 1.5, report);
  scenes = getScenes(projectId);
  const kinds = scenes.map((sc) => getAsset(sc.asset_id)).reduce<Record<string, number>>((acc, a) => ((acc[`${a?.provider}/${a?.kind}`] = (acc[`${a?.provider}/${a?.kind}`] ?? 0) + 1), acc), {});
  log(`Recursos: ${Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(", ")} (guardados para reutilizar)`);

  // ── Segmentos de video ──
  const total = narrTotal + 1.5; // cola final para respirar
  const segDir = projectDir(projectId, "segmentos");
  // Tomas visuales (3–5 s) calculadas con el ritmo real de la narración.
  const Dv = visualDurations(scenes, total);
  const shots: { asset: NonNullable<ReturnType<typeof getAsset>>; duration: number; first: number }[] = [];
  for (const g of shotGroups(scenes, total)) {
    const lead = scenes[g[0]];
    const a = getAsset(lead.asset_id)!;
    const dur = g.reduce((acc, i) => acc + Dv[i], 0);
    const a2 = dur > SHOT_MAX ? getAsset(extraOf(lead).asset2 ?? null) : undefined;
    if (a2 && fs.existsSync(a2.local_path)) {
      shots.push({ asset: a, duration: dur / 2, first: g[0] });
      shots.push({ asset: a2, duration: dur / 2, first: g[0] });
    } else shots.push({ asset: a, duration: dur, first: g[0] });
  }
  log(`Tomas: ${shots.length} (media ${(total / shots.length).toFixed(1)} s, primera ${shots[0].duration.toFixed(1)} s)`);
  const CHUNK = prof.chunk;
  const chunks: string[] = [];
  const keep = new Set<string>();
  const nChunks = Math.ceil(shots.length / CHUNK);
  const videoShare = shots.filter((x) => x.asset.kind === "video").length / Math.max(1, shots.length);
  // Espacio en disco ANTES de editar (causa del antiguo error 228 = ENOSPC).
  const disk0 = ensureSpace(estimateRenderMB(total, w, h, videoShare), "La edición de escenas", log, projectId);
  log(`Disco: ${disk0.freeMB} MB libres de ${disk0.totalMB} MB · necesarios ~${estimateRenderMB(total, w, h, videoShare)} MB`);
  // Plan de bloques: nombres deterministas para poder reanudar solo lo pendiente.
  const planned = shots.map((sh, i) => {
    const c = Math.floor(i / CHUNK);
    const k = i - c * CHUNK;
    const last = k === Math.min(CHUNK, shots.length - c * CHUNK) - 1;
    const dur = sh.duration + (last ? 0 : XFADE);
    const fade = { in: k === 0 && c > 0, out: last && c < nChunks - 1 };
    const key = segKey(sh.asset.local_path, dur.toFixed(3), i, w, h, fade, "v5", i === 0 ? "impacto" : "");
    return { i, c, dur, fade, out: path.join(segDir, `toma-${String(i).padStart(4, "0")}-${key}.mp4`) };
  });
  for (let c = 0; c < nChunks; c++) {
    const part = planned.filter((x) => x.c === c);
    const files = part.map((x) => x.out);
    const durs = part.map((x) => x.dur);
    const chunkOut = path.join(segDir, `bloque-${c}-${segKey(files, durs)}.mp4`);
    const expected = durs.reduce((a2, d) => a2 + d, 0) - (part.length - 1) * XFADE;
    keep.add(chunkOut);
    chunks.push(chunkOut);
    // Bloque ya terminado y verificado en un intento anterior: no se rehace nada.
    const prev = await validDuration(chunkOut);
    if (prev !== null && Math.abs(prev - expected) < 0.35) {
      log(`Bloque ${c + 1}/${nChunks}: reutilizado (${prev.toFixed(1)} s)`);
      continue;
    }
    if (exists(chunkOut)) fs.rmSync(chunkOut, { force: true }); // incompleto o dañado
    for (const x of part) {
      const i = x.i;
      report(0.55 + (0.3 * i) / shots.length, `Editando toma ${i + 1} de ${shots.length}`);
      const a = shots[i].asset;
      const reused = exists(x.out) && (await validDuration(x.out)) !== null;
      if (!reused) fs.rmSync(x.out, { force: true });
      const t0 = Date.now();
      // imágenes: se comprueba que sean compatibles (y solo si hace falta se normalizan)
      const file = a.kind === "image" ? await compatibleStill(a.local_path, w, h) : a.local_path;
      const seg = { file, kind: a.kind, duration: x.dur, motion: i === 0 ? -1 : i * 7 + (i % 3) };
      await withDiskRetry(log, `Escena ${i + 1}`, projectId, async () => {
        try {
          await renderSegment(seg, w, h, x.out, x.fade, { threads: prof.threads });
        } catch (e) {
          if (!(e instanceof ProcessError && e.killedBySystem)) throw e;
          // Reintento automático con el modo de memoria mínima (misma calidad final).
          log(`Escena ${i + 1}: ${e.message} Reintentando en modo de memoria mínima…`);
          report(0.55 + (0.3 * i) / shots.length, `Editando toma ${i + 1} de ${shots.length} (modo memoria mínima)`);
          await renderSegment(seg, w, h, x.out, x.fade, { safe: true });
        }
      });
      log(`Escena ${i + 1}/${shots.length}: ${reused ? "reutilizada" : `editada en ${((Date.now() - t0) / 1000).toFixed(1)} s`} · ${a.provider} ${a.kind} · ${x.dur.toFixed(1)} s · memoria ${containerMemoryUsedMB() ?? "?"} MB · disco libre ${diskInfo().freeMB} MB`);
    }
    await withDiskRetry(log, `Unión de escenas (bloque ${c + 1})`, projectId, () =>
      withMemoryRetry(log, `Unión de escenas (bloque ${c + 1})`, (threads) => xfadeJoin(files, durs, chunkOut, c * 5, threads), prof.threads),
    );
    const got = await validDuration(chunkOut);
    if (got === null || Math.abs(got - expected) > 0.35) {
      fs.rmSync(chunkOut, { force: true });
      throw new Error(`El bloque ${c + 1} quedó incompleto (${got ?? 0} s de ${expected.toFixed(2)} s). Pulse «Reanudar producción».`);
    }
    // Bloque verificado: sus escenas ya no hacen falta (libera disco a medida que avanza).
    for (const f of files) fs.rmSync(f, { force: true });
  }
  // limpieza de restos de renders anteriores
  for (const f of fs.readdirSync(segDir)) {
    const full = path.join(segDir, f);
    if (!keep.has(full) && !f.startsWith("particulas-")) fs.rmSync(full, { force: true });
  }

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
  const metaNow = getProject(projectId)!.script_meta;
  const pmeta = metaNow ? (JSON.parse(metaNow) as { hook?: string | null; topic?: string }) : {};
  const hook = pmeta.hook ?? (pmeta.topic ? pmeta.topic.toLocaleUpperCase("es") : null);
  fs.writeFileSync(assFile, buildAss({ scenes: timed, w, h, subtitles: s.subtitles, position: s.subPosition, title: p.title, hook }));
  const music = await musicFor(s.music, projectId.charCodeAt(0));
  const particles = await particlesLayer(w, h, segDir);
  keep.add(particles);

  const safeName = p.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";
  const out = path.join(outDir, `${safeName}-${s.format.replace(":", "x")}-${s.resolution}p.mp4`);
  fs.rmSync(out, { force: true });
  ensureSpace(estimateFinalMB(total, w, h, videoShare), "El render final", log, projectId);
  await withDiskRetry(log, "Render final", projectId, () => withMemoryRetry(log, "Render final", (threads) => finalPass({
    threads,
    videoParts: chunks,
    narration,
    music: music ? { file: music.file, volume: s.musicVolume } : null,
    ass: assFile,
    particles,
    total,
    out,
    height: Math.min(w, h),
    onProgress: (x) => report(0.86 + 0.1 * x, `Render final (${Math.round(x * 100)} %)`),
  }), prof.threads));
  // Comprobación del resultado: imagen, sonido y duración correctos.
  const check = await verifyOutput(out, { w, h, total });
  log(`MP4 verificado: ${check.width}×${check.height}, ${check.duration.toFixed(2)} s (esperado ${total.toFixed(2)} s), sonido ${check.meanDb} dB · disco libre ${diskInfo().freeMB} MB`);
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
  // Miniaturas: análisis del guion, fotos con derechos verificables y 3 propuestas al tamaño del video.
  // Un fallo aquí nunca impide entregar el video ya renderizado.
  report(0.985, "Diseñando miniaturas");
  let thumbs: string[] = [];
  try {
    updateProject(projectId, { seo: JSON.stringify(seo) });
    const st = await generateThumbnails({ projectId, log, seo });
    thumbs = [st.proposals[st.selected]?.file, ...st.proposals.filter((_, i) => i !== st.selected).map((x) => x.file)].filter(Boolean);
    credits.push(...thumbCredits(st));
    for (const w of st.warnings) log(`Miniaturas: ${w}`);
  } catch (e) {
    log(`Miniaturas: no se pudieron crear (${e instanceof Error ? e.message : e}). Puede generarlas después desde el proyecto.`);
  }
  const desc = fullDescription(seo, credits);
  fs.writeFileSync(path.join(outDir, "creditos-y-licencias.txt"), credits.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "descripcion-youtube.txt"), desc);

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

/** Ejecuta un paso de FFmpeg; si el sistema lo detiene por memoria, lo repite con 1 hilo. */
async function withMemoryRetry<T>(log: (m: string) => void, label: string, fn: (threads: number) => Promise<T>, threads: number): Promise<T> {
  try {
    return await fn(threads);
  } catch (e) {
    if (!(e instanceof ProcessError && e.killedBySystem) || threads <= 1) throw e;
    log(`${label}: ${e.message} Reintentando con memoria mínima…`);
    return fn(1);
  }
}

/**
 * Si un paso falla por disco lleno: libera temporales seguros (nunca recursos pagados) y lo repite
 * una vez. Si sigue sin espacio, se detiene con un mensaje claro; lo ya hecho se conserva.
 */
async function withDiskRetry<T>(log: (m: string) => void, label: string, projectId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isDiskFull(e)) throw e;
    log(`${label}: ${e instanceof Error ? e.message : e}`);
    const r = freeSpace({ keepProject: projectId });
    log(`Disco lleno: liberados ${r.freedMB} MB (${r.steps.join(" · ") || "nada que liberar"}); quedan ${diskInfo().freeMB} MB. Reintentando una vez…`);
    try {
      return await fn();
    } catch (e2) {
      if (!isDiskFull(e2)) throw e2;
      const d = diskInfo();
      throw new DiskFullError(
        `El disco del servidor está lleno (quedan ${d.freeMB} MB de ${d.totalMB} MB) durante: ${label}. Borre proyectos antiguos o amplíe el volumen en Railway (Settings → Volumes) y pulse «Reanudar producción»: se continuará desde aquí sin repetir lo ya generado.`,
      );
    }
  }
}
