"""Convierte los subtítulos de una carpeta de Graba a WebVTT."""
import argparse
from html import escape
from pathlib import Path
import re


def convertir(carpeta):
    origen = carpeta / "subtitulos.srt"
    destino = carpeta / "subtitulos.vtt"
    contenido = origen.read_text(encoding="utf-8-sig").strip()
    bloques = ["WEBVTT"]
    marca = r"\d{2,}:[0-5]\d:[0-5]\d,\d{3}"
    for numero, bloque in enumerate(re.split(r"\n[ \t]*\n+", contenido) if contenido else [], 1):
        lineas = bloque.splitlines()
        if len(lineas) < 3 or not lineas[0].isdigit() or not re.fullmatch(
            rf"{marca} --> {marca}", lineas[1]
        ):
            raise ValueError(f"Formato SRT inesperado en el bloque {numero}")
        tiempo = lineas[1].replace(",", ".")
        texto = escape("\n".join(lineas[2:]), quote=False)
        bloques.append(f"{tiempo}\n{texto}")
    destino.write_text("\n\n".join(bloques) + ("\n\n" if not contenido else "\n"), encoding="utf-8")
    return destino


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("carpeta", type=Path, help="carpeta que contiene subtitulos.srt")
    try:
        print(convertir(parser.parse_args().carpeta))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
