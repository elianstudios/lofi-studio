'use strict';
const fs = require('fs');
const path = require('path');
const NL = String.fromCharCode(10);
const GEN_VERSION = '5.0';
const PPQ = 960;
const MIN_MS = 18;
const MAX_MS = 125;
const MAX_TICKS = 480;
const OFFGRID_MS = 30;

const clamp = (x, a, b) => (x < a ? a : (x > b ? b : x));
const lerp = (a, b, t) => a + (b - a) * t;

function fnv(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

class Rng {
  constructor(seed) {
    let h = (seed >>> 0) || 1;
    h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
    this.s = (h ^ (h >>> 15)) >>> 0;
    if (!this.s) this.s = 1;
  }
  next() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  float(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(a) { return a[Math.floor(this.next() * a.length)]; }
  gauss() { const u = Math.max(1e-9, this.next()); const v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.28318530718 * v); }
  exp(r) { return -Math.log(1 - this.next()) / Math.max(1e-6, r); }
}

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_ALIAS = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11],
  'minor-pentatonic': [0, 3, 5, 7, 10], 'major-pentatonic': [0, 2, 4, 7, 9]
};
const SCALE_ALIAS = { aeolian: 'minor', ionian: 'major', minorpentatonic: 'minor-pentatonic', majorpentatonic: 'major-pentatonic' };
const LAYER_IDS = ['kick', 'snare', 'hats', 'perc_a', 'perc_b', 'pops', 'bass', 'stabs', 'texture', 'accent'];
const LAYER_GROUPS = {
  all: LAYER_IDS,
  // drums = percussion only. 'accent' is a pitched musical track (Accent-Control), so it is NOT here;
  // it stays in all/nodust and is voiced as a click in the preview synth.
  drums: ['kick', 'snare', 'hats', 'perc_a', 'perc_b', 'pops'],
  core: ['kick', 'snare', 'hats', 'perc_a', 'perc_b', 'bass'],
  nodust: ['kick', 'snare', 'hats', 'perc_a', 'perc_b', 'bass', 'stabs', 'texture', 'accent'],
  pitched: ['bass', 'stabs', 'texture']
};
const TRACK_DEFS = [
  { id: 'kick',    name: 'Kick',                   ch: 0 },
  { id: 'snare',   name: 'Snare + Rim',            ch: 1 },
  { id: 'hats',    name: 'Hats',                   ch: 2 },
  { id: 'perc_a',  name: 'Perc A (toms-wood)',     ch: 3 },
  { id: 'perc_b',  name: 'Perc B (clicks-glitch)', ch: 4 },
  { id: 'pops',    name: 'Pops-Crackle (dust)',    ch: 5 },
  { id: 'bass',    name: 'Bass triggers',          ch: 6 },
  { id: 'stabs',   name: 'Chord stabs',            ch: 7 },
  { id: 'texture', name: 'Texture grains',         ch: 8 },
  { id: 'accent',  name: 'Accent-Control',         ch: 9 }
];
const DEFAULTS = { TEMPO: 82, BARS: 16, FREEDOM: 55, DENSITY: 70, SWING: 60, HUMANIZE: 55, GHOSTS: 40, FLAMS: 18, DROPS: 12, DRIFT: 35, POLYRHYTHM: 55, GESTURES: 50, DUST: 30, KEY: 'A', SCALE: 'minor', SEED: '', LAYERS: 'all', PRESET: 'custom' };
const RANGES = { TEMPO: [5, 500], BARS: [1, 64], FREEDOM: [0, 100], DENSITY: [0, 100], SWING: [50, 75], HUMANIZE: [0, 100], GHOSTS: [0, 100], FLAMS: [0, 100], DROPS: [0, 100], DRIFT: [0, 100], POLYRHYTHM: [0, 100], GESTURES: [0, 100], DUST: [0, 100] };
const PRESETS = {
  dusty: { TEMPO: 78, FREEDOM: 15, DENSITY: 50, SWING: 64, HUMANIZE: 50, GHOSTS: 35, FLAMS: 25, DROPS: 12, DRIFT: 45, POLYRHYTHM: 30, GESTURES: 40, DUST: 70 },
  broken: { TEMPO: 84, FREEDOM: 50, DENSITY: 78, SWING: 58, HUMANIZE: 65, GHOSTS: 50, FLAMS: 20, DROPS: 18, DRIFT: 25, POLYRHYTHM: 65, GESTURES: 55, DUST: 30 },
  cloud: { TEMPO: 72, FREEDOM: 82, DENSITY: 62, SWING: 55, HUMANIZE: 45, GHOSTS: 40, FLAMS: 10, DROPS: 20, DRIFT: 70, POLYRHYTHM: 50, GESTURES: 85, DUST: 45 },
  overdrive: { TEMPO: 92, FREEDOM: 68, DENSITY: 100, SWING: 60, HUMANIZE: 70, GHOSTS: 60, FLAMS: 22, DROPS: 15, DRIFT: 15, POLYRHYTHM: 75, GESTURES: 80, DUST: 25 }
};
const NAME_ALIAS = { BPM: 'TEMPO', CHAOS: 'DENSITY', MODE: 'SCALE', TRACKS: 'LAYERS', LAYER: 'LAYERS', FREE: 'FREEDOM', SWINGPCT: 'SWING', POLY: 'POLYRHYTHM', GEST: 'GESTURES' };
const SETTING_KEYS = ['PRESET', 'TEMPO', 'BARS', 'FREEDOM', 'DENSITY', 'SWING', 'HUMANIZE', 'GHOSTS', 'FLAMS', 'DROPS', 'DRIFT', 'POLYRHYTHM', 'GESTURES', 'DUST', 'KEY', 'SCALE', 'SEED', 'LAYERS'];
const KEYCH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
const WS = ' ' + String.fromCharCode(9) + String.fromCharCode(13) + NL + '|;,';

