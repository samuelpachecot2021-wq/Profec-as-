import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getSetting } from "./settings";
import { downloadTo, fetchWithTimeout, run, exists, hash } from "./util";
import { projectDir, DATA_DIR, publicUrl } from "./paths";
import { scoreCandidate, MIN_SCORE } from "./visual";
import { assertCanSpend, recordCost } from "./costs";

export type Candidate = {
  provider: "pexels" | "pixabay" | "unsplash" | "wikimedia" | "nasa" | "biblioteca" | "ia" | "runway-ia" | "local" | "propio";
  kind: "video" | "image";
  externalId: string;
  url: string; // archivo a descargar
  pageUrl?: string;
  author?: string;
  license: string;
  attribution: string;
  width?: number;
  height?: number;
  headers?: Record<string, string>;
  /** URL que debe notificarse al usar el recurso (exigido por Unsplash). */
  trackUrl?: string;
  thumb?: string;
  /** Descripción/etiquetas del recurso: sirve para comprobar que encaja con la escena. */
  meta?: string;
  duration?: number;
};

export type AssetRow = {
  id: number;
  project_id: string;
  provider: string;
  kind: "video" | "image";
  external_id: string | null;
  source_url: string | null;
  page_url: string | null;
  author: string | null;
  license: string | null;
  attribution: string | null;
  local_path: string;
  is_ai: number;
  width: number | null;
  height: number | null;
};

const UA = "ProfeciaStudioAI/1.0 (aplicacion local de produccion de video)";
export const AI_IMAGE_PRICE = 0.04; // USD por imagen (aprox., calidad media 1536x1024)

// ───────────────────────── Proveedores ─────────────────────────

type Kind = "video" | "image";

/** Caché de búsquedas (7 días) y pausa automática si un banco limita las peticiones (429). */
const SEARCH_CACHE = path.join(DATA_DIR, "cache", "busquedas");
fs.mkdirSync(SEARCH_CACHE, { recursive: true });
const pausedUntil = new Map<string, number>();

