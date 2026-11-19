import { findRefs, VERSES } from "./bible";
import { activeProvider, llmJson } from "./llm";
import { words } from "./util";

export type Overlay =
  | { type: "verse"; ref: string; text?: string }
  | { type: "headline"; text: string }
  | { type: "map"; place: string }
  | { type: "interpretation" }
  | { type: "info"; text: string };

export type ScenePlan = { text: string; query: string; overlay: Overlay | null; keywords: string[] };

// ───────────── División en escenas (4–8 s cada una) ─────────────

export function splitScenes(script: string, speed = 1): string[] {
  const wps = (140 / 60) * speed; // palabras por segundo
  const minW = Math.round(4 * wps);
  const maxW = Math.round(8 * wps);
  const sentences = script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // parte las frases demasiado largas por comas, punto y coma o conjunciones
  const pieces: string[] = [];
  for (const s of sentences) {
    if (words(s).length <= maxW) {
      pieces.push(s);
      continue;
    }
    const sub = s.split(/(?<=[,;:])\s+|\s+(?=(?:y|pero|porque|mientras|cuando|aunque)\s)/);
    let cur = "";
    for (const part of sub) {
      const cand = cur ? `${cur} ${part}` : part;
      if (words(cand).length > maxW && cur) {
        pieces.push(cur);
        cur = part;
      } else cur = cand;
    }
    if (cur) {
      // último recurso: cortar por número de palabras
      const w = words(cur);
      for (let i = 0; i < w.length; i += maxW) pieces.push(w.slice(i, i + maxW).join(" "));
    }
  }

  // une los fragmentos cortos
  const scenes: string[] = [];
  for (const p of pieces) {
    const last = scenes[scenes.length - 1];
    if (last && words(last).length < minW && words(last).length + words(p).length <= maxW) scenes[scenes.length - 1] = `${last} ${p}`;
    else scenes.push(p);
  }
  if (scenes.length > 1 && words(scenes[scenes.length - 1]).length < minW / 2) {
    const tail = scenes.pop()!;
    scenes[scenes.length - 1] += ` ${tail}`;
  }
  return scenes;
}

// ───────────── Diccionario temático para búsquedas en bancos de imágenes ─────────────

const QUERY_MAP: [RegExp, string][] = [
  [/jerusal[eé]n|monte del templo|muro de los lamentos/i, "jerusalem old city"],
  [/tercer templo|templo/i, "ancient temple jerusalem"],
  [/israel/i, "israel landscape"],
  [/gaza/i, "middle east city smoke"],
  [/ir[aá]n/i, "iran tehran"],
  [/rusia|kremlin|mosc[uú]/i, "moscow kremlin"],
  [/ucrania/i, "ukraine war"],
  [/china|pek[ií]n/i, "china city night"],
  [/estados unidos|washington|casa blanca/i, "washington capitol"],
  [/misil|bomba|bombardeo|ataque|explosi/i, "missile launch"],
  [/guerra|ej[eé]rcito|soldado|militar|conflicto/i, "soldiers war"],
  [/nuclear|at[oó]mic/i, "nuclear explosion mushroom cloud"],
  [/dinero digital|moneda digital|cbdc|pago digital|criptomoneda|bitcoin/i, "digital payment technology"],
  [/efectivo|billete|dinero|banco|econom/i, "money banking"],
  [/chip|implante|biom[eé]tric|reconocimiento facial|identidad digital/i, "biometric scan technology"],
  [/marca|bestia/i, "hand scanner chip"],
  [/inteligencia artificial|\bia\b|algoritmo|robot|chatgpt/i, "artificial intelligence"],
  [/tecnolog|ciencia|internet|digital/i, "technology data network"],
  [/vigilancia|c[aá]mara|control/i, "surveillance camera"],
  [/arrebatamiento|nubes|cielo/i, "dramatic clouds sky light"],
  [/trompeta/i, "shofar horn"],
  [/segunda venida|regreso de cristo|vendr[aá]/i, "heaven light rays clouds"],
  [/cruz|crucific|calvario/i, "cross sunset"],
  [/jes[uú]s|cristo|salvador|se[ñn]or/i, "cross light hope"],
  [/oraci[oó]n|orar|ora\b/i, "praying hands"],
  [/biblia|escritura|vers[ií]culo|profeta|profec/i, "old bible book"],
  [/apocalipsis|juicio|tribulaci[oó]n|fin del mundo/i, "apocalyptic storm"],
  [/terremoto|sismo/i, "earthquake destruction"],
  [/hambre|pobreza/i, "famine drought"],
  [/pandemia|virus|peste/i, "virus pandemic hospital"],
  [/persecuci|m[aá]rtir|iglesia quemada|perseguid/i, "burned church ruins"],
  [/iglesia|congregaci|creyentes/i, "church interior candles"],
  [/onu|naciones unidas|l[ií]deres mundiales|cumbre/i, "united nations assembly"],
  [/gobierno|presidente|pol[ií]tic/i, "government building"],
  [/multitud|personas|gente|mundo entero/i, "crowd city people"],
  [/esperanza|salvaci[oó]n|vida eterna|amor/i, "sunrise hope light"],
  [/tierra|planeta|global|naciones/i, "earth from space"],
  [/estrellas|universo|se[ñn]ales en el cielo|luna|sol/i, "night sky stars"],
  [/desierto|antiguo|historia/i, "desert ancient ruins"],
];

