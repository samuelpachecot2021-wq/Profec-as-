import { Studio } from "@/components/Studio";

export default function Home() {
  return (
    <>
      <div className="mb-5">
        <h1 className="font-serif text-2xl font-extrabold text-white sm:text-3xl">
          Del artículo al <span className="text-gold">documental profético</span>, en un clic
        </h1>
        <p className="mt-1 text-sm text-zinc-400">Pegue un artículo, elija la duración y pulse «Generar video completo». La app escribe el guion, narra, busca imágenes con licencia, edita y exporta el MP4.</p>
      </div>
      <Studio />
    </>
  );
}
