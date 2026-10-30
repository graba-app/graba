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
| `app/Sources/Graba/` | App de Mac (Swift, SwiftPM, macOS 15). `GrabaApp.swift`: arranque, flujo de grabación (`Estado`), grabaciones en disco (`Grabaciones`) y barra de menú. `Grabadora.swift`: ScreenCaptureKit + AVAssetWriter (pantalla + micrófono en AAC; pausa corriendo los tiempos; sonido del Mac aparte en `sistema.m4a` y mezclado al final), extracción del audio a WAV 16 kHz y `mezclarSonido`. `Atajos.swift`: ⌃⌥⌘R / ⌃⌥⌘P globales con `RegisterEventHotKey` (sin permiso de Accesibilidad). `Recorte.swift`: recortar sin recomprimir (`AVAssetExportPresetPassthrough`) y deshacer. `Flotantes.swift`: burbuja de la cámara (sale en el video) y controles (no salen). `Ventana.swift`: WKWebView + puente. `Servicios.swift`: rutas, configuración, idioma, permisos, IA, modelos y `Procesador`. |
| `app/Sources/Transcribir/` | Binario `graba-transcribir`: whisper.cpp (xcframework oficial, Metal) con las mismas opciones que `whisper-cli`. |
| `bin/` | Python **solo biblioteca estándar**: `ia.py` (configuración y `ejecutar_ia`), `procesar.py` (transcribir → subtítulos → IA → `grabacion.md` → renombrar la carpeta), `recortar.py` (corre los tiempos de transcripción, subtítulos, capítulos y duración al recortar; copia y deshacer en `.original/`). |
| `ui/` | Interfaz web única (`app.js`, `app.css`), `demo.json` (datos ficticios para la vista previa) e `idiomas/en.json`. |
| `herramientas/` | `empaquetar.sh` (arma `dist/Graba.app` + zip + `.sha256`) y `revisar_privacidad.sh`. |
| `build.sh` | Empaqueta e instala en `~/Applications/Graba.app` (se niega si hay una grabación o un procesamiento en curso). |
| `instalar.sh` | Instalador de un comando (`curl … \| bash`): última Release, verifica SHA-256, instala. |
| `pruebas/` | `correr.sh` (todo), `test_python.py`, `contrato.py`, `interfaz.mjs`. |
| `escritorio/` | App de **Windows y Linux** (Electron): misma `ui/` y mismo `bin/`. Ver "Windows y Linux" abajo. |
| `instalar.ps1` | Instalador de un comando para Windows (`irm … \| iex`). |
| `docs/` | Página pública (GitHub Pages). |
| `CHANGELOG.md` | Lo que cambia para quien usa la app, en palabras simples (ver «Lo que rodea a un cambio»). |
| `.github/workflows/` | `revisar.yml` (en cada cambio y PR) y `publicar.yml` (al subir la versión en `app/Info.plist`). |

## Cómo funciona
- **Primer uso: el idioma va primero.** Mientras falte la IA o el transcriptor se abre la bienvenida, y si `idioma_ui` está vacío su
  paso 0 es la pantalla de idioma (`pantallaIdioma()` en `ui/app.js`): sola, sin la app detrás ni avisos, título bilingüe fijo y
  «Español»/«English» escritos en su propio idioma (sin traducir; el del sistema sugerido y con el foco). Elegir guarda `idioma_ui` con
  la acción `config` (igual que Ajustes) y sigue al saludo ya traducido. Hasta entonces la app nativa no abre la barra de grabar ni pide
  permisos (`GrabaApp.faltaIdioma` / `faltaIdioma()` en `escritorio/src/main.js`; el atajo solo trae la ventana) y el menú de la barra
  o bandeja solo ofrece «Elegir idioma · Choose language…» y «Salir · Quit». Quien ya tenía todo listo sin haber elegido idioma no lo
  ve: sigue con el del sistema y lo cambia en Ajustes. Menús, barra de grabar y avisos nativos leen `idioma_ui` cada vez (`Idioma.t`).
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
- **Terminar:** se cierra el archivo, se extrae `audio.wav` (16 kHz mono) y se encola `bin/procesar.py <carpeta> <salida.json>`,
  que va dejando el avance en `estado.json` (`procesando`, `paso`/`total`, `texto`) y al final `estado: lista` o `error`.
- **IA:** `ia.ejecutar_ia(prompt)` en una carpeta temporal y modo solo lectura (pedido por la entrada estándar o en un archivo). La respuesta debe tener los marcadores de
  `procesar.MARCADORES` (siempre en español); si faltan, no se escribe nada y queda `error` con la transcripción guardada (botón Reintentar).
  Los capítulos se corrigen solos (orden, duración, primero en 00:00).
