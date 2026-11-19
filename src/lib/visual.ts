/**
 * Inteligencia visual: términos de búsqueda en inglés según el contexto bíblico/profético,
 * filtro de contenido inapropiado y puntuación de realismo cinematográfico.
 */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ───────────── Diccionario temático (de lo más específico a lo más general) ─────────────
// Cada entrada: patrón en español → búsquedas en inglés de metraje REAL y documental.
export const VISUAL_MAP: [RegExp, string[]][] = [
  [/muro de los lamentos|muro occidental/i, ["western wall jerusalem prayer", "jerusalem old city stone wall"]],
  [/monte del templo|explanada de las mezquitas|c[uú]pula de la roca/i, ["temple mount jerusalem aerial", "dome of the rock jerusalem"]],
  [/tercer templo|reconstrucci[oó]n del templo|sacrificio|levitas?|vaca roja/i, ["temple mount jerusalem aerial", "ancient temple ruins stone columns", "jerusalem old city sunrise"]],
  [/jerusal[eé]n/i, ["jerusalem old city aerial", "jerusalem skyline sunset", "jerusalem old city streets"]],
  [/israel|israel[ií]|tel aviv/i, ["israel landscape aerial", "israeli flag waving", "jerusalem skyline"]],
  [/gaza|hamas|hezbol|l[ií]bano/i, ["middle east city smoke aerial", "war damaged buildings middle east"]],
  [/ir[aá]n|teher[aá]n/i, ["tehran city skyline", "middle east desert military"]],
  [/rusia|kremlin|mosc[uú]|putin/i, ["moscow kremlin red square", "russian military parade"]],
  [/ucrania|kiev/i, ["ukraine war destroyed buildings", "soldiers trench war"]],
  [/china|pek[ií]n|taiw[aá]n/i, ["beijing city skyline night", "chinese military parade"]],
  [/babilonia|irak|bagdad/i, ["ancient babylon ruins", "mesopotamia desert ruins"]],
  [/egipto|fara[oó]n|nilo/i, ["egypt pyramids aerial", "nile river egypt"]],
  [/roma\b|vaticano|imperio romano/i, ["vatican st peters basilica", "roman colosseum ruins"]],
  [/misil|cohete|bombardeo|ataque a[eé]reo|dron(es)? (de )?ataque/i, ["missile launch night", "air defense interception night sky", "explosion smoke city"]],
  [/nuclear|at[oó]mic|radiaci[oó]n/i, ["nuclear power plant cooling tower", "mushroom cloud explosion archive", "radiation warning sign"]],
  [/guerra|ej[eé]rcito|soldado|militar|tanques?|conflicto armado|batalla/i, ["military convoy desert", "soldiers silhouette sunset", "army tanks moving"]],
  [/rumores de guerra|naciones? contra naci[oó]n|tensi[oó]n mundial/i, ["world map dark dramatic", "military jets formation", "storm clouds over city"]],
  [/dinero digital|moneda digital|cbdc|euro digital|d[oó]lar digital/i, ["contactless payment phone close up", "digital banking smartphone", "credit card payment terminal"]],
  [/criptomoneda|bitcoin|blockchain/i, ["bitcoin coin close up", "cryptocurrency trading screen"]],
  [/efectivo|billetes?|monedas|sistema financiero|bancos? central|econom[ií]a|inflaci[oó]n/i, ["cash money counting close up", "stock market trading screen", "bank building facade"]],
  [/comprar ni vender|comprar o vender|compras?|vender|mercado/i, ["shopping market crowd", "supermarket checkout payment", "payment terminal card"]],
  [/chip|implante|microchip/i, ["microchip implant hand", "rfid chip close up"]],
  [/biom[eé]tric|huella|reconocimiento facial|escaneo de (la )?(mano|palma|iris)|identidad digital/i, ["facial recognition camera", "palm scanner payment", "fingerprint scanner close up"]],
  [/marca de la bestia|la marca|mano derecha|en la frente|666|n[uú]mero de su nombre/i, ["hand scanner close up", "palm scanner payment", "barcode scanner light"]],
  [/bestia/i, ["storm clouds dark sky", "dark ocean waves storm"]],
  [/inteligencia artificial|\bia\b|algoritmo|chatgpt|robots?/i, ["data center server room", "robot arm factory", "person using computer dark room"]],
  [/vigilancia|c[aá]maras?|control total|rastreo|espionaje/i, ["surveillance camera city", "cctv cameras street", "crowd surveillance city"]],
  [/tecnolog[ií]a|internet|digital|celular|tel[eé]fono/i, ["smartphone screen close up dark", "people using smartphones street"]],
  [/anticristo|hombre de pecado|l[ií]der mundial|gobierno mundial|nuevo orden/i, ["man silhouette speech podium", "world leaders summit flags", "crowd cheering rally"]],
  [/falso profeta|enga[ñn]o|falsos? cristos?|se[ñn]ales y prodigios/i, ["crowd stadium night lights", "dark cathedral interior", "fog silhouette man"]],
  [/onu|naciones unidas|cumbre|l[ií]deres|foro econ[oó]mico/i, ["united nations assembly hall", "flags of nations waving", "conference hall leaders"]],
  [/gobierno|presidente|ley|parlamento|congreso/i, ["government building columns", "parliament building exterior"]],
  [/arrebatamiento|arrebatados|en las nubes|recibir al se[ñn]or en el aire/i, ["light rays through clouds", "heaven light clouds sky", "sun breaking through clouds"]],
  [/trompeta|shofar/i, ["shofar horn blowing", "light rays through clouds"]],
  [/segunda venida|vendr[aá] (otra vez|con las nubes)|todo ojo le ver[aá]|regreso de (cristo|jes[uú]s)/i, ["sunrise through clouds heaven", "dramatic sky light rays", "clouds timelapse golden light"]],
  [/gran tribulaci[oó]n|tribulaci[oó]n|juicio|ira de dios|copas|sellos/i, ["lightning storm night", "dark storm clouds timelapse", "volcano eruption"]],
  [/apocalipsis|fin del mundo|fin de los tiempos|[uú]ltimos tiempos|postreros d[ií]as/i, ["dark storm clouds timelapse", "lightning storm night", "dramatic sky sunset"]],
  [/terremotos?|sismo/i, ["earthquake rubble collapsed building", "earthquake damage street"]],
  [/hambre|sequ[ií]a|escasez/i, ["drought cracked earth", "empty supermarket shelves"]],
  [/pestes?|pandemia|virus|enfermedad/i, ["hospital corridor masks", "virus microscope"]],
  [/inundaci[oó]n|tsunami|hurac[aá]n|desastre/i, ["flood disaster aerial", "hurricane storm waves"]],
  [/persecuci[oó]n|m[aá]rtir|perseguidos|cristianos asesinados|iglesias? quemada/i, ["burned church ruins", "candle vigil night", "christians praying secret"]],
  [/apostas[ií]a|iglesia vac[ií]a|abandonan la fe/i, ["empty church pews", "abandoned church interior"]],
  [/iglesia|congregaci[oó]n|creyentes|hermanos en la fe/i, ["church worship hands raised", "church interior candles"]],
  [/daniel|ezequiel|isa[ií]as|profetas? del antiguo|escrituras antiguas|rollos?/i, ["ancient scroll candlelight", "old bible pages close up", "ancient manuscript"]],
  [/biblia|escritura|vers[ií]culo|palabra de dios|est[aá] escrito/i, ["old bible pages close up", "open bible candlelight", "hands holding bible"]],
  [/profec[ií]a|profeta|profetiz/i, ["ancient scroll candlelight", "old bible pages close up", "dramatic sky light rays"]],
  [/oraci[oó]n|orar|ora\b|clamar/i, ["praying hands close up", "person praying silhouette sunset"]],
  [/cruz|calvario|crucific|sangre de cristo/i, ["cross silhouette sunset", "wooden cross hill sunrise"]],
  [/resurrecci[oó]n|tumba vac[ií]a|resucit/i, ["empty tomb stone sunrise", "sunrise light rays"]],
  [/salvaci[oó]n|salvo|vida eterna|arrepiente|entr[eé]gale tu vida|recibe a jes[uú]s/i, ["cross silhouette sunrise", "person arms raised sunrise mountain", "light rays forest"]],
  [/jes[uú]s|cristo|se[ñn]or|salvador|redenci[oó]n/i, ["cross silhouette sunset", "light rays through clouds", "sunrise hope"]],
  [/esperanza|paz|amor de dios|consuelo/i, ["sunrise over mountains", "golden field sunrise", "light rays forest"]],
  [/miedo|temor|oscuridad|incertidumbre/i, ["dark forest fog", "lonely man silhouette fog", "storm clouds dark"]],
  [/multitud|personas|gente|humanidad|mundo entero|naciones/i, ["crowd city street aerial", "busy city crowd timelapse", "earth from space night"]],
  [/tierra|planeta|global|mundial/i, ["earth from space", "world map dark"]],
  [/cielo|estrellas|universo|luna|sol|se[ñn]ales en el cielo|eclipse/i, ["night sky stars timelapse", "solar eclipse", "blood moon"]],
  [/desierto|antiguo|historia|siglos/i, ["desert ancient ruins", "ancient ruins sunset"]],
];

