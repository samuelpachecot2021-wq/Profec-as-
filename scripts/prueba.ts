/**
 * Prueba de extremo a extremo SIN claves ni internet:
 * guion local → escenas → voz "silencio" → fondos locales → render MP4 → SRT → miniaturas → SEO.
 * Uso: npm run prueba
 */
import fs from "node:fs";
import { createProject, getProject, projectView } from "../src/lib/projects";
import { produce } from "../src/lib/pipeline";
import { saveSettings } from "../src/lib/settings";

async function main() {
  saveSettings({ LLM_PROVIDER: "local" });
  const text = fs.readFileSync("ejemplos/articulo-ejemplo.txt", "utf8");
  const dur = Number(process.env.DUR || 60);
  const id = createProject({
    text,
    settings: {
      duration: dur,
      voiceId: process.env.VOZ || "silencio",
      resolution: Number(process.env.RES || 720) as 720,
      format: (process.env.FMT || "16:9") as "16:9",
      sources: { pexels: false, pixabay: false, unsplash: false, wikimedia: false, nasa: false },
      translateSubsEn: false,
    },
  });
  console.log("Proyecto", id);
  const t = Date.now();
  await produce(id, (p, s) => process.stdout.write(`\r${Math.round(p * 100)}% ${s}`.padEnd(90)));
  console.log(`\nListo en ${((Date.now() - t) / 1000).toFixed(1)} s →`, getProject(id)!.output_path);
  const v = projectView(id)!;
  console.log("Escenas:", v.scenes.length, "| Miniaturas:", v.thumbnails.length, "| SRT:", v.srt);
  console.log("Títulos:", v.seo?.titles.map((x) => x.sentence));
}
main().catch((e) => {
  console.error("\nFALLÓ:", e);
  process.exit(1);
});
