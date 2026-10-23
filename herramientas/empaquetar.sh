#!/bin/bash
# Arma dist/Graba.app (autosuficiente) y dist/Graba-macOS.zip + .sha256, sin instalar nada.
# Lo usan build.sh (en tu Mac) y la acción de GitHub que publica cada versión.
# Dentro van: la app, graba-transcribir + whisper.framework, Python portátil y el código (bin/, ui/) en Contents/Resources/graba.
# Los datos del usuario quedan en ~/Graba.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ/app"
swift build -c release 2>&1 | tee "${GRABA_PROGRESO:-/dev/null}" | tail -20
REL=.build/release

# Python portátil (python-build-standalone): se descarga una vez y se verifica su huella.
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz"
PY_SHA="9e01f63bbb08576cd9c8bc2d0564d098cb30c8453a0cd4bcf6aef458f6d2a147"
PY_TGZ=.build/python-3.13.16.tar.gz
if [ ! -f "$PY_TGZ" ] || [ "$(shasum -a 256 "$PY_TGZ" | cut -d' ' -f1)" != "$PY_SHA" ]; then
  curl -fsSL "$PY_URL" -o "$PY_TGZ.tmp"
  [ "$(shasum -a 256 "$PY_TGZ.tmp" | cut -d' ' -f1)" = "$PY_SHA" ] || { echo "✗ El Python descargado no coincide con su huella" >&2; exit 1; }
  mv "$PY_TGZ.tmp" "$PY_TGZ"
fi

DIST="$RAIZ/dist"; APP="$DIST/Graba.app"
rm -rf "$DIST"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/graba" "$APP/Contents/Frameworks"
cp "$REL/Graba" "$REL/graba-transcribir" "$APP/Contents/MacOS/"
cp Info.plist "$APP/Contents/Info.plist"
[ -f Graba.icns ] && cp Graba.icns "$APP/Contents/Resources/Graba.icns"
ditto "$REL/whisper.framework" "$APP/Contents/Frameworks/whisper.framework"
tar -xzf "$PY_TGZ" -C "$APP/Contents/Resources"   # → Resources/python/bin/python3
for d in bin ui; do ditto "$RAIZ/$d" "$APP/Contents/Resources/graba/$d"; done
find "$APP/Contents/Resources/graba" -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
chmod +x "$APP/Contents/Resources/graba/bin/"*.py

# Firma ad hoc, de adentro hacia afuera. El requisito por identificador conserva los permisos (pantalla, cámara, micrófono) entre versiones.
codesign --force --sign - "$APP/Contents/Frameworks/whisper.framework"
find "$APP/Contents/Resources/python" -type f \( -name "*.so" -o -name "*.dylib" -o -perm -u+x \) -exec codesign --force --sign - {} \; 2>/dev/null || true
codesign --force --sign - "$APP/Contents/MacOS/graba-transcribir"
codesign --force --sign - --requirements '=designated => identifier "app.graba.mac"' "$APP"

cd "$DIST"
ditto -c -k --keepParent Graba.app Graba-macOS.zip
shasum -a 256 Graba-macOS.zip > Graba-macOS.zip.sha256
echo "Listo: $DIST/Graba-macOS.zip ($(du -h Graba-macOS.zip | cut -f1))"
