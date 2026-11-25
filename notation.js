// notation.js - the melody of a bar on a five-line staff (SVG), and chords as functions (roman numerals).
// A bar's notes come as [t, d, pitch] triples (48ths of a quarter note; pitch MIDI, +128 when it continues a tie,
// 0 for a rest). Horizontal positions are percentages of the bar (time-proportional), everything else is in pixels,
// so a bar can be any width.

const LETTERS = 'CDEFGAB', STEP_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];   // F C G D A E B / B E A D G C F
const ACC = { '-2': '𝄫', '-1': '♭', 0: '♮', 1: '♯', 2: '𝄪' };

// key signature after transposing by `semis`: the one with at most six flats or five sharps
export function transposeKey(fifths, semis) { let k = ((fifths + 7 * semis) % 12 + 12) % 12; return k > 5 ? k - 12 : k; }
export function keyAlter(fifths, letter) {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(letter)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(letter)) return -1;
  return 0;
}
// a MIDI pitch spelled for a key: the name closest to the key on the line of fifths (in C: Db Eb F# Ab Bb)
export function spell(midi, fifths) {
  const pc = ((midi % 12) + 12) % 12;
  let i = fifths - 5; while ((((i * 7) % 12) + 12) % 12 !== pc) i++;
  const letter = [3, 0, 4, 1, 5, 2, 6][(((i + 1) % 7) + 7) % 7], alter = Math.floor((i + 1) / 7);
  const octave = Math.floor((midi - alter) / 12) - 1;
  return { letter, alter, octave, dn: octave * 7 + letter };          // dn: diatonic number, E4 (bottom line) = 30
}
function value(d) {
  for (const base of [192, 96, 48, 24, 12, 6]) {
    if (d === base) return { base, dots: 0 };
    if (d * 2 === base * 3) return { base, dots: 1 };
    if (d * 4 === base * 7) return { base, dots: 2 };
    if (d * 3 === base * 2) return { base, dots: 0, tuplet: 3 };
  }
  for (const base of [192, 96, 48, 24, 12, 6]) if (d >= base) return { base, dots: 0 };
  return { base: 6, dots: 0 };
}
// Where a moment of the bar sits across its width, in percent. Notes are not spaced by the clock alone: a short note
// still needs room for its head, so each note gets the square root of its share of the bar.
export function barMap(notes, L) {
  const ts = [];
  for (let k = 0; k < notes.length; k += 3) if (!ts.length || notes[k] > ts[ts.length - 1]) ts.push(notes[k]);
  if (!ts.length || ts[0] > 0) ts.unshift(0);
  ts.push(Math.max(L, ts[ts.length - 1] + 1));
  const xs = [0];
  for (let i = 1; i < ts.length; i++) xs.push(xs[i - 1] + Math.sqrt((ts[i] - ts[i - 1]) / L));
  const total = xs[xs.length - 1];
  return (t) => {
    let i = 1; while (i < ts.length - 1 && ts[i] <= t) i++;
    const f = Math.max(0, Math.min(1, (t - ts[i - 1]) / (ts[i] - ts[i - 1])));
    return 9 + (xs[i - 1] + (xs[i] - xs[i - 1]) * f) / total * 85;
  };
}
const n2 = (x) => (Math.round(x * 100) / 100).toString();

// geometry for a bar `h` pixels high: chords above, the staff around 60% down
export function staffMetrics(h) { const sp = h / 13.5; return { h, sp, top: h * 0.6 - 2 * sp, bottom: h * 0.6 + 2 * sp }; }

function lines(m, x1 = '0', x2 = '100%') {
  let s = '';
  for (let k = 0; k < 5; k++) { const y = n2(m.top + k * m.sp); s += `<line class="sl" x1="${x1}" x2="${x2}" y1="${y}" y2="${y}"/>`; }
  return s;
}

