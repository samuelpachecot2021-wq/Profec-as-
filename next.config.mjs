/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "mammoth", "msedge-tts"],
  experimental: { serverActions: { bodySizeLimit: "200mb" } },
  // Las subidas grandes (audios, documentos) pasan por las rutas /api.
};
export default nextConfig;
