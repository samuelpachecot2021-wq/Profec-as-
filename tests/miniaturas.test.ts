import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.WM_MIN_GAP_MS = "0";

import { saveSettings } from "../src/lib/settings";
import { createProject, getProject, projectView } from "../src/lib/projects";
import { insertAsset } from "../src/lib/media";
import { db } from "../src/lib/db";
import { DATA_DIR } from "../src/lib/paths";
import { generateThumbnails, updateHeadline, replacePhoto, selectProposal, loadThumbState, searchPhotos } from "../src/lib/thumbnails";
import { layoutText } from "../src/lib/thumbs/design";
import { honestHeadline, localAnalysis } from "../src/lib/thumbs/analyze";
import { textWidth } from "../src/lib/thumbs/fontmetrics";

saveSettings({ LLM_PROVIDER: "local", THUMBNAIL_STYLE: "inteligente" });

// ── Wikidata / Commons simulados ──
const IMG = path.join(DATA_DIR, "fixtures");
fs.mkdirSync(IMG, { recursive: true });
const persona = path.join(IMG, "persona.jpg");
const lugar = path.join(IMG, "lugar.jpg");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1536x2048", "-frames:v", "1", persona]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "smptehdbars=s=1920x1080", "-frames:v", "1", lugar]);

const entity = (id: string, label: string, p31: string, p18?: string, en?: string) => ({
  id,
  labels: { es: { value: label }, ...(en ? { en: { value: en } } : {}) },
  descriptions: { es: { value: "descripción" } },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: p31 } } } }],
    ...(p18 ? { P18: [{ mainsnak: { datavalue: { value: p18 } } }] } : {}),
  },
});
const ENTITIES: Record<string, unknown> = {
  Q22686: entity("Q22686", "Donald Trump", "Q5", "Retrato oficial de Donald Trump (2025).jpg"),
  Q1218: entity("Q1218", "Jerusalén", "Q515", "Cúpula de la Roca.jpg", "Jerusalem"),
  // impostor: el identificador no corresponde a un ser humano → no se debe aceptar como persona
  Q43723: entity("Q43723", "Benjamín Netanyahu", "Q4167410"),
  Q30: entity("Q30", "Estados Unidos", "Q6256"),
};
const page = (title: string, license: string, date: string, file: string, w: number, h: number) => ({
  title: `File:${title}`,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/test/${file}`,
      thumburl: `https://upload.wikimedia.org/test/${file}`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
      width: w,
      height: h,
      mime: "image/jpeg",
      extmetadata: { LicenseShortName: { value: license }, DateTimeOriginal: { value: date }, Artist: { value: "<a>Fotógrafo oficial</a>" } },
    },
  ],
});
const DEPICTS: Record<string, unknown[]> = {
  Q22686: [
    page("Donald Trump en un acto en 2026.jpg", "Public domain", "2026-11-16", "persona.jpg", 2533, 3800),
    page("Donald Trump discurso.jpg", "CC BY-NC 4.0", "2026-10-01", "persona.jpg", 2000, 3000), // licencia no comercial → rechazada
    page("Donald Trump wax statue.jpg", "CC0", "2026-09-01", "persona.jpg", 2000, 3000), // estatua de cera → rechazada
  ],
  Q1218: [page("Jerusalem Old City 2025.jpg", "CC BY 4.0", "2025-03-10", "lugar.jpg", 1920, 1080)],
};
let wmCalls = 0;
let offline = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (/wikidata|wikimedia|pexels|pixabay|unsplash|nasa|msedge|bing/.test(url.host)) {
    if (offline) throw new TypeError("fetch failed");
    wmCalls++;
    const q = url.searchParams;
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (url.host === "upload.wikimedia.org") return new Response(fs.readFileSync(path.join(IMG, path.basename(url.pathname))), { status: 200 });
    if (url.host === "www.wikidata.org") {
      if (q.get("action") === "wbgetentities") {
        const ents: Record<string, unknown> = {};
        for (const id of (q.get("ids") ?? "").split("|")) ents[id] = ENTITIES[id] ?? { id, missing: "" };
        return json({ entities: ents });
      }
      const term = (q.get("search") ?? "").toLowerCase();
      return json({ search: Object.entries(ENTITIES).filter(([, e]) => (e as { labels: { es: { value: string } } }).labels.es.value.toLowerCase().includes(term)).map(([id]) => ({ id })) });
    }
    if (url.host === "commons.wikimedia.org") {
      const s = q.get("gsrsearch") ?? "";
      const m = s.match(/P180=(Q\d+)/);
      if (m) return json({ query: { pages: DEPICTS[m[1]] ?? [] } });
      const t = q.get("titles") ?? "";
      if (t.includes("Retrato oficial")) return json({ query: { pages: [page(t.replace(/^File:/, ""), "Public domain", "2025-06-02", "persona.jpg", 1536, 2048)] } });
      if (t.includes("Cúpula")) return json({ query: { pages: [page(t.replace(/^File:/, ""), "CC BY-SA 4.0", "2012-01-01", "lugar.jpg", 1920, 1080)] } });
      return json({ query: { pages: [] } });
    }
    throw new TypeError("sin red en pruebas");
  }
  return realFetch(input, init);
}) as typeof fetch;

