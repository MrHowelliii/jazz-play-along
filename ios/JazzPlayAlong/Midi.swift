// Midi.swift - the OP-1 (or any MIDI gear: USB, Bluetooth) over CoreMIDI. In: "learn" ties a key, button or knob to an
// action. Out: one band part, or the melody, goes to a destination as notes (sent by the engine, timed to the
// speaker), with MIDI clock if wanted.
import CoreMIDI
import Foundation

struct MidiEndpoint: Identifiable, Hashable {
    let id: MIDIUniqueID
    let name: String
    let ref: MIDIEndpointRef
}

enum MidiAction: String, CaseIterable, Identifiable {
    case play, stop, tempoUp, tempoDown, tempoKnob, next, prev
    var id: String { rawValue }
    var label: String {
        switch self {
        case .play: return "Play / stop"
        case .stop: return "Stop"
        case .tempoUp: return "Tempo +5"
        case .tempoDown: return "Tempo −5"
        case .tempoKnob: return "Tempo knob (60–300)"
        case .next: return "Next tune"
        case .prev: return "Previous tune"
        }
    }
}

final class Midi: ObservableObject {
    @Published var sources: [MidiEndpoint] = []
    @Published var destinations: [MidiEndpoint] = []
    @Published var learning: MidiAction?
    @Published var map: [String: String] { didSet { UserDefaults.standard.set(map, forKey: "midi.map") } }
    @Published var destID: MIDIUniqueID { didSet { UserDefaults.standard.set(Int(destID), forKey: "midi.dest"); applyOut() } }
    @Published var part: Int { didSet { UserDefaults.standard.set(part, forKey: "midi.part"); applyOut() } }
    @Published var channel: Int { didSet { UserDefaults.standard.set(channel, forKey: "midi.channel"); applyOut() } }
    @Published var clock: Bool { didSet { UserDefaults.standard.set(clock, forKey: "midi.clock"); applyOut() } }

    var onAction: ((MidiAction, Int) -> Void)?
    var onRoute: ((Int, Bool, Int) -> Void)?      // mask, clock, the part played elsewhere (-1 none)

    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()

    init() {
        let d = UserDefaults.standard
        map = d.dictionary(forKey: "midi.map") as? [String: String] ?? [:]
        destID = MIDIUniqueID(d.integer(forKey: "midi.dest"))
        part = d.object(forKey: "midi.part") as? Int ?? -1
        channel = d.object(forKey: "midi.channel") as? Int ?? 1
        clock = d.bool(forKey: "midi.clock")
        MIDIClientCreateWithBlock("Play-Along" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { self?.refresh() }
        }
        MIDIInputPortCreateWithBlock(client, "in" as CFString, &inPort) { [weak self] list, _ in
            for packet in list.unsafeSequence() {
                let n = Int(packet.pointee.length)
                let bytes = withUnsafeBytes(of: packet.pointee.data) { Array($0.prefix(n)) }
                DispatchQueue.main.async { self?.receive(bytes) }
            }
        }
        MIDIOutputPortCreate(client, "out" as CFString, &outPort)
        refresh()
    }

    private static func name(_ e: MIDIEndpointRef) -> String {
        var s: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(e, kMIDIPropertyDisplayName, &s)
        return (s?.takeRetainedValue() as String?) ?? "MIDI"
    }
    private static func uid(_ e: MIDIEndpointRef) -> MIDIUniqueID {
        var u: MIDIUniqueID = 0
        MIDIObjectGetIntegerProperty(e, kMIDIPropertyUniqueID, &u)
        return u
    }

    func refresh() {
        sources = (0..<MIDIGetNumberOfSources()).map { i in let e = MIDIGetSource(i); return MidiEndpoint(id: Self.uid(e), name: Self.name(e), ref: e) }
        destinations = (0..<MIDIGetNumberOfDestinations()).map { i in let e = MIDIGetDestination(i); return MidiEndpoint(id: Self.uid(e), name: Self.name(e), ref: e) }
        for s in sources { MIDIPortConnectSource(inPort, s.ref, nil) }
        if destID == 0 || !destinations.contains(where: { $0.id == destID }),
           let op1 = destinations.first(where: { $0.name.lowercased().contains("op-1") || $0.name.lowercased().contains("op1") }) {
            destID = op1.id
        }
        applyOut()
    }

    var destination: MidiEndpoint? { destinations.first { $0.id == destID } }

    private func applyOut() {
        let d = destination
        eng_set_midi_out(outPort, d?.ref ?? 0, Int32(channel))
        let mask = d != nil && part >= 0 ? 1 << part : 0
        onRoute?(mask, d != nil && clock, d != nil ? part : -1)
    }

    /// a message -> its control: "n:<ch>:<note>" (a key or button sending notes) or "c:<ch>:<cc>"
    private func receive(_ b: [UInt8]) {
        guard b.count >= 3 else { return }
        let type = b[0] & 0xF0, ch = b[0] & 15
        var id: String?, on = false, value = 0
        if type == 0x90 && b[2] > 0 { id = "n:\(ch):\(b[1])"; on = true }
        else if type == 0xB0 { id = "c:\(ch):\(b[1])"; value = Int(b[2]); on = b[2] > 0 }
        guard let ctl = id else { return }
        if let a = learning { map[a.rawValue] = ctl; learning = nil; return }
        for (a, c) in map where c == ctl {
            guard let act = MidiAction(rawValue: a) else { continue }
            if act == .tempoKnob { if type == 0xB0 { onAction?(.tempoKnob, 60 + value * 240 / 127) } }
            else if on { onAction?(act, 0) }
        }
    }

    func label(_ a: MidiAction) -> String {
        guard let c = map[a.rawValue] else { return "—" }
        let p = c.split(separator: ":"); guard p.count == 3, let n = Int(p[2]), let ch = Int(p[1]) else { return c }
        let names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
        let chs = ch > 0 ? " ch \(ch + 1)" : ""
        return p[0] == "n" ? "key \(names[n % 12])\(n / 12 - 1)\(chs)" : "control \(n)\(chs)"
    }
}
