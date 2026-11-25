"""Embed the six two-second VSCO Community Edition trumpet recordings in the worklet WASM."""
import struct
import sys
import wave

with wave.open(sys.argv[1]) as source:
    assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (22050, 1, 2)
    frames = 44100
    assert source.getnframes() == 6 * frames
    print("static const int16_t trumpet_pcm[6][44100] = {")
    for zone in range(6):
        print("{")
        for _ in range(frames // 50):
            samples = struct.unpack("<50h", source.readframes(50))
            print(", ".join(map(str, samples)), end=",\n")
        print("},")
    print("};")
