import { Card } from "@/components/ui";
import { TOPICS } from "@/lib/options";

export default function Help() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-serif text-2xl font-extrabold text-white">Ayuda rápida</h1>
      <Card title="Crear un video en 4 pasos">
        <ol className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-zinc-300">
          <li>
            En <b>Estudio</b>, pegue el artículo (o cargue un TXT, PDF o Word). Puede estar en cualquier idioma.
          </li>
          <li>Elija duración (8 minutos por defecto), voz, formato, resolución y música.</li>
          <li>
            Pulse <b>Generar guion</b> para revisarlo y editarlo, o directamente <b>Generar video completo</b>.
          </li>
          <li>
            Al terminar, pulse <b>Descargar video</b> y <b>Descargar miniatura</b>. Copie títulos, descripción y hashtags desde la sección de YouTube.
          </li>
        </ol>
      </Card>
      <Card title="Cambiar una imagen">
        <p className="text-sm leading-relaxed text-zinc-300">
          Debajo del video aparecen todas las escenas. Pulse una, busque otra imagen (en inglés da mejores resultados), suba la suya o genérela con IA. Después pulse <b>Volver a renderizar con los cambios</b>: solo se rehacen las escenas modificadas.
        </p>
      </Card>
      <Card title="¿Cuánto cuesta?">
        <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
          <li>
            <b>Gratis:</b> voces «Jorge», «Gonzalo», «Tomás» y «Dalia», imágenes de Pexels/Pixabay/Unsplash/Wikimedia/NASA, música, edición y render.
          </li>
          <li>
            <b>De pago (opcional):</b> Claude para guiones profesionales (normalmente menos de 0,50 USD por video de 8 min), ElevenLabs/Azure para voz, OpenAI para imágenes con IA.
          </li>
          <li>Antes de cualquier gasto, la app muestra el costo estimado y pide su autorización. También puede fijar un presupuesto mensual en Ajustes.</li>
        </ul>
      </Card>
      <Card title="Normas editoriales que aplica la app">
        <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
          <li>No inventa noticias, declaraciones ni citas; distingue hechos de interpretación profética (aparece la etiqueta «Interpretación profética»).</li>
          <li>Citas bíblicas de la Reina-Valera 1960. Revise siempre las citas antes de publicar.</li>
          <li>Usa «arrebatamiento» en lugar de «rapto».</li>
          <li>Las imágenes generadas con IA se marcan como «Imagen ilustrativa generada con IA».</li>
          <li>Registra fuente, autor y licencia de cada imagen o clip y los añade a la descripción.</li>
        </ul>
      </Card>
      <Card title="Temáticas optimizadas">
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => (
            <span key={t} className="rounded-full border border-gold/40 px-3 py-1 text-xs text-gold">
              {t}
            </span>
          ))}
        </div>
      </Card>
      <Card title="📲 Instalar la app en Android">
        <ol className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-zinc-300">
          <li>Abra el enlace de su app en <b>Google Chrome</b> e inicie sesión.</li>
          <li>
            Pulse el botón dorado <b>«Instalar app»</b> (arriba). Si no aparece: menú <b>⋮</b> de Chrome → <b>«Instalar aplicación»</b>.
          </li>
          <li>Se crea el icono <b>Profecía Studio</b> en la pantalla de inicio. Se abre a pantalla completa.</li>
          <li>
            En <b>Ajustes → Este dispositivo</b> pulse <b>Activar</b> en los avisos para recibir una notificación cuando cada video esté listo.
          </li>
        </ol>
      </Card>
      <Card title="☁️ Producción en la nube">
        <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
          <li>Los videos se producen en el servidor: puede cerrar la app, apagar la pantalla o quedarse sin conexión.</li>
          <li>Se producen varios videos a la vez (hasta 12 al día, ajustable en Ajustes).</li>
          <li>Si el servidor se reinicia, los trabajos pendientes se reanudan solos.</li>
          <li>Los videos, miniaturas y subtítulos se descargan directamente a la carpeta «Descargas» del teléfono.</li>
          <li>Si la voz gratuita en línea fallara, la app cambia sola a la voz Piper del servidor (también gratuita).</li>
        </ul>
      </Card>
    </div>
  );
}
