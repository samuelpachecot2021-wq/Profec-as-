"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, api } from "@/components/ui";

type Row = {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  thumbnail: string | null;
  spent_cost: number;
  error: string | null;
  job_status: string | null;
  job_progress: number | null;
  job_step: string | null;
};

const LABEL: Record<string, string> = { borrador: "Borrador", guion: "Guion listo", en_cola: "En cola", procesando: "Produciendo", listo: "Video listo", error: "Error", cancelado: "Cancelado" };
const COLOR: Record<string, string> = { listo: "bg-emerald-700", error: "bg-blood", procesando: "bg-gold text-black", en_cola: "bg-amber-800" };

export default function Projects() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ projects: Row[] }>("/api/projects").then((r) => setRows(r.projects)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function remove(id: string, title: string) {
    if (!confirm(`¿Eliminar el proyecto «${title}» y todos sus archivos? Esta acción no se puede deshacer.`)) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl font-extrabold text-white">Mis proyectos</h1>
        <Link href="/">
          <Button variant="gold">+ Nuevo video</Button>
        </Link>
      </div>
      <p className="text-sm text-zinc-400">Todos los proyectos se guardan automáticamente en su equipo. Si cierra la aplicación durante una producción, se reanudará al volver a abrirla.</p>
      {error && <p className="text-red-300">{error}</p>}
      {rows && rows.length === 0 && (
        <Card>
          <p className="text-zinc-400">Aún no hay proyectos. ¡Cree el primero desde el Estudio!</p>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows?.map((p) => {
          const st = p.job_status === "procesando" || p.job_status === "en_cola" ? p.job_status : p.status;
          return (
            <div key={p.id} className="overflow-hidden rounded-2xl border border-line bg-panel">
              <Link href={`/proyecto/${p.id}`} className="block">
                <div className="relative aspect-video bg-gradient-to-br from-panel2 to-ink">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center font-serif text-3xl text-gold/30">✝</div>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-xs font-bold ${COLOR[st] ?? "bg-zinc-700"}`}>{LABEL[st] ?? st}</span>
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 font-semibold text-white">{p.title}</h3>
                  {(st === "procesando" || st === "en_cola") && (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-ink">
                        <div className="progress-shine h-full" style={{ width: `${Math.max(3, (p.job_progress ?? 0) * 100)}%` }} />
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-400">{p.job_step}</p>
                    </div>
                  )}
                  {st === "error" && <p className="mt-1 line-clamp-2 text-xs text-red-300">{p.error}</p>}
                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(p.updated_at.replace(" ", "T") + "Z").toLocaleString("es")}
                    {p.spent_cost > 0 && ` · $${p.spent_cost.toFixed(2)}`}
                  </p>
                </div>
              </Link>
              <div className="flex justify-end border-t border-line px-3 py-2">
                <button className="text-xs text-zinc-500 hover:text-red-300" onClick={() => remove(p.id, p.title)}>
                  Eliminar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
