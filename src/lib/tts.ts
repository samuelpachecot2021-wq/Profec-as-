import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VOICES, type VoiceOption } from "./options";
import { getSetting } from "./settings";
import { run, ffprobeDuration, fetchWithTimeout, exists, sleep } from "./util";
import { recordCost, assertCanSpend } from "./costs";

/** Precios aproximados por 1000 caracteres (USD). */
export const TTS_PRICE_PER_1K: Record<VoiceOption["provider"], number> = {
  elevenlabs: 0.18, // plan Creator aprox. (varía según plan)
  azure: 0.016, // voces neuronales: $16 por millón de caracteres
  edge: 0,
  piper: 0,
  espeak: 0,
  silencio: 0,
};

export function voiceById(id: string) {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

export function estimateTtsCost(voiceId: string, chars: number) {
  const p = voiceById(voiceId).provider;
  // Con el plan gratuito F0 de Azure (500 000 caracteres/mes) no hay cargos.
  if (p === "azure" && getSetting("AZURE_FREE_TIER") === "si") return 0;
  return (chars / 1000) * TTS_PRICE_PER_1K[p];
}

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Convierte puntos suspensivos en pausas reales para las voces SSML. */
function toSsmlBody(text: string) {
  return xmlEscape(text)
    .replace(/\.\.\.|…/g, '... <break time="450ms"/>')
    .replace(/([.!?])\s/g, '$1 <break time="250ms"/> ');
}

/** Normaliza cualquier audio a WAV mono 44,1 kHz (formato interno de trabajo). */
async function toWav(input: string, out: string) {
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
}

async function edgeTts(text: string, voice: string, speed: number, out: string) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edge-"));
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const rate = `${Math.round((speed - 1) * 100) >= 0 ? "+" : ""}${Math.round((speed - 1) * 100)}%`;
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-MX"><voice name="${voice}"><prosody rate="${rate}" pitch="-4%">${toSsmlBody(text)}</prosody></voice></speak>`;
      const { audioFilePath } = await tts.rawToFile(tmp, ssml);
      tts.close();
      if (!exists(audioFilePath)) throw new Error("audio vacío");
      await toWav(audioFilePath, out);
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      try {
        tts.close();
      } catch {}
      await sleep(1500 * (attempt + 1));
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  throw new Error(`La voz gratuita (Edge) no respondió: ${String(lastErr)}. Compruebe su conexión a internet o elija otra voz.`);
}

async function azureTts(text: string, voiceSpec: string, speed: number, out: string) {
  const key = getSetting("AZURE_SPEECH_KEY");
  const region = getSetting("AZURE_SPEECH_REGION") || "eastus";
  if (!key) throw new Error("Falta la clave de Azure Speech (Ajustes).");
  const [voice, style] = voiceSpec.split("|");
  const rate = `${Math.round((speed - 1) * 100)}%`;
  const inner = `<prosody rate="${rate}" pitch="-4%">${toSsmlBody(text)}</prosody>`;
  const body = style
    ? `<mstts:express-as style="${style}" styledegree="1.3">${inner}</mstts:express-as>`
    : inner;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="es-MX"><voice name="${voice}">${body}</voice></speak>`;
  const res = await fetchWithTimeout(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3",
        "User-Agent": "ProfeciaStudioAI",
      },
      body: ssml,
    },
    120000,
  );
  if (!res.ok) throw new Error(`Azure Speech respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const mp3 = out.replace(/\.wav$/, ".mp3");
  fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  await toWav(mp3, out);
  fs.rmSync(mp3, { force: true });
}

async function elevenTts(text: string, voiceId: string, speed: number, out: string) {
  const key = getSetting("ELEVENLABS_API_KEY");
  if (!key) throw new Error("Falta la clave de ElevenLabs (Ajustes).");
  if (!voiceId) throw new Error("Indique el ID de voz de ElevenLabs en el proyecto o en Ajustes.");
  const res = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, speed)) },
      }),
    },
    180000,
  );
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const mp3 = out.replace(/\.wav$/, ".mp3");
  fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  await toWav(mp3, out);
  fs.rmSync(mp3, { force: true });
}

