#!/usr/bin/env python3
"""Contrato entre la interfaz (ui/app.js y las piezas de ui/) y las apps, sobre el puente de las piezas «host-mac» y «host-escritorio».

Cada host.enviar("x") de la interfaz tiene que estar atendido en cada app por una de tres cosas:
  · lo que trae el host (listo, config, abrirEnlace, copiar y, con la pieza «actualizaciones», buscarActualizacion y actualizar),
  · una acción declarada en acciones.json (lo arma pieza.py con las de las piezas y las de app.json → «acciones»), o
  · lo que registra Graba: `p.registrar("x")` en app/Sources/Graba/*.swift y `ACCIONES` en escritorio/src/main.js (lo nativo).
Además: la vista previa del navegador (simular) responde cada acción; cada window.Graba.x que llaman las apps (y que responden las
declaradas) existe en la interfaz; acciones.json está al día y solo trae lo que Graba usa; y lo que Graba no deja al host (los
videos solo de ~/Graba, las páginas propias solo de su lista, el token de YouTube nunca a la interfaz) sigue igual."""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def leer(r):
    ruta = os.path.join(RAIZ, r)
    if not os.path.exists(ruta):
        return None
    with open(ruta, encoding="utf-8") as f:
        return f.read()


def sin_comentarios(texto):
    """Los ejemplos de los comentarios de las piezas nombran acciones que no existen: no cuentan."""
    return re.sub(r"^\s*(//|///|\*|/\*\*).*$", "", texto or "", flags=re.M)


def de(texto, patron):
    return set(re.findall(patron, sin_comentarios(texto)))


problemas = []
ui = leer("ui/app.js")
acciones = set(re.findall(r'host\.enviar\("(\w+)"', ui))
# Lo que mandan las piezas de la interfaz por su cuenta (componentes: probarIA, buscarActualizacion, actualizar, abrirEnlace, config).
acciones |= set(re.findall(r'\benviar\("(\w+)"', leer("ui/componentes.js") or ""))
# Las respuestas: lo que la interfaz registra con host.responder({...}) (pieza host-ui; queda en window.Graba).
funciones_ui = set(re.findall(r"^\s{4}(?:async\s+)?(\w+)\(", ui.split("host.responder({", 1)[1].split("\n  });", 1)[0], re.M))
simulado = ui.split("function simular(", 1)[1].split("\n  }\n", 1)[0]
casos_web = set(re.findall(r'case "(\w+)"', simulado))
problemas += [f'La vista previa (simular) no responde "{a}"' for a in sorted(acciones - casos_web)]

# ───────────── Las declaradas (acciones.json) ─────────────
app_json = json.loads(leer("app.json"))
acciones_json = json.loads(leer("acciones.json") or "{}").get("acciones") or {}
declaradas = set(acciones_json)
for n, d in (app_json.get("acciones") or {}).items():
    if {k: v for k, v in d.items() if k != "scriptDeLaApp"} != {k: v for k, v in acciones_json.get(n, {}).items() if k != "pieza"}:
        problemas.append(f"acciones.json no está al día con app.json en «{n}»: python3 <pieza>/herramientas/pieza.py acciones .")
for n in app_json.get("sin_acciones") or []:
    if n in declaradas:
        problemas.append(f"acciones.json trae «{n}», que app.json → sin_acciones dice que Graba no adopta: pieza.py acciones .")
for n, d in acciones_json.items():
    if n not in acciones:
        problemas.append(f"acciones.json declara «{n}» y la interfaz nunca la pide (súmala a app.json → sin_acciones)")
    if not os.path.exists(os.path.join(RAIZ, "bin", d.get("script", ""))):
        problemas.append(f'la acción declarada «{n}» usa bin/{d.get("script")}, que no existe')
    if d.get("responde") and d["responde"] not in funciones_ui:
        problemas.append(f'la acción declarada «{n}» responde «{d["responde"]}» y window.Graba no la tiene')
    if not d.get("limite"):
        problemas.append(f"la acción declarada «{n}» no tiene límite de tiempo")

# ───────────── Mac: pieza «host-mac» (app/Sources/PiezaHost) + lo de Graba (app/Sources/Graba) ─────────────
carpeta_swift = os.path.join(RAIZ, "app/Sources/Graba")
swift = "".join(leer(os.path.join("app/Sources/Graba", n)) for n in sorted(os.listdir(carpeta_swift)) if n.endswith(".swift"))
puente_mac = leer("app/Sources/PiezaHost/Puente.swift") or ""
host_mac = de(puente_mac, r'internas\["(\w+)"\]')
registradas_mac = de(swift, r'registrar\("(\w+)"')
atiende_mac = registradas_mac | host_mac | declaradas
problemas += [f'Mac no atiende "{a}" (ni registrada, ni del host, ni declarada)' for a in sorted(acciones - atiende_mac)]
problemas += [f'Mac registra "{a}" y la interfaz nunca la pide' for a in sorted(registradas_mac - acciones)]
problemas += [f'Mac registra "{a}", que ya trae el host o está declarada: sobra' for a in sorted(registradas_mac & (host_mac | declaradas))]
problemas += [f"Mac llama window.Graba.{f} y la interfaz no la tiene" for f in sorted(de(swift + puente_mac, r'llamar\("(\w+)"') - funciones_ui)]
if "p.actualizaciones = .init(" not in swift:
    problemas.append("Mac: las actualizaciones las atiende el host (p.actualizaciones = .init(…), pieza «actualizaciones»)")
