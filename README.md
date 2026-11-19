# ✝ PROFECÍA STUDIO AI

Aplicación para producir **documentales cristianos y videos de profecía bíblica** para YouTube y Facebook de forma automática:
usted pega un artículo y la app escribe el guion, lo narra con voz grave de documental, busca imágenes y clips con licencia,
edita el video con efectos cinematográficos, añade música y subtítulos, y entrega el **MP4 listo**, **3 miniaturas** y los
**títulos, descripción, hashtags y capítulos** para publicar.

> 🌐 **¿Quiere usarla desde el teléfono con un enlace?** Siga la guía [**DESPLIEGUE.md**](DESPLIEGUE.md): publicación en la nube
> (Railway o servidor gratuito de Oracle), costos, instalación como app en Android y notificaciones.

---

## 🚀 Puesta en marcha en su computadora (opcional)

Solo hay que hacerlo **una vez**.

### 1. Instale dos programas gratuitos

| Programa | Para qué sirve | Cómo instalarlo |
|---|---|---|
| **Node.js** (versión LTS) | Hace funcionar la app | Descárguelo de <https://nodejs.org> y pulse «Siguiente» hasta terminar |
| **FFmpeg** | Edita y exporta el video | **Windows:** abra *PowerShell* y escriba `winget install Gyan.FFmpeg` · **Mac:** instale <https://brew.sh> y escriba `brew install ffmpeg` · **Linux:** `sudo apt install ffmpeg` |

### 2. Descargue la aplicación

En la página del repositorio en GitHub pulse el botón verde **Code → Download ZIP**, descomprima la carpeta donde quiera
(por ejemplo, en *Documentos*).

### 3. Ábrala con doble clic

* **Windows:** doble clic en `iniciar-windows.bat`
* **Mac / Linux:** doble clic en `iniciar-mac-linux.sh` (o en la Terminal: `bash iniciar-mac-linux.sh`)

La primera vez tarda unos minutos. Después se abrirá el navegador en **http://localhost:3000**.
**No cierre la ventana negra** mientras use la app.

> ¿Prefiere la Terminal? `npm install`, luego `npm run iniciar`.

---

## 🎬 Cómo crear un video

1. En **Estudio**, pegue el artículo (o pulse *Cargar TXT, PDF o Word*). Puede estar en español, inglés, árabe, portugués…
2. Elija **duración** (8 minutos por defecto), **voz**, **formato**, **resolución**, **música** y **subtítulos**.
3. Pulse **✍️ Generar guion** para revisarlo y editarlo, o directamente **🎬 Generar video completo**.
4. Verá el progreso paso a paso. Al terminar: **⬇️ Descargar video** y **🖼️ Descargar miniatura**.
5. Más abajo encontrará las **escenas** (pulse una para cambiar su imagen) y la sección **YouTube** con todo listo para copiar.

**Producción masiva:** en *Producción masiva* pegue varios artículos separados por una línea `---` (hasta 12 al día).
Los proyectos se guardan solos; si cierra la app o se apaga el equipo, la producción **se reanuda** al volver a abrirla.

---

## 🔑 Claves de servicios (opcional, desde el menú **Ajustes**)

La app **funciona sin ninguna clave** (voz neuronal gratuita, imágenes de Wikimedia y NASA, música propia, guion en modo local).
Para mejores resultados añada estas claves en **Ajustes** (se guardan solo en su equipo, nunca en GitHub ni en el navegador):

| Servicio | Costo | Mejora |
|---|---|---|
| **Pexels** / **Pixabay** / **Unsplash** | Gratis | Miles de videos y fotos con licencia comercial |
| **Claude (Anthropic)** | De pago por uso (normalmente < 0,50 USD por video de 8 min con Opus 5.5) | Guiones profesionales, traducción, títulos y capítulos |
| **Ollama** | Gratis (en su equipo, requiere un PC potente) | Alternativa local a Claude |
| **ElevenLabs** / **Azure Speech** | De pago (Azure tiene nivel gratuito) | Voces aún más naturales |
| **OpenAI** | De pago por imagen (~0,04 USD) | Imágenes generadas con IA cuando no hay material |

💰 **Control de costos:** antes de usar cualquier servicio de pago la app muestra el **costo estimado** y pide su autorización.
Nunca gasta más del 20 % sobre lo autorizado y se detiene al llegar al **presupuesto mensual** (10 USD por defecto, configurable).

---

## ✅ Qué hace automáticamente

* **Guion** con gancho en los primeros 5 segundos, preguntas, suspenso, transiciones, citas **Reina-Valera 1960**, pausas con «…»
  y **cierre evangelístico** centrado en Jesucristo; en un solo párrafo y editable. No inventa noticias ni citas, distingue
  **hechos** de **interpretación profética** y usa «**arrebatamiento**» en lugar de «rapto».
* **Voz en off** predeterminada: **Brian de ElevenLabs** (velocidad 0,95), con alternativas gratuitas (*Jorge*, Piper), vista previa y opción de subir su propia narración.
* **Imágenes y clips** elegidos tras analizar el significado de cada fragmento en el contexto de todo el guion: 3 búsquedas en inglés por escena (de específica a general), prioridad a metraje real, cinematográfico y documental (Pixabay solo «film»), descarte automático de adornos navideños, cráneos, caricaturas, ilustraciones y animaciones tecnológicas fuera de lugar, sin repetir clips en el mismo video, con **fuente, autor y licencia** registrados. Las imágenes con IA se rotulan como ilustrativas.
  con **fuente, autor y licencia** registrados y añadidos a la descripción. Las imágenes con IA se rotulan como ilustrativas.
