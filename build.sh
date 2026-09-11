#!/bin/sh
# Минификация статики: assets/site.js → site.min.js, site.css → site.min.css, intro.css → intro.min.css.
# Запускать после правок в assets/*.js|css (страницы подключают .min-файлы). Нужен Node: npx подтянет esbuild сам.
set -e
cd "$(dirname "$0")"
NPX=npx; [ -x "$HOME/.nvm/versions/node/v20.20.2/bin/npx" ] && NPX="$HOME/.nvm/versions/node/v20.20.2/bin/npx"
# если esbuild уже скачан npx — берём его напрямую, без похода в сеть
EB=$(ls -d "$HOME"/.npm/_npx/*/node_modules/.bin/esbuild 2>/dev/null | head -1)
if [ -n "$EB" ]; then run() { "$EB" "$@"; }; else run() { $NPX --yes esbuild@0.23.1 "$@"; }; fi
run assets/site.js --minify --target=es2015 --charset=utf8 --outfile=assets/site.min.js --log-level=warning
run assets/site.css --minify --charset=utf8 --outfile=assets/site.min.css --log-level=warning
run assets/intro.css --minify --charset=utf8 --outfile=assets/intro.min.css --log-level=warning
ls -la assets/site.js assets/site.min.js assets/site.css assets/site.min.css assets/intro.css assets/intro.min.css | awk '{printf "%7d %s\n", $5, $9}'