async function cachedJson<T>(provider: string, url: string, init: RequestInit = {}): Promise<T | null> {
  const file = path.join(SEARCH_CACHE, `${provider}-${hash(url.replace(/key=[^&]+/, "key=*"))}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 7 * 86400_000) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {}
  if ((pausedUntil.get(provider) ?? 0) > Date.now()) return null;
  const r = await fetchWithTimeout(url, init);
  if (r.status === 429) {
    pausedUntil.set(provider, Date.now() + 15 * 60_000);
    console.warn(`${provider}: límite de peticiones alcanzado; se pausa 15 minutos y se usan los demás bancos.`);
    return null;
  }
  if (!r.ok) return null;
  const j = (await r.json()) as T;
  try {
    fs.writeFileSync(file, JSON.stringify(j));
  } catch {}
  return j;
}

/** Palabras de un enlace descriptivo (p. ej. pexels.com/video/aerial-view-of-jerusalem-123/). */
const slugWords = (u?: string) => (u ? decodeURIComponent(u).split("/").filter(Boolean).pop()?.replace(/[-_]\d+$/, "").replace(/[-_]+/g, " ") ?? "" : "");

async function pexels(query: string, orientation: string, kind: Kind): Promise<Candidate[]> {
  const key = getSetting("PEXELS_API_KEY");
  if (!key) return [];
  const out: Candidate[] = [];
  const o = orientation === "landscape" ? "landscape" : orientation === "portrait" ? "portrait" : "square";
  const headers = { Authorization: key };
  if (kind === "video") {
    const j = await cachedJson<{ videos: { id: number; url: string; image: string; duration: number; tags?: string[]; user: { name: string }; video_files: { link: string; width: number; height: number; file_type: string }[] }[] }>(
      "pexels",
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15&size=medium`,
      { headers },
    );
    for (const v of j?.videos ?? []) {
      if (v.duration < 3) continue;
      const files = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.width <= 3840).sort((a, b) => b.width - a.width);
      const f = files.find((x) => Math.max(x.width, x.height) <= 2560) ?? files[files.length - 1];
      if (!f) continue;
      out.push({ provider: "pexels", kind: "video", externalId: `v${v.id}`, url: f.link, pageUrl: v.url, author: v.user?.name, license: "Licencia Pexels (uso comercial gratuito)", attribution: `Video de ${v.user?.name ?? "autor"} en Pexels`, width: f.width, height: f.height, thumb: v.image, meta: `${slugWords(v.url)} ${(v.tags ?? []).join(" ")}`, duration: v.duration });
    }
    return out;
  }
  const j = await cachedJson<{ photos: { id: number; url: string; alt?: string; photographer: string; width: number; height: number; src: { large2x: string; original: string; medium: string } }[] }>(
    "pexels",
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15`,
    { headers },
  );
  for (const p of j?.photos ?? [])
    out.push({ provider: "pexels", kind: "image", externalId: `p${p.id}`, url: p.src.large2x || p.src.original, pageUrl: p.url, author: p.photographer, license: "Licencia Pexels (uso comercial gratuito)", attribution: `Foto de ${p.photographer} en Pexels`, width: p.width, height: p.height, thumb: p.src.medium, meta: `${p.alt ?? ""} ${slugWords(p.url)}` });
  return out;
}

async function pixabay(query: string, orientation: string, kind: Kind): Promise<Candidate[]> {
  const key = getSetting("PIXABAY_API_KEY");
  if (!key) return [];
  const out: Candidate[] = [];
  const q = encodeURIComponent(query.slice(0, 100));
  if (kind === "video") {
    // video_type=film: solo metraje real (sin animaciones)
    const j = await cachedJson<{ hits: { id: number; pageURL: string; tags: string; type?: string; duration: number; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }[] }>(
      "pixabay",
      `https://pixabay.com/api/videos/?key=${key}&q=${q}&video_type=film&safesearch=true&per_page=15&order=popular`,
    );
    for (const h of j?.hits ?? []) {
      if (h.duration < 3 || (h.type && h.type !== "film")) continue;
      const v = h.videos.large?.url ? h.videos.large : h.videos.medium;
      if (!v?.url) continue;
      out.push({ provider: "pixabay", kind: "video", externalId: `v${h.id}`, url: v.url, pageUrl: h.pageURL, author: h.user, license: "Licencia de contenido Pixabay (uso comercial gratuito)", attribution: `Video de ${h.user} en Pixabay`, width: v.width, height: v.height, thumb: v.thumbnail, meta: `${h.tags} ${slugWords(h.pageURL)}`, duration: h.duration });
    }
    return out;
  }
  const o = orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all";
  const j = await cachedJson<{ hits: { id: number; pageURL: string; tags: string; user: string; largeImageURL: string; webformatURL: string; imageWidth: number; imageHeight: number }[] }>(
    "pixabay",
    `https://pixabay.com/api/?key=${key}&q=${q}&image_type=photo&orientation=${o}&safesearch=true&per_page=15&min_width=1280&order=popular`,
  );
  for (const h of j?.hits ?? [])
    out.push({ provider: "pixabay", kind: "image", externalId: `p${h.id}`, url: h.largeImageURL, pageUrl: h.pageURL, author: h.user, license: "Licencia de contenido Pixabay (uso comercial gratuito)", attribution: `Imagen de ${h.user} en Pixabay`, width: h.imageWidth, height: h.imageHeight, thumb: h.webformatURL, meta: `${h.tags} ${slugWords(h.pageURL)}` });
  return out;
}

