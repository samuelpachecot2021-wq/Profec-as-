import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths";
import { BRIAN_VOICE_ID } from "./options";

/**
 * Claves y preferencias globales. Se guardan SOLO en el servidor
 * (data/secrets.json con permisos 600) o en variables de entorno.
 * El navegador nunca recibe las claves completas.
 */
export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "AZURE_SPEECH_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "OPENAI_API_KEY",
  "RUNWAY_API_KEY",
] as const;

export const PLAIN_KEYS = [
  "ANTHROPIC_MODEL",
  "OLLAMA_URL",
  "OLLAMA_MODEL",
  "AZURE_SPEECH_REGION",
  "OPENAI_IMAGE_MODEL",
  "MONTHLY_BUDGET_USD",
  "DAILY_PROJECT_LIMIT",
  "ALLOW_CC_BY_SA",
  "LLM_PROVIDER",
  "ELEVENLABS_VOICE_ID",
  "AZURE_FREE_TIER",
  "ELEVENLABS_PLAN",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type PlainKey = (typeof PLAIN_KEYS)[number];
export type AnyKey = SecretKey | PlainKey;

const FILE = path.join(DATA_DIR, "secrets.json");

const DEFAULTS: Partial<Record<AnyKey, string>> = {
  ANTHROPIC_MODEL: "claude-opus-5-5",
  OLLAMA_URL: "http://127.0.0.1:11434",
  AZURE_SPEECH_REGION: "eastus",
  OPENAI_IMAGE_MODEL: "gpt-image-1",
  MONTHLY_BUDGET_USD: "10",
  DAILY_PROJECT_LIMIT: "12",
  ALLOW_CC_BY_SA: "no",
  LLM_PROVIDER: "auto",
  ELEVENLABS_VOICE_ID: BRIAN_VOICE_ID,
  ELEVENLABS_PLAN: "uso",
};

function readFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function getSetting(key: AnyKey): string {
  const file = readFile();
  const v = file[key] ?? process.env[key] ?? DEFAULTS[key] ?? "";
  return String(v).trim();
}

export function hasKey(key: AnyKey) {
  return getSetting(key).length > 0;
}

export function saveSettings(values: Partial<Record<AnyKey, string>>) {
  const file = readFile();
  for (const [k, v] of Object.entries(values)) {
    if (![...SECRET_KEYS, ...PLAIN_KEYS].includes(k as AnyKey)) continue;
    if (v === undefined) continue;
    const clean = k === "ELEVENLABS_VOICE_ID" ? normalizeElevenVoiceId(String(v)) : String(v).trim();
    if (k === "ELEVENLABS_VOICE_ID" && clean && !isValidElevenVoiceId(clean))
      throw new Error("El ID de voz de ElevenLabs no es válido. Debe ser un código como nPczCjzI2devNBz1zQrb (Brian).");
    if (clean === "") delete file[k];
    else file[k] = clean;
  }
  fs.writeFileSync(FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(FILE, 0o600);
  } catch {}
}

/** Limpia un ID de voz pegado con espacios, comillas o dentro de un enlace de ElevenLabs. */
export function normalizeElevenVoiceId(v: string) {
  const t = v.trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  const m = t.match(/(?:voice[_-]?id=|voices\/|text-to-speech\/)([A-Za-z0-9]{15,40})/i);
  return m ? m[1] : t;
}

export function isValidElevenVoiceId(v: string) {
  return /^[A-Za-z0-9]{15,40}$/.test(v);
}

function mask(v: string) {
  if (!v) return "";
  return v.length <= 8 ? "••••" : `${v.slice(0, 3)}••••${v.slice(-4)}`;
}

/** Vista segura para el navegador. */
export function publicSettings() {
  const secrets: Record<string, { configured: boolean; masked: string; source: string }> = {};
  const file = readFile();
  for (const k of SECRET_KEYS) {
    const v = getSetting(k);
    secrets[k] = { configured: !!v, masked: mask(v), source: file[k] ? "app" : process.env[k] ? "entorno" : "" };
  }
  const plain: Record<string, string> = {};
  for (const k of PLAIN_KEYS) plain[k] = getSetting(k);
  return { secrets, plain };
}
