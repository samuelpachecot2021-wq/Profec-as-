export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comprobación de salud para el proveedor de la nube (no expone datos). */
export function GET() {
  return Response.json({ ok: true });
}
