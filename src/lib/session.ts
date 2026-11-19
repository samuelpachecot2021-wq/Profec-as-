/**
 * Sesiones firmadas (HMAC-SHA256) compatibles con el middleware (Edge) y con Node.
 * La contraseña de acceso se define en la variable de entorno ADMIN_PASSWORD
 * (en el servidor de la nube) y nunca se guarda en el navegador.
 */
export const SESSION_COOKIE = "ps_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || "";
}

export function adminUser() {
  return (process.env.ADMIN_USER || "admin").trim().toLowerCase();
}

export function authConfigured() {
  return adminPassword().length > 0;
}

function secret() {
  return process.env.SESSION_SECRET || `profecia-studio:${adminUser()}:${adminPassword()}`;
}

function b64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string) {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSessionToken(user: string) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Date.now() + SESSION_DAYS * 86400_000 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!safeEqual(sig, await hmac(payload))) return null;
  try {
    const data = JSON.parse(fromB64url(payload)) as { u: string; exp: number };
    if (Date.now() > data.exp) return null;
    return data.u;
  } catch {
    return null;
  }
}