const FALLBACK_QUERIES = ["dramatic clouds sky", "dark storm clouds", "old bible book", "candle light darkness", "earth from space", "sunrise light rays"];

const PLACES: [RegExp, string][] = [
  [/jerusal[eé]n/i, "Jerusalén"],
  [/israel/i, "Israel"],
  [/gaza/i, "Gaza"],
  [/ir[aá]n\b/i, "Irán"],
  [/rusia/i, "Rusia"],
  [/ucrania/i, "Ucrania"],
  [/siria|damasco/i, "Siria"],
  [/l[ií]bano/i, "Líbano"],
  [/turqu[ií]a/i, "Turquía"],
  [/egipto/i, "Egipto"],
  [/china/i, "China"],
  [/taiw[aá]n/i, "Taiwán"],
  [/irak|babilonia/i, "Irak (antigua Babilonia)"],
  [/arabia saudita/i, "Arabia Saudita"],
  [/estados unidos/i, "Estados Unidos"],
  [/europa|uni[oó]n europea/i, "Europa"],
  [/roma\b|vaticano/i, "Roma"],
];

const INTERPRETIVE = /perspectiva prof[eé]tica|interpretaci|estudiosos de la biblia|podr[ií]a (ser|estar)|muchos (creen|ven)|seg[uú]n la profec|cumplimiento prof/i;

export const HIGHLIGHT_WORDS = [
  "dios", "jesucristo", "jesús", "cristo", "señor", "biblia", "profecía", "profecías", "profético", "apocalipsis", "anticristo",
  "falso profeta", "bestia", "marca", "arrebatamiento", "tribulación", "israel", "jerusalén", "templo", "salvación", "salvo",
  "esperanza", "guerra", "fin", "últimos", "tiempos", "señales", "venida", "cielo", "eterna", "verdad", "control", "mundo",
  "inteligencia", "artificial", "digital", "nunca", "todo", "advertencia", "pregunta", "ahora", "hoy",
];

function heuristicPlan(texts: string[]): ScenePlan[] {
  const used = new Map<string, number>();
  const verseRefsShown = new Set<string>();
  return texts.map((text, i) => {
    let query = QUERY_MAP.find(([re]) => re.test(text))?.[1] ?? FALLBACK_QUERIES[i % FALLBACK_QUERIES.length];
    const n = used.get(query) ?? 0;
    used.set(query, n + 1);
    if (n > 0) query = `${query} ${["cinematic", "dark", "aerial", "close up", "night"][n % 5]}`;

    let overlay: Overlay | null = null;
    const refs = findRefs(text).filter((r) => !verseRefsShown.has(r));
    const place = PLACES.find(([re]) => re.test(text))?.[1];
    if (refs.length) {
      const ref = refs[0];
      verseRefsShown.add(ref);
      overlay = { type: "verse", ref, text: VERSES.find((v) => v.ref === ref)?.text };
    } else if (place && i % 3 === 0) overlay = { type: "map", place };
    else if (INTERPRETIVE.test(text)) overlay = { type: "interpretation" };
    else if (i > 0 && i < 8 && words(text).length >= 9 && !/^según la información/i.test(text) && /según|informó|anunció|report|publicó|declaró/i.test(text)) {
      overlay = { type: "headline", text: text.split(/[,.:;]/)[0].slice(0, 70) };
    }
    const keywords = words(text.toLowerCase().replace(/[^\p{L}\s]/gu, "")).filter((w) => HIGHLIGHT_WORDS.includes(w));
    return { text, query, overlay, keywords };
  });
}

