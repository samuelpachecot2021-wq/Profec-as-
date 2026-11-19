import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "PROFECÍA STUDIO AI",
  description: "Producción automatizada de videos cristianos y documentales proféticos",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0a0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-4 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
