"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, DURATIONS, FORMATS, MUSIC_STYLES, RESOLUTIONS, VOICES, type ProjectSettings } from "@/lib/options";
import { Alert, Button, Card, CostDialog, Field, Select, Toggle, api, inputCls, type Estimate } from "@/components/ui";

type Job = { id: number; project_id: string; title: string; status: string; progress: number; step: string | null; error: string | null };

export default function Batch() {
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    const load = () => api<{ jobs: Job[] }>("/api/queue").then((r) => setJobs(r.jobs)).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const articles = text.split(/\n\s*-{3,}\s*\n/).map((a) => a.trim()).filter((a) => a.length > 40);

  async function submit(authorize = false, ids?: string[]) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ needsAuthorization?: boolean; estimate?: Estimate; ids: string[]; queued?: string[]; errors?: string[] }>("/api/batch", {
        method: "POST",
        json: { articles, settings, authorize, ids },
      });
      if (r.needsAuthorization) {
        setEstimate(r.estimate!);
        setPendingIds(r.ids);
        return;
      }
      setMsg({ kind: r.errors?.length ? "error" : "ok", text: `${r.queued?.length ?? 0} proyectos en la cola de producción.${r.errors?.length ? " Problemas: " + r.errors.join(" · ") : ""}` });
      setText("");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="font-serif text-2xl font-extrabold text-white">Producción masiva</h1>
      <p className="text-sm text-zinc-400">Pegue varios artículos separados por una línea con tres guiones (---). Se creará un proyecto por artículo y se producirán uno tras otro, hasta 12 por día.</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3" title="Artículos" right={<span className="text-sm font-bold text-gold">{articles.length} detectados</span>}>
          <textarea className={`${inputCls} min-h-80 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Primer artículo…\n---\nSegundo artículo…\n---\nTercer artículo…"} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Duración">
              <Select value={settings.duration} onChange={(v) => set("duration", v)} options={DURATIONS} />
            </Field>
            <Field label="Voz">
              <Select value={settings.voiceId} onChange={(v) => set("voiceId", v)} options={VOICES.map((v) => ({ value: v.id, label: v.label }))} />
            </Field>
            <Field label="Música">
              <Select value={settings.music} onChange={(v) => set("music", v)} options={MUSIC_STYLES} />
            </Field>
            <Field label="Formato">
              <Select value={settings.format} onChange={(v) => set("format", v)} options={FORMATS} />
            </Field>
            <Field label="Resolución">
              <Select value={settings.resolution} onChange={(v) => set("resolution", v)} options={RESOLUTIONS} />
            </Field>
            <div className="pt-6">
              <Toggle checked={settings.subtitles} onChange={(v) => set("subtitles", v)} label="Subtítulos" />
            </div>
          </div>
          {msg && (
            <div className="mt-3">
              <Alert kind={msg.kind}>{msg.text}</Alert>
            </div>
          )}
          <Button big variant="red" className="mt-4 w-full" onClick={() => submit()} loading={busy} disabled={!articles.length}>
            🎬 Producir {articles.length || ""} videos
          </Button>
        </Card>
        <Card className="min-w-0 lg:col-span-2" title="Cola de producción">
          {jobs.length === 0 && <p className="text-sm text-zinc-500">No hay trabajos recientes.</p>}
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-xl border border-line bg-ink p-3">
                <Link href={`/proyecto/${j.project_id}`} className="line-clamp-1 text-sm font-semibold text-white hover:text-gold">
                  {j.title}
                </Link>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel2">
                  <div className={`h-full ${j.status === "procesando" ? "progress-shine" : j.status === "error" ? "bg-blood" : j.status === "completado" ? "bg-emerald-600" : "bg-zinc-600"}`} style={{ width: `${Math.max(3, j.progress * 100)}%` }} />
                </div>
                <p className="mt-1 truncate text-xs text-zinc-400">{j.status === "error" ? j.error : j.status === "en_cola" ? "En espera…" : j.status === "completado" ? "Completado ✓" : j.step}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <CostDialog
        estimate={estimate}
        onCancel={() => setEstimate(null)}
        onConfirm={() => {
          setEstimate(null);
          void submit(true, pendingIds ?? undefined);
        }}
      />
    </div>
  );
}
