// EngineTests.swift - the native engine and the library on iOS: the packs load and verify, a real chart is prepared by
// songform.js in JavaScriptCore, and the band renders it in time and audibly (no audio hardware needed).
import XCTest
@testable import JazzPlayAlong

final class EngineTests: XCTestCase {
    static let band: BandEngine = { let b = BandEngine(); b.loadPacks(); return b }()

    func testPacksVerify() {
        let b = Self.band
        for slot in [0, 1, 2, 3, 5, 6] { XCTAssertTrue(b.packOK(slot), "pack slot \(slot)") }
    }

    func testLibraryAndRender() throws {
        let lib = Library()
        XCTAssertGreaterThan(lib.tunes.count, 400, "tunes from the 462 Jazz Standards and the Fakebook")
        let tune = try XCTUnwrap(lib.tunes.first { $0.title == "Autumn Leaves" })
        let p = try XCTUnwrap(lib.prepare(tune, bpm: 120, feel: 0))
        XCTAssertGreaterThan(p.nbars, 16); XCTAssertGreaterThan(p.lead.count, 8 * 20)
        let b = Self.band
        b.load(p, tempo: 120, feel: 0)
        b.play()
        var l = [Float](repeating: 0, count: 512), r = l, sum: Double = 0, peak: Float = 0, firstBar = -1
        for i in 0..<(44100 * 6 / 512) {
            eng_render(&l, &r, 512, 0)
            for v in l { sum += Double(v * v); peak = max(peak, abs(v)) }
            if firstBar < 0 && b.position().state == 3 { firstBar = i * 512 }
        }
        b.stop()
        XCTAssertGreaterThan(peak, 0.05); XCTAssertLessThanOrEqual(peak, 1)
        XCTAssertGreaterThan(firstBar, 80000, "a bar of count-in at 120 BPM (2 s)"); XCTAssertLessThan(firstBar, 96000)
        print("rendered: peak \(peak), rms \(sqrt(sum / Double(44100 * 6))), bar 1 at \(Double(firstBar) / 44100) s")
    }
}
