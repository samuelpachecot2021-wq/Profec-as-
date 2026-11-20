/**
 * Pruebas de la producción visual con IA.
 * IMPORTANTE: Runway se reemplaza por un SIMULADOR local que reproduce el contrato oficial
 * documentado (https://docs.dev.runwayml.com/api): POST /v1/text_to_image y /v1/image_to_video
 * → { id }; GET /v1/tasks/{id} → RUNNING → SUCCEEDED { output: [url], cost: { credits } }.
 * No son generaciones reales: verifican la lógica de la app (plan, costos, autorización,
 * reanudación, fallos), no la calidad de Runway.
 */
import "./_env";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { saveSettings } from "../src/lib/settings";
import { clipSeconds, videoModel, imageModel, videoCostUSD, imageCostUSD, VIDEO_MODELS } from "../src/lib/ai/pricing";
import { buildPlan, approvePlan, getPlan, AwaitingAiAuthorization } from "../src/lib/ai/plan";
import { themeOf, imagePrompt } from "../src/lib/ai/prompts";
import { createProject, getProject, getScenes } from "../src/lib/projects";
import { produce } from "../src/lib/pipeline";
import { db } from "../src/lib/db";

let PORT = 0; // puerto libre aleatorio (se fija al arrancar el simulador)
process.env.RUNWAY_POLL_MS = "200";

// ── Simulador de Runway ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runway-sim-"));
const PNG = path.join(tmp, "img.png");
const MP4 = path.join(tmp, "clip.mp4");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720", "-frames:v", "1", PNG]);
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=24:d=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", MP4]);
type Req = { path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders };
const sim = { requests: [] as Req[], tasks: new Map<string, { kind: string; polls: number; credits: number; fail?: string }>(), failNext: null as string | null };
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (url.startsWith("/files/")) {
        const f = url.endsWith(".mp4") ? MP4 : PNG;
        res.writeHead(200, { "content-type": url.endsWith(".mp4") ? "video/mp4" : "image/png", "content-length": fs.statSync(f).size });
        return res.end(fs.readFileSync(f));
      }
      if (req.headers.authorization !== "Bearer key_prueba_simulador" || req.headers["x-runway-version"] !== "2024-11-06") return send(401, { error: "bad auth" });
      if (req.method === "GET" && url === "/v1/organization") return send(200, { creditBalance: 1000, tier: { maxMonthlyCreditSpend: 10000 } });
      if (req.method === "POST" && (url === "/v1/text_to_image" || url === "/v1/image_to_video")) {
        const body = JSON.parse(raw);
        sim.requests.push({ path: url, body, headers: req.headers });
        const id = `t${sim.requests.length}`;
        const isVideo = url === "/v1/image_to_video";
        const m = isVideo ? VIDEO_MODELS.find((x) => x.id === body.model)! : null;
        const credits = isVideo ? Math.ceil(m!.creditsPerSecond * Number(body.duration) + m!.extraCredits) : imageModel(String(body.model)).credits;
        sim.tasks.set(id, { kind: isVideo ? "mp4" : "png", polls: 0, credits, fail: sim.failNext ?? undefined });
        sim.failNext = null;
        return send(200, { id });
      }
      const m = url.match(/^\/v1\/tasks\/(.+)$/);
      if (req.method === "GET" && m) {
        const t = sim.tasks.get(m[1]);
        if (!t) return send(404, { error: "not found" });
        t.polls++;
        if (t.polls < 2) return send(200, { id: m[1], createdAt: "x", status: "RUNNING", progress: 0.5, estimatedCost: { credits: t.credits } });
        if (t.fail) return send(200, { id: m[1], createdAt: "x", status: "FAILED", failure: t.fail, failureCode: "SAFETY.INPUT.TEXT", cost: { credits: t.credits } });
        return send(200, { id: m[1], createdAt: "x", status: "SUCCEEDED", output: [`http://127.0.0.1:${PORT}/files/${m[1]}.${t.kind}`], cost: { credits: t.credits } });
      }
      send(404, { error: "no route" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  PORT = (server.address() as { port: number }).port;
  process.env.RUNWAY_API_BASE = `http://127.0.0.1:${PORT}`;
});
after(() => server.close());

const text = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8");
const sources = { pexels: false, pixabay: false, unsplash: false, wikimedia: false, nasa: false, biblioteca: false };
const shots = (n: number) =>
  Array.from({ length: n }, (_, gi) => ({ gi, sceneId: gi + 1, text: gi === 0 ? "Él viene con las nubes y todo ojo le verá" : gi === n - 1 ? "Entrégale tu vida a Jesucristo, él te ofrece salvación" : `Los analistas hablan del dinero digital, escena ${gi}`, seconds: 3.6, verse: false }));

