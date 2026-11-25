// player.js - the play-along player: the Jazz Band engine (WebAssembly, in an AudioWorklet) plays the chords with a
// band and the melody with a lead voice, from lead sheets parsed out of the fake-book PDFs (leads/*.json).
import { prepare, transposeSym, prettySym, KEY_NAMES, keyTonic, normTitle } from './songform.js';
import { staffBar, rowHead, romanize, transposeKey, barMap } from './notation.js';

const INST = ['Drums', 'Bass', 'Piano', 'Guitar'];
const PLAYERS = [
  ['Jimmy Cobb', 'Philly Joe Jones', 'Elvin Jones', 'Paul Motian', 'Art Blakey', 'Tony Williams', 'Roy Haynes', 'Billy Higgins',
   'Jo Jones', 'Jack DeJohnette', 'Max Roach', 'Airto'],
  ['Paul Chambers', 'Ray Brown', 'Ron Carter', 'Scott LaFaro', 'Charles Mingus', 'Sam Jones', 'Charlie Haden', 'Jimmy Garrison',
   'Walter Page', 'Oscar Pettiford'],
  ['Bill Evans', 'Red Garland', 'McCoy Tyner', 'Herbie Hancock', 'Thelonious Monk', 'Wynton Kelly', 'Count Basie', 'Ahmad Jamal',
   'Horace Silver', 'Erroll Garner'],
  ['Freddie Green', 'Jim Hall', 'Wes Montgomery', 'Kenny Burrell', 'Django Reinhardt', 'Grant Green', 'Herb Ellis', 'Barney Kessel',
   'Charlie Christian', 'João Gilberto (regular guitar here)'],
];
const STYLE_NOTES = [
  ['Steady ride cymbal with light comping.', 'Driving snare chatter with a rim accent on four.', 'Rolling triplets carry across the bar line.', 'Broken time with wide spaces between hits.', 'Press rolls lead into strong accents.', 'Hi-hat on every beat with quick bursts around the kit.', 'Crisp snare snaps interrupt the ride pattern.', 'A buoyant ride pulse with a light touch.', 'Hi-hat time with a Basie-style swing.', 'A wash of ride cymbal answered by the toms.', 'Melodic tom figures with hi-hat on two and four.', 'Brazilian shaker, conga and surdo patterns.'],
  ['A classic quarter-note walking line.', 'Roots and fifths give the band a strong forward push.', 'Chromatic walking lines across a wide register.', 'Conversational triplets leave space for the melody.', 'Blues riffs, pedal tones and big accents.', 'A deep walking pulse with roots on one and three.', 'Simple roots with space between phrases.', 'Pedal points and double stops.', 'An even four-beat walk through chord tones.', 'Melodic bebop lines with pickups into the next bar.'],
  ['Rootless chord voicings leave the bass room underneath.', 'Short chord stabs on the offbeats after two and four.', 'Chords built in fourths over roots and fifths.', 'Sparse, high-register chords arrive in unexpected places.', 'Angular chords with displaced accents.', 'Bouncy, bluesy chords anticipate the beat.', 'Spare high-register accents leave the soloist room.', 'Vamps and block chords alternate with space.', 'Funky left-hand punches drive the rhythm.', 'The left hand strums four beats to the bar.'],
  ['Short rhythm chords mark all four beats.', 'Light, lyrical chords in the upper register.', 'Punchy chord stabs alternate with octave fills.', 'Bluesy Charleston rhythms with sliding chords.', 'Short, accented la pompe rhythm chords.', 'Bluesy stabs and repeated-note riffs.', 'Four-beat swing with sliding chords.', 'Chord melody with a moving top voice.', 'Swing-era rhythm chords and horn-like riffs.', 'Bossa nova batida with a thumbed bass line.'],
];
const LEAD_VOICES = [
  ['Synth horn', 'A synthesized horn with legato and vibrato.'],
  ['Grand piano', 'Alexander Holm’s sampled Yamaha C5 grand piano.'],
  ['Archtop guitar', 'A sampled archtop combining pickup and microphone.'],
  ['Synth vibes', 'A synthesized vibraphone with ringing overtones.'],
  ['Muted trumpet', 'A recorded trumpet played with a Harmon mute.'],
  ['Upright bass', 'A sampled 1958 Otto Rubner double bass, played pizzicato.'],
  ['Alto sax', 'A recorded alto saxophone, soft and loud takes, laid back behind the beat.'],
];
const LVL_DEFAULT = [23593, 26214, 20971, 11796];       // the plugin's defaults (Q15) for drums, bass, piano, guitar
const LEAD_DEFAULT = 24000;
const PACKS = ['jbdrums', 'jbbass', 'jbpiano', 'jbguitar', 'jblead'];   // jblead: the recorded alto sax (optional)
const V = '?v=sound4';                                   // bump when engine files change under the same name
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5h13v13h-13z"/></svg>',
  wait: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>',
};
const ROLES = [['none', 'Just listen'], ['lead', 'Melody'], ['piano', 'Piano'], ['guitar', 'Guitar'], ['bass', 'Bass'], ['drums', 'Drums']];
const HORNS = [['C', 0, 'Concert'], ['Bb', 2, 'B♭ instrument'], ['Eb', 9, 'E♭ instrument'], ['F', 7, 'F instrument']];

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('playalong.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('playalong.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------------------------------------- the engine
let ctx = null, node = null, gain = null, room = null, engineReady = null, packsOk = [0, 0, 0, 0, 0];
let onPos = () => {}, onAudioState = () => {};

// The engine and its instruments start downloading when the page opens, so the first Play does not wait for them.
let assets = null;
function preload() {
  if (!assets) {
    const get = (u) => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); });
    assets = { wasm: get('engine/jazzband.wasm' + V), packs: PACKS.map(p => get(`engine/packs/${p}.jbp${V}`).catch(() => null)) };
    assets.wasm.catch(() => {});
  }
  return assets;
}