async function unsplash(query: string, orientation: string): Promise<Candidate[]> {
  const key = getSetting("UNSPLASH_ACCESS_KEY");
  if (!key) return [];
  const o = orientation === "square" ? "squarish" : orientation;
  const j = await cachedJson<{ results: { id: string; width: number; height: number; alt_description?: string; description?: string; tags?: { title: string }[]; urls: { raw: string }; links: { html: string; download_location: string }; user: { name: string } }[] }>(
    "unsplash",
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${o}&per_page=15&content_filter=high`,
    { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } },
  );
  return (j?.results ?? []).map((p) => ({
    provider: "unsplash" as const,
    kind: "image" as const,
    externalId: p.id,
    url: `${p.urls.raw}&w=2400&q=85&fm=jpg`,
    pageUrl: `${p.links.html}?utm_source=profecia_studio_ai&utm_medium=referral`,
    author: p.user.name,
    license: "Licencia Unsplash (uso comercial gratuito)",
    attribution: `Foto de ${p.user.name} en Unsplash`,
    width: p.width,
    height: p.height,
    // Las normas de la API de Unsplash exigen notificar la descarga.
    trackUrl: p.links.download_location,
    thumb: `${p.urls.raw}&w=400&q=60&fm=jpg`,
    meta: `${p.alt_description ?? ""} ${p.description ?? ""} ${(p.tags ?? []).map((t) => t.title).join(" ")}`,
  }));
}

const FREE_LICENSES = /^(cc0|public domain|pd|pdm|cc by \d|cc-by-\d|cc by \d\.\d|attribution)/i;
const SA_LICENSES = /^cc[ -]by[ -]sa/i;

async function wikimedia(query: string): Promise<Candidate[]> {
  const allowSA = getSetting("ALLOW_CC_BY_SA") === "si";
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=2400&origin=*`;
  const j = await cachedJson<{ query?: { pages: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; width: number; height: number; mime: string; extmetadata?: Record<string, { value: string }> }[] }> } }>("wikimedia", url, { headers: { "User-Agent": UA } });
  const out: Candidate[] = [];
  for (const p of Object.values(j?.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/jpeg|png/.test(ii.mime) || ii.width < 1000) continue;
    const lic = (ii.extmetadata?.LicenseShortName?.value ?? "").replace(/<[^>]+>/g, "").trim();
    const ok = FREE_LICENSES.test(lic) || (allowSA && SA_LICENSES.test(lic));
    if (!ok || /nc|nd/i.test(lic.replace(/^cc[ -]by[ -]sa/i, ""))) continue;
    const artist = (ii.extmetadata?.Artist?.value ?? "Wikimedia Commons").replace(/<[^>]+>/g, "").trim().slice(0, 120);
    const desc = (ii.extmetadata?.ImageDescription?.value ?? "").replace(/<[^>]+>/g, " ").slice(0, 300);
    out.push({ provider: "wikimedia", kind: "image", externalId: p.title, url: ii.thumburl || ii.url, pageUrl: ii.descriptionurl, author: artist, license: lic, attribution: `${artist} — ${lic}, vía Wikimedia Commons`, width: ii.width, height: ii.height, headers: { "User-Agent": UA }, meta: `${p.title.replace(/^File:|\.\w+$/g, "").replace(/[_-]+/g, " ")} ${desc}` });
  }
  return out;
}

async function nasa(query: string): Promise<Candidate[]> {
  const j = await cachedJson<{ collection: { items: { href: string; data: { nasa_id: string; title: string; description?: string; center?: string; photographer?: string; secondary_creator?: string }[]; links?: { href: string; rel: string }[] }[] } }>(
    "nasa",
    `https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=10`,
  );
  const out: Candidate[] = [];
  for (const it of j?.collection?.items ?? []) {
    const d = it.data?.[0];
    if (!d) continue;
    const credit = d.photographer || d.secondary_creator || "NASA";
    // Se excluyen imágenes con créditos de terceros, que pueden tener derechos propios.
    if (credit && !/nasa|jpl|esa|goddard|johnson/i.test(credit)) continue;
    const href = it.links?.find((l) => l.rel === "preview")?.href;
    if (!href) continue;
    out.push({ provider: "nasa", kind: "image", externalId: d.nasa_id, url: href.replace("~thumb", "~large"), pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, author: credit, license: "NASA — material generalmente de dominio público (sin uso del logotipo ni respaldo)", attribution: `Imagen: ${credit} (NASA)`, thumb: href, meta: `${d.title} ${(d.description ?? "").slice(0, 200)}` });
  }
  return out;
}

// ───────────────────────── Biblioteca propia ─────────────────────────

