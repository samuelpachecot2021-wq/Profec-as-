import { llmJson, activeProvider } from "./llm";
import { versesForText, findRefs, VERSES } from "./bible";
import { WPM } from "./options";
import { words } from "./util";

export type ScriptResult = {
  title: string;
  script: string;
  topic: string;
  sourceLang: string;
  engine: "claude" | "ollama" | "local";
  warnings: string[];
};

// ───────────────────────── Idioma ─────────────────────────

const STOP: Record<string, string[]> = {
  es: ["el", "la", "de", "que", "y", "en", "los", "se", "del", "las", "por", "un", "para", "con", "una", "es", "su", "al", "lo", "como", "más", "pero", "sus", "le", "ya", "fue"],
  en: ["the", "of", "and", "to", "in", "is", "that", "for", "it", "as", "was", "with", "be", "by", "on", "not", "he", "this", "are", "or", "his", "from", "at", "which", "but", "have"],
  pt: ["o", "a", "de", "que", "e", "do", "da", "em", "um", "para", "é", "com", "não", "uma", "os", "no", "se", "na", "por", "mais", "as", "dos", "como", "mas", "foi", "ao"],
  fr: ["le", "la", "de", "et", "les", "des", "est", "un", "une", "du", "en", "que", "qui", "dans", "pour", "pas", "sur", "au", "avec", "il", "ce", "sont"],
};

