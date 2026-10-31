"""Lo propio de Graba que comparten sus scripts (lo genérico viene de las piezas «nucleo» e «ia»). Solo biblioteca estándar.

Datos del usuario (fuera del código; `app.json` → "datos": "visible", así nucleo.carpeta_datos() es ~/Graba/.graba):
  ~/Graba/                     una carpeta por grabación ("2026-10-23 1812 - Título")
  ~/Graba/.graba/config.json   la escriben las apps (Swift y Electron); aquí solo se lee, validada por app.json
  ~/Graba/.graba/modelos/      modelos de whisper (los descarga la app, verificados por SHA-256)
  ~/Graba/.graba/vocabulario.txt  palabras que la persona corrigió (corregir.py)
Variables: GRABA_DATOS (la carpeta interna; en las pruebas), GRABA_RECURSOS (bin/, ui/, app.json) y GRABA_HERRAMIENTAS (binarios
de la app). La IA nunca las ve (ia._entorno).
"""
import os
import shutil

import ia
import nucleo

#: ~/Graba/.graba (o GRABA_DATOS). La carpeta de las grabaciones es la de arriba.
INTERNO = nucleo.carpeta_datos()
BASE = os.path.dirname(INTERNO)
MODELOS = os.path.join(INTERNO, "modelos")
#: Código de la app (bin/, ui/, app.json): dentro de Graba.app o el checkout de desarrollo.
RECURSOS = nucleo.recursos()

ARCHIVOS_MODELO = {"turbo": "ggml-large-v3-turbo-q5_0.bin", "small": "ggml-small-q5_1.bin"}
POR_DEFECTO = {"ia": "claude", "modelo": "turbo", "idioma_audio": "auto", "idioma_ui": "es"}

leer_json = nucleo.leer_json


def config():
    """La config validada por app.json (lo desconocido o inválido se descarta) con los valores de siempre por defecto."""
    return {**POR_DEFECTO, **nucleo.config()}


def guardar_json(ruta, datos):
    """Escribe un JSON de una vez (nucleo.escribir_atomico): un archivo nuevo queda solo para la persona (0600), porque a veces lleva
    un token (youtube.py conectar) y la salida va a la carpeta temporal."""
    nucleo.escribir_json(ruta, datos, indent=2)


def nombre_ia():
    """Nombre visible de la IA elegida, para los mensajes («Claude no pudo…»)."""
    return ia.nombre()


def error_ia(error):
    """El error de ia.preguntar() en español, para mostrarlo tal cual (estado.json, respuestas a la app)."""
    return ia.frase(error)


def nombre_copia(k, ruta):
    """Nombre de la copia de un archivo adjunto en la carpeta de la IA (k desde 0): material-1.pdf, material-2.png… (como ia.ejecutar)."""
    return f"material-{k + 1}{os.path.splitext(ruta)[1].lower()}"


def herramienta(nombre):
    """Busca un binario: dentro de la app (GRABA_HERRAMIENTAS), en bin/ del código o en el sistema."""
    for d in [nucleo.entorno("HERRAMIENTAS", ""), os.path.join(RECURSOS, "bin")]:
        for n in (nombre, nombre + ".exe"):
            r = os.path.join(d, n) if d else ""
            if r and os.path.isfile(r) and os.access(r, os.X_OK):
                return r
    return shutil.which(nombre)
