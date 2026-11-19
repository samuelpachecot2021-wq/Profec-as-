import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicQueries, scoreCandidate, MIN_SCORE } from "../src/lib/visual";
import { safeZone, subtitleSize, buildAss } from "../src/lib/subtitles";
import { splitScenes, planScenes } from "../src/lib/scenes";
import { saveSettings } from "../src/lib/settings";

const ctx = { query: "palm scanner payment", sceneText: "nadie podrá comprar ni vender sin la marca", preferVideo: true, w: 1080, h: 1920 };

test("búsquedas en inglés según el significado y el contexto profético", () => {
  const q = heuristicQueries("y que ninguno pudiese comprar ni vender, sino el que tuviese la marca", { topic: "La marca de la bestia" });
  assert.ok(q.some((x) => /payment|scanner/.test(x)), q.join(" | "));
  assert.ok(!q.some((x) => /supermarket checkout/.test(x)) || q.indexOf(q.find((x) => /scanner|payment terminal/.test(x))!) < q.length, "el sentido profético va antes que una compra cualquiera");
  const j = heuristicQueries("Todas las miradas vuelven a Jerusalén y al monte del templo");
  assert.match(j[0], /temple mount|jerusalem/);
  const hope = heuristicQueries("Pero hay esperanza: Jesucristo te ofrece vida eterna");
  assert.ok(hope.some((x) => /sunrise|light rays|cross/.test(x)));
  for (const list of [q, j, hope]) assert.ok(list.every((x) => /^[a-z0-9 ]+$/.test(x)), "solo inglés en minúsculas");
});

test("descarta adornos navideños, cráneos, caricaturas y animaciones", () => {
  const v = (meta: string) => scoreCandidate({ kind: "video", provider: "pexels", meta, width: 1080, height: 1920 }, ctx);
  assert.equal(v("christmas ornaments on tree"), null);
  assert.equal(v("human skull dark"), null);
  assert.equal(v("cartoon character hand scanner"), null);
  assert.equal(v("3d render palm scanner"), null);
  assert.equal(v("animated hologram interface"), null, "animación tecnológica fuera de lugar");
  // si la escena SÍ habla de tecnología, los gráficos tecnológicos se aceptan
  const tech = scoreCandidate({ kind: "video", provider: "pexels", meta: "hologram interface data", width: 1920, height: 1080 }, { ...ctx, query: "hologram interface", sceneText: "la inteligencia artificial y los datos digitales" });
  assert.notEqual(tech, null);
});

test("prioriza metraje real, relevante y cinematográfico", () => {
  const good = scoreCandidate({ kind: "video", provider: "pixabay", meta: "palm scanner payment close up cinematic", width: 1080, height: 1920 }, ctx)!;
  const photo = scoreCandidate({ kind: "image", provider: "pexels", meta: "palm scanner payment", width: 1080, height: 1920 }, ctx)!;
  const offTopic = scoreCandidate({ kind: "video", provider: "pexels", meta: "beach sunset waves", width: 1920, height: 1080 }, ctx)!;
  assert.ok(good > photo, "video antes que foto");
  assert.ok(good >= MIN_SCORE && offTopic < MIN_SCORE, "lo que no tiene relación con la búsqueda no se usa");
  const impact = scoreCandidate({ kind: "video", provider: "pexels", meta: "palm scanner payment aerial dramatic", width: 1080, height: 1920 }, { ...ctx, impact: true })!;
  assert.ok(impact > good, "la primera escena busca máximo impacto");
});

test("zonas seguras y subtítulos grandes en vertical", () => {
  const z = safeZone(1080, 1920);
  assert.deepEqual([z.top, z.bottom, z.right], [0.14, 0.25, 0.16]);
  assert.ok(subtitleSize(1080, 1920) >= 90, `vertical: ${subtitleSize(1080, 1920)} px`);
  assert.ok(subtitleSize(1920, 1080) >= 75, `horizontal: ${subtitleSize(1920, 1080)} px`);
  const ass = buildAss({ scenes: [{ text: "La marca de la bestia ya no es ciencia ficción", start: 0, end: 2.8, overlay: { type: "interpretation" }, keywords: ["marca"], isAi: true }], w: 1080, h: 1920, subtitles: true, position: "abajo", title: "x", hook: "¿YA ESTÁ AQUÍ?" });
  const sub = ass.split("\n").find((l) => l.startsWith("Style: Sub,"))!.split(",");
  assert.equal(sub[1], "Inter Black");
  assert.ok(Number(sub[21]) >= 1920 * 0.3, "subtítulos por encima de la zona de botones y descripción");
  assert.ok(Number(sub[20]) >= 1080 * 0.16, "margen derecho libre para los botones");
  assert.match(ass, /\\c&H0000E5FF&\}marca/, "palabra clave en amarillo");
  assert.match(ass, /¿YA ESTÁ AQUÍ\?/, "título de impacto");
  assert.match(ass, /Dialogue: 20,0:00:00\.00,0:00:00\.45,Shape/, "destello de luz inicial");
  const dialogs = ass.split("\n").filter((l) => l.startsWith("Dialogue: 10,"));
  assert.ok(dialogs.every((l) => l.replace(/\{[^}]*\}/g, "").split(",").slice(9).join(",").split(" ").length <= 3), "3 palabras por subtítulo en vertical");
});

test("planificación local: varias búsquedas por escena, sin repetir la principal seguida", async () => {
  saveSettings({ LLM_PROVIDER: "local" });
  const texts = splitScenes("El sistema de pagos digitales avanza. El dinero en efectivo desaparece poco a poco. La Biblia advirtió que nadie podría comprar ni vender sin la marca. Pero Jesucristo ofrece esperanza y vida eterna.", 0.95);
  const { scenes, hookTitle } = await planScenes(texts, "La marca de la bestia");
  assert.equal(hookTitle, "LA MARCA DE LA BESTIA");
  assert.ok(scenes.every((s) => s.queries.length >= 2));
  for (let i = 1; i < scenes.length; i++) assert.notEqual(scenes[i].query, scenes[i - 1].query, `escenas ${i - 1} y ${i}`);
});

test("tomas de 3–5 s según el ritmo real de la voz (primera ≤ 3,2 s)", async () => {
  const { shotGroups } = await import("../src/lib/pipeline");
  // narración rápida: fragmentos de ~1,5–2,5 s
  const starts = [0.25, 1.6, 3.4, 5.1, 7.3, 9.0, 10.9, 12.4, 14.6, 16.2, 18.0];
  const scenes = starts.map((start) => ({ start }));
  const total = 20;
  const groups = shotGroups(scenes, total);
  const D = scenes.map((sc, i) => (i < scenes.length - 1 ? scenes[i + 1].start : total) - (i === 0 ? 0 : sc.start));
  const durs = groups.map((g) => g.reduce((a, i) => a + D[i], 0));
  assert.ok(durs[0] <= 3.2, `primera toma ${durs[0].toFixed(1)} s`);
  for (const d of durs.slice(1)) assert.ok(d >= 3 && d <= 5.5, `toma de ${d.toFixed(1)} s (${durs.map((x) => x.toFixed(1)).join(", ")})`);
  assert.deepEqual(groups.flat(), scenes.map((_, i) => i), "no se pierde ninguna escena");
  // una escena fijada a mano siempre es su propia toma
  const locked = shotGroups(scenes.map((s, i) => ({ ...s, locked: i === 4 ? 1 : 0 })), total);
  assert.ok(locked.some((g) => g.length === 1 && g[0] === 4));
});
