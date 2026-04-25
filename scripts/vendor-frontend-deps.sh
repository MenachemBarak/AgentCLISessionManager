#!/usr/bin/env bash
# Re-vendor the frontend's CDN deps into backend/frontend/vendor/.
#
# Why this exists: the frontend used to <script src="https://unpkg.com/...">
# every dep at runtime, which black-screened the app whenever DNS was
# down (PC restart, captive portal, offline). All deps now ship inside
# the wheel + PyInstaller bundle. To bump a pin, edit the URL list and
# re-run this script — commit the diff under backend/frontend/vendor/.
#
# Usage:  bash scripts/vendor-frontend-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/backend/frontend/vendor"
mkdir -p "$VENDOR"

declare -A DEPS=(
  [react.development.js]="https://unpkg.com/react@18.3.1/umd/react.development.js"
  [react-dom.development.js]="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"
  [babel.min.js]="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"
  [xterm.js]="https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js"
  [xterm.css]="https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css"
  [addon-fit.js]="https://unpkg.com/@xterm/addon-fit@0.10.0/lib/addon-fit.js"
  [addon-web-links.js]="https://unpkg.com/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js"
)

for name in "${!DEPS[@]}"; do
  url="${DEPS[$name]}"
  echo "→ $name  ←  $url"
  curl -sSfL -o "$VENDOR/$name" "$url"
done

echo "Done. Vendored into $VENDOR"
ls -la "$VENDOR"
