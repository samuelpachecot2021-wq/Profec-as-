import { activeProvider, claudeModel } from "@/lib/llm";
import { hasKey, getSetting } from "@/lib/settings";
import { run } from "@/lib/util";
import { startWorker, maxConcurrent } from "@/lib/queue";
import { piperAvailable } from "@/lib/tts";
import { renderProfile, resourceSummary } from "@/lib/resources";
import { storagePersistent } from "@/lib/paths";
import { ok } from "@/lib/api";

export const runtime = "nodejs";

let ffmpegOk: boolean | null = null;

export async function GET() {
  startWorker();
  if (ffmpegOk === null) {
    try {
      await run("ffmpeg", ["-version"]);
      ffmpegOk = true;
    } catch {
      ffmpegOk = false;
    }
  }
  const provider = await activeProvider();
  return ok({
    ffmpeg: ffmpegOk,
    llm: provider,
    llmLabel: provider === "claude" ? `Claude (${claudeModel()})` : provider === "ollama" ? `Ollama (${getSetting("OLLAMA_MODEL")})` : "Modo local (sin IA)",
    media: {
      pexels: hasKey("PEXELS_API_KEY"),
      pixabay: hasKey("PIXABAY_API_KEY"),
      unsplash: hasKey("UNSPLASH_ACCESS_KEY"),
      wikimedia: true,
      nasa: true,
    },
    voices: { elevenlabs: hasKey("ELEVENLABS_API_KEY"), azure: hasKey("AZURE_SPEECH_KEY") },
    aiImages: hasKey("OPENAI_API_KEY"),
    server: { ...renderProfile(), concurrency: maxConcurrent(), piper: piperAvailable(), summary: resourceSummary(), persistent: storagePersistent() },
  });
}