const NEWS = `El presidente Donald Trump anunció esta semana un acuerdo de paz y viajó a Jerusalén para reunirse con el primer ministro Benjamín Netanyahu. Trump aseguró que el acuerdo de paz cambiará la región. Estados Unidos apoyará el acuerdo de paz. Muchos creyentes se preguntan si tiene relación con Daniel 9:27. Jerusalén sigue en el centro de la historia, como anunció Zacarías 12:3.`;
const BIBLE = `El arrebatamiento de la Iglesia es una de las promesas más hermosas de las Escrituras. En un abrir y cerrar de ojos, dice 1 Corintios 15:52, los creyentes serán transformados. Jesucristo prometió volver por los suyos. Esta profecía nos llama a vivir en santidad y esperanza, velando y orando cada día.`;

function project(script: string, format: string) {
  const id = createProject({ title: script.split(".")[0], text: script, script, settings: { format } as never });
  const dir = path.join(DATA_DIR, "projects", id, "media");
  fs.mkdirSync(dir, { recursive: true });
  const stock = path.join(dir, "stock.jpg");
  const ia = path.join(dir, "ia.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=1920x1080", "-frames:v", "1", stock]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "mandelbrot=s=1920x1080", "-frames:v", "1", ia]);
  const a = insertAsset(id, { provider: "pexels", kind: "image", externalId: "s1", license: "Licencia Pexels", attribution: "Foto de Ana en Pexels", localPath: stock });
  const b = insertAsset(id, { provider: "runway-ia", kind: "image", externalId: "r1", license: "Imagen generada con IA", attribution: "Recreación artística (Runway)", localPath: ia, isAi: true });
  const ins = db().prepare("INSERT INTO scenes (project_id, idx, text, start, end, query, asset_id) VALUES (?,?,?,?,?,?,?)");
  ins.run(id, 0, "a", 0, 4, "q", b);
  ins.run(id, 1, "b", 4, 8, "q", a);
  return { id, aiAsset: b };
}

const dims = (f: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).toString().trim();

test("titular: el tamaño de letra se ajusta al ancho disponible, al píxel", () => {
  for (const [w, h] of [
    [960, 700],
    [960, 500],
  ]) {
    const L = layoutText("EL ARREBATAMIENTO ESTÁ MÁS CERCA DE LO QUE PIENSA", ["ARREBATAMIENTO"], w, h, 3, 200, 40);
    assert.ok(L.lines.length <= 3);
    for (const line of L.lines) assert.ok(line.width <= w, `línea de ${line.width} px en caja de ${w} px`);
    assert.ok(L.size >= 60, `letra demasiado pequeña: ${L.size}`);
  }
  // el medidor coincide con FFmpeg (442 px medidos en un render real de «TRUMP» a 120 px)
  assert.ok(Math.abs(textWidth("TRUMP", "Inter-Black.otf", 120) - 442) < 4);
});

