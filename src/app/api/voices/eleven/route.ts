import { getSetting } from "@/lib/settings";
import { resolveElevenVoiceId } from "@/lib/tts";
import { BRIAN_VOICE_ID } from "@/lib/options";
import { fetchWithTimeout } from "@/lib/util";
import { ok, fail } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indica qué voz de ElevenLabs se usará realmente (y su nombre, consultándolo
 * a ElevenLabs si hay clave). Sirve para confirmar que suena Brian.
 */
export async function GET(req: Request) {
  try {
    const project = new URL(req.url).searchParams.get("proyecto") || "";
    const id = resolveElevenVoiceId(project);
    let name = id === BRIAN_VOICE_ID ? "Brian" : null;
    let verified = false;
    const key = getSetting("ELEVENLABS_API_KEY");
    if (key) {
      try {
        const r = await fetchWithTimeout(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key } }, 8000);
        if (r.ok) {
          name = ((await r.json()) as { name?: string }).name ?? name;
          verified = true;
        } else if (r.status === 404) return ok({ id, name: null, verified: false, error: "ElevenLabs no reconoce este ID de voz." });
      } catch {
        /* sin conexión con ElevenLabs: se informa el ID igualmente */
      }
    }
    return ok({ id, name, verified, isBrian: id === BRIAN_VOICE_ID });
  } catch (e) {
    return fail(e);
  }
}
