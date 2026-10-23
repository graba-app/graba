#!/usr/bin/env python3
"""Pruebas del procesamiento (solo biblioteca estándar). Corren con una carpeta de datos temporal, un transcriptor falso
y una IA falsa en el PATH: nunca tocan tus grabaciones ni llaman a una IA real.

Uso: python3 pruebas/test_python.py   (desde la raíz del repo)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATOS = tempfile.mkdtemp(prefix="graba-pruebas-")
FALSOS = os.path.join(DATOS, "bin-falso")
os.makedirs(os.path.join(DATOS, ".graba", "modelos"))
os.makedirs(FALSOS)
open(os.path.join(DATOS, ".graba", "modelos", "ggml-large-v3-turbo-q5_0.bin"), "w").close()
with open(os.path.join(DATOS, ".graba", "config.json"), "w") as f:
    json.dump({"ia": "claude", "modelo": "turbo"}, f)
os.environ["GRABA_CARPETA"] = DATOS
os.environ["GRABA_HERRAMIENTAS"] = FALSOS
os.environ["PATH"] = FALSOS + os.pathsep + os.environ.get("PATH", "")
sys.path.insert(0, os.path.join(RAIZ, "bin"))

import procesar  # noqa: E402

# Transcriptor falso: escribe un JSON como el de whisper con tres frases.
TRANSCRIPCION = {"transcription": [
    {"offsets": {"from": 0, "to": 4000}, "text": " Hola, hoy les muestro cómo ordenar una planilla."},
    {"offsets": {"from": 4000, "to": 9000}, "text": " [música]"},
    {"offsets": {"from": 65000, "to": 70000}, "text": " Primero seleccionamos las columnas."},
    {"offsets": {"from": 130000, "to": 136000}, "text": " Y al final guardamos. Listo."},
]}
with open(os.path.join(FALSOS, "graba-transcribir"), "w") as f:
    f.write("#!/usr/bin/env python3\nimport json,sys\na=sys.argv\nopen(a[a.index('-of')+1]+'.json','w').write(" + repr(json.dumps(TRANSCRIPCION)) + ")\n")
os.chmod(os.path.join(FALSOS, "graba-transcribir"), 0o755)

RESPUESTA = textwrap.dedent("""\
    TITULO: Ordenar una planilla paso a paso

    ## Resumen
    Ana muestra cómo ordenar una planilla.

    ## Notas
    - Seleccionar columnas
    - Guardar

    ## Guion para YouTube
    ### Gancho
    ¿Tu planilla es un caos?
    ### Introducción
    Hola.
    ### Desarrollo
    1. Selecciona las columnas [mostrar la hoja]
    ### Cierre
    Suscríbete.

    ## Para publicar
    ### Títulos
    1. Ordena tu planilla en 2 minutos
    2. Planillas ordenadas
    3. Tutorial de planillas
    ### Descripción
    Aprende a ordenar una planilla.
    ### Capítulos
    00:05 Inicio
    01:05 Columnas
    02:10 Guardar
    09:00 Esto no existe
    ### Etiquetas
    planilla, tutorial
    """)


def ia_falsa(respuesta, codigo=0):
    ruta = os.path.join(FALSOS, "claude")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(f"#!/bin/bash\ncat > /dev/null\ncat <<'RESPUESTA'\n{respuesta}\nRESPUESTA\nexit {codigo}\n")
    os.chmod(ruta, 0o755)
    procesar.ia.COMANDO = ruta


def nueva_grabacion():
    c = tempfile.mkdtemp(dir=DATOS, prefix="2026-10-20 101500 - ")
    with open(os.path.join(c, "meta.json"), "w") as f:
        json.dump({"inicio": "2026-10-20T10:15:00", "duracion_seg": 140}, f)
    open(os.path.join(c, "audio.wav"), "wb").close()
    return c


class Tiempos(unittest.TestCase):
    def test_reloj(self):
        self.assertEqual(procesar.reloj(83), "01:23")
        self.assertEqual(procesar.reloj(3723), "1:02:03")
        self.assertEqual(procesar.reloj(5, horas=True), "0:00:05")

    def test_srt(self):
        self.assertEqual(procesar.tiempo_srt(3723456), "01:02:03,456")

    def test_capitulos(self):
        # Ordena, quita los que se pasan del largo y obliga a que el primero sea 00:00 (regla de YouTube).
        self.assertEqual(procesar.capitulos_validos("01:05 Columnas\n00:05 Inicio\n09:00 Fuera\n- 02:10 — Guardar", 140),
                         "00:00 Inicio\n01:05 Columnas\n02:10 Guardar")
        self.assertEqual(procesar.capitulos_validos("nada", 30), "00:00 Inicio")


class Procesar(unittest.TestCase):
    def test_de_punta_a_punta(self):
        ia_falsa(RESPUESTA)
        c = nueva_grabacion()
        salida = os.path.join(DATOS, "salida.json")
        sys.argv = ["procesar.py", c, salida]
        procesar.main()
        r = json.load(open(salida))
        self.assertTrue(r["ok"], r)
        final = r["carpeta"]
        self.assertTrue(os.path.basename(final).startswith("2026-10-20 1015 - Ordenar una planilla paso a paso"))
        md = open(os.path.join(final, "grabacion.md"), encoding="utf-8").read()
        for marca in ["titulo: \"Ordenar una planilla paso a paso\"", "duracion_seg: 140", "## Resumen", "## Guion para YouTube",
                      "### Capítulos\n00:00 Inicio\n01:05 Columnas\n02:10 Guardar\n", "## Transcripción\n[00:00] Hola"]:
            self.assertIn(marca, md)
        self.assertNotIn("09:00", md)
        self.assertNotIn("[música]", md)
        srt = open(os.path.join(final, "subtitulos.srt"), encoding="utf-8").read()
        self.assertIn("1\n00:00:00,000 --> 00:00:04,000\nHola", srt)
        self.assertEqual(json.load(open(os.path.join(final, "estado.json")))["estado"], "lista")
        self.assertFalse(os.path.exists(os.path.join(final, "audio.wav")))

    def test_respuesta_incompleta_no_rompe_nada(self):
        ia_falsa("TITULO: algo\n\nsolo esto")
        c = nueva_grabacion()
        salida = os.path.join(DATOS, "salida2.json")
        sys.argv = ["procesar.py", c, salida]
        procesar.main()
        r = json.load(open(salida))
        self.assertFalse(r["ok"])
        self.assertEqual(json.load(open(os.path.join(c, "estado.json")))["estado"], "error")
        self.assertTrue(os.path.exists(os.path.join(c, "transcripcion.json")))  # se puede regenerar sin transcribir de nuevo

    def test_regenerar_solo_ia(self):
        ia_falsa("TITULO: algo\n\nsolo esto")
        c = nueva_grabacion()
        sys.argv = ["procesar.py", c, os.path.join(DATOS, "s3.json")]
        procesar.main()
        ia_falsa(RESPUESTA)
        sys.argv = ["procesar.py", c, os.path.join(DATOS, "s4.json"), "--solo-ia"]
        procesar.main()
        self.assertTrue(json.load(open(os.path.join(DATOS, "s4.json")))["ok"])

    def test_sin_microfono(self):
        c = nueva_grabacion()
        os.remove(os.path.join(c, "audio.wav"))
        sys.argv = ["procesar.py", c, os.path.join(DATOS, "s5.json")]
        procesar.main()
        r = json.load(open(os.path.join(DATOS, "s5.json")))
        self.assertTrue(r["ok"])
        self.assertIn("No se escuchó voz", open(os.path.join(r["carpeta"], "grabacion.md"), encoding="utf-8").read())


class Corregir(unittest.TestCase):
    def preparar(self):
        ia_falsa(RESPUESTA.replace("Ana muestra", "Ana muestra Grava"))
        c = nueva_grabacion()
        sys.argv = ["procesar.py", c, os.path.join(DATOS, "p.json")]
        procesar.main()
        with open(os.path.join(DATOS, "p.json")) as f:
            final = json.load(f)["carpeta"]
        # La transcripción falsa no trae "Grava": se agrega para revisar que se corrija también ahí y en los subtítulos.
        for nombre in ("grabacion.md", "subtitulos.srt"):
            ruta = os.path.join(final, nombre)
            with open(ruta, encoding="utf-8") as f:
                t = f.read()
            with open(ruta, "w", encoding="utf-8") as f:
                f.write(t.replace("ordenar una planilla", "ordenar una planilla en Grava"))
        instr = os.path.join(DATOS, "instr.txt")
        with open(instr, "w", encoding="utf-8") as f:
            f.write("dice Grava y es Graba")
        return final, instr

    def correr(self, carpeta, instr):
        salida = os.path.join(DATOS, "c.json")
        subprocess.run([sys.executable, os.path.join(RAIZ, "bin", "corregir.py"), carpeta, instr, salida], check=True, env=os.environ)
        with open(salida) as f:
            return json.load(f)

    def test_corrige_todo_y_aprende(self):
        carpeta, instr = self.preparar()
        cuerpo = RESPUESTA.split("\n", 2)[2].replace("Ana muestra", "Ana muestra Graba")
        ia_falsa("REEMPLAZOS: Grava => Graba\nVOCABULARIO: Graba\nCAMBIOS: Graba bien escrito.\n===GRABACION===\n# Ordenar una planilla en Graba\n\n" + cuerpo)
        r = self.correr(carpeta, instr)
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["reemplazos"], 1)
        final = r["carpeta"]
        self.assertTrue(final.endswith("Ordenar una planilla en Graba"))
        with open(os.path.join(final, "grabacion.md"), encoding="utf-8") as f:
            md = f.read()
        self.assertIn('titulo: "Ordenar una planilla en Graba"', md)
        self.assertIn("Ana muestra Graba", md)
        self.assertIn("ordenar una planilla en Graba", md)  # transcripción
        self.assertNotIn("Grava", md)
        with open(os.path.join(final, "subtitulos.srt"), encoding="utf-8") as f:
            self.assertNotIn("Grava", f.read())
        self.assertTrue(os.listdir(os.path.join(final, ".respaldos")))
        with open(os.path.join(DATOS, ".graba", "vocabulario.txt"), encoding="utf-8") as f:
            self.assertIn("Graba", f.read())
        self.assertIn("Graba", procesar.prompt_para([{"desde": 0, "hasta": 1000, "texto": "hola"}], 10))

    def test_respuesta_rota_no_cambia_nada(self):
        carpeta, instr = self.preparar()
        with open(os.path.join(carpeta, "grabacion.md"), encoding="utf-8") as f:
            antes = f.read()
        ia_falsa("REEMPLAZOS: ninguno\n===GRABACION===\n# Solo un título")
        r = self.correr(carpeta, instr)
        self.assertFalse(r["ok"])
        with open(os.path.join(carpeta, "grabacion.md"), encoding="utf-8") as f:
            self.assertEqual(f.read(), antes)


class Ejemplos(unittest.TestCase):
    def test_respuesta_ejemplo_valida(self):
        titulo, cuerpo = procesar.interpretar(RESPUESTA, 140)
        self.assertEqual(titulo, "Ordenar una planilla paso a paso")
        self.assertTrue(cuerpo.startswith("## Resumen"))


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(DATOS, ignore_errors=True)
