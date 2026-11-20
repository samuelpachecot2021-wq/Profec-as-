import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../paths";
import { fetchWithTimeout, downloadTo, hash, sleep, run, exists } from "../util";
import { licenseAllowed, searchCandidates, type AssetRow } from "../media";
import { norm, type Entity } from "./analyze";

/**
 * Fotografías para miniaturas con derechos verificables.
 *
 *  • Personas y lugares reales: Wikidata (identidad) + Wikimedia Commons (archivo, autor,
 *    licencia y fecha). La identidad se comprueba con la imagen oficial de la entidad en
 *    Wikidata (P18) o con el dato estructurado «representa a» (P180) del archivo en Commons.
 *    Solo se aceptan licencias que permiten uso comercial y obras derivadas.
 *  • Recursos ya descargados para el video (Pexels, Pixabay, Unsplash, Wikimedia, Runway…).
 *  • Bancos con licencia (Pexels, Pixabay, Unsplash) para el ambiente de un acontecimiento,
 *    marcados como «foto de archivo» (nunca como foto del hecho concreto).
 * Nunca se generan rostros de personas reales ni fotos de acontecimientos con IA.
 */

export type PhotoCandidate = {
  id: string;
  source: "wikimedia" | "proyecto" | "propio" | "pexels" | "pixabay" | "unsplash" | "nasa" | "biblioteca";
  /** real = fotografía documental del sujeto · stock = foto de archivo con licencia · ia = recreación generada con IA */
  kind: "real" | "stock" | "ia";
  role: "persona" | "lugar" | "acontecimiento" | "escena";
  subject?: string;
  subjectQid?: string;
  verified?: string;
  title: string;
  author: string;
  license: string;
  date?: string;
  pageUrl?: string;
  url?: string;
  preview?: string;
  localPath?: string;
  width?: number;
  height?: number;
  score: number;
};

const WIKIDATA = () => process.env.WIKIDATA_API || "https://www.wikidata.org/w/api.php";
const COMMONS = () => process.env.COMMONS_API || "https://commons.wikimedia.org/w/api.php";
export const WM_UA = "ProfeciaStudioAI/1.0 (https://github.com/samuelpachecot2021-wq/Profec-as-; herramienta de produccion de video)";
const CACHE = path.join(CACHE_DIR, "miniaturas");

let lastCall = 0;
const downUntil = new Map<string, number>();
/** Consulta a Wikidata/Commons respetando sus normas: identificación, ritmo pausado, caché y reintentos. */
async function wm<T>(base: string, params: Record<string, string>, ttlHours: number): Promise<T | null> {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params }).toString();
  const url = `${base}?${qs}`;
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${hash(url)}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < ttlHours * 3600_000) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {}
  const host = new URL(base).host;
  if ((downUntil.get(host) ?? 0) > Date.now()) return null; // servicio caído hace poco: no se insiste
  const minGap = Number(process.env.WM_MIN_GAP_MS ?? 1100);
  let netErrors = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + minGap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const r = await fetchWithTimeout(url, { headers: { "User-Agent": WM_UA, "Api-User-Agent": WM_UA } }, 15000);
      const text = await r.text();
      if (r.status === 429 || /too many requests/i.test(text.slice(0, 300)) || r.status >= 500) {
        await sleep(2500 * 2 ** attempt);
        continue;
      }
      if (!r.ok) return null;
      const j = JSON.parse(text) as T & { error?: { code?: string } };
      if (j.error?.code === "maxlag") {
        await sleep(3000);
        continue;
      }
      try {
        fs.writeFileSync(file, text);
      } catch {}
      return j;
    } catch {
      // sin conexión o tiempo agotado: un reintento y, si sigue, se pausa ese servicio 10 minutos
      if (++netErrors >= 2) {
        downUntil.set(host, Date.now() + 10 * 60_000);
        return null;
      }
      await sleep(1500);
    }
  }
  return null;
}

type WdEntity = {
  id: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]>;
  missing?: string;
};

