#!/bin/bash
# Build the frontend and stage the served data for Firebase / static deployment.
#
# What this does:
#   1. Installs frontend dependencies
#   2. Builds the Vite+React frontend to dist/
#   3. Copies the S6 tile output into dist/tiles/       (co-deployed with the app)
#   4. Copies the boundary GeoJSON into dist/boundaries/ (co-deployed with the app)
#
# Both the app fetch paths (/tiles, /boundaries) must resolve to real files under the
# hosting root, or the map 404s. The frontend requests both, so BOTH must be staged.
#
# After running this script, dist/ is ready for:
#   firebase deploy --only hosting
#   OR: npx serve dist/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
OUTPUT_DIR="$SCRIPT_DIR/../output"
TILES_DIR="$OUTPUT_DIR/tiles"
BOUNDARIES_DIR="$OUTPUT_DIR/boundaries"

if [ ! -d "$TILES_DIR" ]; then
  echo "ERROR: Tile directory not found at $TILES_DIR"
  echo "  Run scripts/s6_tile_slicer.py first."
  exit 1
fi

if [ ! -d "$BOUNDARIES_DIR" ]; then
  echo "ERROR: Boundaries directory not found at $BOUNDARIES_DIR"
  echo "  Run scripts/clean_boundaries.py first."
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

# 3. Copy boundaries into dist/boundaries/
DIST_BOUNDARIES="$FRONTEND_DIR/dist/boundaries"
echo "Copying boundaries to dist/boundaries/ ..."
rm -rf "$DIST_BOUNDARIES"
cp -r "$BOUNDARIES_DIR" "$DIST_BOUNDARIES"
echo "  Copied $(ls "$DIST_BOUNDARIES"/*.geojson 2>/dev/null | wc -l) boundary files"
echo "  Total dist/boundaries size: $(du -sh "$DIST_BOUNDARIES" | cut -f1)"

echo ""
echo "Done. Deploy with:"
echo "  firebase deploy --only hosting"
echo "  OR: npx serve $FRONTEND_DIR/dist"
