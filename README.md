# jazz-play-along
Standalone jazz combo and melody player for lead sheets: a band (drums, bass, piano, guitar) plays the changes and a
lead voice plays the tune, for the 462 standards parsed in [jazzbook](https://github.com/MrHowelliii/jazzbook), on the
Jazz Band engine from [jazzband-op1r](https://github.com/MrHowelliii/jazzband-op1r).

## Practising with it

| | |
|---|---|
| **Starts at once** | The engine and the instruments download as the page opens, not when Play is pressed |
| **Remembers** | Tempo, key and feel per tune; your instrument, band, mixer and "You play" choice for all tunes |
| **You play** | Above the chart: just listen, or take the melody, piano, guitar, bass or drums (that part drops out). Tempo − / + next to it |
| **Cues** | The count-in is shown large; "Solos next" / "Melody next" appears a bar before the melody leaves or returns |
| **Stage** | A large chart for a music stand: only the chart and the transport, the line being played at the top, fullscreen where the browser allows it. The screen stays awake while the band plays |
| **Keys and pedals** | Space, → or Page Down: play / pause · ← or Page Up: stop · ↑ ↓: tempo (Shift: by 1) · L: loop · S: stage · R: record. Bluetooth page-turner pedals send these keys |
| **Loops** | Tap a bar, Loop, tap the last bar. Setup › Loop speed-up makes each pass 2, 4 or 8 BPM faster; Stop brings the tempo back |
| **Record** | ● Rec records the band and your microphone together (the band is delayed by the output latency so they line up); takes are in Setup, with Save file |
| **My list** | ☆ adds the tune to your list on the Songs screen: reorder it, and optionally play it in order (after a tune's ending the next one starts) |
| **Room** | Mixer › Room: a small-room reverb around the band (0 turns it off) |
| **Speaker delay** | Setup: for Bluetooth speakers, delays the moving bar (and aligns recordings) by the milliseconds you set |
| **Interruptions** | A call or a route change pauses the band at the beat; Resume carries on from there |
| **Offline, installable** | A web app manifest and a service worker (`sw.js`): add it to the home screen; the app, the library and the instruments are kept on the device. The "Original page" view (the book PDFs) still needs a connection |

## Build and tests

`build.sh` (run by the Pages workflow) assembles `site/` from this repository, the pinned jazzbook commit (library,
form code, PDF viewer) and the pinned jazzband-op1r commit (engine), then runs `mobile-test.cjs` in WebKit.

`feature-test.cjs` covers the practice features above against a served `site/`:
`BROWSER=chromium node feature-test.cjs` (Chromium, because it uses a fake microphone for the recording check).
It is not part of `build.sh`.

When `engine/` files or icons change without changing name, bump `VERSION` in `sw.js` so devices fetch them again.
