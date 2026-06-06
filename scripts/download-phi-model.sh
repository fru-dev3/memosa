#!/usr/bin/env bash
# Downloads the Phi-3.5 Mini Q4_K_M model for Memosa.
# Saves to both:
#   1. src-tauri/models/   — picked up by Tauri bundle (DMG / App Store)
#   2. ~/.memosa/models/   — used by dev builds (npm run tauri dev)

set -euo pipefail

MODEL_FILENAME="phi-3.5-mini-q4.gguf"
# bartowski's Phi-3.5-mini-instruct quants (MIT license, Q4_K_M ~2.2 GB)
MODEL_URL="https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/../src-tauri/models"
DEV_DIR="$HOME/.memosa/models"

mkdir -p "$BUNDLE_DIR" "$DEV_DIR"

BUNDLE_PATH="$BUNDLE_DIR/$MODEL_FILENAME"
DEV_PATH="$DEV_DIR/$MODEL_FILENAME"

# Download to bundle dir if not present
if [ -f "$BUNDLE_PATH" ]; then
  echo "✓ Model already at $BUNDLE_PATH"
else
  echo "Downloading Phi-3.5 Mini Q4_K_M (~2.2 GB)..."
  curl -L --progress-bar -o "$BUNDLE_PATH" "$MODEL_URL"
  echo "✓ Saved to $BUNDLE_PATH"
fi

# Symlink or copy to dev dir
if [ ! -f "$DEV_PATH" ]; then
  ln -sf "$BUNDLE_PATH" "$DEV_PATH"
  echo "✓ Linked to $DEV_PATH"
else
  echo "✓ Model already at $DEV_PATH"
fi

echo ""
echo "Done. Model is ready for both dev and production builds."