test("precios oficiales y duración de clips", () => {
  assert.equal(clipSeconds(videoModel("gen4_turbo"), 4.2), 5);
  assert.equal(clipSeconds(videoModel("veo3.1_fast"), 4.2), 6, "Veo solo admite 4, 6 u 8 s");
  assert.equal(videoCostUSD(videoModel("gen4_turbo"), 5), 0.25, "5 créditos/s × 5 s × 0,01 USD");
  assert.equal(videoCostUSD(videoModel("grok_imagine_1_5_lite"), 5), 0.16, "3 créditos/s + 1 por imagen inicial");
  assert.equal(imageCostUSD(imageModel("muse_image")), 0.01);
  assert.equal(imageCostUSD(imageModel("gen4_image")), 0.08);
});

test("inteligencia visual bíblica: instrucciones según el significado", () => {
  assert.equal(themeOf("y verán al Hijo del Hombre: la segunda venida de Cristo").id, "segunda_venida");
  assert.equal(themeOf("el sueño de Nabucodonosor interpretado por Daniel").id, "daniel");
  assert.equal(themeOf("Jerusalén vuelve a estar en el centro del mundo").id, "israel");
  assert.equal(themeOf("dedica tiempo a la oración cada mañana").id, "oracion");
  assert.equal(themeOf("se abrieron los sellos del Apocalipsis").id, "apocalipsis");
  const p = imagePrompt({ text: "Él viene con las nubes", format: "9:16" });
  assert.ok(p.theme.recreation, "las escenas proféticas se rotulan como recreación artística");
  assert.match(p.prompt, /Hyperrealistic cinematic/);
  assert.match(p.prompt, /Anatomically correct hands/);
  assert.match(p.prompt, /No text/);
  assert.match(p.prompt, /face never visible/);
});

test("planes: económico, premium e inteligente, siempre dentro del presupuesto", () => {
  const eco = buildPlan({ mode: "economico", format: "16:9", budgetUSD: 5, shots: shots(10) });
  assert.equal(eco.clips, 0);
  assert.equal(eco.images, 10);
  assert.equal(eco.totalUSD, 0.1, "10 imágenes Muse × 0,01 USD");

  const prem = buildPlan({ mode: "premium", format: "16:9", budgetUSD: 50, shots: shots(10) });
  assert.equal(prem.clips, 10);
  assert.ok(prem.items.every((x) => x.clipSeconds === 5), "tomas de 3,6 s → clips de 5 s");
  assert.equal(prem.totalUSD, 10 * (0.01 + 0.25));

  const smart = buildPlan({ mode: "inteligente", format: "9:16", budgetUSD: 5, shots: shots(10) });
  assert.ok(smart.clips >= 1 && smart.clips <= 3, `≈30 % con video: ${smart.clips}`);
  assert.equal(smart.items[0].kind, "video", "el gancho inicial lleva video IA");
  assert.equal(smart.items[9].kind, "video", "el cierre evangelístico lleva video IA");
  assert.ok(smart.items.filter((x) => x.kind === "stock").every((x) => x.fallbackImage), "el resto: gratis, con imagen IA de respaldo");
  assert.ok(smart.maxUSD <= 5);

  // presupuesto corto: menos clips, nunca se supera
  const tight = buildPlan({ mode: "premium", format: "16:9", budgetUSD: 1, shots: shots(10) });
  assert.ok(tight.maxUSD <= 1, `máximo ${tight.maxUSD}`);
  assert.ok(tight.clips < 10 && tight.warnings.length > 0);
  // toma larga (8 s): dos escenas IA de 4 s, para mantener cambios de 3–5 s
  const long = buildPlan({ mode: "premium", format: "16:9", budgetUSD: 50, shots: [{ ...shots(1)[0], seconds: 8 }] });
  assert.equal(long.items.length, 2);
  assert.ok(long.items.every((x) => x.seconds === 4 && x.clipSeconds === 5));
  // escena fijada a mano por la usuaria: no se genera nada para ella
  const locked = buildPlan({ mode: "premium", format: "16:9", budgetUSD: 50, shots: shots(3).map((s, i) => ({ ...s, locked: i === 1 })) });
  assert.equal(locked.items[1].kind, "stock");
});

