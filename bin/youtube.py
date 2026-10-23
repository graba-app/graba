#!/usr/bin/env python3
"""Sube una grabación a YouTube con la cuenta del usuario (sin servidores de Graba en el medio). Solo biblioteca estándar.

Uso:
  youtube.py conectar <salida.json>          Abre el navegador para autorizar (OAuth con PKCE y redirección local) y devuelve
                                             {"ok", "refresh_token", "canal", "canal_id"}. La app guarda el token en el Llavero.
  youtube.py subir <carpeta> <salida.json>   Sube video.mp4 con título, descripción + capítulos, etiquetas y privacidad; después
                                             los subtítulos. Necesita GRABA_YT_TOKEN (el token guardado) en el entorno.
                                             Deja el avance en <carpeta>/youtube.json y al final {"ok", "id", "url"}.
Cliente OAuth: el del proyecto (bin/youtube_cliente.json) o el propio de la persona (config: youtube_client_id / youtube_client_secret).
En apps de escritorio Google no trata el "secreto" del cliente como secreto: va en el código, como en cualquier app instalada.
"""
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ia  # noqa: E402
import procesar  # noqa: E402

# Cliente OAuth de escritorio del proyecto Graba (bin/youtube_cliente.json; vacío hasta que se cree en Google Cloud).
try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "youtube_cliente.json"), encoding="utf-8") as _f:
        CLIENTE = json.load(_f)
except (OSError, ValueError):
    CLIENTE = {"id": "", "secreto": ""}
ALCANCES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/youtube/v3"
SUBIDA = "https://www.googleapis.com/upload/youtube/v3"
TROZO = 8 * 1024 * 1024
PRIVACIDADES = ("private", "unlisted", "public")


def cliente():
    c = ia.config()
    return (c.get("youtube_client_id") or CLIENTE["id"]).strip(), (c.get("youtube_client_secret") or CLIENTE["secreto"]).strip()


def pedir(url, datos=None, metodo=None, cabeceras=None, token=None, timeout=60):
    """(código, cuerpo como dict o texto, cabeceras). Nunca lanza por errores HTTP: los devuelve."""
    cab = dict(cabeceras or {})
    if token:
        cab["Authorization"] = f"Bearer {token}"
    if isinstance(datos, dict):
        datos = json.dumps(datos).encode()
        cab.setdefault("Content-Type", "application/json; charset=UTF-8")
    req = urllib.request.Request(url, data=datos, method=metodo, headers=cab)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            cuerpo, codigo, hdr = r.read(), r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        cuerpo, codigo, hdr = e.read(), e.code, dict(e.headers)
    try:
        return codigo, json.loads(cuerpo or b"{}"), hdr
    except ValueError:
        return codigo, cuerpo.decode("utf-8", "replace"), hdr


def mensaje_error(cuerpo):
    if isinstance(cuerpo, dict):
        e = cuerpo.get("error")
        if isinstance(e, dict):
            razones = [x.get("reason", "") for x in e.get("errors", [])]
            if "quotaExceeded" in razones:
                return "YouTube no acepta más subidas por hoy desde Graba (límite diario de la API). Intenta mañana."
            if "uploadLimitExceeded" in razones:
                return "Tu canal llegó al límite de subidas de hoy. Intenta mañana."
            return e.get("message") or str(razones)
        return cuerpo.get("error_description") or str(e or cuerpo)
    return str(cuerpo)[:300]