export const LIBRARY_DIR = path.join(DATA_DIR, "biblioteca");
fs.mkdirSync(LIBRARY_DIR, { recursive: true });
const normTxt = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Busca en la biblioteca propia por palabras del nombre del archivo. */
async function biblioteca(query: string): Promise<Candidate[]> {
  const files = fs.readdirSync(LIBRARY_DIR).filter((f) => /\.(jpe?g|png|webp|mp4|mov|webm)$/i.test(f));
  const terms = normTxt(query).split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return files
    .map((f) => ({ f, score: terms.reduce((a, t) => a + (normTxt(f).includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ f }) => {
      const full = path.join(LIBRARY_DIR, f);
      return {
        provider: "biblioteca" as const,
        kind: /\.(mp4|mov|webm)$/i.test(f) ? ("video" as const) : ("image" as const),
        externalId: f,
        url: full,
        thumb: publicUrl(full),
        license: "Biblioteca propia (licencia verificada por la usuaria)",
        attribution: `Biblioteca propia: ${f}`,
        meta: f.replace(/\.\w+$/, "").replace(/[-_.]+/g, " "),
      };
    });
}

export function isLibraryPath(p: string) {
  const abs = path.resolve(p);
  return abs.startsWith(path.resolve(LIBRARY_DIR) + path.sep) && fs.existsSync(abs);
}

// ───────────────────────── Imagen generada con IA ─────────────────────────

async function aiImage(prompt: string, orientation: string, dest: string, projectId: string) {
  const key = getSetting("OPENAI_API_KEY");
  if (!key) throw new Error("Falta la clave de OpenAI para generar imágenes con IA.");
  assertCanSpend(projectId, AI_IMAGE_PRICE);
  const size = orientation === "portrait" ? "1024x1536" : orientation === "square" ? "1024x1024" : "1536x1024";
  const r = await fetchWithTimeout(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getSetting("OPENAI_IMAGE_MODEL") || "gpt-image-1",
        prompt: `Hyperrealistic cinematic documentary still, dramatic volumetric lighting, shallow depth of field, film grain, color graded teal and amber, no text, no logos, no real identifiable people. Scene: ${prompt}`,
        size,
        quality: "medium",
        n: 1,
      }),
    },
    180000,
  );
  if (!r.ok) throw new Error(`OpenAI imágenes respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { data: { b64_json?: string; url?: string }[] };
  const d = j.data?.[0];
  if (d?.b64_json) fs.writeFileSync(dest, Buffer.from(d.b64_json, "base64"));
  else if (d?.url) await downloadTo(d.url, dest);
  else throw new Error("OpenAI no devolvió imagen");
  recordCost({ projectId, provider: "openai-imagen", units: 1, unit: "imagen", cost: AI_IMAGE_PRICE, note: "imagen IA" });
}

// ───────────────────────── Fondo cinematográfico local ─────────────────────────

const PALETTES = [
  ["0x1a0c08", "0x8a2a14", "0xe8b04a", "0x2a1206"],
  ["0x0a1020", "0x24406e", "0xe0b860", "0x101830"],
  ["0x160808", "0x7a1a1a", "0xf0c070", "0x200a0a"],
  ["0x0c0a16", "0x4a3a6a", "0xd8a040", "0x14101e"],
  ["0x081414", "0x1e5050", "0xe0b050", "0x0a1a1a"],
];

/** Genera un fondo abstracto cinematográfico (degradado + grano + viñeta) sin internet. */
export async function proceduralBackground(dest: string, w: number, h: number, seed: number) {
  const pal = PALETTES[seed % PALETTES.length];
  const x0 = Math.round(w * (0.15 + ((seed * 37) % 30) / 100));
  const y0 = Math.round(h * 0.1);
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${pal[2]}:c1=${pal[1]}:c2=${pal[3]}:c3=${pal[0]}:nb_colors=4:x0=${x0}:y0=${y0}:x1=${w}:y1=${Math.round(h * 1.5)}:type=radial:seed=${seed}`,
    "-vf", "noise=alls=10:allf=t,gblur=sigma=3,vignette=PI/4.5,eq=contrast=1.05:saturation=1.15",
    "-frames:v", "1", dest,
  ]);
}

// ───────────────────────── Búsqueda y descarga ─────────────────────────

