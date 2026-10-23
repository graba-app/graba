#!/usr/bin/env python3
"""Contrato entre la interfaz (ui/app.js) y las apps: cada host.enviar("x") de la interfaz debe existir en Mac (Ventana.swift)
y, cuando exista, en Windows/Linux (escritorio/src/main.js, objeto ACCIONES). Y cada window.Graba.x que llaman las apps debe existir."""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
leer = lambda r: open(os.path.join(RAIZ, r), encoding="utf-8").read() if os.path.exists(os.path.join(RAIZ, r)) else None
ui = leer("ui/app.js")
acciones = set(re.findall(r'host\.enviar\("(\w+)"', ui))
funciones_ui = set(re.findall(r"^\s{4}(?:async\s+)?(\w+)\(", ui.split("window.Graba = {", 1)[1].split("\n  };", 1)[0], re.M))
problemas = []
mac = leer("app/Sources/Graba/Ventana.swift")
casos_mac = set(re.findall(r'case "(\w+)"', mac))
problemas += [f'Mac (Ventana.swift) no atiende la acción "{a}"' for a in sorted(acciones - casos_mac)]
problemas += [f'Mac llama window.Graba.{f} y la interfaz no la tiene' for f in sorted(set(re.findall(r'llamar\("(\w+)"', mac)) - funciones_ui)]
escritorio = leer("escritorio/src/main.js")
if escritorio:
    casos_e = set(re.findall(r"^\s{2}(?:async\s+)?(\w+)\s*\(", escritorio.split("const ACCIONES = {", 1)[1].split("\n};", 1)[0], re.M))
    problemas += [f'Windows/Linux (ACCIONES) no atiende la acción "{a}"' for a in sorted(acciones - casos_e)]
    problemas += [f'Windows/Linux llama window.Graba.{f} y la interfaz no la tiene' for f in sorted(set(re.findall(r'llamar\("(\w+)"', escritorio)) - funciones_ui)]
if problemas:
    print("✗ Contrato roto:\n  - " + "\n  - ".join(problemas))
    sys.exit(1)
print(f"✓ Contrato: {len(acciones)} acciones y {len(funciones_ui)} funciones en orden")
