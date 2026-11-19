import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, MUSIC_DIR } from "./paths";
import { run, exists } from "./util";

/**
 * Música de fondo.
 * 1) Si la usuaria añadió pistas propias con licencia en data/music/<estilo>/,
 *    se usa una de ellas (rotando).
 * 2) Si no, se SINTETIZA una atmósfera instrumental original con FFmpeg.
 *    Al ser generada por la propia aplicación no tiene derechos de terceros,
 *    por lo que es segura para monetizar.
 */

const LOOP = 64; // segundos; todas las frecuencias se ajustan para que el bucle no tenga cortes

const n = (hz: number) => Math.round(hz * LOOP) / LOOP;

type Style = { chordA: number[]; chordB: number[]; drone: number; pulse: number; bright: number; lp: number };

// Notas (Hz)
const A1 = 55, D2 = 73.42, E2 = 82.41, F2 = 87.31, G2 = 98, A2 = 110, C3 = 130.81, D3 = 146.83, E3 = 164.81, F3 = 174.61, G3 = 196, A3 = 220, B3 = 246.94, C4 = 261.63, D4 = 293.66, E4 = 329.63, Fs4 = 369.99, G4 = 392;

const STYLES: Record<string, Style> = {
  suspenso: { chordA: [A2, C3, E3, F3], chordB: [A2, C3, D3, E3], drone: A1, pulse: 0.5, bright: 0.15, lp: 900 },
  documental: { chordA: [D3, F3, A3, C4], chordB: [A2, C3, E3, G3], drone: D2, pulse: 0, bright: 0.3, lp: 1500 },
  misterio: { chordA: [E3, G3, B3, D4], chordB: [F3, A3, C4, E4], drone: E2, pulse: 0, bright: 0.2, lp: 1100 },
  tension: { chordA: [A2, C3, D3 * 1.0595, E3], chordB: [A2, C3, E3, F3], drone: A1, pulse: 1, bright: 0.1, lp: 800 },
  epica: { chordA: [D3, F3, A3, D4], chordB: [C3, E3, G3, C4], drone: D2, pulse: 1, bright: 0.45, lp: 2200 },
  reflexion: { chordA: [C3, E3, G3, B3], chordB: [A2, C3, E3, G3], drone: C3 / 2, pulse: 0, bright: 0.35, lp: 1600 },
  adoracion: { chordA: [G2, D3, G3, B3, D4], chordB: [C3, E3, G3, C4], drone: G2 / 2, pulse: 0, bright: 0.5, lp: 2400 },
  esperanza: { chordA: [D3, Fs4 / 2, A3, D4], chordB: [G2, D3, G3, B3], drone: D2, pulse: 0, bright: 0.55, lp: 2600 },
};

function expr(s: Style) {
  const voice = (f: number, i: number) => {
    const lfo = n(1 / (8 + i * 4));
    const det = n(f * 1.004);
    return `(sin(2*PI*${n(f)}*t)+0.6*sin(2*PI*${det}*t)+${s.bright}*sin(2*PI*${n(f * 2)}*t))*(0.65+0.35*sin(2*PI*${lfo}*t+${i}))`;
  };
  const chordA = s.chordA.map(voice).join("+");
  const chordB = s.chordB.map((f, i) => voice(f, i + 3)).join("+");
  const w = `(0.5+0.5*sin(2*PI*t/16))`;
  const drone = `0.9*sin(2*PI*${n(s.drone)}*t)*(0.8+0.2*sin(2*PI*${n(1 / 32)}*t))`;
  const pulse = s.pulse ? `+${s.pulse * 1.4}*exp(-mod(t,2)*7)*sin(2*PI*${n(48)}*t)` : "";
  return `0.05*((${w})*(${chordA})+(1-${w})*(${chordB})+${drone}${pulse})`;
}

async function synthLoop(style: string): Promise<string> {
  const s = STYLES[style] ?? STYLES.documental;
  const out = path.join(CACHE_DIR, `musica-${style}-v2.wav`);
  if (exists(out)) return out;
  const tmp = `${out}.part.wav`;
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `aevalsrc='${expr(s)}|${expr({ ...s, chordA: s.chordA.map((f) => f * 1.002), chordB: s.chordB.map((f) => f * 0.998) })}':s=44100:d=${LOOP}`,
    "-af", `lowpass=f=${s.lp},highpass=f=35,aecho=0.8:0.6:400|900:0.3|0.2,volume=1.6`,
    "-c:a", "pcm_s16le", tmp,
  ]);
  fs.renameSync(tmp, out);
  return out;
}

export function userTracks(style: string): string[] {
  const dir = path.join(MUSIC_DIR, style);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f))
    .map((f) => path.join(dir, f));
}

/** Devuelve un archivo de música para el estilo elegido (o null si "ninguna"). */
export async function musicFor(style: string, seed = 0): Promise<{ file: string; loop: boolean; label: string } | null> {
  if (style === "ninguna") return null;
  const tracks = userTracks(style);
  if (tracks.length) {
    const file = tracks[seed % tracks.length];
    return { file, loop: true, label: `Pista propia: ${path.basename(file)}` };
  }
  return { file: await synthLoop(style), loop: true, label: "Música original sintetizada por Profecía Studio AI (sin derechos de terceros)" };
}
