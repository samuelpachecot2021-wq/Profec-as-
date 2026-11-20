import { activeProvider, llmJson } from "../llm";
import type { ThumbStyle } from "./design";

/**
 * Análisis del guion completo para las miniaturas: tema, protagonistas reales, países,
 * lugares y acontecimiento; estilo (noticias o bíblico) y tres titulares breves
 * comprobados contra el guion (nada que el guion no respalde).
 */

export type Entity = { name: string; qid?: string; kind: "person" | "place" | "event"; mentions: number };

export type ThumbAnalysis = {
  style: ThumbStyle;
  styleReason: string;
  topic: string;
  people: Entity[];
  places: Entity[];
  /** specific: acontecimiento concreto (p. ej. «guerra de Gaza») que puede buscarse en Wikidata. */
  event: { name: string; query?: string; specific?: boolean } | null;
  headlines: { protagonista: string; acontecimiento: string; impacto: string };
  highlight: { protagonista: string[]; acontecimiento: string[]; impacto: string[] };
  /** Etiquetas cortas verificadas en el guion (lugar, país o tema). */
  tags: { protagonista: string | null; acontecimiento: string | null; impacto: string | null };
  engine: "ia" | "local";
};

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Personas y lugares frecuentes en noticias y profecía. El identificador de Wikidata solo
 * acelera la búsqueda: la identidad se vuelve a comprobar en línea antes de usar cualquier foto.
 */
type Known = { name: string; aliases: string[]; qid: string; kind: "person" | "place"; display?: string };
export const KNOWN: Known[] = [
  { name: "Donald Trump", aliases: ["donald trump", "trump", "presidente trump"], qid: "Q22686", kind: "person" },
  { name: "Joe Biden", aliases: ["joe biden", "biden"], qid: "Q6279", kind: "person" },
  { name: "Benjamín Netanyahu", aliases: ["benjamin netanyahu", "netanyahu", "netanyahu", "bibi netanyahu"], qid: "Q43723", kind: "person" },
  { name: "Vladímir Putin", aliases: ["vladimir putin", "putin"], qid: "Q7747", kind: "person" },
  { name: "Volodímir Zelenski", aliases: ["volodimir zelenski", "zelenski", "zelensky", "volodymyr zelensky"], qid: "Q3874799", kind: "person" },
  { name: "Xi Jinping", aliases: ["xi jinping"], qid: "Q15031", kind: "person" },
  { name: "Emmanuel Macron", aliases: ["emmanuel macron", "macron"], qid: "Q3052772", kind: "person" },
  { name: "Recep Tayyip Erdoğan", aliases: ["recep tayyip erdogan", "erdogan"], qid: "Q39259", kind: "person" },
  { name: "Kim Jong-un", aliases: ["kim jong un", "kim jong-un"], qid: "Q56226", kind: "person" },
  { name: "Alí Jamenei", aliases: ["ali jamenei", "jamenei", "khamenei", "ali khamenei"], qid: "Q57336", kind: "person" },
  { name: "Jerusalén", aliases: ["jerusalen", "jerusalem"], qid: "Q1218", kind: "place" },
  { name: "Israel", aliases: ["israel", "estado de israel"], qid: "Q801", kind: "place" },
  { name: "Franja de Gaza", aliases: ["gaza", "franja de gaza"], qid: "Q39760", kind: "place", display: "Gaza" },
  { name: "Irán", aliases: ["iran"], qid: "Q794", kind: "place" },
  { name: "Rusia", aliases: ["rusia"], qid: "Q159", kind: "place" },
  { name: "Ucrania", aliases: ["ucrania"], qid: "Q212", kind: "place" },
  { name: "China", aliases: ["china"], qid: "Q148", kind: "place" },
  { name: "Estados Unidos", aliases: ["estados unidos", "ee uu", "eeuu", "eua"], qid: "Q30", kind: "place", display: "EE. UU." },
  { name: "Siria", aliases: ["siria"], qid: "Q858", kind: "place" },
  { name: "Damasco", aliases: ["damasco"], qid: "Q3766", kind: "place" },
  { name: "Líbano", aliases: ["libano"], qid: "Q822", kind: "place" },
  { name: "Turquía", aliases: ["turquia"], qid: "Q43", kind: "place" },
  { name: "Egipto", aliases: ["egipto"], qid: "Q79", kind: "place" },
  { name: "Taiwán", aliases: ["taiwan"], qid: "Q865", kind: "place" },
  { name: "Corea del Norte", aliases: ["corea del norte"], qid: "Q423", kind: "place" },
  { name: "Monte del Templo", aliases: ["monte del templo", "explanada de las mezquitas"], qid: "Q213274", kind: "place" },
  { name: "Ciudad del Vaticano", aliases: ["vaticano", "ciudad del vaticano"], qid: "Q237", kind: "place", display: "Vaticano" },
];

