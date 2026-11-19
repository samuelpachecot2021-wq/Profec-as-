"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión");
      const back = params.get("volver");
      window.location.href = back && back.startsWith("/") && !back.startsWith("//") ? back : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/50">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="mx-auto mb-3 h-20 w-20 rounded-2xl" />
        <h1 className="font-serif text-2xl font-extrabold tracking-wider text-gold">
          PROFECÍA <span className="text-white">STUDIO</span> <span className="text-blood2">AI</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-400">Acceso privado</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-zinc-300">Usuario</span>
        <input autoComplete="username" autoCapitalize="none" required value={user} onChange={(e) => setUser(e.target.value)} className="w-full rounded-xl border border-line bg-ink px-3 py-3 text-base outline-none focus:border-gold/70" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-zinc-300">Contraseña</span>
        <div className="flex gap-2">
          <input type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-line bg-ink px-3 py-3 text-base outline-none focus:border-gold/70" />
          <button type="button" onClick={() => setShow(!show)} className="rounded-xl border border-line px-3 text-sm text-zinc-400" aria-label="Mostrar contraseña">
            {show ? "🙈" : "👁"}
          </button>
        </div>
      </label>
      {error && <p className="rounded-xl border border-blood bg-blood/10 px-3 py-2 text-sm text-red-200">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-gradient-to-b from-gold2 to-gold py-3.5 text-base font-bold text-black disabled:opacity-60">
        {busy ? "Entrando…" : "Entrar"}
      </button>
      <p className="text-center text-xs text-zinc-500">La sesión se mantiene abierta 30 días en este dispositivo.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
