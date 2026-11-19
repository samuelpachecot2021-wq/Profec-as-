import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PROFECÍA STUDIO AI",
    short_name: "Profecía Studio",
    description: "Producción automatizada de documentales cristianos y de profecía bíblica",
    lang: "es",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0a0d",
    theme_color: "#0b0a0d",
    categories: ["productivity", "video", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nuevo video", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mis proyectos", url: "/proyectos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