# ───────────── Conectar ─────────────
def conectar(salida):
    cid, secreto = cliente()
    if not cid:
        return procesar.guardar_json(salida, {"ok": False, "error": "Esta versión de Graba todavía no tiene la conexión con YouTube activada."})
    verificador = secrets.token_urlsafe(64)
    reto = base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).rstrip(b"=").decode()
    estado = secrets.token_urlsafe(16)
    recibido = {}

    class Respuesta(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == estado:
                recibido.update({k: v[0] for k, v in q.items()})
            ok = "code" in recibido
            html = ("<h2>Listo ✓</h2><p>Tu canal quedó conectado. Ya puedes volver a Graba.</p>" if ok
                    else "<h2>No se conectó</h2><p>Puedes cerrar esta pestaña y volver a intentarlo desde Graba.</p>")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"<!doctype html><meta charset=utf-8><body style='font:16px system-ui;text-align:center;padding:60px'>{html}".encode())

        def log_message(self, *a):
            pass

    servidor = http.server.HTTPServer(("127.0.0.1", 0), Respuesta)
    redireccion = f"http://127.0.0.1:{servidor.server_port}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redireccion, "response_type": "code", "scope": ALCANCES, "state": estado,
        "code_challenge": reto, "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent"})
    hilo = threading.Thread(target=lambda: [servidor.handle_request() for _ in range(3) if "code" not in recibido and "error" not in recibido])
    hilo.daemon = True
    hilo.start()
    webbrowser.open(url)
    hilo.join(timeout=300)
    servidor.server_close()
    if "code" not in recibido:
        return procesar.guardar_json(salida, {"ok": False, "error": "No se completó la autorización en el navegador."})
    codigo, r, _ = pedir(TOKEN_URL, urllib.parse.urlencode({
        "code": recibido["code"], "client_id": cid, "client_secret": secreto, "redirect_uri": redireccion,
        "grant_type": "authorization_code", "code_verifier": verificador}).encode(),
        cabeceras={"Content-Type": "application/x-www-form-urlencoded"})
    if codigo != 200 or "refresh_token" not in r:
        return procesar.guardar_json(salida, {"ok": False, "error": "Google no entregó el permiso: " + mensaje_error(r)})
    c2, canales, _ = pedir(f"{API}/channels?part=snippet&mine=true", token=r["access_token"])
    item = (canales.get("items") or [{}])[0] if isinstance(canales, dict) else {}
    procesar.guardar_json(salida, {"ok": True, "refresh_token": r["refresh_token"],
                                   "canal": item.get("snippet", {}).get("title", ""), "canal_id": item.get("id", "")})


# ───────────── Subir ─────────────
def token_de_acceso():
    refresco = os.environ.get("GRABA_YT_TOKEN", "")
    cid, secreto = cliente()
    if not refresco or not cid:
        raise RuntimeError("Conecta tu canal de YouTube en Ajustes.")
    codigo, r, _ = pedir(TOKEN_URL, urllib.parse.urlencode({"refresh_token": refresco, "client_id": cid, "client_secret": secreto,
                                                            "grant_type": "refresh_token"}).encode(),
                         cabeceras={"Content-Type": "application/x-www-form-urlencoded"})
    if codigo != 200:
        raise RuntimeError("El permiso de YouTube venció o se quitó. Vuelve a conectar tu canal en Ajustes.")
    return r["access_token"]


def metadatos(carpeta):
    """Título, descripción (con capítulos) y etiquetas desde grabacion.md (formato en el README)."""
    with open(os.path.join(carpeta, "grabacion.md"), encoding="utf-8") as f:
        md = f.read()
    secciones = {}
    for parte in ("\n" + md).split("\n### ")[1:]:
        nombre, _, cuerpo = parte.partition("\n")
        secciones[nombre.strip()] = cuerpo.split("\n## ", 1)[0].strip()
    t = re.search(r"^# (.+)$", md, re.M)
    titulos = [re.sub(r"^\s*(\d+[.)]|[-*•])\s*", "", l).strip() for l in secciones.get("Títulos", "").splitlines() if l.strip()]
    titulo = (titulos[0] if titulos else (t.group(1) if t else "Video"))[:100]
    descripcion = "\n\n".join(x for x in (secciones.get("Descripción", ""), secciones.get("Capítulos", "")) if x)
    etiquetas, total = [], 0
    for e in (x.strip() for x in secciones.get("Etiquetas", "").replace("\n", ",").split(",")):
        if e and total + len(e) + 2 <= 480:  # YouTube admite hasta 500 caracteres en total
            etiquetas.append(e[:60])
            total += len(e) + 2
    return titulo, re.sub(r"[<>]", "", descripcion)[:4900], etiquetas


