import "./_env";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, ProcessError, isDiskFull, downloadTo } from "../src/lib/util";
import http from "node:http";
import { estimateRenderMB, freeSpace, diskInfo, ensureSpace, DiskFullError } from "../src/lib/disk";
import { compatibleStill, verifyOutput, validDuration } from "../src/lib/render";
import { PROJECTS_DIR } from "../src/lib/paths";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "disco-"));

test("el código 228 de FFmpeg se explica como disco lleno (ENOSPC)", async () => {
  await assert.rejects(run("sh", ["-c", "echo 'Error writing trailer: No space left on device' >&2; echo 'Conversion failed!' >&2; exit 228"]), (e: unknown) => {
    assert.ok(e instanceof ProcessError);
    assert.match(e.message, /228 \(ENOSPC\)/);
    assert.match(e.message, /disco del servidor se llenó/);
    assert.ok(isDiskFull(e));
    return true;
  });
  await assert.rejects(run("sh", ["-c", "exit 244"]), /244 \(ENOMEM: memoria insuficiente\)/);
});

test("estimación de disco: video corto y de 8 minutos", () => {
  const short = estimateRenderMB(17, 1080, 1920, 0);
  const long = estimateRenderMB(480, 1080, 1920, 0.3);
  assert.ok(short > 15 && short < 60, `17 s vertical: ${short} MB`);
  assert.ok(long > 500 && long < 1200, `8 min vertical: ${long} MB`);
});

test("liberar espacio nunca borra recursos pagados, narraciones ni videos terminados", () => {
  const pdir = path.join(PROJECTS_DIR, "proyectoprueba");
  for (const d of ["media", "audio", "salida", "segmentos"]) fs.mkdirSync(path.join(pdir, d), { recursive: true });
  const keepFiles = [path.join(pdir, "media", "ia-runway-x.png"), path.join(pdir, "audio", "bloque-1.wav"), path.join(pdir, "salida", "video.mp4"), path.join(pdir, "segmentos", "particulas-1080x1920.png")];
  for (const f of keepFiles) fs.writeFileSync(f, "x".repeat(1000));
  const seg = path.join(pdir, "segmentos", "bloque-0-abc.mp4");
  const part = path.join(pdir, "salida", "video.mp4.part.mp4");
  fs.writeFileSync(seg, Buffer.alloc(2_000_000));
  fs.writeFileSync(part, Buffer.alloc(2_000_000));
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(part, old, old);
  const r = freeSpace({});
  assert.ok(!fs.existsSync(part), "se borra el MP4 a medias");
  assert.ok(!fs.existsSync(seg), "se borran escenas intermedias de proyectos que no se producen");
  for (const f of keepFiles) assert.ok(fs.existsSync(f), `se conserva ${path.basename(f)}`);
  assert.ok(r.freedMB >= 3);
  // el proyecto que se está produciendo conserva sus intermedios
  fs.writeFileSync(seg, Buffer.alloc(1000));
  freeSpace({ keepProject: "proyectoprueba" });
  assert.ok(fs.existsSync(seg));
});

test("si no hay espacio suficiente, se detiene antes de empezar con un mensaje claro", () => {
  const huge = diskInfo().freeMB + 10_000_000;
  assert.throws(() => ensureSpace(huge, "El render final", () => undefined), (e: unknown) => e instanceof DiskFullError && /amplíe el volumen en Railway/.test((e as Error).message));
});

test("imágenes raras se normalizan; las normales se usan sin pérdida", async () => {
  const normal = path.join(tmp, "normal.png");
  const rgba16 = path.join(tmp, "rgba16.png");
  const cmyk = path.join(tmp, "cmyk.jpg");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1152x2016", "-frames:v", "1", normal]);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1152x2016", "-frames:v", "1", "-pix_fmt", "rgba64be", rgba16]);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=800x600", "-frames:v", "1", "-pix_fmt", "yuvj444p", cmyk]);
  assert.equal(await compatibleStill(normal, 1080, 1920), normal, "PNG normal: sin conversión");
  const conv = await compatibleStill(rgba16, 1080, 1920);
  assert.notEqual(conv, rgba16, "PNG de 16 bits con transparencia: se normaliza");
  assert.ok(fs.statSync(conv).size > 0);
  assert.equal(await compatibleStill(cmyk, 1080, 1920), cmyk);
  const bad = path.join(tmp, "danada.png");
  fs.writeFileSync(bad, "no soy una imagen");
  await assert.rejects(compatibleStill(bad, 1080, 1920), /no se puede leer|no contiene datos de imagen válidos/);
});

test("verificación del MP4: detecta video sin sonido, duración incorrecta y archivos dañados", async () => {
  const good = path.join(tmp, "bueno.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=4", "-f", "lavfi", "-i", "sine=f=220:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", good]);
  const r = await verifyOutput(good, { w: 1080, h: 1920, total: 4 });
  assert.ok(r.meanDb > -40);
  await assert.rejects(verifyOutput(good, { w: 1080, h: 1920, total: 8 }), /duración/);
  const mute = path.join(tmp, "mudo.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=4", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", mute]);
  await assert.rejects(verifyOutput(mute, { w: 1080, h: 1920, total: 4 }), /mudo/);
  const cut = path.join(tmp, "cortado.mp4");
  fs.writeFileSync(cut, fs.readFileSync(good).subarray(0, 20000));
  assert.equal(await validDuration(cut), null, "un bloque a medias se detecta como no válido");
});

test("disco lleno durante una descarga: error normal (no se cuelga ni rompe el servidor)", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png", "content-length": 3_000_000 });
    res.end(Buffer.alloc(3_000_000, 1));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const dest = path.join(tmp, "imagen-pagada.png");
  fs.symlinkSync("/dev/full", `${dest}.part`); // /dev/full: toda escritura falla con ENOSPC
  try {
    await assert.rejects(downloadTo(`http://127.0.0.1:${port}/x.png`, dest), (e: unknown) => isDiskFull(e) && (e as NodeJS.ErrnoException).code === "ENOSPC");
    assert.ok(!fs.existsSync(dest), "no queda un archivo a medias");
  } finally {
    server.close();
  }
});
