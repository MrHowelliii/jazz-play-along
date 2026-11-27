#!/bin/sh
# Stage what the iOS app is built from, into ios/build: the engine source (jazzband-op1r, with the web app's
# playback.patch, so iOS and the web play the same) and the resources (sound packs, lead sheets, songform.js from
# jazzbook). Needs checkouts of both, by default at ../upstream and ../catalog (as the web build uses them).
#   sh ios/stage.sh [path/to/jazzband-op1r] [path/to/jazzbook]
set -e
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
up=${1:-$root/upstream}; cat=${2:-$root/catalog}
[ -d "$up/jazzband-op1r" ] && up="$up/jazzband-op1r"           # the repository has the plugin one level down
rm -rf "$here/build"; mkdir -p "$here/build/Resources"
cp -R "$up" "$here/build/upstream"
(cd "$here/build/upstream" && patch -p1 -s < "$root/playback.patch")
python3 "$root/trumpet-header.py" "$root/muted-trumpet.wav" > "$here/build/upstream/web/trumpet-data.h"
for p in jbdrums jbbass jbpiano jbguitar jblead jbgtrlead; do cp "$cat/engine/packs/$p.jbp" "$here/build/Resources/"; done
cp "$cat/leads/462jazz.json" "$cat/leads/jazzfake.json" "$cat/leads/djangofake.json" "$cat/app/songform.js" "$here/build/Resources/"
echo "staged: $(ls "$here/build/Resources" | wc -l) resources"
