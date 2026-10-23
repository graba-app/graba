#!/bin/bash
# Compila Graba y la instala en ~/Applications/Graba.app (para desarrollo en este Mac).
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH
RAIZ="$(cd "$(dirname "$0")" && pwd)"
# Cerrar la app en medio de una grabación o un procesamiento los cortaría.
if pgrep -f "bin/procesar.py" >/dev/null && [ "${FORZAR:-0}" != "1" ]; then
  echo "✗ Graba está procesando una grabación. Espera a que termine (o usa FORZAR=1)." >&2; exit 3
fi
if grep -l '"grabando"' "$HOME"/Graba/*/estado.json >/dev/null 2>&1 && pgrep -x Graba >/dev/null && [ "${FORZAR:-0}" != "1" ]; then
  echo "✗ Graba está grabando. Instala cuando termine (o usa FORZAR=1)." >&2; exit 3
fi
bash "$RAIZ/herramientas/empaquetar.sh"
APP="$HOME/Applications/Graba.app"
mkdir -p "$HOME/Applications"
pkill -x Graba 2>/dev/null || true
rm -rf "$APP"
ditto "$RAIZ/dist/Graba.app" "$APP"
echo "Instalada en $APP ($(du -sh "$APP" | cut -f1))"
