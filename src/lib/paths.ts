import path from "node:path";
import fs from "node:fs";

export const ROOT = process.cwd();
/**
 * Carpeta de datos persistente (proyectos, videos, claves, configuración).
 * En Railway se usa automáticamente el disco conectado (RAILWAY_VOLUME_MOUNT_PATH),
 * así nada se pierde al publicar actualizaciones.
 */
export const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PROFECIA_DATA_DIR || path.join(ROOT, "data");

/** ¿Los datos sobreviven a las actualizaciones? null = no se puede saber (uso local). */
export function storagePersistent(): boolean | null {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return true;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return false;
  return null;
}
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const MUSIC_DIR = path.join(DATA_DIR, "music");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const FONTS_DIR = path.join(ROOT, "assets", "fonts");

for (const d of [DATA_DIR, PROJECTS_DIR, MUSIC_DIR, CACHE_DIR]) fs.mkdirSync(d, { recursive: true });

export function projectDir(id: string, ...sub: string[]) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("ID de proyecto inválido");
  const d = path.join(PROJECTS_DIR, id, ...sub);
  fs.mkdirSync(sub.length && path.extname(sub[sub.length - 1]) ? path.dirname(d) : d, { recursive: true });
  return d;
}

/** Ruta pública (para el navegador) de un archivo dentro de data/. */
export function publicUrl(absPath: string) {
  const rel = path.relative(DATA_DIR, absPath).split(path.sep).join("/");
  return `/api/files/${rel}`;
}

/** Resuelve una ruta relativa de data/ impidiendo salir del directorio. */
export function safeDataPath(rel: string) {
  const abs = path.resolve(DATA_DIR, rel);
  if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error("Ruta no permitida");
  if (/secrets\.json$|\.db(-wal|-shm)?$/.test(abs)) throw new Error("Ruta no permitida");
  return abs;
}