def subir(carpeta, salida):
    video = os.path.join(carpeta, "video.mp4")
    estado_ruta = os.path.join(carpeta, "youtube.json")

    def avance(**d):
        procesar.guardar_json(estado_ruta, d)

    try:
        if not os.path.exists(video):
            raise RuntimeError("No encontré el video de esta grabación.")
        c = ia.config()
        privacidad = c.get("youtube_privacidad") if c.get("youtube_privacidad") in PRIVACIDADES else "private"
        idioma = (c.get("idioma_audio") or "es") if (c.get("idioma_audio") or "auto") != "auto" else "es"
        titulo, descripcion, etiquetas = metadatos(carpeta)
        avance(estado="subiendo", pct=0)
        token = token_de_acceso()
        tam = os.path.getsize(video)
        cuerpo = {"snippet": {"title": titulo, "description": descripcion, "tags": etiquetas, "categoryId": str(c.get("youtube_categoria") or "27"),
                              "defaultLanguage": idioma, "defaultAudioLanguage": idioma},
                  "status": {"privacyStatus": privacidad, "selfDeclaredMadeForKids": False}}
        codigo, r, hdr = pedir(f"{SUBIDA}/videos?uploadType=resumable&part=snippet,status", cuerpo, "POST",
                               {"X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(tam)}, token)
        destino = hdr.get("Location") or hdr.get("location")
        if codigo != 200 or not destino:
            raise RuntimeError(mensaje_error(r))
        enviado, resultado = 0, None
        with open(video, "rb") as f:
            while enviado < tam:
                trozo = f.read(TROZO)
                fin = enviado + len(trozo) - 1
                codigo, r, hdr = pedir(destino, trozo, "PUT", {"Content-Length": str(len(trozo)), "Content-Range": f"bytes {enviado}-{fin}/{tam}"},
                                       token, timeout=600)
                if codigo in (200, 201):
                    resultado = r
                    enviado = tam
                elif codigo == 308:
                    rango = hdr.get("Range") or hdr.get("range") or f"bytes=0-{fin}"
                    enviado = int(rango.split("-")[-1]) + 1
                    f.seek(enviado)
                else:
                    raise RuntimeError(mensaje_error(r))
                avance(estado="subiendo", pct=round(enviado / tam * 95))
        vid = resultado.get("id")
        if not vid:
            raise RuntimeError("YouTube no devolvió el video.")
        # Subtítulos (si fallan, el video queda igual: se avisa sin perderlo).
        aviso = ""
        srt = os.path.join(carpeta, "subtitulos.srt")
        if os.path.exists(srt) and os.path.getsize(srt) > 0:
            limite = "graba" + secrets.token_hex(8)
            partes = (f"--{limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                      + json.dumps({"snippet": {"videoId": vid, "language": idioma, "name": ""}})
                      + f"\r\n--{limite}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + open(srt, "rb").read() + f"\r\n--{limite}--\r\n".encode()
            codigo, r, _ = pedir(f"{SUBIDA}/captions?uploadType=multipart&part=snippet", partes, "POST",
                                 {"Content-Type": f"multipart/related; boundary={limite}"}, token, timeout=120)
            if codigo not in (200, 201):
                aviso = "El video se subió, pero los subtítulos no: " + mensaje_error(r)
        url = f"https://youtu.be/{vid}"
        avance(estado="lista", id=vid, url=url, privacidad=privacidad, fecha=datetime.now().isoformat(timespec="seconds"), aviso=aviso)
        # Queda anotado en la grabación (campo "youtube" del frontmatter).
        md_ruta = os.path.join(carpeta, "grabacion.md")
        with open(md_ruta, encoding="utf-8") as f:
            md = f.read()
        if md.startswith("---\n") and "\nyoutube:" not in md.split("\n---\n", 1)[0]:
            md = md.replace("\ntags:", f"\nyoutube: {url}\ntags:", 1)
            with open(md_ruta, "w", encoding="utf-8") as f:
                f.write(md)
        procesar.guardar_json(salida, {"ok": True, "id": vid, "url": url, "privacidad": privacidad, "aviso": aviso, "carpeta": carpeta})
    except Exception as e:  # noqa: BLE001
        avance(estado="error", error=str(e))
        procesar.guardar_json(salida, {"ok": False, "error": str(e), "carpeta": carpeta})


def main():
    a = sys.argv[1:]
    if len(a) == 2 and a[0] == "conectar":
        return conectar(a[1])
    if len(a) == 3 and a[0] == "subir":
        return subir(os.path.abspath(a[1]), a[2])
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
