#!/bin/bash
# Build the frontend and stage tiles for Firebase / static deployment.
#
# What this does:
#   1. Installs frontend dependencies
#   2. Builds the Vite+React frontend to dist/
#   3. Copies the S6 tile output into dist/tiles/ (co-deployed with the app)
#
# After running this script, dist/ is ready for:
#   firebase deploy --only hosting
#   OR: npx serve dist/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
OUTPUT_DIR="$SCRIPT_DIR/../output"
TILES_DIR="$OUTPUT_DIR/tiles"

if [ ! -d "$TILES_DIR" ]; then
  echo "ERROR: Tile directory not found at $TILES_DIR"
  echo "  Run scripts/s6_tile_slicer.py first."
  exit 1
fi

echo "=== Ugnay — Prepare Deploy ==="

# 1. Build frontend
echo "Building frontend..."
cd "$FRONTEND_DIR"
npm install --silent
npm run build
echo "  Built to: $FRONTEND_DIR/dist"

# 2. Copy tiles into dist/tiles/
DIST_TILES="$FRONTEND_DIR/dist/tiles"
echo "Copying tiles to dist/tiles/ ..."
rm -rf "$DIST_TILES"
cp -r "$TILES_DIR" "$DIST_TILES"
echo "  Copied $(ls "$DIST_TILES"/*.json 2>/dev/null | wc -l) tile files"
echo "  Total dist/tiles size: $(du -sh "$DIST_TILES" | cut -f1)"

echo ""
echo "Done. Deploy with:"
echo "  firebase deploy --only hosting"
echo "  OR: npx serve $FRONTEND_DIR/dist"
