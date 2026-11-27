// App.swift - the play-along on iPhone and iPad (proof of concept): pick a tune, the band plays it natively, the OP-1
// (or any MIDI gear) controls it and can play a part.
import SwiftUI
import CoreMIDI

@main
struct JazzPlayAlongApp: App {
    @StateObject private var state = AppState()
    var body: some Scene { WindowGroup { ContentView().environmentObject(state) } }
}

final class AppState: ObservableObject {
    let band = BandEngine()
    let midi = Midi()
    @Published var library: Library?
    @Published var ready = false
    @Published var tune: Tune?
    @Published var list: [Tune] = []              // what "next" and "previous" step through
    @Published var playing = false
    @Published var tempo = 140
    @Published var feel = 0
    @Published var leadSound = 6 { didSet { band.leadSound = Int32(leadSound); band.applyMix() } }
    @Published var status = ""
    @Published var error: String?
    private var timer: Timer?

    init() {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let lib = Library()
            band.loadPacks()
            DispatchQueue.main.async { self.library = lib; self.list = lib.tunes; self.ready = true }
        }
        midi.onAction = { [weak self] a, v in self?.midiAction(a, v) }
        midi.onRoute = { [weak self] mask, clock, away in
            guard let self else { return }
            band.route(mask: mask, clock: clock); band.muted = away; band.applyMix()
        }
        midi.refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.poll() }
    }

    func open(_ t: Tune) {
        if playing { stop() }
        tune = t
        tempo = UserDefaults.standard.object(forKey: "tempo." + t.id) as? Int ?? (t.tempo > 0 ? t.tempo : 140)
        feel = t.feel >= 0 ? t.feel : 0
        load()
    }
    private func load() {
        guard let t = tune, let p = library?.prepare(t, bpm: tempo, feel: feel) else { return }
        band.load(p, tempo: tempo, feel: feel)
    }
    func toggle() { playing ? stop() : play() }
    func play() {
        guard tune != nil else { return }
        do { try band.startAudio() } catch { self.error = error.localizedDescription; return }
        load(); band.play(); playing = true
    }
    func stop() { band.stop(); playing = false; status = "" }
    func setTempo(_ v: Int) {
        tempo = max(40, min(320, v)); band.setTempo(tempo)
        if let t = tune { UserDefaults.standard.set(tempo, forKey: "tempo." + t.id) }
    }
    func setFeel(_ f: Int) { feel = f; band.setFeel(f); load() }
    func step(_ d: Int) {
        guard !list.isEmpty else { return }
        let k = tune.flatMap { t in list.firstIndex(of: t) } ?? -1
        let next = list[((k + d) % list.count + list.count) % list.count]
        let was = playing
        open(next)
        if was { play() }
    }
    private func midiAction(_ a: MidiAction, _ v: Int) {
        switch a {
        case .play: toggle()
        case .stop: stop()
        case .tempoUp: setTempo(tempo + 5)
        case .tempoDown: setTempo(tempo - 5)
        case .tempoKnob: setTempo(v)
        case .next: step(1)
        case .prev: step(-1)
        }
    }
    private func poll() {
        guard playing else { return }
        let p = band.position()
        if p.state == 0 { playing = false; status = ""; return }
        status = p.state == 2 ? "Count-in" : "Chorus \(p.chorus) · bar \(p.bar + 1)"
    }
}

struct ContentView: View {
    @EnvironmentObject var state: AppState
    @State private var query = ""
    @State private var showMidi = false
    var filtered: [Tune] {
        let all = state.library?.tunes ?? []
        if query.isEmpty { return all }
        return all.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.composer.localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        NavigationStack {
            Group {
                if !state.ready { ProgressView("Loading the band…") }
                else {
                    List(filtered) { t in
                        NavigationLink(value: t) {
                            VStack(alignment: .leading) { Text(t.title); Text(t.composer).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    .searchable(text: $query, prompt: "Song title or composer")
                    .onChange(of: query) { _ in state.list = filtered }
                }
            }
            .navigationTitle("Play-Along")
            .navigationDestination(for: Tune.self) { t in PlayerView().onAppear { if state.tune != t { state.open(t) } } }
            .toolbar { Button("OP-1 / MIDI") { showMidi = true } }
            .sheet(isPresented: $showMidi) { MidiView(midi: state.midi) }
        }
    }
}

struct PlayerView: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        Form {
            Section {
                Text(state.tune?.title ?? "").font(.title2.bold())
                Text(state.status.isEmpty ? (state.tune?.composer ?? "") : state.status).foregroundStyle(.secondary)
                HStack(spacing: 24) {
                    Button { state.step(-1) } label: { Image(systemName: "backward.fill") }
                    Button { state.toggle() } label: { Image(systemName: state.playing ? "stop.fill" : "play.fill").font(.largeTitle) }
                    Button { state.step(1) } label: { Image(systemName: "forward.fill") }
                }.buttonStyle(.borderless).frame(maxWidth: .infinity)
            }
            Section("Tempo \(state.tempo) BPM") {
                Slider(value: Binding(get: { Double(state.tempo) }, set: { state.setTempo(Int($0)) }), in: 40...320, step: 1)
                Stepper("±1", onIncrement: { state.setTempo(state.tempo + 1) }, onDecrement: { state.setTempo(state.tempo - 1) })
            }
            Section {
                Picker("Feel", selection: Binding(get: { state.feel }, set: { state.setFeel($0) })) {
                    ForEach(0..<BandEngine.feels.count, id: \.self) { Text(BandEngine.feels[$0]).tag($0) }
                }
                Picker("Melody", selection: $state.leadSound) {
                    ForEach(BandEngine.leadSounds, id: \.0) { Text($0.1).tag($0.0) }
                }
            }
            if let e = state.error { Text(e).foregroundStyle(.red) }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct MidiView: View {
    @ObservedObject var midi: Midi
    @Environment(\.dismiss) private var dismiss
    static let parts = [(-1, "Nothing"), (4, "Melody"), (1, "Bass"), (2, "Piano"), (3, "Guitar"), (0, "Drums (General MIDI)")]
    var body: some View {
        NavigationStack {
            Form {
                Section("Connected") {
                    if midi.sources.isEmpty { Text("No MIDI devices. Plug the OP-1 in by USB (or pair Bluetooth MIDI), then Refresh.").foregroundStyle(.secondary) }
                    ForEach(midi.sources) { Text($0.name) }
                    Button("Refresh") { midi.refresh() }
                }
                Section("The OP-1 plays") {
                    Picker("Send to", selection: $midi.destID) {
                        Text("—").tag(MIDIUniqueID(0))
                        ForEach(midi.destinations) { Text($0.name).tag($0.id) }
                    }
                    Picker("Part", selection: $midi.part) { ForEach(Self.parts, id: \.0) { Text($0.1).tag($0.0) } }
                    Picker("Channel", selection: $midi.channel) { ForEach(1...16, id: \.self) { Text("\($0)").tag($0) } }
                    Toggle("Send MIDI clock", isOn: $midi.clock)
                }
                Section("Controls (press Learn, then an OP-1 key or knob)") {
                    ForEach(MidiAction.allCases) { a in
                        HStack {
                            Text(a.label)
                            Spacer()
                            Text(midi.learning == a ? "press a key…" : midi.label(a)).foregroundStyle(.secondary)
                            Button(midi.learning == a ? "Cancel" : "Learn") { midi.learning = midi.learning == a ? nil : a }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .navigationTitle("OP-1 / MIDI")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