/** Planifica las escenas: búsqueda visual (en inglés) y elementos en pantalla. */
export async function planScenes(texts: string[], topic: string, projectId?: string): Promise<ScenePlan[]> {
  const base = heuristicPlan(texts);
  if ((await activeProvider()) === "none") return base;
  try {
    const r = await llmJson<{ scenes: { i: number; query: string; overlay_type: string; overlay_text: string; keywords: string[] }[] }>({
      system: `Eres editor de video documental. Para cada escena de narración (tema: ${topic}) decide:
- query: 2 a 5 palabras EN INGLÉS para buscar un clip o foto de archivo en Pexels/Pixabay que ilustre lo narrado de forma literal y concreta (lugares, objetos, acciones). Evita repetir la misma búsqueda en escenas consecutivas. Nunca pidas imágenes de personas reales concretas.
- overlay_type: "verse" si la escena cita un versículo (overlay_text = referencia exacta, ej. "Apocalipsis 13:16"); "map" si la escena se centra en un país o ciudad (overlay_text = nombre del lugar en español); "headline" si presenta un hecho informado por el artículo (overlay_text = titular breve y fiel, máx. 8 palabras, sin exagerar); "interpretation" si es interpretación profética; "info" para un dato clave (overlay_text ≤ 6 palabras); "none" en los demás casos. Usa overlays en menos de la mitad de las escenas.
- keywords: 1 a 3 palabras de la escena (tal como aparecen) que deben resaltarse en amarillo en los subtítulos.`,
      prompt: JSON.stringify(texts.map((t, i) => ({ i, text: t }))),
      schema: {
        type: "object",
        properties: {
          scenes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                i: { type: "integer" },
                query: { type: "string" },
                overlay_type: { type: "string", enum: ["verse", "map", "headline", "interpretation", "info", "none"] },
                overlay_text: { type: "string" },
                keywords: { type: "array", items: { type: "string" } },
              },
              required: ["i", "query", "overlay_type", "overlay_text", "keywords"],
              additionalProperties: false,
            },
          },
        },
        required: ["scenes"],
        additionalProperties: false,
      },
      maxTokens: 64000,
      projectId,
      expectedOutputChars: texts.length * 160,
      purpose: "planificación de escenas",
    });
    const byI = new Map(r.scenes.map((s) => [s.i, s]));
    return base.map((b, i) => {
      const s = byI.get(i);
      if (!s) return b;
      let overlay: Overlay | null = null;
      const t = (s.overlay_text || "").trim();
      if (s.overlay_type === "verse" && t) overlay = { type: "verse", ref: t, text: VERSES.find((v) => v.ref === t)?.text };
      else if (s.overlay_type === "map" && t) overlay = { type: "map", place: t };
      else if (s.overlay_type === "headline" && t) overlay = { type: "headline", text: t };
      else if (s.overlay_type === "info" && t) overlay = { type: "info", text: t };
      else if (s.overlay_type === "interpretation") overlay = { type: "interpretation" };
      return { text: b.text, query: s.query?.trim() || b.query, overlay, keywords: s.keywords?.length ? s.keywords : b.keywords };
    });
  } catch (e) {
    console.warn("Planificación con IA falló, se usa la heurística:", e);
    return base;
  }
}

/** Agrupa escenas en bloques de narración (~40 s) para la síntesis de voz. */
export function groupBlocks(texts: string[], maxChars = 650): number[][] {
  const blocks: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  texts.forEach((t, i) => {
    if (cur.length && len + t.length > maxChars) {
      blocks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += t.length + 1;
  });
  if (cur.length) blocks.push(cur);
  return blocks;
}