const NEWS_WORDS = [
  "presidente", "primer ministro", "gobierno", "elecciones", "ataque", "misil", "misiles", "acuerdo", "cumbre", "onu", "otan",
  "sanciones", "ejercito", "ministro", "guerra", "bombardeo", "tregua", "alto el fuego", "anuncio", "anuncio", "declaro", "informo",
  "segun", "noticia", "noticias", "esta semana", "hoy", "recientemente", "conflicto", "drones", "nuclear", "diplomatico", "embajada",
];
const BIBLE_WORDS = [
  "profecia", "profeta", "apocalipsis", "daniel", "ezequiel", "isaias", "zacarias", "versiculo", "escrituras", "biblia", "arrebatamiento",
  "anticristo", "bestia", "juicio", "salvacion", "jesucristo", "senor", "evangelio", "iglesia", "segunda venida", "milenio", "tribulacion",
];

/** Acontecimientos reconocibles (se usan solo si aparecen en el guion). */
const EVENTS: { label: string; keys: string[]; query: string }[] = [
  { label: "Acuerdo de paz", keys: ["acuerdo de paz", "tratado de paz", "acuerdos de abraham"], query: "peace agreement signing" },
  { label: "Alto el fuego", keys: ["alto el fuego", "tregua"], query: "ceasefire" },
  { label: "Guerra", keys: ["guerra"], query: "war" },
  { label: "Ataque con misiles", keys: ["misil", "misiles"], query: "missile attack" },
  { label: "Tercer templo", keys: ["tercer templo"], query: "Temple Mount Jerusalem" },
  { label: "Terremoto", keys: ["terremoto", "sismo"], query: "earthquake damage" },
  { label: "Elecciones", keys: ["elecciones"], query: "elections" },
  { label: "Moneda digital", keys: ["moneda digital", "dinero digital", "cbdc"], query: "digital currency" },
  { label: "Inteligencia artificial", keys: ["inteligencia artificial"], query: "artificial intelligence" },
  { label: "Persecución", keys: ["persecucion"], query: "persecuted christians" },
];

const count = (text: string, key: string) => {
  const re = new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "g");
  return (text.match(re) || []).length;
};

/** Palabras con significado del guion normalizado (para comprobar titulares). */
const BAD_WORDS = ["confirmado", "confirmada", "oficial", "ultima hora", "urgente", "fin del mundo", "muere", "murio", "muerto", "asesinado", "exclusiva", "filtrado", "ya comenzo", "hoy", "revelado", "secreto", "prohibido", "100"];

/**
 * Titular honesto: breve, en mayúsculas, sin «rapto», sin cifras, nombres ni afirmaciones
 * alarmistas que el guion no contenga. Devuelve null si no se puede respaldar.
 */
export function honestHeadline(headline: string, script: string, maxWords = 6): string | null {
  let h = (headline || "").replace(/["“”«»]/g, "").replace(/\s+/g, " ").trim();
  if (!h) return null;
  h = h.replace(/\brapto\b/gi, "arrebatamiento").toLocaleUpperCase("es");
  const words = h.split(" ");
  if (words.length > maxWords || h.length > 42) return null;
  const s = ` ${norm(script)} `;
  const nh = norm(h);
  // cifras y años: deben aparecer en el guion
  for (const n of nh.match(/\d+/g) ?? []) if (!s.includes(` ${n} `) && !s.includes(n)) return null;
  // expresiones alarmistas o absolutas: solo si el guion las usa
  for (const b of BAD_WORDS) if (count(nh, b) && !count(s, b)) return null;
  // nombres de personas y lugares conocidos: deben estar en el guion
  for (const k of KNOWN) if (k.aliases.some((a) => count(nh, a)) && !k.aliases.some((a) => count(s, a))) return null;
  return h;
}

const upper = (s: string) => s.toLocaleUpperCase("es");
const surname = (name: string) => {
  const parts = name.split(/\s+/);
  if (/jinping|jong/i.test(name)) return name;
  return parts[parts.length - 1];
};

/** Nombres propios de varias palabras (posibles personas no incluidas en la lista). */
function properNames(script: string) {
  const stop = new Set(["Dios", "Jesús", "Jesucristo", "Cristo", "Señor", "Espíritu", "Santo", "Biblia", "Reina", "Valera", "Apocalipsis", "Antiguo", "Nuevo", "Testamento", "Padre", "Hijo", "Iglesia", "Nuestro", "Su", "La", "El", "Los", "Las", "Un", "Una", "En", "Por", "Pero", "Y"]);
  const found = new Map<string, number>();
  const re = /(?<![.!?¿¡]\s)(?<!^)\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s(?:de\s|del\s|bin\s)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})\b/g;
  for (const m of script.matchAll(re)) {
    const n = m[1];
    if (n.split(/\s+/).some((w) => stop.has(w))) continue;
    found.set(n, (found.get(n) ?? 0) + 1);
  }
  return [...found.entries()].filter(([, c]) => c >= 2).map(([name, c]) => ({ name, c }));
}