export type SearchOpts = {
  projectId: string;
  query: string;
  orientation: "landscape" | "portrait" | "square";
  preferVideo: boolean;
  sources: { pexels: boolean; pixabay: boolean; unsplash: boolean; wikimedia: boolean; nasa: boolean; biblioteca?: boolean };
  exclude: Set<string>;
};

export type SearchMore = { kind?: Kind; sceneText?: string; w?: number; h?: number; impact?: boolean };

/**
 * Busca en los bancos activos, descarta lo inapropiado (adornos navideños, cráneos, caricaturas,
 * gráficos tecnológicos fuera de lugar) y ordena por relevancia y realismo cinematográfico.
 */
export async function searchCandidates(o: SearchOpts & SearchMore): Promise<(Candidate & { score: number })[]> {
  const kinds: Kind[] = o.kind ? [o.kind] : o.preferVideo ? ["video", "image"] : ["image", "video"];
  const safe = (p: Promise<Candidate[]>) => p.catch((e) => (console.warn("Búsqueda fallida:", String(e)), [] as Candidate[]));
  const seen = new Set<string>();
  const score = (list: Candidate[]) => {
    const out: (Candidate & { score: number })[] = [];
    for (const c of list) {
      const id = `${c.provider}:${c.externalId}`;
      if ((o.kind && c.kind !== o.kind) || o.exclude.has(id) || seen.has(id)) continue;
      seen.add(id);
      const sc = scoreCandidate(c, { query: o.query, sceneText: o.sceneText ?? o.query, preferVideo: o.preferVideo, w: o.w ?? 1920, h: o.h ?? 1080, impact: o.impact });
      if (sc !== null) out.push({ ...c, score: sc });
    }
    return out;
  };
  const gather = async (orient: string, first: boolean) => {
    const tasks: Promise<Candidate[]>[] = [];
    for (const kind of kinds) {
      if (o.sources.pexels) tasks.push(safe(pexels(o.query, orient, kind)));
      if (o.sources.pixabay) tasks.push(safe(pixabay(o.query, orient, kind)));
      if (kind === "image" && first) {
        if (o.sources.unsplash) tasks.push(safe(unsplash(o.query, orient)));
        if (o.sources.wikimedia) tasks.push(safe(wikimedia(o.query)));
        if (o.sources.nasa && /space|earth|star|sky|planet|moon|sun|galaxy|universe|night|eclipse/i.test(o.query)) tasks.push(safe(nasa(o.query)));
      }
    }
    if (first && o.sources.biblioteca !== false) tasks.push(safe(biblioteca(o.query)));
    return score((await Promise.all(tasks)).flat());
  };
  let results = await gather(o.orientation, true);
  // En vertical hay menos clips: si faltan, también se usan horizontales (se recortan al centro).
  if (o.orientation === "portrait" && results.filter((c) => c.score >= MIN_SCORE).length < 3) results = results.concat(await gather("landscape", false));
  return results.sort((a, b) => b.score - a.score);
}

