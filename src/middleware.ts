import { NextResponse, type NextRequest } from "next/server";

/**
 * Si se define APP_PASSWORD (en .env.local), la app pide usuario y contraseña.
 * Necesario para usarla desde el teléfono o la tableta en la red WiFi de casa.
 * Usuario: cualquiera. Contraseña: la de APP_PASSWORD.
 */
export function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) {
    const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
    if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return NextResponse.next();
    return new NextResponse("Para usar la app desde otro dispositivo, defina APP_PASSWORD en el archivo .env.local y reinicie.", { status: 403 });
  }
  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given === pass) return NextResponse.next();
  }
  return new NextResponse("Se requiere contraseña", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Profecia Studio AI", charset="UTF-8"' } });
}

export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
