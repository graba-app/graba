#!/usr/bin/env python3
"""Corrige una grabación con la IA del usuario a partir de una instrucción en palabras.

Uso: corregir.py <carpeta de la grabación> <instruccion.txt> <salida.json>

Ejemplos de instrucción: "dice Grava y es Graba", "el título tiene que hablar de presupuestos", "el gancho más corto".
La IA reescribe el texto (título, notas, guion, títulos, descripción, capítulos, etiquetas) aplicando SOLO esa corrección y devuelve
qué palabras estaban mal transcritas: esas se reemplazan también en la transcripción, los subtítulos y transcripcion.json, y quedan en
~/Graba/.graba/vocabulario.txt para transcribirlas bien la próxima vez. Antes de escribir se guarda una copia en <carpeta>/.respaldos/.
"""
import json
import os
import re
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ia  # noqa: E402
import procesar  # noqa: E402


def partes(texto):
    """(frontmatter, texto editable desde "# Título" hasta antes de la transcripción, sección de transcripción)."""
    fm, cuerpo = "", texto
    if texto.startswith("---\n"):
        i = texto.find("\n---\n", 4)
        if i > 0:
            fm, cuerpo = texto[:i + 5], texto[i + 5:]
    corte = cuerpo.find("\n## Transcripción")
    if corte < 0:
        corte = len(cuerpo)
    return fm, cuerpo[:corte].strip("\n"), cuerpo[corte:]


def prompt_para(instruccion, contenido):
    return f"""Eres editor del texto de un video. La persona pidió esta corrección:

«{instruccion.strip()}»

Abajo está el texto actual. Aplica SOLO lo que pidió (y lo que se desprende directo de eso, en todas las secciones donde aparezca);
no cambies nada más, no agregues ni quites secciones y mantén el mismo idioma. Si pide corregir una palabra mal escrita, corrígela
en todo el texto y anótala en REEMPLAZOS para corregir también la transcripción y los subtítulos.

Responde SOLO con este formato:
REEMPLAZOS: <texto mal escrito> => <texto correcto>; ...   (o "ninguno"; solo palabras o frases cortas que estaban mal transcritas)
VOCABULARIO: <palabra o nombre bien escrito> | ...   (o "ninguno"; nombres propios o términos que conviene recordar para transcribir bien)
CAMBIOS: <una frase con lo que cambiaste>
===GRABACION===
<el texto completo corregido: desde la línea "# Título" hasta el final, con los mismos títulos de sección en español>

TEXTO ACTUAL:
{contenido}
"""


def reemplazar(texto, pares):
    """Reemplaza palabras completas sin importar mayúsculas, respetando si la original empezaba con mayúscula."""
    for mal, bien in pares:
        def cambio(m, bien=bien):
            o = m.group(0)
            if o.isupper() and len(o) > 1:
                return bien.upper()
            return bien[:1].upper() + bien[1:] if o[:1].isupper() else bien
        texto = re.sub(r"(?<!\w)" + re.escape(mal) + r"(?!\w)", cambio, texto, flags=re.I)
    return texto


def campo(cabecera, nombre):
    m = re.search(rf"^{nombre}:\s*(.*)$", cabecera, re.M | re.I)
    v = (m.group(1).strip() if m else "")
    return "" if v.lower().strip(" .") in ("ninguno", "ninguna", "none", "-") else v


def agregar_vocabulario(palabras):
    ruta = os.path.join(ia.INTERNO, "vocabulario.txt")
    actuales = []
    if os.path.exists(ruta):
        actuales = [l.strip() for l in open(ruta, encoding="utf-8") if l.strip()]
    vistos = {p.lower() for p in actuales}
    nuevas = [p for p in palabras if p and p.lower() not in vistos and len(p) <= 60]
    if nuevas:
        os.makedirs(ia.INTERNO, exist_ok=True)
        with open(ruta, "w", encoding="utf-8") as f:
            f.write("\n".join((actuales + nuevas)[-200:]) + "\n")
    return nuevas


