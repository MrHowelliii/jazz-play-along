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
cc -O2 -Imock web/pack2web.c -o /tmp/jazz-pack2web
for pack in jbdrums jbbass jbpiano jbguitar; do
  /tmp/jazz-pack2web "../sound packs/$pack.op1p" "web/packs/$pack.jbp"
done
node web/test/wasm.test.mjs
cp web/jazzband.wasm "$site/engine/"
cp web/packs/*.jbp "$site/engine/packs/"

