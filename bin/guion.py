#!/usr/bin/env python3
"""Crea con la IA del usuario el diálogo para leer en el teleprompter: a partir de una idea, la duración que debe tener el video
y archivos opcionales (presentación, documentos, imágenes).

Uso: guion.py <entrada.json> <salida.json>
  entrada: {"idea": "…", "minutos": 3, "archivos": ["/ruta/presentacion.pdf", …], "para": "youtube" | "presentacion" | "tutorial"}
  salida:  {"ok": true, "titulo": "…", "guion": "…", "palabras": 420, "minutos": 3.0}  o  {"ok": false, "error": "…"}

Los archivos se copian a la carpeta temporal donde trabaja la IA (en modo solo lectura) para que los lea con su propia cuenta.
De PowerPoint (.pptx), Word (.docx), texto y Markdown además se saca el texto aquí mismo, por si la IA no puede abrirlos.
"""
import json
import os
import re
import sys
import zipfile
from html import unescape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ia  # noqa: E402
import procesar  # noqa: E402

PALABRAS_POR_MINUTO = 140  # ritmo cómodo leyendo en voz alta
MAX_TEXTO = 60000          # para no mandar documentos gigantes completos


def texto_de(ruta):
    """Texto plano de los formatos que se pueden leer sin instalar nada. '' si no se puede (PDF, imágenes: los lee la IA)."""
    ext = os.path.splitext(ruta)[1].lower()
    try:
        if ext in (".txt", ".md", ".markdown", ".csv"):
            with open(ruta, encoding="utf-8", errors="replace") as f:
                return f.read()
        if ext == ".pptx":
            with zipfile.ZipFile(ruta) as z:
                diapos = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                                key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
                partes = []
                for i, n in enumerate(diapos, 1):
                    frases = [unescape(t) for t in re.findall(r"<a:t>(.*?)</a:t>", z.read(n).decode("utf-8", "replace"))]
                    partes.append(f"Diapositiva {i}: " + " · ".join(x.strip() for x in frases if x.strip()))
                return "\n".join(partes)
        if ext == ".docx":
            with zipfile.ZipFile(ruta) as z:
                xml = z.read("word/document.xml").decode("utf-8", "replace")
            parrafos = re.split(r"</w:p>", xml)
            return "\n".join(unescape("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", p))) for p in parrafos).strip()
    except (OSError, zipfile.BadZipFile, KeyError, ValueError):
        return ""
    return ""


def prompt_para(idea, minutos, para, nombres, extraidos):
    palabras = int(minutos * PALABRAS_POR_MINUTO)
    destino = {"presentacion": "una presentación grabada (alguien muestra sus diapositivas y las explica)",
               "tutorial": "un tutorial (alguien muestra en pantalla cómo hacer algo)"}.get(para, "un video para YouTube")
    archivos = ""
    if nombres:
        archivos = ("\n\nEn esta carpeta están los archivos que la persona adjuntó: " + ", ".join(nombres) +
                    ". Léelos y úsalos como base (el orden de las diapositivas, los datos, los nombres).")
    if extraidos:
        archivos += "\n\nTexto ya extraído de algunos de esos archivos:\n" + extraidos[:MAX_TEXTO]
    return f"""Escribe el guion que una persona va a LEER EN VOZ ALTA en un teleprompter mientras graba {destino}.

Idea: {idea.strip() or "(la persona no escribió una idea: deduce el tema de los archivos)"}
Duración: {minutos:g} minutos, o sea unas {palabras} palabras (lee a unas {PALABRAS_POR_MINUTO} palabras por minuto). Respeta ese largo.{archivos}

Cómo debe ser:
- En primera persona, cercano y natural, como se habla (no como se escribe). Frases cortas. Sin muletillas ni relleno.
- Partes con un gancho de una o dos frases que diga por qué vale la pena quedarse, y cierras con un resumen breve y una invitación.
- Párrafos cortos separados por una línea en blanco (son las pausas para respirar).
- Indicaciones de qué mostrar o hacer en una línea propia entre corchetes, por ejemplo [pasa a la diapositiva 3] o [muestra el menú].
  No las cuentes como palabras leídas.
- En el mismo idioma de la idea (o de los archivos, si no hay idea). No inventes datos que no estén en la idea o en los archivos.

Responde SOLO con este formato:
TITULO: <título corto del video, máximo 8 palabras>
===GUION===
<el guion>
"""


def contar(guion):
    """Palabras que se leen (sin las indicaciones entre corchetes)."""
    return len(re.sub(r"\[[^\]]*\]", " ", guion).split())


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    salida = sys.argv[2]
    try:
        with open(sys.argv[1], encoding="utf-8") as f:
            e = json.load(f)
        minutos = max(0.5, min(60.0, float(e.get("minutos") or 3)))
        idea = str(e.get("idea") or "")
        archivos = [a for a in (e.get("archivos") or []) if isinstance(a, str) and os.path.isfile(a)]
        if not idea.strip() and not archivos:
            return procesar.guardar_json(salida, {"ok": False, "error": "Cuéntame la idea o agrega un archivo."})
        # En la carpeta de la IA las copias se llaman material-1.pdf…: el nombre original va solo como texto, para que se entienda.
        nombres = [f"{ia.nombre_copia(k, a)} ({os.path.basename(a)})" for k, a in enumerate(archivos)]
        extraidos = "\n\n".join(f"--- {n} ---\n{t}" for n, a in zip(nombres, archivos) if (t := texto_de(a).strip()))
        r = ia.ejecutar_ia(prompt_para(idea, minutos, e.get("para") or "youtube", nombres, extraidos), archivos=archivos)
        respuesta = re.sub(r"^```\w*\n|\n```\s*$", "", (r.stdout or "").strip())
        if r.returncode != 0 or "===GUION===" not in respuesta:
            detalle = (r.stderr or "").strip()[-300:] if r.returncode != 0 else "la respuesta no vino en el formato esperado"
            return procesar.guardar_json(salida, {"ok": False, "error": f"{ia.NOMBRE_IA} no pudo escribir el guion: {detalle}. Prueba de nuevo."})
        cabecera, guion = respuesta.split("===GUION===", 1)
        guion = re.sub(r"\n{3,}", "\n\n", guion.strip())
        m = re.search(r"^TITULO:\s*(.+)$", cabecera, re.M)
        palabras = contar(guion)
        procesar.guardar_json(salida, {"ok": True, "titulo": (m.group(1).strip().strip("\"«»*") if m else "")[:80], "guion": guion,
                                       "palabras": palabras, "minutos": round(palabras / PALABRAS_POR_MINUTO, 1)})
    except Exception as ex:  # noqa: BLE001 — cualquier falla se le muestra a la persona
        procesar.guardar_json(salida, {"ok": False, "error": str(ex)})


if __name__ == "__main__":
    main()
