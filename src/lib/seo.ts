import { activeProvider, llmJson } from "./llm";
import { fmtTime, words } from "./util";

export type Seo = {
  titles: { upper: string; sentence: string }[];
  thumbnailTitles: string[];
  description: string;
  hashtags: string[];
  keywords: string[];
  chapters: { time: number; title: string }[];
  facebookPost: string;
  engine: string;
};

const sentenceCase = (s: string) => {
  const l = s.toLocaleLowerCase("es");
  return l.charAt(0).toLocaleUpperCase("es") + l.slice(1);
};

export function chaptersText(ch: Seo["chapters"]) {
  return ch.map((c) => `${fmtTime(c.time)} ${c.title}`).join("\n");
}

/** Arma la descripción final con capítulos y créditos de los recursos. */
export function fullDescription(seo: Seo, credits: string[]) {
  const parts = [seo.description.trim()];
  if (seo.chapters.length >= 3) parts.push(`📌 CAPÍTULOS\n${chaptersText(seo.chapters)}`);
  parts.push(seo.hashtags.join(" "));
  if (credits.length) parts.push(`🎞️ CRÉDITOS DE IMÁGENES Y VIDEOS\n${credits.join("\n")}`);
  parts.push("Citas bíblicas: Reina-Valera 1960 © Sociedades Bíblicas en América Latina, 1960. Renovado © Sociedades Bíblicas Unidas, 1988. Usado con permiso.");
  return parts.join("\n\n");
}

export async function generateSeo(opts: {
  projectId: string;
  title: string;
  topic: string;
  script: string;
  scenes: { text: string; start: number }[];
  duration: number;
}): Promise<Seo> {
  const sections = makeSections(opts.scenes, opts.duration);
  if ((await activeProvider()) !== "none") {
    try {
      const r = await llmJson<{
        titles: string[];
        thumbnail_titles: string[];
        description: string;
        hashtags: string[];
        keywords: string[];
        chapter_titles: string[];
        facebook_post: string;
      }>({
        system: `Eres experto en posicionamiento de YouTube para canales cristianos de profecía bíblica, en español latinoamericano.
Reglas: los títulos deben ser atractivos pero HONESTOS: nada que no esté respaldado por el guion, sin fechas inventadas ni afirmaciones absolutas sobre el cumplimiento de profecías, sin clickbait engañoso. Usa "arrebatamiento", nunca "rapto". Títulos de YouTube ≤ 70 caracteres. Títulos de miniatura: 2 a 5 palabras, impactantes. Descripción: 150–300 palabras, primeras 2 líneas con las palabras clave principales, resumen fiel, llamada a suscribirse y a compartir, sin enlaces inventados. Exactamente 3 hashtags. 10–15 palabras clave. Para cada sección del video da un título de capítulo de 2–6 palabras. Publicación de Facebook: 60–120 palabras, cálida, con 1–3 emojis y una pregunta para generar comentarios.`,
        prompt: JSON.stringify({ titulo_trabajo: opts.title, tema: opts.topic, guion: opts.script, secciones: sections.map((s) => s.preview) }),
        schema: {
          type: "object",
          properties: {
            titles: { type: "array", items: { type: "string" } },
            thumbnail_titles: { type: "array", items: { type: "string" } },
            description: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            chapter_titles: { type: "array", items: { type: "string" } },
            facebook_post: { type: "string" },
          },
          required: ["titles", "thumbnail_titles", "description", "hashtags", "keywords", "chapter_titles", "facebook_post"],
          additionalProperties: false,
        },
        maxTokens: 16000,
        projectId: opts.projectId,
        expectedOutputChars: 4000,
        purpose: "SEO YouTube",
      });
      return {
        titles: r.titles.slice(0, 5).map((t) => ({ upper: t.toLocaleUpperCase("es"), sentence: sentenceCase(t) })),
        thumbnailTitles: r.thumbnail_titles.slice(0, 3).map((t) => t.toLocaleUpperCase("es")),
        description: r.description,
        hashtags: r.hashtags.slice(0, 3).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
        keywords: r.keywords,
        chapters: sections.map((s, i) => ({ time: s.time, title: r.chapter_titles[i] ?? s.fallback })),
        facebookPost: r.facebook_post,
        engine: "ia",
      };
    } catch (e) {
      console.warn("SEO con IA falló, se usa el modo local:", e);
    }
  }
  return localSeo(opts, sections);
}

