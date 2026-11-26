// midi.js - the OP-1 (or any MIDI controller) and the play-along, over USB MIDI (Web MIDI: Chrome and Edge).
// In: "learn" ties a key, button or knob to an action (play, stop, tempo, next tune...). Out: one band part, or the
// melody, goes to the OP-1 as notes so its own synth plays it, and MIDI clock keeps its tempo with the band.

export const ACTIONS = [
  ['play', 'Play / pause'], ['stop', 'Stop'], ['finish', 'Finish after chorus'],
  ['tempoUp', 'Tempo +5'], ['tempoDown', 'Tempo −5'], ['tempoKnob', 'Tempo knob (60–300)'],
  ['next', 'Next tune in my list'], ['prev', 'Previous tune in my list'],
  ['loop', 'Loop on / off'], ['feel', 'Next feel'], ['trade', 'Trading: off / fours / eights'],
  ['keyUp', 'Key up a semitone'], ['keyDown', 'Key down a semitone'],
];
export const PARTS = [[-1, 'Nothing'], [4, 'Melody'], [1, 'Bass'], [2, 'Piano'], [3, 'Guitar'], [0, 'Drums (General MIDI notes)']];
const KEY = 'playalong.midi';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export class Midi {
  constructor(onAction, onChange) {
    this.access = null; this.onAction = onAction; this.onChange = onChange || (() => {});
    this.cfg = Object.assign({ map: {}, input: '', output: '', part: -1, ch: 1, muteLocal: true, clock: false }, load());
    this.learning = null; this.held = new Map();
  }
  get supported() { return !!navigator.requestMIDIAccess; }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch { /* private mode */ } }
  async connect() {
    if (!this.supported) throw new Error('This browser has no Web MIDI: use Chrome or Edge on a computer or Android.');
    if (!this.access) {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => { this.bind(); this.onChange(); };
    }
    this.bind(); this.onChange();
  }
  ports(kind) { return this.access ? [...(kind === 'in' ? this.access.inputs : this.access.outputs).values()] : []; }
  pick(list, id) { return list.find(p => p.id === id) || list.find(p => /op-?1/i.test(p.name)) || null; }
  bind() {
    for (const p of this.ports('in')) p.onmidimessage = null;
    this.in = this.pick(this.ports('in'), this.cfg.input);
    this.out = this.pick(this.ports('out'), this.cfg.output);
    if (this.in) this.in.onmidimessage = (e) => this.receive(e.data);
  }
  setPort(kind, id) { this.cfg[kind === 'in' ? 'input' : 'output'] = id; this.save(); this.bind(); this.onChange(); }
  // a message -> the control it came from: "n:<ch>:<note>" (a key or a button sending notes) or "c:<ch>:<cc>"
  receive([st, d1, d2]) {
    const type = st & 0xF0, ch = st & 15;
    let id = null, on = false, val = 0;
    if (type === 0x90 && d2 > 0) { id = `n:${ch}:${d1}`; on = true; }
    else if (type === 0xB0) { id = `c:${ch}:${d1}`; val = d2; on = d2 > 0; }
    else return;
    if (this.learning) { this.cfg.map[this.learning] = id; this.learning = null; this.save(); this.onChange(); return; }
    for (const [act, ctl] of Object.entries(this.cfg.map)) {
      if (ctl !== id) continue;
      if (act === 'tempoKnob') { if (type === 0xB0) this.onAction('tempoSet', Math.round(60 + val * 240 / 127)); continue; }
      // a button that sends a value when pressed and 0 when let go acts once, on the press
      if (on) this.onAction(act);
    }
  }
  learn(act) { this.learning = this.learning === act ? null : act; this.onChange(); }
  forget(act) { delete this.cfg.map[act]; this.save(); this.onChange(); }
  label(id) {
    if (!id) return '—';
    const [k, ch, n] = id.split(':');
    const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    return k === 'n' ? `key ${NAMES[n % 12]}${Math.floor(n / 12) - 1}${+ch ? ' ch ' + (+ch + 1) : ''}` : `control ${n}${+ch ? ' ch ' + (+ch + 1) : ''}`;
  }
  // which engine parts to send: bit i (0 drums .. 3 guitar, 4 melody), and whether to send clock
  route() { return { mask: this.out && this.cfg.part >= 0 ? 1 << this.cfg.part : 0, clock: !!(this.out && this.cfg.clock) }; }
  // events from the audio thread: {at: the context time of the render call, ev: [inst, note, vel, kind, delay, len] ...}
  play(ctx, d) {
    const o = this.out; if (!o || !ctx) return;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    const toPerf = (t) => ts && ts.performanceTime ? ts.performanceTime + (t - ts.contextTime) * 1000 : performance.now() + (t - ctx.currentTime) * 1000;
    const ch = (this.cfg.ch - 1) & 15, sr = ctx.sampleRate;
    for (let i = 0; i < d.ev.length; i += 6) {
      const [, note, vel, kind, delay, len] = d.ev.slice(i, i + 6);
      const at = Math.max(performance.now(), toPerf(d.at + delay / sr));
      if (kind === 1) { o.send([0xF8], at); continue; }
      o.send([0x90 | ch, note, vel], at);
      o.send([0x80 | ch, note, 0], at + Math.max(30, len / sr * 1000 - 8));
    }
  }
  start() { if (this.out && this.cfg.clock) this.out.send([0xFA]); }
  stop() { if (!this.out) return; const ch = (this.cfg.ch - 1) & 15; this.out.send([0xB0 | ch, 123, 0]); if (this.cfg.clock) this.out.send([0xFC]); }
}
