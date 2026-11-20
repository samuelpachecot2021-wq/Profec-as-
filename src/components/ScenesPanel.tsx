"use client";
import { useState } from "react";
import type { ProjectView } from "@/lib/projects";
import { Button, Card, CostDialog, Modal, api, fmtTime, inputCls, type Estimate } from "./ui";

type Scene = ProjectView["scenes"][number];
type Candidate = { provider: string; kind: "video" | "image"; externalId: string; url: string; thumb?: string; attribution: string; license: string; pageUrl?: string };

const OVERLAY_LABEL: Record<string, string> = { verse: "📖 Versículo", headline: "📰 Titular", map: "🗺️ Mapa", interpretation: "🔮 Interpretación", info: "ℹ️ Dato" };

export function ScenesPanel({ project, reload, onError }: { project: ProjectView; reload: () => Promise<unknown>; onError: (m: string) => void }) {
  const [edit, setEdit] = useState<Scene | null>(null);
  return (
    <Card title={`Escenas (${project.scenes.length})`} right={<span className="text-xs text-zinc-500">Pulse una escena para cambiar su imagen</span>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {project.scenes.map((s) => (
          <button key={s.id} onClick={() => setEdit(s)} className="group overflow-hidden rounded-xl border border-line bg-ink text-left transition hover:border-gold/60">
            <div className="relative aspect-video bg-black">
              {s.asset ? (
                s.asset.kind === "video" ? (
                  <video src={`${s.asset.url}#t=1`} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.asset.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )
              ) : (
                <div className="grid h-full place-items-center text-xs text-zinc-600">Se buscará al producir</div>
              )}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-gold">
                {s.idx + 1} · {fmtTime(s.start)}
              </span>
              {s.asset?.kind === "video" && <span className="absolute right-1.5 top-1.5 rounded bg-blood px-1.5 py-0.5 text-[10px] font-bold">VIDEO</span>}
              {s.asset?.isAi && <span className="absolute bottom-1.5 right-1.5 rounded bg-purple-800 px-1.5 py-0.5 text-[10px] font-bold">IA</span>}
              {s.locked && <span className="absolute bottom-1.5 left-1.5 rounded bg-gold px-1.5 py-0.5 text-[10px] font-bold text-black">FIJADA</span>}
            </div>
            <div className="p-2">
              <p className="line-clamp-3 text-xs text-zinc-300">{s.text}</p>
              {s.overlay && <p className="mt-1 text-[10px] font-semibold text-gold">{OVERLAY_LABEL[s.overlay.type]}</p>}
            </div>
          </button>
        ))}
      </div>
      {edit && <SceneModal scene={edit} projectId={project.id} onClose={() => setEdit(null)} reload={reload} onError={onError} />}
    </Card>
  );
}

function SceneModal({ scene, projectId, onClose, reload, onError }: { scene: Scene; projectId: string; onClose: () => void; reload: () => Promise<unknown>; onError: (m: string) => void }) {
  const [query, setQuery] = useState(scene.query ?? "");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const url = `/api/projects/${projectId}/scenes/${scene.id}`;

  async function doIt(label: string, fn: () => Promise<unknown>, close = true) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      await reload();
      if (close) onClose();
    } catch (e) {
      setErr((e as Error).message);
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    setBusy("buscar");
    setErr(null);
    try {
      await api(url, { method: "PATCH", json: { query } });
      const r = await api<{ candidates: Candidate[] }>(url, { method: "POST", json: { action: "search", query } });
      setCands(r.candidates);
      if (!r.candidates.length) setErr("No se encontraron resultados. Pruebe otras palabras (en inglés funcionan mejor) o configure Pexels/Pixabay en Ajustes.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function ai(authorize: boolean) {
    await doIt("ia", async () => {
      const r = await api<{ needsAuthorization?: boolean; estimate?: Estimate }>(url, { method: "POST", json: { action: "ai", prompt: `${query}. ${scene.text}`, authorize } });
      if (r.needsAuthorization) {
        setEstimate(r.estimate!);
        throw new Error("__auth__");
      }
    }).catch(() => undefined);
  }

  const [rwAction, setRwAction] = useState<string | null>(null);
  async function runway(action: "ai-runway-image" | "ai-runway-video", authorize: boolean) {
    await doIt(action, async () => {
      const r = await api<{ needsAuthorization?: boolean; estimate?: Estimate }>(url, { method: "POST", json: { action, prompt: query, authorize } });
      if (r.needsAuthorization) {
        setRwAction(action);
        setEstimate(r.estimate!);
        throw new Error("__auth__");
      }
    }).catch(() => undefined);
  }

  return (
    <Modal open onClose={onClose} title={`Escena ${scene.idx + 1}`} wide>
      <div className="space-y-4">
        <p className="rounded-xl border border-line bg-ink p-3 text-sm leading-relaxed text-zinc-200">{scene.text}</p>
        {scene.asset && (
          <p className="text-xs text-zinc-500">
            Actual: {scene.asset.attribution} · {scene.asset.license}
            {scene.asset.pageUrl && (
              <>
                {" · "}
                <a className="text-gold underline" href={scene.asset.pageUrl} target="_blank" rel="noreferrer">
                  ver fuente
                </a>
              </>
            )}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Qué buscar (en inglés da mejores resultados), ej.: jerusalem old city" onKeyDown={(e) => e.key === "Enter" && search()} />
          <Button variant="gold" onClick={search} loading={busy === "buscar"}>
            🔎 Buscar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-xl border border-line bg-panel2 px-4 py-2.5 text-sm font-semibold hover:border-gold/50">
            📤 Subir imagen o video propio
            <input
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.append("file", f);
                void doIt("subir", () => api(url, { method: "POST", body: fd }));
              }}
            />
          </label>
          <Button variant="ghost" onClick={() => runway("ai-runway-image", false)} loading={busy === "ai-runway-image"}>
            ✨ Imagen IA (Runway)
          </Button>
          <Button variant="ghost" onClick={() => runway("ai-runway-video", false)} loading={busy === "ai-runway-video"}>
            🎬 Clip de video IA (Runway)
          </Button>
          <Button variant="ghost" onClick={() => ai(false)} loading={busy === "ia"}>
            ✨ Imagen IA (OpenAI)
          </Button>
          {scene.locked && (
            <Button variant="ghost" onClick={() => doIt("auto", () => api(url, { method: "PATCH", json: { unlock: true } }))}>
              ↺ Volver a elegir automáticamente
            </Button>
          )}
          {scene.overlay && (
            <Button variant="ghost" onClick={() => doIt("ov", () => api(url, { method: "PATCH", json: { overlay: null } }), false)}>
              Quitar {OVERLAY_LABEL[scene.overlay.type]}
            </Button>
          )}
        </div>
        {err && err !== "__auth__" && <p className="text-sm text-red-300">{err}</p>}
        {cands && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {cands.map((c) => (
              <button key={`${c.provider}:${c.externalId}`} onClick={() => doIt("usar", () => api(url, { method: "POST", json: { action: "use", candidate: c } }))} disabled={!!busy} className="overflow-hidden rounded-xl border border-line text-left hover:border-gold">
                <div className="relative aspect-video bg-black">
                  {c.kind === "video" && !c.thumb ? (
                    <video src={c.url} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumb || c.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                  {c.kind === "video" && <span className="absolute right-1 top-1 rounded bg-blood px-1.5 text-[10px] font-bold">VIDEO</span>}
                </div>
                <p className="truncate p-1.5 text-[10px] text-zinc-400">
                  {c.provider} · {c.attribution}
                </p>
              </button>
            ))}
          </div>
        )}
        {busy === "usar" && <p className="text-sm text-gold">Descargando recurso…</p>}
        {(busy === "ai-runway-image" || busy === "ai-runway-video") && <p className="text-sm text-gold">Generando con Runway… (un clip de video puede tardar 1–3 minutos)</p>}
        <p className="text-xs text-zinc-500">Después de cambiar imágenes pulse «Volver a renderizar con los cambios». La voz y las demás imágenes se reutilizan.</p>
      </div>
      <CostDialog
        estimate={estimate}
        onCancel={() => setEstimate(null)}
        onConfirm={() => {
          setEstimate(null);
          if (rwAction) {
            const a = rwAction as "ai-runway-image" | "ai-runway-video";
            setRwAction(null);
            void runway(a, true);
          } else void ai(true);
        }}
      />
    </Modal>
  );
}
