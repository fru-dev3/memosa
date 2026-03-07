#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="/Applications/Memosa.app"
BUILT_APP_PATH="$ROOT_DIR/target/debug/bundle/macos/Memosa.app"
BACKUP_PATH="/Applications/Memosa.app.prev-$(date +%Y%m%d-%H%M%S)"

cd "$ROOT_DIR"

npm run tauri build -- --debug --bundles app

pkill -x Memosa || true
pkill -f '/Applications/Memosa.app' || true
pkill -f "$ROOT_DIR/target/debug/memosa" || true

if [[ -d "$APP_PATH" ]]; then
  mv "$APP_PATH" "$BACKUP_PATH"
fi

cp -R "$BUILT_APP_PATH" "$APP_PATH"

open -a "$APP_PATH"

echo "Installed and relaunched $APP_PATH"