export function detectLanguage(text: string): string {
  const sample = text.slice(0, 6000);
  if ((sample.match(/[؀-ۿ]/g) || []).length > sample.length * 0.2) return "ar";
  if ((sample.match(/[֐-׿]/g) || []).length > sample.length * 0.2) return "he";
  if ((sample.match(/[Ѐ-ӿ]/g) || []).length > sample.length * 0.2) return "ru";
  const toks = sample.toLowerCase().match(/[a-záéíóúñüçãõâêôàè]+/g) || [];
  let best = "es";
  let bestScore = -1;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const score = toks.reduce((a, t) => a + (set.has(t) ? 1 : 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  // portugués y español comparten palabras: desempate por marcas propias
  if (best === "es" || best === "pt") {
    const pt = (sample.match(/ção|ções|ã|õ|\bnão\b|\bvocê\b/g) || []).length;
    const es = (sample.match(/ñ|ción|\bpero\b|\bdel\b|¿|¡/g) || []).length;
    best = pt > es ? "pt" : "es";
  }
  return best;
}

export const LANG_NAMES: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés", ar: "árabe", he: "hebreo", ru: "ruso" };

// ───────────────────────── Normas editoriales ─────────────────────────

export function applyHouseRules(text: string) {
  return text
    .replace(/\braptos?\b/gi, (m) => (m[0] === "R" ? "Arrebatamiento" : "arrebatamiento"))
    .replace(/\bRAPTO\b/g, "ARREBATAMIENTO")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ───────────────────────── Traducción ─────────────────────────

export async function translateToSpanish(text: string, projectId?: string): Promise<string> {
  const provider = await activeProvider();
  if (provider === "none")
    throw new Error("Para traducir necesita configurar Claude u Ollama en Ajustes. También puede pegar el texto ya traducido.");
  const r = await llmJson<{ translation: string }>({
    system:
      "Eres un traductor profesional. Traduce fielmente al español latinoamericano neutro, sin resumir, sin añadir ni quitar información. Conserva nombres propios, cifras y fechas. Las citas bíblicas tradúcelas usando el texto de la Reina-Valera 1960 cuando las reconozcas con certeza. Usa 'arrebatamiento' en lugar de 'rapto'.",
    prompt: `Traduce el siguiente texto al español:\n\n<texto>\n${text}\n</texto>`,
    schema: { type: "object", properties: { translation: { type: "string" } }, required: ["translation"], additionalProperties: false },
    maxTokens: 64000,
    projectId,
    expectedOutputChars: text.length * 1.1,
    purpose: "traducción",
  });
  return r.translation.replace(/\braptos?\b/gi, "arrebatamiento");
}

export async function translateLines(lines: string[], target: "en", projectId?: string): Promise<string[]> {
  const r = await llmJson<{ lines: string[] }>({
    system: "Translate each Spanish subtitle line into natural English. Keep the same number of lines, in the same order. Use 'rapture' for 'arrebatamiento'. Use KJV wording for Bible quotes when certain.",
    prompt: JSON.stringify({ target, lines }),
    schema: {
      type: "object",
      properties: { lines: { type: "array", items: { type: "string" } } },
      required: ["lines"],
      additionalProperties: false,
    },
    maxTokens: 64000,
    projectId,
    expectedOutputChars: lines.join(" ").length,
    purpose: "subtítulos en inglés",
  });
  if (r.lines.length !== lines.length) throw new Error("La traducción de subtítulos no coincide en número de líneas");
  return r.lines;
}

// ───────────────────────── Generación con IA ─────────────────────────

const SYSTEM_PROMPT = `Eres guionista sénior de documentales cristianos sobre profecía bíblica para YouTube, con dominio de retención de audiencia y de la Biblia Reina-Valera 1960.

Transforma el material del usuario en un GUION DE NARRACIÓN en español latinoamericano neutro, para voz en off masculina grave de estilo documental cinematográfico.

REGLAS OBLIGATORIAS:
1. Fidelidad: respeta los acontecimientos, personajes, cifras, referencias bíblicas y el mensaje central del material. NO inventes noticias, declaraciones, fechas, cifras, citas ni fuentes. Si algo no está en el material, no lo afirmes.
2. Distingue claramente los HECHOS informados por el material ("según el artículo…", "se informó que…") de la INTERPRETACIÓN profética ("desde una perspectiva profética…", "muchos estudiosos de la Biblia ven aquí…"). Nunca presentes una interpretación como hecho, ni fijes fechas para el regreso de Cristo (Mateo 24:36).
3. Citas bíblicas: solo Reina-Valera 1960, textuales y con referencia ("Apocalipsis 13:16 dice: …"). Cita únicamente versículos que conoces con total certeza palabra por palabra; si no estás seguro del texto exacto, menciona solo la referencia sin citar.
4. Usa siempre la palabra "arrebatamiento", nunca "rapto".
5. Estructura para retención: (a) gancho impactante en las primeras 2 frases (máx. 5 segundos de lectura); (b) preguntas que despierten curiosidad; (c) suspenso y bucles abiertos que se resuelven más adelante; (d) transiciones naturales; (e) explicación bíblica y profética; (f) cierre evangelístico centrado en Jesucristo: invitación clara, respetuosa y esperanzadora a recibirle como Señor y Salvador.
6. Ritmo de narración: frases cortas y medianas, pausas naturales mediante puntos suspensivos "..." donde la voz deba respirar o crear tensión. Nada de títulos, viñetas, acotaciones, emojis, ni indicaciones de cámara: solo el texto que se leerá.
7. Escribe TODO el guion en UN SOLO PÁRRAFO continuo.
8. Longitud: ajústate al número de palabras pedido (±10 %). Si el material no da para tanto sin inventar, escribe menos y explícalo en "warnings"; jamás rellenes con datos inventados.
9. El tono es serio, reverente y esperanzador; sin sensacionalismo engañoso ni miedo gratuito.`;

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Título de trabajo, corto" },
    topic: { type: "string", description: "Temática principal (ej. 'La marca de la bestia')" },
    script: { type: "string", description: "Guion completo en un solo párrafo" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "topic", "script", "warnings"],
  additionalProperties: false,
};

export async function generateScript(input: string, durationSec: number, projectId?: string, isTranscript = false): Promise<ScriptResult> {
  const sourceLang = detectLanguage(input);
  const targetWords = Math.max(30, Math.round((durationSec / 60) * WPM));
  const provider = await activeProvider();

  if (provider !== "none") {
    const r = await llmJson<{ title: string; topic: string; script: string; warnings: string[] }>({
      system: SYSTEM_PROMPT,
      prompt: `Material de origen (${isTranscript ? "transcripción de video" : "artículo"}, idioma detectado: ${LANG_NAMES[sourceLang] ?? sourceLang}). Si no está en español, tradúcelo al escribir el guion.

<material>
${input}
</material>

Escribe el guion para un video de ${formatDur(durationSec)}: aproximadamente ${targetWords} palabras.`,
      schema: SCRIPT_SCHEMA,
      maxTokens: Math.min(64000, 6000 + targetWords * 4),
      projectId,
      expectedOutputChars: targetWords * 6.5,
      purpose: "guion",
    });
    return {
      title: r.title.trim(),
      topic: r.topic.trim(),
      script: applyHouseRules(r.script),
      sourceLang,
      engine: provider,
      warnings: r.warnings ?? [],
    };
  }
  return localScript(input, durationSec, sourceLang);
}

function formatDur(s: number) {
  return s < 60 ? `${s} segundos` : `${Math.round((s / 60) * 10) / 10} minutos`;
}

// ───────────────────────── Generador local (sin IA) ─────────────────────────

const TOPIC_RULES: { topic: string; keys: string[]; hook: string; question: string }[] = [
  { topic: "La marca de la bestia", keys: ["marca", "bestia", "dinero digital", "moneda digital", "cbdc", "chip", "biométric", "identidad digital", "efectivo"], hook: "¿Y si el sistema que hoy se presenta como progreso... fuera exactamente lo que la Biblia describió hace casi dos mil años?", question: "¿Estamos viendo los cimientos de un control económico global?" },
  { topic: "La inteligencia artificial", keys: ["inteligencia artificial", " ia ", "algoritmo", "robot", "chatgpt", "automatización"], hook: "Una tecnología avanza más rápido que nuestra capacidad de comprenderla... y la Biblia ya advirtió que en el tiempo del fin la ciencia se aumentaría.", question: "¿Qué papel podría tener la tecnología en los acontecimientos finales?" },
  { topic: "Israel y Jerusalén", keys: ["israel", "jerusalén", "gaza", "tercer templo", "templo", "monte del templo"], hook: "Todas las miradas del mundo vuelven a posarse sobre un mismo lugar... Jerusalén.", question: "¿Por qué una pequeña franja de tierra sigue en el centro de la historia?" },
  { topic: "Guerras y conflictos", keys: ["guerra", "misil", "ataque", "ejército", "nuclear", "conflicto", "bombardeo", "irán", "rusia"], hook: "Guerras y rumores de guerras... las palabras de Jesús resuenan hoy con una fuerza inquietante.", question: "¿Qué significan estos conflictos a la luz de la profecía?" },
  { topic: "Persecución de los cristianos", keys: ["persecución", "cristianos asesinados", "iglesia quemada", "mártir", "perseguidos"], hook: "En este preciso momento... miles de cristianos están pagando un alto precio por su fe.", question: "¿Qué dijo Jesús sobre los tiempos de persecución?" },
  { topic: "El anticristo", keys: ["anticristo", "hombre de pecado", "líder mundial", "gobierno mundial"], hook: "La Biblia describe a un líder que engañará al mundo entero... y hoy muchos se preguntan si el escenario ya se está preparando.", question: "¿Quién es el anticristo según las Escrituras?" },
  { topic: "El arrebatamiento de la Iglesia", keys: ["arrebatamiento", "rapto"], hook: "Un instante... un abrir y cerrar de ojos... y todo cambiará para siempre.", question: "¿Está la Iglesia preparada para el arrebatamiento?" },
  { topic: "Los últimos tiempos", keys: [], hook: "Lo que está ocurriendo en el mundo no es casualidad... y la Biblia lo anunció con siglos de anticipación.", question: "¿Estamos viviendo los últimos tiempos?" },
];

const TRANSITIONS = [
  "Pero eso no es todo...",
  "Y aquí es donde la historia se vuelve aún más inquietante...",
  "Ahora bien... ¿qué dice la Biblia sobre esto?",
  "Detengámonos un momento en este detalle...",
  "Y esto nos lleva a una pregunta importante...",
  "Presta mucha atención a lo que sigue...",
];

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“0-9])/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 4);
}