function stripQuotes(v) {
  let s = String(v);
  while (s.length && (s.charCodeAt(0) === 34 || s.charCodeAt(0) === 39)) s = s.slice(1);
  while (s.length && (s.charCodeAt(s.length - 1) === 34 || s.charCodeAt(s.length - 1) === 39)) s = s.slice(0, -1);
  return s;
}

function parseKV(text) {
  const out = {};
  const src = String(text === undefined || text === null ? '' : text);
  let i = 0;
  while (i < src.length) {
    while (i < src.length && WS.indexOf(src[i]) >= 0) i++;
    if (i >= src.length) break;
    const ks = i;
    while (i < src.length && KEYCH.indexOf(src[i]) >= 0) i++;
    const keyRaw = src.slice(ks, i);
    while (i < src.length && (src[i] === ' ' || src.charCodeAt(i) === 9)) i++;
    if (src[i] !== '=') {
      while (i < src.length && WS.indexOf(src[i]) < 0) i++;
      continue;
    }
    i++;
    while (i < src.length && (src[i] === ' ' || src.charCodeAt(i) === 9)) i++;
    const vs = i;
    while (i < src.length && WS.indexOf(src[i]) < 0) i++;
    const val = stripQuotes(src.slice(vs, i));
    if (!keyRaw) continue;
    let k = keyRaw.toUpperCase();
    if (NAME_ALIAS[k]) k = NAME_ALIAS[k];
    if (SETTING_KEYS.indexOf(k) >= 0) out[k] = val;
  }
  return out;
}

