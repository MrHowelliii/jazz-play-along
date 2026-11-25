#!/usr/bin/env bash
set -euo pipefail
root=$(pwd)
site="$root/site"
mkdir -p "$site/engine/packs"
cp index.html player.js studio.css "$site/"
cp catalog/app/songform.js "$site/"
cp -R catalog/{app,books,leads,vendor} "$site/"
cp catalog/{books.json,songs.json,practice.html} "$site/"
cp catalog/engine/worklet.js "$site/engine/"
cp upstream/{LICENSE,NOTICE,UPSTREAM-NOTICE} "$site/engine/"
cp "upstream/sound packs/CREDITS.md" "$site/engine/packs/"
cd upstream/jazzband-op1r
sh web/build.sh
mkdir -p web/packs
for pack in jbdrums jbbass jbpiano jbguitar; do
  cp "$root/catalog/engine/packs/$pack.jbp" "web/packs/$pack.jbp"
done
node web/test/wasm.test.mjs
cp web/jazzband.wasm "$site/engine/"
cp web/packs/*.jbp "$site/engine/packs/"



# Exercise the deployed layout with a touch viewport and the real audio engine.
cd "$root"
test_deps=$(mktemp -d)
npm install --silent --prefix "$test_deps" playwright@1.56.1
"$test_deps/node_modules/.bin/playwright" install --with-deps webkit
python3 -m http.server 8765 --directory site --bind 127.0.0.1 >/tmp/play-along-test-server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" || true' EXIT
NODE_PATH="$test_deps/node_modules" node mobile-test.cjs
