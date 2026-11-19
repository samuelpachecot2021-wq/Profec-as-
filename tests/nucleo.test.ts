import { test } from "node:test";
import assert from "node:assert/strict";
import "./_env";
import path from "node:path";
import fs from "node:fs";
import { applyHouseRules, detectLanguage, generateScript } from "../src/lib/script";
import { splitScenes, groupBlocks } from "../src/lib/scenes";
import { findRefs } from "../src/lib/bible";
import { toSrt, chunkScene, buildAss } from "../src/lib/subtitles";
import { dims } from "../src/lib/options";
import { saveSettings, publicSettings } from "../src/lib/settings";
import { safeDataPath } from "../src/lib/paths";
import { isAllowedMediaUrl } from "../src/lib/media";

test("usa «arrebatamiento» en lugar de «rapto» y deja un solo párrafo", () => {
  const out = applyHouseRules("El rapto de la Iglesia.\n\nRapto inminente.");
  assert.equal(out, "El arrebatamiento de la Iglesia. Arrebatamiento inminente.");
});

test("detecta idiomas", () => {
  assert.equal(detectLanguage("El gobierno anunció que la economía de los países crecerá por la crisis"), "es");
  assert.equal(detectLanguage("The government announced that the economy of the countries will grow"), "en");
  assert.equal(detectLanguage("O governo anunciou que não vai haver eleições e que a situação é grave"), "pt");
  assert.equal(detectLanguage("أعلنت الحكومة أن الاقتصاد سينمو هذا العام بشكل كبير"), "ar");
});

test("divide el guion en escenas de 3 a 5 segundos y la primera dura como máximo ~3 s", () => {
  const text = Array.from({ length: 40 }, (_, i) => `Esta es la frase número ${i} del guion, con varias palabras para narrar...`).join(" ");
  const scenes = splitScenes(text, 1);
  const wps = 140 / 60;
  const secs = (s: string) => s.split(/\s+/).length / wps;
  assert.ok(secs(scenes[0]) <= 3.3, `primera escena de ${secs(scenes[0]).toFixed(1)} s`);
  for (const s of scenes.slice(1, -1)) assert.ok(secs(s) >= 1.7 && secs(s) <= 5.2, `escena de ${secs(s).toFixed(1)} s: ${s}`);
  const avg = scenes.reduce((a, s) => a + secs(s), 0) / scenes.length;
  assert.ok(avg >= 2.5 && avg <= 5, `promedio ${avg.toFixed(1)} s`);
  assert.equal(scenes.join(" ").split(/\s+/).length, text.split(/\s+/).length, "no se pierde texto");
  const blocks = groupBlocks(scenes);
  assert.deepEqual(blocks.flat(), scenes.map((_, i) => i));
});

test("reconoce referencias bíblicas", () => {
  assert.deepEqual(findRefs("Como dice Apocalipsis 13:16-17 y también 1 Tesalonicenses 4:16"), ["Apocalipsis 13:16-17", "1 Tesalonicenses 4:16"]);
});

test("subtítulos SRT con tiempos crecientes", () => {
  const cues = chunkScene("Uno dos tres cuatro cinco seis siete ocho nueve diez once doce.", 0, 6, 6, 40);
  assert.ok(cues.length >= 2);
  assert.equal(cues[0].start, 0);
  assert.ok(Math.abs(cues[cues.length - 1].end - 6) < 1e-6);
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:00,000 --> /);
});

test("ASS resalta palabras clave en amarillo", () => {
  const ass = buildAss({ scenes: [{ text: "Jesucristo viene pronto", start: 0, end: 3, overlay: { type: "verse", ref: "Juan 14:3" }, keywords: [], isAi: true }], w: 1920, h: 1080, subtitles: true, position: "abajo", title: "x" });
  assert.match(ass, /\\c&H0000E5FF&\}Jesucristo/);
  assert.match(ass, /JUAN 14:3/);
  assert.match(ass, /Imagen ilustrativa generada con IA/);
});

