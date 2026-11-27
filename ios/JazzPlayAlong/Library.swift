// Library.swift - the tunes. The lead sheets (leads/*.json) and the web app's own songform.js run in
// JavaScriptCore, so the iOS app turns a chart into band data exactly as the web app does.
import Foundation
import JavaScriptCore

struct Tune: Identifiable, Hashable {
    let id: String
    let title: String
    let composer: String
    let book: String
    let tempo: Int      // the tune's usual tempo (0: none)
    let feel: Int       // 0 swing .. 7 even eighths (-1: none)
}

/// A chart prepared for the engine (the same bytes the web app posts to its audio worklet).
struct Prepared {
    let bars: [UInt8]
    let nbars: Int
    let beats: Int
    let lead: [UInt8]
    let pick: [UInt8]
    let form: [Int]
}

final class Library {
    private(set) var tunes: [Tune] = []
    private let js: JSContext

    init(bundle: Bundle = .main) {
        js = JSContext()!
        js.exceptionHandler = { _, e in print("JS:", e?.toString() ?? "?") }
        guard let url = bundle.url(forResource: "songform", withExtension: "js"),
              var src = try? String(contentsOf: url, encoding: .utf8) else { return }
        src = src.replacingOccurrences(of: "export function", with: "function")
                 .replacingOccurrences(of: "export const", with: "const")
        js.evaluateScript(src)
        js.evaluateScript("""
        var LIB = {};
        function addBook(name, arr) { LIB[name] = arr; }
        function tuneList() {
          const out = [];
          for (const k in LIB) for (const s of LIB[k]) out.push([s.id, s.title, s.composer || '', k, s.tempo || 0, s.feel == null ? -1 : s.feel]);
          return JSON.stringify(out);
        }
        function prepTune(id, bpm, feel) {
          let s = null;
          for (const k in LIB) { s = LIB[k].find(x => x.id === id); if (s) break; }
          if (!s) return '';
          const p = prepare(s, { feel: feel, bpm: bpm });
          return JSON.stringify({ bars: Array.from(p.barBytes), nbars: p.form.length, beats: p.beats,
                                  lead: Array.from(p.lead), pick: Array.from(p.pick), form: p.form });
        }
        """)
        for book in ["462jazz", "jazzfake"] {
            guard let u = bundle.url(forResource: book, withExtension: "json"),
                  let text = try? String(contentsOf: u, encoding: .utf8) else { continue }
            js.evaluateScript("addBook('\(book)', \(text));")
        }
        if let list = js.evaluateScript("tuneList()")?.toString(),
           let rows = try? JSONSerialization.jsonObject(with: Data(list.utf8)) as? [[Any]] {
            tunes = rows.compactMap { r in
                guard r.count == 6, let id = r[0] as? String, let title = r[1] as? String else { return nil }
                return Tune(id: id, title: title, composer: r[2] as? String ?? "", book: r[3] as? String ?? "",
                            tempo: (r[4] as? NSNumber)?.intValue ?? 0, feel: (r[5] as? NSNumber)?.intValue ?? -1)
            }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
    }

    func prepare(_ tune: Tune, bpm: Int, feel: Int) -> Prepared? {
        guard let f = js.objectForKeyedSubscript("prepTune"),
              let s = f.call(withArguments: [tune.id, bpm, feel])?.toString(), !s.isEmpty,
              let o = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] else { return nil }
        func bytes(_ k: String) -> [UInt8] { (o[k] as? [NSNumber])?.map { $0.uint8Value } ?? [] }
        return Prepared(bars: bytes("bars"), nbars: (o["nbars"] as? NSNumber)?.intValue ?? 0,
                        beats: (o["beats"] as? NSNumber)?.intValue ?? 4, lead: bytes("lead"), pick: bytes("pick"),
                        form: (o["form"] as? [NSNumber])?.map { $0.intValue } ?? [])
    }
}
