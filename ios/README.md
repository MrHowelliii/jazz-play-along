# Play-Along for iPhone and iPad (proof of concept)

The same band engine as the web app (jazzband-op1r `web/jb_web.c`, plain C) running natively, the web app's own
`songform.js` (in JavaScriptCore) to turn charts into band data, and CoreMIDI for the OP-1:

- pick any of the tunes (the 462 Jazz Standards and the scanned Fakebook), play and stop, tempo, feel, melody sound;
- keeps playing with the screen locked or in another app;
- **OP-1 / MIDI** (USB or Bluetooth MIDI): learn keys and knobs for play, stop, tempo, next and previous tune; send
  the melody or a band part to the OP-1 with MIDI clock, timed to when the band is heard.

## Build

GitHub Actions builds and tests it on every change (`.github/workflows/ios.yml`, a macOS runner, the iPhone
simulator, plus an unsigned device build). To run it on your phone you need a Mac with Xcode:

```sh
git clone https://github.com/MrHowelliii/jazz-play-along && cd jazz-play-along
git clone https://github.com/MrHowelliii/jazzband-op1r upstream
git clone https://github.com/MrHowelliii/jazzbook catalog
sh ios/stage.sh                       # engine source + sound packs + tunes into ios/build
brew install xcodegen && (cd ios && xcodegen generate)
open ios/JazzPlayAlong.xcodeproj      # Signing & Capabilities: pick your team, plug in the phone, Run
```

A free Apple ID can install it on your own phone for 7 days at a time; a paid developer account ($99/year) for a year,
and for TestFlight.
