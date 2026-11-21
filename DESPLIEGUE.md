# 🌐 Publicar PROFECÍA STUDIO AI en internet

Una vez publicada, la app se abre con un enlace (por ejemplo `https://profecia-studio-production.up.railway.app`)
desde el teléfono Android, la tableta o la computadora, sin instalar nada más. Los videos se producen **en el servidor**:
puede cerrar la app, apagar la pantalla o quedarse sin conexión, y recibirá una notificación cuando estén listos.

Hay dos caminos. **Recomendado: Railway** (unos 15 minutos, sin conocimientos técnicos). Alternativa **gratuita**: un servidor
«Always Free» de Oracle Cloud (más pasos).

---

## 💰 Costos antes de empezar

> Precios orientativos de noviembre de 2026. Compruébelos en la web de cada servicio antes de contratar.
> **La app nunca contrata nada por usted**: cada servicio de pago lo da de alta usted misma.

### Alojamiento (elija uno)

| Opción | Costo mensual estimado | Notas |
|---|---|---|
| **Railway, plan Hobby** (recomendado) | **5 USD fijos** (incluyen 5 USD de consumo) + consumo extra: **≈ 0–8 USD** con 12 videos al día | Se paga solo lo que se usa: CPU y memoria al renderizar, disco y datos descargados. Puede fijar un **límite de gasto** en Railway. |
| **Oracle Cloud «Always Free»** | **0 USD** | 4 núcleos ARM y 24 GB de RAM gratis para siempre. Pide tarjeta solo para verificar identidad. A veces no hay plazas libres en la región. |

Desglose orientativo de Railway por video de 8 minutos en 1080p: render ≈ 0,02 USD · disco (videos guardados) ≈ 0,01 USD/mes ·
descarga del MP4 al teléfono (~200 MB) ≈ 0,01 USD. **Total ≈ 0,03–0,05 USD por video.** Con 4K el render cuesta unas 4 veces más.

### Servicios de contenido

| Servicio | Gratis | De pago (opcional) | Costo por video de 8 min |
|---|---|---|---|
| Imágenes y clips: **Pexels, Pixabay, Unsplash, Wikimedia, NASA** | ✅ Sí, ilimitado razonable | — | 0 USD |
| Voz **Jorge** (Microsoft Edge, en línea) | ✅ Sí | — | 0 USD |
| Voz **Piper** (en el propio servidor, respaldo automático) | ✅ Sí, sin límites | — | 0 USD |
| Voz **Azure Speech** (plan F0) | ✅ 500 000 caracteres/mes (≈ 70 videos) | 16 USD por millón de caracteres | 0 USD (F0) o ≈ 0,11 USD |
| Voz **ElevenLabs** | 10 000 caracteres/mes | desde ~5–22 USD/mes | ≈ 0,50–1,50 USD |
| Guion profesional con **Claude Opus 5.5** | — | pago por uso | **≈ 0,15–0,40 USD** |
| Guion con **Ollama** | ✅ en servidor propio potente | — | 0 USD |
| Imágenes con IA (**OpenAI**) | — | pago por imagen | ≈ 0,04–0,07 USD por imagen (solo si faltan imágenes) |
| Música | ✅ Composición original de la app, o pistas propias de la Biblioteca de audio de YouTube | — | 0 USD |
| Subtítulos, miniaturas, SEO, notificaciones | ✅ Incluidos | — | 0 USD |

**Escenario económico recomendado** (12 videos al día ≈ 360 al mes): Railway Hobby + bancos gratuitos + voz Jorge/Piper +
Claude para el guion ≈ **5–13 USD de alojamiento + ~0,25 USD por video de guion (~90 USD/mes si produce 360 videos)**.
**Escenario 100 % gratuito:** Oracle Always Free + modo local u Ollama + voces gratuitas = **0 USD**.

La app muestra el costo estimado y pide autorización antes de cada gasto, y se detiene al llegar al presupuesto mensual que
fije en *Ajustes* (10 USD por defecto).

---

## 🚂 Opción A — Railway (recomendada)

