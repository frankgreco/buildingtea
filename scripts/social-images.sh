#!/bin/sh
# Regenerate the committed social preview PNGs. Requires librsvg's rsvg-convert.
set -eu
cd "$(dirname "$0")/.."

rsvg-convert design/og-image.svg -o web/public/og-image.png
rsvg-convert web/public/favicon.svg -w 420 -h 420 \
  --page-width 600 --page-height 600 --left 90 --top 90 \
  -b '#fff3df' -o web/public/og-image-square.png
