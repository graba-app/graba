"""Recortar el inicio y el final de una grabación: ajusta la transcripción, los subtítulos, los capítulos y la duración
al video nuevo. Solo biblioteca estándar.

  recortar.py preparar <carpeta> <salida.json>                guarda una copia de los textos en <carpeta>/.original/ (la 1.ª vez)
  recortar.py textos   <carpeta> <inicio> <fin> <salida.json> corre los tiempos de todo (segundos del video de antes del recorte)
  recortar.py deshacer <carpeta> <salida.json>                vuelve los textos a como estaban antes del primer recorte

El video lo corta la app (Mac: AVAssetExportSession sin recomprimir; Windows/Linux: ffmpeg) y deja el original en
<carpeta>/.original/video.mp4. Orden: preparar → la app corta el video → textos. Para deshacer, la app vuelve a poner el video
original y llama a «deshacer».
"""
import json
import os
import re
import shutil
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo  # noqa: E402  (pieza «nucleo»)
from procesar import a_segundos, capitulos_validos, leer_json, reloj, tiempo_srt  # noqa: E402

TEXTOS = ["grabacion.md", "subtitulos.srt", "transcripcion.json", "meta.json", "audio.wav"]


def escribir(ruta, texto):
    """De una vez y sin temporales huérfanos (nucleo). Un archivo de la grabación es de la persona: conserva sus permisos y, si es
    nuevo, queda como cualquier archivo suyo (DOCUMENTO)."""
    nucleo.escribir_atomico(ruta, texto, None if os.path.exists(ruta) else nucleo.DOCUMENTO)


def guardar_json(ruta, datos):
    escribir(ruta, json.dumps(datos, ensure_ascii=False, indent=2))


def preparar(carpeta):
    """La primera vez que se recorta, copia los textos a .original/ (para poder deshacer)."""
    original = os.path.join(carpeta, ".original")
    os.makedirs(original, exist_ok=True)
    if not os.path.exists(os.path.join(original, ".textos")):
        for n in TEXTOS:
            if os.path.exists(os.path.join(carpeta, n)):
                shutil.copy2(os.path.join(carpeta, n), os.path.join(original, n))
        open(os.path.join(original, ".textos"), "w").close()
    return {"ok": True}


# ───────────── Correr los tiempos ─────────────
def correr_ms(ms, inicio_ms, fin_ms):
    """Un tiempo del video de antes → el del video nuevo (None si quedó fuera)."""
    if ms < inicio_ms or ms > fin_ms:
        return None
    return ms - inicio_ms


def transcripcion(carpeta, inicio_ms, fin_ms):
    ruta = os.path.join(carpeta, "transcripcion.json")
    datos = leer_json(ruta, None)
    if not isinstance(datos, dict):
        return
    nueva = []
    for s in datos.get("transcription", []):
        a, b = s.get("offsets", {}).get("from", 0), s.get("offsets", {}).get("to", 0)
        if b <= inicio_ms or a >= fin_ms:
            continue  # quedó entero fuera
        s = dict(s, offsets={"from": max(a, inicio_ms) - inicio_ms, "to": min(b, fin_ms) - inicio_ms})
        s.pop("timestamps", None)
        nueva.append(s)
    datos["transcription"] = nueva
    guardar_json(ruta, datos)


def _ms_srt(t):
    h, m, resto = t.strip().split(":")
    s, ms = resto.replace(".", ",").split(",")
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms)


def subtitulos(carpeta, inicio_ms, fin_ms):
    ruta = os.path.join(carpeta, "subtitulos.srt")
    try:
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
    except OSError:
        return
    bloques, n = [], 0
    for b in re.split(r"\n\s*\n", texto.strip()):
        lineas = b.splitlines()
        i = next((k for k, l in enumerate(lineas) if "-->" in l), None)
        if i is None:
            continue
        a, z = (_ms_srt(x) for x in lineas[i].split("-->"))
        if z <= inicio_ms or a >= fin_ms:
            continue
        n += 1
        a, z = max(a, inicio_ms) - inicio_ms, min(z, fin_ms) - inicio_ms
        bloques.append(f"{n}\n{tiempo_srt(a)} --> {tiempo_srt(z)}\n" + "\n".join(lineas[i + 1:]) + "\n")
    escribir(ruta, "\n".join(bloques))


