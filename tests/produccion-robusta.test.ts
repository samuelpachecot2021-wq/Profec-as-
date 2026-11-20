import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderProfile, threadArgs } from "../src/lib/resources";
import { run, ProcessError } from "../src/lib/util";
import { saveSettings, getSetting } from "../src/lib/settings";
import { createProject, getProject } from "../src/lib/projects";
import { produce, pendingNarrationChars, type Reporter } from "../src/lib/pipeline";
import { estimateProject } from "../src/lib/estimate";
import { LIBRARY_DIR } from "../src/lib/media";
import { DATA_DIR } from "../src/lib/paths";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "robusta-"));

// ── ElevenLabs simulado (cuenta las llamadas = créditos gastados) ──
const mp3 = path.join(tmp, "voz.mp3");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=160:d=5", "-c:a", "libmp3lame", mp3]);
let elevenCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.elevenlabs.io/v1/text-to-speech/")) {
    elevenCalls++;
    return new Response(fs.readFileSync(mp3), { status: 200 });
  }
  if (/msedge|bing\.com|wikimedia|nasa|pexels|pixabay|unsplash/.test(url)) throw new TypeError("sin red en pruebas");
  return realFetch(input, init);
}) as typeof fetch;

// ── FFmpeg trampa: imita al sistema matando el proceso por falta de memoria ──
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
const KILL_ALL = path.join(tmp, "matar-todo");
const KILL_MULTI = path.join(tmp, "matar-con-varios-hilos");
const FAIL_FINAL_ENOSPC = path.join(tmp, "render-final-sin-disco");
fs.writeFileSync(
  path.join(bin, "ffmpeg"),
  `#!/bin/sh
case "$*" in
  *loudnorm*)
    if [ -f "${FAIL_FINAL_ENOSPC}" ]; then echo "Error writing trailer: No space left on device" >&2; echo "Conversion failed!" >&2; exit 228; fi;;
  *zoompan*|*-stream_loop*)
    if [ -f "${KILL_ALL}" ]; then kill -9 $$; fi
    if [ -f "${KILL_MULTI}" ]; then case "$*" in *"-threads 1 "*) ;; *) kill -9 $$;; esac; fi;;
esac
exec ${execFileSync("sh", ["-c", "command -v ffmpeg"]).toString().trim()} "$@"
`,
  { mode: 0o755 },
);
process.env.PATH = `${bin}:${process.env.PATH}`;

// Clip de video (como los de Pixabay) en la biblioteca, para cubrir también la ruta de video.
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", path.join(LIBRARY_DIR, "money-banking-digital-payment-technology.mp4")]);

const text = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8");
const sources = { pexels: false, pixabay: false, unsplash: false, wikimedia: false, nasa: false, biblioteca: true };
const logs: string[] = [];
const reporter = (): Reporter => {
  const r: Reporter = () => undefined;
  r.log = (m) => logs.push(m);
  return r;
};

test("perfil de recursos: con poca memoria limita hilos y simultaneidad", () => {
  process.env.RENDER_CPUS = "48";
  process.env.RENDER_MEMORY_MB = "1024";
  let p = renderProfile();
  assert.equal(p.cpus, 48);
  assert.equal(p.threads, 2, "no abre 48 hilos aunque el servidor físico tenga 48 núcleos");
  assert.equal(p.concurrency, 1, "un video a la vez con 1 GB");
  assert.equal(p.chunk, 4);
  process.env.RENDER_MEMORY_MB = "8192";
  p = renderProfile();
  assert.equal(p.threads, 4);
  assert.ok(p.concurrency >= 2);
  assert.deepEqual(threadArgs(2).encode, ["-threads", "2", "-x264-params", "threads=2:lookahead-threads=1"]);
  process.env.RENDER_MEMORY_MB = "1024";
});

test("un proceso detenido por el sistema da un error claro (no «código null»)", async () => {
  await assert.rejects(run("sh", ["-c", "kill -9 $$"]), (e: unknown) => {
    assert.ok(e instanceof ProcessError);
    assert.equal(e.killedBySystem, true);
    assert.equal(e.signal, "SIGKILL");
    assert.match(e.message, /detenido por el sistema \(señal SIGKILL\).*memoria/);
    assert.doesNotMatch(e.message, /código null/);
    return true;
  });
});

