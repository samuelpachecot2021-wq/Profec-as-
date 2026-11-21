"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Select, api } from "./ui";

type Status = { state: "idle" | "working" | "done" | "error"; progress: number; step: string; error?: string; ready: boolean; stale: boolean; download: string | null; method?: string; duration?: number; bytes?: number };

/** Botón «Descargar video con portada integrada» (copia del MP4 con la miniatura principal al comienzo). */
export function CoverDownload({ projectId, vertical, hasThumbs, version }: { projectId: string; vertical: boolean; hasThumbs: boolean; version: string }) {
  const [dur, setDur] = useState(0.5);
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantDownload = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s = await api<Status>(`/api/projects/${projectId}/portada?duracion=${dur}`);
      setSt(s);
      if (s.state === "working") timer.current = setTimeout(poll, 1200);
      else if (s.ready && s.download && wantDownload.current) {
        wantDownload.current = false;
        window.location.href = s.download;
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [projectId, dur]);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll, version]);

  async function create() {
    setErr(null);
    if (st?.ready && st.download && st.duration === dur) {
      window.location.href = st.download;
      return;
    }
    try {
      wantDownload.current = true;
      const s = await api<Status>(`/api/projects/${projectId}/portada`, { method: "POST", json: { duration: dur } });
      setSt(s);
      if (s.ready && s.download) {
        wantDownload.current = false;
        window.location.href = s.download;
      } else timer.current = setTimeout(poll, 800);
    } catch (e) {
      wantDownload.current = false;
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  const working = st?.state === "working";
  return (
    <div className={`col-span-2 space-y-2 rounded-xl border p-3 ${vertical ? "border-gold/60 bg-gold/5" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={vertical ? "gold" : "dark"} className="min-w-0 flex-1" disabled={!hasThumbs || working} loading={working} onClick={create}>
          🖼️ Descargar video con portada integrada
        </Button>
        <div className="w-40">
          <Select
            value={dur}
            onChange={(v) => setDur(Number(v))}
            options={[
              { value: 0.5, label: "Portada 0,5 s" },
              { value: 0.75, label: "Portada 0,75 s" },
              { value: 1, label: "Portada 1 s" },
            ]}
          />
        </div>
      </div>
      {vertical && <p className="text-xs font-semibold text-gold">Recomendado para YouTube Shorts.</p>}
      {!hasThumbs && <p className="text-xs text-zinc-400">Primero genere las miniaturas y elija la principal (★).</p>}
      {working && st && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-gold transition-all" style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">{st.step}</p>
        </div>
      )}
      {st?.state === "error" && (
        <Alert kind="error">
          {st.error} <button className="ml-1 underline" onClick={create}>Reintentar</button>
        </Alert>
      )}
      {err && <Alert kind="error">{err}</Alert>}
      {st?.ready && !working && (
        <p className="text-xs text-emerald-300">
          Copia lista ({st.duration?.toString().replace(".", ",")} s de portada{st.method === "copia" ? ", sin recomprimir el video" : ""}). <a className="underline" href={st.download ?? "#"}>Descargar de nuevo</a>
        </p>
      )}
      {st?.stale && !working && <p className="text-xs text-amber-300">La miniatura principal o la duración cambiaron: al pulsar el botón se creará una copia actualizada.</p>}
      <p className="text-xs leading-relaxed text-zinc-500">
        Es una copia: el video original no cambia. Empieza con la miniatura principal en silencio y después sigue el video completo, con la misma voz, música y subtítulos.
        Al subirlo desde el teléfono, en la herramienta de miniatura del Short elija el primer fotograma (la portada). Integrarla no garantiza que YouTube la elija sola.
      </p>
    </div>
  );
}
