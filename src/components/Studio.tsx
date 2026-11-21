"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DEFAULT_SETTINGS, DURATIONS, FORMATS, MUSIC_STYLES, RESOLUTIONS, SUB_POSITIONS, VOICES, WPM, type ProjectSettings } from "@/lib/options";
import type { ProjectView } from "@/lib/projects";
import { Alert, Button, Card, CostDialog, Field, Select, Toggle, api, inputCls, fmtTime, type Estimate } from "./ui";
import { ScenesPanel } from "./ScenesPanel";
import { SeoPanel } from "./SeoPanel";
import { ThumbnailsPanel } from "./ThumbnailsPanel";
import { CoverDownload } from "./CoverDownload";
import { usePush } from "./pwa";
import { VisualModeField, AiPlanPanel } from "./AiVisual";

type Status = { ffmpeg: boolean; llm: string; llmLabel: string; media: Record<string, boolean>; voices: Record<string, boolean>; aiImages: boolean };
type AuthResp = { needsAuthorization?: boolean; estimate?: Estimate };

const KINDS = [
  { value: "articulo", label: "Artículo o noticia" },
  { value: "transcripcion", label: "Transcripción de un video" },
  { value: "guion", label: "Mi propio guion (ya elaborado)" },
] as const;

export function Studio({ projectId: initialId }: { projectId?: string }) {
  const [projectId, setProjectId] = useState<string | undefined>(initialId);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<string>("articulo");
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [script, setScript] = useState("");
  const [custom, setCustom] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const push = usePush();
  const loaded = useRef(false);

  // ── carga inicial ──
  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch(() => undefined);
  }, []);

  const load = useCallback(async (id: string) => {
    const v = await api<ProjectView>(`/api/projects/${id}`);
    setProject(v);
    return v;
  }, []);

  useEffect(() => {
    if (!initialId) return;
    load(initialId)
      .then((v) => {
        setText(v.inputText);
        setKind(v.inputKind);
        setSettings(v.settings);
        setScript(v.script);
        setCustom(!DURATIONS.some((d) => d.value === v.settings.duration));
        loaded.current = true;
      })
      .catch((e) => setError(e.message));
  }, [initialId, load]);

  // ── seguimiento del progreso ──
  const running = project?.job && ["en_cola", "procesando"].includes(project.job.status);
  useEffect(() => {
    if (!running || !projectId) return;
    const t = setInterval(() => {
      load(projectId)
        .then((v) => {
          if (v.script && v.script !== script && !busy) setScript(v.script);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [running, projectId, load, script, busy]);

  // ── guardado automático de ajustes ──
  useEffect(() => {
    if (!projectId || !loaded.current) return;
    const t = setTimeout(() => {
      api(`/api/projects/${projectId}`, { method: "PATCH", json: { settings } }).catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [settings, projectId]);

  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  async function ensureProject(): Promise<string> {
    if (projectId) {
      await api(`/api/projects/${projectId}`, { method: "PATCH", json: { inputText: text, settings, ...(script ? { script } : {}) } });
      return projectId;
    }
    if (!text.trim()) throw new Error("Primero pegue un artículo, una transcripción o un guion.");
    const { id } = await api<{ id: string }>("/api/projects", { method: "POST", json: { text, kind, settings } });
    setProjectId(id);
    loaded.current = true;
    window.history.replaceState(null, "", `/proyecto/${id}`);
    return id;
  }

  async function withAuth(fn: (authorize: boolean) => Promise<AuthResp>, label: string) {
    setError(null);
    setInfo(null);
    setBusy(label);
    try {
      const r = await fn(false);
      if (r.needsAuthorization && r.estimate) {
        setEstimate(r.estimate);
        pending.current = async () => {
          setEstimate(null);
          setBusy(label);
          try {
            await fn(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(null);
          }
        };
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const genScript = () =>
    withAuth(async (authorize) => {
      if (kind === "guion") {
        setScript(text);
        const id = await ensureProject();
        await api(`/api/projects/${id}`, { method: "PATCH", json: { script: text } });
        await load(id);
        return {};
      }
      const id = await ensureProject();
      const r = await api<AuthResp & { script?: string; warnings?: string[]; engine?: string }>(`/api/projects/${id}/script`, { method: "POST", json: { authorize } });
      if (r.script) {
        setScript(r.script);
        setInfo(`Guion generado (${r.engine === "local" ? "modo local" : r.engine === "claude" ? "Claude" : "Ollama"}). Revíselo y edítelo si lo desea; después pulse «Generar video completo».`);
        await load(id);
      }
      return r;
    }, "guion");

  const genVideo = () =>
    withAuth(async (authorize) => {
      const id = await ensureProject();
      if (script.trim()) await api(`/api/projects/${id}`, { method: "PATCH", json: { script } });
      else if (kind === "guion") await api(`/api/projects/${id}`, { method: "PATCH", json: { script: text } });
      const r = await api<AuthResp>(`/api/projects/${id}/render`, { method: "POST", json: { authorize } });
      if (!r.needsAuthorization) await load(id);
      return r;
    }, "video");

  async function cancel() {
    if (!projectId) return;
    await api(`/api/projects/${projectId}/render`, { method: "DELETE" });
    await load(projectId);
  }

  async function translate() {
    await withAuth(async (authorize) => {
      const r = await api<AuthResp & { text?: string; note?: string }>("/api/translate", { method: "POST", json: { text, authorize } });
      if (r.text) {
        setText(r.text);
        setInfo(r.note ?? "Texto traducido al español.");
      }
      return r;
    }, "traducir");
  }

  async function uploadDoc(f: File) {
    setBusy("archivo");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api<{ text: string; lang: string; langName: string }>("/api/extract", { method: "POST", body: fd });
      setText(r.text);
      setInfo(`Archivo cargado (${r.text.length.toLocaleString("es")} caracteres, idioma detectado: ${r.langName}).${r.lang !== "es" ? " El guion se escribirá en español automáticamente." : ""}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadNarration(f: File) {
    setBusy("narracion");
    try {
      const id = await ensureProject();
      const fd = new FormData();
      fd.append("file", f);
      const r = await api<{ duration: number }>(`/api/projects/${id}/narration`, { method: "POST", body: fd });
      setInfo(`Narración propia cargada (${fmtTime(r.duration)}). Las imágenes se sincronizarán con su voz.`);
      await load(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estDur = words ? Math.round((words / WPM) * 60 / settings.speed) : 0;
  const job = project?.job;
  const meta = project?.scriptMeta as { warnings?: string[]; engine?: string; topic?: string } | null;

  return (
    <div className="space-y-5">
      {status && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge ok={status.ffmpeg}>{status.ffmpeg ? "FFmpeg listo" : "Falta FFmpeg"}</Badge>
          <Badge ok={status.llm !== "none"} warn>{`Guion: ${status.llmLabel}`}</Badge>
          <Badge ok={status.media.pexels || status.media.pixabay} warn>{status.media.pexels || status.media.pixabay ? "Bancos de video conectados" : "Solo Wikimedia/NASA (añada Pexels gratis)"}</Badge>
          {(status.llm === "none" || !(status.media.pexels || status.media.pixabay)) && (
            <Link href="/ajustes" className="text-gold underline">
              Mejorar en Ajustes →
            </Link>
          )}
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="ok">{info}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* ── Columna izquierda ── */}
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <Card step="1" title="Contenido" right={project && <span className="block truncate text-xs text-zinc-500">{project.title}</span>}>
            <div className="mb-3 flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button key={k.value} onClick={() => setKind(k.value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${kind === k.value ? "border-gold bg-gold/15 text-gold" : "border-line text-zinc-400"}`}>
                  {k.label}
                </button>
              ))}
            </div>
            <textarea
              className={`${inputCls} min-h-56 resize-y leading-relaxed`}
              placeholder={kind === "guion" ? "Pegue aquí su guion terminado…" : "Pegue aquí el artículo o la transcripción (en español, inglés, árabe, portugués u otro idioma)…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-xl border border-line bg-panel2 px-4 py-2.5 text-sm font-semibold hover:border-gold/50">
                📄 Cargar TXT, PDF o Word
                <input type="file" accept=".txt,.pdf,.docx,.md,.srt,.vtt" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
              </label>
              <Button variant="ghost" onClick={translate} loading={busy === "traducir"} disabled={!text.trim()}>
                🌐 Traducir al español
              </Button>
              <span className="ml-auto text-xs text-zinc-500">{text.length.toLocaleString("es")} caracteres</span>
            </div>
          </Card>

          <Card step="2" title="Configuración del video">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Duración">
                <Select
                  value={custom ? -1 : settings.duration}
                  onChange={(v) => {
                    if (v === -1) setCustom(true);
                    else {
                      setCustom(false);
                      set("duration", v);
                    }
                  }}
                  options={[...DURATIONS, { value: -1, label: "Duración personalizada…" }]}
                />
                {custom && (
                  <div className="mt-2 flex items-center gap-2">
                    <input type="number" min={0.25} max={60} step={0.25} className={inputCls} value={settings.duration / 60} onChange={(e) => set("duration", Math.max(15, Math.round(parseFloat(e.target.value || "1") * 60)))} />
                    <span className="text-sm text-zinc-400">minutos</span>
                  </div>
                )}
              </Field>
              <VoiceField settings={settings} set={set} status={status} />
              <Field label="Formato">
                <Select value={settings.format} onChange={(v) => set("format", v)} options={FORMATS} />
              </Field>
              <Field label="Resolución" hint={settings.resolution >= 1440 ? "1440p y 4K tardan bastante más en producirse." : undefined}>
                <Select value={settings.resolution} onChange={(v) => set("resolution", v)} options={RESOLUTIONS} />
              </Field>
              <MusicField settings={settings} set={set} />
              <Field label="Subtítulos">
                <div className="space-y-2">
                  <Toggle checked={settings.subtitles} onChange={(v) => set("subtitles", v)} label="Subtítulos en el video" hint="Blancos con palabras clave en amarillo" />
                  {settings.subtitles && <Select value={settings.subPosition} onChange={(v) => set("subPosition", v)} options={SUB_POSITIONS} />}
                </div>
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <VisualModeField settings={settings} set={set} />
            </div>
            <details className="mt-4 rounded-xl border border-line bg-ink/50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-300">Opciones avanzadas</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Toggle checked={settings.translateSubsEn} onChange={(v) => set("translateSubsEn", v)} label="Subtítulos en inglés (SRT)" hint="Requiere Claude u Ollama" />
                <Toggle checked={settings.preferVideo} onChange={(v) => set("preferVideo", v)} label="Priorizar clips de video" hint="Sobre fotografías fijas" />
                <Toggle checked={settings.useAiImages} onChange={(v) => set("useAiImages", v)} label="Imágenes con IA si faltan" hint={status?.aiImages ? "De pago: pedirá autorización" : "Configure OpenAI en Ajustes"} />
                <div className="rounded-xl border border-line bg-ink p-3">
                  <span className="mb-2 block text-sm font-semibold text-zinc-200">Fuentes de imágenes</span>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(settings.sources) as (keyof ProjectSettings["sources"])[]).map((k) => (
                      <button key={k} onClick={() => set("sources", { ...settings.sources, [k]: !settings.sources[k] })} className={`rounded-full border px-2.5 py-1 text-xs capitalize ${settings.sources[k] ? "border-gold text-gold" : "border-line text-zinc-500 line-through"}`}>
                        {k}
                        {status && !status.media[k] ? " (sin clave)" : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="cursor-pointer rounded-xl border border-line bg-ink p-3 text-sm">
                  <span className="block font-semibold text-zinc-200">🎙️ Usar mi propia narración</span>
                  <span className="block text-xs text-zinc-500">{project?.customNarration ? "Narración propia cargada ✓ (pulse para reemplazar)" : "MP3, WAV o M4A"}</span>
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadNarration(e.target.files[0])} />
                </label>
                {project?.customNarration && (
                  <Button variant="ghost" onClick={async () => { await api(`/api/projects/${projectId}/narration`, { method: "DELETE" }); await load(projectId!); }}>
                    Volver a la voz automática
                  </Button>
                )}
              </div>
            </details>
          </Card>

          <Card step="3" title="Guion" right={words > 0 && <span className="text-xs text-zinc-400">{words} palabras · ≈ {fmtTime(estDur)}</span>}>
            {meta?.warnings?.map((w, i) => (
              <div key={i} className="mb-2">
                <Alert kind="warn">{w}</Alert>
              </div>
            ))}
            <textarea
              className={`${inputCls} min-h-48 resize-y leading-relaxed`}
              placeholder="Aquí aparecerá el guion. Puede editarlo libremente antes de producir el video."
              value={script}
              onChange={(e) => setScript(e.target.value)}
              onBlur={() => projectId && script && api(`/api/projects/${projectId}`, { method: "PATCH", json: { script } }).catch(() => undefined)}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Button big variant="dark" onClick={genScript} loading={busy === "guion"} disabled={!!running || !text.trim()}>
                ✍️ Generar guion
              </Button>
              <Button big variant="red" onClick={genVideo} loading={busy === "video"} disabled={!!running || (!text.trim() && !script.trim())}>
                🎬 Generar video completo
              </Button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Si pulsa directamente «Generar video completo», el guion se crea automáticamente.</p>
          </Card>
        </div>

        {/* ── Columna derecha ── */}
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card step="4" title="Producción">
            {job ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{labelStatus(job.status)}</span>
                  <span className="font-mono text-gold">{Math.round(job.progress * 100)} %</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-ink">
                  <div className={`h-full rounded-full ${running ? "progress-shine" : job.status === "error" ? "bg-blood" : "bg-gold"}`} style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
                </div>
                <p className="text-sm text-zinc-400">{job.step}</p>
                {job.status === "error" && <Alert kind="error">{job.error}</Alert>}
                {job.status === "esperando_autorizacion" && projectId && <AiPlanPanel projectId={projectId} onDone={() => load(projectId)} />}
                {(job.status === "error" || job.status === "cancelado") && (
                  <Button variant="gold" big className="w-full" onClick={genVideo} loading={busy === "video"}>
                    ▶️ Reanudar producción
                  </Button>
                )}
                {(job.status === "error" || job.status === "cancelado") && (
                  <p className="text-xs text-zinc-500">Se reutilizan el guion, la narración, las imágenes y las escenas ya editadas: no se vuelven a gastar créditos de ElevenLabs.</p>
                )}
                {job.log && (
                  <details className="rounded-xl border border-line bg-ink p-2" open={job.status === "error"}>
                    <summary className="cursor-pointer text-xs font-semibold text-zinc-400">Registro detallado</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[11px] leading-relaxed text-zinc-400 scroll-thin">{job.log}</pre>
                  </details>
                )}
                {running && (
                  <Button variant="ghost" onClick={cancel}>
                    Cancelar
                  </Button>
                )}
                {running && (
                  <p className="text-xs text-zinc-500">
                    El video se produce en el servidor: puede cerrar la app, apagar la pantalla o quedarse sin conexión. {push.state === "activo" ? "Recibirá una notificación al terminar." : ""}
                  </p>
                )}
                {running && push.state === "inactivo" && (
                  <Button variant="gold" className="w-full" onClick={push.enable}>
                    🔔 Avisarme cuando esté listo
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Cuando pulse «Generar video completo», aquí verá el progreso paso a paso.</p>
            )}
            {project?.video && (
              <div className="mt-4 space-y-3">
                <video key={project.video + project.updatedAt} src={project.video} controls playsInline className={`w-full rounded-xl border border-line bg-black ${settings.format === "16:9" ? "aspect-video" : ""}`} />
                <div className="grid grid-cols-2 gap-2">
                  <a href={`${project.video}?descargar=1`} className="col-span-2">
                    <Button variant="gold" big className="w-full">
                      ⬇️ Descargar video original
                    </Button>
                  </a>
                  <CoverDownload projectId={project.id} vertical={project.settings.format === "9:16"} hasThumbs={project.thumbnails.length > 0} version={project.updatedAt} />
                  {project.thumbnails[0] && (
                    <a href={`${project.thumbnails[0]}?descargar=1`}>
                      <Button variant="dark" className="w-full">
                        🖼️ Descargar miniatura
                      </Button>
                    </a>
                  )}
                  {project.srt && (
                    <a href={`${project.srt}?descargar=1`}>
                      <Button variant="dark" className="w-full">
                        💬 Subtítulos SRT
                      </Button>
                    </a>
                  )}
                  {project.srtEn && (
                    <a href={`${project.srtEn}?descargar=1`}>
                      <Button variant="dark" className="w-full">
                        🇺🇸 SRT inglés
                      </Button>
                    </a>
                  )}
                </div>
                {job && !running && (
                  <Button variant="ghost" className="w-full" onClick={genVideo} loading={busy === "video"}>
                    🔁 Volver a renderizar con los cambios
                  </Button>
                )}
              </div>
            )}
            {project && (project.spentCost > 0 || project.authorizedCost > 0) && (
              <p className="mt-3 text-xs text-zinc-500">
                Gasto de este proyecto: ${project.spentCost.toFixed(3)} (autorizado: ${project.authorizedCost.toFixed(2)})
              </p>
            )}
          </Card>

          {project && (project.video || project.thumbnails.length > 0) && (
            <ThumbnailsPanel projectId={project.id} busy={!!running} onChanged={() => load(project.id)} onError={setError} />
          )}
        </div>
      </div>

      {project && project.scenes.length > 0 && <ScenesPanel project={project} reload={() => load(project.id)} onError={setError} />}
      {project?.seo && <SeoPanel seo={project.seo} />}

      <CostDialog
        estimate={estimate}
        onCancel={() => {
          setEstimate(null);
          pending.current = null;
        }}
        onConfirm={() => pending.current?.()}
      />
    </div>
  );
}

function labelStatus(s: string) {
  return { en_cola: "En cola…", procesando: "Produciendo…", completado: "¡Video terminado!", error: "Hubo un problema", cancelado: "Cancelado", esperando_autorizacion: "Esperando su autorización" }[s] ?? s;
}

function Badge({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-1 ${ok ? "border-emerald-800 text-emerald-300" : warn ? "border-amber-800 text-amber-300" : "border-blood text-red-300"}`}>{children}</span>;
}

function VoiceField({ settings, set, status }: { settings: ProjectSettings; set: <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => void; status: Status | null }) {
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const v = VOICES.find((x) => x.id === settings.voiceId) ?? VOICES[0];
  async function preview() {
    setErr(null);
    setPlaying(true);
    try {
      const res = await fetch("/api/voices/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voiceId: settings.voiceId, speed: settings.speed, elevenVoiceId: settings.elevenVoiceId }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      audio.current?.pause();
      audio.current = new Audio(url);
      audio.current.onended = () => setPlaying(false);
      await audio.current.play();
    } catch (e) {
      setErr((e as Error).message);
      setPlaying(false);
    }
  }
  const missing = (v.provider === "elevenlabs" && status && !status.voices.elevenlabs) || (v.provider === "azure" && status && !status.voices.azure);
  return (
    <Field label="Voz en off" hint={missing ? "⚠️ Falta la clave de este proveedor en Ajustes" : v.note}>
      <Select value={settings.voiceId} onChange={(x) => set("voiceId", x)} options={VOICES.map((x) => ({ value: x.id, label: x.label }))} />
      {v.provider === "elevenlabs" && <ElevenVoiceInfo projectVoiceId={settings.elevenVoiceId} onChange={(x) => set("elevenVoiceId", x)} />}
      <div className="mt-2 flex items-center gap-2">
        <span className="w-20 text-xs text-zinc-400">Velocidad {settings.speed.toFixed(2)}×</span>
        <input type="range" min={0.7} max={1.3} step={0.05} value={settings.speed} onChange={(e) => set("speed", parseFloat(e.target.value))} className="flex-1 accent-[#d4a64a]" />
        <button onClick={preview} disabled={playing} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:border-gold/60">
          {playing ? "▶︎ …" : "▶︎ Escuchar"}
        </button>
      </div>
      {err && <span className="mt-1 block text-xs text-red-300">{err}</span>}
    </Field>
  );
}

function MusicField({ settings, set }: { settings: ProjectSettings; set: <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => void }) {
  const [loading, setLoading] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  async function preview() {
    if (settings.music === "ninguna") return;
    setLoading(true);
    try {
      const r = await api<{ url: string }>(`/api/music?preview=${settings.music}`);
      audio.current?.pause();
      audio.current = new Audio(r.url);
      audio.current.volume = 0.6;
      await audio.current.play();
      setTimeout(() => audio.current?.pause(), 15000);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Field label="Música de fondo" hint="Baja de volumen automáticamente cuando habla la voz.">
      <Select value={settings.music} onChange={(v) => set("music", v)} options={MUSIC_STYLES} />
      {settings.music !== "ninguna" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-20 text-xs text-zinc-400">Volumen</span>
          <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume} onChange={(e) => set("musicVolume", parseFloat(e.target.value))} className="flex-1 accent-[#d4a64a]" />
          <button onClick={preview} disabled={loading} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:border-gold/60">
            {loading ? "…" : "▶︎ Escuchar"}
          </button>
        </div>
      )}
    </Field>
  );
}

/** Muestra qué voz de ElevenLabs sonará realmente y permite elegir otra solo para este proyecto. */
function ElevenVoiceInfo({ projectVoiceId, onChange }: { projectVoiceId?: string; onChange: (v: string) => void }) {
  const [info, setInfo] = useState<{ id: string; name: string | null; verified: boolean; error?: string } | null>(null);
  const [other, setOther] = useState(!!projectVoiceId);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ id: string; name: string | null; verified: boolean; error?: string }>(`/api/voices/eleven?proyecto=${encodeURIComponent(projectVoiceId ?? "")}`)
        .then(setInfo)
        .catch(() => setInfo(null));
    }, 400);
    return () => clearTimeout(t);
  }, [projectVoiceId]);
  return (
    <div className="mt-2 space-y-2">
      {info && (
        <p className={`rounded-lg border px-2.5 py-1.5 text-xs ${info.error ? "border-blood text-red-300" : "border-gold/40 text-gold"}`}>
          🎙️ Sonará: <b>{info.name ?? "voz personalizada"}</b> <span className="font-mono text-zinc-500">({info.id})</span>
          {info.verified ? " ✓" : ""} {info.error ?? ""}
        </p>
      )}
      {other ? (
        <div className="flex gap-2">
          <input className={inputCls} placeholder="ID de otra voz de ElevenLabs solo para este proyecto" value={projectVoiceId ?? ""} onChange={(e) => onChange(e.target.value.trim())} />
          <button
            type="button"
            className="whitespace-nowrap rounded-lg border border-line px-2.5 text-xs text-zinc-300"
            onClick={() => {
              onChange("");
              setOther(false);
            }}
          >
            Usar la de Ajustes
          </button>
        </div>
      ) : (
        <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setOther(true)}>
          Usar otra voz de ElevenLabs solo en este proyecto
        </button>
      )}
    </div>
  );
}