### 1. Crear la cuenta
1. Entre en **https://railway.com** y pulse **Login → Login with GitHub** (use la misma cuenta de GitHub donde está el proyecto).
2. Acepte los permisos. Railway da un crédito de prueba; para que la app siga funcionando después, active el plan **Hobby**
   en *Account → Plans* (pedirá tarjeta). En *Account → Usage* puede fijar un **límite de gasto** (por ejemplo, 15 USD).

### 2. Crear el proyecto
1. Pulse **New Project → Deploy from GitHub repo**.
2. Si no aparece el repositorio, pulse **Configure GitHub App** y dé acceso a **Profec-as-**.
3. Elija **Profec-as-**. Railway detecta solo el archivo `Dockerfile` y empieza a construir (tarda 5–10 minutos la primera vez).
4. En *Settings → Source* compruebe que la rama (**Branch**) sea **`main`**.

### 3. Añadir la contraseña y las claves (pestaña **Variables** del servicio)
Pulse **New Variable** para cada una:

| Variable | Valor |
|---|---|
| `ADMIN_USER` | el nombre de usuario que usted quiera (ej. `samuel`) |
| `ADMIN_PASSWORD` | una contraseña larga (mínimo 12 caracteres, con números y símbolos) |
| `MAX_CONCURRENT_JOBS` | (opcional) déjela sin crear: la app decide sola según la memoria |

Las claves de Pexels, Claude, etc. es más sencillo ponerlas después desde la propia app, en **Ajustes**.
(Si lo prefiere, también puede crearlas aquí con los nombres de `.env.example`).

### 4. Añadir el disco donde se guardan los videos
1. En el lienzo del proyecto, haga clic derecho sobre el servicio → **Attach Volume** (o *Settings → Volumes → Add Volume*).
2. **Mount path:** `/data` · Tamaño: el que permita su plan (con 20–50 GB caben cientos de videos). **Mínimo recomendado: 5 GB.**
   Un video de 8 minutos en 1080p necesita ~0,6–1,2 GB libres mientras se renderiza (el MP4 final pesa ~400–700 MB).

### 5. Recursos y dirección web
1. *Settings → Resources*: suba el límite a **8 vCPU y 8 GB** (solo se cobra lo que se usa; así renderiza más rápido).
2. *Settings → Networking → Generate Domain*. Aparecerá su enlace, por ejemplo `https://profecia-studio-production.up.railway.app`.
3. Pulse **Deploy** si Railway lo pide. Cuando el estado sea **Active**, abra el enlace: verá la pantalla de inicio de sesión.

> Cada vez que se actualice el código en la rama `main` de GitHub, Railway publicará la nueva versión sola.
> Sus proyectos y videos no se pierden porque están en el disco `/data`.

---

## ☁️ Opción B — Oracle Cloud «Always Free» (gratis)

1. Cree una cuenta en **https://www.oracle.com/cloud/free/** (pide tarjeta solo para verificar; no cobra en el plan Always Free).
2. Cree una instancia: *Compute → Instances → Create* · Imagen **Ubuntu 24.04** · Forma **Ampere A1, 4 OCPU, 24 GB** ·
   descargue la clave SSH.
3. En la red de la instancia (*Virtual Cloud Network → Security List*) añada reglas de entrada para los puertos **80** y **443**.
4. Conéctese al servidor (desde la consola web de Oracle, botón *Cloud Shell* o con SSH) y escriba:
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/samuelpachecot2021-wq/Profec-as-.git profecia && cd profecia
   sudo bash deploy/instalar-servidor.sh
   ```
   (Si el repositorio es privado, GitHub le pedirá su usuario y un *token* en lugar de la contraseña:
   GitHub → Settings → Developer settings → Personal access tokens.)
5. El instalador le pide usuario y contraseña y al final muestra su enlace, por ejemplo `https://140-238-1-2.sslip.io`.

---

## 🔑 Conectar los servicios (desde la app: **Ajustes → Claves de servicios**)

Copie cada clave y péguela en su casilla de **Ajustes**; pulse **Guardar claves**. Recomendado en este orden:

