"use client";
import type { Seo } from "@/lib/seo";
import { Card, CopyButton, fmtTime } from "./ui";

export function SeoPanel({ seo }: { seo: Seo & { fullDescription?: string } }) {
  const chapters = seo.chapters.map((c) => `${fmtTime(c.time)} ${c.title}`).join("\n");
  return (
    <Card title="Optimización para YouTube y Facebook" right={<span className="text-xs text-zinc-500">{seo.engine === "ia" ? "Generado con IA" : "Modo local"}</span>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Block title="Títulos para YouTube">
            <ol className="space-y-2">
              {seo.titles.map((t, i) => (
                <li key={i} className="rounded-xl border border-line bg-ink p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-bold text-white">{t.upper}</span>
                    <CopyButton text={t.upper} />
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <span className="text-sm text-zinc-300">{t.sentence}</span>
                    <CopyButton text={t.sentence} />
                  </div>
                </li>
              ))}
            </ol>
          </Block>
          <Block title="Títulos para miniatura">
            <div className="flex flex-wrap gap-2">
              {seo.thumbnailTitles.map((t) => (
                <span key={t} className="rounded-lg bg-blood/20 px-3 py-1.5 text-sm font-extrabold text-gold2">
                  {t}
                </span>
              ))}
            </div>
          </Block>
          <Block title="Hashtags" copy={seo.hashtags.join(" ")}>
            <p className="text-sm text-sky-300">{seo.hashtags.join(" ")}</p>
          </Block>
          <Block title="Palabras clave (etiquetas)" copy={seo.keywords.join(", ")}>
            <p className="text-sm text-zinc-300">{seo.keywords.join(", ")}</p>
          </Block>
          {seo.chapters.length >= 3 && (
            <Block title="Capítulos" copy={chapters}>
              <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-300">{chapters}</pre>
            </Block>
          )}
        </div>
        <div className="space-y-4">
          <Block title="Descripción completa (con capítulos y créditos)" copy={seo.fullDescription ?? seo.description}>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-ink p-3 font-sans text-xs leading-relaxed text-zinc-300 scroll-thin">{seo.fullDescription ?? seo.description}</pre>
          </Block>
          <Block title="Publicación para Facebook" copy={seo.facebookPost}>
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-ink p-3 font-sans text-sm leading-relaxed text-zinc-200">{seo.facebookPost}</pre>
          </Block>
        </div>
      </div>
    </Card>
  );
}

function Block({ title, copy, children }: { title: string; copy?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gold">{title}</h3>
        {copy && <CopyButton text={copy} />}
      </div>
      {children}
    </div>
  );
}
