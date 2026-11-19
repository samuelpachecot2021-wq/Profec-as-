import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigured, verifySessionToken } from "@/lib/session";

/** Rutas accesibles sin iniciar sesión (necesarias para instalar la PWA y entrar). */
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/offline\.html$/, /^\/favicon\.ico$/, /^\/icon\.png$/, /^\/apple-icon\.png$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  if (!authConfigured()) {
    // Sin contraseña configurada: solo se permite el uso desde el propio equipo.
    const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
    if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return NextResponse.next();
    return new NextResponse(
      "PROFECÍA STUDIO AI: falta configurar la contraseña de acceso. Defina la variable ADMIN_PASSWORD en el servidor y reinicie.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sesión cerrada. Vuelva a iniciar sesión." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?volver=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