test("vertical 9:16: si el sistema mata FFmpeg, reintenta solo con memoria mínima y termina", { timeout: 600_000 }, async () => {
  saveSettings({ LLM_PROVIDER: "local", ELEVENLABS_API_KEY: "clave-prueba-1234567890", ELEVENLABS_PLAN: "suscripcion" });
  fs.writeFileSync(KILL_MULTI, "1");
  const id = createProject({ text, settings: { duration: 30, resolution: 720, format: "9:16", voiceId: "eleven-default", sources } });
  logs.length = 0;
  await produce(id, reporter());
  fs.rmSync(KILL_MULTI);
  const out = getProject(id)!.output_path!;
  assert.ok(fs.existsSync(out));
  assert.match(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString(), /720,1280/);
  assert.ok(logs.some((l) => /Reintentando en modo de memoria mínima/.test(l)), "quedó registrado el reintento");
  assert.ok(logs.some((l) => /Servidor: CPU asignadas/.test(l)) && logs.some((l) => /Escena 1\/\d+: editada/.test(l)), "registro detallado");
});

test("reanudar tras un fallo: no se vuelven a gastar créditos de ElevenLabs", { timeout: 600_000 }, async () => {
  const id = createProject({ text, settings: { duration: 30, resolution: 720, format: "16:9", voiceId: "eleven-default", sources } });
  fs.writeFileSync(KILL_ALL, "1");
  elevenCalls = 0;
  await assert.rejects(produce(id, reporter()), (e: unknown) => e instanceof ProcessError && e.killedBySystem);
  const spent = elevenCalls;
  assert.ok(spent > 0, "la narración se generó en el primer intento");
  assert.equal(pendingNarrationChars(id), 0, "la narración quedó guardada");
  saveSettings({ ELEVENLABS_PLAN: "uso" });
  const est = await estimateProject(id, "video");
  assert.ok(!est.items.some((i) => i.label.startsWith("Voz")), "la estimación al reanudar no cobra la voz otra vez");
  saveSettings({ ELEVENLABS_PLAN: "suscripcion" });

  fs.rmSync(KILL_ALL);
  logs.length = 0;
  await produce(id, reporter()); // = botón «Reanudar producción»
  assert.equal(elevenCalls, spent, "cero llamadas nuevas a ElevenLabs");
  assert.ok(logs.some((l) => /reutilizada \(sin gastar créditos\)/.test(l)));
  assert.ok(fs.existsSync(getProject(id)!.output_path!));
});

test("las claves y la configuración se conservan", () => {
  saveSettings({ PEXELS_API_KEY: "pexels-conservada-123456" });
  saveSettings({ ELEVENLABS_PLAN: "uso" }); // guardar otro ajuste no borra los anteriores
  assert.equal(getSetting("PEXELS_API_KEY"), "pexels-conservada-123456");
  assert.equal(getSetting("ELEVENLABS_API_KEY"), "clave-prueba-1234567890");
  assert.ok(fs.existsSync(path.join(DATA_DIR, "secrets.json")));
});

test("render final con código 228 (disco lleno): error claro y al reanudar solo se repite el render final", { timeout: 600_000 }, async () => {
  saveSettings({ ELEVENLABS_PLAN: "suscripcion" });
  const id = createProject({ text, settings: { duration: 30, resolution: 1080, format: "9:16", voiceId: "eleven-default", sources } });
  fs.writeFileSync(FAIL_FINAL_ENOSPC, "1");
  elevenCalls = 0;
  await assert.rejects(produce(id, reporter()), (e: unknown) => e instanceof Error && /ENOSPC|disco del servidor/.test(e.message));
  const spent = elevenCalls;
  const segDir = path.join(DATA_DIR, "projects", id, "segmentos");
  const blocks = fs.readdirSync(segDir).filter((f) => f.startsWith("bloque-"));
  assert.ok(blocks.length >= 1, "los bloques válidos se conservan");
  assert.ok(!fs.readdirSync(path.join(DATA_DIR, "projects", id, "salida")).some((f) => f.includes(".part")), "no queda un MP4 a medias");
  fs.rmSync(FAIL_FINAL_ENOSPC);
  logs.length = 0;
  await produce(id, reporter()); // = «Reanudar producción»
  assert.equal(elevenCalls, spent, "sin nuevas llamadas a ElevenLabs");
  assert.ok(logs.filter((l) => /Bloque \d+\/\d+: reutilizado/.test(l)).length === blocks.length, "los bloques no se rehacen");
  assert.ok(!logs.some((l) => /Escena \d+\/\d+: editada/.test(l)), "ninguna escena se vuelve a editar");
  assert.ok(logs.some((l) => /MP4 verificado: 1080×1920/.test(l)), "MP4 verificado (imagen, sonido y duración)");
});
