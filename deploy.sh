#!/usr/bin/env bash
set -euo pipefail

REMOTE="fjania@labs.digitalanalog.net"
REMOTE_PATH="/home/fjania/sites/labs.digitalanalog.net/web-playground/"

echo "Building..."
npm run build

# Copy DST sub-pages that Vite can't parse (unescaped HTML in code snippets)
cp dst-visualization/about.html dist/dst-visualization/
cp dst-visualization/essay.html dist/dst-visualization/
cp dst-visualization/daylight-*.html dist/dst-visualization/
cp dst-visualization/daylight-*.js dist/dst-visualization/
cp dst-visualization/dst-lib.js dist/dst-visualization/
cp dst-visualization/daylight-style.css dist/dst-visualization/

echo "Deploying to labs.digitalanalog.net/web-playground/..."
rsync -avz --delete dist/ "$REMOTE:$REMOTE_PATH"

echo "Done. https://labs.digitalanalog.net/web-playground/"
