import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { PwaSetup } from "@/components/pwa";

export const metadata: Metadata = {
  title: "PROFECÍA STUDIO AI",
  description: "Producción automatizada de videos cristianos y documentales proféticos",
  applicationName: "Profecía Studio",
  appleWebApp: { capable: true, title: "Profecía Studio", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0a0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <PwaSetup />
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-4 sm:px-6 lg:pb-16">{children}</main>
      </body>
    </html>
  );
}
