import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { getSetting } from "./settings";
import { downloadTo, fetchWithTimeout, run, exists, hash } from "./util";
import { projectDir, DATA_DIR, publicUrl } from "./paths";
import { assertCanSpend, recordCost } from "./costs";

export type Candidate = {
  provider: "pexels" | "pixabay" | "unsplash" | "wikimedia" | "nasa" | "biblioteca" | "ia" | "local" | "propio";
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

async function pexels(query: string, orientation: string, wantVideo: boolean): Promise<Candidate[]> {
  const key = getSetting("PEXELS_API_KEY");
  if (!key) return [];
  const out: Candidate[] = [];
  const o = orientation === "landscape" ? "landscape" : orientation === "portrait" ? "portrait" : "square";
  if (wantVideo) {
    const r = await fetchWithTimeout(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=10&size=medium`, { headers: { Authorization: key } });
    if (r.ok) {
      const j = (await r.json()) as { videos: { id: number; url: string; image: string; duration: number; user: { name: string }; video_files: { link: string; width: number; height: number; file_type: string }[] }[] };
      for (const v of j.videos ?? []) {
        if (v.duration < 4) continue;
        const files = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.width <= 2600).sort((a, b) => b.width - a.width);
        const f = files.find((x) => Math.max(x.width, x.height) <= 1920) ?? files[0];
        if (!f) continue;
        out.push({ provider: "pexels", kind: "video", externalId: `v${v.id}`, url: f.link, pageUrl: v.url, author: v.user?.name, license: "Licencia Pexels (uso comercial gratuito)", attribution: `Video de ${v.user?.name ?? "autor"} en Pexels`, width: f.width, height: f.height, thumb: v.image });
      }
    }
  }
  const r = await fetchWithTimeout(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${o}&per_page=10`, { headers: { Authorization: key } });
  if (r.ok) {
    const j = (await r.json()) as { photos: { id: number; url: string; photographer: string; width: number; height: number; src: { large2x: string; original: string; medium: string } }[] };
    for (const p of j.photos ?? [])
      out.push({ provider: "pexels", kind: "image", externalId: `p${p.id}`, url: p.src.large2x || p.src.original, pageUrl: p.url, author: p.photographer, license: "Licencia Pexels (uso comercial gratuito)", attribution: `Foto de ${p.photographer} en Pexels`, width: p.width, height: p.height, thumb: p.src.medium });
  }
  return out;
}

async function pixabay(query: string, orientation: string, wantVideo: boolean): Promise<Candidate[]> {
  const key = getSetting("PIXABAY_API_KEY");
  if (!key) return [];
  const out: Candidate[] = [];
  const q = encodeURIComponent(query.slice(0, 100));
  if (wantVideo) {
    const r = await fetchWithTimeout(`https://pixabay.com/api/videos/?key=${key}&q=${q}&safesearch=true&per_page=10`);
    if (r.ok) {
      const j = (await r.json()) as { hits: { id: number; pageURL: string; duration: number; user: string; videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }> }[] };
      for (const h of j.hits ?? []) {
        if (h.duration < 4) continue;
        const v = h.videos.large?.url ? h.videos.large : h.videos.medium;
        if (!v?.url) continue;
        out.push({ provider: "pixabay", kind: "video", externalId: `v${h.id}`, url: v.url, pageUrl: h.pageURL, author: h.user, license: "Licencia de contenido Pixabay (uso comercial gratuito)", attribution: `Video de ${h.user} en Pixabay`, width: v.width, height: v.height, thumb: v.thumbnail });
      }
    }
  }
  const o = orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all";
  const r = await fetchWithTimeout(`https://pixabay.com/api/?key=${key}&q=${q}&image_type=photo&orientation=${o}&safesearch=true&per_page=10&min_width=1280`);
  if (r.ok) {
    const j = (await r.json()) as { hits: { id: number; pageURL: string; user: string; largeImageURL: string; webformatURL: string; imageWidth: number; imageHeight: number }[] };
    for (const h of j.hits ?? [])
      out.push({ provider: "pixabay", kind: "image", externalId: `p${h.id}`, url: h.largeImageURL, pageUrl: h.pageURL, author: h.user, license: "Licencia de contenido Pixabay (uso comercial gratuito)", attribution: `Imagen de ${h.user} en Pixabay`, width: h.imageWidth, height: h.imageHeight, thumb: h.webformatURL });
  }
  return out;
}

async function unsplash(query: string, orientation: string): Promise<Candidate[]> {
  const key = getSetting("UNSPLASH_ACCESS_KEY");
  if (!key) return [];
  const o = orientation === "square" ? "squarish" : orientation;
  const r = await fetchWithTimeout(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${o}&per_page=10&content_filter=high`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (!r.ok) return [];
  const j = (await r.json()) as { results: { id: string; width: number; height: number; urls: { raw: string }; links: { html: string; download_location: string }; user: { name: string; links: { html: string } } }[] };
  return (j.results ?? []).map((p) => ({
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
  }));
}

const FREE_LICENSES = /^(cc0|public domain|pd|pdm|cc by \d|cc-by-\d|cc by \d\.\d|attribution)/i;
const SA_LICENSES = /^cc[ -]by[ -]sa/i;

async function wikimedia(query: string): Promise<Candidate[]> {
  const allowSA = getSetting("ALLOW_CC_BY_SA") === "si";
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=15&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=2400&origin=*`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return [];
  const j = (await r.json()) as { query?: { pages: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; width: number; height: number; mime: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  const out: Candidate[] = [];
  for (const p of Object.values(j.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/jpeg|png/.test(ii.mime) || ii.width < 1000) continue;
    const lic = (ii.extmetadata?.LicenseShortName?.value ?? "").replace(/<[^>]+>/g, "").trim();
    const ok = FREE_LICENSES.test(lic) || (allowSA && SA_LICENSES.test(lic));
    if (!ok || /nc|nd/i.test(lic.replace(/^cc[ -]by[ -]sa/i, ""))) continue;
    const artist = (ii.extmetadata?.Artist?.value ?? "Wikimedia Commons").replace(/<[^>]+>/g, "").trim().slice(0, 120);
    out.push({ provider: "wikimedia", kind: "image", externalId: p.title, url: ii.thumburl || ii.url, pageUrl: ii.descriptionurl, author: artist, license: lic, attribution: `${artist} — ${lic}, vía Wikimedia Commons`, width: ii.width, height: ii.height, headers: { "User-Agent": UA } });
  }
  return out;
}

async function nasa(query: string): Promise<Candidate[]> {
  const r = await fetchWithTimeout(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image&page_size=10`);
  if (!r.ok) return [];
  const j = (await r.json()) as { collection: { items: { href: string; data: { nasa_id: string; title: string; center?: string; photographer?: string; secondary_creator?: string }[]; links?: { href: string; rel: string }[] }[] } };
  const out: Candidate[] = [];
  for (const it of j.collection?.items ?? []) {
    const d = it.data?.[0];
    if (!d) continue;
    const credit = d.photographer || d.secondary_creator || "NASA";
    // Se excluyen imágenes con créditos de terceros, que pueden tener derechos propios.
    if (credit && !/nasa|jpl|esa|goddard|johnson/i.test(credit)) continue;
    const href = it.links?.find((l) => l.rel === "preview")?.href;
    if (!href) continue;
    out.push({ provider: "nasa", kind: "image", externalId: d.nasa_id, url: href.replace("~thumb", "~large"), pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, author: credit, license: "NASA — material generalmente de dominio público (sin uso del logotipo ni respaldo)", attribution: `Imagen: ${credit} (NASA)`, thumb: href });
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

export async function searchCandidates(o: SearchOpts): Promise<Candidate[]> {
  const tasks: Promise<Candidate[]>[] = [];
  const safe = (p: Promise<Candidate[]>) => p.catch((e) => (console.warn("Búsqueda fallida:", String(e)), [] as Candidate[]));
  if (o.sources.pexels) tasks.push(safe(pexels(o.query, o.orientation, o.preferVideo)));
  if (o.sources.pixabay) tasks.push(safe(pixabay(o.query, o.orientation, o.preferVideo)));
  if (o.sources.unsplash) tasks.push(safe(unsplash(o.query, o.orientation)));
  if (o.sources.wikimedia) tasks.push(safe(wikimedia(o.query)));
  if (o.sources.biblioteca !== false) tasks.push(safe(biblioteca(o.query)));
  if (o.sources.nasa && /space|earth|star|sky|planet|moon|sun|galaxy|universe|night/i.test(o.query)) tasks.push(safe(nasa(o.query)));
  const all = (await Promise.all(tasks)).flat().filter((c) => !o.exclude.has(`${c.provider}:${c.externalId}`));
  // Prioridad: videos primero (si se prefieren), luego por proveedor
  const rank = (c: Candidate) => (c.provider === "biblioteca" ? -20 : 0) + (o.preferVideo && c.kind === "video" ? 0 : 10) + ["pexels", "pixabay", "unsplash", "wikimedia", "nasa"].indexOf(c.provider);
  // intercala para variar proveedores
  return all.sort((a, b) => rank(a) - rank(b));
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

/** Busca y descarga el mejor recurso para una escena; si no hay, IA (si está autorizada) o fondo local. */
export async function findAssetForScene(o: SearchOpts & { sceneIdx: number; w: number; h: number; useAi: boolean; aiPrompt: string }): Promise<number> {
  const queries = [o.query, o.query.split(" ").slice(0, 2).join(" ")].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of queries) {
    const cands = await searchCandidates({ ...o, query: q });
    for (const c of cands.slice(0, 4)) {
      try {
        const id = await downloadCandidate(o.projectId, c);
        o.exclude.add(`${c.provider}:${c.externalId}`);
        return id;
      } catch (e) {
        console.warn("Descarga fallida:", String(e));
      }
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
