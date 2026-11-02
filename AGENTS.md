# Graba — guía para trabajar en el proyecto

> Para personas y para cualquier IA de programación (Claude Code, Codex, Gemini/Antigravity…). `CLAUDE.md` y `GEMINI.md` solo
> importan este archivo: la guía es una sola.

Graba es una app de escritorio (estilo Loom) que graba la pantalla con la cámara en una burbuja y el micrófono, transcribe **localmente**
(whisper.cpp) y, con la IA del usuario (Claude Code, Codex o Gemini/Antigravity, con su propia cuenta), escribe notas, un guion para
YouTube, títulos, descripción con capítulos y subtítulos. Mac primero; Windows y Linux con Electron y la misma interfaz.

**Principios que no se negocian**
1. **Todo es del usuario.** Videos, transcripciones y textos viven en su computador (`~/Graba`). No hay servidores propios.
2. **Gratis y abierto** (AGPL-3.0). Sin cuentas, sin suscripciones, sin telemetría.
3. **Nada personal en el código.** Ejemplos y `ui/demo.json` con datos ficticios (Ana Pérez, Matías Soto…).
4. **Formato abierto.** Cada grabación es una carpeta con `video.mp4`, `grabacion.md` y `subtitulos.srt` (ver README, "Formato de las
   grabaciones"). No cambies nombres de campos ni marcadores sin compatibilidad y sin actualizar el README.
5. **Simple y plug and play.** Lo que haya que preguntar se pregunta en la app (asistente o Ajustes), nunca editando archivos.

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `app/Sources/Graba/` | Lo propio de Graba en la app de Mac (Swift, SwiftPM, macOS 15) sobre la pieza «host-mac» (`app/Sources/PiezaHost/`: ventana, puente, config, idioma, menús, `Procesador`, Llavero). `GrabaApp.swift`: arranque (`Host.arrancar`), flujo de grabación (`Estado`), grabaciones en disco (`Grabaciones`) y barra de menú (`BarraMenu`). `Acciones.swift`: lo que registra en el puente (`p.registrar`). `Vidrio.swift`: la ventana de una app de barra de menú (sin Dock mientras está cerrada, abre sola solo si falta algo), el vidrio y el estado de Graba (`Ventana`). `Grabadora.swift`: ScreenCaptureKit + AVAssetWriter (pantalla + micrófono en AAC; pausa corriendo los tiempos; sonido del Mac aparte en `sistema.m4a` y mezclado al final), extracción del audio a WAV 16 kHz y `mezclarSonido`. `Atajos.swift`: ⌃⌥⌘R / ⌃⌥⌘P globales con `RegisterEventHotKey` (sin permiso de Accesibilidad). `Recorte.swift`: recortar sin recomprimir (`AVAssetExportPresetPassthrough`) y deshacer. `Flotantes.swift`: burbuja de la cámara (sale en el video) y controles (no salen). `Servicios.swift`: rutas de `~/Graba`, valores por defecto de la config, permisos, IA instaladas, modelos, la fila de procesamiento (`Procesamiento`) y YouTube. |
| `app/Sources/Transcribir/` | Binario `graba-transcribir`: whisper.cpp (xcframework oficial, Metal) con las mismas opciones que `whisper-cli`. |
| `bin/` | Python **solo biblioteca estándar**: `nucleo.py` (pieza «nucleo»: `app.json`, carpeta de datos, config validada, escritura atómica), `ia.py` (pieza «ia»: la IA de la persona; `preguntar`, `frase`, `probar`), `trabajos.py` (pieza «trabajos»: aquí solo su latido, `mantener_vivo()` en `procesar.py`), `transcribir.py` (pieza «transcribir»: whisper.cpp, modelos con huella, vocabulario por archivo privado, limpieza de inventos), `comun.py` (lo propio de Graba sobre las piezas: `INTERNO`, `config()` con sus valores por defecto, `guardar_json`, `nombre_ia`, `nombre_copia`), `procesar.py` (transcribir → `transcripcion.json` → subtítulos → IA → `grabacion.md` → renombrar la carpeta), `recortar.py` (corre los tiempos de transcripción, subtítulos, capítulos y duración al recortar; copia y deshacer en `.original/`). |
| `ui/` | Interfaz web única: `app.js` y `app.css` (lo propio de Graba) sobre las piezas de interfaz (`i18n.js`, `host.js`, `tema.js` + `tema.css`, `componentes.js` + `componentes.css`, `bienvenida.js` + `bienvenida.css`; ver «Piezas»), `demo.json` (datos ficticios para la vista previa) e `idiomas/en.json`. |
| `herramientas/` | `empaquetar.sh` (arma `dist/Graba.app` + zip + `.sha256`, con `app.json` y `acciones.json` dentro) y `revisar_privacidad.sh`. |
| `build.sh` | Empaqueta e instala en `~/Applications/Graba.app` (se niega si hay una grabación o un procesamiento en curso). |
| `instalar.sh` | Instalador de un comando (`curl … \| bash`): última Release, verifica SHA-256, instala. |
| `pruebas/` | `correr.sh` (todo), `test_python.py`, `contrato.py` (interfaz ↔ apps: lo que trae el host, lo declarado en `acciones.json` y lo que registra Graba), `avance.mjs` (la ventana se refresca solo si cambia el avance), `interfaz.mjs`. |
| `escritorio/` | App de **Windows y Linux** (Electron): misma `ui/` y mismo `bin/`. Ver "Windows y Linux" abajo. |
| `instalar.ps1` | Instalador de un comando para Windows (`irm … \| iex`). |
| `docs/` | Página pública (GitHub Pages). |
| `CHANGELOG.md` | Lo que cambia para quien usa la app, en palabras simples (ver «Lo que rodea a un cambio»). |
| `app.json`, `piezas.json`, `acciones.json` | **Pieza** (ver «Piezas» abajo): `app.json` describe la app para las piezas (id, nombre, datos, plataformas, repo, claves de config, `sin_acciones`); `piezas.json` lo escribe `pieza.py` (versión y huella de cada archivo copiado) y `acciones.json` también (las acciones declaradas que atienden los hosts: hoy `probarIA`, de la pieza «ia»). |
| `.github/workflows/` | `revisar.yml` (en cada cambio y PR) y `publicar.yml` (al subir la versión en `app/Info.plist`). |

## Cómo funciona
- **Primer uso: el idioma va primero** (pieza «bienvenida»). Mientras falte la IA o el transcriptor se abre la bienvenida (cada vez que
  se abre Graba, hasta que esté todo; «Lo hago después» la cierra y guarda `bienvenida: true`), y si `idioma_ui` está vacío su paso 0
  es el idioma: solo, en `.pantalla-idioma` sin la app detrás ni avisos, título bilingüe fijo y «Español»/«English» escritos en su
  propio idioma (el del sistema sugerido y con el foco; 1/2 y flechas). Elegir guarda `idioma_ui` con la acción `config` (igual que
  Ajustes) y sigue al saludo ya traducido. Los pasos de Graba (`bv.sumarPaso` en `ui/app.js`): saludo, tu IA, transcriptor y permisos.
  Hasta elegir, la app nativa no abre la barra de grabar ni pide permisos (`GrabaApp.faltaIdioma` / `faltaIdioma()` en
  `escritorio/src/main.js`, sobre `Idioma.elegido` del host; el atajo solo trae la ventana) y el menú de la barra o bandeja solo ofrece
  «Elegir idioma · Choose language…» y «Salir · Quit». Quien ya tenía todo listo sin haber elegido idioma no lo ve: al abrir, la app
  le deja `bienvenida: true` (`Rutas.migrar` / `migrarBienvenida`) y sigue con el del sistema. Menús, barra de grabar y avisos nativos
  leen `idioma_ui` cada vez (`Idioma.t` del host).
- **Grabar:** menú ⏺ o botón Grabar → cuenta 3-2-1 en la barra de controles → `SCStream` de la pantalla bajo el mouse (hasta 1920 px de
  ancho, 30 fps) excluyendo la ventana de controles; la burbuja de la cámara es otra ventana y sí sale. `AVAssetWriter` escribe H.264 +
  micrófono AAC (no se usa `SCRecordingOutput`: con micrófono deja archivos dañados en macOS 15).
- **Pausa:** `Grabadora.pausar()/reanudar()` dejan de escribir y, al reanudar, corren todos los tiempos lo que duró la pausa (el video no
  queda con un hueco). En Electron, `MediaRecorder.pause()/resume()` y el micrófono a 16 kHz deja de mandarse.
- **Solo la cámara:** en Mac la burbuja se agranda al centro (16:9, sin borde) y se graba solo esa ventana; en Electron se graba la cámara
  directo con `getUserMedia`.
- **Sonido del Mac:** `SCStreamConfiguration.capturesAudio` a `sistema.m4a`; al terminar, `audio.wav` sale del micrófono (la voz) y
  después `mezclarSonido` deja una sola pista AAC en `video.mp4` (el video se copia sin recomprimir). En Windows, `getDisplayMedia` con
  "loopback" y una mezcla con Web Audio; la transcripción usa `microfono.wav`. En Linux no hay cómo.
- **Recortar:** la app guarda el video original en `.original/video.mp4` y corta (Mac sin recomprimir; Electron con ffmpeg, exacto);
  `recortar.py preparar` → corte → `recortar.py textos <inicio> <fin>`. «Volver al original» devuelve video y textos.
- **Transcribir** (pieza «transcribir», en `procesar.transcribir`): `graba-transcribir` (Mac, en `GRABA_HERRAMIENTAS`) o `whisper-cli`
  (Windows y Linux), el modelo elegido en `~/Graba/.graba/modelos` (o el otro, si solo está ese) y el vocabulario de `vocabulario.txt`
  en un archivo 0600 fuera de la grabación que se borra al terminar (`--prompt-archivo`, o `whisper-cli @archivo`: nunca como
  argumento). La pieza da segmentos **en segundos** (`{desde, hasta, texto}`) ya limpios; en el disco, `transcripcion.json` sigue en
  el formato de whisper con milisegundos (`guardar_transcripcion`; lo leen `recortar.py`, `corregir.py` y `procesar.segmentos`, que lo
  vuelve a segundos con `transcribir.segmentos_de` + `limpiar`), y `subtitulos.srt` y los `[mm:ss]` de `grabacion.md` no cambian.
- **Terminar:** se cierra el archivo, se extrae `audio.wav` (16 kHz mono) y se encola `bin/procesar.py <carpeta> <salida.json>`
  (`Procesamiento`, con el `Procesador` del host: sin tope de tiempo mientras lata —pieza «trabajos»— y cortado si se cuelga),
  que va dejando el avance en `estado.json` (`procesando`, `paso`/`total`, `texto`) y al final `estado: lista` o `error`.
  Mientras tanto la ventana revisa cada segundo la firma del avance (`estado.json` y `youtube.json` de las carpetas activas:
  `Ventana.firmaAvance` en `Vidrio.swift` y `escritorio/src/avance.js`) y solo manda el estado completo cuando cambia.
- **IA:** `ia.preguntar(prompt)` (pieza «ia») en una carpeta temporal y modo solo lectura (pedido por la entrada estándar o en un archivo);
  devuelve `(texto, error)` y el error (`{codigo, valores}`) se muestra con `comun.error_ia` / `ia.frase`. Probar una IA (bienvenida y
  Ajustes) es `probarIA {ia}` → `ia.py probar <entrada {"ia"}> <salida>`, una acción **declarada** de la pieza «ia» (`acciones.json`: la atienden los dos hosts sin código de Graba, con límite de 150 s) →
  `iaProbada {ia, ok, codigo, plantilla, valores, texto}`; la pieza «componentes» muestra el error con `Tp(plantilla, valores)` (la
  plantilla es la frase de `ERRORES` de `bin/ia.py`, clave de `en.json`). La respuesta debe tener los marcadores de
  `procesar.MARCADORES` (siempre en español); si faltan, no se escribe nada y queda `error` con la transcripción guardada (botón Reintentar).
  Los capítulos se corrigen solos (orden, duración, primero en 00:00).
- **Datos:** `~/Graba/<AAAA-MM-DD HHMM - Título>/` y `~/Graba/.graba/` (`config.json`, `modelos/`, `vocabulario.txt`, `ventana.json` y
  `.tokens` en Windows/Linux; `app.json` → `"datos": "visible"`, así `nucleo.carpeta_datos()` y `Host.datos` / `host.datos` son esa
  carpeta, 0700). La config la escriben los hosts con las reglas de `app.json` (`Config.deLaApp` / `Config.guardar` de Graba para las
  claves `"interfaz": false`); los scripts solo la leen
  validada por `app.json` (`comun.config()`). En las pruebas, `GRABA_DATOS` apunta a otra carpeta interna (las grabaciones, la de arriba). La carpeta `~/Graba` no
  distingue mayúsculas de `~/graba`: el checkout de desarrollo va en `~/Developer/graba`.

## Windows y Linux (`escritorio/`)
- Electron con la misma `ui/` y el mismo `bin/`, sobre la pieza «host-escritorio» (`src/host.js`, `enchufe.js`, `procesador.js`,
  `preload.js`, `vigilante.js`: no se editan aquí). `src/main.js` crea el host (`crearHost({ventana: {alCerrar: "esconder"}, permisos,
  estado, actualizaciones, …})`) y hace lo de `GrabaApp.swift` + `Acciones.swift` + `Flotantes.swift`: estado `Estado`, bandeja (mismo
  menú que la barra del Mac) y `ACCIONES` (lo nativo de Graba, registrado con `host.acciones.registrar`; respuesta con
  `llamar("funcion", datos)`). `src/servicios.js` = `Servicios.swift` (rutas de `~/Graba` y de las herramientas, config con sus valores por
  defecto, permisos, IA instaladas, modelos con SHA-256, `Procesamiento`, YouTube con `host.secretos("tokens", {archivo: ".tokens"})`);
  `src/grabaciones.js` = `Grabaciones`; `src/actualizaciones.js` es la pieza «actualizaciones».
- La UI se sirve en `graba://ui/…` (lo hace el host), las páginas propias en `graba://app/…` (solo las de `PAGINAS`) y los videos en
  `graba://video/<versión>/<ruta dentro de ~/Graba>` (con rangos; los dos con `host.medios.registrar`). La interfaz recibe
  `window.GRABA_HOST = "windows" | "linux"`. Lo que Chromium guarda sigue en la carpeta de siempre del sistema (`app.setPath("userData", …)`
  después de `host.iniciar()`: el host la movería).
- Grabar (como en Mac): "Grabar" abre `barra.html` abajo al centro (toda la pantalla, una ventana o un área; cámara con su menú de
  dispositivo/forma/tamaño; micrófono; guion) y nada empieza hasta su botón rojo; luego la cuenta grande `cuenta.html` y a grabar. Barra,
  cuenta, área y `teleprompter.html` usan `setContentProtection` (en Windows no salen en el video; en Linux sí, no hay cómo). `burbuja.html`
  (cámara) sí sale. `grabadora.html` (oculta) graba con MediaRecorder la pantalla bajo el mouse o la ventana elegida (`desktopCapturer`, hasta
  1920 px, 30 fps) + micrófono a `captura.*` (MP4/H.264 si Chromium puede, si no WebM) y el micrófono a 16 kHz en `microfono.wav`. Al terminar,
  el ffmpeg incluido deja `video.mp4` (H.264/AAC; un área se recorta aquí, con `.recorte.json`) y `audio.wav`; sin ffmpeg queda
  `video.mp4`/`video.webm` tal cual y el audio del micrófono. Luego `procesar.py`. `corregir.py` y `guion.py` corren con `Procesador.correrJSON`.
- `herramientas/preparar.sh linux|windows` arma `vendor/` (Python portátil, `whisper-cli` compilado con zig, ffmpeg estático; todo con
  SHA-256 fijo). Empaquetar: `npx electron-builder --linux AppImage tar.gz`; `npx electron-builder --win dir && bash herramientas/instalador-windows.sh`
  (NSIS propio, sin Wine). Versión en `escritorio/package.json` (igual que `app/Info.plist`). Nombres fijos: `Graba-Windows.exe`,
  `Graba-Linux.AppImage`, `Graba-Linux.tar.gz` (los usan `instalar.ps1`, `instalar.sh` y `publicar.yml`).
- Prueba en Linux sin pantalla (desde `escritorio/`): `HOME=$(mktemp -d) xvfb-run -a node pruebas/arranque.mjs <capturas>` (Playwright aparte con
  `NODE_PATH`; `REAL=1` graba la pantalla de verdad en vez de la cámara falsa de Chromium; `GRABA_PRUEBAS=1` expone `global.grabaPruebas`).
  Windows no se puede probar aquí.

## Puente interfaz ↔ app
La UI llama `host.enviar(accion, datos)` (pieza «host-ui»: `PiezaHost.crearHost({nombre: "graba", global: "Graba", simular})`; el
mensaje es `{accion, datos}`) y la app responde con `window.Graba.<funcion>(json)` (`estado`, `iaProbada`, `modeloProgreso`,
`modeloListo`, `recortado`, `menu`…), que la interfaz registra con `host.responder({…})`. Cada acción la atiende, en este orden:
1. **Lo que registra Graba** (lo nativo): `p.registrar("x")` en `app/Sources/Graba/Acciones.swift` y `ACCIONES` en `escritorio/src/main.js`.
2. **Lo que trae el host** (piezas «host-mac» y «host-escritorio»): `listo`, `config` (solo las claves de `app.json` sin
   `"interfaz": false`), `abrirEnlace` (solo https), `copiar` y, con la pieza «actualizaciones», `buscarActualizacion` y `actualizar`
   (nunca con algo en curso: grabar marca la app como ocupada).
3. **Lo declarado** en `acciones.json` (validar datos → script con límite → `responde`): hoy `probarIA` (pieza «ia»); `listaIA` y
   `modelosVoz` no se adoptan (`app.json` → `sin_acciones`).
Una acción que solo corre un script se declara en `app.json` → `acciones` (y `python3 <pieza>/herramientas/pieza.py acciones .`); una
nativa va en Swift **y** en Electron. Siempre también en `simular(accion, d, c)` para la vista previa (responde con
`c.responder("x", json)` y espera con `c.luego(ms, f)`; `abrirEnlace` y `copiar` son los de `PiezaHost.simulacionesComunes()`).
`pruebas/contrato.py` lo revisa, contando también lo que manda `ui/componentes.js`.

## Reglas al cambiar cosas
- Código, comentarios, commits y textos en **español** (de Chile neutro). Todo texto nuevo visible (JS o Swift) va con su traducción en
  `ui/idiomas/en.json` en el mismo cambio; frases completas, nunca pedazos pegados.
- Contenido del usuario (títulos, notas, transcripción) con `esc()` y `data-sin-traducir`.
- **Seguridad** (ver `SECURITY.md`): `ui/index.html` tiene una CSP sin código en línea (no agregues `onclick=`, `<script>` en
  línea ni recursos de otros dominios). La IA corre solo con texto (pieza «ia»: Claude con `--strict-mcp-config` y
  `--disallowedTools "*"`, o solo leer las copias de los archivos adjuntos `material-N.ext`; `--safe-mode` y `--setting-sources user` si
  el CLI las conoce), sin la memoria de Claude ni variables `GRABA_*`, y el pedido nunca va como argumento (Antigravity: siempre en
  `instrucciones.md`). Nunca se quitan protecciones para que un CLI viejo funcione: si no conoce una, no corre. La acción `config`
  (del host) solo acepta las claves de `app.json` que la interfaz puede cambiar (las que no dicen `"interfaz": false`; lo revisa
  `pruebas/test_python.py`). El puente (el del host y cada `ipcMain.on` de las ventanas propias) solo acepta el marco principal
  de la página propia; las actualizaciones (pieza), solo URLs de `esDescargaNuestra` y todo lo variable de un script bash con `comillas()`. Las ventanas de Electron van con `sandbox: true` y la de Mac solo navega dentro de `ui/`. Todo script de `bin/` corre con límite de tiempo (el host); el token de YouTube vive en el Llavero (`Secretos(servicio: "Graba")`) o en `.tokens` con `safeStorage` y nunca llega a la interfaz. En los
  workflows: actions fijadas por SHA (Dependabot las sube), permisos mínimos, `persist-credentials: false`, nunca
  `pull_request_target` ni `${{ … }}` dentro de `run:`.
- Archivos de piezas (`bin/nucleo.py`, `bin/ia.py`, `bin/transcribir.py`, `bin/trabajos.py`, `ui/i18n.js`, `ui/host.js`, `ui/tema.*`,
  `ui/componentes.*`, `ui/bienvenida.*`, `app/Sources/Pieza*/`, `escritorio/src/{host,enchufe,procesador,preload,vigilante,progreso,actualizaciones}.js`):
  no se editan aquí; ver «Piezas».
- Interfaz: colores solo con los tokens de la pieza «tema» (`--fondo`, `--panel`, `--panel-2`, `--linea`, `--texto`, `--texto-suave`,
  `--acento`, `--rojo`, `--verde` y los derivados `--acento-suave`, `--rojo-suave`…); un color nuevo se escribe como par en `:root` de
  `app.css` o con `light-dark()`. Botones, filas, diálogos y avisos son los de «componentes» (`.pz-boton`, `.pz-principal`,
  `.pz-peligro`, `.pz-fila`/`.pz-txt`, `.pz-campo`, `.pz-pie`, `.pz-ok`, `.pz-error-texto`; `ui.dialogo`, `ui.confirmar`,
  `ui.aviso`); lo propio de Graba en `app.css` (`.grabar`, `.grande`, `.chico`, `.pausa`, `.chip`, `html.vidrio`). Un diálogo nuevo
  va con `ui.dialogo({id, titulo, cuerpo, pie})` y su cierre en `cerrarDialogo()`.
- Antes de cerrar un cambio: `bash pruebas/correr.sh` y mirar la interfaz (`cd ui && python3 -m http.server 8765`, `?idioma=en`,
  `?bienvenida`, `window.Graba._probar(E => …)`). Swift solo compila en un Mac (o en el job `mac` de GitHub).
- Privacidad: `bash herramientas/revisar_privacidad.sh` antes de cada commit (usa `.terminos-privados`, local y nunca versionado).
- Commits con autor `@users.noreply.github.com`. El repo es público: cada commit se ve al tiro.

## Piezas (de [Pieza](https://github.com/pieza-app/pieza))
Graba usa piezas de Pieza, la base de la familia de apps: código probado que se copia a la app (modelo «copiar y adueñarse»).

| Pieza | Archivos | Qué usa Graba |
|---|---|---|
| `nucleo` 0.7 | `bin/nucleo.py` | `app.json`, carpeta de datos (`~/Graba/.graba`, o `GRABA_DATOS`), config validada por `app.json`, `escribir_atomico`/`escribir_json`, `responder`, `recursos()` (`GRABA_RECURSOS`). `comun.py` lo envuelve con lo propio de Graba. |
| `ia` 0.6.3 | `bin/ia.py` (y la acción declarada `probarIA`, límite 150 s) | La IA de la persona (`preguntar`, `frase`, `nombre`, `elegida`, `probar`). Lo propio de Graba (prompts, `MARCADORES`, mensajes) sigue en `procesar.py`, `corregir.py`, `guion.py` y `comun.py`. |
| `transcribir` 0.2 | `bin/transcribir.py` | Transcribir (`transcribir` con la `energia` de `audio.wav`, así lo inventado en silencio se va y un «gracias» dicho queda; `modelo_elegido`; `ErrorTranscribir` y su `frase` ya armada; `whisper_de` para escribir `transcripcion.json` en milisegundos; `segmentos_de` y `limpiar` al releerlo). En las pruebas, `GRABA_MODELO_PRUEBA` es el modelo «descargado». Lo propio de Graba (el vocabulario de `vocabulario.txt`, borrar `audio.wav`) sigue en `procesar.py`. La descarga de modelos y el binario `graba-transcribir` siguen en cada app (`Modelos` en `Servicios.swift` y `servicios.js`, mismas huellas que `transcribir.MODELOS`); la acción `modelosVoz` de la pieza no se usa todavía. |
| `i18n` 0.3.1 | `ui/i18n.js` | `tr`, `Tp`, `traducirDOM`, `idiomaDelSistema`, `elegir` (lo recién elegido > `?idioma=` > `idioma_ui` > el del sistema). `ui/idiomas/en.json` lleva `codigo`. |
| `host-ui` 0.2 | `ui/host.js` | El puente: `host.enviar`, `host.responder` (queda en `window.Graba`; también objetos, como `_pruebas`), `host.plataforma` y `<html data-host>`; en el navegador llama `simular`. |
| `tema` 0.2.1 | `ui/tema.css`, `ui/tema.js` | Los tokens de color (cada uno como par `--x-claro`/`--x-oscuro`, resuelto con `light-dark()`; la sombra por modo, y el modo elegido en `<html data-pz-modo>`: en JS se lee con `tema.valor`/`tema.resuelto()`); el bloque de Graba va al comienzo de `app.css`. «Apariencia» en Ajustes (`config.tema`: sistema, claro u oscuro; `?tema=` para capturas). La app nativa sigue la elección: `NSWindow.appearance` en Mac y `nativeTheme.themeSource` en Electron (el vidrio también). |
| `host-mac` 0.2 | `app/Sources/PiezaHost/` (target propio) | La app de Mac: `Host.arrancar`, ventana con WKWebView y puente con guardas (marco principal + archivo de `ui/`), `Config`/`Idioma` desde `app.json`, menús en el idioma elegido, apariencia de `config.tema`, `Procesador` con límite (o latido) y sin `GRABA_*` de afuera, `registrarMedios("video")` con rangos, `Secretos` (Llavero), `mostrarEnFinder`, `papelera`, `ocupar`/`soltar` y las acciones declaradas. Graba le pone `Ventana` (`Vidrio.swift`) encima para ser una app de barra de menú. |
| `host-escritorio` 0.2 | `escritorio/src/host.js`, `enchufe.js`, `procesador.js`, `preload.js`, `vigilante.js` | Lo mismo en Electron: `crearHost` con `alCerrar: "esconder"` (bandeja), `permisos` (cámara, micrófono, pantalla), `medios.registrar("video" \| "app")`, `secretos` (`safeStorage`), `procesador`, `mostrarEnCarpeta`, `papelera`, `ocupar`/`soltar`, menú y apariencia. `vigilante.js` viene con la pieza (Graba no vigila una carpeta). |
| `actualizaciones` 0.3 | `app/Sources/PiezaActualizaciones/`, `escritorio/src/actualizaciones.js` | Versiones nuevas solo desde los Releases de `graba-app/graba` (mismos nombres de siempre, `.sha256` obligatorio), en la misma ruta de la app; instalación de desarrollo en el Mac con `git pull` + `empaquetar.sh` (`~/Graba/.graba/desarrollo`). La atiende el host (`p.actualizaciones` / `actualizaciones`). |
| `bienvenida` 0.3 | `ui/bienvenida.js`, `ui/bienvenida.css` | El primer uso: el idioma solo y primero, y los pasos de Graba (saludo, IA, transcriptor, permisos; sin «Todo listo»: `listo: false`). Se abre mientras falte algo (`abrir` con `bienvenida: false`). |
| `trabajos` 0.2 | `bin/trabajos.py` (y `PiezaTrabajos`, `escritorio/src/progreso.js`, sin usar todavía) | Solo el latido: `procesar.py` llama `trabajos.mantener_vivo()` y los hosts lo corren sin tope mientras lata. |
| `componentes` 0.3 | `ui/componentes.js`, `ui/componentes.css` | Diálogos (`ui.dialogo`, foco al título al abrir, adentro, Esc, el foco vuelve), `ui.confirmar` (borrar: con `peligro` el foco queda en «Cancelar»; sin peligro, en el título), avisos en cola (`toast` = `ui.aviso`), «Tu IA» (`ui.filasIA`), actualizaciones (`ui.filaActualizacion` con `detalle` como notas y `desarrollo: true` en un checkout de git del Mac; `ui.act` también alimenta el aviso de arriba), «Acerca de» y «Enviar comentarios» (issue prellenado en GitHub). `html.vidrio` lleva reglas propias sobre `.pz-dialogo`, `.pz-capa`, `.pz-boton` y `.pz-seg`; el texto del aviso y del botón de borrar ya viene sólido de la pieza (`--sobre-texto`, `--sobre-rojo`). El alto de lo que se toca se cambia con `--pz-boton-alto`/`--pz-tactil`, nunca con `min-height` sobre `.pz-boton` (en táctil o a 760 px, `--pz-tactil` sube solo diálogos, filas de Ajustes y avisos). |

- **No edites a mano los archivos de una pieza.** Se actualizan con «Pieza al día» (`.github/workflows/pieza-al-dia.yml`, una vez por
  semana abre un PR o un issue) o con `python3 <pieza>/herramientas/pieza.py actualizar .`. Si hay que cambiar algo, el cambio va
  primero a Pieza (`pieza.py diferencias . <pieza>` lo muestra) y vuelve desde allá; `pieza.py estado .` dice si algo quedó distinto.
- `app.json` va dentro de las apps (`herramientas/empaquetar.sh` → `Contents/Resources/graba/app.json` y `extraResources` de
  `escritorio/package.json`): `bin/nucleo.py` lo busca junto a `bin/`. Las claves de config que la interfaz puede cambiar son las de
  `app.json` sin `"interfaz": false`; las marcadas así (modo, cámara, micrófono elegido, sonido, canal de YouTube) solo las escribe la app.
- `.gitignore` es una lista blanca: `app.json` y `piezas.json` están en ella.
- `app.json` → `sin_acciones: ["listaIA", "modelosVoz"]`: la lista de IA instaladas y la de modelos las arma Graba en su estado.
- Lo que sigue propio (y por qué): la descarga de modelos de whisper (`Modelos` en `Servicios.swift` y `servicios.js`; pendiente #4 de
  Pieza: modelos en el host), `bin/youtube.py` (pendiente #5: pieza «youtube»; hoy recibe el token en `GRABA_YT_TOKEN`) y lo de una app de
  barra de menú en Mac (`Vidrio.swift`: el host todavía no tiene opciones para eso).

## Publicar una versión
Sube `CFBundleShortVersionString` en `app/Info.plist` y `version` en `escritorio/package.json` y haz push a main: `publicar.yml`
compila y crea el Release `vX.Y.Z` con `Graba-macOS.zip`, `Graba-Windows.exe`, `Graba-Linux.AppImage` y `Graba-Linux.tar.gz`, cada uno con
su `.sha256` (nombres fijos: los usan `instalar.sh` e `instalar.ps1`).

## Desarrollo en el Mac
`~/Developer/graba` es el checkout. Antes de reinstalar, comprobar que no esté grabando ni procesando (`build.sh` ya lo revisa).
Compilar en segundo plano (`nohup bash build.sh > /tmp/graba-build.log`), revisar en tramos cortos y reabrir con `open ~/Applications/Graba.app`.

## Lo que rodea a un cambio
Un cambio está listo cuando la app **y lo que la cuenta** dicen lo mismo. Antes de empezar, anota qué tipo de cambio es; al terminar,
revisa cada fila ("no aplica" se decide, no se supone):

| Si el cambio… | Deja al día |
|---|---|
| agrega o cambia una función | la página (`docs/`: funciones, «cómo funciona», comparación, preguntas frecuentes), el README y la guía si la hay |
| cambia lo que se ve | capturas de la página y del README (datos ficticios, español e inglés, normal y celular) e imagen para compartir si sale esa vista |
| cambia un flujo o un paso | instrucciones paso a paso, preguntas frecuentes, textos de la bienvenida e instalación si la toca |
| quita algo | bórralo de la página, el README y las guías: nada que prometa lo que ya no hace |
| cambia el formato de datos o el puente | la documentación del formato, `ejemplos/` si existe y esta guía |
| cambia carpetas, reglas o pruebas | esta guía (`AGENTS.md`) y `CONTRIBUTING.md` |
| actualiza o agrega una pieza | `piezas.json` (lo escribe `pieza.py`), la tabla «Piezas» de esta guía y `app.json` si pide config |
| resuelve un issue | ciérralo con «Resuelto en …» dando crédito y abre issues para lo que quedó pendiente |
| lo nota quien usa Graba | `CHANGELOG.md`: una línea en «Sin publicar», en lenguaje de persona («Ahora puedes…»), en español e inglés |

Todo texto nuevo de la página y del README va en los dos idiomas, sin nada inventado. Antes de cerrar, busca con `grep` en `docs/` y el
README el nombre o el texto viejo de lo que cambió. Al publicar una versión, las líneas de «Sin publicar» pasan a su número.
Los issues que abrimos para una tarea traen una sección «Qué actualizar alrededor» con las filas de esta tabla que le tocan.

## Revisar aportes
Todo entra por pull request y lo junta quien mantiene el proyecto, solo con su aprobación. Leer todo el diff antes de correr nada
(alerta roja: workflows, scripts de build/instalación, red nueva, dependencias nuevas, binarios). Detalle en `CONTRIBUTING.md`.
