#!/usr/bin/env bash
set -euo pipefail
root=$(pwd)
site="$root/site"
mkdir -p "$site/engine/packs"
cp index.html player.js "$site/"
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