// The start of a line of music: clef and key signature. Returns { html, width }.
export function rowHead(fifths, h) {
  const m = staffMetrics(h), sp = m.sp, n = Math.abs(fifths);
  const width = Math.round(sp * (3.4 + n * 1.05) + 2);
  // an original, simple G clef drawn around the G line (second from the bottom)
  const g = m.bottom - sp, u = sp / 10;
  const P = (pts) => pts.map(([x, y]) => `${n2(x * u + sp * 0.35)} ${n2(g + y * u)}`);
  const c = (a, b, e) => `C${P([a, b, e]).join(' ')}`;
  const clef = `<path class="clef" d="M${P([[15, 2]])[0]} ${c([11, -3], [4, 0], [5, 6])} ${c([6, 11], [13, 12], [17, 8])} ${c([22, 3], [20, -7], [12, -9])}
    ${c([3, -11], [-4, -3], [-1, 6])} ${c([2, 16], [13, 20], [21, 15])} ${c([29, 10], [28, -4], [19, -13])} ${c([12, -20], [8, -28], [10, -37])}
    ${c([11, -44], [15, -49], [18, -50])} ${c([22, -44], [20, -34], [13, -26])} M${P([[14, -46]])[0]} L${P([[18, 30]])[0]} ${c([19, 37], [13, 40], [9, 36])}"/>
    <circle class="nh" cx="${n2(10 * u + sp * 0.35)}" cy="${n2(g + 34 * u)}" r="${n2(2.6 * u)}"/>`;
  let ks = '';
  const order = fifths > 0 ? SHARP_ORDER : FLAT_ORDER;
  const sharpDn = { 3: 38, 0: 35, 4: 39, 1: 36, 5: 33, 2: 37, 6: 34 }, flatDn = { 6: 34, 2: 37, 5: 33, 1: 36, 4: 32, 0: 35, 3: 31 };
  for (let k = 0; k < n; k++) {
    const dn = (fifths > 0 ? sharpDn : flatDn)[order[k]], y = m.bottom - (dn - 30) * sp / 2;
    ks += `<text class="acc" x="${n2(sp * (3.2 + k * 1.05))}" y="${n2(y + sp * (fifths > 0 ? 0.55 : 0.4))}" font-size="${n2(sp * 2.1)}">${fifths > 0 ? '♯' : '♭'}</text>`;
  }
  return { width, html: `<svg class="staff rowhead" width="${width}" height="${n2(h)}" aria-hidden="true">${lines(m)}${clef}${ks}</svg>` };
}

