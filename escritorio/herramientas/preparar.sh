#!/bin/bash
# Arma lo que la app de Windows/Linux lleva adentro, para que el usuario no instale nada:
#   vendor/<linux|win>/python        Python portátil (python-build-standalone, verificado por SHA-256)
#   vendor/<linux|win>/herramientas  whisper-cli (compilado aquí con zig, sin dependencias) y ffmpeg (estático, verificado por SHA-256)
# Uso: bash herramientas/preparar.sh linux|windows
# Necesita: curl, tar, gzip, git, cmake y python3 (para instalar zig con pip). Corre en Linux o macOS.
set -euo pipefail
cd "$(dirname "$0")/.."

SO="${1:?uso: preparar.sh linux|windows}"
case "$SO" in linux) OS=linux ;; windows | win) OS=win ;; *) echo "sistema desconocido: $SO"; exit 1 ;; esac
DESTINO="vendor/$OS"
CACHE="${GRABA_CACHE:-$HOME/.cache/graba-escritorio}"
mkdir -p "$CACHE" "$DESTINO/herramientas"

PY_TAG=20261003; PY_VER=3.13.16
WHISPER_VER=v1.8.3
# ffmpeg estático de ffmpeg-static (github.com/eugeneware/ffmpeg-static, versión fija b6.1.1 = ffmpeg 6.1.1, con libx264).
# Linux: compilación de johnvansickle.com; Windows: de gyan.dev. Licencia GPL (es un programa aparte que la app ejecuta).
# Esas versiones no publican huellas: las de abajo se tomaron al descargarlas y quedan fijas (si el archivo cambia, no se usa).
FFMPEG_VER=b6.1.1
GH=https://github.com
if [ "$OS" = linux ]; then
  PY_ARCH=x86_64-unknown-linux-gnu; PY_SHA=4595c5589fff7bf0cb158d9a88a797e0d791fa33830770fcb7bf3f4b104feeae; EXE=""
  FFMPEG_ARCHIVO=ffmpeg-linux-x64.gz; FFMPEG_SHA=bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa
else
  PY_ARCH=x86_64-pc-windows-msvc; PY_SHA=ec43f1a85c29f147d7ae2d13218c52c70b24a983a82ab22d6c607c0593060e10; EXE=".exe"
  FFMPEG_ARCHIVO=ffmpeg-win32-x64.gz; FFMPEG_SHA=8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77
fi

huella() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
bajar() { # url sha destino
  if [ -f "$3" ] && [ "$(huella "$3")" = "$2" ]; then return; fi
  echo "→ $(basename "$3")"
  curl -fL --retry 3 -o "$3.tmp" "$1"
  [ "$(huella "$3.tmp")" = "$2" ] || { echo "Huella distinta: $1"; rm -f "$3.tmp"; exit 1; }
  mv "$3.tmp" "$3"
}

# ── Python portátil ──
PY_ARCHIVO="cpython-$PY_VER+$PY_TAG-$PY_ARCH-install_only_stripped.tar.gz"
bajar "$GH/astral-sh/python-build-standalone/releases/download/$PY_TAG/${PY_ARCHIVO//+/%2B}" "$PY_SHA" "$CACHE/$PY_ARCHIVO"
rm -rf "$DESTINO/python" "$DESTINO/python.tmp"; mkdir -p "$DESTINO/python.tmp"
tar -xzf "$CACHE/$PY_ARCHIVO" -C "$DESTINO/python.tmp"
mv "$DESTINO/python.tmp/python" "$DESTINO/python"; rmdir "$DESTINO/python.tmp"
# Más liviano: sin pruebas, tkinter, idle ni encabezados (Graba solo usa la biblioteca estándar).
for d in lib/python3.13/test lib/python3.13/idlelib lib/python3.13/tkinter lib/python3.13/turtledemo lib/python3.13/site-packages lib/tcl9.0 lib/tk9.0 \
         Lib/test Lib/idlelib Lib/tkinter Lib/turtledemo Lib/site-packages Lib/venv include share tcl libs; do rm -rf "$DESTINO/python/$d"; done
find "$DESTINO/python" \( -name "*.pdb" -o -name "__pycache__" -o -name "libtcl*" -o -name "libtk*" -o -name "_tkinter*" \) -prune -exec rm -rf {} +
rm -f "$DESTINO/python/bin/"{idle3*,pip*,pydoc3*,python3*-config} 2>/dev/null || true

# ── ffmpeg (convierte la grabación de Chromium a video.mp4 H.264/AAC y saca el audio.wav de 16 kHz) ──
bajar "$GH/eugeneware/ffmpeg-static/releases/download/$FFMPEG_VER/$FFMPEG_ARCHIVO" "$FFMPEG_SHA" "$CACHE/$FFMPEG_VER-$FFMPEG_ARCHIVO"
gzip -dc "$CACHE/$FFMPEG_VER-$FFMPEG_ARCHIVO" > "$DESTINO/herramientas/ffmpeg$EXE"

# ── whisper-cli: compilado con zig → un solo ejecutable sin dependencias (Linux: glibc 2.28+; Windows 10+) ──
if [ ! -x "$CACHE/whisper-$OS/whisper-cli$EXE" ]; then
  python3 -m ziglang version >/dev/null 2>&1 || python3 -m pip install --user --break-system-packages -q ziglang 2>/dev/null || python3 -m pip install --user -q ziglang
  [ -d "$CACHE/whisper.cpp" ] || git clone -q --depth 1 --branch "$WHISPER_VER" https://github.com/ggml-org/whisper.cpp "$CACHE/whisper.cpp"
  Z="$CACHE/zig-$OS"; mkdir -p "$Z"
  OBJETIVO=$([ "$OS" = linux ] && echo x86_64-linux-gnu.2.28 || echo x86_64-windows-gnu)
  for h in cc c++; do printf '#!/bin/bash\nexec python3 -m ziglang %s -target %s "$@"\n' "$h" "$OBJETIVO" > "$Z/$h"; done
  for h in ar ranlib; do printf '#!/bin/bash\nexec python3 -m ziglang %s "$@"\n' "$h" > "$Z/$h"; done
  chmod +x "$Z"/*
  EXTRA=(); [ "$OS" = win ] && EXTRA=(-DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 -DCMAKE_RC_COMPILER=/bin/true)
  rm -rf "$CACHE/whisper.cpp/build-$OS"
  cmake -S "$CACHE/whisper.cpp" -B "$CACHE/whisper.cpp/build-$OS" "${EXTRA[@]}" -DCMAKE_C_COMPILER="$Z/cc" -DCMAKE_CXX_COMPILER="$Z/c++" \
    -DCMAKE_AR="$Z/ar" -DCMAKE_RANLIB="$Z/ranlib" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_BACKEND_DL=OFF \
    -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON -DGGML_OPENMP=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF > "$CACHE/whisper-cmake.log"
  cmake --build "$CACHE/whisper.cpp/build-$OS" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)" --target whisper-cli > "$CACHE/whisper-build.log"
  mkdir -p "$CACHE/whisper-$OS"
  cp "$CACHE/whisper.cpp/build-$OS/bin/whisper-cli$EXE" "$CACHE/whisper-$OS/"
fi
cp "$CACHE/whisper-$OS/whisper-cli$EXE" "$DESTINO/herramientas/"
if [ "$OS" = linux ]; then chmod +x "$DESTINO/herramientas/"*; strip "$DESTINO/herramientas/whisper-cli" 2>/dev/null || true; fi

echo "Listo: $DESTINO ($(du -sh "$DESTINO" | cut -f1))"