const FALLBACK_HOPE = ["sunrise through clouds", "light rays forest", "golden sky clouds timelapse"];
const FALLBACK_DARK = ["dark storm clouds timelapse", "lightning storm night", "fog dark forest"];
const FALLBACK_NEUTRAL = ["dramatic sky clouds timelapse", "city aerial dusk", "old bible pages close up"];

const HOPE_RE = /esperanza|salv|cristo|jes[uú]s|vida eterna|amor|paz|redenci|cielo|gloria/i;
const DARK_RE = /guerra|muerte|juicio|tribulaci|bestia|anticristo|miedo|destrucci|control|persecu|terremoto|hambre/i;

export const TECH_RE = /tecnolog|inteligencia artificial|\bia\b|algoritmo|digital|chip|biom[eé]tric|internet|datos|cripto|bitcoin|computador|robot|vigilancia|c[aá]mara|identidad|implante/i;

/** Términos de búsqueda por escena según su texto y el contexto (escenas vecinas y tema). */
export function heuristicQueries(text: string, ctx: { prev?: string; next?: string; topic?: string } = {}): string[] {
  const out: string[] = [];
  const push = (q: string[]) => q.forEach((x) => !out.includes(x) && out.push(x));
  // 1) lo que dice la propia escena (todas las coincidencias, en orden de especificidad)
  for (const [re, qs] of VISUAL_MAP) if (re.test(text)) push(qs.slice(0, 2));
  // 2) contexto: frases vecinas y tema del video
  const context = `${ctx.prev ?? ""} ${ctx.next ?? ""} ${ctx.topic ?? ""}`;
  if (out.length < 3) for (const [re, qs] of VISUAL_MAP) if (re.test(context)) push(qs.slice(0, 1));
  // 3) atmósfera según el tono
  const mood = HOPE_RE.test(text) ? FALLBACK_HOPE : DARK_RE.test(text) ? FALLBACK_DARK : FALLBACK_NEUTRAL;
  push(mood);
  return out.slice(0, 5);
}