* **Edición:** efecto Ken Burns (acercamientos, alejamientos, paneos), transiciones cinematográficas y de luz, partículas,
  corrección de color, viñeta, rótulos de **versículos**, **titulares**, **mapas** con marcador animado, etiqueta de **interpretación profética**.
  Cambio de imagen cada 3–5 segundos según el ritmo real de la narración; los primeros 3 segundos llevan destello de luz, acercamiento rápido y título de impacto.
* **Música** instrumental original (sintetizada por la app, sin derechos de terceros) en 8 estilos, con **bajada automática de volumen** bajo la voz.
  Puede subir sus propias pistas (p. ej. de la Biblioteca de audio de YouTube) en *Ajustes*.
* **Subtítulos** grandes, blancos con borde negro y **palabras clave en amarillo**, respetando las zonas seguras de Reels, TikTok y Shorts, posición configurable, **SRT** descargable y traducción opcional al inglés.
* **Formatos** 16:9, 9:16, 4:5 y 1:1 en 720p, 1080p, 1440p y 4K · **MP4 H.264 + AAC**, sonido normalizado para YouTube (−14 LUFS).
* **3 miniaturas** 1280×720 de alto contraste en rojo, amarillo, blanco, negro y dorado.
* **YouTube:** 5 títulos (en MAYÚSCULAS y en estilo oración), 3 títulos de miniatura, descripción, 3 hashtags, palabras clave,
  capítulos con marcas de tiempo y publicación para Facebook.

---

## 📱 Aplicación web instalable (PWA)

* Se instala en Android desde Chrome («Instalar app»), con icono propio y pantalla completa.
* Inicio de sesión privado (`ADMIN_USER` / `ADMIN_PASSWORD`), sesiones firmadas de 30 días y bloqueo tras intentos fallidos.
* Producción en el servidor en segundo plano, varios videos a la vez, reanudación automática tras reinicios.
* Notificaciones push (estándar Web Push, gratis) cuando cada video termina.
* Historial de proyectos y descarga directa de video, miniaturas y subtítulos al teléfono.

Sin `ADMIN_PASSWORD`, la app solo acepta conexiones del propio equipo (uso local).

---

## 🛠️ Información técnica

* **Next.js 15 + React 19 + TypeScript + Tailwind CSS 4** · **SQLite** (better-sqlite3) · **FFmpeg** (render, transiciones `xfade`,
  Ken Burns `zoompan`, subtítulos y gráficos ASS/libass, mezcla con `sidechaincompress` y `loudnorm`).
  Se eligió FFmpeg directo en lugar de Remotion porque no requiere navegador para renderizar, es mucho más rápido en equipos
  modestos y no tiene restricciones de licencia comercial.
* Datos en `data/` (base de datos, proyectos, videos, claves en `data/secrets.json` con permisos 600). Esta carpeta **no se sube a Git**.
* Cola de producción persistente con recuperación de trabajos interrumpidos y caché por paso (voz, recursos, escenas): volver a renderizar
  tras cambiar una imagen solo rehace lo necesario.
* Despliegue: `Dockerfile` (Ubuntu 24.04 + FFmpeg 6.1 + Piper + eSpeak/MBROLA), `railway.json`, y `deploy/` (docker compose + Caddy con HTTPS para servidor propio).
* Comandos: `npm run dev` (desarrollo) · `npm test` (pruebas) · `npm run prueba` (video de prueba sin claves ni internet) · `npm run typecheck`.

### Estructura

```
src/app/            Páginas (Estudio, Proyectos, Producción masiva, Ajustes, Ayuda) y API
src/components/     Interfaz
src/lib/script.ts   Guion (Claude / Ollama / modo local), traducción, normas editoriales
src/lib/scenes.ts   División en escenas y planificación visual
src/lib/tts.ts      Voces (Edge gratis, Azure, ElevenLabs, eSpeak)
src/lib/media.ts    Pexels, Pixabay, Unsplash, Wikimedia, NASA, IA, licencias
src/lib/render.ts   Edición y exportación con FFmpeg
src/lib/pipeline.ts Producción completa · src/lib/queue.ts Cola y recuperación
```

### Avisos

* Revise siempre el guion y las citas bíblicas antes de publicar. Texto bíblico: Reina-Valera 1960 © Sociedades Bíblicas en América Latina, 1960; renovado © Sociedades Bíblicas Unidas, 1988.
* La voz gratuita usa el servicio en línea de lectura de Microsoft Edge (no oficial); si dejara de funcionar, use Azure (nivel gratuito) o ElevenLabs.
* Las licencias de los bancos de imágenes pueden cambiar: la app guarda el enlace de cada recurso en `creditos-y-licencias.txt`.
* Fuentes tipográficas incluidas: Inter (SIL OFL) y DejaVu (licencia libre) — ver `assets/fonts/`.