// One bar. notes: flat [t, d, p, ...]; L: bar length; fifths: key signature shown; semis: transposition of the pitches;
// tieOut: the next bar starts with the continuation of this bar's last note. sigFifths: the key signature printed at
// the start of the line (accidentals are shown against it when the key changes inside a line).
export function staffBar(notes, L, fifths, semis, h, tieOut, sigFifths = fifths) {
  const m = staffMetrics(h), sp = m.sp, hw = sp * 0.62, stemLen = sp * 3.3;
  const yOf = (dn) => m.bottom - (dn - 30) * sp / 2;
  const map = barMap(notes, L), pct = (t) => map(t).toFixed(2) + '%';
  const state = {};                                            // accidentals in force in this bar: letter+octave -> alter
  const ev = [];
  for (let k = 0; k < notes.length; k += 3) {
    const t = notes[k], d = notes[k + 1], raw = notes[k + 2], v = value(d);
    if (!raw) { ev.push({ t, d, v, rest: true }); continue; }
    const tie = raw >= 128, sp_ = spell((raw & 127) + semis, fifths), key = sp_.letter + ':' + sp_.octave;
    const cur = key in state ? state[key] : keyAlter(sigFifths, sp_.letter);
    const acc = !tie && sp_.alter !== cur ? sp_.alter : null;
    state[key] = sp_.alter;
    ev.push({ t, d, v, tie, midi: raw & 127, dn: sp_.dn, y: yOf(sp_.dn), acc });
  }
  let s = lines(m);
  // beams: runs of flagged notes inside one beat
  const groups = []; let run = [];
  const flush = () => { if (run.length > 1) groups.push(run); run = []; };
  for (const e of ev) {
    const beamable = !e.rest && e.v.base <= 24;
    const last = run[run.length - 1];
    if (!beamable || (last && (last.t + last.d !== e.t || Math.floor(last.t / 48) !== Math.floor(e.t / 48)))) flush();
    if (beamable) run.push(e);
  }
  flush();
  const grouped = new Map();
  for (const g of groups) {
    const up = g.reduce((a, e) => a + e.dn, 0) / g.length < 34;
    const tip = up ? Math.min(...g.map(e => e.y)) - stemLen : Math.max(...g.map(e => e.y)) + stemLen;
    g.forEach(e => grouped.set(e, { up, tip }));
    const dx = n2(up ? hw : -hw), y = n2(tip + (up ? sp * 0.22 : -sp * 0.22));
    s += `<line class="beam" x1="${pct(g[0].t)}" x2="${pct(g[g.length - 1].t)}" y1="${y}" y2="${y}" transform="translate(${dx} 0)" stroke-width="${n2(sp * 0.45)}"/>`;
    for (let k = 0; k < g.length; k++) {                       // second beam for 16ths (a stub when the neighbour is an 8th)
      if (g[k].v.base > 12) continue;
      const y2 = n2(tip + (up ? sp * 0.92 : -sp * 0.92));
      const nxt = g[k + 1], prv = g[k - 1];
      if (nxt && nxt.v.base <= 12) s += `<line class="beam" x1="${pct(g[k].t)}" x2="${pct(nxt.t)}" y1="${y2}" y2="${y2}" transform="translate(${dx} 0)" stroke-width="${n2(sp * 0.45)}"/>`;
      else if (!(prv && prv.v.base <= 12)) {
        const to = nxt ? g[k].t + (nxt.t - g[k].t) * 0.45 : g[k].t - (g[k].t - prv.t) * 0.45;
        s += `<line class="beam" x1="${pct(g[k].t)}" x2="${pct(to)}" y1="${y2}" y2="${y2}" transform="translate(${dx} 0)" stroke-width="${n2(sp * 0.45)}"/>`;
      }
    }
    if (g[0].v.tuplet) {
      const mid = (g[0].t + g[g.length - 1].t) / 2;
      s += `<text class="tup" x="${pct(mid)}" y="${n2(tip + (up ? -sp * 0.5 : sp * 1.5))}" font-size="${n2(sp * 1.5)}" text-anchor="middle">3</text>`;
    }
  }
  let prev = null;
  for (const e of ev) {
    const x = pct(e.t);
    let g = '';
    if (e.rest) {
      const y = m.top + 2 * sp;
      if (e.d >= L || e.v.base === 192) g = `<rect class="nh" x="${n2(-sp * 0.6)}" y="${n2(m.top + sp)}" width="${n2(sp * 1.2)}" height="${n2(sp * 0.5)}"/>`;
      else if (e.v.base === 96) g = `<rect class="nh" x="${n2(-sp * 0.6)}" y="${n2(y - sp * 0.5)}" width="${n2(sp * 1.2)}" height="${n2(sp * 0.5)}"/>`;
      else if (e.v.base === 48) g = `<path class="rest" d="M${n2(-sp * 0.3)} ${n2(y - sp * 1.4)} l${n2(sp * 0.6)} ${n2(sp * 0.8)} l${n2(-sp * 0.6)} ${n2(sp * 0.7)} l${n2(sp * 0.6)} ${n2(sp * 0.8)} q${n2(-sp * 0.9)} ${n2(-sp * 0.3)} ${n2(-sp * 0.3)} ${n2(sp * 0.6)}"/>`;
      else {
        const nf = e.v.base === 24 ? 1 : e.v.base === 12 ? 2 : 3;
        g = `<line class="stem" x1="${n2(sp * 0.45)}" y1="${n2(y - sp * 0.7)}" x2="${n2(-sp * 0.15)}" y2="${n2(y + sp * (0.4 + nf * 0.5))}"/>`;
        for (let k = 0; k < nf; k++) g += `<circle class="nh" cx="${n2(-sp * 0.25 - k * sp * 0.12)}" cy="${n2(y - sp * 0.45 + k * sp)}" r="${n2(sp * 0.28)}"/>`;
      }
      const rx = e.d >= L || e.v.base === 192 ? '50%' : x;
      if (e.v.dots && e.v.base < 192) g += `<circle class="nh" cx="${n2(sp * 1.0)}" cy="${n2(y - sp * 0.5)}" r="${n2(sp * 0.2)}"/>`;
      s += `<svg x="${rx}" overflow="visible">${g}</svg>`;
      prev = null; continue;
    }
    // ledger lines
    for (let dn = 28; dn >= e.dn; dn -= 2) g += `<line class="sl" x1="${n2(-hw * 1.7)}" x2="${n2(hw * 1.7)}" y1="${n2(yOf(dn))}" y2="${n2(yOf(dn))}"/>`;
    for (let dn = 40; dn <= e.dn; dn += 2) g += `<line class="sl" x1="${n2(-hw * 1.7)}" x2="${n2(hw * 1.7)}" y1="${n2(yOf(dn))}" y2="${n2(yOf(dn))}"/>`;
    const open = e.v.base >= 96;
    g += `<ellipse class="${open ? 'nho' : 'nh'}" cx="0" cy="${n2(e.y)}" rx="${n2(hw)}" ry="${n2(sp * 0.43)}" transform="rotate(-18 0 ${n2(e.y)})"${open ? ` stroke-width="${n2(sp * 0.2)}"` : ''}/>`;
    if (e.v.base < 192) {
      const gi = grouped.get(e), up = gi ? gi.up : e.dn < 34, tip = gi ? gi.tip : e.y + (up ? -stemLen : stemLen), sx = up ? hw - 0.6 : -hw + 0.6;
      g += `<line class="stem" x1="${n2(sx)}" x2="${n2(sx)}" y1="${n2(e.y)}" y2="${n2(tip)}"/>`;
      if (!gi && e.v.base <= 24) {
        const nf = e.v.base === 24 ? 1 : e.v.base === 12 ? 2 : 3, dir = up ? 1 : -1;
        for (let k = 0; k < nf; k++) {
          const fy = tip + dir * k * sp * 0.75;
          g += `<path class="flag" d="M${n2(sx)} ${n2(fy)} q${n2(sp * 0.2)} ${n2(dir * sp * 0.9)} ${n2(sp * 1.0)} ${n2(dir * sp * 1.5)} q${n2(-sp * 0.1)} ${n2(-dir * sp * 0.8)} ${n2(-sp * 1.0)} ${n2(-dir * sp * 0.9)}z"/>`;
        }
        if (e.v.tuplet) g += `<text class="tup" x="0" y="${n2(up ? tip - sp * 0.4 : tip + sp * 1.4)}" font-size="${n2(sp * 1.5)}" text-anchor="middle">3</text>`;
      } else if (!gi && e.v.tuplet) g += `<text class="tup" x="0" y="${n2(up ? tip - sp * 0.4 : tip + sp * 1.4)}" font-size="${n2(sp * 1.5)}" text-anchor="middle">3</text>`;
    }
    for (let k = 0; k < e.v.dots; k++) g += `<circle class="nh" cx="${n2(hw + sp * (0.55 + k * 0.5))}" cy="${n2(e.y - (e.dn % 2 === 0 ? sp * 0.5 : 0))}" r="${n2(sp * 0.2)}"/>`;
    if (e.acc !== null) g += `<text class="acc" x="${n2(-hw - sp * 0.25)}" y="${n2(e.y + sp * (e.acc < 0 ? 0.4 : 0.55))}" font-size="${n2(sp * 2.1)}" text-anchor="end">${ACC[e.acc]}</text>`;
    s += `<svg x="${x}" overflow="visible">${g}</svg>`;
    // ties: from the previous note, or in from the bar before
    const below = e.dn >= 34, ty = e.y + (below ? -sp * 0.9 : sp * 0.9);
    const arc = (a, b) => `<svg class="tiebox" x="${a}" y="${n2(below ? ty - sp : ty)}" width="${b}" height="${n2(sp)}" viewBox="0 0 100 10" preserveAspectRatio="none" overflow="visible"><path class="tie" d="M3 ${below ? 10 : 0} Q50 ${below ? -6 : 16} 97 ${below ? 10 : 0}" vector-effect="non-scaling-stroke"/></svg>`;
    if (e.tie && prev && prev.midi === e.midi) s += arc(pct(prev.t), (parseFloat(pct(e.t)) - parseFloat(pct(prev.t))).toFixed(2) + '%');
    else if (e.tie && !prev) s += arc('0%', pct(e.t));
    prev = e;
  }
  if (tieOut && prev) {
    const below = prev.dn >= 34, ty = prev.y + (below ? -sp * 0.9 : sp * 0.9), a = parseFloat(pct(prev.t));
    s += `<svg class="tiebox" x="${a}%" y="${n2(below ? ty - sp : ty)}" width="${(100 - a).toFixed(2)}%" height="${n2(sp)}" viewBox="0 0 100 10" preserveAspectRatio="none" overflow="visible"><path class="tie" d="M3 ${below ? 10 : 0} Q50 ${below ? -6 : 16} 100 ${below ? 2 : 8}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  return `<svg class="staff" width="100%" height="${n2(h)}" aria-hidden="true">${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------- chords as functions
const NUMERAL = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parse(c) {                                             // c: [t, symbol, iReal token]
  const mt = /^([A-G])([b#]?)(.*)$/.exec(c[2] || ''), ms = /^([A-G][b#]?)([^/]*)/.exec(c[1] || '');
  if (!mt) return null;
  const root = (PCS[mt[1]] + (mt[2] === 'b' ? -1 : mt[2] === '#' ? 1 : 0) + 12) % 12, q = mt[3];
  const kind = q === 'h7' ? 'hdim' : q === 'o7' ? 'dim' : q[0] === '-' ? 'min' : q === '7' || q === '7b9' ? 'dom' : 'maj';
  let rest = ms ? ms[2] : '';
  if (kind === 'hdim') rest = 'ø7' + rest.replace(/^m(in)?7?\(?b5\)?/, '').replace(/^ø7?/, '');
  else if (kind === 'dim') rest = '°' + rest.replace(/^(dim|°|o)/, '');
  else if (kind === 'min') rest = rest.replace(/^m(?!aj)/, '');
  return { root, kind, rest, lower: kind !== 'maj' && kind !== 'dom' };
}
const numeral = (ch, tonic) => { const n = NUMERAL[(ch.root - tonic + 12) % 12]; return ch.lower ? n.toLowerCase() : n; };

// Roman numerals for every chord of a song, bar by bar (same shape as bars[k].c). Relative to the major key of the
// key signature, or to its relative minor when the tune lives there (♭III, ♭VI, ♭VII in minor). Secondary dominants
// are V7/x, their ii chords ii/x, dominants that resolve down a half step subV7/x.
export function romanize(bars, fifths0 = 0) {
  const flat = [];
  let fifths = fifths0;
  bars.forEach((b, bi) => { if (b.k !== undefined) fifths = b.k; b.c.forEach((c, ci) => flat.push({ bi, ci, ch: parse(c), fifths })); });
  const major = (f) => (((f * 7) % 12) + 12) % 12;
  // minor: the tune rests more on the minor chord a minor third below the major tonic than on the major tonic itself
  const tonicOf = {}, home = {};
  for (const x of flat) {
    if (!x.ch) continue;
    const t = major(x.fifths), h = home[x.fifths] = home[x.fifths] || { maj: 0, min: 0 };
    if (x.ch.root === t && x.ch.kind === 'maj') h.maj++;
    if (x.ch.root === (t + 9) % 12 && x.ch.kind === 'min') h.min++;
  }
  for (const f of Object.keys(home)) { const t = major(+f); tonicOf[f] = home[f].min > home[f].maj ? (t + 9) % 12 : t; }
  const out = bars.map(b => b.c.map(() => ''));
  const lab = flat.map(x => x.ch ? numeral(x.ch, tonicOf[x.fifths]) + x.ch.rest : '');
  for (let i = 0; i < flat.length; i++) {
    const x = flat[i], ch = x.ch; if (!ch) continue;
    const tonic = tonicOf[x.fifths], nx = flat.slice(i + 1).find(y => y.ch && (y.ch.root !== ch.root || y.ch.kind !== ch.kind));
    if (ch.kind !== 'dom' || !nx) continue;
    const deg = (ch.root - tonic + 12) % 12, tdeg = (nx.ch.root - tonic + 12) % 12, target = numeral(nx.ch, tonic);
    let sec = '';
    if (nx.ch.root === (ch.root + 5) % 12 && deg !== 7) sec = 'V' + ch.rest + '/' + target;
    else if (nx.ch.root === (ch.root + 11) % 12 && nx.ch.kind !== 'dim') sec = 'subV' + ch.rest + (tdeg === 0 ? '' : '/' + target);
    if (!sec) continue;
    lab[i] = sec;
    const pv = flat[i - 1];                                    // the ii of a secondary dominant
    if (sec[0] === 'V' && pv && pv.ch && (pv.ch.kind === 'min' || pv.ch.kind === 'hdim') && pv.ch.root === (ch.root + 7) % 12
        && !/^(V|subV)/.test(lab[i - 1])) lab[i - 1] = 'ii' + pv.ch.rest + '/' + target;
  }
  flat.forEach((x, i) => { out[x.bi][x.ci] = lab[i]; });
  return out;
}
