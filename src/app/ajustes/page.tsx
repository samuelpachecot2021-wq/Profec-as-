"use client";
import { useEffect, useState } from "react";
import { MUSIC_STYLES } from "@/lib/options";
import { Alert, Button, Card, Field, Select, api, inputCls } from "@/components/ui";

type S = {
  secrets: Record<string, { configured: boolean; masked: string; source: string }>;
  plain: Record<string, string>;
  monthSpent: number;
  monthlyBudget: number;
};

const KEYS: { key: string; label: string; help: string; url: string; free: boolean }[] = [
  { key: "PEXELS_API_KEY", label: "Pexels (videos y fotos)", help: "Gratis. Regístrese y copie su clave API.", url: "https://www.pexels.com/api/", free: true },
  { key: "PIXABAY_API_KEY", label: "Pixabay (videos y fotos)", help: "Gratis. Inicie sesión y la clave aparece en la documentación de la API.", url: "https://pixabay.com/api/docs/", free: true },
  { key: "UNSPLASH_ACCESS_KEY", label: "Unsplash (fotos)", help: "Gratis. Cree una aplicación y copie la «Access Key».", url: "https://unsplash.com/developers", free: true },
  { key: "ANTHROPIC_API_KEY", label: "Claude (guiones, traducción, SEO)", help: "De pago por uso (céntimos por video). La app siempre pide autorización antes de gastar.", url: "https://console.anthropic.com/", free: false },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs (voz más humana)", help: "De pago según plan.", url: "https://elevenlabs.io/", free: false },
  { key: "AZURE_SPEECH_KEY", label: "Azure Speech (voz estable)", help: "Tiene un nivel gratuito mensual. Indique también la región.", url: "https://portal.azure.com/", free: false },
  { key: "OPENAI_API_KEY", label: "OpenAI (imágenes con IA)", help: "De pago por imagen. Solo se usa si activa «Imágenes con IA».", url: "https://platform.openai.com/", free: false },
];

