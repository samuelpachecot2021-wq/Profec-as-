import { vapidKeys, saveSubscription, removeSubscription, notifyAll, countSubscriptions } from "@/lib/push";
import { ok, fail, body } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clave pública para suscribirse (la privada nunca sale del servidor). */
export async function GET() {
  const { publicKey } = await vapidKeys();
  return ok({ publicKey, devices: countSubscriptions() });
}

/** Registrar este dispositivo, o enviar una notificación de prueba ({ test: true }). */
export async function POST(req: Request) {
  try {
    const b = await body<{ subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }; test?: boolean }>(req);
    if (b.subscription) saveSubscription(b.subscription, req.headers.get("user-agent") || "");
    if (b.test) {
      const sent = await notifyAll({ title: "🔔 PROFECÍA STUDIO AI", body: "¡Las notificaciones funcionan! Le avisaremos cuando sus videos estén listos.", url: "/proyectos", tag: "prueba" });
      return ok({ sent });
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const b = await body<{ endpoint?: string }>(req);
  if (b.endpoint) removeSubscription(b.endpoint);
  return ok({ ok: true });
}
