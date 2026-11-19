"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Estudio" },
  { href: "/proyectos", label: "Mis proyectos" },
  { href: "/masivo", label: "Producción masiva" },
  { href: "/ajustes", label: "Ajustes" },
  { href: "/ayuda", label: "Ayuda" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-blood to-gold font-serif text-lg font-extrabold text-black">P</span>
          <span className="font-serif text-lg font-extrabold tracking-wider text-gold sm:text-xl">
            PROFECÍA <span className="text-white">STUDIO</span> <span className="text-blood2">AI</span>
          </span>
        </Link>
        <nav className="hidden gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${path === l.href ? "bg-gold/15 text-gold" : "text-zinc-300 hover:bg-white/5"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <button className="rounded-lg border border-line px-3 py-2 text-sm md:hidden" onClick={() => setOpen(!open)} aria-label="Menú">
          ☰
        </button>
      </div>
      {open && (
        <nav className="flex flex-col border-t border-line px-4 pb-3 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`rounded-lg px-3 py-3 text-base ${path === l.href ? "text-gold" : "text-zinc-200"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
