import { cookies } from "next/headers";
import { SESSION_COOKIE, authConfigured, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return Response.json({ authEnabled: authConfigured(), user });
}