export function insertAsset(projectId: string, c: Omit<Candidate, "url"> & { url?: string; localPath: string; isAi?: boolean }) {
  const r = db()
    .prepare(
      "INSERT INTO assets (project_id, provider, kind, external_id, source_url, page_url, author, license, attribution, local_path, is_ai, width, height) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(projectId, c.provider, c.kind, c.externalId, c.url ?? null, c.pageUrl ?? null, c.author ?? null, c.license, c.attribution, c.localPath, c.isAi ? 1 : 0, c.width ?? null, c.height ?? null);
  return Number(r.lastInsertRowid);
}

export async function downloadCandidate(projectId: string, c: Candidate): Promise<number> {
  const dir = projectDir(projectId, "media");
  if (c.provider === "biblioteca") {
    if (!isLibraryPath(c.url)) throw new Error("Archivo de biblioteca no encontrado");
    return insertAsset(projectId, { ...c, localPath: path.resolve(c.url) });
  }
  const ext = c.kind === "video" ? ".mp4" : /\.png(\?|$)/i.test(c.url) ? ".png" : ".jpg";
  const dest = path.join(dir, `${c.provider}-${hash(c.externalId)}${ext}`);
  if (!exists(dest)) await downloadTo(c.url, dest, c.headers);
  if (c.trackUrl && c.provider === "unsplash" && /^https:\/\/api\.unsplash\.com\//.test(c.trackUrl)) {
    await fetchWithTimeout(c.trackUrl, { headers: { Authorization: `Client-ID ${getSetting("UNSPLASH_ACCESS_KEY")}` } }).catch(() => undefined);
  }
  return insertAsset(projectId, { ...c, localPath: dest });
}

/**
 * Busca y descarga el mejor recurso para una escena probando varias búsquedas (de la más
 * específica a la más general). Primero clips de video realistas; luego fotografías.
 * Nunca repite un recurso ya usado en el video. Si no hay nada adecuado: IA (si está
 * autorizada) o fondo local.
 */
export async function findAssetForScene(
  o: SearchOpts & { queries?: string[]; sceneText?: string; impact?: boolean; sceneIdx: number; w: number; h: number; useAi: boolean; aiPrompt: string },
): Promise<number> {
  const queries = [...(o.queries ?? []), o.query].map((q) => q?.trim()).filter((q, i, a): q is string => !!q && a.indexOf(q) === i).slice(0, 5);
  const kinds: Kind[] = o.preferVideo ? ["video", "image"] : ["image", "video"];
  const tryList = async (cands: (Candidate & { score: number })[]) => {
    for (const c of cands.filter((x) => x.score >= MIN_SCORE).slice(0, 3)) {
      try {
        const id = await downloadCandidate(o.projectId, c);
        o.exclude.add(`${c.provider}:${c.externalId}`);
        return id;
      } catch (e) {
        console.warn("Descarga fallida:", String(e));
      }
    }
    return null;
  };
  for (const kind of kinds) {
    for (const q of kind === "video" ? queries.slice(0, 3) : queries) {
      const id = await tryList(await searchCandidates({ ...o, query: q, kind, sceneText: o.sceneText, impact: o.impact }));
      if (id) return id;
    }
  }
  if (o.useAi && getSetting("OPENAI_API_KEY")) {
    const dest = path.join(projectDir(o.projectId, "media"), `ia-${o.sceneIdx}-${hash(o.aiPrompt)}.png`);
    try {
      if (!exists(dest)) await aiImage(o.aiPrompt, o.orientation, dest, o.projectId);
      return insertAsset(o.projectId, { provider: "ia", kind: "image", externalId: hash(o.aiPrompt), license: "Imagen generada con IA (ilustrativa)", attribution: "Imagen ilustrativa generada por IA — no es una fotografía real", localPath: dest, isAi: true });
    } catch (e) {
      console.warn("Imagen IA fallida:", String(e));
    }
  }
  const dest = path.join(projectDir(o.projectId, "media"), `local-${o.sceneIdx}.png`);
  if (!exists(dest)) await proceduralBackground(dest, Math.min(o.w, 1920), Math.min(o.h, 1920), o.sceneIdx + 1);
  return insertAsset(o.projectId, { provider: "local", kind: "image", externalId: `local-${o.sceneIdx}`, license: "Generado localmente por la aplicación", attribution: "Fondo generado por Profecía Studio AI", localPath: dest });
}

export async function generateAiForScene(projectId: string, sceneIdx: number, prompt: string, orientation: SearchOpts["orientation"]) {
  const dest = path.join(projectDir(projectId, "media"), `ia-${sceneIdx}-${hash(prompt, Date.now())}.png`);
  await aiImage(prompt, orientation, dest, projectId);
  return insertAsset(projectId, { provider: "ia", kind: "image", externalId: hash(prompt), license: "Imagen generada con IA (ilustrativa)", attribution: "Imagen ilustrativa generada por IA — no es una fotografía real", localPath: dest, isAi: true });
}

export function getAsset(id: number | null | undefined): AssetRow | undefined {
  if (!id) return undefined;
  return db().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
}

const ALLOWED_HOSTS = ["pexels.com", "vimeo.com", "pixabay.com", "unsplash.com", "wikimedia.org", "nasa.gov"];

/** Comprueba que una URL de descarga pertenece a un banco autorizado. */
export function isAllowedMediaUrl(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
