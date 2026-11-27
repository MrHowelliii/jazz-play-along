// BandEngine.swift - the Jazz Band engine (C, the same code as the web app) running natively: sound packs from the
// app bundle, an AVAudioSourceNode that calls it, background playback, and the band's settings.
import AVFoundation

final class BandEngine {
    static let packs = ["jbdrums", "jbbass", "jbpiano", "jbguitar", "jblead", "jbgtrlead"]
    static let leadSounds = [(6, "Alto sax"), (2, "Jazz guitar"), (1, "Grand piano"), (4, "Muted trumpet"), (3, "Vibes"), (0, "Synth horn")]
    static let feels = ["Swing", "Ballad", "Bossa", "Two-feel", "Two, then four", "Shuffle", "Samba", "Even eighths"]

    private let audio = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private(set) var loaded = false
    private(set) var running = false
    var leadLevel: Int32 = 24000
    var leadSound: Int32 = 6
    var muted: Int = -1            // a part the OP-1 plays instead (0 drums .. 3 guitar, 4 melody), silent here

    /// Packs into the engine and their checks run; safe to call off the main thread, once.
    func loadPacks(bundle: Bundle = .main) {
        if loaded { return }
        jbw_init()
        for name in Self.packs {
            guard let url = bundle.url(forResource: name, withExtension: "jbp"), let d = try? Data(contentsOf: url) else { continue }
            d.withUnsafeBytes { p in
                _ = jbw_add_pack_file(p.bindMemory(to: UInt8.self).baseAddress, UInt32(d.count))
            }
        }
        eng_warm_up(3000)
        loaded = true
    }
    func packOK(_ slot: Int) -> Bool { eng_lock(); defer { eng_unlock() }; return jbw_pack_ok(Int32(slot)) != 0 }

    func startAudio() throws {
        if running { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try? session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
        eng_set_latency(session.outputLatency + session.ioBufferDuration)
        let fmt = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let node = AVAudioSourceNode(format: fmt) { _, ts, frames, abl -> OSStatus in
            let b = UnsafeMutableAudioBufferListPointer(abl)
            guard b.count >= 2, let l = b[0].mData?.assumingMemoryBound(to: Float.self),
                  let r = b[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            eng_render(l, r, Int32(frames), ts.pointee.mHostTime)
            return noErr
        }
        audio.attach(node)
        audio.connect(node, to: audio.mainMixerNode, format: fmt)
        try audio.start()
        source = node
        running = true
    }

    /// A chart in, at a tempo and feel; the melody in the first and last of three choruses.
    func load(_ p: Prepared, tempo: Int, feel: Int, choruses: Int = 3) {
        eng_lock(); defer { eng_unlock() }
        jbw_stop()
        if let bars = jbw_bars() { for (i, b) in p.bars.enumerated() { bars[i] = b } }
        jbw_load(Int32(p.nbars), Int32(p.beats), Int32(tempo), Int32(feel))
        jbw_feel(Int32(feel))
        let n = min(p.lead.count / 8, Int(jbw_lead_max()))
        if let lb = jbw_lead_buf()?.assumingMemoryBound(to: UInt8.self) { for i in 0..<(n * 8) { lb[i] = p.lead[i] } }
        let np = min(p.pick.count / 8, 32)
        if let pb = jbw_pick_buf()?.assumingMemoryBound(to: UInt8.self) { for i in 0..<(np * 8) { pb[i] = p.pick[i] } }
        jbw_lead_set(Int32(n), Int32(np))
        jbw_form(Int32(choruses), 0, 0, 0)
        jbw_lead_mask(choruses <= 1 ? 0xFFFF_FFFF : UInt32(1 | (1 << min(31, choruses - 1))))
        jbw_human(60)
        applyMixLocked()
    }
    private func applyMixLocked() {
        let lvl: [Int32] = [23593, 26214, 20971, 11796]          // the engine's defaults, as the web app uses
        for i in 0..<4 { jbw_level(Int32(i), muted == i ? 1 : lvl[i]) }
        jbw_lead_sound(leadSound, muted == 4 ? 0 : leadLevel, 0)
    }
    func applyMix() { eng_lock(); applyMixLocked(); eng_unlock() }

    func play() { eng_set_paused(0); eng_lock(); jbw_play(-1); eng_unlock(); eng_midi_transport(1) }
    func stop() { eng_lock(); jbw_stop(); eng_unlock(); eng_midi_transport(0) }
    func setTempo(_ bpm: Int) { eng_lock(); jbw_tempo(Int32(bpm)); eng_unlock() }
    func setFeel(_ f: Int) { eng_lock(); jbw_feel(Int32(f)); eng_unlock() }
    func route(mask: Int, clock: Bool) { eng_lock(); jbw_midi_route(Int32(mask), clock ? 1 : 0); eng_unlock() }

    /// state: 0 stopped, 2 count-in, 3 playing; the bar of the form; the chorus.
    func position() -> (state: Int, bar: Int, chorus: Int) {
        eng_lock(); let st = Int(jbw_state()), bar = Int(jbw_bar()); eng_unlock()
        return (st & 15, bar, (st >> 16) & 255)
    }
}