function readKVFile(file) {
  try { return parseKV(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function parseLayers(v, errors) {
  const raw = String(v).toLowerCase();
  const toks = [];
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '+' || ch === ',' || ch === '|') { if (cur) toks.push(cur); cur = ''; }
    else if (KEYCH.indexOf(ch) >= 0) cur += ch;
  }
  if (cur) toks.push(cur);
  const set = {};
  for (const t0 of toks) {
    const t = t0.replace('percb', 'perc_b').replace('perca', 'perc_a');
    if (LAYER_GROUPS[t]) { LAYER_GROUPS[t].forEach((x) => { set[x] = 1; }); }
    else if (LAYER_IDS.indexOf(t) >= 0) set[t] = 1;
    else if (t === 'hat') set.hats = 1;
    else if (t === 'percussion') { set.perc_a = 1; set.perc_b = 1; }
    else errors.push('unknown layer ' + t0 + ' (use ' + LAYER_IDS.join('+') + ' or all/drums/core/nodust/pitched)');
  }
  const list = LAYER_IDS.filter((x) => set[x]);
  if (!list.length && !errors.length) errors.push('no layers selected');
  return list;
}

function layersString(list) { return list.length === LAYER_IDS.length ? 'all' : list.join('+'); }

function resolveSettings(sources) {
  const errors = [];
  const S = Object.assign({}, DEFAULTS);
  for (const src of sources) {
    if (src.PRESET) {
      const pn = String(src.PRESET).toLowerCase();
      const p = PRESETS[pn];
      if (p) { Object.assign(S, p); S.PRESET = pn; }
      else if (pn !== 'custom') errors.push('unknown PRESET ' + src.PRESET + ' (dusty broken cloud overdrive custom)');
      else S.PRESET = 'custom';
    }
    const keys = Object.keys(src);
    for (const k of keys) {
      if (k === 'PRESET') continue;
      if (SETTING_KEYS.indexOf(k) < 0) continue;
      const v = src[k];
      if (RANGES[k]) {
        const digits = String(v).replace(/[^0-9.]/g, '');
        const n = Number(digits);
        if (!digits.length || !isFinite(n)) { errors.push(k + ' ' + v + ' is not a number'); continue; }
        const r = RANGES[k];
        if (n < r[0] || n > r[1]) { errors.push(k + ' ' + n + ' is out of range (' + r[0] + '-' + r[1] + ')'); continue; }
        S[k] = Math.round(n);
      } else if (k === 'KEY') {
        const kk = KEY_ALIAS[String(v).toLowerCase()];
        if (kk === undefined) errors.push('KEY ' + v + ' is unknown (C Db D Eb E F F# G Ab A Bb B)');
        else S.KEY = KEY_NAMES[kk];
      } else if (k === 'SCALE') {
        let s = String(v).toLowerCase().replace(/_/g, '-');
        if (SCALE_ALIAS[s]) s = SCALE_ALIAS[s];
        if (!SCALES[s]) errors.push('SCALE ' + v + ' is unknown (' + Object.keys(SCALES).join(' ') + ')');
        else S.SCALE = s;
      } else if (k === 'SEED') {
        const sv = String(v).toLowerCase();
        if (sv === '' || sv === 'random') S.SEED = '';
        else if (/^[0-9]{1,10}$/.test(sv) && Number(sv) <= 4294967295) S.SEED = String(Number(sv));
        else errors.push('SEED ' + v + ' must be a whole number 0-4294967295 (or random)');
      } else if (k === 'LAYERS') {
        const le = [];
        const list = parseLayers(v, le);
        if (le.length) { for (const e of le) errors.push(e); }
        else S.LAYERS = layersString(list);
      }
    }
  }
  return { S: S, errors: errors };
}

function settingsLines(S, rawSeed) {
  return [
    'PRESET=' + S.PRESET,
    'TEMPO=' + S.TEMPO, 'BARS=' + S.BARS, 'FREEDOM=' + S.FREEDOM, 'DENSITY=' + S.DENSITY,
    'SWING=' + S.SWING, 'HUMANIZE=' + S.HUMANIZE, 'GHOSTS=' + S.GHOSTS, 'FLAMS=' + S.FLAMS,
    'DROPS=' + S.DROPS, 'DRIFT=' + S.DRIFT, 'POLYRHYTHM=' + S.POLYRHYTHM,
    'GESTURES=' + S.GESTURES, 'DUST=' + S.DUST, 'KEY=' + S.KEY, 'SCALE=' + S.SCALE,
    'SEED=' + (rawSeed || ''), 'LAYERS=' + S.LAYERS
  ];
}

function randomSeed() {
  return String(10000000 + (fnv(String(Date.now()) + ':' + process.pid + ':' + Math.random() * 1e9) % 89000000));
}

function keyIndex(k) { const v = KEY_ALIAS[String(k).toLowerCase()]; return v === undefined ? 0 : v; }

function scaleMidi(S, deg, base) {
  const sc = SCALES[S.SCALE];
  const n = sc.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return base + sc[idx] + 12 * oct;
}

function swungPos(step, sw) {
  const k = Math.floor(step);
  const half = (k >= 0 ? Math.floor(k / 2) : -Math.ceil(-k / 2)) * 0.5;
  return half + (((k % 2) + 2) % 2) * sw * 0.5;
}

function stepT(c, bar, step) { return bar * 4 + swungPos(step, c.sw); }

function makeContext(S, seed) {
  const rngs = {};
  const c = {
    S: S, seed: seed,
    f: S.FREEDOM / 100, d: S.DENSITY / 100, h: S.HUMANIZE / 100,
    sw: 0.5 + (S.SWING - 50) * 0.01,
    totalBeats: S.BARS * 4,
    polyCycles: [], gestures: 0, silences: []
  };
  c.rng = function (id) { if (!rngs[id]) rngs[id] = new Rng(fnv(seed + ':' + id)); return rngs[id]; };
  const R = new Rng(fnv(seed + ':tempo'));
  const A = 0.25 + 4.5 * (S.DRIFT / 100);
  const p1 = R.float(0, 6.28318530718), p2 = R.float(0, 6.28318530718), p3 = R.float(0, 6.28318530718);
  const L1 = R.float(20, 40), L2 = R.float(7, 14), L3 = R.float(3.1, 5.3);
  c.bpmRaw = function (beat) {
    let b = S.TEMPO
      + A * Math.sin(2 * Math.PI * beat / (L1 * 4) + p1)
      + A * 0.45 * Math.sin(2 * Math.PI * beat / (L2 * 4) + p2)
      + A * 0.16 * Math.sin(2 * Math.PI * beat / (L3 * 4) + p3);
    const bp = ((beat / 4) % 8 + 8) % 8;
    if (bp > 7) b -= (bp - 7) * (0.5 + 2.5 * (S.DRIFT / 100));
    return clamp(b, 5, 500);
  };
  c.bpmBar = function (beat) {
    const bar = Math.floor(beat / 4 + 1e-9);
    return clamp(Math.round(c.bpmRaw(bar * 4)), 5, 500);
  };
  const ns = Math.round(S.BARS * S.DROPS / 100 * 0.35);
  for (let i = 0; i < ns; i++) {
    const start = R.float(0, Math.max(0.1, c.totalBeats - 1));
    c.silences.push([start, start + R.float(0.25, 1.0)]);
  }
  c.isSilent = function (beat) {
    for (const s of c.silences) { if (beat >= s[0] && beat < s[1]) return true; }
    return false;
  };
  return c;
}

class Voice {
  constructor(c, id, name, ch) { this.c = c; this.id = id; this.name = name; this.ch = ch; this.notes = []; }
  add(beat, pitch, vel, ms, tag, mode) {
    const c = this.c;
    if (!isFinite(beat)) return null;
    const R = c.rng('jit:' + this.id);
    let b = beat;
    if (mode === 'free') b += R.gauss() * (0.004 + 0.014 * c.f);
    else b += R.gauss() * (0.001 + 0.005 * c.h);
    if (b < 0) b = 0;
    if (b >= c.totalBeats - 0.002) return null;
    const bpm = c.bpmBar(b);
    const tmin = Math.max(1, Math.ceil(MIN_MS * bpm * PPQ / 60000));
    const tmax = Math.min(MAX_TICKS, Math.max(tmin, Math.round(MAX_MS * bpm * PPQ / 60000)));
    let ticks = Math.round(ms * bpm * PPQ / 60000);
    ticks = clamp(ticks, tmin, tmax);
    const n = { beat: b, pitch: Math.round(clamp(pitch, 1, 127)), vel: Math.round(clamp(vel, 1, 127)), ticks: ticks, tag: tag || '' };
    this.notes.push(n);
    return n;
  }
}

function fixVelocities(v) {
  v.notes.forEach((n) => { n.tick = Math.round(n.beat * PPQ); });
  v.notes.sort((a, b) => (a.tick - b.tick) || (a.pitch - b.pitch));
  for (let i = 1; i < v.notes.length; i++) {
    const prev = v.notes[i - 1];
    const cur = v.notes[i];
    if (cur.vel === prev.vel) {
      cur.vel = cur.vel >= 64 ? cur.vel - 3 : cur.vel + 3;
      if (cur.vel < 1) cur.vel = 1;
      if (cur.vel > 127) cur.vel = 127;
      if (cur.vel === prev.vel) cur.vel = cur.vel === 127 ? 126 : cur.vel + 1;
    }
  }
}

const KICK_PAT = [[0, 10], [0, 7, 10], [0, 10], [0, 10, 14], [0, 3, 10], [0, 6, 10], [0, 8, 11], [0, 10, 15], [0, 11]];

function genKick(c, v) {
  const S = c.S, R = c.rng('kick');
  for (let bar = 0; bar < S.BARS; bar++) {
    const pat = R.pick(KICK_PAT);
    for (const st of pat) {
      if (R.chance(S.DROPS / 100 * 0.35)) continue;
      const b = stepT(c, bar, st);
      if (c.isSilent(b) && R.chance(0.85)) continue;
      const vel = 106 + R.int(-12, 8);
      v.add(b, 36, vel, R.float(40, 80), 'kick', 'grid');
      if (R.chance(S.GHOSTS / 100 * 0.30)) v.add(stepT(c, bar, st + R.pick([1, 2, -1, -2, 3])), 36, R.int(20, 46), R.float(20, 38), 'ghost', 'grid');
      if (R.chance(S.FLAMS / 100 * 0.30)) v.add(b - R.float(0.012, 0.05), 36, Math.max(10, vel - R.int(18, 40)), R.float(18, 32), 'flam', 'grid');
    }
    if (R.chance(S.FREEDOM / 100 * 0.18)) {
      const n = R.int(2, 4);
      for (let k = 0; k < n; k++) v.add(bar * 4 + 4 - (n - k) * R.float(0.06, 0.13), 36, R.int(28, 78), R.float(20, 45), 'pickup', 'free');
    }
  }
}

function genSnare(c, v) {
  const S = c.S, R = c.rng('snare');
  for (let bar = 0; bar < S.BARS; bar++) {
    for (const st of [4, 12]) {
      if (R.chance(S.DROPS / 100 * 0.18)) continue;
      const b = stepT(c, bar, st) + R.float(0.006, 0.04) * (0.4 + c.h);
      if (c.isSilent(b) && R.chance(0.85)) continue;
      const vel = 98 + R.int(-10, 10);
      v.add(b, 38, vel, R.float(35, 70), 'snare', 'grid');
      if (R.chance(S.FLAMS / 100 * 0.5)) v.add(b - R.float(0.015, 0.05), R.chance(0.4) ? 37 : 38, vel - R.int(15, 35), R.float(18, 34), 'flam', 'grid');
      if (R.chance(S.GHOSTS / 100 * 0.8)) v.add(stepT(c, bar, R.pick([2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15])), 38, R.int(16, 44), R.float(20, 40), 'ghost', 'grid');
      if (R.chance(S.GHOSTS / 100 * 0.4)) v.add(stepT(c, bar, R.pick([1, 5, 9, 13])), 37, R.int(14, 38), R.float(18, 32), 'rim', 'grid');
    }
  }
}

function genHats(c, v) {
  const S = c.S, R = c.rng('hats');
  const dens = 0.5 + 0.5 * c.d;
  for (let bar = 0; bar < S.BARS; bar++) {
    for (let st = 0; st < 16; st++) {
      let p;
      if (st % 4 === 0) p = 0.97;
      else if (st % 2 === 0) p = 0.62 + 0.30 * dens;
      else p = 0.26 + 0.50 * dens;
      if (!R.chance(p)) continue;
      if (R.chance(S.DROPS / 100 * 0.20)) continue;
      const b = stepT(c, bar, st);
      if (c.isSilent(b) && R.chance(0.8)) continue;
      let vel;
      if (st % 4 === 0) vel = 92 + R.int(-8, 10);
      else if (st % 2 === 0) vel = 62 + R.int(-12, 12);
      else vel = 38 + R.int(-14, 16);
      if (R.chance(S.GHOSTS / 100 * 0.5)) vel = R.int(12, 34);
      let pitch = 42;
      if (R.chance(0.10)) pitch = 46;
      else if (R.chance(0.06)) pitch = 44;
      v.add(b, pitch, vel, R.float(18, 40), 'hat', 'grid');
      if (R.chance(S.DUST / 100 * 0.12)) v.add(b + R.float(0.004, 0.02), 44, R.int(8, 26), R.float(18, 28), 'dusthat', 'grid');
    }
    if (R.chance(S.GESTURES / 100 * 0.40)) {
      const n = R.int(4, 12);
      let b = stepT(c, bar, R.pick([4, 6, 7, 12, 14, 15]));
      const accel = R.chance(0.5);
      let sp = accel ? 0.13 : 0.045;
      for (let k = 0; k < n; k++) {
        v.add(b, 42, lerp(88, 26, k / Math.max(1, n - 1)) + R.int(-4, 4), R.float(18, 26), 'roll', 'free');
        sp = clamp(accel ? sp * 0.9 : sp * 1.1, 0.028, 0.17);
        b += sp;
      }
      c.gestures++;
    }
  }
}

function genPoly(c, v, pitches, velLo, velHi, msLo, msHi) {
  const S = c.S, R = c.rng('poly:' + v.id);
  const p = S.POLYRHYTHM / 100;
  if (p <= 0.01) return;
  const RATIOS = [[3, 2], [5, 4], [7, 8], [11, 8]];
  for (const r of RATIOS) {
    const a = r[0], b = r[1];
    if (!R.chance(0.20 + 0.65 * p)) continue;
    const cycles = Math.max(1, Math.round(c.totalBeats / b * (0.4 + 0.9 * p)));
    for (let k = 0; k < cycles; k++) c.polyCycles.push(a + ':' + b);
    const phase = R.float(0, b);
    for (let cyc = 0; cyc < cycles; cyc++) {
      for (let k = 0; k < a; k++) {
        const beat = cyc * b + phase + k * b / a;
        if (beat >= c.totalBeats - 0.01) continue;
        if (c.isSilent(beat) && R.chance(0.7)) continue;
        v.add(beat, R.pick(pitches), R.int(velLo, velHi), R.float(msLo, msHi), 'poly' + a + ':' + b, 'free');
      }
    }
  }
}

function genPercA(c, v) {
  const R = c.rng('perca');
  genPoly(c, v, [45, 47, 50, 41], 28, 88, 22, 60);
  const rate = (0.2 + 2.0 * c.f) * (0.4 + c.d);
  let t = R.float(0, 1);
  while (t < c.totalBeats) {
    t += R.exp(rate);
    if (t >= c.totalBeats) break;
    if (R.chance(0.5)) v.add(t, R.pick([43, 45, 47, 48]), R.int(20, 70), R.float(20, 55), 'scatter', 'free');
  }
}

function genPercB(c, v) {
  const S = c.S, R = c.rng('percb');
  const g = Math.round(S.GESTURES / 100 * S.BARS * 1.5);
  for (let i = 0; i < g; i++) {
    const start = R.float(0, Math.max(0.1, c.totalBeats - 1));
    const n = R.int(4, 14);
    const accel = R.chance(0.5);
    let sp = R.float(0.08, 0.22);
    let b = start;
    for (let k = 0; k < n; k++) {
      if (b < c.totalBeats && !(c.isSilent(b) && R.chance(0.8))) v.add(b, R.pick([76, 79, 84, 88]), lerp(90, 26, k / Math.max(1, n - 1)) + R.int(-5, 5), R.float(18, 30), 'cloud', 'free');
      sp = clamp(accel ? sp * 0.88 : sp * 1.12, 0.03, 0.22);
      b += sp;
    }
    c.gestures++;
  }
  const rate = (0.3 + 2.5 * c.d) * (0.4 + c.f);
  let t = R.float(0, 2);
  while (t < c.totalBeats) {
    t += R.exp(rate);
    if (t >= c.totalBeats) break;
    if (R.chance(0.6)) v.add(t, R.pick([80, 84, 86]), R.int(14, 70), R.float(18, 26), 'click', 'free');
  }
}

function genPops(c, v) {
  const S = c.S, R = c.rng('pops');
  const density = S.DUST / 100;
  if (density <= 0.01) return;
  const rate = 1 + 8 * density;
  let t = 0;
  while (t < c.totalBeats) {
    t += R.exp(rate);
    if (t >= c.totalBeats) break;
    if (c.isSilent(t) && R.chance(0.6)) continue;
    v.add(t, R.pick([30, 31, 34, 37]), R.int(6, 34), R.float(18, 24), 'dust', 'free');
  }
}

function genBass(c, v) {
  const S = c.S, R = c.rng('bass');
  const base = 36 + keyIndex(S.KEY);
  const pats = [[0, 6, 10], [0, 3, 10], [0, 10], [0, 7, 10], [0, 3, 7, 10]];
  for (let bar = 0; bar < S.BARS; bar++) {
    const pat = R.pick(pats);
    for (const st of pat) {
      if (R.chance(S.DROPS / 100 * 0.2)) continue;
      const beat = stepT(c, bar, st);
      if (c.isSilent(beat) && R.chance(0.7)) continue;
      const deg = R.pick([0, -2, 2, 4, 7]);
      v.add(beat, scaleMidi(S, deg, base), R.int(45, 100), R.float(25, 70), 'bass', 'grid');
    }
  }
}

function genStabs(c, v) {
  const S = c.S, R = c.rng('stabs');
  const base = 60 + keyIndex(S.KEY);
  for (let bar = 0; bar < S.BARS; bar++) {
    const hits = R.int(1, 3);
    for (let i = 0; i < hits; i++) {
      const st = R.pick([3, 6, 7, 11, 14, 15]);
      const beat = stepT(c, bar, st) + R.float(0, 0.02);
      if (c.isSilent(beat) && R.chance(0.7)) continue;
      const deg = R.pick([0, 2, 4, 5]);
      const vel = R.int(40, 86);
      for (const iv of [0, 2, 4]) v.add(beat + R.float(0, 0.006), scaleMidi(S, deg + iv, base), vel + R.int(-4, 4), R.float(30, 80), 'stab', 'grid');
    }
  }
}

function genTexture(c, v) {
  const S = c.S, R = c.rng('texture');
  const n = Math.round((S.GESTURES / 100) * (0.3 + 0.7 * c.d) * S.BARS * 6);
  const base = 72 + keyIndex(S.KEY);
  for (let i = 0; i < n; i++) {
    const beat = R.float(0, Math.max(0.1, c.totalBeats - 0.01));
    if (c.isSilent(beat) && R.chance(0.8)) continue;
    v.add(beat, scaleMidi(S, R.int(0, 12), base), R.int(8, 52), R.float(18, 40), 'grain', 'free');
  }
  c.gestures += Math.round(n / 10);
}

function genAccent(c, v) {
  const S = c.S, R = c.rng('accent');
  const base = 60 + keyIndex(S.KEY);
  for (let bar = 0; bar < S.BARS; bar++) {
    if (R.chance(0.6)) v.add(bar * 4 + R.pick([0, 1.5, 2, 3]), scaleMidi(S, R.pick([0, 2, 4]), base), R.int(70, 110), R.float(18, 30), 'accent', 'grid');
    if (R.chance(S.DROPS / 100)) v.add(bar * 4 + 3.75, scaleMidi(S, R.pick([5, 7]), base), R.int(40, 80), R.float(18, 26), 'cue', 'free');
  }
}

function generate(S, seedStr) {
  const seed = Number(seedStr) >>> 0;
  const c = makeContext(S, seed);
  const voices = {};
  TRACK_DEFS.forEach((d) => { voices[d.id] = new Voice(c, d.id, d.name, d.ch); });
  genKick(c, voices.kick);
  genSnare(c, voices.snare);
  genHats(c, voices.hats);
  genPercA(c, voices.perc_a);
  genPercB(c, voices.perc_b);
  genPops(c, voices.pops);
  genBass(c, voices.bass);
  genStabs(c, voices.stabs);
  genTexture(c, voices.texture);
  genAccent(c, voices.accent);
  const active = parseLayers(S.LAYERS, []);
  TRACK_DEFS.forEach((d) => {
    const v = voices[d.id];
    if (active.indexOf(d.id) < 0) v.notes = [];
    fixVelocities(v);
  });
  return { c: c, voices: voices, active: active };
}

function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE((n >>> 0) & 0xffffffff, 0); return b; }
function u16be(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff, 0); return b; }
function chunk(id, data) { return Buffer.concat([Buffer.from(id, 'latin1'), u32be(data.length), data]); }

