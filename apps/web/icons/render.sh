#!/bin/sh
# Renders the app icons into public/ (run from apps/web): headless Chrome draws each SVG
# at 512px, ImageMagick scales it down. Set CHROME if it isn't at the macOS default path.
set -e
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
render() {
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=512,512 \
    --screenshot="$PWD/public/$2" "file://$PWD/icons/$1" 2>/dev/null
}
render icon.svg icon-512.png
render icon-maskable.svg icon-maskable-512.png
magick public/icon-512.png -resize 192x192 public/icon-192.png
# iOS rounds the corners itself and shows transparency as black, so it gets the full-bleed icon.
magick public/icon-maskable-512.png -resize 180x180 public/apple-touch-icon.png
