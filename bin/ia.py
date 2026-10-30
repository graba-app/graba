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


#: Claude Code sin servidores MCP y sin herramientas (o, si hay archivos adjuntos, solo «Read» para leer sus copias en la
#: carpeta temporal). Así, aunque una transcripción o un archivo traiga instrucciones escondidas («prompt injection»), la IA
#: no puede ejecutar comandos, cambiar archivos ni usar otras cuentas conectadas: solo responde con texto.
def claude_solo_texto(con_archivos=False):
    return ["--strict-mcp-config", "--tools", "Read" if con_archivos else ""]  # --tools al final: acepta varios valores


#: Claude Code carga la memoria de la persona (CLAUDE.md, memoria automática) aunque corra sin herramientas. Esto la apaga.
SIN_MEMORIA_CLAUDE = {"CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
#: Antigravity no lee la entrada estándar: el pedido va en instrucciones.md y en -p solo va esta frase fija.
INSTRUCCION_ARCHIVO = ("Lee el archivo instrucciones.md de esta carpeta (y el material que menciona) y haz exactamente lo que pide. "
                       "Entrega solo el resultado pedido, sin comentarios. No modifiques ni crees archivos.")
_ayuda = {}


def es_agy(cmd=None):
    return os.path.basename(cmd or COMANDO).lower().split(".")[0] in ("agy", "antigravity")


ES_AGY = es_agy()


def _soporta(cmd, opcion):
    """Si el CLI conoce una opción. Se pregunta `--help` una vez por comando; nunca se reintenta quitando protecciones."""
    try:
        e = os.stat(cmd)
        clave = (cmd, e.st_mtime_ns, e.st_size)  # si el CLI se actualiza, se vuelve a preguntar
    except OSError:
        clave = (cmd,)
    if clave not in _ayuda:
        try:
            r = subprocess.run([cmd, "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, env=_entorno())
            _ayuda[clave] = (r.stdout or "") + (r.stderr or "")
        except (OSError, subprocess.SubprocessError):
            _ayuda[clave] = ""
    return opcion in _ayuda[clave]


def _entorno():
    """La IA no recibe las variables de Graba (rutas, modos de prueba): solo lo necesario para correr."""
    return {k: v for k, v in os.environ.items() if not k.upper().startswith("GRABA_")}


def nombre_copia(k, ruta):
    """Nombre de la copia de un archivo adjunto en la carpeta de la IA (k desde 0): material-1.pdf, material-2.png…"""
    return f"material-{k + 1}{os.path.splitext(ruta)[1].lower()}"


def _sin_proteccion(cmd, falta):
    """Un CLI viejo que no conoce una protección no se usa sin ella: se avisa para que la persona lo actualice."""
    return subprocess.CompletedProcess(cmd, 1, "", f"Actualiza {NOMBRE_IA} para usarla con Graba (no conoce {falta})")


def ejecutar_ia(prompt, timeout=900, archivos=()):
    """Le pasa el prompt a la IA del usuario y devuelve un CompletedProcess (stdout = respuesta).
    Corre en una carpeta temporal y en modo solo lectura: la IA ve solo el texto que le damos y, si se indican, copias de
    los archivos que la persona adjuntó (material-1.pdf…, ver nombre_copia). El pedido nunca va como argumento del proceso
    (cualquier programa del computador puede ver los argumentos): va por la entrada estándar o en un archivo."""
    entorno = _entorno()
    with tempfile.TemporaryDirectory(prefix="graba-ia-") as tmp:
        for k, a in enumerate(archivos):
            try:
                shutil.copy2(a, os.path.join(tmp, nombre_copia(k, a)))
            except OSError:
                pass
        if IA == "codex":
            salida = os.path.join(tmp, "respuesta.txt")
            cmd = [COMANDO, "exec", "--skip-git-repo-check", "-s", "read-only", "-C", tmp, "-o", salida, "-"]
            r = subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=entorno)
            texto = open(salida, encoding="utf-8").read() if os.path.exists(salida) else ""
            return subprocess.CompletedProcess(cmd, r.returncode, texto, r.stderr)
        if IA == "gemini" and es_agy():
            # Siempre en un archivo (también los pedidos cortos): en -p solo va una frase fija.
            with open(os.path.join(tmp, "instrucciones.md"), "w", encoding="utf-8") as f:
                f.write(prompt)
            cmd = [COMANDO, "--output-format", "text", "--sandbox", "--add-dir", tmp, "-p", INSTRUCCION_ARCHIVO]
            return subprocess.run(cmd, stdin=subprocess.DEVNULL, text=True, encoding="utf-8", capture_output=True, timeout=timeout,
                                  cwd=tmp, env=entorno)
        if IA == "gemini":
            cmd = [COMANDO, "-p", "Responde a las instrucciones de arriba. Entrega solo el resultado pedido.", "-o", "text"]
            return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp, env=entorno)
        # Claude Code: sin MCP, sin herramientas (o solo Read) y sin la memoria de la persona. Si no conoce una protección, no corre.
        cmd = [COMANDO, "-p", "--output-format", "text"]
        for opcion in ("--strict-mcp-config", "--tools"):
            if not _soporta(COMANDO, opcion):
                return _sin_proteccion(cmd, opcion)
        if _soporta(COMANDO, "--safe-mode"):
            cmd.append("--safe-mode")
        cmd += claude_solo_texto(bool(archivos))
        return subprocess.run(cmd, input=prompt, text=True, encoding="utf-8", capture_output=True, timeout=timeout, cwd=tmp,
                              env={**entorno, **SIN_MEMORIA_CLAUDE})


def herramienta(nombre):
    """Busca un binario: dentro de la app (GRABA_HERRAMIENTAS), en bin/ del código o en el sistema."""
    for d in [os.environ.get("GRABA_HERRAMIENTAS", ""), os.path.join(RECURSOS, "bin")]:
        for n in (nombre, nombre + ".exe"):
            r = os.path.join(d, n) if d else ""
            if r and os.path.isfile(r) and os.access(r, os.X_OK):
                return r
    return shutil.which(nombre)