function vlq(n) {
  const out = [n & 0x7f];
  let v = Math.floor(n / 128);
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  return out;
}

function serializeTrack(evs, endTick) {
  evs.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  const parts = [];
  let last = 0;
  for (const e of evs) {
    const t = Math.max(last, Math.round(e.tick));
    parts.push(Buffer.from(vlq(t - last)));
    last = t;
    if (e.kind === 'meta') {
      parts.push(Buffer.from([0xff, e.meta, e.data.length].concat(e.data)));
    } else if (e.kind === 'on') {
      parts.push(Buffer.from([0x90 | (e.ch & 0x0f), e.pitch & 0x7f, clamp(e.vel, 1, 127) & 0x7f]));
    } else {
      parts.push(Buffer.from([0x80 | (e.ch & 0x0f), e.pitch & 0x7f, 0x40]));
    }
  }
  const end = Math.max(last, Math.round(endTick));
  parts.push(Buffer.from(vlq(end - last)));
  parts.push(Buffer.from([0xff, 0x2f, 0x00]));
  return Buffer.concat(parts);
}

function buildTempoTrack(c) {
  const evs = [];
  evs.push({ kind: 'meta', meta: 0x03, data: Array.from(Buffer.from('Tempo map (tape drift)', 'latin1')), tick: 0, order: -2 });
  for (let bar = 0; bar < c.S.BARS; bar++) {
    const bpm = c.bpmBar(bar * 4);
    const us = Math.round(60000000 / bpm);
    evs.push({ kind: 'meta', meta: 0x51, data: [(us >> 16) & 255, (us >> 8) & 255, us & 255], tick: bar * 4 * PPQ, order: 0 });
  }
  return chunk('MTrk', serializeTrack(evs, c.totalBeats * PPQ));
}

