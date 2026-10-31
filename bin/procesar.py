#!/usr/bin/env python3
"""Procesa una grabación de Graba: transcribe en el computador, arma los subtítulos y le pide a la IA del usuario
notas, guion para YouTube, títulos, descripción y capítulos.

Uso: procesar.py <carpeta de la grabación> <salida.json> [--solo-ia]
  La carpeta trae video.mp4 y audio.wav (16 kHz mono, lo deja la app al terminar de grabar) y meta.json.
  Va dejando el avance en estado.json; al final escribe grabacion.md y subtitulos.srt y renombra la carpeta con el título.
  --solo-ia: vuelve a pedirle a la IA el texto usando la transcripción que ya existe (botón "Regenerar").
Formato de grabacion.md: ver "Formato de las grabaciones" en el README.
"""
import json
import os
import re
import sys
import wave
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comun  # noqa: E402
import ia  # noqa: E402  (pieza «ia»)
import nucleo  # noqa: E402  (pieza «nucleo»)
import transcribir as transcribir_  # noqa: E402  (pieza «transcribir»)

PASOS = 3
MARCADORES = ["## Resumen", "## Notas", "## Guion para YouTube", "## Para publicar", "### Títulos", "### Descripción", "### Capítulos"]


guardar_json = comun.guardar_json  # atómico; un archivo nuevo, solo para la persona (0600)
leer_json = comun.leer_json


def estado(carpeta, estado_, paso=0, texto="", error=""):
    guardar_json(os.path.join(carpeta, "estado.json"), {"estado": estado_, "paso": paso, "total": PASOS, "texto": texto, "error": error})


# ───────────── Tiempos ─────────────
def reloj(seg, horas=False):
    """83 → '01:23'; con horas (o si pasa de una hora) → '1:01:23'."""
    seg = max(0, int(seg))
    h, m, s = seg // 3600, seg % 3600 // 60, seg % 60
    return f"{h}:{m:02d}:{s:02d}" if (h or horas) else f"{m:02d}:{s:02d}"


def a_segundos(texto):
    partes = [int(p) for p in texto.split(":")]
    s = 0
    for p in partes:
        s = s * 60 + p
    return s


def tiempo_srt(ms):
    ms = max(0, int(round(ms)))
    return f"{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}"


# ───────────── Transcripción (pieza «transcribir») ─────────────
# Los segmentos van en segundos ({desde, hasta, texto}), como los da la pieza. En el disco, transcripcion.json sigue con el formato
# de whisper de siempre (offsets en milisegundos; ver «Formato de las grabaciones» en el README): lo leen recortar.py, corregir.py y
# los scripts de la persona.
def segmentos(carpeta):
    """Los segmentos de transcripcion.json, limpios (sin marcas como [música], sin inventos de whisper ni bucles), en segundos."""
    datos = leer_json(os.path.join(carpeta, "transcripcion.json"), {}) or {}
    return transcribir_.limpiar(transcribir_.segmentos_de(datos))


def guardar_transcripcion(carpeta, segs):
    nucleo.escribir_atomico(os.path.join(carpeta, "transcripcion.json"),
                            json.dumps(transcribir_.whisper_de(segs), ensure_ascii=False, indent=2), nucleo.DOCUMENTO)


def vocabulario():
    """Palabras que la persona corrigió antes (corregir.py): ayudan a transcribir y a escribir bien nombres y términos."""
    try:
        with open(os.path.join(comun.INTERNO, "vocabulario.txt"), encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip()][-60:]
    except OSError:
        return []


def transcribir(carpeta):
    audio = os.path.join(carpeta, "audio.wav")
    if not os.path.exists(audio):
        return  # grabación sin micrófono: queda como "sin voz"
    c = comun.config()
    # Con la energía de la voz, lo que whisper inventa en silencio («Gracias», «Thank you») se va y lo que se dijo de verdad queda.
    # Después ya no está audio.wav: transcripcion.json queda limpio y `segmentos` solo quita créditos y bucles.
    try:
        energia = transcribir_.energia(audio) or None
    except (OSError, EOFError, wave.Error):
        energia = None
    try:
        # El vocabulario nunca va como argumento: la pieza lo pasa en un archivo privado que se borra al terminar.
        segs = transcribir_.transcribir(audio, idioma=c.get("idioma_audio") or "auto", modelo=transcribir_.modelo_elegido(c["modelo"]),
                                        vocabulario=", ".join(vocabulario()[-40:]), energia_=energia)
    except transcribir_.ErrorTranscribir as e:
        raise RuntimeError(e.frase) from None  # «La transcripción falló: <detalle>» ya armada (la interfaz la traduce entera)
    guardar_transcripcion(carpeta, segs)
    os.remove(audio)  # ya no hace falta: el video tiene el audio original


