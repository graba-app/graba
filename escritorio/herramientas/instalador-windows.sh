#!/bin/bash
# Arma dist/Graba-Windows.exe (instalador) y su .sha256 a partir de dist/win-unpacked (electron-builder --win dir).
# Necesita makensis (Ubuntu/Debian: apt install nsis; Mac: brew install makensis).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p 'require("./package.json").version')
[ -d dist/win-unpacked ] || { echo "Falta dist/win-unpacked: corre electron-builder --win dir"; exit 1; }
makensis -V2 -DVERSION="$VERSION" -DORIGEN="$PWD/dist/win-unpacked" -DICONO="$PWD/iconos/graba.ico" -DSALIDA="$PWD/dist/Graba-Windows.exe" herramientas/instalador.nsi
(cd dist && sha256sum Graba-Windows.exe > Graba-Windows.exe.sha256)
echo "Listo: dist/Graba-Windows.exe ($(du -h dist/Graba-Windows.exe | cut -f1))"