function localScript(input: string, durationSec: number, sourceLang: string): ScriptResult {
  const warnings: string[] = [
    "Guion creado con el modo LOCAL (sin inteligencia artificial). Es un borrador ordenado a partir del artículo: revíselo y edítelo antes de producir. Para guiones profesionales configure Claude u Ollama en Ajustes.",
  ];
  if (sourceLang !== "es")
    warnings.push(`El texto parece estar en ${LANG_NAMES[sourceLang] ?? sourceLang}. El modo local no traduce: configure Claude u Ollama, o pegue el texto en español.`);

  const lower = ` ${input.toLowerCase()} `;
  const rule = TOPIC_RULES.find((r) => r.keys.some((k) => lower.includes(k))) ?? TOPIC_RULES[TOPIC_RULES.length - 1];
  const target = Math.max(30, Math.round((durationSec / 60) * WPM));

  // Selección de frases: prioriza las que contienen cifras, nombres propios y términos del tema.
  const sentences = splitSentences(input);
  const scored = sentences.map((s, i) => {
    let score = 0;
    if (/\d/.test(s)) score += 2;
    score += (s.match(/\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/g) || []).length * 0.5;
    score += rule.keys.reduce((a, k) => a + (s.toLowerCase().includes(k) ? 2 : 0), 0);
    if (i < 3) score += 3; // la entradilla suele contener lo esencial
    return { s, i, score };
  });

  const short = durationSec <= 60;
  const verses = versesForText(input, short ? 6 : durationSec <= 300 ? 2 : 4).filter((v) => !short || words(v.text).length <= 30);
  const refsInText = findRefs(input);
  const known = refsInText.map((r) => VERSES.find((v) => v.ref === r)).filter(Boolean) as typeof VERSES;
  const pool = [...known, ...verses.filter((v) => !known.includes(v))].filter((v) => !short || words(v.text).length <= 30);
  const allVerses = durationSec <= 20 ? [] : pool.slice(0, Math.max(1, Math.round(durationSec / 150)));

  const closing =
    "Pero esta historia no termina en el miedo... termina en la esperanza. Jesucristo murió por nuestros pecados y resucitó al tercer día, y hoy te extiende su mano. Romanos 10:9 dice: que si confesares con tu boca que Jesús es el Señor, y creyeres en tu corazón que Dios le levantó de los muertos, serás salvo. No esperes a mañana... entrégale tu vida hoy. Si este mensaje habló a tu corazón, compártelo, y nos vemos en el próximo video. Dios te bendiga.";
  const shortClosing = "Las señales están ahí... pero la esperanza está en Jesucristo. Búscalo hoy.";

  const intro = durationSec <= 30 ? rule.hook : `${rule.hook} ${rule.question}`;
  const fixedWords = words(intro).length + words(durationSec <= 60 ? shortClosing : closing).length + allVerses.reduce((a, v) => a + words(v.text).length + 4, 0);
  const budget = Math.max(15, target - fixedWords - 30);

  // Toma las mejores frases hasta cubrir el presupuesto y las devuelve en su orden original.
  const chosen: typeof scored = [];
  let count = 0;
  for (const it of [...scored].sort((a, b) => b.score - a.score)) {
    if (count >= budget) break;
    chosen.push(it);
    count += words(it.s).length;
  }
  chosen.sort((a, b) => a.i - b.i);
  if (count < budget * 0.6 && durationSec > 60)
    warnings.push("El artículo es más corto que la duración elegida. El video durará menos para no inventar contenido.");

  const parts: string[] = [intro];
  if (durationSec > 30) parts.push("Según la información publicada...");
  const verseSlots = new Set(allVerses.map((_, k) => Math.floor(((k + 1) * chosen.length) / (allVerses.length + 1))));
  let v = 0;
  chosen.forEach((c, k) => {
    parts.push(c.s.replace(/\.$/, "..."));
    if (verseSlots.has(k + 1) && v < allVerses.length) {
      const verse = allVerses[v++];
      parts.push(`${TRANSITIONS[(k + v) % TRANSITIONS.length]} Desde una perspectiva profética, ${verse.ref} dice: ${verse.text}`);
    } else if (k > 0 && k % 5 === 0 && durationSec > 120) {
      parts.push(TRANSITIONS[k % TRANSITIONS.length]);
    }
  });
  while (v < allVerses.length) {
    const verse = allVerses[v++];
    parts.push(`${verse.ref} dice: ${verse.text}`);
  }
  if (durationSec > 60) parts.push("Muchos estudiosos de la Biblia ven en acontecimientos como este una señal de que los tiempos anunciados se acercan... aunque del día y la hora nadie sabe.");
  parts.push(durationSec <= 60 ? shortClosing : closing);

  const firstReal = sentences.find((x) => x !== x.toUpperCase() && words(x).length >= 6) ?? sentences[0];
  const title = cutWords(firstReal?.split(/[,:;]/)[0] ?? "", 70) || rule.topic;
  return { title, topic: rule.topic, script: applyHouseRules(parts.join(" ")), sourceLang, engine: "local", warnings };
}

export function cutWords(s: string, max: number) {
  if (s.length <= max) return s.trim();
  return s.slice(0, max).replace(/\s+\S*$/, "").trim();
}