test("dimensiones de los formatos", () => {
  assert.deepEqual(dims("16:9", 1080), { w: 1920, h: 1080 });
  assert.deepEqual(dims("9:16", 1080), { w: 1080, h: 1920 });
  assert.deepEqual(dims("4:5", 1080), { w: 1080, h: 1350 });
  assert.deepEqual(dims("1:1", 720), { w: 720, h: 720 });
  assert.deepEqual(dims("16:9", 2160), { w: 3840, h: 2160 });
});

test("las claves nunca se devuelven completas", () => {
  saveSettings({ PEXELS_API_KEY: "abcdefghijklmnop1234" });
  const pub = JSON.stringify(publicSettings());
  assert.ok(!pub.includes("abcdefghijklmnop1234"));
  assert.match(pub, /abc••••1234/);
  const mode = fs.statSync(path.join(process.env.PROFECIA_DATA_DIR!, "secrets.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("los archivos protegidos no se sirven", () => {
  assert.throws(() => safeDataPath("../package.json"));
  assert.throws(() => safeDataPath("secrets.json"));
  assert.throws(() => safeDataPath("profecia.db"));
  assert.ok(safeDataPath("projects/abc/salida/video.mp4"));
});

test("solo se descargan recursos de bancos autorizados", () => {
  assert.ok(isAllowedMediaUrl("https://images.pexels.com/photos/1/a.jpg"));
  assert.ok(isAllowedMediaUrl("https://upload.wikimedia.org/x.jpg"));
  assert.ok(!isAllowedMediaUrl("http://images.pexels.com/a.jpg"));
  assert.ok(!isAllowedMediaUrl("https://evil.com/pexels.com.jpg"));
  assert.ok(!isAllowedMediaUrl("http://127.0.0.1/admin"));
});

test("guion local sin inventar y con cierre evangelístico", async () => {
  saveSettings({ LLM_PROVIDER: "local" });
  const art = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8");
  const r = await generateScript(art, 180);
  assert.equal(r.engine, "local");
  assert.ok(!/\n/.test(r.script), "un solo párrafo");
  assert.ok(!/\brapto\b/i.test(r.script));
  assert.match(r.script, /Jesucristo/);
  assert.match(r.script, /Apocalipsis 13:16-17/);
});

test("sesiones firmadas: válidas, caducadas o falsificadas", async () => {
  process.env.ADMIN_USER = "samuel";
  process.env.ADMIN_PASSWORD = "Clave-de-prueba-123";
  const { createSessionToken, verifySessionToken, safeEqual } = await import("../src/lib/session");
  const tok = await createSessionToken("samuel");
  assert.equal(await verifySessionToken(tok), "samuel");
  const [payload, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "intruso", exp: Date.now() + 1e9 })).toString("base64url");
  assert.equal(await verifySessionToken(`${forged}.${sig}`), null);
  assert.equal(await verifySessionToken(`${payload}.x${sig.slice(1)}`), null);
  assert.equal(await verifySessionToken(undefined), null);
  // al cambiar la contraseña, las sesiones anteriores dejan de valer
  process.env.ADMIN_PASSWORD = "Otra-clave-456";
  assert.equal(await verifySessionToken(tok), null);
  assert.ok(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "abcd"));
});

test("notificaciones: claves VAPID y validación de suscripciones", async () => {
  const { vapidKeys, saveSubscription, countSubscriptions, removeSubscription } = await import("../src/lib/push");
  const k = await vapidKeys();
  assert.ok(k.publicKey.length > 60 && k.privateKey.length > 30);
  assert.deepEqual(await vapidKeys(), k, "las claves se conservan");
  assert.throws(() => saveSubscription({ endpoint: "http://inseguro", keys: { p256dh: "a", auth: "b" } }));
  saveSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "a", auth: "b" } });
  assert.equal(countSubscriptions(), 1);
  removeSubscription("https://fcm.googleapis.com/fcm/send/abc");
  assert.equal(countSubscriptions(), 0);
});