| # | Servicio | Dónde se consigue la clave | Costo |
|---|---|---|---|
| 1 | **Pexels** (videos y fotos) | https://www.pexels.com/api/ → crear cuenta → **Your API Key** | Gratis |
| 2 | **Pixabay** (videos y fotos) | https://pixabay.com/api/docs/ → iniciar sesión → la clave aparece en el apartado *Parameters* (`key`) | Gratis |
| 3 | **Unsplash** (fotos) | https://unsplash.com/oauth/applications → **New Application** → copiar **Access Key** | Gratis |
| — | **Wikimedia Commons** y **NASA** | No necesitan clave: ya funcionan | Gratis |
| 4 | **Voz Azure** (opcional, muy estable) | https://portal.azure.com → *Crear recurso* → **Speech** → plan **Free F0** → *Keys and Endpoint* → copiar **KEY 1** y la **región**; en Ajustes elija «Plan gratuito F0» | Gratis hasta 500 000 caracteres/mes |
| 5 | **Claude** (guiones profesionales) | https://console.anthropic.com → *API Keys* → **Create Key**; en *Billing* cargue saldo (5 USD alcanzan para ~15–30 videos) | ~0,15–0,40 USD por video |
| 6 | **OpenAI** (imágenes con IA, opcional) | https://platform.openai.com → *API keys* → **Create new secret key**; activar «Imágenes con IA si faltan» en Opciones avanzadas | ~0,04–0,07 USD por imagen |
| — | **Música** | Nada que configurar: la app compone su propia música. Opcional: suba pistas de la *Biblioteca de audio de YouTube* en Ajustes | Gratis |

La voz predeterminada es **Brian de ElevenLabs** (ID `nPczCjzI2devNBz1zQrb`, velocidad 0,95): basta con pegar la clave de
ElevenLabs en Ajustes. Si tiene suscripción mensual, elija «Tengo suscripción mensual» para que no se cuente un costo por video.
Puede cambiar de voz en cualquier momento (por ejemplo, a «Jorge», gratis). Subtítulos, miniaturas, SEO y notificaciones no necesitan claves.

---

## 📲 Instalar la app en el teléfono Android

1. Abra el enlace de su app en **Google Chrome**.
2. Inicie sesión con su usuario y contraseña.
3. Pulse el botón dorado **«📲 Instalar app»** de la parte superior.
   Si no aparece: menú **⋮** de Chrome → **«Instalar aplicación»** (o «Añadir a pantalla de inicio»).
4. Aparecerá el icono **Profecía Studio** (cruz dorada) en la pantalla de inicio. Se abre a pantalla completa, como cualquier app.
5. En **Ajustes → Este dispositivo**, pulse **Activar** en «Avisos cuando un video esté listo» y acepte el permiso. Pulse **Probar**.

En la tableta y la computadora es igual (en la computadora, el icono de instalar aparece en la barra de direcciones de Chrome o Edge).

---

## 🔒 Seguridad y privacidad

* Acceso con usuario y contraseña; la sesión dura 30 días por dispositivo; tras 8 intentos fallidos se bloquea 15 minutos.
* Las claves de servicios se guardan solo en el servidor (variables de entorno o `/data/secrets.json` con permisos restringidos).
  El navegador nunca las recibe completas, y no están en GitHub.
* Conexión cifrada HTTPS (Railway y Caddy la configuran solos).
* Los datos (artículos, videos, claves) solo están en su servidor. No se envían a terceros salvo a los servicios que usted active
  (por ejemplo, el texto del guion a Claude o a la voz elegida).

---

## 🩺 Si una producción se detiene (memoria y CPU en Railway)

* **Ver el consumo:** en Railway abra el servicio → pestaña **Metrics**: verá la memoria (*Memory*) y la CPU usadas durante el render.
  Si la línea de memoria toca el máximo justo cuando falló el video, era falta de memoria.
* **Límite de memoria:** *Settings → Resources*. Recomendado **2 GB o más** (1 GB funciona con los ajustes automáticos, pero más lento).
  Solo se paga lo que se usa.
* **La app se adapta sola:** detecta la CPU y la memoria reales del contenedor, limita los hilos de FFmpeg, produce un video
  a la vez si hay poca memoria y, si aun así el sistema detiene FFmpeg, repite la escena en «modo de memoria mínima».
* **Registro detallado:** en la página del proyecto, apartado «Registro detallado»; y en el disco, `logs/errores.log`.
* **Reanudar:** pulse **«▶️ Reanudar producción»**. Se reutilizan guion, narración, imágenes y escenas ya editadas: no se
  vuelven a gastar créditos de ElevenLabs.