function buildVoiceTrack(voice, c) {
  const evs = [];
  evs.push({ kind: 'meta', meta: 0x03, data: Array.from(Buffer.from(voice.name, 'latin1')), tick: 0, order: -2 });
  let maxTick = 0;
  // Two notes of the SAME pitch must never overlap: the reader pairs note-offs with a LIFO stack, so an
  // overlap pairs the 2nd onset with the 1st off and reports absurd 2 ms notes (the old
  // "VERIFY FAILED: note length 1.7 ms" runs). Trim each note before the next same-pitch onset; if the
  // gap is too small to hold a legal note, drop the earlier one (one of the two is unplayable anyway).
  const byPitch = new Map();
  for (const n of voice.notes) {
    if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
    byPitch.get(n.pitch).push(n);
  }
  const keep = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const next = list[i + 1];
      if (next) {
        const gap = Math.max(1, Math.round(next.beat * PPQ) - Math.round(n.beat * PPQ) - 1);
        const bpm = c.bpmBar(n.beat);
        const minTicks = Math.max(1, Math.ceil(18 * bpm * PPQ / 60000));
        if (gap < minTicks) continue;           // no room for a legal note before the next one: drop this hit
        if (n.ticks > gap) n.ticks = gap;
      }
      keep.push(n);
    }
  }
  // Dropping a hit can leave two neighbours on the same velocity; re-humanise what is left.
  fixVelocities({ notes: keep });
  voice.written = keep.length;   // the verifier must compare against what actually reached the file
  keep.forEach((n) => {
    const on = Math.round(n.beat * PPQ);
    const off = on + n.ticks;
    evs.push({ kind: 'on', ch: voice.ch, pitch: n.pitch, vel: n.vel, tick: on, order: 1 });
    evs.push({ kind: 'off', ch: voice.ch, pitch: n.pitch, vel: 0x40, tick: off, order: 0 });
    if (off > maxTick) maxTick = off;
  });
  const endTick = Math.max(maxTick + 1, c.totalBeats * PPQ);
  return chunk('MTrk', serializeTrack(evs, endTick));
}