test("producción completa: nada de pago antes de autorizar; luego genera, registra el costo real y no repite", { timeout: 600_000 }, async () => {
  saveSettings({ LLM_PROVIDER: "local", RUNWAY_API_KEY: "key_prueba_simulador", MONTHLY_BUDGET_USD: "50" });
  const id = createProject({ text, settings: { duration: 30, resolution: 720, format: "9:16", voiceId: "silencio", sources, visualMode: "inteligente", aiBudget: 3 } });

  // 1) Sin autorización: se detiene ANTES de llamar a Runway
  sim.requests.length = 0;
  await assert.rejects(produce(id, () => undefined), (e: unknown) => e instanceof AwaitingAiAuthorization);
  assert.equal(sim.requests.length, 0, "ninguna generación sin autorización");
  const plan = getPlan(id)!;
  assert.equal(plan.approved, false);
  assert.ok(plan.clips >= 1 && plan.maxUSD <= 3);

  // 2) Autoriza → genera (secuencialmente) solo lo del plan
  approvePlan(id);
  await produce(id, () => undefined);
  const imgs = sim.requests.filter((r) => r.path === "/v1/text_to_image");
  const vids = sim.requests.filter((r) => r.path === "/v1/image_to_video");
  assert.equal(vids.length, plan.clips, "un clip por toma de video del plan");
  assert.ok(imgs.length >= plan.clips, "cada clip parte de una imagen IA");
  for (const v of vids) {
    assert.equal(v.body.model, "gen4_turbo");
    assert.equal(v.body.ratio, "720:1280", "vertical 9:16");
    assert.ok([2, 3, 4, 5, 6].includes(Number(v.body.duration)), `clip de ${v.body.duration} s (escenas de 3–5 s)`);
    // con URLs https reales se reenvía la salida de Runway; aquí (http local) se envía la imagen generada en base64
    assert.match(String(v.body.promptImage), /^(https:\/\/|data:image\/png;base64,)/, "parte de la imagen IA recién generada");
  }
  assert.equal(imgs[0].body.ratio, "1152:2016");
  const cost = db().prepare("SELECT COALESCE(SUM(cost),0) AS c FROM cost_ledger WHERE project_id = ? AND provider = 'runway'").get(id) as { c: number };
  const expected = imgs.length * 0.01 + vids.reduce((a, v) => a + Number(v.body.duration) * 5 * 0.01, 0);
  assert.ok(Math.abs(cost.c - expected) < 0.001, `costo real registrado ${cost.c} = ${expected}`);
  const p = getProject(id)!;
  assert.ok(p.spent_cost <= p.authorized_cost + 1e-6, "nunca se supera lo autorizado");
  assert.ok(fs.existsSync(p.output_path!), "video exportado");
  const ass = fs.readFileSync(path.join(path.dirname(p.output_path!), "graficos.ass"), "utf8");
  assert.match(ass, /Recreación artística generada con IA/);
  const aiScenes = getScenes(id).filter((s) => s.asset_id && (db().prepare("SELECT provider FROM assets WHERE id = ?").get(s.asset_id) as { provider: string }).provider === "runway-ia");
  assert.ok(aiScenes.length >= plan.clips);

  // 3) Volver a renderizar / reanudar: no se repite ninguna generación
  sim.requests.length = 0;
  await produce(id, () => undefined);
  assert.equal(sim.requests.length, 0, "cero generaciones nuevas al reanudar");
});

test("si Runway falla en una escena, se usa un recurso gratuito (sin otro proveedor de pago)", { timeout: 600_000 }, async () => {
  const id = createProject({ text, settings: { duration: 15, resolution: 720, format: "16:9", voiceId: "silencio", sources, visualMode: "premium", aiBudget: 5 } });
  await assert.rejects(produce(id, () => undefined), (e: unknown) => e instanceof AwaitingAiAuthorization);
  approvePlan(id);
  sim.requests.length = 0;
  sim.failNext = "Contenido rechazado por moderación";
  await produce(id, () => undefined);
  const plan = getPlan(id)!;
  const failed = plan.items.filter((x) => x.status === "gratis");
  assert.equal(failed.length, 1, "una escena falló");
  assert.ok(sim.requests.every((r) => r.headers.host === `127.0.0.1:${PORT}`), "solo Runway, ningún otro proveedor");
  assert.ok(fs.existsSync(getProject(id)!.output_path!), "el video se terminó igualmente");
});

test("reanudación tras un reinicio: espera la tarea ya creada en Runway en vez de pagar otra", { timeout: 600_000 }, async () => {
  const id = createProject({ text, settings: { duration: 15, resolution: 720, format: "1:1", voiceId: "silencio", sources, visualMode: "economico", aiBudget: 2 } });
  await assert.rejects(produce(id, () => undefined), (e: unknown) => e instanceof AwaitingAiAuthorization);
  approvePlan(id);
  // simula un corte: la primera imagen ya se había pedido a Runway (taskId guardado) cuando se reinició el servidor
  const plan = getPlan(id)!;
  sim.requests.length = 0;
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/text_to_image`, { method: "POST", headers: { Authorization: "Bearer key_prueba_simulador", "X-Runway-Version": "2024-11-06", "content-type": "application/json" }, body: JSON.stringify({ model: "muse_image", promptText: "x", ratio: "1600:1600" }) });
  const { id: taskId } = (await r.json()) as { id: string };
  plan.items[0].imageTaskId = taskId;
  db().prepare("UPDATE projects SET ai_plan = ? WHERE id = ?").run(JSON.stringify(plan), id);
  sim.requests.length = 0;
  await produce(id, () => undefined);
  const imgs = sim.requests.filter((x) => x.path === "/v1/text_to_image");
  assert.equal(imgs.length, plan.items.filter((x) => x.kind === "image").length - 1, "la escena interrumpida no se vuelve a pagar");
});
