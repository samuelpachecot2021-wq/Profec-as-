import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { getSetting } from "./settings";
import { getProject, getScenes, projectSettings, updateProject } from "./projects";
import { getAsset, type AssetRow } from "./media";
import { renderThumbnail, DESIGN_LABEL, type Design, type ThumbStyle } from "./thumbs/design";
import { analyzeScript, localAnalysis, honestHeadline, type ThumbAnalysis, type Entity } from "./thumbs/analyze";
import { resolveEntity, photosOfEntity, prefetchEntities, licenseStats, projectCandidates, stockPhotos, ensureLocal, type PhotoCandidate } from "./thumbs/photos";
import { fullDescription, type Seo } from "./seo";
import { detectFaces, mainFace, type FaceInfo } from "./thumbs/faces";

/**
 * Generador de miniaturas: analiza el guion, elige el estilo (noticias o bíblico), busca
 * fotografías con derechos verificables y crea 3 propuestas (protagonista, acontecimiento,
 * titular de alto impacto) al tamaño del video. Cada propuesta se puede editar (titular,
 * foto) sin rehacer las demás. Todo el estado se guarda en salida/miniaturas/miniaturas.json.
 */

export type StyleSetting = "inteligente" | "noticias" | "biblico";
export const DESIGNS: Design[] = ["protagonista", "acontecimiento", "impacto"];

export type Proposal = {
  design: Design;
  label: string;
  headline: string;
  highlight: string[];
  tag: string | null;
  name: string | null;
  photo: PhotoCandidate | null;
  bg: PhotoCandidate | null;
  file: string;
  bytes: number;
  /** La foto principal es una recreación generada con IA (se indica de forma discreta, nunca sobre la imagen). */
  aiGenerated: boolean;
  updatedAt: string;
};

export type ThumbState = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  styleSetting: StyleSetting;
  style: ThumbStyle;
  analysis: ThumbAnalysis;
  w: number;
  h: number;
  selected: number;
  proposals: Proposal[];
  candidates: PhotoCandidate[];
  warnings: string[];
};

export function thumbSize(format: string) {
  if (format === "9:16") return { w: 1080, h: 1920 };
  if (format === "4:5") return { w: 1080, h: 1350 };
  if (format === "1:1") return { w: 1080, h: 1080 };
  return { w: 1920, h: 1080 };
}

const dirOf = (projectId: string) => projectDir(projectId, "salida", "miniaturas");
const stateFile = (projectId: string) => path.join(dirOf(projectId), "miniaturas.json");

export function loadThumbState(projectId: string): ThumbState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(projectId), "utf8")) as ThumbState;
  } catch {
    return null;
  }
}

