import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, adminPassword, adminUser, authConfigured, createSessionToken, safeEqual } from "@/lib/session";

export const runtime = "nodejs";

// Límite de intentos: 8 fallos cada 15 minutos por dirección IP.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60_000;
const MAX = 8;

function ipOf(req: Request) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "La contraseña de acceso no está configurada en el servidor (ADMIN_PASSWORD)." }, { status: 503 });
  const ip = ipOf(req);
  const a = attempts.get(ip);
  if (a && a.n >= MAX && Date.now() < a.until) {
    const mins = Math.ceil((a.until - Date.now()) / 60000);
    return NextResponse.json({ error: `Demasiados intentos. Espere ${mins} minutos.` }, { status: 429 });
  }
  const { user = "", password = "" } = (await req.json().catch(() => ({}))) as { user?: string; password?: string };
  const okUser = safeEqual(user.trim().toLowerCase(), adminUser());
  const okPass = safeEqual(password, adminPassword());
  if (!okUser || !okPass) {
    const cur = a && Date.now() < a.until ? a : { n: 0, until: Date.now() + WINDOW };
    cur.n++;
    attempts.set(ip, cur);
    await new Promise((r) => setTimeout(r, 700)); // frena ataques de fuerza bruta
    return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }
  attempts.delete(ip);
  const res = NextResponse.json({ ok: true });
  const secure = (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")) === "https";
  res.cookies.set(SESSION_COOKIE, await createSessionToken(adminUser()), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
