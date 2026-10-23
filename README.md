<p align="center"><img src="docs/img/logo-512.png" width="88" alt="Graba"></p>

<h1 align="center">Graba</h1>

<p align="center"><b>Graba tu pantalla con tu cámara. Tu IA te deja notas, un guion para YouTube, títulos, descripción con capítulos y subtítulos.</b><br>
Gratis, de código abierto y privado: todo pasa en tu computador.</p>

<p align="center"><a href="https://graba-app.github.io/graba/">Sitio</a> · <a href="#instalar">Instalar</a> · <a href="https://github.com/graba-app/graba/discussions">Comunidad</a> · <a href="CONTRIBUTING.md">Cómo aportar</a></p>

---

## Qué hace

1. **Grabas** tu pantalla con tu cara en una burbuja y tu voz (como Loom). Una barrita con **Terminar** queda fuera del video.
2. **Transcribe en tu computador** con whisper.cpp. Nada se sube a ningún servidor.
3. **Tu propia IA** (Claude Code, Codex o Gemini/Antigravity, con tu cuenta) escribe:
   - **Notas:** resumen y puntos clave.
   - **Guion para YouTube:** gancho, introducción, desarrollo con indicaciones de qué mostrar y cierre.
   - **Para publicar:** 3 títulos, descripción con **capítulos** (con tiempos reales, el primero en 00:00 como pide YouTube) y etiquetas.
   - **Subtítulos** `.srt` listos para subir.

Todo queda en `~/Graba`, una carpeta por grabación, en archivos normales que puedes abrir, copiar o usar en tus propios scripts.

## Instalar

**Mac** (chip Apple, macOS 15 o posterior), en la Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/graba-app/graba/main/instalar.sh | bash
```

O descarga [`Graba-macOS.zip`](https://github.com/graba-app/graba/releases/latest/download/Graba-macOS.zip), arrástrala a Aplicaciones y,
si macOS dice que no pudo verificarla (aún no está firmada por Apple): Ajustes del Sistema → Privacidad y seguridad → **Abrir igualmente**.

**Windows y Linux:** en camino, con la misma interfaz ([ayúdanos a probarla](https://github.com/graba-app/graba/issues)).

La primera vez, Graba te ayuda a elegir tu IA ([cómo instalarla](https://graba-app.github.io/graba/ia.html)), descarga el transcriptor
(una sola vez) y pide los permisos de pantalla, cámara y micrófono.

## Formato de las grabaciones

```
~/Graba/
  2026-10-20 1015 - Cómo armar un presupuesto/
    video.mp4            # pantalla + burbuja de la cámara + micrófono (H.264 / AAC)
    grabacion.md         # todo el texto (abajo)
    subtitulos.srt       # subtítulos con tiempos
    transcripcion.json   # salida de whisper ({"transcription": [{"offsets": {"from": ms, "to": ms}, "text": "…"}]})
    meta.json            # {"inicio": "2026-10-20T10:15:00", "duracion_seg": 312}
    estado.json          # {"estado": "procesando" | "lista" | "error", "paso", "total", "texto", "error"}
  .graba/                # configuración y modelos (no lo toques a mano: se cambia en Ajustes)
```

`grabacion.md` (los títulos de sección van siempre en español, aunque el contenido esté en otro idioma):

```markdown
---
fecha: 2026-10-20
hora: 10:15
duracion_seg: 312
titulo: "Cómo armar un presupuesto"
ia: claude
tags: [graba]
---
# Cómo armar un presupuesto

## Resumen
## Notas
## Guion para YouTube
### Gancho / ### Introducción / ### Desarrollo / ### Cierre
## Para publicar
### Títulos
### Descripción
### Capítulos
00:00 Inicio
01:05 …
### Etiquetas
## Transcripción
[00:00] Hola, hoy les muestro…
```

## Desarrollo

```bash
git clone https://github.com/graba-app/graba ~/Developer/graba   # no en ~/graba: choca con ~/Graba (datos)
cd ~/Developer/graba && bash build.sh                             # compila e instala en ~/Applications
bash pruebas/correr.sh                                            # pruebas (interfaz con Playwright)
cd ui && python3 -m http.server 8765                              # interfaz en el navegador con datos ficticios
```

La guía completa para personas y para IAs de programación está en [`AGENTS.md`](AGENTS.md).

## Comunidad

Preguntas, ideas y lo que armes con tus grabaciones: [Discussions](https://github.com/graba-app/graba/discussions).
Para aportar (con o sin programar): [CONTRIBUTING.md](CONTRIBUTING.md). Hermana de [Minuta](https://github.com/minuta-app/minuta),
que hace lo mismo para reuniones.

## Licencia / License

[MIT](LICENSE). **English:** Graba is a free, open-source Loom-like screen recorder that transcribes locally and uses your own AI CLI to
write notes, a YouTube script, titles, a description with chapters and subtitles. Everything stays on your computer.