test("titulares honestos: sin datos que el guion no respalde y sin «rapto»", () => {
  assert.equal(honestHeadline("Trump y Jerusalén", NEWS), "TRUMP Y JERUSALÉN");
  assert.equal(honestHeadline("El rapto está cerca", BIBLE), "EL ARREBATAMIENTO ESTÁ CERCA");
  assert.equal(honestHeadline("Trump confirmado: 2030", NEWS), null); // cifra y «confirmado» no están en el guion
  assert.equal(honestHeadline("Putin y Trump", NEWS), null); // Putin no aparece en el guion
  assert.equal(honestHeadline("Última hora: Trump muere", NEWS), null);
  assert.equal(honestHeadline("Un titular demasiado largo para una miniatura de YouTube", NEWS), null);
});

test("análisis del guion: protagonistas, lugares, acontecimiento y estilo", () => {
  const a = localAnalysis({ script: NEWS, title: "Trump y Jerusalén", topic: "Israel y Jerusalén" });
  assert.equal(a.style, "noticias");
  assert.equal(a.people[0].name, "Donald Trump");
  assert.ok(a.places.some((p) => p.name === "Jerusalén"));
  assert.equal(a.event?.name, "Acuerdo de paz");
  assert.match(a.headlines.protagonista, /TRUMP/);
  const b = localAnalysis({ script: BIBLE, title: "El arrebatamiento", topic: "El arrebatamiento de la Iglesia" });
  assert.equal(b.style, "biblico");
  assert.equal(b.people.length, 0);
});

test("noticias 9:16: 3 propuestas 1080×1920 con fotos reales verificadas y sin recreaciones IA", async () => {
  const { id } = project(NEWS, "9:16");
  const st = await generateThumbnails({ projectId: id });
  assert.equal(st.style, "noticias");
  assert.equal(st.proposals.length, 3);
  for (const p of st.proposals) {
    assert.equal(dims(p.file), "1080,1920");
    assert.ok(p.bytes > 20_000 && p.bytes <= 2_000_000, `tamaño ${p.bytes}`);
    assert.notEqual(p.photo?.kind, "ia", "en noticias nunca se usan recreaciones IA");
    assert.equal(p.aiGenerated, false);
  }
  const prota = st.proposals[0];
  assert.equal(prota.photo?.kind, "real");
  assert.equal(prota.photo?.subjectQid, "Q22686");
  assert.match(prota.photo!.verified!, /Wikidata|representa a/);
  assert.equal(prota.name, "Donald Trump");
  assert.equal(st.proposals[1].photo?.subjectQid, "Q1218", "el acontecimiento usa la foto del lugar mencionado");
  // licencias no comerciales y estatuas de cera descartadas; impostor sin verificar → sin fotos suyas
  assert.ok(!st.candidates.some((c) => /NC/.test(c.license) || /wax/i.test(c.title)));
  assert.ok(!st.candidates.some((c) => c.subject === "Benjamín Netanyahu"));
  assert.ok(st.warnings.some((w) => w.includes("Netanyahu")));
  // CC BY-SA no está autorizado por defecto
  assert.ok(!st.candidates.some((c) => /SA/.test(c.license)));
  // créditos de las fotos en el archivo de licencias y descarga principal
  const cred = fs.readFileSync(path.join(DATA_DIR, "projects", id, "salida", "creditos-y-licencias.txt"), "utf8");
  assert.match(cred, /Miniatura: .*Public domain/);
  assert.match(projectView(id)!.thumbnails[0], /miniatura-1\.jpg$/);
});

