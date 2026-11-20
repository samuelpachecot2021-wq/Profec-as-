/**
 * Precios oficiales de Runway Dev, verificados el 20-11-2026 en
 * https://docs.dev.runwayml.com/guides/pricing  («Credits can be purchased for $0.01 per credit»).
 * Los precios cambian: si Runway los modifica, actualice esta tabla. El costo REAL de cada
 * generación se lee de la respuesta de la API (cost.credits) y es el que se registra.
 */
export const RUNWAY_CREDIT_USD = 0.01;
export const PRICING_SOURCE = "https://docs.dev.runwayml.com/guides/pricing (consultado el 20-11-2026)";

export type Format = "16:9" | "9:16" | "4:5" | "1:1";

export type ImageModel = {
  id: string;
  label: string;
  /** créditos por imagen */
  credits: number;
  ratio: Record<Format, string>;
  seed: boolean;
  note: string;
};

export type VideoModel = {
  id: string;
  label: string;
  /** créditos por segundo + créditos fijos por generación */
  creditsPerSecond: number;
  extraCredits: number;
  ratio: Record<Format, string>;
  /** duraciones permitidas (segundos) */
  durations: number[];
  resolution: string;
  note: string;
};

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "muse_image",
    label: "Muse Image — muy económico",
    credits: 1, // «muse_image 1 credit per image, any resolution»
    ratio: { "16:9": "2016:1152", "9:16": "1152:2016", "4:5": "1344:1792", "1:1": "1600:1600" },
    seed: false,
    note: "1 crédito (0,01 USD) por imagen",
  },
  {
    id: "gen4_image",
    label: "Gen-4 Image — calidad cinematográfica",
    credits: 8, // «gen4_image 5 credits per 720p image, or 8 credits per 1080p image»
    ratio: { "16:9": "1920:1080", "9:16": "1080:1920", "4:5": "1080:1440", "1:1": "1080:1080" },
    seed: true,
    note: "8 créditos (0,08 USD) por imagen 1080p",
  },
];

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "gen4_turbo",
    label: "Gen-4 Turbo — equilibrio calidad/precio (720p)",
    creditsPerSecond: 5, // «gen4_turbo 5 credits per second»
    extraCredits: 0,
    ratio: { "16:9": "1280:720", "9:16": "720:1280", "4:5": "832:1104", "1:1": "960:960" },
    durations: range(2, 10),
    resolution: "720p",
    note: "5 créditos (0,05 USD) por segundo",
  },
  {
    id: "veo3.1_fast",
    label: "Veo 3.1 Fast — 1080p, sin audio",
    creditsPerSecond: 10, // «veo3.1_fast (no audio) 10 credits per second»
    extraCredits: 0,
    ratio: { "16:9": "1920:1080", "9:16": "1080:1920", "4:5": "1080:1920", "1:1": "1920:1080" },
    durations: [4, 6, 8],
    resolution: "1080p",
    note: "10 créditos (0,10 USD) por segundo; clips de 4, 6 u 8 s",
  },
  {
    id: "gen4.5",
    label: "Gen-4.5 — máxima calidad de Runway (720p)",
    creditsPerSecond: 12, // «gen4.5 12 credits per second»
    extraCredits: 0,
    ratio: { "16:9": "1280:720", "9:16": "720:1280", "4:5": "832:1104", "1:1": "960:960" },
    durations: range(2, 10),
    resolution: "720p",
    note: "12 créditos (0,12 USD) por segundo",
  },
  {
    id: "grok_imagine_1_5_lite",
    label: "Grok Imagine 1.5 Lite — el más barato (720p)",
    creditsPerSecond: 3, // «grok_imagine_1_5_lite (720p) 3 credits per second, plus 1 credit for an image-to-video start frame»
    extraCredits: 1,
    ratio: { "16:9": "auto_720p", "9:16": "auto_720p", "4:5": "auto_720p", "1:1": "auto_720p" },
    durations: range(1, 15),
    resolution: "720p",
    note: "3 créditos por segundo + 1 por imagen inicial",
  },
];

export const imageModel = (id?: string) => IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
export const videoModel = (id?: string) => VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[0];

/** Duración que se pedirá al proveedor: la más corta permitida que cubre la toma. */
export function clipSeconds(model: VideoModel, needed: number) {
  const n = Math.ceil(needed - 0.05);
  return model.durations.find((d) => d >= n) ?? model.durations[model.durations.length - 1];
}

export const imageCostUSD = (m: ImageModel) => m.credits * RUNWAY_CREDIT_USD;
export const videoCostUSD = (m: VideoModel, seconds: number) => Math.ceil(m.creditsPerSecond * seconds + m.extraCredits) * RUNWAY_CREDIT_USD;
