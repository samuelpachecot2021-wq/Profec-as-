/**
 * Inteligencia visual bíblica: convierte el significado de cada fragmento del guion en
 * instrucciones visuales coherentes, de estilo hiperrealista y documental.
 */

type Theme = { id: string; re: RegExp; scene: string; motion: string; recreation: boolean; importance: number };

/** Del más específico al más general. `recreation`: escena simbólica/bíblica (se rotula como recreación artística). */
export const THEMES: Theme[] = [
  { id: "segunda_venida", re: /segunda venida|vendr[aá] (otra vez|con las nubes)|todo ojo le ver[aá]|regreso de (cristo|jes[uú]s)|viene con las nubes/i, scene: "majestic heavenly sky opening above the earth, brilliant golden light breaking through towering storm clouds, a radiant figure in white robes seen from far behind among the clouds, face not visible, people on the ground looking up in awe", motion: "slow upward camera tilt, clouds parting, light rays intensifying", recreation: true, importance: 6 },
  { id: "arrebatamiento", re: /arrebatamiento|arrebatados|recibir al se[ñn]or en el aire|trompeta de dios/i, scene: "beams of heavenly light descending through clouds over a quiet modern town at dawn, empty street, sense of sudden absence, cinematic awe", motion: "slow push in, light beams pulsing, clouds drifting", recreation: true, importance: 6 },
  { id: "apocalipsis", re: /apocalipsis|sellos|copas|jinetes|bestia que sub[ií]a|drag[oó]n|gran ramera|babilonia la grande|ira de dios|juicio final/i, scene: "symbolic apocalyptic vision, dark crimson sky over an ancient landscape, distant lightning storms, four horsemen silhouettes on a ridge, epic biblical atmosphere", motion: "slow dolly forward, lightning flashes, dust blowing", recreation: true, importance: 5 },
  { id: "daniel", re: /daniel|nabucodonosor|babilonia|medo|persa|reinos?|imperios?|estatua de oro|cuatro bestias/i, scene: "ancient Babylonian kingdom recreated with historical accuracy, massive ziggurat and city walls at golden hour, torches, royal processions, historical epic", motion: "slow aerial crane shot over the ancient city, torches flickering", recreation: true, importance: 4 },
  { id: "templo", re: /tercer templo|templo|monte del templo|sacrificio|vaca roja/i, scene: "Jerusalem Temple Mount at sunrise, historically accurate architecture, stone courtyards, soft haze", motion: "slow aerial orbit, morning haze drifting", recreation: false, importance: 4 },
  { id: "israel", re: /israel|jerusal[eé]n|si[oó]n|judea|galilea|monte de los olivos/i, scene: "Jerusalem old city skyline with ancient stone walls and golden domes at golden hour, geographically accurate, documentary aerial view", motion: "slow drone flyover, warm light shifting", recreation: false, importance: 3 },
  { id: "marca", re: /marca de la bestia|la marca|mano derecha|en la frente|666|comprar ni vender|chip|biom[eé]tric|identidad digital/i, scene: "close-up of a human hand held over a glowing palm scanner at a modern payment terminal, dim cinematic lighting, sense of surveillance", motion: "slow push in on the hand, scanner light sweeping", recreation: false, importance: 4 },
  { id: "dinero", re: /dinero digital|moneda digital|cbdc|efectivo|bancos?|econom[ií]a|pagos?/i, scene: "modern city financial district at dusk, people paying with smartphones, cinematic shallow depth of field", motion: "slow lateral tracking shot, city lights flickering on", recreation: false, importance: 2 },
  { id: "ia", re: /inteligencia artificial|\bia\b|algoritmo|robots?|vigilancia|c[aá]maras?/i, scene: "vast data center corridor with blinking server racks, surveillance cameras on city poles at night, cold blue light", motion: "slow dolly through the corridor, lights blinking", recreation: false, importance: 2 },
  { id: "guerra", re: /guerra|ej[eé]rcito|misil|ataque|soldado|batalla|conflicto/i, scene: "military convoy crossing a desert at dusk, smoke on the horizon, documentary realism, no gore", motion: "slow tracking shot alongside the convoy, dust rising", recreation: false, importance: 3 },
  { id: "persecucion", re: /persecuci[oó]n|m[aá]rtir|perseguid|iglesias? quemada/i, scene: "small group of christians praying by candlelight in a dim hidden room, faces partially in shadow, realistic", motion: "slow push in, candle flames flickering", recreation: false, importance: 3 },
  { id: "oracion", re: /oraci[oó]n|orar|ora\b|clamar|rodillas/i, scene: "person kneeling in prayer with folded hands in a quiet realistic room, soft window light, peaceful and reverent", motion: "gentle slow push in, dust particles in the light", recreation: false, importance: 2 },
  { id: "cruz", re: /cruz|calvario|crucific|sangre de cristo|resurrecci[oó]n|tumba vac[ií]a/i, scene: "rugged wooden cross on a hill at sunrise, rays of light, empty tomb in the distance, reverent and hopeful", motion: "slow push in, sun rising behind the cross", recreation: true, importance: 5 },
  { id: "salvacion", re: /salvaci[oó]n|salvo|vida eterna|arrepi[eé]nt|entr[eé]gale|recibe a jes[uú]s|esperanza|jesucristo|cristo/i, scene: "person standing on a mountain top with arms open toward a radiant sunrise, golden light, hope and peace", motion: "slow crane up revealing the sunrise", recreation: false, importance: 4 },
  { id: "biblia", re: /biblia|escritura|vers[ií]culo|profec[ií]a|profeta|est[aá] escrito/i, scene: "ancient bible open on a wooden table lit by candlelight, pages gently turning, dust in the air", motion: "slow push in, candle flame flickering, page turning", recreation: false, importance: 2 },
];

const DEFAULT_THEME: Theme = { id: "general", re: /./, scene: "dramatic cinematic sky with moving clouds over a vast landscape, golden light", motion: "slow push in, clouds moving", recreation: false, importance: 1 };

export function themeOf(text: string) {
  return THEMES.find((t) => t.re.test(text)) ?? DEFAULT_THEME;
}

/** Estilo común a todo el video (consistencia visual de personajes y escenarios). */
export function styleGuide(format: string) {
  return `Hyperrealistic cinematic documentary film still, shot on 35mm, dramatic volumetric lighting, natural colors with teal and amber grade, shallow depth of field, ${format === "16:9" ? "widescreen" : "vertical"} composition. Anatomically correct hands, natural consistent faces, realistic proportions. No text, no letters, no logos, no watermark, no cartoon, no illustration, no 3D render look. Never depict real public figures. Show Jesus Christ only from behind or as a distant silhouette, face never visible.`;
}

export function imagePrompt(o: { text: string; meaning?: string | null; query?: string | null; format: string; topic?: string }) {
  const t = themeOf(`${o.text} ${o.meaning ?? ""}`);
  const subject = o.query && t.id === "general" ? `${o.query}, ${t.scene}` : t.scene;
  return {
    theme: t,
    prompt: `${subject}. Context of the narration (Spanish): "${o.text.slice(0, 300)}". ${styleGuide(o.format)}`,
    motion: `${t.motion}. Smooth realistic cinematic motion, stable subject, no morphing, no text.`,
  };
}
