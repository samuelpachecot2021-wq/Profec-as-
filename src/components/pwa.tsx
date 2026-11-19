"use client";
import { useCallback, useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

declare global {
  interface Window {
    __bip?: BIPEvent | null;
  }
}

/** Registra el service worker y guarda el aviso de instalación de Android. */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onBip = (e: Event) => {
      e.preventDefault();
      window.__bip = e as BIPEvent;
      window.dispatchEvent(new Event("ps-installable"));
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", () => {
      window.__bip = null;
      window.dispatchEvent(new Event("ps-installable"));
    });
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  return null;
}

export function useInstall() {
  const [can, setCan] = useState(false);
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const upd = () => setCan(!!window.__bip);
    upd();
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    window.addEventListener("ps-installable", upd);
    return () => window.removeEventListener("ps-installable", upd);
  }, []);
  const install = useCallback(async () => {
    const e = window.__bip;
    if (!e) return false;
    await e.prompt();
    const r = await e.userChoice;
    window.__bip = null;
    setCan(false);
    return r.outcome === "accepted";
  }, []);
  return { canInstall: can, standalone, install };
}

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "no-soportado" | "bloqueado" | "inactivo" | "activo" | "cargando";

/** Activar / desactivar las notificaciones push en este dispositivo. */
export function usePush() {
  const [state, setState] = useState<PushState>("cargando");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("no-soportado");
    if (Notification.permission === "denied") return setState("bloqueado");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setState(sub ? "activo" : "inactivo");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "bloqueado" : "inactivo");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error((await res.json()).error || "No se pudo registrar el dispositivo");
      setState("activo");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("inactivo");
  }, []);

  const test = useCallback(async () => {
    const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ test: true }) });
    return ((await r.json()) as { sent?: number }).sent ?? 0;
  }, []);

  return { state, error, enable, disable, test };
}
