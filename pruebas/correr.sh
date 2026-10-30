#!/bin/bash
# Todas las pruebas que no necesitan un Mac (las mismas que corre GitHub en cada cambio).
# Uso: bash pruebas/correr.sh   (la interfaz necesita Playwright: PLAYWRIGHT=/ruta/a/playwright si no está en node_modules)
set -e
cd "$(dirname "$0")/.."
echo "Sintaxis"; node --check ui/app.js; node --check ui/i18n.js; python3 -m py_compile bin/*.py; [ -f escritorio/src/main.js ] && node --check escritorio/src/main.js
echo "Privacidad"; bash herramientas/revisar_privacidad.sh --generico
echo "Contrato"; python3 pruebas/contrato.py
echo "Python"; python3 pruebas/test_python.py 2>&1 | tail -3
echo "Interfaz"; node pruebas/interfaz.mjs