* **Ajustes avanzados opcionales (Variables):** `FFMPEG_THREADS` (hilos por proceso, p. ej. `2`), `MAX_CONCURRENT_JOBS`
  (videos a la vez), `RENDER_MEMORY_MB` (si Railway no informa la memoria, p. ej. `2048`).
* **Sus claves y ajustes no se pierden al actualizar** mientras el disco esté conectado. La app usa automáticamente el disco
  de Railway y, si no hay ninguno, muestra un aviso rojo en *Ajustes*.

### «FFmpeg terminó con código 228» (disco lleno)

El código **228** significa **ENOSPC: no queda espacio en el disco** (no es falta de memoria; la memoria agotada da
«código null» o 244). Antes, las escenas intermedias del render ocupaban unas 8 veces más de lo necesario y se guardaban
tres copias completas del video; con un volumen pequeño el disco se llenaba al ~96 %, justo en la exportación final.

* **Ahora:** las escenas intermedias ocupan ~8 veces menos, se borran en cuanto su bloque está listo, la exportación final
  lee los bloques directamente (sin crear otra copia) y la app **comprueba el espacio antes de cada fase y antes de pagar
  generaciones de IA**. Si falta espacio, libera solo lo seguro (temporales interrumpidos, caché, escenas intermedias de
  otros proyectos) y, si aun así no alcanza, se detiene con un mensaje claro **sin gastar nada**.
* **Ver el espacio:** *Ajustes → Servidor* muestra el disco libre y su uso por categorías, con el botón
  **«Liberar espacio temporal»** (nunca borra imágenes de Runway, narraciones ni videos terminados).
* **Solución:** amplíe el volumen en Railway (*Settings → Volumes*) o borre proyectos antiguos y pulse
  **«▶️ Reanudar producción»**: se reutilizan narración, imágenes IA y bloques ya renderizados, sin nuevos cargos.
* Cada MP4 terminado se **verifica** (imagen H.264 con la resolución pedida, sonido AAC audible, duración correcta);
  el resultado aparece en el registro como «MP4 verificado: …».

---

## 🖼️ Miniaturas

* **Ajustes → Miniaturas:** *Inteligente* (recomendado), *Noticias y actualidad* o *Bíblico cinematográfico*.
* En el proyecto, apartado **Miniaturas**: 3 propuestas; **✏️ Titular** (texto y palabras en amarillo), **🔄 Foto** (fotos sugeridas,
  búsqueda de una persona/lugar en Wikimedia Commons o foto propia con su licencia), **★ Principal** (la que descarga «Descargar miniatura»)
  y **Regenerar** (reutiliza el análisis guardado, sin costo).
* **Fotos de personas reales:** solo de Wikimedia Commons, con identidad verificada en Wikidata (imagen oficial o archivo marcado
  «representa a» y con el nombre en el título), licencia que permite uso comercial, autor y fecha. Los créditos se añaden solos a la descripción.
  Muchas fotos oficiales de políticos tienen licencia **CC BY-SA**: si la app avisa de ello, puede activarla en *Ajustes → Licencias de imágenes*
  (obliga a atribuir al autor, cosa que la app hace en la descripción).
* No necesita claves ni tiene costo. Con Claude configurado, el análisis del guion se incluye en la estimación del video (≈ 0,01–0,03 USD).
* Si una miniatura usa una recreación generada con IA (estilo bíblico), al subirla a YouTube marque «contenido alterado o sintético».
* **Rostros:** la app localiza las caras en las fotos (detector local *face-api*, gratuito, sin enviar nada fuera) para no cortarlas y
  preferir fotos con el rostro grande. No identifica a nadie: la identidad se verifica con Wikidata.

### 🖼️ Video con portada integrada (YouTube Shorts)

* Junto a **«Descargar video original»** aparece **«Descargar video con portada integrada»** (elija 0,5, 0,75 o 1 s de portada).
* Crea una **copia** (`video-con-portada.mp4`): la miniatura principal (★) al comienzo, en silencio, y después el video completo con la
  misma voz, música y subtítulos. El original nunca se modifica. La imagen se une sin recomprimir; solo la pista de sonido se recodifica
  (AAC) para que quede sincronizada al fotograma.