const claimIds = (e: WdEntity, p: string) => (e.claims?.[p] ?? []).map((c) => (c.mainsnak.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => !!x);
const claimStr = (e: WdEntity, p: string) => (e.claims?.[p] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((x): x is string => typeof x === "string");

export type ResolvedEntity = { qid: string; label: string; labelEn?: string; description: string; image?: string; kind: Entity["kind"] };

/** ¿Coincide el nombre buscado con la etiqueta o los alias de la entidad? */
function nameMatches(e: WdEntity, name: string) {
  const want = norm(name).split(" ").filter((w) => w.length > 2);
  const names = [...Object.values(e.labels ?? {}).map((l) => l.value), ...Object.values(e.aliases ?? {}).flat().map((a) => a.value)].map(norm);
  if (!want.length) return false;
  return names.some((n) => {
    const ws = n.split(" ");
    const hits = want.filter((w) => ws.includes(w)).length;
    return hits === want.length || (want.length >= 2 && hits >= want.length - 1 && hits >= 1) || (want.length === 1 && ws.includes(want[0]));
  });
}

const entityMemo = new Map<string, WdEntity>();
async function getEntities(ids: string[]) {
  const missing = ids.filter((id) => !entityMemo.has(id));
  if (missing.length) {
    const j = await wm<{ entities: Record<string, WdEntity> }>(WIKIDATA(), { action: "wbgetentities", ids: missing.slice(0, 50).join("|"), props: "labels|aliases|descriptions|claims", languages: "es|en|mul" }, 24 * 30);
    for (const e of Object.values(j?.entities ?? {})) if (!e.missing) entityMemo.set(e.id, e);
  }
  return ids.map((id) => entityMemo.get(id)).filter((e): e is WdEntity => !!e);
}

/** Carga en una sola consulta todas las entidades conocidas del guion (menos peticiones a Wikidata). */
export async function prefetchEntities(ids: string[]) {
  if (ids.length) await getEntities([...new Set(ids)]);
}

/** Resuelve una persona, lugar o acontecimiento en Wikidata y verifica que es la entidad correcta. */
export async function resolveEntity(ent: Pick<Entity, "name" | "qid" | "kind">): Promise<ResolvedEntity | null> {
  const ok = (e: WdEntity) => {
    const p31 = claimIds(e, "P31");
    if (ent.kind === "person" && !p31.includes("Q5")) return false;
    if (ent.kind !== "person" && p31.includes("Q5")) return false;
    if (p31.some((x) => ["Q4167410", "Q101352", "Q13406463", "Q4167836"].includes(x))) return false; // desambiguación, apellido, listas, categorías
    return nameMatches(e, ent.name);
  };
  const toResolved = (e: WdEntity): ResolvedEntity => ({
    qid: e.id,
    label: e.labels?.es?.value ?? e.labels?.mul?.value ?? e.labels?.en?.value ?? ent.name,
    labelEn: e.labels?.en?.value ?? e.labels?.mul?.value,
    description: e.descriptions?.es?.value ?? e.descriptions?.en?.value ?? "",
    image: claimStr(e, "P18")[0],
    kind: ent.kind,
  });
  if (ent.qid) {
    const [e] = await getEntities([ent.qid]);
    if (e && ok(e)) return toResolved(e);
  }
  const s = await wm<{ search: { id: string }[] }>(WIKIDATA(), { action: "wbsearchentities", search: ent.name, language: "es", uselang: "es", type: "item", limit: "6" }, 24 * 7);
  const ids = (s?.search ?? []).map((x) => x.id);
  const ents = await getEntities(ids);
  for (const id of ids) {
    const e = ents.find((x) => x.id === id);
    if (e && ok(e)) return toResolved(e);
  }
  return null;
}

type CommonsPage = {
  title: string;
  imageinfo?: { url: string; thumburl?: string; descriptionurl: string; width: number; height: number; mime: string; timestamp?: string; extmetadata?: Record<string, { value: string }> }[];
};
const META = "LicenseShortName|DateTimeOriginal|Artist|Credit|ImageDescription|ObjectName|Copyrighted";
const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Fecha de la fotografía (AAAA-MM-DD) según los metadatos del archivo. */
export function photoDate(raw?: string): string | undefined {
  const m = strip(raw).match(/(19|20)\d{2}(?:[-:/.](\d{1,2}))?(?:[-:/.](\d{1,2}))?/);
  if (!m) return undefined;
  const [y, mo, d] = [m[0].slice(0, 4), m[2], m[3]];
  return [y, mo?.padStart(2, "0"), d?.padStart(2, "0")].filter(Boolean).join("-");
}

const NOT_PHOTO_PERSON = /statue|estatua|wax|cera|mural|impersonat|imitador|mask|máscara|caricat|cartoon|drawing|dibujo|painting|pintura|sculpture|escultura|figurine|poster|cartel|graffiti|signature|firma|logo|flag|bandera|coat of arms|escudo|\bmap\b|mapa|\.svg|\.gif|\.tif|meme|ai[- ]generated|deepfake|generated|render/i;
const NOT_PHOTO_PLACE = /\bmap\b|mapa|flag|bandera|coat of arms|escudo|logo|diagram|locator|location|\.svg|\.gif|seal|emblem|plan\b|plano|chart|gráfico|stamp|sello|ai[- ]generated|generated|render/i;

const BAD_PERSON = /crimin|meme|parod|satir|fake|falso|caricat|protest|manifesta|demonstrat|pancarta|effigy|efigie|ipad|wallpaper|fondo de pantalla|achtergrond|background|collage|montage|montaje|\bvs\b|versus|photoshop/i;
const BAD_PLACE = /painting|oil on|canvas|óleo|oleo|drawing|dibujo|engraving|grabado|lithograph|litograf|illustration|ilustraci|\bmap\b|mapa|tissot|manuscript|manuscrito|\b\d{3,4} (ad|bc)\b|century|siglo|memorial|cattle|wagon|vag[oó]n|\btrain\b|museum|museo|interior|vandal|graffiti|police|polic[ií]a/i;

/** Contador de fotos descartadas solo por tener licencia CC BY-SA (no autorizada en Ajustes). */
export const licenseStats = { saBlocked: 0 };

function fromCommons(p: CommonsPage, ent: ResolvedEntity, role: PhotoCandidate["role"], how: "p18" | "p180"): PhotoCandidate | null {
  const ii = p.imageinfo?.[0];
  if (!ii || !/jpeg|png/.test(ii.mime) || Math.max(ii.width, ii.height) < 800) return null;
  if ((role === "persona" ? NOT_PHOTO_PERSON : NOT_PHOTO_PLACE).test(p.title)) return null;
  const m = ii.extmetadata ?? {};
  const lic = strip(m.LicenseShortName?.value);
  if (!lic || !licenseAllowed(lic)) {
    if (/^cc[ -]by[ -]sa/i.test(lic) && licenseAllowed(lic, true)) licenseStats.saBlocked++;
    return null;
  }
  const date = photoDate(m.DateTimeOriginal?.value) ?? undefined;
  const author = strip(m.Artist?.value || m.Credit?.value || "Wikimedia Commons").slice(0, 120);
  const title = p.title.replace(/^File:|^Archivo:/, "").replace(/\.\w+$/, "").replace(/_/g, " ");
  if (how === "p180") {
    // doble comprobación: el nombre de la persona o del lugar debe figurar en el título del archivo
    const names = [ent.label, ent.labelEn ?? ""].join(" ");
    const words = norm(names).split(" ").filter((w) => w.length > 2);
    const t = norm(title).split(" ");
    if (!words.length || !words.some((w) => t.includes(w))) return null;
    const text = `${title} ${strip(m.ImageDescription?.value)}`;
    if (role === "persona" && BAD_PERSON.test(text)) return null;
    if (role !== "persona" && (BAD_PLACE.test(text) || !photoDate(m.DateTimeOriginal?.value) || Number(photoDate(m.DateTimeOriginal?.value)!.slice(0, 4)) < 2000)) return null;
  }
  const age = date ? new Date().getFullYear() - Number(date.slice(0, 4)) : null;
  let score = how === "p18" ? 50 : 40;
  if (role === "persona") {
    // personas: se priorizan las fotos recientes
    if (age !== null) score += Math.max(-25, 30 - 6 * age);
    else score -= 10;
    if (/protest|protesta|demonstration|manifestaci|rally against|sign|cartel|pancarta|effigy|efigie|burning|quema/i.test(`${title} ${strip(m.ImageDescription?.value)}`)) score -= 30;
    if (/portrait|retrato|official|oficial|headshot/i.test(title)) score += 10;
    if (ii.height >= ii.width * 0.95) score += 5;
    if (/\band\b|\bwith\b|\by\b|meeting|reunión|delegation|delegación|group|grupo/i.test(title)) score -= 8;
    if (how === "p180" && age !== null && age > 8) return null; // fotos antiguas: solo la imagen oficial de la entidad
  } else {
    // lugares: que se reconozcan de inmediato (imagen emblemática, vista panorámica, nombre del lugar)
    if (how === "p18") score += 25;
    if (age !== null) score += Math.max(-5, 8 - age);
    const text = norm(`${title} ${strip(m.ImageDescription?.value)}`);
    const words = norm(ent.label).split(" ").filter((w) => w.length > 2);
    if (words.some((w) => text.split(" ").includes(w))) score += 12;
    else score -= 12;
    if (/skyline|panorama|panoramic|view|vista|aerial|aérea|old city|ciudad vieja|landmark|dome|cúpula|wall|muro|temple|templo/i.test(title)) score += 10;
    if (/interior|museum|museo|street sign|wagon|vag[oó]n|train|tren|car\b|bus\b|tram|tranv[ií]a|graffiti|vandal|police|polic/i.test(title)) score -= 15;
    if (ii.width >= ii.height) score += 5;
    if (ii.width >= 1600) score += 3;
  }
  return {
    id: `wm:${p.title}`,
    source: "wikimedia",
    kind: "real",
    role,
    subject: ent.label,
    subjectQid: ent.qid,
    verified: how === "p18" ? `Imagen oficial de «${ent.label}» (${ent.qid}) en Wikidata` : `Commons: el archivo representa a «${ent.label}» (${ent.qid})`,
    title,
    author,
    license: lic,
    date,
    pageUrl: ii.descriptionurl,
    url: ii.thumburl || ii.url,
    preview: ii.thumburl || ii.url,
    width: ii.width,
    height: ii.height,
    score,
  };
}

const imageinfoParams = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata|timestamp", iiextmetadatafilter: META, iiurlwidth: "1600" };

/** Fotos verificadas de una entidad: su imagen oficial (P18) y los archivos más recientes que la representan (P180). */
export async function photosOfEntity(ent: ResolvedEntity, role: PhotoCandidate["role"], limit = 24): Promise<PhotoCandidate[]> {
  const out: PhotoCandidate[] = [];
  if (ent.image) {
    const j = await wm<{ query?: { pages: CommonsPage[] } }>(COMMONS(), { action: "query", titles: `File:${ent.image}`, ...imageinfoParams }, 24 * 7);
    for (const p of j?.query?.pages ?? []) {
      const c = fromCommons(p, ent, role, "p18");
      if (c) out.push(c);
    }
  }
  const j = await wm<{ query?: { pages: CommonsPage[] } }>(
    COMMONS(),
    { action: "query", generator: "search", gsrsearch: `haswbstatement:P180=${ent.qid} filetype:bitmap`, gsrnamespace: "6", gsrsort: "create_timestamp_desc", gsrlimit: String(limit), ...imageinfoParams },
    24,
  );
  if (!j && !out.length) throw new Error("Wikimedia Commons no respondió (límite de peticiones o sin conexión); vuelva a intentarlo más tarde con «Regenerar»");
  for (const p of j?.query?.pages ?? []) {
    if (out.some((x) => x.id === `wm:${p.title}`)) continue;
    const c = fromCommons(p, ent, role, "p180");
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Recursos del propio video como candidatos (las recreaciones IA quedan marcadas como tales). */
export function projectCandidates(assets: AssetRow[]): PhotoCandidate[] {
  const seen = new Set<number>();
  const out: PhotoCandidate[] = [];
  for (const a of assets) {
    if (!a || seen.has(a.id) || a.provider === "local") continue;
    seen.add(a.id);
    const ai = !!a.is_ai || /runway|ia/.test(a.provider);
    out.push({
      id: `asset:${a.id}`,
      source: a.provider === "propio" ? "propio" : "proyecto",
      kind: ai ? "ia" : "stock",
      role: "escena",
      title: a.attribution ?? a.provider,
      author: a.author ?? (ai ? "Generado con IA" : a.provider),
      license: a.license ?? "",
      pageUrl: a.page_url ?? undefined,
      localPath: a.local_path,
      width: a.width ?? undefined,
      height: a.height ?? undefined,
      score: (a.kind === "image" ? 10 : 6) + (ai ? 4 : 0),
    });
  }
  return out;
}

/** Fotos de archivo con licencia (Pexels, Pixabay, Unsplash) para el ambiente de un acontecimiento. */
export async function stockPhotos(projectId: string, query: string, orientation: "landscape" | "portrait" | "square", role: PhotoCandidate["role"] = "acontecimiento", subject?: string): Promise<PhotoCandidate[]> {
  try {
    const r = await searchCandidates({
      projectId,
      query,
      orientation,
      preferVideo: false,
      kind: "image",
      exclude: new Set(),
      sources: { pexels: true, pixabay: true, unsplash: true, wikimedia: false, nasa: false, biblioteca: false },
    });
    return r.slice(0, 6).map((c) => ({
      id: `${c.provider}:${c.externalId}`,
      source: c.provider as PhotoCandidate["source"],
      kind: "stock" as const,
      role,
      subject,
      title: c.meta?.slice(0, 80) || query,
      author: c.author ?? c.provider,
      license: c.license,
      pageUrl: c.pageUrl,
      url: c.url,
      preview: c.thumb ?? c.url,
      width: c.width,
      height: c.height,
      score: 15 + Math.min(10, c.score / 10),
    }));
  } catch {
    return [];
  }
}

/** Descarga (una sola vez) la foto elegida y comprueba que es una imagen válida. */
export async function ensureLocal(c: PhotoCandidate, dir: string): Promise<string> {
  if (c.localPath && exists(c.localPath)) {
    if (/\.(mp4|mov|webm|m4v)$/i.test(c.localPath)) {
      const frame = path.join(dir, `fotograma-${hash(c.localPath)}.jpg`);
      if (!exists(frame)) await run("ffmpeg", ["-y", "-v", "error", "-ss", "1.2", "-i", c.localPath, "-frames:v", "1", "-q:v", "2", frame]);
      return frame;
    }
    return c.localPath;
  }
  if (!c.url || !/^https:\/\//.test(c.url)) throw new Error("La foto no tiene un enlace de descarga válido");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${c.source}-${hash(c.id)}${/\.png(\?|$)/i.test(c.url) ? ".png" : ".jpg"}`);
  for (let attempt = 0; !exists(dest); attempt++) {
    try {
      await downloadTo(c.url, dest, { "User-Agent": WM_UA }, 40_000_000);
    } catch (e) {
      // el servidor de imágenes limita la frecuencia (429): se espera y se reintenta
      if (attempt >= 3 || !/\((429|5\d\d)\)/.test(String(e))) throw e;
      await sleep(Number(process.env.WM_RETRY_MS ?? 4000) * (attempt + 1));
    }
  }
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", dest]).catch(() => "");
  const [w, h] = probe.trim().split(",").map(Number);
  if (!(w > 100 && h > 100)) {
    fs.rmSync(dest, { force: true });
    throw new Error("La imagen descargada no es válida");
  }
  c.localPath = dest;
  c.width = w;
  c.height = h;
  return dest;
}
