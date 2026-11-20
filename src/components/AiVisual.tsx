"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { VISUAL_MODES, type ProjectSettings } from "@/lib/options";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/ai/pricing";
import { Alert, Button, Field, Select, api, inputCls } from "./ui";

type RunwayStatus = { configured: boolean; balance: { credits: number; usd: number } | null; error?: string };

/** Selector del tipo de producción visual y del presupuesto máximo por video. */
export function VisualModeField({ settings, set }: { settings: ProjectSettings; set: <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => void }) {
  const [rw, setRw] = useState<RunwayStatus | null>(null);
  useEffect(() => {
    api<RunwayStatus>("/api/ai/runway").then(setRw).catch(() => undefined);
  }, []);
  const mode = settings.visualMode ?? "bancos";
  const desc = VISUAL_MODES.find((m) => m.value === mode)?.desc;
  const ai = mode !== "bancos";
  return (
    <div className="space-y-3 rounded-xl border border-gold/40 bg-ink p-3 sm:col-span-2">
      <Field label="Tipo de producción visual" hint={desc}>
        <Select value={mode} onChange={(v) => set("visualMode", v)} options={VISUAL_MODES} />
      </Field>
      {ai && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Presupuesto máximo por video (USD)" hint="Nunca se gastará más; verá el costo exacto antes de generar.">
              <input type="number" min={0.5} max={500} step={0.5} className={inputCls} value={settings.aiBudget ?? 5} onChange={(e) => set("aiBudget", Math.max(0.5, parseFloat(e.target.value || "5")))} />
            </Field>
            <Field label="Modelo de imagen IA">
              <Select value={settings.aiImageModel ?? "muse_image"} onChange={(v) => set("aiImageModel", v)} options={IMAGE_MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.note}` }))} />
            </Field>
            {mode !== "economico" && (
              <Field label="Modelo de video IA">
                <Select value={settings.aiVideoModel ?? "gen4_turbo"} onChange={(v) => set("aiVideoModel", v)} options={VIDEO_MODELS.map((m) => ({ value: m.id, label: `${m.label} · ${m.note}` }))} />
              </Field>
            )}
          </div>
          {rw && !rw.configured && (
            <Alert kind="warn">
              Para generar con IA añada su clave de <b>Runway</b> en{" "}
              <Link href="/ajustes" className="underline">
                Ajustes
              </Link>
              . Se obtiene en dev.runway.com → API Keys (compra mínima de créditos: 10 USD). Sin clave, elija «Solo bancos gratuitos».
            </Alert>
          )}
          {rw?.configured && rw.balance && <p className="text-xs text-zinc-400">Saldo en Runway: {rw.balance.credits.toLocaleString("es")} créditos ({rw.balance.usd.toFixed(2)} USD)</p>}
          {rw?.error && <p className="text-xs text-red-300">{rw.error}</p>}
          {settings.resolution >= 1440 && <p className="text-xs text-zinc-500">En 1440p y 4K las escenas IA (generadas en 720p–1080p) se amplían al tamaño final.</p>}
        </>
      )}
    </div>
  );
}

type PlanItem = { key: string; gi: number; text: string; kind: "video" | "image" | "stock"; seconds: number; clipSeconds?: number; costUSD: number; reserveUSD: number; status: string; recreation: boolean; realCostUSD?: number; error?: string };
type PlanResp = {
  plan: null | { mode: string; items: PlanItem[]; totalUSD: number; maxUSD: number; budgetUSD: number; alreadyPaidUSD: number; warnings: string[]; pricingSource: string; approved: boolean };
  summary?: { provider: string; imageModel: string; videoModel: string; images: number; clips: number; stock: number; clipDurations: number[]; totalUSD: number; maxUSD: number; budgetUSD: number };
};

const KIND: Record<string, string> = { video: "🎬 Video IA", image: "🖼️ Imagen IA", stock: "🆓 Recurso gratuito" };

/** Autorización explícita del gasto en escenas IA, con todo el detalle. */
export function AiPlanPanel({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [d, setD] = useState<PlanResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<PlanResp>(`/api/projects/${projectId}/ai-plan`).then(setD).catch((e) => setErr(e.message));
  }, [projectId]);
  async function act(action: "approve" | "free") {
    setBusy(action);
    setErr(null);
    try {
      await api(`/api/projects/${projectId}/ai-plan`, { method: "POST", json: { action } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!d?.plan || !d.summary) return err ? <Alert kind="error">{err}</Alert> : <p className="text-sm text-zinc-400">Cargando el plan de escenas IA…</p>;
  const { plan, summary: s } = d;
  return (
    <div className="space-y-3 rounded-xl border border-gold bg-gold/5 p-3">
      <p className="text-sm font-bold text-gold">💳 Autorice el costo de las escenas IA</p>
      <ul className="space-y-1 text-sm text-zinc-200">
        <li>
          Proveedor: <b>{s.provider}</b> (API oficial)
        </li>
        <li>Modelo de imagen: {s.imageModel}</li>
        {s.clips > 0 && <li>Modelo de video: {s.videoModel}</li>}
        <li>
          <b>{s.clips}</b> clips de video IA{s.clips > 0 && ` (${s.clipDurations.join(" s, ")} s)`} · <b>{s.images - s.clips}</b> imágenes IA animadas · <b>{s.stock}</b> escenas con recursos gratuitos
        </li>
        <li>
          Costo estimado: <b className="text-gold2">{plan.totalUSD.toFixed(2)} USD</b> · máximo autorizado: <b>{plan.maxUSD.toFixed(2)} USD</b> · presupuesto: {plan.budgetUSD.toFixed(2)} USD
        </li>
        {plan.alreadyPaidUSD > 0 && <li className="text-emerald-300">Ya generado en intentos anteriores (no se vuelve a cobrar): {plan.alreadyPaidUSD.toFixed(2)} USD</li>}
      </ul>
      {plan.warnings.map((w, i) => (
        <Alert key={i} kind="warn">
          {w}
        </Alert>
      ))}
      <details className="rounded-lg border border-line bg-ink p-2">
        <summary className="cursor-pointer text-xs font-semibold text-zinc-400">Ver escena por escena ({plan.items.length})</summary>
        <div className="mt-2 max-h-72 overflow-y-auto scroll-thin">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1">#</th>
                <th>Tipo</th>
                <th>Duración</th>
                <th className="text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((it) => (
                <tr key={it.key + it.gi} className="border-t border-line align-top">
                  <td className="py-1 pr-1 text-zinc-500">{it.gi + 1}</td>
                  <td className="pr-1">
                    {KIND[it.kind]}
                    {it.recreation && it.kind !== "stock" && <span className="block text-[10px] text-zinc-500">recreación artística</span>}
                    <span className="block max-w-[14rem] truncate text-[10px] text-zinc-500">{it.text}</span>
                  </td>
                  <td>{it.kind === "video" ? `clip ${it.clipSeconds} s` : `${it.seconds.toFixed(1)} s`}</td>
                  <td className="text-right font-mono">{it.status === "hecho" ? "pagado" : it.costUSD + it.reserveUSD > 0 ? `$${(it.costUSD + it.reserveUSD).toFixed(2)}` : "gratis"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="text-[11px] text-zinc-500">Precios oficiales: {plan.pricingSource}. Se registra el costo real informado por Runway. Si Runway falla en una escena, esa escena usa un recurso gratuito: nunca se cambia a otro proveedor de pago sin su autorización.</p>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="gold" onClick={() => act("approve")} loading={busy === "approve"}>
          Autorizar {plan.maxUSD.toFixed(2)} USD y continuar
        </Button>
        <Button variant="ghost" onClick={() => act("free")} loading={busy === "free"}>
          Continuar sin IA (solo recursos gratuitos)
        </Button>
      </div>
    </div>
  );
}