* Si cambia la miniatura principal o la duración, la copia se rehace al pulsar el botón; si no, se reutiliza. No consume créditos de
  ElevenLabs ni de Runway.
* En el teléfono: suba el Short a YouTube, abra la edición de la miniatura del Short y elija el **primer fotograma** (la portada).
  Integrarla no garantiza que YouTube la elija sola.

---

## 🎨 Producción visual con IA (Runway)

**Proveedor integrado:** Runway (API oficial, `api.dev.runwayml.com`). Una sola clave sirve para imágenes y videos.
Precios oficiales consultados el 20-11-2026 en <https://docs.dev.runwayml.com/guides/pricing> (1 crédito = 0,01 USD):

| Uso | Modelo | Precio oficial |
|---|---|---|
| Imagen (Económico y fotogramas) | Muse Image | 1 crédito por imagen (0,01 USD) |
| Imagen de máxima calidad | Gen-4 Image | 8 créditos por imagen 1080p (0,08 USD) |
| Video (predeterminado) | Gen-4 Turbo | 5 créditos por segundo (0,25 USD por clip de 5 s) |
| Video 1080p | Veo 3.1 Fast | 10 créditos por segundo |
| Video de máxima calidad | Gen-4.5 | 12 créditos por segundo |
| Video más barato | Grok Imagine 1.5 Lite | 3 créditos por segundo + 1 |

**Costo orientativo por video** (escenas de 3–5 s, valores predeterminados):

| Modo | Video de 1 minuto | Video de 8 minutos |
|---|---|---|
| Solo bancos gratuitos | 0 USD | 0 USD |
| Económico (imágenes Muse animadas) | ≈ 0,15 USD | ≈ 1,30 USD |
| Inteligente (≈30 % video Gen-4 Turbo + resto gratis) | ≈ 1 USD | ≈ 10–12 USD (o lo que fije como presupuesto) |
| Premium (todo video Gen-4 Turbo) | ≈ 4 USD | ≈ 30–35 USD |

El **presupuesto máximo por video** (5 USD por defecto) nunca se supera: si no alcanza, la app usa menos clips de video
y más imágenes o recursos gratuitos, y se lo avisa. Además existe el presupuesto mensual de Ajustes.

**Cómo funciona la autorización:** al pulsar «Generar video completo», la app escribe el guion y genera la narración de
Brian; luego **se detiene** y le muestra proveedor, modelos, número de imágenes y clips, duración de cada clip, costo
estimado, máximo y presupuesto. Nada de pago se genera hasta que pulse **«Autorizar y continuar»** (también le llega una
notificación al teléfono). Puede elegir **«Continuar sin IA»** y el video se hace solo con recursos gratuitos.

**Conseguir la clave:** <https://dev.runway.com> → crear cuenta → *API Keys* → *Create new key* (empieza por `key_`) →
*Billing*: recargar créditos (pago mínimo 10 USD). Pegue la clave en **Ajustes → Runway** y pulse **«Comprobar clave y saldo»**.

---

## ✅ Verificar la actualización en Railway

1. Railway → su servicio → **Deployments**: el último despliegue debe estar **Active** (verde) con el commit más reciente de `main`.
   Si falló, pulse el despliegue → **View logs** y busque líneas con `Error`.
2. Abra su enlace e inicie sesión. En **Ajustes**, compruebe que siguen sus claves (ElevenLabs, Pexels…) y que no aparece el
   aviso rojo de disco persistente.
3. En **Ajustes → Runway** pegue la clave, guarde y pulse **«Comprobar clave y saldo»**: debe mostrar su saldo de créditos.
4. En el **Estudio**, elija *Tipo de producción visual → Económico*, presupuesto 1 USD, duración 15 o 30 segundos, y pulse
   «Generar video completo». Debe aparecer el panel **«Autorice el costo de las escenas IA»**; autorice (costará unos céntimos).
5. Al terminar, revise el video y, en *Registro detallado*, las líneas «Escena IA … créditos = … USD» (costo real).
   En Runway → *Usage* verá las mismas generaciones.
