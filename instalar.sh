#!/bin/bash
# Instala (o actualiza) Graba con un solo comando, en Mac o Linux:
#   curl -fsSL https://raw.githubusercontent.com/graba-app/graba/main/instalar.sh | bash
# (En Windows: irm https://raw.githubusercontent.com/graba-app/graba/main/instalar.ps1 | iex)
# Baja la última versión publicada en GitHub, verifica su huella SHA-256 y la instala solo para tu usuario.
# No pide contraseña ni instala nada más: tus grabaciones quedan en ~/Graba y nunca se tocan.
set -euo pipefail
REPO="graba-app/graba"
verde() { printf "\033[32m%s\033[0m\n" "$1"; }
error() { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }
huella() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

SO=$(uname -s)
case "$SO" in
  Darwin)
    [ "$(uname -m)" = "arm64" ] || error "Graba para Mac necesita chip Apple (M1 o posterior)."
    VER=$(sw_vers -productVersion | cut -d. -f1)
    [ "$VER" -ge 15 ] || error "Graba necesita macOS 15 (Sequoia) o posterior. Tienes $(sw_vers -productVersion)."
    ARCHIVO=Graba-macOS.zip ;;
  Linux)
    [ "$(uname -m)" = "x86_64" ] || error "Por ahora Graba para Linux es para procesadores x86_64 (Intel/AMD)."
    ARCHIVO=Graba-Linux.tar.gz ;;
  *) error "Este instalador es para Mac y Linux. En Windows usa: irm https://raw.githubusercontent.com/$REPO/main/instalar.ps1 | iex" ;;
esac

echo "Buscando la última versión de Graba…"
INFO=$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest") || error "No pude consultar GitHub."
# (sin python: en un Mac recién comprado /usr/bin/python3 pide instalar herramientas de Apple)
TAG=$(printf '%s' "$INFO" | tr ',' '\n' | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TAG" ] || error "No encontré una versión publicada."
BASE="https://github.com/$REPO/releases/download/$TAG"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Descargando Graba $TAG…"
curl -fL --progress-bar "$BASE/$ARCHIVO" -o "$TMP/$ARCHIVO" || error "Esta versión aún no tiene descarga para tu sistema."
curl -fsSL "$BASE/$ARCHIVO.sha256" -o "$TMP/$ARCHIVO.sha256"
[ "$(huella "$TMP/$ARCHIVO")" = "$(cut -d' ' -f1 "$TMP/$ARCHIVO.sha256")" ] || error "La descarga no coincide con su huella. No instalé nada."
verde "✓ Descarga verificada"

if [ "$SO" = Darwin ]; then
  ditto -x -k "$TMP/$ARCHIVO" "$TMP/app"
  xattr -dr com.apple.quarantine "$TMP/app/Graba.app" 2>/dev/null || true
  mkdir -p "$HOME/Applications"
  osascript -e 'tell application id "app.graba.mac" to quit' >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$HOME/Applications/Graba.app"
  ditto "$TMP/app/Graba.app" "$HOME/Applications/Graba.app"
  verde "✓ Graba $TAG instalada en ~/Applications"
  open "$HOME/Applications/Graba.app"
else
  DIR="$HOME/.local/share/Graba"
  mkdir -p "$TMP/app" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/256x256/apps"
  tar -xzf "$TMP/$ARCHIVO" -C "$TMP/app" --strip-components=1
  pkill -f "$DIR/graba" 2>/dev/null && sleep 1 || true
  rm -rf "$DIR.anterior"; [ -d "$DIR" ] && mv "$DIR" "$DIR.anterior"
  mv "$TMP/app" "$DIR" && rm -rf "$DIR.anterior"
  # Lanzador: en Ubuntu 24.04+ (y otras) el sandbox de Chromium necesita user namespaces que vienen restringidos.
  cat > "$HOME/.local/bin/graba" <<'LANZADOR'
#!/bin/bash
D="$HOME/.local/share/Graba"
ARGS=()
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] || [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ]; then ARGS+=(--no-sandbox); fi
exec "$D/graba" "${ARGS[@]}" "$@"
LANZADOR
  chmod +x "$HOME/.local/bin/graba"
  cp "$DIR/resources/graba.png" "$HOME/.local/share/icons/hicolor/256x256/apps/graba.png" 2>/dev/null || true
  cat > "$HOME/.local/share/applications/graba.desktop" <<ESCRITORIO
[Desktop Entry]
Type=Application
Name=Graba
Comment=Graba tu pantalla y tu IA te deja notas, guion y subtítulos
Exec=$HOME/.local/bin/graba %U
Icon=graba
Terminal=false
Categories=Office;AudioVideo;
StartupWMClass=Graba
ESCRITORIO
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  true
  verde "✓ Graba $TAG instalada (búscala en tus aplicaciones o escribe: graba)"
  nohup "$HOME/.local/bin/graba" >/dev/null 2>&1 &
fi
echo "Se abrió Graba: el asistente te ayuda a elegir tu IA y descargar el transcriptor."