// A small room around the band: a short generated impulse response (early reflections, then a darkening tail).
function makeRoom(ac) {
  const input = ac.createGain(), output = ac.createGain(), wet = ac.createGain(), conv = ac.createConvolver();
  const sr = ac.sampleRate, len = Math.round(sr * 1.1), ir = ac.createBuffer(2, len, sr);
  let seed = 20261125;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0, energy = 0;
    const pre = Math.round(sr * (0.011 + 0.003 * ch));
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const k = Math.min(0.9, 0.25 + t * 1.6);                 // the tail loses its highs
      lp += (1 - k) * (rnd() - lp);
      d[i] = lp * Math.exp(-t * 6.2) * (t < 0.004 ? t / 0.004 : 1);
    }
    for (const [ms, g] of [[17, 0.5], [23, -0.4], [31, 0.3], [43, -0.22]]) d[Math.round(sr * (ms + 2 * ch) / 1000)] += g * 0.25;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const norm = 1 / Math.sqrt(energy);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  conv.normalize = false; conv.buffer = ir;
  input.connect(output);
  input.connect(conv).connect(wet).connect(output);
  return { input, output, set(pct) {
    const w = Math.max(0, Math.min(60, pct)) / 100 * 0.9;
    wet.gain.value = w; output.gain.value = 1 / (1 + 0.3 * w);    // more room, a little less level: no clipping
  } };
}
async function ensureEngine(status) {
  if (engineReady) return engineReady;
  engineReady = (async () => {
    status('Loading the band…');
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* Some browsers manage the audio route themselves. */ }
    ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
    await ctx.resume();
    await ctx.audioWorklet.addModule('engine/worklet.js' + V);
    node = new AudioWorkletNode(ctx, 'jazzband', { numberOfInputs: 0, outputChannelCount: [2] });
    gain = ctx.createGain(); gain.gain.value = 0.9;
    node.connect(gain);
    room = makeRoom(ctx);
    room.set(store.get('settings', {}).room ?? 18);
    gain.connect(room.input);
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    room.output.connect(meter).connect(ctx.destination);
    const samples = new Float32Array(meter.fftSize);
    function updateMeter() {
      const out = document.querySelector('.pl-output');
      if (out) {
        meter.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const db = 10 * Math.log10(sum / samples.length);
        out.value = Number.isFinite(db) ? db : -90;
        out.title = 'Output ' + (Number.isFinite(db) ? db.toFixed(1) : '−∞') + ' dBFS';
      }
    }
    ctx.addEventListener('statechange', updateMeter);
    ctx.addEventListener('statechange', () => onAudioState(ctx?.state));
    setInterval(updateMeter, 160);
    const ready = new Promise(res => {
      node.port.onmessage = (e) => {
        const d = e.data;
        if (d.t === 'ready') res();
        else if (d.t === 'pos') onPos(d);
        else if (d.t === 'packs') packsOk = d.ok;
      };
    });
    const files = preload();
    assets = null;                                          // the buffers move into the audio thread
    const wasm = await files.wasm;
    node.port.postMessage({ t: 'wasm', bytes: wasm }, [wasm]);
    await ready;
    let got = 0;
    await Promise.all(files.packs.map(async (pack) => {
      const b = await pack;
      if (!b) return;                                       // that instrument failed to download
      node.port.postMessage({ t: 'pack', bytes: b }, [b]);
      got++; status(`Loading the band… ${got}/${PACKS.length} instruments`);
    }));
    // the engine checks each pack (a checksum, a few KB per audio block): wait for it, at most a few seconds
    await ctx.resume();
    for (let i = 0; i < 80 && packsOk.reduce((a, b) => a + b, 0) < got; i++) {
      node.port.postMessage({ t: 'packs' });
      await new Promise(r => setTimeout(r, 100));
    }
    if (packsOk.slice(0, 4).some(ok => !ok)) throw new Error('Instrument samples failed to load. Tap Play to retry.');
    status('');
  })().catch(async error => {
    await ctx?.close().catch(() => {});
    engineReady = null; ctx = null; node = null; room = null; assets = null; packsOk = [0, 0, 0, 0, 0];
    throw error;
  });
  return engineReady;
}
const post = (m) => node && node.port.postMessage(m);

