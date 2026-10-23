# Graba — guía para trabajar en el proyecto

> Para personas y para cualquier IA de programación (Claude Code, Codex, Gemini/Antigravity…). `CLAUDE.md` y `GEMINI.md` solo
> importan este archivo: la guía es una sola.

Graba es una app de escritorio (estilo Loom) que graba la pantalla con la cámara en una burbuja y el micrófono, transcribe **localmente**
(whisper.cpp) y, con la IA del usuario (Claude Code, Codex o Gemini/Antigravity, con su propia cuenta), escribe notas, un guion para
YouTube, títulos, descripción con capítulos y subtítulos. Mac primero; Windows y Linux con Electron y la misma interfaz.

**Principios que no se negocian**
1. **Todo es del usuario.** Videos, transcripciones y textos viven en su computador (`~/Graba`). No hay servidores propios.
2. **Gratis y abierto** (MIT). Sin cuentas, sin suscripciones, sin telemetría.
3. **Nada personal en el código.** Ejemplos y `ui/demo.json` con datos ficticios (Ana Pérez, Matías Soto…).
4. **Formato abierto.** Cada grabación es una carpeta con `video.mp4`, `grabacion.md` y `subtitulos.srt` (ver README, "Formato de las
   grabaciones"). No cambies nombres de campos ni marcadores sin compatibilidad y sin actualizar el README.
5. **Simple y plug and play.** Lo que haya que preguntar se pregunta en la app (asistente o Ajustes), nunca editando archivos.

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `app/Sources/Graba/` | App de Mac (Swift, SwiftPM, macOS 15). `GrabaApp.swift`: arranque, flujo de grabación (`Estado`), grabaciones en disco (`Grabaciones`) y barra de menú. `Grabadora.swift`: ScreenCaptureKit + AVAssetWriter (pantalla + micrófono en AAC) y extracción del audio a WAV 16 kHz. `Flotantes.swift`: burbuja de la cámara (sale en el video) y controles (no salen). `Ventana.swift`: WKWebView + puente. `Servicios.swift`: rutas, configuración, idioma, permisos, IA, modelos y `Procesador`. |
| `app/Sources/Transcribir/` | Binario `graba-transcribir`: whisper.cpp (xcframework oficial, Metal) con las mismas opciones que `whisper-cli`. |
| `bin/` | Python **solo biblioteca estándar**: `ia.py` (configuración y `ejecutar_ia`), `procesar.py` (transcribir → subtítulos → IA → `grabacion.md` → renombrar la carpeta). |
| `ui/` | Interfaz web única (`app.js`, `app.css`), `demo.json` (datos ficticios para la vista previa) e `idiomas/en.json`. |
| `herramientas/` | `empaquetar.sh` (arma `dist/Graba.app` + zip + `.sha256`) y `revisar_privacidad.sh`. |
| `build.sh` | Empaqueta e instala en `~/Applications/Graba.app` (se niega si hay una grabación o un procesamiento en curso). |
| `instalar.sh` | Instalador de un comando (`curl … \| bash`): última Release, verifica SHA-256, instala. |
| `pruebas/` | `correr.sh` (todo), `test_python.py`, `contrato.py`, `interfaz.mjs`. |
| `docs/` | Página pública (GitHub Pages). |
| `.github/workflows/` | `revisar.yml` (en cada cambio y PR) y `publicar.yml` (al subir la versión en `app/Info.plist`). |

## Cómo funciona
- **Grabar:** menú ⏺ o botón Grabar → cuenta 3-2-1 en la barra de controles → `SCStream` de la pantalla bajo el mouse (hasta 1920 px de
  ancho, 30 fps) excluyendo la ventana de controles; la burbuja de la cámara es otra ventana y sí sale. `AVAssetWriter` escribe H.264 +
  micrófono AAC (no se usa `SCRecordingOutput`: con micrófono deja archivos dañados en macOS 15).
- **Terminar:** se cierra el archivo, se extrae `audio.wav` (16 kHz mono) y se encola `bin/procesar.py <carpeta> <salida.json>`,
  que va dejando el avance en `estado.json` (`procesando`, `paso`/`total`, `texto`) y al final `estado: lista` o `error`.
- **IA:** `ia.ejecutar_ia(prompt)` en una carpeta temporal y modo solo lectura. La respuesta debe tener los marcadores de
  `procesar.MARCADORES` (siempre en español); si faltan, no se escribe nada y queda `error` con la transcripción guardada (botón Reintentar).
  Los capítulos se corrigen solos (orden, duración, primero en 00:00).
- **Datos:** `~/Graba/<AAAA-MM-DD HHMM - Título>/` y `~/Graba/.graba/` (`config.json`, `modelos/`). La carpeta `~/Graba` no
  distingue mayúsculas de `~/graba`: el checkout de desarrollo va en `~/Developer/graba`.

## Puente interfaz ↔ app
La UI llama `host.enviar(accion, datos)`; Mac lo atiende en el `switch` de `Ventana.swift` y responde con `window.Graba.<funcion>(json)`
(`estado`, `iaProbada`, `modeloProgreso`, `modeloListo`). Una acción nueva va en Swift, en Electron (`ACCIONES`) y simulada en `simular()`
para la vista previa. `pruebas/contrato.py` lo revisa.

## Reglas al cambiar cosas
- Código, comentarios, commits y textos en **español** (de Chile neutro). Todo texto nuevo visible (JS o Swift) va con su traducción en
  `ui/idiomas/en.json` en el mismo cambio; frases completas, nunca pedazos pegados.
- Contenido del usuario (títulos, notas, transcripción) con `esc()` y `data-sin-traducir`.
- Antes de cerrar un cambio: `bash pruebas/correr.sh` y mirar la interfaz (`cd ui && python3 -m http.server 8765`, `?idioma=en`,
  `?bienvenida`, `window.Graba._probar(E => …)`). Swift solo compila en un Mac (o en el job `mac` de GitHub).
- Privacidad: `bash herramientas/revisar_privacidad.sh` antes de cada commit (usa `.terminos-privados`, local y nunca versionado).
- Commits con autor `@users.noreply.github.com`. El repo es público: cada commit se ve al tiro.

## Publicar una versión
Sube `CFBundleShortVersionString` en `app/Info.plist` (y `escritorio/package.json` cuando exista) y haz push a main: `publicar.yml`
compila y crea el Release `vX.Y.Z` con `Graba-macOS.zip` + `.sha256` (nombres fijos: los usa `instalar.sh`).

## Desarrollo en el Mac
`~/Developer/graba` es el checkout. Antes de reinstalar, comprobar que no esté grabando ni procesando (`build.sh` ya lo revisa).
Compilar en segundo plano (`nohup bash build.sh > /tmp/graba-build.log`), revisar en tramos cortos y reabrir con `open ~/Applications/Graba.app`.

## Revisar aportes
Todo entra por pull request y lo junta quien mantiene el proyecto, solo con su aprobación. Leer todo el diff antes de correr nada
(alerta roja: workflows, scripts de build/instalación, red nueva, dependencias nuevas, binarios). Detalle en `CONTRIBUTING.md`.
