import { HIGHLIGHT_WORDS, type Overlay } from "./scenes";
import { words } from "./util";

export type TimedScene = { text: string; start: number; end: number; overlay: Overlay | null; keywords: string[]; isAi: boolean };

type Cue = { start: number; end: number; text: string };

// ───────────────────────── Tiempos ─────────────────────────

const weight = (s: string) => s.length + (s.match(/\.\.\.|…/g) || []).length * 12 + (s.match(/[,;:]/g) || []).length * 4;

/** Divide el texto de una escena en fragmentos cortos con tiempos proporcionales. */
export function chunkScene(text: string, start: number, end: number, maxWords: number, maxChars: number): Cue[] {
  const w = words(text);
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const token of w) {
    const cand = [...cur, token].join(" ");
    if (cur.length && (cur.length >= maxWords || cand.length > maxChars)) {
      chunks.push(cur.join(" "));
      cur = [];
    }
    cur.push(token);
    if (/[.!?…]$|\.\.\.$/.test(token) && cur.length >= 2) {
      chunks.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  const total = chunks.reduce((a, c) => a + weight(c), 0) || 1;
  let t = start;
  return chunks.map((c) => {
    const d = ((end - start) * weight(c)) / total;
    const cue = { start: t, end: t + d, text: c };
    t += d;
    return cue;
  });
}

// ───────────────────────── SRT ─────────────────────────

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function srtCues(scenes: TimedScene[]): Cue[] {
  return scenes.flatMap((s) => chunkScene(s.text, s.start, s.end, 14, 84));
}

export function toSrt(cues: Cue[]) {
  return cues
    .map((c, i) => {
      const lines = wrap(c.text.replace(/\.\.\./g, "…"), 42);
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${lines.join("\n")}\n`;
    })
    .join("\n");
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && (line + " " + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

// ───────────────────────── ASS (subtítulos + gráficos) ─────────────────────────

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const esc = (s: string) => s.replace(/[{}]/g, "").replace(/\\/g, "").replace(/\n/g, " ");

// Colores ASS: &HAABBGGRR
const YELLOW = "&H0000E5FF&";
const GOLD = "&H0045B8E8&";
const WHITE = "&H00FFFFFF&";

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function highlight(text: string, keywords: Set<string>) {
  return text
    .split(" ")
    .map((tok) => {
      const n = norm(tok);
      const hit = n && (keywords.has(n) || HIGHLIGHT_WORDS.includes(n) || /^\d[\d.,%]*$/.test(n));
      return hit ? `{\\c${YELLOW}}${esc(tok)}{\\c${WHITE}}` : esc(tok);
    })
    .join(" ");
}

export function buildAss(opts: {
  scenes: TimedScene[];
  w: number;
  h: number;
  subtitles: boolean;
  position: "abajo" | "centro" | "arriba";
  title: string;
}) {
  const { w, h } = opts;
  const vertical = h > w;
  const base = Math.min(w, h);
  const subSize = Math.round(vertical ? w * 0.072 : base * 0.062);
  const outline = Math.max(2, Math.round(subSize * 0.09));
  const align = opts.position === "arriba" ? 8 : opts.position === "centro" ? 5 : 2;
  const marginV = Math.round(opts.position === "abajo" ? h * (vertical ? 0.2 : 0.08) : opts.position === "arriba" ? h * 0.12 : 0);
  const margin = Math.round(w * 0.06);
  const small = Math.round(base * 0.032);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Inter ExtraBold,${subSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${outline},${Math.round(outline / 2)},${align},${margin},${margin},${marginV},1
Style: VerseRef,DejaVu Serif,${Math.round(base * 0.05)},${GOLD.slice(0, -1)},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,${Math.max(2, outline - 1)},2,8,${margin},${margin},${Math.round(h * 0.1)},1
Style: VerseText,DejaVu Serif,${Math.round(base * (vertical ? 0.04 : 0.036))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,${Math.max(2, outline - 1)},2,8,${Math.round(w * 0.1)},${Math.round(w * 0.1)},${Math.round(h * 0.18)},1
Style: Tag,Inter Bold,${small},&H00FFFFFF,&H00FFFFFF,&H001C1CB8,&H00000000,-1,0,0,0,100,100,2,0,3,${Math.round(small * 0.35)},0,7,${margin},${margin},${Math.round(h * 0.06)},1
Style: Headline,Inter ExtraBold,${Math.round(base * 0.045)},&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(base * 0.016)},0,7,${margin},${margin},${Math.round(h * 0.06 + small * 2.1)},1
Style: Interp,Inter Bold,${small},&H0045B8E8,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,2,1,9,${margin},${margin},${Math.round(h * 0.06)},1
Style: Place,Inter Black,${Math.round(base * 0.07)},${GOLD.slice(0, -1)},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,4,0,1,${outline},3,5,0,0,0,1
Style: Info,Inter Black,${Math.round(base * 0.075)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,${outline},3,5,${margin},${margin},0,1
Style: Disclaimer,Inter Bold,${Math.round(base * 0.022)},&H00DDDDDD,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1,0,3,${Math.round(w * 0.03)},${Math.round(w * 0.03)},${Math.round(h * 0.03)},1
Style: Shape,Inter Bold,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev: string[] = [];
  const add = (layer: number, s: number, e: number, style: string, text: string) => ev.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`);

  for (const sc of opts.scenes) {
    const d = sc.end - sc.start;
    const o = sc.overlay;
    const os = sc.start + 0.35;
    const oe = Math.max(os + 1.5, sc.end - 0.2);
    if (o?.type === "verse") {
      // velo oscuro para legibilidad
      add(0, os, oe, "Shape", `{\\an7\\pos(0,0)\\1c&H000000&\\1a&HFF&\\t(0,400,\\1a&H70&)\\p1}m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`);
      add(2, os, oe, "VerseRef", `{\\fad(400,300)\\blur0.6}${esc(o.ref.toUpperCase())}`);
      if (o.text && !opts.subtitles) add(2, os + 0.3, oe, "VerseText", `{\\fad(500,300)}“${esc(o.text)}”`);
      add(2, os, oe, "Disclaimer", `{\\an1\\fad(400,300)}Reina-Valera 1960`);
    } else if (o?.type === "headline") {
      add(3, os, Math.min(oe, os + 6), "Tag", `{\\fad(200,200)\\move(${-w * 0.2},${Math.round(h * 0.06)},${margin},${Math.round(h * 0.06)},0,350)}  INFORME  `);
      add(3, os + 0.2, Math.min(oe, os + 6), "Headline", `{\\fad(300,250)}${esc(o.text.toUpperCase())}`);
    } else if (o?.type === "map") {
      const cx = Math.round(w / 2);
      const cy = Math.round(h * (vertical ? 0.4 : 0.42));
      const r = Math.round(base * 0.03);
      // anillos animados (pulso) y pin
      for (let k = 0; k < 2; k++) {
        add(4, os + k * 0.6, oe, "Shape", `{\\an7\\pos(${cx - r * 4},${cy - r * 4})\\1c${GOLD}\\bord0\\1a&H40&\\fscx20\\fscy20\\t(0,1400,\\fscx100\\fscy100\\1a&HFF&)\\p1}${circle(r * 4)}{\\p0}`);
      }
      add(5, os, oe, "Shape", `{\\an7\\pos(${cx - r},${cy - r})\\1c&H1C1CC8&\\3c&HFFFFFF&\\bord${Math.max(2, r / 4)}\\fad(200,200)\\p1}${circle(r)}{\\p0}`);
      add(5, os + 0.2, oe, "Place", `{\\pos(${cx},${cy + r * 3.2})\\fad(400,300)\\fscx80\\fscy80\\t(0,500,\\fscx100\\fscy100)}${esc(o.place.toUpperCase())}`);
    } else if (o?.type === "interpretation") {
      add(3, os, oe, "Interp", `{\\fad(400,300)}INTERPRETACIÓN PROFÉTICA`);
    } else if (o?.type === "info" && d > 2.5) {
      add(3, os, Math.min(oe, os + 3.5), "Info", `{\\fad(250,250)\\fscx70\\fscy70\\t(0,300,\\fscx100\\fscy100)\\pos(${Math.round(w / 2)},${Math.round(h * 0.38)})}${esc(o.text.toUpperCase())}`);
    }
    if (sc.isAi) add(1, sc.start, sc.end, "Disclaimer", "Imagen ilustrativa generada con IA");

    if (opts.subtitles) {
      const kw = new Set(sc.keywords.map(norm));
      const cues = chunkScene(sc.text, sc.start, sc.end, vertical ? 4 : 6, vertical ? 26 : 40);
      for (const c of cues) {
        add(10, c.start, c.end, "Sub", `{\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}${highlight(c.text, kw)}`);
      }
    }
  }
  return header + ev.join("\n") + "\n";
}

function circle(r: number) {
  const k = Math.round(r * 0.5523);
  const d = r * 2;
  return `m ${r} 0 b ${r + k} 0 ${d} ${r - k} ${d} ${r} b ${d} ${r + k} ${r + k} ${d} ${r} ${d} b ${r - k} ${d} 0 ${r + k} 0 ${r} b 0 ${r - k} ${r - k} 0 ${r} 0`;
}
