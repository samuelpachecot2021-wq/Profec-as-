"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, CostDialog, Modal, Select, api, inputCls, type Estimate } from "./ui";

type Photo = {
  id: string;
  source: string;
  kind: "real" | "stock" | "ia";
  role: string;
  subject?: string;
  verified?: string;
  title: string;
  author: string;
  license: string;
  date?: string;
  pageUrl?: string;
  preview?: string;
  width?: number;
  height?: number;
};
type Proposal = {
  design: string;
  label: string;
  headline: string;
  highlight: string[];
  tag: string | null;
  name: string | null;
  aiGenerated: boolean;
  bytes: number;
  url: string | null;
  download: string | null;
  photo: Photo | null;
  bg: Photo | null;
};
type State = {
  style: "noticias" | "biblico";
  styleSetting: string;
  w: number;
  h: number;
  selected: number;
  updatedAt: string;
  warnings: string[];
  analysis: { engine: string; styleReason: string; topic: string; people: string[]; places: string[]; event: string | null };
  proposals: Proposal[];
  candidates: Photo[];
};

const KIND: Record<Photo["kind"], string> = { real: "Foto real verificada", stock: "Foto de archivo con licencia", ia: "Recreación generada con IA" };
const STYLE: Record<string, string> = { noticias: "Noticias y actualidad", biblico: "Bíblico cinematográfico", inteligente: "Inteligente" };

function PhotoInfo({ p }: { p: Photo | null }) {
  if (!p) return <p className="text-xs text-zinc-500">Sin fotografía (fondo de diseño).</p>;
  return (
    <p className="text-xs leading-relaxed text-zinc-400">
      <span className={p.kind === "real" ? "text-emerald-300" : p.kind === "ia" ? "text-amber-300" : "text-sky-300"}>{KIND[p.kind]}</span>
      {p.subject ? ` · ${p.subject}` : ""}
      {p.date ? ` · ${p.date}` : ""} · {p.license || "licencia del recurso"} · {p.author}
      {p.pageUrl && (
        <>
          {" · "}
          <a href={p.pageUrl} target="_blank" rel="noreferrer" className="underline">
            fuente
          </a>
        </>
      )}
      {p.verified && <span className="block text-zinc-500">✔ {p.verified}</span>}
    </p>
  );
}