function makeSections(scenes: { text: string; start: number }[], duration: number) {
  if (duration < 75 || scenes.length < 4) return [];
  const n = Math.min(8, Math.max(3, Math.round(duration / 75)));
  const out: { time: number; preview: string; fallback: string }[] = [];
  for (let k = 0; k < n; k++) {
    const i = Math.floor((k * scenes.length) / n);
    const s = scenes[i];
    const time = k === 0 ? 0 : Math.round(s.start);
    if (k > 0 && time - out[out.length - 1].time < 12) continue;
    out.push({ time, preview: scenes.slice(i, i + 3).map((x) => x.text).join(" ").slice(0, 300), fallback: k === 0 ? "Introducción" : words(s.text).slice(0, 5).join(" ").replace(/[.,;:…]+$/, "") });
  }
  if (out.length) out[out.length - 1].fallback = out.length > 2 ? "Reflexión final y esperanza en Cristo" : out[out.length - 1].fallback;
  return out;
}

function localSeo(opts: { title: string; topic: string; script: string }, sections: ReturnType<typeof makeSections>): Seo {
  const topic = opts.topic || "Profecía bíblica";
  const base = opts.title.replace(/[.…]+$/, "").split(/\s+/).slice(0, 9).join(" ");
  const titles = [
    `${topic}: lo que la Biblia dice sobre ${base.toLowerCase()}`,
    `${base} — ¿una señal de los últimos tiempos?`,
    `Esto está ocurriendo ahora... y la Biblia lo anunció`,
    `${topic} explicado a la luz de la profecía bíblica`,
    `¿Qué significa ${base.toLowerCase()} para los cristianos?`,
  ].map((t) => (t.length > 95 ? t.slice(0, 95).replace(/\s+\S*$/, "") : t));
  const first = opts.script.split(/(?<=[.!?…])\s+/).slice(0, 4).join(" ");
  const tag = topic.replace(/\s+/g, "").replace(/^(La|El|Los|Las)/, "");
  return {
    titles: titles.map((t) => ({ upper: t.toLocaleUpperCase("es"), sentence: sentenceCase(t) })),
    thumbnailTitles: [topic.toLocaleUpperCase("es"), "¿SEÑAL DEL FIN?", "LA BIBLIA LO ANUNCIÓ"],
    description: `${base}. ${topic} y profecía bíblica explicados con la Palabra de Dios (Reina-Valera 1960).\n\n${first}\n\nEn este video analizamos los hechos informados y los comparamos con lo que enseñan las Escrituras, distinguiendo siempre entre los acontecimientos y su interpretación profética.\n\n🙏 Si este mensaje fue de bendición, suscríbete, activa la campanita y compártelo con alguien que lo necesite.`,
    hashtags: ["#ProfecíaBíblica", `#${tag || "ÚltimosTiempos"}`, "#Jesucristo"],
    keywords: [topic, "profecía bíblica", "últimos tiempos", "apocalipsis", "señales del fin", "Biblia", "Jesucristo", "segunda venida", "arrebatamiento", "noticias y profecía"],
    chapters: sections.map((s) => ({ time: s.time, title: s.fallback })),
    facebookPost: `🔥 ${base}\n\n¿Estamos viendo el cumplimiento de lo que anunciaron las Escrituras? En nuestro nuevo video analizamos los hechos a la luz de la Palabra de Dios... y terminamos con un mensaje de esperanza en Jesucristo. 🙏\n\nMíralo completo y cuéntanos en los comentarios: ¿qué opinas de lo que está ocurriendo?`,
    engine: "local",
  };
}
