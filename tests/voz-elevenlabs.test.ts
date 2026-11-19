import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_SETTINGS, BRIAN_VOICE_ID, VOICES } from "../src/lib/options";
import { saveSettings, getSetting } from "../src/lib/settings";
import { resolveElevenVoiceId, voiceCacheKey, synthesize } from "../src/lib/tts";
import { createProject, getProject, projectSettings } from "../src/lib/projects";
import { produce } from "../src/lib/pipeline";

const ADAM = "pNInz6obpgDQGcFmaJgB";

// ElevenLabs simulado: registra qué voz y velocidad se piden y devuelve un MP3 real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eleven-"));
const mp3 = path.join(tmp, "tono.mp3");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=180:d=4", "-c:a", "libmp3lame", mp3]);
const calls: { voice: string; speed: number; key: string | null }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = url.match(/api\.elevenlabs\.io\/v1\/text-to-speech\/([^?]+)/);
  if (m) {
    const body = JSON.parse(String(init?.body));
    calls.push({ voice: decodeURIComponent(m[1]), speed: body.voice_settings.speed, key: new Headers(init?.headers).get("xi-api-key") });
    return new Response(fs.readFileSync(mp3), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }
  if (/msedge|bing\.com|wikimedia|nasa|pexels|pixabay|unsplash/.test(url)) throw new TypeError("sin red en pruebas");
  return realFetch(input, init);
}) as typeof fetch;

test("Brian es la voz predeterminada, con velocidad 0,95", () => {
  assert.equal(BRIAN_VOICE_ID, "nPczCjzI2devNBz1zQrb");
  assert.equal(DEFAULT_SETTINGS.voiceId, "eleven-default");
  assert.equal(DEFAULT_SETTINGS.speed, 0.95);
  assert.equal(VOICES[0].id, "eleven-default", "aparece primera en el selector");
  assert.match(VOICES[0].label, /Brian/);
  assert.equal(getSetting("ELEVENLABS_VOICE_ID"), BRIAN_VOICE_ID, "Ajustes muestra Brian si no se cambió");
  const id = createProject({ text: "Artículo de prueba suficientemente largo." });
  assert.equal(projectSettings(getProject(id)!).voiceId, "eleven-default", "los proyectos nuevos usan Brian");
});

test("orden de prioridad del ID de voz y limpieza de lo pegado", () => {
  assert.equal(resolveElevenVoiceId(), BRIAN_VOICE_ID);
  saveSettings({ ELEVENLABS_VOICE_ID: `  "${ADAM}" ` });
  assert.equal(getSetting("ELEVENLABS_VOICE_ID"), ADAM, "se quitan espacios y comillas");
  assert.equal(resolveElevenVoiceId(), ADAM);
  assert.equal(resolveElevenVoiceId(BRIAN_VOICE_ID), BRIAN_VOICE_ID, "una voz propia del proyecto tiene prioridad");
  assert.equal(resolveElevenVoiceId("no válido!"), ADAM, "un ID inválido del proyecto se ignora");
  saveSettings({ ELEVENLABS_VOICE_ID: `https://elevenlabs.io/app/voice-library?voiceId=${BRIAN_VOICE_ID}` });
  assert.equal(getSetting("ELEVENLABS_VOICE_ID"), BRIAN_VOICE_ID, "se extrae el ID de un enlace");
  assert.throws(() => saveSettings({ ELEVENLABS_VOICE_ID: "Brian" }), /no es válido/);
  saveSettings({ ELEVENLABS_VOICE_ID: "" });
  assert.equal(resolveElevenVoiceId(), BRIAN_VOICE_ID, "si se borra, vuelve a Brian");
});

test("la caché de audio distingue la voz configurada en Ajustes (causa del error)", () => {
  saveSettings({ ELEVENLABS_VOICE_ID: ADAM });
  const kAdam = voiceCacheKey("eleven-default");
  saveSettings({ ELEVENLABS_VOICE_ID: BRIAN_VOICE_ID });
  const kBrian = voiceCacheKey("eleven-default");
  assert.notEqual(kAdam, kBrian);
  assert.equal(voiceCacheKey("edge-jorge"), "edge-jorge");
});

test("la síntesis pide Brian a ElevenLabs con velocidad 0,95", async () => {
  saveSettings({ ELEVENLABS_API_KEY: "clave-de-prueba-1234567890", ELEVENLABS_VOICE_ID: "", ELEVENLABS_PLAN: "suscripcion" });
  calls.length = 0;
  const out = path.join(tmp, "a.wav");
  const d = await synthesize({ text: "Hola, esta es una prueba.", voiceId: "eleven-default", speed: 0.95, out });
  assert.ok(d > 3);
  assert.deepEqual(calls, [{ voice: BRIAN_VOICE_ID, speed: 0.95, key: "clave-de-prueba-1234567890" }]);
});

test("regresión: tras cambiar Adam → Brian en Ajustes, el video nuevo suena con Brian", { timeout: 600_000 }, async () => {
  saveSettings({ LLM_PROVIDER: "local", ELEVENLABS_VOICE_ID: ADAM });
  const text = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8");
  const sources = { pexels: false, pixabay: false, unsplash: false, wikimedia: false, nasa: false, biblioteca: false };
  const id = createProject({ text, settings: { duration: 15, resolution: 720, sources } });
  calls.length = 0;
  await produce(id, () => undefined);
  assert.ok(calls.length > 0 && calls.every((c) => c.voice === ADAM), "primer render con Adam (configuración anterior)");

  // La usuaria cambia la voz a Brian en Ajustes y vuelve a renderizar el MISMO proyecto.
  saveSettings({ ELEVENLABS_VOICE_ID: BRIAN_VOICE_ID });
  calls.length = 0;
  await produce(id, () => undefined);
  assert.ok(calls.length > 0, "no reutiliza el audio en caché de Adam");
  assert.ok(calls.every((c) => c.voice === BRIAN_VOICE_ID && c.speed === 0.95), "todo el audio nuevo es de Brian a 0,95");
  assert.ok(fs.existsSync(getProject(id)!.output_path!), "el video se exportó");
});