// ───────────── Filtro de contenido ─────────────

/** Nunca apropiado para un documental profético. */
const ALWAYS_BLOCK =
  /\b(christmas|xmas|santa|ornaments?|baubles?|tinsel|reindeer|snowman|gift ?box|presents|halloween|pumpkins?|jack o|skulls?|skeletons?|cartoons?|animated|animations?|anime|illustrations?|clip ?art|vector|3d render|rendering|cgi|toys?|lego|emoji|meme|funny|party|birthday|wedding|bride|selfie|fashion|bikini|cocktails?|nightclub|disco|logo|mascot|cute|kitten|puppy|pets?|unicorn|fantasy|zombie|monster|horror|demon|witch|occult|pentagram|tarot|easter egg|valentine)\b/i;

/** Gráficos tecnológicos: solo si la escena trata de tecnología. */
const TECH_BLOCK = /\b(hologram|holographic|futuristic|hud|interface|user interface|motion graphics?|circuit board|binary|matrix|code|coding|digital art|plexus|particles?|abstract|neon|cyber|cyberpunk|glitch|loop(able)?|background loop|visuali[sz]ation|infographic|network lines|data stream)\b/i;

const CINEMATIC = /\b(aerial|drone|cinematic|slow motion|dramatic|silhouette|sunset|sunrise|golden hour|storm|lightning|fog|mist|documentary|ancient|old city|close ?up|light rays|clouds|timelapse|time lapse|night|candle|desert|ruins|crowd|landscape|skyline)\b/i;

export type Scorable = { kind: "video" | "image"; meta?: string; width?: number; height?: number; provider: string };

/**
 * Puntúa un recurso para una escena. Devuelve null si debe descartarse
 * (contenido inapropiado o gráficos tecnológicos fuera de lugar).
 */
export function scoreCandidate(c: Scorable, o: { query: string; sceneText: string; preferVideo: boolean; w: number; h: number; impact?: boolean }): number | null {
  const meta = norm(c.meta ?? "");
  if (meta && ALWAYS_BLOCK.test(meta)) return null;
  if (meta && TECH_BLOCK.test(meta) && !TECH_RE.test(o.sceneText)) return null;
  let s = 0;
  // relevancia: palabras de la búsqueda presentes en la descripción del recurso
  const terms = norm(o.query).split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hits = terms.filter((t) => meta.includes(t)).length;
  if (meta) {
    if (terms.length && hits === 0) s -= 8; // nada que ver con lo buscado: se descarta
    s += hits * 3 + (hits === terms.length ? 2 : 0);
  }
  if (c.provider === "biblioteca") s += 6;
  if (c.kind === "video") s += o.preferVideo ? 4 : 1;
  if (CINEMATIC.test(meta)) s += o.impact ? 4 : 2;
  if (o.impact && c.kind === "video") s += 3;
  // resolución suficiente para el formato (sin ampliar en exceso)
  if (c.width && c.height) {
    const coverScale = Math.max(o.w / c.width, o.h / c.height);
    if (coverScale <= 1) s += 2;
    else if (coverScale > 2) s -= 3;
    const portraitOut = o.h > o.w;
    if (portraitOut === c.height > c.width) s += 1;
  }
  return s;
}

/** Puntuación mínima para aceptar un recurso (si no, se prueba la siguiente búsqueda). */
export const MIN_SCORE = 2;
