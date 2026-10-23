"""Configuración de Graba y la IA del usuario. Solo biblioteca estándar.

Datos del usuario (fuera del código):
  ~/Graba/                    una carpeta por grabación ("2026-10-23 1812 - Título")
  ~/Graba/.graba/config.json   {"ia": "claude"|"codex"|"gemini", "modelo": "turbo"|"small", "idioma_audio": "auto"|"es"|…, "idioma_ui": "es"|"en"}
  ~/Graba/.graba/modelos/      modelos de whisper (los descarga la app, verificados por SHA-256)
"""
import json
import os
import shutil
import subprocess
import tempfile

HOME = os.path.expanduser("~")
BASE = os.environ.get("GRABA_CARPETA") or os.path.join(HOME, "Graba")
INTERNO = os.path.join(BASE, ".graba")
CONFIG = os.path.join(INTERNO, "config.json")
MODELOS = os.path.join(INTERNO, "modelos")
#: Código de la app (bin/, ui/): dentro de Graba.app o el checkout de desarrollo.
RECURSOS = os.environ.get("GRABA_RECURSOS") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARCHIVOS_MODELO = {"turbo": "ggml-large-v3-turbo-q5_0.bin", "small": "ggml-small-q5_1.bin"}


def config():
    datos = {"ia": "claude", "modelo": "turbo", "idioma_audio": "auto", "idioma_ui": "es"}
    try:
        with open(CONFIG, encoding="utf-8") as f:
            datos.update({k: v for k, v in json.load(f).items() if v is not None})
    except (OSError, ValueError):
        pass
    return datos


def _preparar_path():
    """La app no hereda el PATH de la terminal: agrega donde suelen quedar los CLI de IA (Mac, Linux y Windows)."""
    extra = [os.path.join(HOME, ".local", "bin"), os.path.join(HOME, ".claude", "local"), os.path.join(HOME, ".npm-global", "bin"),
             os.path.join(HOME, ".volta", "bin"), os.path.join(HOME, ".bun", "bin"), os.path.join(HOME, ".codex", "bin"),
             "/opt/homebrew/bin", "/usr/local/bin"]
    nvm = os.path.join(HOME, ".nvm", "versions", "node")
    if os.path.isdir(nvm):
        extra += [os.path.join(nvm, v, "bin") for v in sorted(os.listdir(nvm), reverse=True)]
    if os.name == "nt":
        extra += [os.path.join(os.environ.get("APPDATA", ""), "npm"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "claude")]
    os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", "")] + [d for d in extra if os.path.isdir(d)])


_preparar_path()

#: IA del usuario, con su propia cuenta. Gemini: Antigravity CLI (`agy`) o el Gemini CLI antiguo.
IAS = {"claude": (("claude",), "Claude"), "codex": (("codex",), "ChatGPT (Codex)"), "gemini": (("agy", "gemini"), "Gemini")}
C = config()
IA = C["ia"] if C["ia"] in IAS else "claude"
NOMBRE_IA = IAS[IA][1]
COMANDO = next((r for r in map(shutil.which, IAS[IA][0]) if r), IAS[IA][0][0])
ES_AGY = os.path.basename(COMANDO).lower().split(".")[0] in ("agy", "antigravity")


def ejecutar_ia(prompt, timeout=900, archivos=()):
    """Le pasa el prompt a la IA del usuario y devuelve un CompletedProcess (stdout = respuesta).
    Corre en una carpeta temporal y en modo solo lectura: la IA ve solo el texto que le damos y, si se indican, copias de
    los archivos que la persona adjuntó (para que los lea con su propia cuenta)."""
    with tempfile.TemporaryDirectory(prefix="graba-ia-") as tmp:
        for a in archivos:
            try:
                shutil.copy2(a, os.path.join(tmp, os.path.basename(a)))
            except OSError:
                pass
        if IA == "codex":
            salida = os.path.join(tmp, "respuesta.txt")
            cmd = [COMANDO, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", tmp, "-o", salida, "-"]
            r = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp)
            texto = open(salida, encoding="utf-8").read() if os.path.exists(salida) else ""
            return subprocess.CompletedProcess(cmd, r.returncode, texto, r.stderr)
        if IA == "gemini" and ES_AGY:
            # Prompts largos en un archivo: la línea de comandos tiene límite.
            if len(prompt) < 20000:
                pedido = prompt
            else:
                with open(os.path.join(tmp, "instrucciones.md"), "w", encoding="utf-8") as f:
                    f.write(prompt)
                pedido = ("Lee el archivo instrucciones.md de esta carpeta y haz exactamente lo que pide. "
                          "Entrega solo el resultado pedido, sin comentarios. No modifiques ni crees archivos.")
            cmd = [COMANDO, "--output-format", "text", "--sandbox", "--add-dir", tmp, "-p", pedido]
            return subprocess.run(cmd, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp)
        if IA == "gemini":
            cmd = [COMANDO, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text"]
        else:
            cmd = [COMANDO, "-p", "--output-format", "text"]
        return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp)


def herramienta(nombre):
    """Busca un binario: dentro de la app (GRABA_HERRAMIENTAS), en bin/ del código o en el sistema."""
    for d in [os.environ.get("GRABA_HERRAMIENTAS", ""), os.path.join(RECURSOS, "bin")]:
        for n in (nombre, nombre + ".exe"):
            r = os.path.join(d, n) if d else ""
            if r and os.path.isfile(r) and os.access(r, os.X_OK):
                return r
    return shutil.which(nombre)