export function ThumbnailsPanel({ projectId, busy, onChanged, onError }: { projectId: string; busy: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [edit, setEdit] = useState<number | null>(null);
  const [headline, setHeadline] = useState("");
  const [hl, setHl] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [style, setStyle] = useState("inteligente");
  const pending = useRef<null | (() => void)>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ state: State | null }>(`/api/projects/${projectId}/thumbnails`);
      setSt(r.state);
      if (r.state) setStyle(r.state.styleSetting);
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoaded(true);
    }
  }, [projectId, onError]);

  useEffect(() => {
    void load();
  }, [load, busy]);

  async function act(key: string, json: unknown) {
    setWorking(key);
    setWarn(null);
    try {
      const r = await api<{ state?: State; warning?: string | null; needsAuthorization?: boolean; estimate?: Estimate }>(`/api/projects/${projectId}/thumbnails`, { method: "POST", json });
      if (r.needsAuthorization && r.estimate) {
        setEstimate(r.estimate);
        pending.current = () => {
          setEstimate(null);
          void act(key, { ...(json as object), authorize: true });
        };
        return;
      }
      if (r.state) setSt(r.state);
      if (r.warning) setWarn(r.warning);
      onChanged();
      return r;
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setWorking(null);
    }
  }

  const vertical = st ? st.h > st.w : false;

  if (!loaded) return null;
  return (
    <Card step="5" title="Miniaturas">
      {!st ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Cree tres propuestas modernas adaptadas al contenido del guion y al formato del video, sin volver a renderizar el video.</p>
          <Button variant="gold" className="w-full" disabled={busy} loading={working === "regen"} onClick={() => act("regen", { action: "regenerate" })}>
            🖼️ Generar propuestas
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-ink/60 p-3 text-xs text-zinc-400">
            <p>
              <b className="text-gold">Estilo: {STYLE[st.style]}</b>
              {st.styleSetting === "inteligente" ? " (elegido automáticamente)" : ""} · {st.w}×{st.h}
            </p>
            <p className="mt-1">{st.analysis.styleReason}</p>
            {(st.analysis.people.length > 0 || st.analysis.places.length > 0 || st.analysis.event) && (
              <p className="mt-1">
                {st.analysis.people.length > 0 && <>Protagonistas: {st.analysis.people.join(", ")}. </>}
                {st.analysis.places.length > 0 && <>Lugares: {st.analysis.places.join(", ")}. </>}
                {st.analysis.event && <>Acontecimiento: {st.analysis.event}.</>}
              </p>
            )}
          </div>
          {st.warnings.map((w, i) => (
            <Alert key={i} kind="warn">
              {w}
            </Alert>
          ))}
          {warn && <Alert kind="warn">{warn}</Alert>}

          <div className="grid grid-cols-1 gap-4">
            {st.proposals.map((p, i) => (
              <div key={p.design} className={`overflow-hidden rounded-xl border ${st.selected === i ? "border-gold" : "border-line"} ${vertical ? "flex" : ""}`}>
                {p.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.url}
                    alt={`Propuesta ${i + 1}: ${p.label}`}
                    className={`bg-black object-cover ${vertical ? "aspect-[9/16] w-32 shrink-0 self-start sm:w-40" : st.w === st.h ? "aspect-square w-full" : st.h > st.w ? "aspect-[4/5] w-full" : "aspect-video w-full"}`}
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <b className="text-sm">
                      {i + 1}. {p.label}
                    </b>
                    {st.selected === i ? <span className="text-xs font-semibold text-gold">★ Principal</span> : null}
                  </div>
                  <PhotoInfo p={p.photo} />
                  {p.aiGenerated && (
                    <p className="text-xs text-amber-300/90">Contiene una recreación generada con IA. Al subirla a YouTube, marque «contenido alterado o sintético». No se presenta como fotografía real.</p>
                  )}
                  {edit === i ? (
                    <div className="space-y-2">
                      <input className={inputCls} value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} placeholder="Titular (2 a 5 palabras)" />
                      <input className={inputCls} value={hl} onChange={(e) => setHl(e.target.value)} placeholder="Palabras resaltadas en amarillo (del titular)" />
                      <div className="flex gap-2">
                        <Button
                          variant="gold"
                          loading={working === `h${i}`}
                          onClick={async () => {
                            const r = await act(`h${i}`, { action: "headline", index: i, headline, highlight: hl.split(/[\s,]+/).filter(Boolean) });
                            if (r) setEdit(null);
                          }}
                        >
                          Guardar titular
                        </Button>
                        <Button variant="ghost" onClick={() => setEdit(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="dark"
                        onClick={() => {
                          setEdit(i);
                          setHeadline(p.headline);
                          setHl(p.highlight.join(" "));
                        }}
                      >
                        ✏️ Titular
                      </Button>
                      <Button variant="dark" onClick={() => setPhotoFor(i)}>
                        🔄 Foto
                      </Button>
                      {p.download && (
                        <a href={p.download}>
                          <Button variant="dark" className="w-full">
                            ⬇️ Descargar
                          </Button>
                        </a>
                      )}
                      <Button variant={st.selected === i ? "ghost" : "dark"} disabled={st.selected === i} loading={working === `s${i}`} onClick={() => act(`s${i}`, { action: "select", index: i })}>
                        ★ Principal
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-48 flex-1">
              <Select
                value={style}
                onChange={setStyle}
                options={[
                  { value: "inteligente", label: "Inteligente (según el guion)" },
                  { value: "noticias", label: "Noticias y actualidad" },
                  { value: "biblico", label: "Bíblico cinematográfico" },
                ]}
              />
            </div>
            <Button variant="ghost" disabled={busy} loading={working === "regen"} onClick={() => act("regen", { action: "regenerate", style })}>
              🔁 Regenerar las 3 propuestas
            </Button>
          </div>
          <p className="text-xs text-zinc-500">Editar un titular o cambiar una foto solo rehace esa propuesta. Las fotos de personas reales provienen de Wikimedia Commons con identidad verificada en Wikidata y licencia libre; nunca se generan rostros con IA.</p>
        </div>
      )}

      <PhotoPicker
        open={photoFor !== null}
        projectId={projectId}
        state={st}
        index={photoFor ?? 0}
        working={working}
        onClose={() => setPhotoFor(null)}
        onPick={async (id) => {
          const r = await act(`p${photoFor}`, { action: "photo", index: photoFor, candidateId: id });
          if (r) setPhotoFor(null);
        }}
        onUploaded={(s) => {
          setSt(s);
          setPhotoFor(null);
          onChanged();
        }}
        onError={onError}
      />
      <CostDialog
        estimate={estimate}
        onCancel={() => {
          setEstimate(null);
          pending.current = null;
        }}
        onConfirm={() => pending.current?.()}
      />
    </Card>
  );
}

function PhotoPicker(props: {
  open: boolean;
  projectId: string;
  state: State | null;
  index: number;
  working: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onUploaded: (s: State) => void;
  onError: (m: string) => void;
}) {
  const { state, index } = props;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"person" | "place" | "event">("person");
  const [results, setResults] = useState<Photo[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [license, setLicense] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!state) return null;
  const news = state.style === "noticias";
  const list = (results ?? state.candidates).filter((c) => !(news && c.kind === "ia"));

  async function search() {
    setSearching(true);
    setMsg(null);
    try {
      const r = await api<{ results: Photo[]; message: string }>(`/api/projects/${props.projectId}/thumbnails`, { method: "POST", json: { action: "search", query, kind } });
      setResults(r.results);
      setMsg(r.message);
    } catch (e) {
      props.onError(String(e instanceof Error ? e.message : e));
    } finally {
      setSearching(false);
    }
  }

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("index", String(index));
      fd.append("license", license || "Material propio con derechos de uso");
      const r = await fetch(`/api/projects/${props.projectId}/thumbnails`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo subir la imagen");
      props.onUploaded(j.state);
    } catch (e) {
      props.onError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={props.open} onClose={props.onClose} title={`Cambiar la foto de la propuesta ${index + 1}`} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} min-w-48 flex-1`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Persona, lugar o acontecimiento (p. ej. Benjamín Netanyahu)" onKeyDown={(e) => e.key === "Enter" && query && search()} />
          <div className="w-40">
            <Select
              value={kind}
              onChange={setKind}
              options={[
                { value: "person", label: "Persona" },
                { value: "place", label: "Lugar o país" },
                { value: "event", label: "Acontecimiento" },
              ]}
            />
          </div>
          <Button variant="gold" loading={searching} disabled={!query} onClick={search}>
            Buscar
          </Button>
        </div>
        <p className="text-xs text-zinc-500">Búsqueda en Wikimedia Commons: solo fotos con licencia libre para uso comercial, con autor y fecha, cuya identidad se verifica en Wikidata.</p>
        {msg && <Alert kind="info">{msg}</Alert>}
        {results && (
          <button className="text-xs text-gold underline" onClick={() => setResults(null)}>
            Ver las fotos sugeridas para este video
          </button>
        )}
        <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {list.map((c) => (
            <button key={c.id} className="overflow-hidden rounded-xl border border-line text-left transition hover:border-gold disabled:opacity-50" disabled={!!props.working} onClick={() => props.onPick(c.id)}>
              {c.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.preview} alt={c.title} loading="lazy" className="aspect-video w-full bg-black object-cover" />
              ) : (
                <div className="aspect-video w-full bg-black" />
              )}
              <div className="p-2">
                <PhotoInfo p={c} />
              </div>
            </button>
          ))}
          {list.length === 0 && <p className="col-span-full text-sm text-zinc-400">No hay fotos disponibles. Busque otra persona o lugar, o suba su propia foto.</p>}
        </div>
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">Subir mi propia foto</p>
          <input className={inputCls} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Licencia o permiso (p. ej. «Foto propia», «Comprada en …»)" />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="dark" loading={uploading} onClick={() => fileRef.current?.click()}>
            📤 Elegir imagen
          </Button>
          <p className="text-xs text-zinc-500">Use solo fotos propias o con permiso de uso. No suba fotos de agencias o periódicos sin licencia.</p>
        </div>
      </div>
    </Modal>
  );
}