- **Datos:** `~/Graba/<AAAA-MM-DD HHMM - Título>/` y `~/Graba/.graba/` (`config.json`, `modelos/`). La carpeta `~/Graba` no
  distingue mayúsculas de `~/graba`: el checkout de desarrollo va en `~/Developer/graba`.

## Windows y Linux (`escritorio/`)
- Electron con la misma `ui/` y el mismo `bin/`. `src/main.js` hace lo de `GrabaApp.swift` + `Ventana.swift` + `Flotantes.swift`: estado
  `Estado`, bandeja (mismo menú que la barra del Mac) y `ACCIONES` (un método por cada `host.enviar`; respuesta con `llamar("funcion", datos)`).
  `src/servicios.js` = `Servicios.swift` (config, idioma, permisos, IA, modelos con SHA-256, `Procesador`); `src/grabaciones.js` = `Grabaciones`.
- La UI se sirve en `graba://ui/…`, las páginas propias en `graba://app/…` y los videos en `graba://video/<ruta>` (solo dentro de `~/Graba`,
  con rangos). La interfaz recibe `window.GRABA_HOST = "windows" | "linux"`.
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
La UI llama `host.enviar(accion, datos)`; Mac lo atiende en el `switch` de `Ventana.swift` y responde con `window.Graba.<funcion>(json)`
(`estado`, `iaProbada`, `modeloProgreso`, `modeloListo`, `recortado`…; acciones nuevas: `pausar`, `recortar`, `deshacerRecorte`). Una acción nueva va en Swift, en Electron (`ACCIONES`) y simulada en `simular()`
para la vista previa. `pruebas/contrato.py` lo revisa.

## Reglas al cambiar cosas
- Código, comentarios, commits y textos en **español** (de Chile neutro). Todo texto nuevo visible (JS o Swift) va con su traducción en
  `ui/idiomas/en.json` en el mismo cambio; frases completas, nunca pedazos pegados.
- Contenido del usuario (títulos, notas, transcripción) con `esc()` y `data-sin-traducir`.
- **Seguridad** (ver `SECURITY.md`): `ui/index.html` tiene una CSP sin código en línea (no agregues `onclick=`, `<script>` en
  línea ni recursos de otros dominios). La IA corre solo con texto (`ia.claude_solo_texto`: sin MCP y sin herramientas, o solo
  `Read` con archivos adjuntos copiados como `material-N.ext`), sin la memoria de Claude ni variables `GRABA_*`, y el pedido nunca
  va como argumento (Antigravity: siempre en `instrucciones.md`). Nunca se reintenta quitando protecciones: `ia._soporta` pregunta
  `--help` y, si falta una, se falla pidiendo actualizar la IA. El puente (Swift y cada `ipcMain.on`) solo acepta el marco principal
  de la página propia; las actualizaciones, solo URLs de `esDescargaNuestra` y todo lo variable de un script bash con `comillas()`. Las ventanas de Electron van con `sandbox: true` y la de Mac solo navega dentro de `ui/`. En los
  workflows: actions fijadas por SHA (Dependabot las sube), permisos mínimos, `persist-credentials: false`, nunca
  `pull_request_target` ni `${{ … }}` dentro de `run:`.
- Antes de cerrar un cambio: `bash pruebas/correr.sh` y mirar la interfaz (`cd ui && python3 -m http.server 8765`, `?idioma=en`,
  `?bienvenida`, `window.Graba._probar(E => …)`). Swift solo compila en un Mac (o en el job `mac` de GitHub).
- Privacidad: `bash herramientas/revisar_privacidad.sh` antes de cada commit (usa `.terminos-privados`, local y nunca versionado).
- Commits con autor `@users.noreply.github.com`. El repo es público: cada commit se ve al tiro.

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
| resuelve un issue | ciérralo con «Resuelto en …» dando crédito y abre issues para lo que quedó pendiente |
| lo nota quien usa Graba | `CHANGELOG.md`: una línea en «Sin publicar», en lenguaje de persona («Ahora puedes…»), en español e inglés |

Todo texto nuevo de la página y del README va en los dos idiomas, sin nada inventado. Antes de cerrar, busca con `grep` en `docs/` y el
README el nombre o el texto viejo de lo que cambió. Al publicar una versión, las líneas de «Sin publicar» pasan a su número.
Los issues que abrimos para una tarea traen una sección «Qué actualizar alrededor» con las filas de esta tabla que le tocan.

## Revisar aportes
Todo entra por pull request y lo junta quien mantiene el proyecto, solo con su aprobación. Leer todo el diff antes de correr nada
(alerta roja: workflows, scripts de build/instalación, red nueva, dependencias nuevas, binarios). Detalle en `CONTRIBUTING.md`.