if not re.search(r'registrarMedios\("video"\)\s*\{\s*ruta in Rutas\.videoDe\(ruta\)', swift):
    problemas.append("Mac: graba://video solo con Rutas.videoDe (un .mp4 dentro de ~/Graba)")
for patron, que in [
    (r"barraDeMenu: true", "Graba vive en la barra de menú (sin Dock con la ventana cerrada)"),
    (r"abrirAlArrancar: \{ GrabaApp\.faltaAlgo \}", "la ventana se abre al arrancar solo si falta algo"),
    (r"vidrio: true", "la ventana con vidrio (window.GRABA_VIDRIO)"),
    (r'Procesador\.entornoApp\[Host\.prefijo \+ "HERRAMIENTAS"\]', "GRABA_HERRAMIENTAS para todos los scripts"),
]:
    if not re.search(patron, swift):
        problemas.append(f"Mac: {que}")
if 'Secretos(servicio: "Graba")' not in swift:
    problemas.append('Mac: el token de YouTube sigue en el Llavero con el servicio «Graba» (el de siempre)')

# ───────────── Windows y Linux: pieza «host-escritorio» (host.js) + lo de Graba (main.js) ─────────────
main = leer("escritorio/src/main.js")
host_js = leer("escritorio/src/host.js") or ""
host_e = de(host_js, r'internas\.set\("(\w+)"')
registradas_e = set(re.findall(r"^\s{2}(?:async\s+)?(\w+)\s*\(", main.split("const ACCIONES = {", 1)[1].split("\n};", 1)[0], re.M))
atiende_e = registradas_e | host_e | declaradas
problemas += [f'Windows/Linux no atiende "{a}" (ni registrada, ni del host, ni declarada)' for a in sorted(acciones - atiende_e)]
problemas += [f'Windows/Linux registra "{a}" y la interfaz nunca la pide' for a in sorted(registradas_e - acciones)]
problemas += [f'Windows/Linux registra "{a}", que ya trae el host o está declarada: sobra' for a in sorted(registradas_e & (host_e | declaradas))]
# Del host solo cuenta lo que Graba usa (sin carpeta vigilada, el host nunca manda archivoCambiado).
problemas += [f"Windows/Linux llama window.Graba.{f} y la interfaz no la tiene" for f in sorted((de(main, r'llamar\("(\w+)"') | (de(host_js, r'llamar\("(\w+)"') - {"archivoCambiado"})) - funciones_ui)]
if "host.acciones.registrar(nombre, fn)" not in main:
    problemas.append("Windows/Linux: ACCIONES se registra en el host (host.acciones.registrar)")
for patron, que in [
    (r"actualizaciones,\n", "las actualizaciones las atiende el host (pieza «actualizaciones»)"),
    (r'host\.medios\.registrar\("video", \(ruta\) => videoDe\(ruta\)\)', "graba://video solo con videoDe (un video dentro de ~/Graba)"),
    (r'PAGINAS\.has\(ruta\)', "graba://app solo sirve las páginas propias de su lista"),
    (r'alCerrar: "esconder"', "cerrar la ventana la esconde (Graba sigue en la bandeja)"),
    (r'userData: "sistema"', "los datos de Chromium (y la llave de safeStorage en Windows) siguen en la carpeta de siempre"),
    (r'abrirAlArrancar: \(\) => !OCULTA \|\| faltaAlgo\(\)', "con --oculta y todo listo, Graba abre solo en la bandeja"),
]:
    if not re.search(patron, main):
        problemas.append(f"Windows/Linux: {que}")
if 'secretos("tokens", { archivo: ".tokens" })' not in (leer("escritorio/src/servicios.js") or ""):
    problemas.append("Windows/Linux: el token de YouTube sigue en ~/Graba/.graba/.tokens (host.secretos con ese archivo)")
# Las ventanas propias (barra, cuenta, área, burbuja, teleprompter y la grabadora) también con sandbox y contextIsolation.
for m in re.finditer(r"new BrowserWindow\(\{(.*?)\}\)", main, re.S):
    if "sandbox: true" not in m.group(1) or "contextIsolation: true" not in m.group(1) or "nodeIntegration: true" in m.group(1):
        problemas.append("Windows/Linux: una ventana propia sin sandbox o sin contextIsolation")

# ───────────── Nada de lo de antes ─────────────
for viejo in ("app/Sources/Graba/Ventana.swift", "app/Sources/Graba/Actualizaciones.swift", "escritorio/src/rutas.js"):
    if os.path.exists(os.path.join(RAIZ, viejo)):
        problemas.append(f"{viejo} ya no va: lo hace el host")
for archivo, texto in (("servicios.js", leer("escritorio/src/servicios.js") or ""), ("Servicios.swift", leer("app/Sources/Graba/Servicios.swift") or "")):
    if re.search(r"refresh_token[^\n]*llamar|llamar\([^)]*refresh_token", texto):
        problemas.append(f"{archivo}: el token de YouTube nunca va a la interfaz")

if problemas:
    print("✗ Contrato roto:\n  - " + "\n  - ".join(problemas))
    sys.exit(1)
print(f"✓ Contrato: {len(acciones)} acciones (Mac: {len(registradas_mac)} de Graba, Windows/Linux: {len(registradas_e)}; "
      f"{len(declaradas)} declaradas) y {len(funciones_ui)} funciones en orden")