// ---------------------------------------------------------------------------------------------- the player
export class Player {
  constructor(root, books) {
    this.root = root;
    this.books = books;                                  // id -> {title, file, offset}
    this.song = null; this.prep = null;
    this.state = { playing: false, bar: -1, beat: 0, chorus: 1 };
    this.startSrc = -1; this.loop = null;
    this.s = Object.assign({
      tempo: null, key: 0, feel: 0, choruses: 3, intro: 0, ending: 0, role: 'none', guide: false, leadEvery: false,
      players: [0, 0, 0, 0], levels: [100, 100, 100, 100], lead: 100, leadSound: 6, leadOct: 0, horn: 'C', view: 'chart',
      room: 18, latency: 0, passStep: 0, human: 60, chordMode: 'name', notes: 'staff',
    }, store.get('settings', {}));
    if (!this.s.recordedMelody) {
      if (this.s.leadSound === 0) this.s.leadSound = 4;
      this.s.recordedMelody = true;
    }
    if (!this.s.sax) { this.s.sax = 1; this.s.leadSound = 6; this.save(); }      // once: the recorded alto sax becomes the lead
    this.s.tempo = null; this.s.key = 0;
    this.takes = [];
    this.mix = { mute: [false, false, false, false, false], solo: [false, false, false, false, false] };   // until the page closes
    preload();
    onPos = (d) => this.position(d);
    // a call, Siri or a route change stops the audio: hold the band at this beat, Resume carries on from it
    onAudioState = (state) => {
      if (state !== 'running' && this.state.playing && !this.paused && !this.starting) {
        this.paused = true; post({ t: 'pause' }); this.updateTransport(); this.status('Paused: audio was interrupted');
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state.playing && !this.paused) { ctx?.resume().catch(() => {}); this.wake(true); }
    });
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this.resized(), 150); });
    // keys (and Bluetooth page-turner pedals, which send arrows or Page Up / Page Down)
    document.addEventListener('keydown', (e) => {
      const b = document.body.classList;
      if (!b.contains('playing-view') || b.contains('browsing') || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName || '';
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      const act = {
        Space: () => { if (tag !== 'BUTTON') this.toggle(); else return false; },
        ArrowRight: () => this.toggle(), PageDown: () => this.toggle(),
        ArrowLeft: () => this.stop(), PageUp: () => this.stop(),
        ArrowUp: () => this.setTempo(this.s.tempo + (e.shiftKey ? 1 : 5)), ArrowDown: () => this.setTempo(this.s.tempo - (e.shiftKey ? 1 : 5)),
        KeyL: () => $('.btn-loop', this.root)?.click(), KeyS: () => this.setStage(!this.stage), KeyR: () => this.toggleRec(),
        Escape: () => { if (this.stage) this.setStage(false); else return false; },
      }[e.code];
      if (act && act() !== false) e.preventDefault();
    });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.stage) this.setStage(false); });
  }
  save() { const { tempo, key, feel, ...rest } = this.s; store.set('settings', rest); }
  // what you last used for this tune
  saveTune() { if (this.song) store.set('tune.' + this.song.id, { tempo: this.trainBase || this.s.tempo, key: this.s.key, feel: this.s.feel }); }
  setTempo(v, remember = true) {
    const s = this.s, r = this.root;
    v = Math.max(40, Math.min(320, Math.round(+v || 120))); s.tempo = v;
    for (const sel of ['.in-tempo', '.in-tempo-r']) { const el = $(sel, r); if (el) el.value = v; }
    $('.in-tempo-r', r)?.setAttribute('aria-valuetext', v + ' BPM');
    post({ t: 'tempo', bpm: v });
    if (remember) { this.trainBase = null; this.saveTune(); }
  }
  async wake(on) {
    try {
      if (on && !this.wakeLock && navigator.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) { const w = this.wakeLock; this.wakeLock = null; await w.release(); }
    } catch { /* the screen may sleep: not fatal */ }
  }
  setStage(on) {
    this.stage = !!on;
    document.body.classList.toggle('stage', this.stage);
    const b = $('.btn-stage', this.root); if (b) { b.setAttribute('aria-pressed', String(this.stage)); b.textContent = this.stage ? 'Exit stage' : 'Stage'; }
    try {
      if (this.stage && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (!this.stage && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* phones without fullscreen: the stage layout still applies */ }
    if (this.panel !== 'score') $('[data-panel=score]', this.root)?.click();
    this.drawChart();
    if (this.state.playing && this.lastSrc != null) this.highlight(this.lastSrc, this.lastBeat);
  }

  open(song) {
    if (this.state.playing) this.stop();
    this.loadRequest = (this.loadRequest || 0) + 1;
    this.starting = false;
    this.song = song;
    const mine = store.get('tune.' + song.id, {});
    this.s.tempo = mine.tempo || song.tempo || defaultTempo(song);
    this.s.key = mine.key || 0; this.startSrc = -1; this.loop = null; this.sel = null; this.picking = false; this.trainBase = null;
    this.s.feel = mine.feel ?? song.feel ?? guessFeel(song);
    document.body.classList.add('playing-view');        // visible first: the chart lays out by its width
    this.render();
    this.reprep();

  }
  close() { this.stop(); document.body.classList.remove('playing-view'); }

  reprep() {
    this.prep = prepare(this.song, { feel: this.s.feel, bpm: this.s.tempo });
    this.drawChart();
    if (node) this.sendSong();
  }
  sendSong() {
    const p = this.prep;
    post({ t: 'song', bars: p.barBytes, nbars: p.form.length, beats: p.beats, bpm: this.s.tempo, feel: this.s.feel, lead: p.lead, pick: p.pick });
    this.sendAll();
  }
  sendAll() {
    if (!node) return;
    const s = this.s;
    post({ t: 'tempo', bpm: s.tempo });
    post({ t: 'feel', feel: s.feel });
    post({ t: 'transpose', semis: s.key });
    s.players.forEach((who, inst) => post({ t: 'player', inst, who }));
    this.sendLevels();
    post({ t: 'form', choruses: s.choruses, ending: s.ending, intro: s.intro, turn: 0 });
    post({ t: 'human', amount: s.human });
    post({ t: 'leadmask', mask: this.leadMask() });
    this.sendLoop();
  }
  sendLevels() {
    const s = this.s, muted = { piano: 2, guitar: 3, bass: 1, drums: 0 }[s.role];
    const heard = (ch) => this.heard(ch);                  // the mixer's mute and solo buttons (4 = the melody)
    LVL_DEFAULT.forEach((d, i) => post({ t: 'level', inst: i, value: i === muted || !heard(i) ? 1 : Math.min(32767, Math.round(d * s.levels[i] / 100)) }));
    let lead = Math.round(LEAD_DEFAULT * s.lead / 100);
    if (s.role === 'lead') lead = s.guide ? Math.round(lead * 0.22) : 0;
    if (!heard(4)) lead = 0;
    this.root.querySelectorAll('.channel[data-ch]').forEach(el => el.classList.toggle('silent', !heard(+el.dataset.ch)));
    post({ t: 'leadsound', sound: s.leadSound === 6 && !packsOk[4] ? 4 : s.leadSound, level: lead, oct: s.leadOct });
  }
  heard(ch) { const m = this.mix; return !m.mute[ch] && (!m.solo.some(Boolean) || m.solo[ch]); }
  leadMask() {
    const n = this.s.choruses;
    if (this.s.leadEvery || n === 1) return 0xFFFFFFFF;
    if (n === 0) return 1;                               // until "finish": the head at the start
    return (1 | (1 << Math.min(31, n - 1))) >>> 0;       // the head in and out; the choruses between are for solos
  }
  sendLoop() {
    if (!node) return;
    const f = this.prep.form;
    if (this.loop) {
      const a = f.indexOf(this.loop[0]);
      let b = -1; for (let j = Math.max(0, a); j < f.length; j++) if (f[j] === this.loop[1]) { b = j; break; }
      post({ t: 'loop', from: a, to: b < 0 ? a : b, kstep: 0 });
    } else post({ t: 'loop', from: -1, to: -1, kstep: 0 });
  }

  async toggle() {
    if (!this.state.playing) {
      if (!this.starting) await this.play();
      return;
    }
    this.paused = !this.paused;
    if (!this.paused) await ctx?.resume().catch(() => {});
    post({ t: this.paused ? 'pause' : 'resume' });
    this.wake(!this.paused);
    this.updateTransport();
  }
  async play() {
    const request = this.loadRequest;
    this.starting = true;
    this.updateTransport();
    try {
      await ensureEngine((m) => { if (request === this.loadRequest) this.status(m); });
      await ctx.resume();
    } catch (err) {
      if (request !== this.loadRequest) return;
      this.starting = false;
      this.updateTransport();
      this.status('Audio could not start. ' + (err.message || err));
      return;
    }
    if (request !== this.loadRequest) return;
    this.starting = false;
    this.paused = false;
    this.sendSong();
    const from = this.loop ? this.prep.form.indexOf(this.loop[0]) : this.startSrc >= 0 ? this.prep.form.indexOf(this.startSrc) : -1;
    post({ t: 'play', from });
    this.state.playing = true;
    this.passes = 0; this.lastBarIdx = null; this.lastBeatIdx = 0;
    this.wake(true);
    this.updateTransport();
  }
  stop() {
    this.paused = false; post({ t: 'stop' }); this.state.playing = false; this.state.bar = -1;
    if (this.trainBase) this.setTempo(this.trainBase, false);
    this.trainBase = null;
    this.wake(false); this.cue(''); this.updateTransport(); this.highlight(-1);
  }
  finish() { post({ t: 'finish' }); }

  position(d) {
    const was = this.state.playing;
    this.state = { playing: d.state !== 0, bar: d.bar, beat: d.beat, chorus: d.chorus, kind: d.kind, state: d.state };
    if (!this.state.playing) this.paused = false;
    if (was !== this.state.playing) this.updateTransport();
    if (!this.state.playing) {
      this.highlight(-1); this.status(''); this.cue(''); this.wake(false);
      if (this.trainBase) { this.setTempo(this.trainBase, false); this.trainBase = null; }
      if (was) this.onended?.();                         // the band played its ending (Stop never gets here)
      return;
    }
    const src = d.state === 2 ? (this.prep.pickup ? 'pickup' : -1) : d.kind === 0 ? this.prep.form[d.bar] : -2;
    const n = this.s.choruses, mask = this.leadMask(), has = (c) => !!((mask >>> (Math.min(32, c) - 1)) & 1);
    // what is coming: the count, and a bar's notice before the melody leaves or returns
    let cue = '';
    if (d.state === 2) cue = String(d.beat + 1);
    else if (d.kind === 0 && !this.loop && d.bar === this.prep.form.length - 1 && !(n && d.chorus >= n) && has(d.chorus) !== has(d.chorus + 1)) cue = has(d.chorus + 1) ? 'Melody next' : 'Solos next';
    // a loop gets a little faster each pass (the tune's own tempo comes back at Stop)
    if (this.loop && d.state === 3 && d.kind === 0) {
      const wrapped = this.lastBarIdx != null && (d.bar < this.lastBarIdx || (d.bar === this.lastBarIdx && d.beat < this.lastBeatIdx));
      this.lastBarIdx = d.bar; this.lastBeatIdx = d.beat;
      if (wrapped) {
        this.passes++;
        if (this.s.passStep > 0 && this.s.tempo < 320) { this.trainBase = this.trainBase || this.s.tempo; this.setTempo(this.s.tempo + this.s.passStep, false); }
      }
    }
    const delay = Math.max(0, ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 + (this.s.latency || 0));
    clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => { if (this.state.playing) { this.highlight(src, d.beat); this.cue(cue, d.state === 2); } }, delay);
    const what = d.state === 2 ? 'Count-in' : d.kind === 5 ? 'Intro' : d.kind === 0 ? `Chorus ${d.chorus}${n ? ' of ' + n : ''}` : 'Ending';
    const solo = d.kind === 0 && !has(d.chorus);
    const where = this.loop && d.kind === 0 ? `Loop pass ${this.passes + 1} · ${this.s.tempo} BPM` : what;
    this.status(`${where}${d.kind === 0 ? ' · bar ' + (this.prep.form[d.bar] + 1) : ''}${this.loop ? '' : solo ? ' · solos' : d.kind === 0 ? ' · head' : ''}`);
  }
  cue(text, big) {
    const el = $('.pl-cue', this.root); if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text; el.classList.toggle('count', !!big);
  }

  // ------------------------------------------------------------------------------------------ recording a take
  async toggleRec() {
    if (this.rec) { this.rec.stop(); return; }
    try { await ensureEngine((m) => this.status(m)); await ctx.resume(); }
    catch (err) { this.status('Audio could not start. ' + (err.message || err)); return; }
    if (!window.MediaRecorder) { this.status('This browser cannot record.'); return; }
    const dest = ctx.createMediaStreamDestination();
    // the band reaches the recorder straight away, your playing only after it left the speaker and came back through
    // the microphone: hold the band back by that much so the take lines up
    const hold = ctx.createDelay(1);
    hold.delayTime.value = Math.min(1, (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + (this.s.latency || 0) / 1000);
    room.output.connect(hold).connect(dest);
    let mic = null, micNode = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      micNode = ctx.createMediaStreamSource(mic); micNode.connect(dest);
    } catch { this.status('No microphone: recording the band only'); }
    const chunks = [], rec = new MediaRecorder(dest.stream), song = this.song;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      this.rec = null;
      room?.output.disconnect(hold); micNode?.disconnect(); mic?.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const ext = /mp4|aac/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
      this.takes.unshift({ url: URL.createObjectURL(blob), name: `${song.title} take ${this.takes.length + 1}.${ext}`, title: song.title, at: new Date() });
      this.drawTakes(); this.updateRec();
      this.status('Take saved: open Setup to listen');
    };
    this.rec = rec; rec.start(); this.updateRec();
    if (!this.state.playing && !this.starting) this.play();
  }
  updateRec() {
    const b = $('.btn-rec', this.root); if (!b) return;
    b.textContent = this.rec ? '■ Save take' : '● Rec'; b.setAttribute('aria-pressed', String(!!this.rec));
  }
  drawTakes() {
    const el = $('.takes', this.root); if (!el) return;
    el.innerHTML = this.takes.length ? this.takes.map(t => `<div class="take"><span>${esc(t.title)} · ${t.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <audio controls preload="metadata" src="${t.url}"></audio><a download="${esc(t.name)}" href="${t.url}">Save file</a></div>`).join('')
      : '<p class="takes-empty">No takes yet. Press ● Rec, play along, then press it again: your microphone and the band are recorded together. Takes stay until you close the page; use Save file to keep one.</p>';
  }
  status(m) { const el = $('.pl-status', this.root); if (el) el.textContent = m; this.root.classList.toggle('has-status', !!m); }
  updateTransport() {
    const b = $('.pl-play', this.root);
    if (!b) return;
    const [icon, name] = this.starting ? ['wait', 'Loading'] : this.paused ? ['play', 'Resume'] : this.state.playing ? ['pause', 'Pause'] : ['play', 'Play'];
    if (b.getAttribute('aria-label') !== name) { b.innerHTML = ICON[icon]; b.setAttribute('aria-label', name); b.title = name; }
    b.disabled = !!this.starting;
    $('.pl-stop', this.root).disabled = !this.state.playing;
    b.classList.toggle('stop', this.state.playing);
    $('.pl-finish', this.root).disabled = !this.state.playing || this.paused;
  }

  // ------------------------------------------------------------------------------------------ view
  render() {
    const song = this.song, s = this.s, book = this.books[song.book] || {};
    const tonic = keyTonic(song.key || 0);
    const keyOpts = [];
    for (let k = -6; k <= 6; k++) keyOpts.push(`<option value="${k}" ${k === s.key ? 'selected' : ''}>${KEY_NAMES[(tonic + k + 120) % 12]}${k === 0 ? ' (written)' : (k > 0 ? ' +' : ' ') + k}</option>`);

    this.root.innerHTML = `
      <div class="song-head">
        <div><h2>${esc(song.title)}</h2><p class="song-meta">${esc(song.composer || book.title)} · ${song.time[0]}/${song.time[1]} · ${song.bars.length} bars</p><p class="pl-status" role="status"></p></div>
        <span class="head-buttons"><button class="pl-fav" type="button" aria-pressed="false" aria-label="Add to my list" title="Add to my list">☆</button>
        <button class="pl-back" type="button">Songs</button></span>
      </div>
      <section class="mix-sheet panel" aria-label="Band mixer" hidden>
        <h3>Band mixer <label class="out-meter">Output <meter class="pl-output" aria-label="Audio output level" min="-90" max="0" value="-90"></meter></label></h3>
        <section class="channel room-channel"><h4>Room</h4><span class="room-note">Reverb around the band</span>
          <label class="fader"><input type="range" aria-label="Room level" class="in-room" min="0" max="60" value="${s.room}"><output>${s.room}%</output></label></section>
        ${[...INST, 'Melody'].map((name,i) => {
          const lead = i === INST.length;
          const choices = lead ? LEAD_VOICES.map(([label]) => label) : PLAYERS[i];
          const selected = lead ? s.leadSound : s.players[i];
          const level = lead ? s.lead : s.levels[i];
          return `<section class="channel" data-ch="${i}"><h4>${name}</h4>
            <div class="picker"><button type="button" data-step="-1" aria-label="Previous ${name} sound">‹</button>
            <select class="${lead ? 'in-leadsound' : 'in-player'}" data-i="${i}" aria-label="${name} player" aria-describedby="voice-note-${i}">${choices.map((n,k) => `<option value="${k}" ${selected===k?'selected':''}>${esc(n)}</option>`).join('')}</select>
            <button type="button" data-step="1" aria-label="Next ${name} sound">›</button></div>
            <p class="player-note" id="voice-note-${i}">${esc(lead ? LEAD_VOICES[selected][1] : STYLE_NOTES[i][selected])}</p>
            <span class="ms"><button type="button" class="btn-mute" data-ch="${i}" aria-pressed="${this.mix.mute[i]}" aria-label="Mute ${name}" title="Mute ${name}">M</button><button type="button" class="btn-solo" data-ch="${i}" aria-pressed="${this.mix.solo[i]}" aria-label="Solo ${name}" title="Solo ${name}: only the soloed parts sound">S</button></span>
            <label class="fader"><input type="range" aria-label="${name} level" class="in-level" data-i="${lead?'lead':i}" min="0" max="150" value="${level}"><output>${level}%</output></label>
          </section>`;
        }).join('')}
      </section>
      <section class="setup-sheet panel" aria-label="Song settings" hidden><h3>Song settings</h3>
      <div class="pl-bar">
        <button type="button" class="pl-btn pl-finish" disabled>Finish after chorus</button>
        <label>Key <select class="in-key">${keyOpts.join('')}</select></label>
        <label>Feel <select class="in-feel"><option value="0">Swing</option><option value="1">Ballad</option><option value="2">Bossa / straight</option></select></label>
        <span class="pl-break"></span>
        <span class="pl-field">You play</span>
        <span class="pl-seg seg-role">${ROLES.map(([v, t]) => `<button type="button" data-v="${v}" class="${s.role === v ? 'on' : ''}">${t}</button>`).join('')}</span>
        <label class="lbl-guide" title="The melody stays in, quietly, to guide you"><input type="checkbox" class="in-guide" ${s.guide ? 'checked' : ''}> Guide melody</label>
        <label>Choruses <select class="in-chor">${[1, 2, 3, 4, 5, 6, 8].map(n => `<option value="${n}">${n}</option>`).join('')}<option value="0">Until Finish</option></select></label>
        <label title="Off: the melody is played in the first and last chorus, the choruses between are for solos"><input type="checkbox" class="in-every" ${s.leadEvery ? 'checked' : ''}> Melody every chorus</label>
      </div>

        <div class="pl-grid">
          <label>Lead octave<select class="in-leadoct"><option value="-1">Down</option><option value="0">As written</option><option value="1">Up</option></select></label>
          <label>Count-in<select class="in-intro"><option value="0">One bar count</option><option value="1">Last 4 bars</option><option value="2">Turnaround intro</option></select></label>
          <label>Ending<select class="in-ending"><option value="0">Final chord</option><option value="1">Tag (3 times)</option></select></label>
          <label>Chords for<select class="in-horn">${HORNS.map(([v, , t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <label title="How human the band plays: placement around the beat and note-to-note dynamics">Band feel<select class="in-human"><option value="0">Exact (on the grid)</option><option value="35">Tight</option><option value="60">Natural</option><option value="100">Loose</option></select></label>
          <label>Chords shown as<select class="in-chordmode"><option value="name">Names (Dm7 G7)</option><option value="func">Functions (ii7 V7)</option></select></label>
          <label>Melody shown as<select class="in-notes"><option value="staff">Notes on a staff</option><option value="roll">Outline</option></select></label>
          <label title="Each time a loop comes round it gets a little faster. Stop brings the tempo back.">Loop speed-up<select class="in-pass"><option value="0">Same tempo each pass</option><option value="2">+2 BPM each pass</option><option value="4">+4 BPM each pass</option><option value="8">+8 BPM each pass</option></select></label>
          <label title="Bluetooth speakers and headphones play late. Raise this until the moving bar matches what you hear.">Speaker delay (ms)<input type="number" class="in-latency" min="0" max="500" step="10" value="${s.latency}" inputmode="numeric"></label>
        </div>
        <h3>Your takes</h3><div class="takes"></div>
        <h3>Keys and pedals</h3>
        <p class="keys-help">Space, → or Page Down: play / pause · ← or Page Up: stop · ↑ ↓: tempo (Shift: by 1) · L: loop · S: stage view · R: record. A Bluetooth page-turner pedal works as play / pause and stop.</p>
        </section>
      <section class="score-panel panel">${song.scanned ? '<small>Read from a scanned page: some notes or chords may be wrong. Check the original page.</small>' : song.problems?.length ? '<small>Some measures may be misread. Check the original page.</small>' : ''}
      <div class="toolbar"><div class="quick" aria-label="Practice controls">
        <label>You play <select class="in-role-q" aria-label="You play">${ROLES.map(([v, t]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button type="button" class="btn-func" aria-pressed="false" title="Show chords as functions (ii7 V7 I) or as names" aria-label="Chord functions">ii–V</button>
        <button type="button" class="btn-stage" aria-pressed="false" title="Large chart for a music stand">Stage</button>
        <button type="button" class="btn-rec" aria-pressed="false" title="Record yourself with the band">● Rec</button>
      </div>
      <div class="pl-tabs">
        <span class="pl-seg seg-view"><button type="button" data-v="chart" title="Melody and chords">Chart</button><button type="button" data-v="chords" title="Chords only, four bars to a line">Chords</button><button type="button" data-v="page">Original page</button></span>
        <button class="pl-btn btn-loop" type="button" title="Loop the bars you selected">Loop</button>
        <button class="pl-btn btn-clear" type="button">Clear selection</button>
        <label class="follow-control"><input type="checkbox" class="in-follow" checked> Follow score</label><span class="pl-hint">Tap a measure to jump there · to loop: tap the first bar, Loop, then the last bar (or Shift-click) · Space plays / pauses</span>
      </div></div>
      <div class="pl-stagewrap"><div class="pl-view"></div><div class="pl-cue" hidden aria-live="polite"></div></div></section>
      <div class="tempo-strip"><label for="tempo-slider">Tempo</label>
        <input id="tempo-slider" type="range" class="in-tempo-r" min="40" max="320" value="${s.tempo}" aria-valuetext="${s.tempo} BPM">
        <input type="number" class="in-tempo" aria-label="Tempo in beats per minute" min="40" max="320" value="${s.tempo}" inputmode="numeric"><span>BPM</span>
      </div>
      <nav class="dock" aria-label="Playback controls">
        <button class="pl-play" type="button" aria-label="Play" title="Play">${ICON.play}</button>
        <button type="button" class="pl-stop" aria-label="Stop" title="Stop" disabled>${ICON.stop}</button>
        <button type="button" data-panel="score" aria-pressed="true">Score</button>
        <button type="button" data-panel="mix" aria-pressed="false">Mixer</button>
        <button type="button" data-panel="setup" aria-pressed="false">Setup</button>
      </nav>`;
    const r = this.root;
    $('.in-feel', r).value = s.feel; $('.in-chor', r).value = s.choruses; $('.in-leadsound', r).value = s.leadSound;
    $('.in-leadoct', r).value = s.leadOct; $('.in-intro', r).value = s.intro; $('.in-ending', r).value = s.ending; $('.in-horn', r).value = s.horn;
    $('.lbl-guide', r).style.display = s.role === 'lead' ? '' : 'none';
    this.panel = 'score';
    $('.pl-back', r).onclick = () => this.onbrowse?.();
    $('.pl-stop', r).onclick = () => this.stop();
    $('.pl-play', r).onclick = () => this.toggle();
    $('.pl-finish', r).onclick = () => this.finish();
    const panels = {score: $('.score-panel',r), mix: $('.mix-sheet',r), setup: $('.setup-sheet',r)};
    r.querySelectorAll('[data-panel]').forEach(button => button.onclick = () => {
      this.panel = button.dataset.panel;
      for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== this.panel;
      r.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      if (this.panel === 'score') {
        this.resized();
        if (this.state.playing && this.lastSrc != null) this.highlight(this.lastSrc, this.lastBeat);
      }
    });
    r.querySelectorAll('[data-step]').forEach(button => button.onclick = () => {
      const select = button.parentElement.querySelector('select');
      select.selectedIndex = (select.selectedIndex + Number(button.dataset.step) + select.length) % select.length;
      select.dispatchEvent(new Event('change'));
    });
    const setTempo = (v) => this.setTempo(v);
    $('.in-tempo', r).onchange = (e) => setTempo(e.target.value);
    $('.in-tempo-r', r).oninput = (e) => setTempo(e.target.value);
    $('.in-key', r).onchange = (e) => { s.key = +e.target.value; post({ t: 'transpose', semis: s.key }); this.saveTune(); this.drawChart(); };
    this.roman = null;
    $('.in-feel', r).onchange = (e) => { s.feel = +e.target.value; this.saveTune(); this.reprep(); };
    const setRole = (v) => {
      s.role = v; this.save();
      r.querySelectorAll('.seg-role button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
      $('.in-role-q', r).value = v;
      $('.lbl-guide', r).style.display = s.role === 'lead' ? '' : 'none';
      this.sendLevels();
    };
    $('.seg-role', r).onclick = (e) => { const b = e.target.closest('button'); if (b) setRole(b.dataset.v); };
    $('.in-role-q', r).onchange = (e) => setRole(e.target.value);
    $('.btn-rec', r).onclick = () => this.toggleRec();
    r.querySelectorAll('.btn-mute, .btn-solo').forEach(b => b.onclick = () => {
      const list = b.classList.contains('btn-mute') ? this.mix.mute : this.mix.solo, ch = +b.dataset.ch;
      list[ch] = !list[ch]; b.setAttribute('aria-pressed', String(list[ch]));
      this.sendLevels();
    });
    const setMode = (v) => {
      s.chordMode = v; this.save();
      $('.in-chordmode', r).value = v; $('.btn-func', r).setAttribute('aria-pressed', String(v === 'func'));
      this.drawChart(); if (this.state.playing && this.lastSrc != null) this.highlight(this.lastSrc, this.lastBeat);
    };
    $('.in-chordmode', r).value = s.chordMode; $('.btn-func', r).setAttribute('aria-pressed', String(s.chordMode === 'func'));
    $('.in-chordmode', r).onchange = (e) => setMode(e.target.value);
    $('.btn-func', r).onclick = () => setMode(s.chordMode === 'func' ? 'name' : 'func');
    $('.in-notes', r).value = s.notes;
    $('.in-notes', r).onchange = (e) => { s.notes = e.target.value; this.save(); this.drawChart(); };
    $('.in-human', r).value = s.human;
    $('.in-human', r).onchange = (e) => { s.human = +e.target.value; this.save(); post({ t: 'human', amount: s.human }); };
    $('.btn-stage', r).onclick = () => this.setStage(!this.stage);
    $('.in-pass', r).value = s.passStep;
    $('.in-pass', r).onchange = (e) => { s.passStep = +e.target.value; this.save(); };
    $('.in-latency', r).onchange = (e) => { s.latency = Math.max(0, Math.min(500, Math.round(+e.target.value || 0))); e.target.value = s.latency; this.save(); };
    $('.in-room', r).oninput = (e) => { s.room = +e.target.value; e.target.nextElementSibling.textContent = s.room + '%'; room?.set(s.room); this.save(); };
    const fav = $('.pl-fav', r), showFav = () => {
      const on = store.get('favs', []).includes(song.id);
      fav.textContent = on ? '★' : '☆'; fav.setAttribute('aria-pressed', String(on));
      fav.setAttribute('aria-label', on ? 'Remove from my list' : 'Add to my list'); fav.title = fav.getAttribute('aria-label');
    };
    fav.onclick = () => {
      const list = store.get('favs', []), k = list.indexOf(song.id);
      if (k >= 0) list.splice(k, 1); else list.push(song.id);
      store.set('favs', list); showFav(); this.onfavs?.();
    };
    showFav(); this.showFav = showFav;
    this.drawTakes(); this.updateRec();
    if (this.stage) { document.body.classList.add('stage'); $('.btn-stage', r).textContent = 'Exit stage'; $('.btn-stage', r).setAttribute('aria-pressed', 'true'); }
    $('.in-guide', r).onchange = (e) => { s.guide = e.target.checked; this.save(); this.sendLevels(); };
    $('.in-chor', r).onchange = (e) => { s.choruses = +e.target.value; this.save(); this.sendAll(); };
    $('.in-every', r).onchange = (e) => { s.leadEvery = e.target.checked; this.save(); post({ t: 'leadmask', mask: this.leadMask() }); };
    r.querySelectorAll('.in-player').forEach(el => el.onchange = () => { s.players[+el.dataset.i] = +el.value; el.closest('.channel').querySelector('.player-note').textContent = STYLE_NOTES[+el.dataset.i][+el.value]; this.save(); post({ t: 'player', inst: +el.dataset.i, who: +el.value }); });
    $('.in-leadsound', r).onchange = (e) => { s.leadSound = +e.target.value; e.target.closest('.channel').querySelector('.player-note').textContent = LEAD_VOICES[s.leadSound][1]; this.save(); this.sendLevels(); };
    $('.in-leadoct', r).onchange = (e) => { s.leadOct = +e.target.value; this.save(); this.sendLevels(); };
    $('.in-intro', r).onchange = (e) => { s.intro = +e.target.value; this.save(); this.sendAll(); };
    $('.in-ending', r).onchange = (e) => { s.ending = +e.target.value; this.save(); this.sendAll(); };
    $('.in-horn', r).onchange = (e) => { s.horn = e.target.value; this.save(); this.drawChart(); };
    r.querySelectorAll('.in-level').forEach(el => el.oninput = () => {
      const v = +el.value; el.nextElementSibling.textContent = v + '%';
      if (el.dataset.i === 'lead') s.lead = v; else s.levels[+el.dataset.i] = v;
      this.save(); this.sendLevels();
    });
    $('.seg-view', r).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; s.view = b.dataset.v; this.save(); this.drawChart(); };
    $('.btn-loop', r).onclick = () => {
      if (this.loop || this.picking) { this.picking = false; this.loopOff(); return; }
      if (!this.sel) return;
      if (this.sel[0] === this.sel[1]) {                  // one bar chosen: the next tap picks the last bar
        this.picking = true; const lb = $('.btn-loop', r); lb.textContent = 'Tap the last bar'; lb.classList.add('on'); return;
      }
      this.loop = this.sel.slice(); this.sendLoop(); this.drawChart();
    };
    $('.btn-clear', r).onclick = () => { this.sel = null; this.startSrc = -1; this.picking = false; this.loopOff(); };
    this.updateTransport();
  }
  loopOff() { this.loop = null; this.sendLoop(); this.drawChart(); }

  chordLabel(sym) {
    const horn = HORNS.find(h => h[0] === this.s.horn) || HORNS[0];
    const semis = this.s.key + horn[1];
    const flats = ![2, 4, 7, 9, 11].includes(((keyTonic(this.song.key || 0) + semis) % 12 + 12) % 12) || (this.song.key || 0) < 0;
    return prettySym(transposeSym(sym, ((semis % 12) + 12) % 12, flats));
  }

  drawChart() {
    const r = this.root, view = $('.pl-view', r);
    if (!view || !this.prep) return;
    r.querySelectorAll('.seg-view button').forEach(b => b.classList.toggle('on', b.dataset.v === this.s.view));
    const lb = $('.btn-loop', r);
    lb.classList.toggle('on', !!this.loop); lb.textContent = this.loop ? 'Loop on' : 'Loop';
    lb.disabled = !this.loop && !this.sel;
    if (this.s.view === 'page') { this.drawPages(view); return; }
    const p = this.prep, song = this.song, barLen = p.barLen;
    const grid = this.s.view === 'chords';                 // chords only, four bars to a line
    const narrow = (view.clientWidth || innerWidth) < 700; // phones: compact chord symbols in every view
    const staff = !grid && this.s.notes !== 'roll', func = this.s.chordMode === 'func';
    if (func && !this.roman) this.roman = romanize(song.bars, song.key || 0);
    // the staff: bar height, and the written pitch for the reader (key change and transposing instrument)
    const barH = grid ? (this.stage ? Math.max(84, Math.min(140, Math.round(innerHeight * 0.13))) : (view.clientWidth || innerWidth) < 700 ? 58 : 70)
      : this.stage ? Math.max(120, Math.min(230, Math.round(innerHeight * 0.21))) : (view.clientWidth || innerWidth) < 700 ? 104 : 116;
    const horn = HORNS.find(x => x[0] === this.s.horn) || HORNS[0];
    let shift = this.s.key + horn[1];
    if (staff) {                                           // keep the transposed line on the staff
      let sum = 0, cnt = 0;
      for (const b of song.bars) for (let k = 2; k < b.n.length; k += 3) if (b.n[k]) { sum += (b.n[k] & 127) + shift; cnt++; }
      while (cnt && sum / cnt > 78) { shift -= 12; sum -= 12 * cnt; }
      while (cnt && sum / cnt < 60) { shift += 12; sum += 12 * cnt; }
    }
    const keyAt = []; { let k = song.key || 0; song.bars.forEach((b, i) => { if (b.k !== undefined) k = b.k; keyAt[i] = transposeKey(k, this.s.key + horn[1]); }); }
    // pitch range for the little melody rolls
    let lo = 127, hi = 0;
    for (const b of song.bars) for (let k = 2; k < b.n.length; k += 3) if (b.n[k]) { const q = b.n[k] & 127; lo = Math.min(lo, q); hi = Math.max(hi, q); }
    if (lo > hi) { lo = 60; hi = 72; }
    const span = Math.max(8, hi - lo + 1);
    const barHTML = (b, i, cls, len, k) => {
      const L = len || barLen;
      const map = staff ? barMap(b.n, L) : null;            // chords stand over their notes
      const left = (t) => map ? Math.max(0, map(t) - 7) : t / L * 100;
      const label = (c, ci) => func ? this.roman[k][ci] : this.chordLabel(c[1]);
      // chords only: the root large, the quality small and raised, so two or three chords fit a narrow bar
      const compact = (t) => {
        const m = /^((?:sub)?[♭♯]?(?:[A-G]|[ivIV]+)[♭♯]?)(.*)$/.exec(t);
        if (!m) return esc(t);
        const q = m[2].replace(/^maj/, 'Δ').replace(/^m7\(♭5\)/, 'ø7').replace(/^m(?!a)/, '–').replace(/\(([^)]*)\)/g, ' $1');
        return esc(m[1]) + (q ? `<sup>${esc(q)}</sup>` : '');
      };
      const chords = b.c.map((c, ci) => `<span style="left:${left(c[0]).toFixed(1)}%">${grid || narrow ? compact(label(c, ci)) : esc(label(c, ci))}</span>`).join('');
      let rects = '';
      if (grid) {
        const tags = [b.sg && b.sg.includes('segno') ? '𝄋' : '', b.sg && b.sg.includes('coda') ? '𝄌' : '', b.ds ? 'D.S.' : '', b.dc ? 'D.C.' : '', b.fn ? 'Fine' : ''].filter(Boolean).join(' ');
        const volta = b.e ? `<div class="volta">${b.e.join(', ')}.</div>` : '';
        const classes = ['bar', cls, b.rs ? 'rs' : '', b.re ? 're' : '', b.db ? 'db' : ''].filter(Boolean).join(' ');
        return `<div class="${classes}" data-src="${i}">${volta}<div class="chords">${chords || '<span class="simile" style="left:50%" aria-label="same chord">%</span>'}</div>${tags ? `<span class="tag">${tags}</span>` : ''}</div>`;
      }
      if (staff) {
        const busy = Math.max(1, Math.min(2.2, b.n.length / 3 / 4.5));   // a crowded bar takes more of the line
        const nx = song.bars[k + 1], last = b.n.length ? b.n[b.n.length - 1] & 127 : 0;
        const tieOut = !!(nx && nx.n.length && nx.n[2] >= 128 && (nx.n[2] & 127) === last && last);
        const tags = [b.sg && b.sg.includes('segno') ? '𝄋' : '', b.sg && b.sg.includes('coda') ? '𝄌' : '', b.ds ? 'D.S.' : '', b.dc ? 'D.C.' : '', b.fn ? 'Fine' : ''].filter(Boolean).join(' ');
        const volta = b.e ? `<div class="volta">${b.e.join(', ')}.</div>` : '';
        const classes = ['bar', cls, b.rs ? 'rs' : '', b.re ? 're' : '', b.db ? 'db' : ''].filter(Boolean).join(' ');
        return `<div class="${classes}" data-src="${i}" style="flex-grow:${busy.toFixed(2)}">${volta}${staffBar(b.n, L, keyAt[k], shift, barH, tieOut, rowKey)}<div class="chords">${chords}</div>${tags ? `<span class="tag">${tags}</span>` : ''}</div>`;
      }
      for (let k = 0; k < b.n.length; k += 3) {
        const t = b.n[k], d = b.n[k + 1], q = b.n[k + 2];
        if (!q) continue;
        const y = (hi - (q & 127)) / span * 93;
        rects += `<rect x="${(t / L * 100).toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0.8, d / L * 100 - 0.8).toFixed(2)}" height="${Math.max(7, 100 / span * 0.9).toFixed(2)}" rx="0.6"/>`;
      }
      const tags = [b.sg && b.sg.includes('segno') ? '𝄋' : '', b.sg && b.sg.includes('coda') ? '𝄌' : '', b.ds ? 'D.S.' : '', b.dc ? 'D.C.' : '', b.fn ? 'Fine' : ''].filter(Boolean).join(' ');
      const volta = b.e ? `<div class="volta">${b.e.join(', ')}.</div>` : '';
      const classes = ['bar', cls, b.rs ? 'rs' : '', b.re ? 're' : '', b.db ? 'db' : ''].filter(Boolean).join(' ');
      return `<div class="${classes}" data-src="${i}">${volta}<div class="chords">${chords}</div>
        <svg class="roll" viewBox="0 0 100 100" preserveAspectRatio="none">${rects}</svg>${tags ? `<span class="tag">${tags}</span>` : ''}</div>`;
    };
    // rows: the lines of the printed page when there is room; else 4 (or 2) bars a line, a new line at each section
    const rows = [];
    const bodyStart = song.pickup ? 1 : 0;
    const per = this.perLine(view);
    this.chartMode = per + ':' + this.s.view;
    // a new key signature starts a new line (it is drawn at the start of the line)
    const newKey = (cur, k) => staff && cur.length && k > bodyStart && keyAt[k] !== keyAt[cur[cur.length - 1]];
    if (per) {
      let cur = [];
      song.bars.forEach((b, k) => {
        const i = k - bodyStart, inRow = cur.filter(x => x >= bodyStart).length;
        if (grid && i < 0) return;                          // the pickup has no chord of its own
        if (i >= 0 && cur.length && (inRow >= per || (i > 0 && p.section[i]) || newKey(cur, k))) { rows.push(cur); cur = []; }
        cur.push(k);
      });
      if (cur.length) rows.push(cur);
    } else {
      let cur = null, lastKey = '';
      song.bars.forEach((b, k) => {
        const key = b.box ? b.box[0] + ':' + b.box[2] : 'n' + Math.floor(k / 4);
        if (key !== lastKey || newKey(cur, k)) { cur = []; rows.push(cur); lastKey = key; }
        cur.push(k);
      });
    }
    let html = '<div class="chart">', rowKey = 0;
    for (const row of rows) {
      const first = row.find(k => k >= bodyStart) - bodyStart;
      const sec = first >= 0 && p.section[first] ? String.fromCharCode(p.section[first]) : '';
      rowKey = keyAt[row[0]];
      html += `<div class="chart-row"><span class="sec">${sec}</span>${staff ? rowHead(rowKey, barH).html : ''}`;
      for (const k of row) {
        if (k < bodyStart) html += barHTML(song.bars[k], 'pickup', 'pickup', song.bars[k].len || barLen, k);
        else html += barHTML(song.bars[k], k - bodyStart, '', 0, k);
      }
      if (per) for (let f = row.filter(k => k >= bodyStart).length; f < per; f++) html += '<div class="bar filler" aria-hidden="true"></div>';
      html += '</div>';
    }
    html += '</div>';
    view.innerHTML = html;
    view.querySelector('.chart').classList.toggle('flow', !!per);
    view.querySelector('.chart').classList.toggle('staffed', staff);
    view.querySelector('.chart').classList.toggle('chordgrid', grid);
    view.querySelector('.chart').style.setProperty('--barh', barH + 'px');
    view.querySelectorAll('.bar:not(.filler)').forEach(el => el.onclick = (e) => this.barClick(el.dataset.src, e.shiftKey));
    this.markSelection();
    this.fitChords();
  }
  perLine(view) {
    if (this.s.view === 'chords') return 4;
    return this.stage ? (view.clientWidth >= 560 ? 4 : 2) : chartPerLine(view.clientWidth);
  }
  // chord names shrink to fit before the next chord (or the bar line)
  fitChords() {
    const view = $('.pl-view', this.root); if (!view) return;
    view.querySelectorAll('.bar').forEach(bar => {
      const spans = [...bar.querySelectorAll('.chords span')];
      spans.forEach(sp => { sp.style.fontSize = ''; });
      // one size for every chord in the bar: the size at which the tightest of them fits
      const measure = () => {
        let sc = 1;
        spans.forEach((sp, k) => {
          const end = k + 1 < spans.length ? spans[k + 1].offsetLeft : bar.clientWidth;
          const room = end - sp.offsetLeft - 3, need = sp.scrollWidth;
          if (need > room && room > 0) sc = Math.min(sc, room / need);
        });
        return sc;
      };
      let scale = measure();
      if (scale < 0.8 && spans.length > 1 && bar.closest('.chordgrid')) {   // chords only: share the bar by need, not by the beat
        const total = spans.reduce((a, sp) => a + sp.scrollWidth + 6, 0);
        let x = 0;
        spans.forEach(sp => { sp.style.left = (x / total * 100).toFixed(1) + '%'; x += sp.scrollWidth + 6; });
        scale = measure();
      }
      if (scale < 1) {                                      // relative to the size the style sheet gives this view
        const base = parseFloat(getComputedStyle(spans[0]).fontSize);
        spans.forEach(sp => { sp.style.fontSize = (base * Math.max(0.55, scale)).toFixed(1) + 'px'; });
      }
    });
  }
  resized() {
    if (this.panel !== 'score' || !this.song || document.body.classList.contains('browsing') || !document.body.classList.contains('playing-view')) return;
    const view = $('.pl-view', this.root); if (!view) return;
    if (this.s.view === 'page') {
      if (Math.abs((this.pageWidth || 0) - view.clientWidth) > 40) this.drawChart();
    } else if (this.perLine(view) + ':' + this.s.view !== this.chartMode) { this.drawChart(); if (this.state.playing && this.lastSrc != null) this.highlight(this.lastSrc, this.lastBeat); }
    else this.fitChords();
  }
  barClick(src, shift) {
    if (src === 'pickup') { this.startSrc = -1; this.sel = null; this.markSelection(); return; }
    src = +src;
    if (this.picking && this.sel) {
      this.picking = false;
      this.sel = [Math.min(this.sel[0], src), Math.max(this.sel[0], src)];
      this.loop = this.sel.slice(); this.startSrc = this.sel[0]; this.sendLoop(); this.drawChart();
      return;
    }
    if (shift && this.sel) this.sel = [Math.min(this.sel[0], src), Math.max(this.sel[0], src)];
    else this.sel = [src, src];
    this.startSrc = this.sel[0];
    const lb = $('.btn-loop', this.root); lb.disabled = false;
    if (shift && this.loop) { this.loop = this.sel.slice(); this.sendLoop(); }
    if (!shift && this.loop && (src < this.loop[0] || src > this.loop[1])) {
      this.loop = null;
      this.sendLoop();
      lb.classList.remove('on');
      lb.textContent = 'Loop';
    }
    this.markSelection();
    if (shift) return;
    if (this.state.playing) {
      const form = this.prep.form;
      // Prefer the occurrence closest to the current pass through a repeated section.
      let target = -1;
      for (let i = 0; i < form.length; i++) {
        if (form[i] === src && (target < 0 || Math.abs(i - this.state.bar) < Math.abs(target - this.state.bar))) target = i;
      }
      if (target >= 0) post({ t: 'seek', bar: target });
    } else this.status('Cued at bar ' + (src + 1));
  }
  markSelection() {
    const view = $('.pl-view', this.root); if (!view) return;
    const range = this.loop || this.sel;
    view.querySelectorAll('.bar, .clickbar').forEach(el => {
      const s = +el.dataset.src;
      el.classList.toggle('inloop', !!range && el.dataset.src !== 'pickup' && s >= range[0] && s <= range[1]);
      el.classList.toggle('start', el.dataset.src !== 'pickup' && s === this.startSrc && !this.loop);
    });
  }
  highlight(src, beat) {
    this.lastSrc = src; this.lastBeat = beat;
    if (this.panel !== 'score' || document.body.classList.contains('browsing')) return;
    const view = $('.pl-view', this.root); if (!view) return;
    view.querySelectorAll('.bar.now').forEach(el => { el.classList.remove('now'); const b = el.querySelector('.beat'); if (b) b.remove(); });
    if (this.s.view === 'page') { this.pageHighlight(src); return; }
    if (src === -1 || src === -2) return;
    const el = view.querySelector(`.bar[data-src="${src}"]`);
    if (!el) return;
    el.classList.add('now');
    const beats = this.prep.beats;
    const bt = document.createElement('div'); bt.className = 'beat';
    bt.style.left = ((beat || 0) / beats * 100) + '%'; bt.style.width = (100 / beats) + '%';
    el.appendChild(bt);
    this.followBar(el);
  }

  followBar(bar) {
    if (!this.state.playing || this.panel !== 'score' || !$('.in-follow', this.root).checked) return;
    const view = $('.pl-view', this.root);
    const target = bar.getBoundingClientRect(), bounds = view.getBoundingClientRect();
    if (this.stage && this.s.view !== 'page') {           // the line being played stays at the top, the next ones below it
      const dy = (bar.closest('.chart-row') || bar).getBoundingClientRect().top - bounds.top;
      if (Math.abs(dy) > 3) view.scrollTop += dy;
    } else if (target.top < bounds.top || target.bottom > bounds.bottom) {
      view.scrollTop += target.top - bounds.top - Math.max(0, (view.clientHeight - target.height) / 2);
    }
  }

  // ------------------------------------------------------------------------------------------ the original page
  async drawPages(view) {
    const song = this.song, book = this.books[song.book];
    view.innerHTML = '<div class="pl-loading">Opening the page…</div>';
    try {
      const pdfjs = await loadPdfJs();
      const doc = await getDoc(pdfjs, book.file);
      if (this.s.view !== 'page' || this.song !== song) return;
      const wrap = document.createElement('div'); wrap.className = 'pdfwrap';
      view.innerHTML = ''; view.appendChild(wrap);
      this.pageEls = {};
      for (const pg of song.pages) {
        const page = await doc.getPage(pg);
        const vp1 = page.getViewport({ scale: 1 });
        const box = document.createElement('div'); box.className = 'pdfpage';
        const canvas = document.createElement('canvas');
        const w = Math.min(860, view.clientWidth || 860), scale = (w / vp1.width) * Math.min(2, window.devicePixelRatio || 1);
        this.pageWidth = view.clientWidth;
        const vp = page.getViewport({ scale });
        canvas.width = vp.width; canvas.height = vp.height;
        box.appendChild(canvas); wrap.appendChild(box);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        this.pageEls[pg] = { box, w: vp1.width, h: vp1.height };
        // clickable bars on the page
        const bodyStart = song.pickup ? 1 : 0;
        song.bars.forEach((b, k) => {
          if (!b.box || b.box[0] !== pg || k < bodyStart) return;
          const el = document.createElement('div'); el.className = 'clickbar'; el.dataset.src = k - bodyStart;
          place(el, b.box, vp1.width, vp1.height);
          el.onclick = (e) => this.barClick(k - bodyStart, e.shiftKey);
          box.appendChild(el);
        });
      }
      this.markSelection();
      if (this.state.playing) this.pageHighlight(this.lastSrc);
    } catch (err) {
      view.innerHTML = `<div class="pl-loading">Could not open the PDF (${esc(err.message || err)}).</div>`;
    }
  }
  pageHighlight(src) {
    if (!this.pageEls) return;
    Object.values(this.pageEls).forEach(p => { const h = p.box.querySelector('.hl'); if (h) h.remove(); });
    if (src === -1 || src === -2) return;
    const bar = src === 'pickup' ? this.song.bars[0] : this.prep.body[src];
    if (!bar) return;
    if (!bar.box) return;
    const p = this.pageEls[bar.box[0]]; if (!p) return;
    const h = document.createElement('div'); h.className = 'hl';
    place(h, bar.box, p.w, p.h);
    p.box.appendChild(h);
    this.followBar(h);
  }
}
function chartPerLine(w) { w = w || innerWidth - 16; return w >= 700 ? 0 : w >= 340 ? 4 : 2; }
function place(el, box, w, h) {
  const [, x0, y0, x1, y1] = box, sp = (y1 - y0) / 4;
  const top = y0 - sp * 5.5, bot = y1 + sp * 2.2;
  el.style.left = (x0 / w * 100) + '%'; el.style.width = ((x1 - x0) / w * 100) + '%';
  el.style.top = (top / h * 100) + '%'; el.style.height = ((bot - top) / h * 100) + '%';
}
let pdfjsP = null; const docs = {};
function loadPdfJs() {
  if (pdfjsP) return pdfjsP;
  pdfjsP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/pdfjs/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error('PDF viewer did not load'));
    document.head.appendChild(s);
  });
  return pdfjsP;
}
function getDoc(pdfjs, file) {
  if (!docs[file]) docs[file] = pdfjs.getDocument({ url: file, isEvalSupported: false, disableAutoFetch: true, rangeChunkSize: 262144 }).promise;
  return docs[file];
}
function defaultTempo(song) {
  const t = (song.title || '').toLowerCase();
  if (/ballad|ruby my dear|body and soul|'round midnight|lush life|in a sentimental|my funny|misty|stardust|nature boy|naima|skylark|you don't know what/.test(t)) return 72;
  if (/bossa|samba|blue bossa|girl from|desafinado|corcovado|felicidade|black or|wave|meditation|insensatez|so danço|triste|manha/.test(t)) return 132;
  return 140;
}
function guessFeel(song) {
  const t = (song.title || '').toLowerCase();
  if (/bossa|samba|girl from|desafinado|corcovado|felicidade|black or|wave|meditation|insensatez|manha|triste/.test(t)) return 2;
  if (/ballad|ruby my dear|body and soul|lush life|my funny|misty|stardust|skylark|naima|you don't know what|round midnight/.test(t)) return 1;
  return 0;
}
export { normTitle };




