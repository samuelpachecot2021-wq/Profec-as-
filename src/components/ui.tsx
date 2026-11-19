"use client";
import { useEffect, type ReactNode } from "react";

export function Card({ title, step, children, right, className = "" }: { title?: ReactNode; step?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel p-4 shadow-xl shadow-black/30 sm:p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
          <h2 className="flex shrink-0 items-center gap-2 text-base font-bold text-white sm:text-lg">
            {step && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold text-sm font-extrabold text-black">{step}</span>}
            {title}
          </h2>
          {right && <div className="min-w-0 shrink">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "gold" | "red" | "ghost" | "dark"; big?: boolean; loading?: boolean };

export function Button({ variant = "dark", big, loading, className = "", children, disabled, ...rest }: BtnProps) {
  const styles = {
    gold: "bg-gradient-to-b from-gold2 to-gold text-black hover:brightness-110 shadow-lg shadow-gold/20",
    red: "bg-gradient-to-b from-blood2 to-blood text-white hover:brightness-110 shadow-lg shadow-blood/30",
    ghost: "border border-line text-zinc-200 hover:bg-white/5",
    dark: "bg-panel2 border border-line text-zinc-100 hover:border-gold/50",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${big ? "px-5 py-4 text-base sm:text-lg" : "px-4 py-2.5 text-sm"} ${styles} ${className}`}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-line bg-ink px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-gold/70 focus:ring-2 focus:ring-gold/20";

export function Select<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  return (
    <select
      className={inputCls}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-ink px-3 py-2.5 text-left">
      <span>
        <span className="block text-sm font-semibold text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-gold" : "bg-zinc-700"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 scroll-thin sm:rounded-2xl ${wide ? "max-w-5xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gold">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/5" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export type Estimate = { items: { label: string; cost: number }[]; total: number; free: boolean; notes: string[] };

/** Ventana de autorización de gastos. */
export function CostDialog({ estimate, onCancel, onConfirm }: { estimate: Estimate | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={!!estimate} onClose={onCancel} title="Autorizar costo estimado">
      {estimate && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">Este paso usa servicios de pago. Revise la estimación antes de continuar. Nunca se cobrará más del 20 % sobre esta cifra.</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {estimate.items.map((i, k) => (
              <li key={k} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span>{i.label}</span>
                <span className="font-mono text-gold">${i.cost.toFixed(3)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-2 font-bold">
              <span>Total estimado</span>
              <span className="font-mono text-gold2">${estimate.total.toFixed(2)} USD</span>
            </li>
          </ul>
          {estimate.notes.length > 0 && (
            <ul className="list-inside list-disc text-xs text-zinc-500">
              {estimate.notes.map((n, k) => (
                <li key={k}>{n}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="gold" onClick={onConfirm}>
              Autorizar y continuar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "warn" | "ok"; children: ReactNode }) {
  const c = { info: "border-sky-800 bg-sky-950/40 text-sky-200", error: "border-blood bg-blood/10 text-red-200", warn: "border-amber-700 bg-amber-950/40 text-amber-200", ok: "border-emerald-700 bg-emerald-950/40 text-emerald-200" }[kind];
  return <div className={`rounded-xl border px-3 py-2.5 text-sm ${c}`}>{children}</div>;
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...(init?.headers || {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  return (
    <button
      className="rounded-lg border border-line px-2.5 py-1 text-xs text-zinc-300 hover:border-gold/60 hover:text-gold"
      onClick={(e) => {
        navigator.clipboard?.writeText(text);
        const b = e.currentTarget;
        const old = b.textContent;
        b.textContent = "¡Copiado!";
        setTimeout(() => (b.textContent = old), 1200);
      }}
    >
      {label}
    </button>
  );
}