function parseMidi(buf) {
  let p = 0;
  function u32() { const v = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0; p += 4; return v; }
  function u16() { const v = (buf[p] << 8) | buf[p + 1]; p += 2; return v; }
  function tag() { const s = buf.toString('latin1', p, p + 4); p += 4; return s; }
  function rvlq() {
    let v = 0, c2, n = 0;
    do { c2 = buf[p++]; v = (v << 7) | (c2 & 0x7f); n++; if (n > 4) throw new Error('bad VLQ'); } while (c2 & 0x80);
    return v;
  }
  if (buf.length < 14) throw new Error('file too short');
  if (tag() !== 'MThd') throw new Error('missing MThd header');
  const hlen = u32();
  if (hlen < 6) throw new Error('bad MThd length ' + hlen);
  const format = u16(), ntrks = u16(), division = u16();
  p += hlen - 6;
  const tracks = [];
  while (p + 8 <= buf.length) {
    const id = tag();
    const len = u32();
    if (id !== 'MTrk') { p += len; continue; }
    const end = p + len;
    const events = [];
    let tick = 0, running = 0;
    while (p < end) {
      tick += rvlq();
      let status = buf[p];
      if (status & 0x80) { p++; } else { status = running; }
      if (status === 0xff) {
        const metaType = buf[p++];
        const l = rvlq();
        const data = Array.from(buf.slice(p, p + l));
        p += l;
        events.push({ tick: tick, type: 'meta', metaType: metaType, data: data });
        running = 0;
        if (metaType === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        const l = rvlq();
        p += l;
        running = 0;
      } else {
        const hi = status & 0xf0, ch = status & 0x0f;
        if (hi === 0xc0 || hi === 0xd0) {
          p += 1;
          events.push({ tick: tick, type: 'other', status: status, ch: ch });
          running = status;
        } else {
          const d1 = buf[p++], d2 = buf[p++];
          let type = 'other';
          if (hi === 0x90 && d2 > 0) type = 'on';
          else if (hi === 0x80 || hi === 0x90) type = 'off';
          events.push({ tick: tick, type: type, status: status, ch: ch, pitch: d1, vel: d2 });
          running = status;
        }
      }
    }
    p = end;
    tracks.push({ events: events });
  }
  return { format: format, ntrks: ntrks, division: division, tracks: tracks };
}

function readTempos(parsed) {
  const list = [];
  if (!parsed.tracks.length) return list;
  parsed.tracks[0].events.forEach((e) => {
    if (e.type === 'meta' && e.metaType === 0x51 && e.data.length === 3) {
      const us = (e.data[0] << 16) | (e.data[1] << 8) | e.data[2];
      if (us > 0) list.push({ tick: e.tick, bpm: 60000000 / us });
    }
  });
  list.sort((a, b) => a.tick - b.tick);
  return list;
}

function tempoAt(list, tick) {
  let bpm = list.length ? list[0].bpm : 120;
  for (let i = 0; i < list.length; i++) {
    if (list[i].tick <= tick) bpm = list[i].bpm;
    else break;
  }
  return bpm;
}

function verifyFile(file, expect) {
  const buf = fs.readFileSync(file);
  const parsed = parseMidi(buf);
  const problems = [];
  if (parsed.format !== 1) problems.push('format ' + parsed.format + ' (expected 1)');
  if (parsed.division !== PPQ) problems.push('division ' + parsed.division + ' (expected ' + PPQ + ')');
  if (parsed.ntrks !== 11) problems.push('header says ' + parsed.ntrks + ' tracks (expected 11)');
  if (parsed.tracks.length !== 11) problems.push('parsed ' + parsed.tracks.length + ' track chunks (expected 11)');
  let eot = 0;
  parsed.tracks.forEach((t) => { if (t.events.some((e) => e.type === 'meta' && e.metaType === 0x2f)) eot++; });
  if (eot !== parsed.tracks.length) problems.push((parsed.tracks.length - eot) + ' track(s) missing end-of-track meta');

  const tempos = readTempos(parsed);
  let notes = 0, minMs = 1e9, maxMs = 0, sumMs = 0, offGrid = 0, devSum = 0, devMax = 0, pairs = 0, longestTicks = 0;

  for (let ti = 1; ti < parsed.tracks.length; ti++) {
    const evs = parsed.tracks[ti].events;
    const stack = {};
    const onsets = [];
    for (const e of evs) {
      if (e.type === 'on') {
        if (!stack[e.pitch]) stack[e.pitch] = [];
        stack[e.pitch].push(e.tick);
        onsets.push(e);
      } else if (e.type === 'off') {
        const st = stack[e.pitch];
        if (!st || !st.length) { problems.push('track ' + (ti + 1) + ': note-off with no note-on (pitch ' + e.pitch + ')'); continue; }
        const onTick = st.pop();
        const durTicks = e.tick - onTick;
        pairs++;
        const bpm = tempoAt(tempos, onTick);
        const ms = durTicks * 60000 / (PPQ * bpm);
        if (durTicks > MAX_TICKS) problems.push('track ' + (ti + 1) + ': note longer than a 1/8 note (' + durTicks + ' ticks)');
        if (ms < 15 || ms > 130) problems.push('track ' + (ti + 1) + ': note length ' + ms.toFixed(1) + ' ms outside 18-125 ms');
        if (ms < minMs) minMs = ms;
        if (ms > maxMs) maxMs = ms;
        sumMs += ms;
        if (durTicks > longestTicks) longestTicks = durTicks;
        const beat = onTick / PPQ;
        const grid = Math.round(beat * 4) / 4;
        const dev = Math.abs(beat - grid) * 60000 / bpm;
        devSum += dev;
        if (dev > devMax) devMax = dev;
        if (dev > OFFGRID_MS) offGrid++;
      }
    }
    const pitches = Object.keys(stack);
    for (const pp of pitches) {
      if (stack[pp].length) problems.push('track ' + (ti + 1) + ': ' + stack[pp].length + ' note-on(s) never closed (pitch ' + pp + ')');
    }
    notes += onsets.length;
    onsets.sort((a, b) => (a.tick - b.tick) || (a.pitch - b.pitch));
    for (let i = 1; i < onsets.length; i++) {
      if (onsets[i].vel === onsets[i - 1].vel) { problems.push('track ' + (ti + 1) + ': two hits in a row share velocity ' + onsets[i].vel); break; }
    }
  }

  if (expect && typeof expect.notes === 'number' && expect.notes !== notes) problems.push('note count ' + notes + ' but the writer wrote ' + expect.notes);

  const stats = {
    notes: notes, pairs: pairs,
    minMs: pairs ? minMs : 0, maxMs: maxMs, avgMs: pairs ? sumMs / pairs : 0,
    offGridPct: notes ? 100 * offGrid / notes : 0,
    meanDev: notes ? devSum / notes : 0, devMax: devMax, longestTicks: longestTicks,
    tempoEvents: tempos.length,
    bpmMin: tempos.length ? Math.min.apply(null, tempos.map((t) => t.bpm)) : 0,
    bpmMax: tempos.length ? Math.max.apply(null, tempos.map((t) => t.bpm)) : 0
  };
  return { problems: problems, stats: stats };
}

function cmdShow(opts) {
  const r = resolveSettings([readKVFile(opts.settings)]);
  if (r.errors.length) { process.stderr.write('ERROR: ' + r.errors.join('; ') + NL); return 1; }
  process.stdout.write(settingsLines(r.S, r.S.SEED).join(NL) + NL);
  return 0;
}

function cmdGenerate(opts) {
  if (!opts.out) { process.stderr.write('ERROR: --out is missing' + NL); return 1; }
  const r = resolveSettings([readKVFile(opts.settings)]);
  if (r.errors.length) { process.stderr.write('ERROR: ' + r.errors.join('; ') + NL); return 1; }
  const S = r.S;
  const seedStr = S.SEED || randomSeed();
  const g = generate(S, seedStr);
  const c = g.c;
  const chunks = [buildTempoTrack(c)];
  TRACK_DEFS.forEach((d) => chunks.push(buildVoiceTrack(g.voices[d.id], c)));
  const header = Buffer.concat([Buffer.from('MThd', 'latin1'), u32be(6), u16be(1), u16be(11), u16be(PPQ)]);
  const fileData = Buffer.concat([header].concat(chunks));
  const fname = 'LofiElectro_' + seedStr + '_' + S.TEMPO + 'bpm_' + S.BARS + 'bars.mid';
  const file = path.join(opts.out, fname);
  fs.writeFileSync(file, fileData);
  let written = 0;
  TRACK_DEFS.forEach((d) => { const v = g.voices[d.id]; written += (typeof v.written === 'number' ? v.written : v.notes.length); });
  const res = verifyFile(file, { notes: written });
  const st = res.stats;

  const counts = {};
  c.polyCycles.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  const polyKeys = Object.keys(counts);
  const polyParts = polyKeys.map((k) => k + ' x' + counts[k] + ' cycles');

  const lines = [];
  lines.push('');
  lines.push('off-grid ' + st.offGridPct.toFixed(1) + '% of onsets - mean deviation ' + st.meanDev.toFixed(1) + ' ms');
  lines.push('Tempo: ' + st.bpmMin.toFixed(0) + '-' + st.bpmMax.toFixed(0) + ' bpm (nominal ' + S.TEMPO + ', ' + st.tempoEvents + ' tempo events)');
  lines.push('Polyrhythm: ' + (polyParts.length ? polyParts.join(', ') : 'none') + ' - ' + c.gestures + ' free gestures');
  lines.push('Note length: ' + st.minMs.toFixed(1) + '-' + st.maxMs.toFixed(1) + ' ms (avg ' + st.avgMs.toFixed(1) + ' ms, limit 125 ms and 1/8 note)');
  if (!res.problems.length) lines.push('Verify: OK - 10 instruments + tempo map, ' + st.notes + ' notes, every note paired, all end-of-track marks present');
  else lines.push('Verify: FAILED - ' + res.problems.length + ' problem(s)');

  const recipePath = path.join(opts.out, fname.replace(/\.mid$/, '') + '.recipe.json');
  const reportPath = path.join(opts.out, fname.replace(/\.mid$/, '') + '.report.txt');
  const recipe = {
    generator: 'lofi-electroacoustic-beats', version: GEN_VERSION, file: fname,
    seed: seedStr, settings: S, layers: g.active, metrics: st,
    polyrhythm: counts, gestures: c.gestures, verified: res.problems.length === 0
  };
  fs.writeFileSync(recipePath, JSON.stringify(recipe, null, 2) + NL);
  const report = ['Lofi Electroacoustic Beats - report', 'Generator: ' + GEN_VERSION, 'File: ' + fname, 'Seed: ' + seedStr]
    .concat(lines)
    .concat(['', 'Settings:'])
    .concat(settingsLines(S, seedStr))
    .concat(res.problems.length ? ['', 'Problems:'].concat(res.problems.map((p) => '  - ' + p)) : [])
    .join(NL) + NL;
  fs.writeFileSync(reportPath, report);

  lines.push('Saved: ' + file);
  lines.push('Recipe: ' + recipePath);
  lines.push('Report: ' + reportPath);
  lines.push('FILE=' + file);
  lines.push('SEED=' + seedStr);
  lines.push('SETTINGS:');
  lines.push(settingsLines(S, seedStr).join(NL));
  process.stdout.write(lines.join(NL) + NL);

  if (res.problems.length) {
    process.stderr.write('VERIFY FAILED:' + NL + res.problems.map((p) => '  - ' + p).join(NL) + NL);
    return 3;
  }
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || '';
  const opts = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].indexOf('--') === 0) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  if (cmd === 'show') return cmdShow(opts);
  if (cmd === 'generate') return cmdGenerate(opts);
  process.stderr.write('ERROR: unknown command ' + cmd + ' (show|generate)' + NL);
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write('ERROR: ' + (e && e.message ? e.message : String(e)) + NL);
    process.exitCode = 1;
  }
}

module.exports = { cmdGenerate, cmdShow };
