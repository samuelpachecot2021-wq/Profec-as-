import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { DATA_DIR } from "./paths";

/**
 * Notificaciones push (Web Push estándar, gratis): avisan en el teléfono
 * cuando un video está listo, aunque la app esté cerrada.
 * Las claves VAPID se generan solas la primera vez y se guardan en el servidor.
 */

type Keys = { publicKey: string; privateKey: string };
const FILE = path.join(DATA_DIR, "vapid.json");

function ensureTable() {
  db().exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

async function webpush() {
  return (await import("web-push")).default ?? (await import("web-push"));
}

export async function vapidKeys(): Promise<Keys> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Keys;
  } catch {
    const wp = await webpush();
    const keys = wp.generateVAPIDKeys();
    fs.writeFileSync(FILE, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}

export function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device?: string) {
  ensureTable();
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error("Suscripción no válida");
  db()
    .prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, device) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device")
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, (device || "").slice(0, 200));
}

export function removeSubscription(endpoint: string) {
  ensureTable();
  db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function countSubscriptions() {
  ensureTable();
  return (db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n;
}

/** Envía una notificación a todos los dispositivos suscritos. Nunca lanza errores. */
export async function notifyAll(payload: { title: string; body: string; url?: string; tag?: string }) {
  try {
    ensureTable();
    const subs = db().prepare("SELECT * FROM push_subscriptions").all() as { endpoint: string; p256dh: string; auth: string }[];
    if (!subs.length) return 0;
    const wp = await webpush();
    const keys = await vapidKeys();
    wp.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:notificaciones@profecia-studio.invalid", keys.publicKey, keys.privateKey);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 });
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) removeSubscription(s.endpoint);
          else console.warn("Notificación no enviada:", String(e));
        }
      }),
    );
    return sent;
  } catch (e) {
    console.warn("Error de notificaciones:", e);
    return 0;
  }
}
