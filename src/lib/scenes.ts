import { findRefs, VERSES } from "./bible";
import { activeProvider, llmJson } from "./llm";
import { words } from "./util";
import { heuristicQueries } from "./visual";

export type Overlay =
  | { type: "verse"; ref: string; text?: string }
  | { type: "headline"; text: string }
  | { type: "map"; place: string }
  | { type: "interpretation" }
  | { type: "info"; text: string };

export type ScenePlan = {
  text: string;
  query: string;
  /** Búsquedas en inglés de la más específica a la más general. */
  queries: string[];
  /** Significado de la escena (resumen breve) usado para elegir el recurso. */
  meaning?: string;
  overlay: Overlay | null;
  keywords: string[];
};

export type PlanResult = { scenes: ScenePlan[]; hookTitle: string | null };

// ───────────── División en escenas (3–5 s cada una; la primera, máx. ~3 s) ─────────────

const LINK_WORDS = new Set(["que", "de", "del", "en", "y", "e", "o", "a", "al", "con", "para", "por", "como", "la", "el", "los", "las", "un", "una", "sin", "sobre", "entre", "hasta", "donde", "cuando", "pero", "porque", "mientras", "aunque", "si"]);

/** Corta un fragmento largo sin puntuación en partes equilibradas, antes de una palabra de enlace. */
function balancedCut(text: string, maxW: number): string[] {
  const w = words(text);
  if (w.length <= maxW) return [text];
  const parts = Math.ceil(w.length / maxW);
  const size = w.length / parts;
  const out: string[] = [];
  let start = 0;
  for (let p = 1; p < parts; p++) {
    let cut = Math.round(size * p);
    for (const d of [0, -1, 1, -2, 2]) {
      const k = Math.round(size * p) + d;
      if (k > start + 1 && k < w.length - 1 && ((LINK_WORDS.has(w[k].toLowerCase()) && !LINK_WORDS.has(w[k - 1].toLowerCase())) || /[,;:]$/.test(w[k - 1]))) {
        cut = k;
        break;
      }
    }
    out.push(w.slice(start, cut).join(" "));
    start = cut;
  }
  out.push(w.slice(start).join(" "));
  return out;
}

export function splitScenes(script: string, speed = 1): string[] {
  const wps = (140 / 60) * speed; // palabras por segundo
  const minW = Math.round(3 * wps);
  const maxW = Math.round(5 * wps);
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
    if (cur) pieces.push(...balancedCut(cur, maxW));
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
  // Impacto inicial: el primer cambio de imagen llega antes de los 3 segundos.
  const firstMax = Math.max(4, Math.round(2.8 * wps));
  if (scenes.length && words(scenes[0]).length > firstMax) {
    const w = words(scenes[0]);
    let cut = firstMax;
    for (let k = firstMax; k >= Math.max(3, firstMax - 3); k--) if (/[,;:…?!]$|\.\.\.$/.test(w[k - 1])) {
      cut = k;
      break;
    }
    const rest = w.slice(cut).join(" ");
    // un resto muy corto se une a la escena siguiente (sin fragmentos de medio segundo)
    if (words(rest).length < minW / 2 && scenes[1] && words(rest).length + words(scenes[1]).length <= maxW + 2) scenes.splice(0, 2, w.slice(0, cut).join(" "), `${rest} ${scenes[1]}`);
    else scenes.splice(0, 1, w.slice(0, cut).join(" "), rest);
  }
  return scenes;
}

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

function heuristicPlan(texts: string[], topic = ""): ScenePlan[] {
  const verseRefsShown = new Set<string>();
  const usedFirst = new Map<string, number>();
  return texts.map((text, i) => {
    let queries = heuristicQueries(text, { prev: texts[i - 1], next: texts[i + 1], topic });
    // escenas seguidas con la misma búsqueda principal: se rota el orden para variar el metraje
    const n = usedFirst.get(queries[0]) ?? 0;
    usedFirst.set(queries[0], n + 1);
    if (n > 0 && queries.length > 1) queries = [...queries.slice(n % queries.length), ...queries.slice(0, n % queries.length)];

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
    return { text, query: queries[0], queries, overlay, keywords };
  });
}

/**
 * Planifica las escenas analizando el significado de cada fragmento en el contexto de todo
 * el guion: búsquedas en inglés (de específica a general), elementos en pantalla, palabras
 * clave y un título de impacto para los primeros segundos.
 */
