import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "./settings";
import { fetchWithTimeout } from "./util";
import { recordCost, assertCanSpend } from "./costs";

export type LlmProvider = "claude" | "ollama" | "none";

/** Precios por millón de tokens (USD) para estimaciones. */
export const CLAUDE_PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-fable-5-2": { in: 8, out: 40 },
};

export function claudeModel() {
  return getSetting("ANTHROPIC_MODEL") || "claude-opus-5-5";
}

let ollamaCache: { ok: boolean; at: number } | null = null;
async function ollamaAvailable() {
  if (!getSetting("OLLAMA_MODEL")) return false;
  if (ollamaCache && Date.now() - ollamaCache.at < 30000) return ollamaCache.ok;
  try {
    const r = await fetchWithTimeout(`${getSetting("OLLAMA_URL")}/api/tags`, {}, 2500);
    ollamaCache = { ok: r.ok, at: Date.now() };
  } catch {
    ollamaCache = { ok: false, at: Date.now() };
  }
  return ollamaCache.ok;
}

export async function activeProvider(): Promise<LlmProvider> {
  const pref = getSetting("LLM_PROVIDER");
  const hasClaude = !!getSetting("ANTHROPIC_API_KEY");
  if (pref === "local") return "none";
  if (pref === "ollama") return (await ollamaAvailable()) ? "ollama" : "none";
  if (pref === "claude") return hasClaude ? "claude" : "none";
  // auto: prioriza lo gratuito (Ollama) y luego Claude
  if (await ollamaAvailable()) return "ollama";
  if (hasClaude) return "claude";
  return "none";
}

/** Estimación prudente (al alza) del costo de una llamada a Claude. */
export function estimateClaudeCost(inputChars: number, outputChars: number) {
  const p = CLAUDE_PRICES[claudeModel()] ?? CLAUDE_PRICES["claude-opus-5-5"];
  // ~3,5 caracteres por token en español; se suma margen por el razonamiento interno.
  const inTok = inputChars / 3.5 + 1500;
  const outTok = (outputChars / 3.5) * 1.8 + 1500;
  return (inTok * p.in + outTok * p.out) / 1_000_000;
}

type JsonSchema = Record<string, unknown>;

/**
 * Pide al modelo una respuesta JSON que cumple un esquema.
 * Claude: salidas estructuradas. Ollama: modo "format".
 */
export async function llmJson<T>(opts: {
  system: string;
  prompt: string;
  schema: JsonSchema;
  maxTokens?: number;
  projectId?: string;
  expectedOutputChars?: number;
  purpose: string;
}): Promise<T> {
  const provider = await activeProvider();
  if (provider === "none") throw new Error("No hay un modelo de IA configurado");

  if (provider === "ollama") {
    const r = await fetchWithTimeout(
      `${getSetting("OLLAMA_URL")}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: getSetting("OLLAMA_MODEL"),
          stream: false,
          format: opts.schema,
          options: { num_ctx: 32768, temperature: 0.6 },
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.prompt },
          ],
        }),
      },
      20 * 60_000,
    );
    if (!r.ok) throw new Error(`Ollama respondió ${r.status}: ${await r.text()}`);
    const data = (await r.json()) as { message?: { content?: string } };
    return parseJson<T>(data.message?.content ?? "");
  }

  if (opts.projectId) {
    assertCanSpend(opts.projectId, estimateClaudeCost(opts.system.length + opts.prompt.length, opts.expectedOutputChars ?? 4000));
  }

  const client = new Anthropic({ apiKey: getSetting("ANTHROPIC_API_KEY"), maxRetries: 3 });
  const model = claudeModel();
  try {
    const params = {
      model,
      max_tokens: opts.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: opts.schema },
      },
      messages: [{ role: "user", content: opts.prompt }],
    };
    const stream = client.beta.messages.stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
    const msg = await stream.finalMessage();
    const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-opus-5-5"];
    const cost = (msg.usage.input_tokens * p.in + msg.usage.output_tokens * p.out) / 1_000_000;
    recordCost({
      projectId: opts.projectId,
      provider: "claude",
      units: msg.usage.input_tokens + msg.usage.output_tokens,
      unit: "tokens",
      cost,
      note: opts.purpose,
    });
    if (msg.stop_reason === "refusal") throw new Error("El modelo rechazó la solicitud. Revise el contenido del artículo.");
    if (msg.stop_reason === "max_tokens")
      throw new Error("La respuesta del modelo quedó incompleta (límite de longitud). Pruebe con una duración menor.");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return parseJson<T>(text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("La clave de Anthropic (Claude) no es válida. Revísela en Ajustes.");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude está limitando las solicitudes. Espere un minuto y vuelva a intentar.");
    if (e instanceof Anthropic.APIError) throw new Error(`Error de Claude (${e.status}): ${e.message}`);
    throw e;
  }
}

function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("La IA devolvió una respuesta que no se pudo interpretar. Intente de nuevo.");
  }
}