def responder(salida, datos):
    procesar.guardar_json(salida, datos)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    carpeta, instr, salida = os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3]
    md_ruta = os.path.join(carpeta, "grabacion.md")
    try:
        texto = open(md_ruta, encoding="utf-8").read()
        instruccion = open(instr, encoding="utf-8").read()
    except OSError as e:
        return responder(salida, {"ok": False, "carpeta": carpeta, "error": str(e)})
    fm, contenido, transcripcion = partes(texto)
    r = ia.ejecutar_ia(prompt_para(instruccion, contenido))
    respuesta = (r.stdout or "").strip()
    if r.returncode != 0 or "===GRABACION===" not in respuesta:
        detalle = (r.stderr or "").strip()[-300:] if r.returncode != 0 else "la respuesta no vino en el formato esperado"
        return responder(salida, {"ok": False, "carpeta": carpeta, "error": f"{ia.NOMBRE_IA} no pudo corregir: {detalle}. Prueba de nuevo."})
    cabecera, nuevo = respuesta.split("===GRABACION===", 1)
    nuevo = re.sub(r"^```\w*\n|\n```\s*$", "", nuevo.strip()).strip()
    faltan = [m for m in procesar.MARCADORES if m not in nuevo]
    if not nuevo.startswith("# ") or faltan:
        return responder(salida, {"ok": False, "carpeta": carpeta,
                                  "error": f"La corrección vino incompleta (falta {', '.join(faltan) or 'el título'}). No cambié nada."})

    pares = []
    for par in campo(cabecera, "REEMPLAZOS").split(";"):
        if "=>" in par:
            mal, bien = (x.strip().strip("\"'«»") for x in par.split("=>", 1))
            if mal and bien and mal.lower() != bien.lower() and len(mal) <= 60:
                pares.append((mal, bien))
    vocabulario = [x.strip().strip("\"'«»") for x in campo(cabecera, "VOCABULARIO").split("|")] + [b for _, b in pares]

    # Copia de seguridad antes de tocar nada.
    respaldo = os.path.join(carpeta, ".respaldos", datetime.now().strftime("%Y-%m-%d %H%M%S"))
    os.makedirs(respaldo, exist_ok=True)
    for nombre in ("grabacion.md", "subtitulos.srt", "transcripcion.json"):
        if os.path.exists(os.path.join(carpeta, nombre)):
            shutil.copy2(os.path.join(carpeta, nombre), respaldo)

    meta = procesar.leer_json(os.path.join(carpeta, "meta.json"), {}) or {}
    duracion = float(meta.get("duracion_seg", 0))
    titulo = nuevo.splitlines()[0][2:].strip()
    # Capítulos: mismas reglas de YouTube que al procesar.
    cap = re.search(r"### Capítulos\n(.*?)(?=\n### |\n## |\Z)", nuevo, re.S)
    if cap:
        nuevo = nuevo[:cap.start(1)] + procesar.capitulos_validos(cap.group(1), duracion) + "\n" + nuevo[cap.end(1):]
    if re.search(r"^titulo:", fm, re.M):
        fm = re.sub(r"^titulo:.*$", lambda _: "titulo: " + json.dumps(titulo, ensure_ascii=False), fm, count=1, flags=re.M)
    transcripcion = reemplazar(transcripcion, pares)
    with open(md_ruta, "w", encoding="utf-8") as f:
        f.write(fm + re.sub(r"\n{3,}", "\n\n", nuevo).strip() + "\n\n" + transcripcion.lstrip("\n"))

    if pares:
        srt = os.path.join(carpeta, "subtitulos.srt")
        if os.path.exists(srt):
            contenido_srt = open(srt, encoding="utf-8").read()
            with open(srt, "w", encoding="utf-8") as f:
                f.write(reemplazar(contenido_srt, pares))
        tj = os.path.join(carpeta, "transcripcion.json")
        datos = procesar.leer_json(tj)
        if datos and isinstance(datos.get("transcription"), list):
            for s in datos["transcription"]:
                s["text"] = reemplazar(s.get("text", ""), pares)
            procesar.guardar_json(tj, datos)
    aprendidas = agregar_vocabulario(vocabulario)

    # Si cambió el título, la carpeta también (como al procesar).
    final = carpeta
    inicio = meta.get("inicio")
    if inicio:
        destino = os.path.join(os.path.dirname(carpeta), procesar.nombre_carpeta(datetime.fromisoformat(inicio), titulo))
        if os.path.abspath(destino) != carpeta and not os.path.exists(destino):
            os.rename(carpeta, destino)
            final = destino
    responder(salida, {"ok": True, "carpeta": final, "cambios": campo(cabecera, "CAMBIOS"), "reemplazos": len(pares), "aprendidas": aprendidas})


if __name__ == "__main__":
    main()