test("noticias 16:9: 1920×1080; editar titular y elegir principal no rehacen las demás", async () => {
  const { id, aiAsset } = project(NEWS, "16:9");
  const st = await generateThumbnails({ projectId: id });
  for (const p of st.proposals) assert.equal(dims(p.file), "1920,1080");
  const before = st.proposals.map((p) => fs.statSync(p.file).mtimeMs);
  const callsBefore = wmCalls;
  await new Promise((r) => setTimeout(r, 30));
  const r = await updateHeadline(id, 2, "¿Se acerca el rapto?", ["rapto"]);
  assert.equal(r.state.proposals[2].headline, "¿SE ACERCA EL ARREBATAMIENTO?");
  const after = r.state.proposals.map((p) => fs.statSync(p.file).mtimeMs);
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
  assert.ok(after[2] > before[2]);
  assert.equal(wmCalls, callsBefore, "editar el titular no hace búsquedas nuevas");
  const w = await updateHeadline(id, 1, "Trump confirmado 2030", []);
  assert.ok(w.warning, "se avisa de un titular no respaldado por el guion");
  // en noticias no se permite usar una recreación IA
  await assert.rejects(replacePhoto(id, 0, `asset:${aiAsset}`), /recreaciones IA/);
  // sustituir la foto por otra candidata (la del lugar) solo rehace esa propuesta
  const place = loadThumbState(id)!.candidates.find((c) => c.subjectQid === "Q1218")!;
  const r2 = await replacePhoto(id, 0, place.id);
  assert.equal(r2.proposals[0].photo?.id, place.id);
  assert.equal(r2.proposals[0].name, null, "el rótulo con nombre solo aparece sobre la foto verificada de esa persona");
  await selectProposal(id, 2);
  assert.match(projectView(id)!.thumbnails[0], /miniatura-3\.jpg$/);
  // búsqueda manual de una persona: identidad verificada
  const s = await searchPhotos(id, "Donald Trump", "person");
  assert.ok(s.results.length >= 1 && s.results.every((c) => c.kind === "real"));
});

test("bíblico: estilo cinematográfico con las imágenes del video; la IA se identifica de forma discreta", async () => {
  const { id } = project(BIBLE, "9:16");
  const calls = wmCalls;
  const st = await generateThumbnails({ projectId: id });
  assert.equal(st.style, "biblico");
  assert.equal(wmCalls, calls, "el estilo bíblico no busca fotos de noticias");
  const ai = st.proposals.find((p) => p.photo?.kind === "ia");
  assert.ok(ai, "usa las imágenes IA (Runway) ya generadas");
  assert.equal(ai!.aiGenerated, true);
  const bytes = fs.readFileSync(ai!.file);
  assert.ok(bytes.includes(Buffer.from("recreacion artistica generada con IA")), "marca dentro del archivo, no sobre la imagen");
  for (const p of st.proposals) assert.equal(dims(p.file), "1080,1920");
  // forzar «Noticias y actualidad» en Ajustes: nunca usa la recreación IA
  const st2 = await generateThumbnails({ projectId: id, style: "noticias", reuseAnalysis: true });
  assert.ok(st2.proposals.every((p) => p.photo?.kind !== "ia"));
});

test("las miniaturas ya no llevan «Imagen ilustrativa» ni marcas de agua", () => {
  for (const f of ["src/lib/thumbnails.ts", "src/lib/thumbs/design.ts"]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /Imagen ilustrativa/);
});

test("sin conexión: las propuestas se crean igualmente con los recursos del video y sin esperas largas", async () => {
  offline = true;
  fs.rmSync(path.join(DATA_DIR, "cache", "miniaturas"), { recursive: true, force: true });
  try {
    const { id } = project(NEWS.replace(/Trump/g, "el mandatario"), "16:9");
    const t0 = Date.now();
    const st = await generateThumbnails({ projectId: id });
    assert.ok(Date.now() - t0 < 30_000, `tardó ${Date.now() - t0} ms`);
    assert.equal(st.proposals.length, 3);
    for (const p of st.proposals) assert.equal(dims(p.file), "1920,1080");
    assert.ok(getProject(id)!.thumbnails);
  } finally {
    offline = false;
  }
});