def grabacion_md(carpeta, inicio, fin):
    ruta = os.path.join(carpeta, "grabacion.md")
    try:
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
    except OSError:
        return
    duracion = fin - inicio
    texto = re.sub(r"^duracion_seg: .*$", f"duracion_seg: {int(round(duracion))}", texto, count=1, flags=re.M)

    # Capítulos: se corren, los que quedaron antes del nuevo inicio se juntan en 00:00 y los que quedaron después del final se van.
    def capitulos(m):
        lineas = []
        for linea in m.group(1).splitlines():
            c = re.match(r"^\s*[-*]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—]?\s*(.+)$", linea)
            if c:
                s = a_segundos(c.group(1)) - inicio
                if s < duracion:
                    lineas.append((max(0, s), c.group(2).strip()))
        # Si varios quedaron en 00:00, sirve el último de ellos (es el que estaba sonando al nuevo inicio).
        ceros = [x for x in lineas if x[0] == 0]
        resto = [x for x in lineas if x[0] > 0]
        elegidos = ([ceros[-1]] if ceros else []) + resto
        return capitulos_validos("\n".join(f"{reloj(s)} {n}" for s, n in elegidos), duracion) + "\n"
    texto = re.sub(r"(?<=### Capítulos\n)(.*?)(?=\n### |\n## |\Z)", lambda m: capitulos(m).rstrip("\n"), texto, count=1, flags=re.S)

    # Transcripción: [mm:ss] corridos; lo que quedó fuera se va.
    def linea_transcripcion(m):
        s = a_segundos(m.group(1)) - inicio
        if s < -1 or s > duracion:
            return ""
        return f"[{reloj(max(0, s), duracion >= 3600)}]"
    partes = texto.split("\n## Transcripción\n", 1)
    if len(partes) == 2:
        lineas = []
        for l in partes[1].splitlines():
            m = re.match(r"^\[((?:\d+:)?\d{1,2}:\d{2})\](.*)$", l)
            if m:
                nueva = re.sub(r"^\[((?:\d+:)?\d{1,2}:\d{2})\]", linea_transcripcion, l)
                if nueva.startswith("["):
                    lineas.append(nueva)
            else:
                lineas.append(l)
        texto = partes[0] + "\n## Transcripción\n" + ("\n".join(lineas).strip() or "(sin voz)") + "\n"
    escribir(ruta, texto)


def audio_wav(carpeta, inicio, fin):
    """Si todavía no se transcribió, el audio para whisper también se corta (así los tiempos calzan con el video nuevo)."""
    ruta = os.path.join(carpeta, "audio.wav")
    if not os.path.exists(ruta):
        return
    with wave.open(ruta, "rb") as w:
        params, tasa = w.getparams(), w.getframerate()
        w.setpos(min(w.getnframes(), int(inicio * tasa)))
        cuadros = w.readframes(max(0, int((fin - inicio) * tasa)))
    with wave.open(ruta + ".tmp", "wb") as w:
        w.setparams(params)
        w.writeframes(cuadros)
    os.replace(ruta + ".tmp", ruta)


def textos(carpeta, inicio, fin):
    if not (0 <= inicio < fin):
        return {"ok": False, "error": "El recorte no es válido."}
    meta = leer_json(os.path.join(carpeta, "meta.json"), {}) or {}
    total = float(meta.get("duracion_seg") or fin)
    if total > 0:
        fin = min(fin, total)
    inicio_ms, fin_ms = int(inicio * 1000), int(fin * 1000)
    transcripcion(carpeta, inicio_ms, fin_ms)
    subtitulos(carpeta, inicio_ms, fin_ms)
    grabacion_md(carpeta, inicio, fin)
    audio_wav(carpeta, inicio, fin)
    recortes = meta.get("recortes", []) + [{"inicio": round(inicio, 2), "fin": round(fin, 2)}]
    meta.update(duracion_seg=int(round(fin - inicio)), recortes=recortes)
    guardar_json(os.path.join(carpeta, "meta.json"), meta)
    return {"ok": True, "duracion": round(fin - inicio, 2)}


def deshacer(carpeta):
    original = os.path.join(carpeta, ".original")
    if not os.path.exists(os.path.join(original, ".textos")):
        return {"ok": False, "error": "Esta grabación no tiene un recorte para deshacer."}
    for n in TEXTOS:
        guardado = os.path.join(original, n)
        if os.path.exists(guardado):
            shutil.copy2(guardado, os.path.join(carpeta, n))
        elif n == "audio.wav" and os.path.exists(os.path.join(carpeta, n)):
            pass  # el audio ya se había usado y borrado al transcribir: no hay nada que volver
    os.remove(os.path.join(original, ".textos"))
    for n in TEXTOS:
        try:
            os.remove(os.path.join(original, n))
        except OSError:
            pass
    try:
        os.rmdir(original)  # si quedó vacía (la app ya devolvió el video)
    except OSError:
        pass
    return {"ok": True}


def main():
    a = sys.argv[1:]
    try:
        if len(a) == 3 and a[0] == "preparar":
            r = preparar(os.path.abspath(a[1]))
        elif len(a) == 5 and a[0] == "textos":
            r = textos(os.path.abspath(a[1]), float(a[2]), float(a[3]))
        elif len(a) == 3 and a[0] == "deshacer":
            r = deshacer(os.path.abspath(a[1]))
        else:
            sys.exit(__doc__)
    except (OSError, ValueError) as e:
        r = {"ok": False, "error": f"No pude recortar: {e}"}
    nucleo.responder(a[-1], r)
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