async function espeakTts(text: string, voice: string, speed: number, out: string) {
  const bin = (await run("sh", ["-c", "command -v espeak-ng || command -v espeak || true"])).trim();
  if (!bin) throw new Error("eSpeak no está instalado en este equipo. Elija la voz gratuita «Jorge».");
  const raw = out.replace(/\.wav$/, ".raw.wav");
  const clean = text.replace(/\.\.\.|…/g, ", ");
  // Voz MBROLA masculina (más natural) si está instalada; si no, la voz básica.
  const mbrola = voice.startsWith("mb-") && fs.existsSync(`/usr/share/mbrola/${voice.slice(3)}`);
  const args = mbrola
    ? ["-v", voice, "-s", String(Math.round(150 * speed)), "-p", "40", "-w", raw, clean]
    : ["-v", "es-419+m3", "-s", String(Math.round(150 * speed)), "-p", "35", "-w", raw, clean];
  await run(bin, args);
  await toWav(raw, out);
  // MBROLA suena fino: se le da algo más de cuerpo y profundidad.
  if (mbrola) {
    const tmp = out.replace(/\.wav$/, ".eq.wav");
    await run("ffmpeg", ["-y", "-v", "error", "-i", out, "-af", "asetrate=44100*0.94,aresample=44100,atempo=1.064,bass=g=4:f=140,acompressor=threshold=0.2:ratio=3", "-c:a", "pcm_s16le", tmp]);
    fs.renameSync(tmp, out);
  }
  fs.rmSync(raw, { force: true });
}

/** La voz elegida no responde y existe una alternativa gratuita para todo el video. */
export class VoiceUnavailable extends Error {
  constructor(public fallbackVoiceId: string, reason: string) {
    super(`Voz no disponible (${reason}); se usará ${fallbackVoiceId}`);
  }
}

/** Directorio de voces Piper (se instalan en la imagen Docker del servidor). */
export function piperModel(voice: string) {
  const dir = process.env.PIPER_VOICES_DIR || "/opt/piper/voices";
  return path.join(dir, `${voice}.onnx`);
}

export function piperAvailable(voice = "es_MX-ald-medium") {
  return fs.existsSync(piperModel(voice));
}

async function piperTts(text: string, voice: string, speed: number, out: string) {
  const model = piperModel(voice);
  if (!fs.existsSync(model)) throw new Error("La voz Piper no está instalada en este servidor.");
  const bin = process.env.PIPER_BIN || "piper";
  const raw = out.replace(/\.wav$/, ".piper.wav");
  // length_scale > 1 = más lento y pausado (tono documental)
  const lengthScale = (1.05 / speed).toFixed(3);
  const input = text.replace(/\.\.\.|…/g, "... ").replace(/\s+/g, " ");
  await run(bin, ["--model", model, "--output_file", raw, "--length_scale", lengthScale, "--sentence_silence", "0.35"], { input, timeoutMs: 10 * 60_000 });
  await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", "bass=g=3:f=130,highpass=f=60", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", out]);
  fs.rmSync(raw, { force: true });
}

/** Silencio con la duración que tendría la lectura (para pruebas o narración propia). */
async function silence(text: string, speed: number, out: string) {
  const secs = Math.max(1, (text.split(/\s+/).length / (140 / 60)) / speed + (text.match(/\.\.\./g) || []).length * 0.4);
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", secs.toFixed(2), "-c:a", "pcm_s16le", out]);
}

/**
 * Sintetiza un bloque de texto en WAV. Usa caché: si el archivo ya existe
 * (mismo texto, voz y velocidad), no se vuelve a generar ni a cobrar.
 */
export async function synthesize(opts: { text: string; voiceId: string; elevenVoiceId?: string; speed: number; out: string; projectId?: string }) {
  if (exists(opts.out)) return ffprobeDuration(opts.out);
  const v = voiceById(opts.voiceId);
  const cost = estimateTtsCost(v.id, opts.text.length);
  if (opts.projectId && cost > 0) assertCanSpend(opts.projectId, cost);
  const tmp = `${opts.out}.part.wav`;
  switch (v.provider) {
    case "edge":
      try {
        await edgeTts(opts.text, v.voice, opts.speed, tmp);
      } catch (e) {
        // Respaldo automático y gratuito: todo el video pasa a la voz Piper del servidor.
        if (piperAvailable()) throw new VoiceUnavailable("piper-ald", String(e));
        throw e;
      }
      break;
    case "piper":
      await piperTts(opts.text, v.voice, opts.speed, tmp);
      break;
    case "azure":
      await azureTts(opts.text, v.voice, opts.speed, tmp);
      break;
    case "elevenlabs":
      await elevenTts(opts.text, opts.elevenVoiceId || getSetting("ELEVENLABS_VOICE_ID") || "", opts.speed, tmp);
      break;
    case "espeak":
      await espeakTts(opts.text, v.voice, opts.speed, tmp);
      break;
    default:
      await silence(opts.text, opts.speed, tmp);
  }
  fs.renameSync(tmp, opts.out);
  if (cost > 0) recordCost({ projectId: opts.projectId, provider: v.provider, units: opts.text.length, unit: "caracteres", cost, note: "voz" });
  return ffprobeDuration(opts.out);
}
