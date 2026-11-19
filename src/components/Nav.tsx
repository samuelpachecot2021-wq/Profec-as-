"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useInstall } from "./pwa";

const LINKS = [
  { href: "/", label: "Estudio", icon: "🎬" },
  { href: "/proyectos", label: "Mis proyectos", icon: "📁" },
  { href: "/masivo", label: "Producción masiva", icon: "⚡" },
  { href: "/ajustes", label: "Ajustes", icon: "⚙️" },
  { href: "/ayuda", label: "Ayuda", icon: "❔" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState(false);
  const { canInstall, install } = useInstall();

  useEffect(() => {
    if (path === "/login") return;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setAuth(!!d.authEnabled))
      .catch(() => undefined);
  }, [path]);

  if (path === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="h-9 w-9 shrink-0 rounded-lg" />
            <span className="truncate font-serif text-base font-extrabold tracking-wider text-gold sm:text-xl">
              PROFECÍA <span className="text-white">STUDIO</span> <span className="text-blood2">AI</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${path === l.href ? "bg-gold/15 text-gold" : "text-zinc-300 hover:bg-white/5"}`}>
                {l.label}
              </Link>
            ))}
            {auth && (
              <button onClick={logout} className="rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-zinc-200">
                Salir
              </button>
            )}
          </nav>
          <div className="flex items-center gap-2">
            {canInstall && (
              <button onClick={install} className="rounded-lg bg-gold px-3 py-2 text-xs font-bold text-black sm:text-sm">
                📲 Instalar app
              </button>
            )}
            <button className="rounded-lg border border-line px-3 py-2 text-sm lg:hidden" onClick={() => setOpen(!open)} aria-label="Menú">
              ☰
            </button>
          </div>
        </div>
        {open && (
          <nav className="flex flex-col border-t border-line px-4 pb-3 lg:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`rounded-lg px-3 py-3 text-base ${path === l.href ? "text-gold" : "text-zinc-200"}`}>
                {l.icon} {l.label}
              </Link>
            ))}
            {auth && (
              <button onClick={logout} className="rounded-lg px-3 py-3 text-left text-base text-zinc-400">
                🚪 Cerrar sesión
              </button>
            )}
          </nav>
        )}
      </header>
      {/* Barra inferior para teléfonos */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-ink/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {LINKS.slice(0, 4).map((l) => (
          <Link key={l.href} href={l.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${path === l.href ? "text-gold" : "text-zinc-400"}`}>
            <span className="text-lg leading-none">{l.icon}</span>
            {l.label.replace("Producción masiva", "Masiva").replace("Mis proyectos", "Proyectos")}
          </Link>
        ))}
      </nav>
    </>
  );
}