export async function planScenes(texts: string[], topic: string, projectId?: string): Promise<PlanResult> {
  const base = heuristicPlan(texts, topic);
  const fallbackHook = topic ? topic.toLocaleUpperCase("es") : null;
  if ((await activeProvider()) === "none") return { scenes: base, hookTitle: fallbackHook };
  try {
    const r = await llmJson<{
      hook_title: string;
      scenes: { i: number; meaning: string; queries: string[]; overlay_type: string; overlay_text: string; keywords: string[] }[];
    }>({
      system: `Eres editor de documentales cristianos de profecía bíblica (tema: ${topic || "profecía bíblica"}). Lee TODO el guion para entender el contexto y luego, para CADA escena:
- meaning: qué significa realmente ese fragmento dentro del relato (máx. 12 palabras, en español). No te quedes en palabras sueltas: interpreta la idea (p. ej. "comprar ni vender" en contexto profético = control económico, no una tienda cualquiera).
- queries: 3 búsquedas EN INGLÉS para Pexels/Pixabay, de la más específica a la más general, de METRAJE REAL de estilo documental/cinematográfico que ilustre ese significado (lugares, objetos, acciones, atmósfera: aerial, close up, silhouette, storm, light rays, ancient...). 2 a 5 palabras cada una. Prohibido: adornos navideños, Papá Noel, cráneos o calaveras, caricaturas, animaciones, ilustraciones, 3D, personas famosas o identificables por su nombre. Animaciones o gráficos tecnológicos (hologramas, código, circuitos) SOLO si la escena habla de tecnología. Evita repetir la misma búsqueda en escenas cercanas.
- overlay_type: "verse" si cita un versículo (overlay_text = referencia exacta, ej. "Apocalipsis 13:16"); "map" si se centra en un país o ciudad (overlay_text = lugar en español); "headline" si presenta un hecho informado (overlay_text = titular breve y fiel, máx. 8 palabras); "interpretation" si es interpretación profética; "info" para un dato clave (≤ 6 palabras); "none" en los demás casos. Usa overlays en menos de la mitad de las escenas.
- keywords: 1 a 3 palabras de la escena (tal como aparecen) para resaltar en amarillo en los subtítulos.
Además, hook_title: 2 a 5 palabras de impacto en MAYÚSCULAS para mostrar en los primeros 3 segundos, fieles al contenido y sin sensacionalismo engañoso. Para la escena 0 elige búsquedas de máximo impacto visual (aerial, storm, light rays, dramatic).`,
      prompt: JSON.stringify(texts.map((t, i) => ({ i, text: t }))),
      schema: {
        type: "object",
        properties: {
          hook_title: { type: "string" },
          scenes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                i: { type: "integer" },
                meaning: { type: "string" },
                queries: { type: "array", items: { type: "string" } },
                overlay_type: { type: "string", enum: ["verse", "map", "headline", "interpretation", "info", "none"] },
                overlay_text: { type: "string" },
                keywords: { type: "array", items: { type: "string" } },
              },
              required: ["i", "meaning", "queries", "overlay_type", "overlay_text", "keywords"],
              additionalProperties: false,
            },
          },
        },
        required: ["hook_title", "scenes"],
        additionalProperties: false,
      },
      maxTokens: 64000,
      projectId,
      expectedOutputChars: texts.length * 260,
      purpose: "análisis visual de escenas",
    });
    const byI = new Map(r.scenes.map((x) => [x.i, x]));
    const scenes = base.map((b, i) => {
      const x = byI.get(i);
      if (!x) return b;
      let overlay: Overlay | null = null;
      const t = (x.overlay_text || "").trim();
      if (x.overlay_type === "verse" && t) overlay = { type: "verse", ref: t, text: VERSES.find((v) => v.ref === t)?.text };
      else if (x.overlay_type === "map" && t) overlay = { type: "map", place: t };
      else if (x.overlay_type === "headline" && t) overlay = { type: "headline", text: t };
      else if (x.overlay_type === "info" && t) overlay = { type: "info", text: t };
      else if (x.overlay_type === "interpretation") overlay = { type: "interpretation" };
      // búsquedas de la IA primero; las del diccionario quedan como respaldo
      const queries = [...(x.queries ?? []).map((q) => q.trim()).filter(Boolean), ...b.queries].filter((q, k, a) => a.indexOf(q) === k).slice(0, 5);
      return { text: b.text, query: queries[0] ?? b.query, queries, meaning: x.meaning, overlay, keywords: x.keywords?.length ? x.keywords : b.keywords };
    });
    return { scenes, hookTitle: r.hook_title?.trim() ? r.hook_title.trim().toLocaleUpperCase("es").slice(0, 40) : fallbackHook };
  } catch (e) {
    console.warn("Planificación con IA falló, se usa la heurística:", e);
    return { scenes: base, hookTitle: fallbackHook };
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