/** Análisis gratuito (sin IA): diccionario de entidades, señales de noticias y titulares seguros. */
export function localAnalysis(o: { script: string; title: string; topic: string; seoTitles?: string[] }): ThumbAnalysis {
  const s = ` ${norm(`${o.title} ${o.script}`)} `;
  const people: Entity[] = [];
  const places: Entity[] = [];
  for (const k of KNOWN) {
    const n = Math.max(...k.aliases.map((a) => count(s, a)));
    if (n > 0) (k.kind === "person" ? people : places).push({ name: k.name, qid: k.qid, kind: k.kind, mentions: n });
  }
  for (const p of properNames(o.script)) {
    if (KNOWN.some((k) => k.aliases.some((a) => norm(p.name).includes(a)))) continue;
    if (/^(San|Santa|Mar|Monte|Nueva|Nuevo|Medio|Oriente|Naciones)\b/.test(p.name)) continue;
    people.push({ name: p.name, kind: "person", mentions: p.c });
  }
  people.sort((a, b) => b.mentions - a.mentions);
  places.sort((a, b) => b.mentions - a.mentions);
  const newsScore = NEWS_WORDS.reduce((a, w) => a + count(s, w), 0) + people.filter((p) => p.qid).length * 3 + (/\b20[2-3]\d\b/.test(s) ? 2 : 0);
  const bibleScore = BIBLE_WORDS.reduce((a, w) => a + count(s, w), 0) + (o.script.match(/\b\d+:\d+/g) || []).length;
  const knownPeople = people.filter((p) => p.qid);
  const isNews = knownPeople.length > 0 || (newsScore >= 4 && newsScore >= bibleScore * 0.4);
  const style: ThumbStyle = isNews ? "noticias" : "biblico";
  const styleReason = isNews
    ? knownPeople.length
      ? `El guion menciona a ${knownPeople.map((p) => p.name).slice(0, 3).join(", ")}: se usan fotografías reales y verificadas.`
      : "El guion trata acontecimientos actuales: se priorizan fotografías documentales."
    : "El guion es una enseñanza o profecía bíblica: se usa el estilo cinematográfico.";

  const event = EVENTS.map((e) => ({ e, n: Math.max(...e.keys.map((k) => count(s, k))) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.e ?? null;
  const mainPerson = knownPeople[0] ?? people[0] ?? null;
  const mainPlace = places[0] ?? null;
  const placeLabel = mainPlace ? (KNOWN.find((k) => k.name === mainPlace.name)?.display ?? mainPlace.name) : null;
  const topic = o.topic || "Profecía bíblica";

  const H = { protagonista: "", acontecimiento: "", impacto: "" };
  const HL = { protagonista: [] as string[], acontecimiento: [] as string[], impacto: [] as string[] };
  if (style === "noticias") {
    if (mainPerson) {
      const sn = upper(surname(mainPerson.name));
      H.protagonista = placeLabel && !norm(placeLabel).includes(norm(sn)) ? `${sn} Y ${upper(placeLabel)}` : `${sn} Y LA PROFECÍA`;
      HL.protagonista = [sn];
    } else {
      H.protagonista = upper(placeLabel ?? topic);
      HL.protagonista = [H.protagonista.split(" ").pop()!];
    }
    if (placeLabel && event) {
      H.acontecimiento = `${upper(placeLabel)}: ${upper(event.label)}`;
      HL.acontecimiento = upper(event.label).split(" ");
    } else if (event) {
      H.acontecimiento = upper(event.label);
      HL.acontecimiento = [upper(event.label).split(" ")[0]];
    } else {
      H.acontecimiento = upper(placeLabel ? `${placeLabel} en la mira` : topic);
      HL.acontecimiento = [upper(placeLabel ?? topic).split(" ")[0]];
    }
    H.impacto = "¿SE CUMPLE LA PROFECÍA?";
    HL.impacto = ["PROFECÍA?"];
  } else {
    const t = (o.seoTitles ?? []).map((x) => honestHeadline(x, o.script)).filter((x): x is string => !!x);
    H.protagonista = t[0] ?? upper(topic);
    H.acontecimiento = t[1] ?? upper(topic);
    H.impacto = t[2] ?? "¿SEÑAL DEL FIN?";
    const key = (x: string) => {
      const ws = x.replace(/[¿?¡!:,.]/g, "").split(" ").filter((w) => w.length > 3);
      return ws.length ? [ws.sort((a, b) => b.length - a.length)[0]] : [];
    };
    HL.protagonista = key(H.protagonista);
    HL.acontecimiento = key(H.acontecimiento);
    HL.impacto = key(H.impacto);
  }
  // seguridad final: cada titular se comprueba contra el guion
  for (const k of ["protagonista", "acontecimiento", "impacto"] as const) {
    const ok = honestHeadline(H[k], `${o.title} ${o.script}`);
    if (!ok) H[k] = k === "impacto" ? "¿SEÑAL DEL FIN?" : upper(topic).slice(0, 40);
  }
  const placeTag = placeLabel ? upper(placeLabel) : null;
  return {
    style,
    styleReason,
    topic,
    people: people.slice(0, 4),
    places: places.slice(0, 4),
    event: event ? { name: event.label, query: event.query } : null,
    headlines: H,
    highlight: HL,
    tags: { protagonista: placeTag, acontecimiento: placeTag ?? (event ? upper(event.label) : null), impacto: null },
    engine: "local",
  };
}

/** Coste aproximado de caracteres de entrada/salida del análisis con IA (para la estimación). */
export const ANALYSIS_OUTPUT_CHARS = 1500;

/**
 * Análisis con la IA de texto configurada (Claude/Ollama). Cualquier dato que no esté en el
 * guion se descarta; si la IA no está disponible o falla, se usa el análisis local gratuito.
 */
export async function analyzeScript(o: { projectId: string; script: string; title: string; topic: string; seoTitles?: string[] }): Promise<ThumbAnalysis> {
  const local = localAnalysis(o);
  if ((await activeProvider()) === "none") return local;
  try {
    const r = await llmJson<{
      style: "noticias" | "biblico";
      style_reason: string;
      topic: string;
      people: { name: string; role: string }[];
      places: string[];
      countries: string[];
      event: string;
      event_query_en: string;
      headline_protagonist: string;
      headline_event: string;
      headline_impact: string;
      highlight_protagonist: string;
      highlight_event: string;
      highlight_impact: string;
    }>({
      system: `Analizas guiones de videos cristianos de noticias y profecía bíblica para diseñar miniaturas de YouTube en español.
Devuelve SOLO datos que estén en el guion. No inventes personas, cargos, fechas, cifras ni hechos.
- style: "noticias" si el video trata noticias actuales, política, conflictos o acontecimientos reales con protagonistas reales; "biblico" si es una enseñanza, profecía o reflexión sin un acontecimiento actual concreto.
- people: personas reales y vivas o históricas recientes nombradas en el guion (no personajes bíblicos), con su nombre completo habitual.
- places: ciudades o lugares concretos; countries: países. event: el acontecimiento principal en 2-5 palabras; event_query_en: búsqueda breve en inglés para encontrar fotos documentales de ese acontecimiento.
- Titulares de miniatura (2 a 5 palabras, MAYÚSCULAS, español): uno centrado en el protagonista, otro en el acontecimiento y otro de alto impacto. Deben ser atractivos pero HONESTOS: nada que el guion no respalde, sin fechas ni cifras inventadas, sin afirmar como hecho una interpretación profética (use preguntas si es interpretación), sin "última hora", "confirmado" ni alarmismo falso. Usa "arrebatamiento", nunca "rapto".
- highlight_*: la palabra o frase (1-2 palabras) de cada titular que debe resaltarse en amarillo, copiada exactamente del titular.`,
      prompt: JSON.stringify({ titulo: o.title, tema: o.topic, guion: o.script.slice(0, 24000) }),
      schema: {
        type: "object",
        properties: {
          style: { type: "string", enum: ["noticias", "biblico"] },
          style_reason: { type: "string" },
          topic: { type: "string" },
          people: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"], additionalProperties: false } },
          places: { type: "array", items: { type: "string" } },
          countries: { type: "array", items: { type: "string" } },
          event: { type: "string" },
          event_query_en: { type: "string" },
          headline_protagonist: { type: "string" },
          headline_event: { type: "string" },
          headline_impact: { type: "string" },
          highlight_protagonist: { type: "string" },
          highlight_event: { type: "string" },
          highlight_impact: { type: "string" },
        },
        required: ["style", "style_reason", "topic", "people", "places", "countries", "event", "event_query_en", "headline_protagonist", "headline_event", "headline_impact", "highlight_protagonist", "highlight_event", "highlight_impact"],
        additionalProperties: false,
      },
      maxTokens: 6000,
      projectId: o.projectId,
      expectedOutputChars: ANALYSIS_OUTPUT_CHARS,
      purpose: "Análisis del guion para miniaturas",
    });
    const sc = ` ${norm(`${o.title} ${o.script}`)} `;
    const inScript = (name: string) => {
      const n = norm(name);
      if (!n) return false;
      if (count(sc, n)) return true;
      const k = KNOWN.find((x) => x.aliases.includes(n) || norm(x.name) === n);
      if (k) return k.aliases.some((a) => count(sc, a));
      const last = n.split(" ").pop()!;
      return last.length > 3 && count(sc, last) > 0;
    };
    const withQid = (name: string, kind: "person" | "place"): Entity => {
      const n = norm(name);
      const k = KNOWN.find((x) => x.kind === kind && (norm(x.name) === n || x.aliases.includes(n) || x.aliases.some((a) => a.split(" ").length > 1 && n.includes(a))));
      return { name: k?.name ?? name, qid: k?.qid, kind, mentions: 1 };
    };
    const people = r.people.filter((p) => inScript(p.name)).map((p) => withQid(p.name, "person"));
    const places = [...r.places, ...r.countries].filter(inScript).map((p) => withQid(p, "place"));
    const dedupe = (a: Entity[]) => a.filter((e, i) => a.findIndex((x) => norm(x.name) === norm(e.name)) === i);
    const H = {
      protagonista: honestHeadline(r.headline_protagonist, `${o.title} ${o.script}`) ?? local.headlines.protagonista,
      acontecimiento: honestHeadline(r.headline_event, `${o.title} ${o.script}`) ?? local.headlines.acontecimiento,
      impacto: honestHeadline(r.headline_impact, `${o.title} ${o.script}`) ?? local.headlines.impacto,
    };
    const hl = (h: string, w: string, fb: string[]) => {
      const words = upper(w || "").split(/\s+/).filter((x) => x && norm(h).includes(norm(x)));
      return words.length ? words : fb;
    };
    const p0 = dedupe(people);
    const pl0 = dedupe(places);
    const placeTag = pl0[0] ? upper(KNOWN.find((k) => k.name === pl0[0].name)?.display ?? pl0[0].name) : null;
    return {
      style: r.style === "noticias" ? "noticias" : "biblico",
      styleReason: r.style_reason.slice(0, 240),
      topic: r.topic || local.topic,
      people: p0.length ? p0.slice(0, 4) : local.people,
      places: pl0.length ? pl0.slice(0, 4) : local.places,
      event: r.event && honestHeadline(r.event, `${o.title} ${o.script}`, 7) ? { name: r.event, query: r.event_query_en, specific: true } : local.event,
      headlines: H,
      highlight: {
        protagonista: hl(H.protagonista, r.highlight_protagonist, local.highlight.protagonista),
        acontecimiento: hl(H.acontecimiento, r.highlight_event, local.highlight.acontecimiento),
        impacto: hl(H.impacto, r.highlight_impact, local.highlight.impacto),
      },
      tags: { protagonista: placeTag, acontecimiento: placeTag ?? local.tags.acontecimiento, impacto: null },
      engine: "ia",
    };
  } catch (e) {
    console.warn("Análisis de miniaturas con IA falló; se usa el análisis local:", e);
    return local;
  }
}