function saveState(projectId: string, st: ThumbState) {
  st.updatedAt = new Date().toISOString();
  fs.mkdirSync(dirOf(projectId), { recursive: true });
  const tmp = `${stateFile(projectId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 1));
  fs.renameSync(tmp, stateFile(projectId));
  // lista de miniaturas del proyecto (descargas y vista previa): la elegida va primero
  const files = st.proposals.map((p) => p.file);
  const ordered = [files[st.selected], ...files.filter((_, i) => i !== st.selected)].filter((f) => f && fs.existsSync(f));
  updateProject(projectId, { thumbnails: JSON.stringify(ordered) });
}

/** Una operación de miniaturas a la vez por proyecto. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(projectId, next);
  next.finally(() => locks.get(projectId) === next && locks.delete(projectId)).catch(() => undefined);
  return next;
}

/** Marca discreta de contenido sintético dentro del archivo JPEG (comentario COM), no sobre la imagen. */
function tagSynthetic(file: string, note: string) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return;
  const text = Buffer.from(note, "utf8").subarray(0, 60000);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff;
  seg[1] = 0xfe;
  seg.writeUInt16BE(text.length + 2, 2);
  fs.writeFileSync(file, Buffer.concat([buf.subarray(0, 2), seg, text, buf.subarray(2)]));
}

function projectAssets(projectId: string): AssetRow[] {
  return getScenes(projectId)
    .map((s) => getAsset(s.asset_id))
    .filter((a): a is AssetRow => !!a);
}

const isPerson = (c: PhotoCandidate | null | undefined) => c?.role === "persona";
const focusFor = (c: PhotoCandidate | null) => (isPerson(c) ? (c!.verified?.includes("Wikidata") ? 0.08 : 0.2) : c?.role === "escena" ? 0.35 : 0.42);

/** Busca fotos verificadas de los protagonistas, lugares y acontecimiento del guion. */
async function gatherNews(projectId: string, a: ThumbAnalysis, orientation: "landscape" | "portrait" | "square", log: (m: string) => void) {
  const found: PhotoCandidate[] = [];
  const warnings: string[] = [];
  const deadline = Date.now() + Number(process.env.THUMB_SEARCH_MS ?? 90_000);
  const tryEntity = async (e: Entity, role: PhotoCandidate["role"], limit: number) => {
    if (Date.now() > deadline) return;
    try {
      const r = await resolveEntity(e);
      if (!r) {
        warnings.push(`No se pudo verificar la identidad de «${e.name}» en Wikidata (o Wikidata no respondió): no se usan fotos suyas.`);
        return;
      }
      const sa0 = licenseStats.saBlocked;
      let photos = (await photosOfEntity(r, role, limit)).slice(0, 8);
      const sa = licenseStats.saBlocked - sa0;
      // lugares sin foto válida en Commons: fotos reales del lugar en los bancos con licencia (Pexels, Pixabay, Unsplash)
      if (!photos.length && role === "lugar") photos = await stockPhotos(projectId, r.labelEn || r.label, orientation, "lugar", r.label);
      log(`Miniaturas: ${photos.length} fotos con licencia comprobada de «${r.label}» (${r.qid})${sa ? ` · ${sa} descartadas por licencia CC BY-SA` : ""}`);
      if (!photos.length && (role === "persona" || sa))
        warnings.push(
          sa
            ? `Las fotos disponibles de «${r.label}» (incluida su imagen oficial) tienen licencia CC BY-SA, que está desactivada en Ajustes → Licencias de imágenes. Si la activa, se usarán con atribución en la descripción.`
            : `No hay fotos con licencia libre de «${r.label}»; se usan otros recursos.`,
        );
      found.push(...photos);
    } catch (err) {
      warnings.push(`Fotos de «${e.name}»: ${err instanceof Error ? err.message : String(err)}`.slice(0, 220));
    }
  };
  await prefetchEntities([...a.people.slice(0, 2), ...a.places.slice(0, 2)].map((e) => e.qid).filter((x): x is string => !!x)).catch(() => undefined);
  for (const p of a.people.slice(0, 2)) await tryEntity(p, "persona", 24);
  for (const p of a.places.slice(0, 2)) await tryEntity(p, "lugar", 16);
  if (a.event?.name) {
    const r = a.event.specific && Date.now() < deadline ? await resolveEntity({ name: a.event.name, kind: "event" }).catch(() => null) : null;
    if (r) {
      const ph = await photosOfEntity(r, "acontecimiento", 16).catch(() => []);
      log(`Miniaturas: ${ph.length} fotos documentales del acontecimiento «${r.label}»`);
      found.push(...ph.slice(0, 6));
    }
    if (!found.some((c) => c.role !== "persona") && a.event.query) found.push(...(await stockPhotos(projectId, a.event.query, orientation)));
  }
  await rankByFaces(projectId, found, deadline + 30_000, log);
  return { found, warnings };
}

/**
 * Prefiere las fotos de cada protagonista con el rostro grande, nítido y visible: descarga
 * las mejores candidatas (hasta 4 por persona) y localiza su rostro. Una foto sin rostro
 * detectable (de espaldas, muy lejos, multitud) baja en la lista.
 */
async function rankByFaces(projectId: string, cands: PhotoCandidate[], deadline: number, log: (m: string) => void) {
  const fotos = path.join(dirOf(projectId), "fotos");
  const bySubject = new Map<string, PhotoCandidate[]>();
  for (const c of cands) if (c.role === "persona" && c.subject) bySubject.set(c.subject, [...(bySubject.get(c.subject) ?? []), c]);
  for (const [subject, list] of bySubject) {
    let checked = 0;
    for (const c of [...list].sort((a, b) => b.score - a.score).slice(0, 4)) {
      if (Date.now() > deadline) break;
      try {
        const file = await ensureLocal(c, fotos);
        const f = mainFace(await detectFaces(file));
        c.face = f ? Math.round(f.h * 100) / 100 : 0;
        c.score += !f ? -20 : f.h >= 0.12 ? 15 : f.h >= 0.05 ? 4 : -8;
        if (Math.min(c.width ?? 0, c.height ?? 0) < 700) c.score -= 15; // baja resolución
        checked++;
      } catch {
        c.score -= 30; // no se pudo descargar: se deja al final
      }
    }
    if (checked) log(`Miniaturas: rostro comprobado en ${checked} fotos de «${subject}»`);
  }
}

/** Elige foto principal y de fondo para cada diseño, sin repetir cuando hay alternativas. */
function choose(style: ThumbStyle, cands: PhotoCandidate[], a: ThumbAnalysis) {
  const allowed = cands.filter((c) => style === "biblico" || c.kind !== "ia"); // noticias: nunca recreaciones IA
  const by = (pred: (c: PhotoCandidate) => boolean) => allowed.filter(pred).sort((x, y) => y.score - x.score);
  const mainName = a.people[0]?.name;
  const people = by((c) => c.role === "persona");
  const mainPeople = people.filter((c) => !mainName || c.subject === people[0]?.subject);
  const scenesReal = by((c) => c.role === "lugar" || c.role === "acontecimiento");
  const project = by((c) => c.role === "escena").sort((x, y) => (style === "biblico" ? y.score - x.score : (x.kind === "ia" ? 1 : 0) - (y.kind === "ia" ? 1 : 0) || y.score - x.score));
  const used = new Set<string>();
  const pick = (...lists: PhotoCandidate[][]) => {
    for (const l of lists) for (const c of l) if (!used.has(c.id)) return used.add(c.id), c;
    for (const l of lists) if (l[0]) return l[0];
    return null;
  };
  if (style === "noticias") {
    const p1 = pick(mainPeople, people, scenesReal, project);
    const bg1 = scenesReal[0] ?? project[0] ?? null;
    const p2 = pick(scenesReal, project, people);
    // alto impacto: otra persona o el mismo protagonista solo si su rostro se ve grande; si no, un lugar o escena
    const bigFace = (c: PhotoCandidate) => (c.face ?? 0) >= 0.1;
    const p3 = pick(people.filter((c) => c.subject !== p1?.subject && bigFace(c)), mainPeople.filter(bigFace), scenesReal, project, mainPeople);
    return [
      { photo: p1, bg: bg1 && bg1.id !== p1?.id ? bg1 : null },
      { photo: p2, bg: null },
      { photo: p3, bg: null },
    ];
  }
  const p1 = pick(project, scenesReal);
  const p2 = pick(project, scenesReal);
  const p3 = pick(project, scenesReal);
  return [
    { photo: p1, bg: null },
    { photo: p2, bg: null },
    { photo: p3, bg: null },
  ];
}

function resolveStyle(setting: StyleSetting, a: ThumbAnalysis): ThumbStyle {
  return setting === "noticias" || setting === "biblico" ? setting : a.style;
}

/** Rostros útiles para encuadrar: personas y escenas (figuras); en lugares, solo si la cara es grande. */
async function facesFor(c: PhotoCandidate | null, file: string | null): Promise<FaceInfo | null> {
  if (!c || !file) return null;
  const info = await detectFaces(file).catch(() => null);
  const f = mainFace(info);
  if (!f) return null;
  if (c.role === "persona" || f.h >= 0.08) return info;
  return null;
}

async function renderProposal(projectId: string, st: ThumbState, i: number, log: (m: string) => void, size?: { w: number; h: number; out: string }) {
  const p = st.proposals[i];
  const dir = dirOf(projectId);
  const fotos = path.join(dir, "fotos");
  let photo: string | null = null;
  let bg: string | null = null;
  try {
    if (p.photo) photo = await ensureLocal(p.photo, fotos);
  } catch (e) {
    log(`Miniatura ${i + 1}: la foto no se pudo descargar (${String(e).slice(0, 100)}); se usa otra.`);
    const alt = st.candidates.find((c) => c.id !== p.photo?.id && c.role === p.photo?.role && (st.style === "biblico" || c.kind !== "ia"));
    p.photo = alt ?? null;
    if (alt) photo = await ensureLocal(alt, fotos).catch(() => null);
  }
  if (p.bg) bg = await ensureLocal(p.bg, fotos).catch(() => null);
  // el nombre solo se muestra si la foto es de esa persona, verificada
  const name = isPerson(p.photo) && p.photo?.subject ? p.photo.subject : null;
  const out = size?.out ?? path.join(dir, `miniatura-${i + 1}.jpg`);
  const [photoFaces, bgFaces] = [await facesFor(p.photo, photo), await facesFor(p.bg, bg)];
  // misma foto en otra propuesta: otro encuadre para que las tres se distingan
  const repeated = st.proposals.slice(0, i).some((q) => q.photo && q.photo.id === p.photo?.id);
  const r = await renderThumbnail({
    design: p.design,
    style: st.style,
    w: size?.w ?? st.w,
    h: size?.h ?? st.h,
    photoFaces,
    bgFaces,
    headline: p.headline,
    highlight: p.highlight,
    photo,
    bg,
    tag: p.tag,
    name: p.design === "protagonista" ? name : null,
    focusY: repeated ? [0.15, 0.55, 0.85][i % 3] : focusFor(p.photo),
    out,
    tmpDir: path.join(dir, "tmp"),
  });
  if (size) return; // copia a otro tamaño (portada integrada): el estado no cambia
  p.aiGenerated = p.photo?.kind === "ia" || p.bg?.kind === "ia";
  if (p.aiGenerated) tagSynthetic(out, "Contenido sintetico: la imagen de fondo es una recreacion artistica generada con IA (no es una fotografia real).");
  p.name = name;
  p.file = r.file;
  p.bytes = r.bytes;
  p.updatedAt = new Date().toISOString();
}

/** Créditos de las fotos usadas en las miniaturas (para la descripción y creditos-y-licencias.txt). */
export function thumbCredits(st: ThumbState | null): string[] {
  if (!st) return [];
  const lines = new Set<string>();
  for (const p of st.proposals)
    for (const c of [p.photo, p.bg]) {
      if (!c || c.kind === "ia" || c.source === "proyecto" || c.source === "propio") continue;
      lines.add(`• Miniatura: ${c.title} — ${c.author} — ${c.license}${c.date ? ` (${c.date})` : ""}${c.pageUrl ? ` — ${c.pageUrl}` : ""}`);
    }
  return [...lines];
}

/** Rehace la descripción y el archivo de créditos con las fotos actuales de las miniaturas. */
function refreshCredits(projectId: string, st: ThumbState) {
  const p = getProject(projectId);
  if (!p) return;
  const outDir = projectDir(projectId, "salida");
  const credFile = path.join(outDir, "creditos-y-licencias.txt");
  const base = fs.existsSync(credFile) ? fs.readFileSync(credFile, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("• Miniatura:")) : [];
  const credits = [...base, ...thumbCredits(st)];
  try {
    fs.writeFileSync(credFile, credits.join("\n") + "\n");
  } catch {}
  if (p.seo) {
    const seo = JSON.parse(p.seo) as Seo & { fullDescription?: string };
    const desc = fullDescription(seo, credits);
    fs.writeFileSync(path.join(outDir, "descripcion-youtube.txt"), desc);
    updateProject(projectId, { seo: JSON.stringify({ ...seo, fullDescription: desc }) });
  }
}

/**
 * Genera (o regenera) las tres propuestas. Reutiliza el análisis guardado cuando se pide
 * (sin nuevo gasto de IA) y los recursos ya descargados.
 */
export function generateThumbnails(o: { projectId: string; log?: (m: string) => void; seo?: Seo | null; style?: StyleSetting; reuseAnalysis?: boolean }) {
  return withLock(o.projectId, async () => {
    const log = o.log ?? (() => undefined);
    const p = getProject(o.projectId);
    if (!p) throw new Error("Proyecto no encontrado");
    const s = projectSettings(p);
    const { w, h } = thumbSize(s.format);
    const prev = loadThumbState(o.projectId);
    const seo = o.seo ?? (p.seo ? (JSON.parse(p.seo) as Seo) : null);
    const topic = p.script_meta ? (JSON.parse(p.script_meta).topic ?? "") : "";
    const input = { projectId: o.projectId, script: p.script || p.input_text, title: p.title, topic, seoTitles: seo?.thumbnailTitles };
    const analysis = o.reuseAnalysis && prev?.analysis ? prev.analysis : await analyzeScript(input).catch(() => localAnalysis(input));
    const styleSetting = (o.style ?? (getSetting("THUMBNAIL_STYLE") as StyleSetting)) || "inteligente";
    const style = resolveStyle(styleSetting, analysis);
    log(`Miniaturas: estilo ${style === "noticias" ? "«Noticias y actualidad»" : "«Bíblico cinematográfico»"}${styleSetting === "inteligente" ? " (elegido automáticamente)" : ""}. ${analysis.styleReason}`);
    const orientation = h > w ? "portrait" : w > h ? "landscape" : "square";
    let cands = projectCandidates(projectAssets(o.projectId));
    const warnings: string[] = [];
    if (style === "noticias") {
      const r = await gatherNews(o.projectId, analysis, orientation, log);
      cands = [...r.found, ...cands];
      warnings.push(...r.warnings);
    }
    // conservar fotos propias o elegidas a mano en la versión anterior
    for (const c of prev?.candidates ?? []) if ((c.source === "propio" || c.id.startsWith("manual:")) && !cands.some((x) => x.id === c.id)) cands.push(c);
    const picks = choose(style, cands, analysis);
    const now = new Date().toISOString();
    const st: ThumbState = {
      version: 1,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      styleSetting,
      style,
      analysis,
      w,
      h,
      selected: 0,
      candidates: cands.slice(0, 60),
      warnings,
      proposals: DESIGNS.map((d, i) => ({
        design: d,
        label: DESIGN_LABEL[d],
        headline: analysis.headlines[d],
        highlight: analysis.highlight[d],
        tag: analysis.tags[d],
        name: null,
        photo: picks[i].photo,
        bg: picks[i].bg,
        file: "",
        bytes: 0,
        aiGenerated: false,
        updatedAt: now,
      })),
    };
    for (let i = 0; i < st.proposals.length; i++) {
      try {
        await renderProposal(o.projectId, st, i, log);
      } catch (e) {
        log(`Miniatura ${i + 1}: error de diseño (${String(e).slice(0, 160)}); se crea sin foto.`);
        st.proposals[i].photo = null;
        st.proposals[i].bg = null;
        await renderProposal(o.projectId, st, i, log);
      }
    }
    if (style === "noticias" && !st.proposals.some((x) => x.photo?.kind === "real"))
      warnings.push("No se encontraron fotografías reales con licencia libre de los protagonistas o lugares: se usaron recursos del video. Puede buscar o subir otra foto en cada propuesta.");
    saveState(o.projectId, st);
    refreshCredits(o.projectId, st);
    log(`Miniaturas: 3 propuestas de ${w}×${h} listas (${st.proposals.map((x) => `${x.label}: ${x.photo ? `${x.photo.kind === "real" ? "foto real" : x.photo.kind === "ia" ? "recreación IA" : x.photo.kind === "fondo" ? "fondo de diseño" : "foto de archivo"}` : "sin foto"}`).join(" · ")})`);
    return st;
  });
}

/**
 * Dibuja la miniatura principal al tamaño exacto del video (portada integrada) en `out`,
 * con el mismo diseño, titular y foto que la propuesta elegida. No modifica el estado.
 */
export function renderMainAt(projectId: string, w: number, h: number, out: string) {
  return withLock(projectId, async () => {
    const st = requireState(projectId);
    const i = st.selected;
    if (st.w === w && st.h === h && st.proposals[i]?.file && fs.existsSync(st.proposals[i].file)) {
      fs.copyFileSync(st.proposals[i].file, out);
    } else await renderProposal(projectId, st, i, () => undefined, { w, h, out });
    return { index: i, proposal: st.proposals[i], updatedAt: st.proposals[i].updatedAt, selectedAt: st.updatedAt };
  });
}

function requireState(projectId: string) {
  const st = loadThumbState(projectId);
  if (!st) throw new Error("Este proyecto aún no tiene propuestas de miniatura. Pulse «Generar propuestas».");
  return st;
}

function checkIndex(st: ThumbState, i: number) {
  if (!Number.isInteger(i) || i < 0 || i >= st.proposals.length) throw new Error("Propuesta no válida");
}

/** Cambia el titular (y las palabras resaltadas) de una sola propuesta. */
export function updateHeadline(projectId: string, index: number, headline: string, highlight?: string[]) {
  return withLock(projectId, async () => {
    const st = requireState(projectId);
    checkIndex(st, index);
    const h = headline.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!h) throw new Error("Escriba un titular");
    const p = st.proposals[index];
    p.headline = h.replace(/\brapto\b/gi, "arrebatamiento").toLocaleUpperCase("es");
    const words = (highlight ?? []).flatMap((x) => x.split(/\s+/)).filter(Boolean).map((x) => x.toLocaleUpperCase("es"));
    p.highlight = words.filter((x) => p.headline.split(" ").some((w) => w.replace(/[¿?¡!:,.]/g, "") === x.replace(/[¿?¡!:,.]/g, "")));
    await renderProposal(projectId, st, index, () => undefined);
    saveState(projectId, st);
    const prj = getProject(projectId);
    const supported = honestHeadline(p.headline, `${prj?.title ?? ""} ${prj?.script ?? ""}`, 8);
    return { state: st, warning: supported ? null : "Aviso: el titular contiene datos o expresiones que el guion no menciona. Revíselo para evitar títulos engañosos." };
  });
}

/** Sustituye la foto (principal o de fondo) de una propuesta por un candidato o una foto propia. */
export function replacePhoto(projectId: string, index: number, candidateId: string, role: "photo" | "bg" = "photo") {
  return withLock(projectId, async () => {
    const st = requireState(projectId);
    checkIndex(st, index);
    let c = st.candidates.find((x) => x.id === candidateId) ?? null;
    if (!c && candidateId.startsWith("asset:")) {
      const a = getAsset(Number(candidateId.slice(6)));
      if (a && a.project_id === projectId) c = projectCandidates([a])[0] ?? null;
    }
    if (!c && candidateId !== "ninguna") throw new Error("Foto no encontrada");
    if (c && st.style === "noticias" && c.kind === "ia")
      throw new Error("En el estilo «Noticias y actualidad» no se usan recreaciones IA: podrían confundirse con fotografías periodísticas reales.");
    st.proposals[index][role] = c;
    await renderProposal(projectId, st, index, () => undefined);
    saveState(projectId, st);
    refreshCredits(projectId, st);
    return st;
  });
}

/** Guarda una foto subida por la usuaria (con su licencia) y la usa en la propuesta indicada. */
export async function addOwnPhoto(projectId: string, index: number, file: { name: string; data: Buffer }, license: string, author: string) {
  const dir = path.join(dirOf(projectId), "fotos");
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file.name).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Use una imagen JPG, PNG o WEBP");
  const dest = path.join(dir, `propia-${Date.now()}${ext}`);
  fs.writeFileSync(dest, file.data);
  const st = requireState(projectId);
  const c: PhotoCandidate = {
    id: `propio:${path.basename(dest)}`,
    source: "propio",
    kind: "stock",
    role: st.proposals[index]?.design === "protagonista" ? "persona" : "escena",
    title: file.name,
    author: author || "Material propio",
    license: license || "Material propio con derechos de uso",
    localPath: dest,
    score: 100,
  };
  st.candidates.unshift(c);
  saveState(projectId, st);
  return replacePhoto(projectId, index, c.id, "photo");
}

/** Busca fotos verificadas de una persona, lugar o acontecimiento escrito por la usuaria. */
export function searchPhotos(projectId: string, query: string, kind: "person" | "place" | "event") {
  return withLock(projectId, async () => {
    const st = requireState(projectId);
    const q = query.trim().slice(0, 80);
    if (!q) throw new Error("Escriba un nombre o lugar");
    const r = await resolveEntity({ name: q, kind });
    if (!r) return { results: [] as PhotoCandidate[], message: `No se encontró «${q}» en Wikidata con identidad verificable.` };
    const role = kind === "person" ? "persona" : kind === "place" ? "lugar" : "acontecimiento";
    const results = await photosOfEntity(r, role, 30);
    for (const c of results) if (!st.candidates.some((x) => x.id === c.id)) st.candidates.push(c);
    saveState(projectId, st);
    return { results, message: results.length ? `${results.length} fotos con licencia libre de «${r.label}» (${r.description || r.qid}).` : `«${r.label}» no tiene fotos con licencia libre en Wikimedia Commons.` };
  });
}

/** Elige la propuesta principal (la que se descarga con «Descargar miniatura»). */
export function selectProposal(projectId: string, index: number) {
  return withLock(projectId, async () => {
    const st = requireState(projectId);
    checkIndex(st, index);
    st.selected = index;
    saveState(projectId, st);
    return st;
  });
}
