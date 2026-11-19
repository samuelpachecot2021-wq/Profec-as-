// Opciones compartidas entre la interfaz y el servidor (sin dependencias de Node).

export const DURATIONS = [
  { value: 15, label: "15 segundos" },
  { value: 30, label: "30 segundos" },
  { value: 60, label: "1 minuto" },
  { value: 180, label: "3 minutos" },
  { value: 300, label: "5 minutos" },
  { value: 480, label: "8 minutos" },
  { value: 600, label: "10 minutos" },
  { value: 900, label: "15 minutos" },
  { value: 1200, label: "20 minutos" },
  { value: 1800, label: "30 minutos" },
] as const;

export const FORMATS = [
  { value: "16:9", label: "Horizontal 16:9 (YouTube)" },
  { value: "9:16", label: "Vertical 9:16 (Shorts, TikTok, Reels)" },
  { value: "4:5", label: "Vertical 4:5 (Facebook)" },
  { value: "1:1", label: "Cuadrado 1:1" },
] as const;

export const RESOLUTIONS = [
  { value: 720, label: "720p HD" },
  { value: 1080, label: "1080p Full HD" },
  { value: 1440, label: "1440p 2K" },
  { value: 2160, label: "4K Ultra HD" },
] as const;

export const MUSIC_STYLES = [
  { value: "suspenso", label: "Suspenso profético" },
  { value: "documental", label: "Documental cinematográfico" },
  { value: "misterio", label: "Misterio" },
  { value: "tension", label: "Tensión dramática" },
  { value: "epica", label: "Música épica" },
  { value: "reflexion", label: "Reflexión espiritual" },
  { value: "adoracion", label: "Adoración instrumental" },
  { value: "esperanza", label: "Esperanza y salvación" },
  { value: "ninguna", label: "Sin música" },
] as const;

export type VoiceOption = {
  id: string;
  provider: "edge" | "azure" | "elevenlabs" | "piper" | "espeak" | "silencio";
  label: string;
  voice: string;
  paid: boolean;
  note?: string;
};

export const VOICES: VoiceOption[] = [
  { id: "edge-jorge", provider: "edge", voice: "es-MX-JorgeNeural", label: "Jorge — masculina grave, latino neutro (gratis)", paid: false, note: "Recomendada. Voz neuronal gratuita (servicio en línea no oficial de Microsoft Edge)." },
  { id: "edge-gonzalo", provider: "edge", voice: "es-CO-GonzaloNeural", label: "Gonzalo — masculina profunda, Colombia (gratis)", paid: false },
  { id: "edge-tomas", provider: "edge", voice: "es-AR-TomasNeural", label: "Tomás — masculina, Argentina (gratis)", paid: false },
  { id: "edge-dalia", provider: "edge", voice: "es-MX-DaliaNeural", label: "Dalia — femenina, México (gratis)", paid: false },
  { id: "azure-jorge", provider: "azure", voice: "es-MX-JorgeNeural", label: "Azure · Jorge documental (500 000 caracteres gratis al mes)", paid: true },
  { id: "azure-jorge-dramatic", provider: "azure", voice: "es-MX-JorgeNeural|serious", label: "Azure · Jorge estilo serio", paid: true },
  { id: "eleven-default", provider: "elevenlabs", voice: "", label: "ElevenLabs · voz configurada (de pago, la más humana)", paid: true, note: "Usa el ID de voz de ElevenLabs que elijas en Ajustes." },
  { id: "piper-ald", provider: "piper", voice: "es_MX-ald-medium", label: "Piper · masculina México (gratis, en el servidor)", paid: false, note: "Voz neuronal de código abierto que funciona dentro del propio servidor: sin límites ni costos." },
  { id: "espeak-es", provider: "espeak", voice: "mb-es2", label: "eSpeak/MBROLA local (sin internet, robótica)", paid: false },
  { id: "silencio", provider: "silencio", voice: "", label: "Sin voz (solo pruebas / narración propia)", paid: false },
];

export const SUB_POSITIONS = [
  { value: "abajo", label: "Abajo" },
  { value: "centro", label: "Centro" },
  { value: "arriba", label: "Arriba" },
] as const;

export type ProjectSettings = {
  duration: number; // segundos objetivo
  voiceId: string;
  elevenVoiceId?: string;
  speed: number; // 0.7 – 1.3
  format: "16:9" | "9:16" | "4:5" | "1:1";
  resolution: 720 | 1080 | 1440 | 2160;
  music: string;
  musicVolume: number; // 0 – 1 (relativo)
  subtitles: boolean;
  subPosition: "abajo" | "centro" | "arriba";
  translateSubsEn: boolean;
  translateToSpanish: boolean;
  useAiImages: boolean;
  preferVideo: boolean;
  sources: { pexels: boolean; pixabay: boolean; unsplash: boolean; wikimedia: boolean; nasa: boolean; biblioteca: boolean };
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  duration: 480,
  voiceId: "edge-jorge",
  speed: 0.95,
  format: "16:9",
  resolution: 1080,
  music: "suspenso",
  musicVolume: 0.5,
  subtitles: true,
  subPosition: "abajo",
  translateSubsEn: false,
  translateToSpanish: true,
  useAiImages: false,
  preferVideo: true,
  sources: { pexels: true, pixabay: true, unsplash: true, wikimedia: true, nasa: true, biblioteca: true },
};

export function dims(format: ProjectSettings["format"], res: number) {
  const even = (n: number) => Math.round(n / 2) * 2;
  switch (format) {
    case "16:9":
      return { w: even((res * 16) / 9), h: res };
    case "9:16":
      return { w: res, h: even((res * 16) / 9) };
    case "4:5":
      return { w: res, h: even((res * 5) / 4) };
    default:
      return { w: res, h: res };
  }
}

/** Palabras por minuto de una narración documental pausada en español. */
export const WPM = 140;

export const TOPICS = [
  "Profecías bíblicas", "Apocalipsis", "El anticristo", "El falso profeta", "La marca de la bestia",
  "El arrebatamiento de la Iglesia", "La segunda venida de Jesucristo", "La gran tribulación", "Israel y Jerusalén",
  "El tercer templo", "Acontecimientos mundiales", "El dinero digital", "La inteligencia artificial",
  "Persecución de los cristianos", "Guerras y conflictos", "Los últimos tiempos", "Evangelización y salvación",
];