export default function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<S>("/api/settings").then((r) => {
      setS(r);
      setVals(r.plain);
    });
  }, []);

  async function save(extra: Record<string, string> = {}) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const body: Record<string, string> = { ...extra };
      for (const [k, v] of Object.entries(vals)) if (v !== undefined && (s?.plain[k] !== v || k in extra)) body[k] = v;
      const r = await api<S>("/api/settings", { method: "POST", json: body });
      setS(r);
      setVals(r.plain);
      setMsg("Ajustes guardados de forma segura en su equipo.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <p className="text-zinc-400">Cargando…</p>;
  const v = (k: string) => vals[k] ?? "";
  const setV = (k: string, x: string) => setVals((o) => ({ ...o, [k]: x }));

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-extrabold text-white">Ajustes</h1>
      <Alert kind="info">
        🔒 Las claves se guardan solo en este equipo (archivo <code>data/secrets.json</code>, que nunca se sube a GitHub) y nunca se envían al navegador: aquí solo verá los últimos caracteres.
      </Alert>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {err && <Alert kind="error">{err}</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Claves de servicios">
          <div className="space-y-4">
            {KEYS.map((k) => {
              const st = s.secrets[k.key];
              return (
                <div key={k.key} className="rounded-xl border border-line bg-ink p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white">
                      {k.label} {k.free ? <span className="text-emerald-400">· gratis</span> : <span className="text-amber-400">· de pago</span>}
                    </span>
                    {st?.configured ? <span className="text-xs text-emerald-400">✓ {st.masked}</span> : <span className="text-xs text-zinc-500">Sin configurar</span>}
                  </div>
                  <p className="mb-2 text-xs text-zinc-500">
                    {k.help}{" "}
                    <a href={k.url} target="_blank" rel="noreferrer" className="text-gold underline">
                      Obtener clave
                    </a>
                  </p>
                  <div className="flex gap-2">
                    <input type="password" autoComplete="off" className={inputCls} placeholder={st?.configured ? "Pegue una nueva clave para reemplazarla" : "Pegue aquí la clave"} value={v(k.key)} onChange={(e) => setV(k.key, e.target.value)} />
                    {st?.configured && st.source === "app" && (
                      <Button variant="ghost" onClick={() => save({ [k.key]: "" })} title="Borrar clave">
                        🗑
                      </Button>
                    )}
                  </div>
                  {k.key === "AZURE_SPEECH_KEY" && <input className={`${inputCls} mt-2`} placeholder="Región de Azure (ej. eastus)" value={v("AZURE_SPEECH_REGION")} onChange={(e) => setV("AZURE_SPEECH_REGION", e.target.value)} />}
                  {k.key === "ELEVENLABS_API_KEY" && <input className={`${inputCls} mt-2`} placeholder="ID de voz de ElevenLabs (masculina grave)" value={v("ELEVENLABS_VOICE_ID")} onChange={(e) => setV("ELEVENLABS_VOICE_ID", e.target.value)} />}
                  {k.key === "ANTHROPIC_API_KEY" && (
                    <div className="mt-2">
                      <Select
                        value={v("ANTHROPIC_MODEL") || "claude-opus-5-5"}
                        onChange={(x) => setV("ANTHROPIC_MODEL", x)}
                        options={[
                          { value: "claude-opus-5-5", label: "Claude Opus 5.5 — mejor calidad (recomendado)" },
                          { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — más económico" },
                          { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 — el más barato" },
                        ]}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Button variant="gold" className="mt-4 w-full" onClick={() => save()} loading={busy}>
            Guardar claves
          </Button>
        </Card>

        <div className="space-y-5">
          <Card title="Control de costos">
            <p className="mb-3 text-sm text-zinc-300">
              Gastado este mes: <b className="text-gold">${s.monthSpent.toFixed(2)}</b> de ${s.monthlyBudget.toFixed(2)}
            </p>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-ink">
              <div className="h-full bg-gold" style={{ width: `${Math.min(100, (s.monthSpent / Math.max(0.01, s.monthlyBudget)) * 100)}%` }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Presupuesto mensual (USD)" hint="La app se detiene antes de superarlo.">
                <input type="number" min={0} step={1} className={inputCls} value={v("MONTHLY_BUDGET_USD")} onChange={(e) => setV("MONTHLY_BUDGET_USD", e.target.value)} />
              </Field>
              <Field label="Proyectos por día (máximo)">
                <input type="number" min={1} max={100} className={inputCls} value={v("DAILY_PROJECT_LIMIT")} onChange={(e) => setV("DAILY_PROJECT_LIMIT", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Inteligencia artificial para el guion">
            <Field label="¿Qué motor usar?" hint="«Automático» usa Ollama si está instalado (gratis); si no, Claude; si no, el modo local.">
              <Select
                value={v("LLM_PROVIDER") || "auto"}
                onChange={(x) => setV("LLM_PROVIDER", x)}
                options={[
                  { value: "auto", label: "Automático (recomendado)" },
                  { value: "claude", label: "Claude (de pago, máxima calidad)" },
                  { value: "ollama", label: "Ollama (gratis, en mi equipo)" },
                  { value: "local", label: "Modo local sin IA (borrador básico)" },
                ]}
              />
            </Field>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Modelo de Ollama" hint="Ej.: qwen3:14b o llama3.1:8b">
                <input className={inputCls} value={v("OLLAMA_MODEL")} onChange={(e) => setV("OLLAMA_MODEL", e.target.value)} placeholder="(vacío = no usar Ollama)" />
              </Field>
              <Field label="Dirección de Ollama">
                <input className={inputCls} value={v("OLLAMA_URL")} onChange={(e) => setV("OLLAMA_URL", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Licencias de imágenes">
            <Field label="Wikimedia: permitir licencias CC BY-SA" hint="Por defecto solo se usan CC0, dominio público y CC BY, las más seguras para monetizar.">
              <Select value={v("ALLOW_CC_BY_SA") || "no"} onChange={(x) => setV("ALLOW_CC_BY_SA", x)} options={[{ value: "no", label: "No (recomendado)" }, { value: "si", label: "Sí, con atribución" }]} />
            </Field>
            <Button variant="gold" className="mt-4 w-full" onClick={() => save()} loading={busy}>
              Guardar preferencias
            </Button>
          </Card>

          <MusicLibrary />
        </div>
      </div>
    </div>
  );
}

function MusicLibrary() {
  const [styles, setStyles] = useState<{ value: string; label: string; tracks: string[] }[]>([]);
  const [style, setStyle] = useState("suspenso");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api<{ styles: typeof styles }>("/api/music").then((r) => setStyles(r.styles));
  useEffect(() => {
    load();
  }, []);
  return (
    <Card title="Biblioteca de música propia">
      <p className="mb-3 text-sm text-zinc-400">
        Por defecto la app compone una atmósfera instrumental original (sin derechos de terceros). Si prefiere pistas reales, descárguelas de la Biblioteca de audio de YouTube o de Pixabay Music y súbalas aquí, una vez, por estilo.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={style} onChange={setStyle} options={MUSIC_STYLES.filter((m) => m.value !== "ninguna")} />
        <label className="cursor-pointer whitespace-nowrap rounded-xl border border-line bg-panel2 px-4 py-2.5 text-center text-sm font-semibold hover:border-gold/50">
          🎵 Subir pista
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append("file", f);
              fd.append("style", style);
              try {
                await api("/api/music", { method: "POST", body: fd });
                setMsg(`«${f.name}» añadida.`);
                load();
              } catch (er) {
                setMsg((er as Error).message);
              }
            }}
          />
        </label>
      </div>
      {msg && <p className="mt-2 text-xs text-gold">{msg}</p>}
      <ul className="mt-3 space-y-1 text-xs text-zinc-400">
        {styles
          .filter((s) => s.tracks.length)
          .map((s) => (
            <li key={s.value}>
              <b className="text-zinc-200">{s.label}:</b> {s.tracks.join(", ")}
            </li>
          ))}
      </ul>
    </Card>
  );
}