def escribir_srt(carpeta, segs):
    bloques = [f"{i}\n{tiempo_srt(s['desde'] * 1000)} --> {tiempo_srt(s['hasta'] * 1000)}\n{s['texto']}\n" for i, s in enumerate(segs, 1)]
    with open(os.path.join(carpeta, "subtitulos.srt"), "w", encoding="utf-8") as f:
        f.write("\n".join(bloques))


# ───────────── IA ─────────────
def prompt_para(segs, duracion):
    lineas = "\n".join(f"[{reloj(s['desde'])}] {s['texto']}" for s in segs)
    return f"""Eres editor de contenido para YouTube. Abajo está la transcripción (con marcas de tiempo) de un video grabado
con la pantalla y la cámara: alguien muestra y explica algo. Dura {reloj(duracion)}.

Escribe TODO en el mismo idioma en que se habla en la transcripción. Respeta la voz de quien habla: claro, cercano y sin exagerar.
No inventes datos que no estén en la transcripción.{(" Estas palabras y nombres se escriben así (si la transcripción los trae mal escritos, corrígelos): " + ", ".join(vocabulario()) + ".") if vocabulario() else ""} Responde SOLO con este formato, sin nada antes ni después
(los títulos de sección van exactamente así, en español, aunque el contenido esté en otro idioma):

TITULO: <título corto y claro de la grabación, máximo 8 palabras>

## Resumen
<2 a 4 frases: qué se muestra y para quién sirve>

## Notas
- <puntos clave, pasos o ideas en el orden del video; 4 a 10 viñetas>

## Guion para YouTube
<un guion pulido para regrabar o narrar este mismo contenido, mejor ordenado y sin muletillas>
### Gancho
<primeros 15 segundos: por qué quedarse a ver>
### Introducción
### Desarrollo
<los pasos o ideas, con indicaciones de qué mostrar en pantalla entre corchetes, ej. [mostrar el menú]>
### Cierre
<resumen y llamado a la acción breve>

## Para publicar
### Títulos
1. <3 opciones de título para YouTube, de menos de 70 caracteres>
### Descripción
<descripción para YouTube de 2 a 4 párrafos cortos, con lo que aprenderá quien la vea>
### Capítulos
<un capítulo por línea con "mm:ss Nombre" usando tiempos REALES de la transcripción; el primero es 00:00; entre 3 y 10 capítulos;
si el video dura menos de 1 minuto, deja solo "00:00 Inicio">
### Etiquetas
<8 a 15 etiquetas separadas por coma>

TRANSCRIPCIÓN:
{lineas}
"""


def capitulos_validos(texto, duracion):
    """Ordena los capítulos, quita los que se pasan de la duración y asegura que el primero sea 00:00 (lo exige YouTube)."""
    vistos, lista = set(), []
    for linea in texto.splitlines():
        m = re.match(r"^\s*[-*]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—]?\s*(.+)$", linea)
        if m:
            s = a_segundos(m.group(1))
            if s <= max(duracion, 1) and s not in vistos:
                vistos.add(s)
                lista.append((s, m.group(2).strip()))
    lista.sort()
    if not lista:
        lista = [(0, "Inicio")]
    elif lista[0][0] != 0:
        lista[0] = (0, lista[0][1])
    horas = duracion >= 3600
    return "\n".join(f"{reloj(s, horas)} {n}" for s, n in lista)


def interpretar(respuesta, duracion):
    """Devuelve (titulo, cuerpo) o lanza un error si a la respuesta le falta estructura."""
    texto = (respuesta or "").strip()
    texto = re.sub(r"^```\w*\n|\n```$", "", texto).strip()
    m = re.match(r"^\s*TITULO:\s*(.+)$", texto, re.M)
    titulo = (m.group(1).strip().strip("\"«»*") if m else "")[:80]
    faltan = [x for x in MARCADORES if x not in texto]
    if faltan or not titulo:
        raise RuntimeError(f"La respuesta de {comun.nombre_ia()} vino incompleta (falta {', '.join(faltan) or 'el título'}). Prueba «Regenerar».")
    cuerpo = texto[texto.index("## Resumen"):]
    cap = re.search(r"### Capítulos\n(.*?)(?=\n### |\Z)", cuerpo, re.S)
    if cap:
        cuerpo = cuerpo[:cap.start(1)] + capitulos_validos(cap.group(1), duracion) + "\n" + cuerpo[cap.end(1):]
    return titulo, re.sub(r"\n{3,}", "\n\n", cuerpo).strip()


def nombre_carpeta(fecha, titulo):
    limpio = re.sub(r'[\\/:*?"<>|\n\r\t]', "", titulo).strip(" .")[:60] or "Grabación"
    return f"{fecha.strftime('%Y-%m-%d %H%M')} - {limpio}"


def escribir_grabacion(carpeta, meta, titulo, cuerpo, segs):
    fecha = datetime.fromisoformat(meta["inicio"]) if meta.get("inicio") else datetime.now()
    transcripcion = "\n".join(f"[{reloj(s['desde'])}] {s['texto']}" for s in segs) or "(sin voz)"
    fm = [
        "---",
        f"fecha: {fecha.strftime('%Y-%m-%d')}",
        f"hora: {fecha.strftime('%H:%M')}",
        f"duracion_seg: {int(meta.get('duracion_seg', 0))}",
        f"titulo: {json.dumps(titulo, ensure_ascii=False)}",
        f"ia: {ia.elegida()}",
        "tags: [graba]",
        "---",
    ]
    with open(os.path.join(carpeta, "grabacion.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(fm) + f"\n# {titulo}\n\n{cuerpo}\n\n## Transcripción\n{transcripcion}\n")
    # Renombra la carpeta con el título (si ya existe otra igual, agrega un número).
    destino = os.path.join(os.path.dirname(carpeta), nombre_carpeta(fecha, titulo))
    if os.path.abspath(destino) == os.path.abspath(carpeta):
        return carpeta
    base, n = destino, 2
    while os.path.exists(destino):
        destino, n = f"{base} ({n})", n + 1
    os.rename(carpeta, destino)
    return destino


def procesar(carpeta, solo_ia=False):
    meta = leer_json(os.path.join(carpeta, "meta.json"), {}) or {}
    duracion = float(meta.get("duracion_seg", 0))
    if not solo_ia:
        estado(carpeta, "procesando", 1, "Transcribiendo en tu computador…")
        transcribir(carpeta)
    segs = segmentos(carpeta)
    escribir_srt(carpeta, segs)
    if not segs:
        cuerpo = "## Resumen\nNo se escuchó voz en esta grabación, así que no hay notas ni guion.\n"
        return escribir_grabacion(carpeta, meta, meta.get("titulo") or "Grabación sin voz", cuerpo, segs)
    estado(carpeta, "procesando", 2, "Tu IA está escribiendo las notas y el guion…")
    texto, error = ia.preguntar(prompt_para(segs, duracion), timeout=900)
    if error:
        raise RuntimeError(comun.error_ia(error) + (" ¿Tiene la sesión iniciada?" if error["codigo"] == "sin_respuesta" else ""))
    titulo, cuerpo = interpretar(texto, duracion)
    estado(carpeta, "procesando", 3, "Guardando…")
    return escribir_grabacion(carpeta, meta, titulo, cuerpo, segs)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    carpeta, salida = os.path.abspath(args[0]), args[1]
    try:
        final = procesar(carpeta, "--solo-ia" in sys.argv)
        estado(final, "lista")
        guardar_json(salida, {"ok": True, "carpeta": final})
    except Exception as e:  # noqa: BLE001 — cualquier falla se le muestra a la persona, con la grabación intacta
        estado(carpeta, "error", error=str(e))
        guardar_json(salida, {"ok": False, "carpeta": carpeta, "error": str(e)})


if __name__ == "__main__":
    main()
