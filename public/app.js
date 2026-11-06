"use strict";
// Lofi Studio — standalone web build.
// Generation runs in one Netlify Function; everything else (faders, presets, playback, downloads)
// lives in the browser. Presets and the last settings are kept in localStorage.

const CONTROLS = [
  { key: "TEMPO",      label: "TEMPO",      min: 5,   max: 500, step: 1, unit: "bpm" },
  { key: "FREEDOM",    label: "FREEDOM",    min: 0,   max: 100, step: 1, unit: "%" },
  { key: "DENSITY",    label: "DENSITY",    min: 0,   max: 100, step: 1, unit: "%" },
  { key: "SWING",      label: "SWING",      min: 50,  max: 75,  step: 1, unit: "%" },
  { key: "HUMANIZE",   label: "HUMANIZE",   min: 0,   max: 100, step: 1, unit: "%" },
  { key: "GHOSTS",     label: "GHOSTS",     min: 0,   max: 100, step: 1, unit: "%" },
  { key: "FLAMS",      label: "FLAMS",      min: 0,   max: 100, step: 1, unit: "%" },
  { key: "DROPS",      label: "DROPS",      min: 0,   max: 100, step: 1, unit: "%" },
  { key: "DRIFT",      label: "DRIFT",      min: 0,   max: 100, step: 1, unit: "%" },
  { key: "POLYRHYTHM", label: "POLYRHYTHM", min: 0,   max: 100, step: 1, unit: "%" },
  { key: "GESTURES",   label: "GESTURES",   min: 0,   max: 100, step: 1, unit: "%" },
  { key: "DUST",       label: "DUST",       min: 0,   max: 100, step: 1, unit: "%" }
];
const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SCALES = ["minor", "dorian", "phrygian", "mixolydian", "major", "lydian", "minor-pentatonic", "major-pentatonic"];
const LAYER_IDS = ["kick", "snare", "hats", "perc_a", "perc_b", "pops", "bass", "stabs", "texture", "accent"];
const LAYER_LABELS = {
  kick: "Kick", snare: "Snare + Rim", hats: "Hats", perc_a: "Perc A · toms", perc_b: "Perc B · clicks",
  pops: "Pops / dust", bass: "Bass", stabs: "Chord stabs", texture: "Texture", accent: "Accent"
};
const LAYER_GROUPS = {
  all: LAYER_IDS.slice(),
  drums: ["kick", "snare", "hats", "perc_a", "perc_b", "pops"],
  core: ["kick", "snare", "hats", "perc_a", "perc_b", "bass"],
  nodust: ["kick", "snare", "hats", "perc_a", "perc_b", "bass", "stabs", "texture", "accent"],
  pitched: ["bass", "stabs", "texture"]
};
const LAYER_OPTIONS = ["all", "drums", "core", "nodust", "pitched", "custom"];
const CUSTOM = "custom";

const DEFAULTS = {
  TEMPO: 82, BARS: 16, FREEDOM: 55, DENSITY: 70, SWING: 60, HUMANIZE: 55, GHOSTS: 40,
  FLAMS: 18, DROPS: 12, DRIFT: 35, POLYRHYTHM: 55, GESTURES: 50, DUST: 30,
  KEY: "A", SCALE: "minor", SEED: "", LAYERS: "all", PRESET: CUSTOM
};
const FACTORY = {
  dusty: { ...DEFAULTS, TEMPO: 78, FREEDOM: 15, DENSITY: 50, SWING: 64, HUMANIZE: 50, GHOSTS: 35, FLAMS: 25, DROPS: 12, DRIFT: 45, POLYRHYTHM: 30, GESTURES: 40, DUST: 70, PRESET: "dusty" },
  broken: { ...DEFAULTS, TEMPO: 84, FREEDOM: 50, DENSITY: 78, SWING: 58, HUMANIZE: 65, GHOSTS: 50, FLAMS: 20, DROPS: 18, DRIFT: 25, POLYRHYTHM: 65, GESTURES: 55, DUST: 30, PRESET: "broken" },
  cloud: { ...DEFAULTS, TEMPO: 72, FREEDOM: 82, DENSITY: 62, SWING: 55, HUMANIZE: 45, GHOSTS: 40, FLAMS: 10, DROPS: 20, DRIFT: 70, POLYRHYTHM: 50, GESTURES: 85, DUST: 45, PRESET: "cloud" },
  overdrive: { ...DEFAULTS, TEMPO: 92, FREEDOM: 68, DENSITY: 100, SWING: 60, HUMANIZE: 70, GHOSTS: 60, FLAMS: 22, DROPS: 15, DRIFT: 15, POLYRHYTHM: 75, GESTURES: 80, DUST: 25, PRESET: "overdrive" }
};
const LS_PRESETS = "lofiStudio.presets.v1";
const LS_LAST = "lofiStudio.last.v1";
const MAX_TAKES = 8;

const $ = (id) => document.getElementById(id);
const els = {
  conn: $("conn"), presetSelect: $("presetSelect"), saveBtn: $("saveBtn"), delBtn: $("delBtn"),
  saveRow: $("saveRow"), presetName: $("presetName"), saveOk: $("saveOk"), saveCancel: $("saveCancel"),
  randomBtn: $("randomBtn"), resetBtn: $("resetBtn"), barsSeg: $("barsSeg"),
  key: $("key"), scale: $("scale"), layers: $("layers"), seed: $("seed"), dice: $("dice"), seedClear: $("seedClear"),
  generate: $("generate"), faders: $("faders"), instGrid: $("instGrid"), instCount: $("instCount"),
  outFile: $("outFile"), report: $("report"), download: $("download"), downloadRecipe: $("downloadRecipe"),
  copyReport: $("copyReport"), status: $("status"), recentList: $("recentList"), live: $("live")
};

let boot = { defaults: DEFAULTS, factory: FACTORY, user: {} };
let settings = { ...DEFAULTS };
let currentPreset = CUSTOM;
let lastTake = null;
let takes = [];
let busy = false;
let liveTimer = null, liveBusy = false, liveAgain = false;

// ---------------------------------------------------------------- storage
function loadUserPresets() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_PRESETS) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function saveUserPresets(map) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(map)); } catch {}
}
function loadLastSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LAST) || "null");
    return v && typeof v === "object" ? v : null;
  } catch { return null; }
}
function saveLastSettings(s) {
  try { localStorage.setItem(LS_LAST, JSON.stringify(s)); } catch {}
}

// ---------------------------------------------------------------- remote generation
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function generateRemote(settingsToSend) {
  const res = await fetch("/.netlify/functions/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings: settingsToSend })
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || !data || (!data.midi_b64 && data.error)) {
    throw new Error((data && data.error) || ("HTTP " + res.status));
  }
  return data;
}

function setConn(ok, text) {
  els.conn.classList.toggle("ok", ok === true);
  els.conn.classList.toggle("bad", ok === false);
  els.conn.querySelector("span").textContent = text;
}

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
}
window.setLofiStatus = setStatus;

// ---------------------------------------------------------------- build
function buildFaders() {
  els.faders.innerHTML = "";
  for (const c of CONTROLS) {
    const wrap = document.createElement("div");
    wrap.className = "fader";
    wrap.innerHTML =
      '<div class="f-top"><span class="f-name">' + c.label + '</span><span class="f-val" data-val></span></div>' +
      '<div class="rail"><input class="v" type="range" orient="vertical" data-key="' + c.key + '"' +
      ' min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" aria-label="' + c.label + '"></div>' +
      '<span class="f-name" style="opacity:.65">' + c.unit + '</span>';
    const input = wrap.querySelector("input");
    input.addEventListener("input", () => {
      settings[c.key] = Number(input.value);
      wrap.querySelector("[data-val]").textContent = input.value;
      markCustom();
    });
    els.faders.appendChild(wrap);
  }
}

function fillSelects() {
  els.key.innerHTML = KEYS.map((k) => '<option value="' + k + '">' + k + '</option>').join("");
  els.scale.innerHTML = SCALES.map((s) => '<option value="' + s + '">' + s + '</option>').join("");
  els.layers.innerHTML = LAYER_OPTIONS.map((l) => '<option value="' + l + '">' + l + '</option>').join("");
}

function buildInstruments() {
  els.instGrid.innerHTML = LAYER_IDS.map((id) =>
    '<label class="inst" data-inst="' + id + '" title="' + LAYER_LABELS[id] + '">' +
    '<input type="checkbox" data-inst="' + id + '" aria-label="' + LAYER_LABELS[id] + '">' +
    '<span class="pip"></span><span>' + LAYER_LABELS[id] + '</span></label>'
  ).join("");
  els.instGrid.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", onInstrumentChange));
}

function buildTakes() {
  els.recentList.innerHTML = "";
  if (!takes.length) {
    els.recentList.innerHTML = '<li class="empty">nothing generated yet</li>';
    return;
  }
  for (const t of takes) {
    const li = document.createElement("li");
    li.textContent = t.name.replace(/^LofiElectro_/, "").replace(/\.mid$/, "");
    li.title = t.name + " — click to load";
    li.addEventListener("click", () => loadTake(t));
    els.recentList.appendChild(li);
  }
}

// ---------------------------------------------------------------- presets
function presetOptions(selected) {
  const factory = Object.keys(boot.factory || {});
  const user = Object.keys(boot.user || {});
  let html = '<option value="' + CUSTOM + '">custom (unsaved)</option>';
  if (factory.length) html += '<optgroup label="Factory">' + factory.map((n) => '<option value="f:' + n + '">' + n + '</option>').join("") + '</optgroup>';
  if (user.length) html += '<optgroup label="Yours">' + user.map((n) => '<option value="u:' + n + '">' + n + '</option>').join("") + '</optgroup>';
  els.presetSelect.innerHTML = html;
  selectPresetOption(selected);
}

function selectPresetOption(name) {
  const factory = !!(boot.factory && boot.factory[name]);
  const user = !!(boot.user && boot.user[name]);
  if (name && factory) els.presetSelect.value = "f:" + name;
  else if (name && user) els.presetSelect.value = "u:" + name;
  else els.presetSelect.value = CUSTOM;
  currentPreset = (factory || user) ? name : CUSTOM;
  els.delBtn.disabled = !user;
}

function applyPreset(name) {
  const p = (boot.factory && boot.factory[name]) || (boot.user && boot.user[name]);
  if (!p) return;
  settings = { ...DEFAULTS, ...p, PRESET: name };
  render();
  scheduleLive();
}

function savePreset() {
  const name = els.presetName.value.trim();
  if (!name) { els.presetName.focus(); return; }
  if (boot.factory[name.toLowerCase()]) { setStatus("That name is reserved for a factory preset.", "bad"); return; }
  boot.user[name] = { ...collect(), PRESET: name };
  saveUserPresets(boot.user);
  presetOptions(name);
  settings.PRESET = name;
  els.saveRow.classList.add("hidden");
  els.presetName.value = "";
  setStatus("preset saved: " + name, "good");
}

function deletePreset() {
  const name = currentPreset;
  if (!name || !boot.user[name]) return;
  if (!confirm('Delete preset "' + name + '"?')) return;
  delete boot.user[name];
  saveUserPresets(boot.user);
  settings.PRESET = CUSTOM;
  presetOptions(CUSTOM);
  setStatus("preset deleted", "good");
}

// ---------------------------------------------------------------- layers / instruments
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
function resolveLayers(value) {
  const v = String(value || "all").toLowerCase();
  if (v === "all") return LAYER_IDS.slice();
  if (LAYER_GROUPS[v]) return LAYER_GROUPS[v].slice();
  const set = new Set();
  for (const t0 of v.split(/[+,|]/)) {
    const t = t0.trim().replace("percb", "perc_b").replace("perca", "perc_a");
    if (!t) continue;
    if (LAYER_GROUPS[t]) LAYER_GROUPS[t].forEach((x) => set.add(x));
    else if (LAYER_IDS.includes(t)) set.add(t);
    else if (t === "hat") set.add("hats");
    else if (t === "percussion") { set.add("perc_a"); set.add("perc_b"); }
  }
  const list = LAYER_IDS.filter((id) => set.has(id));
  return list.length ? list : LAYER_IDS.slice();
}
function layersValue(list) { return list.length === LAYER_IDS.length ? "all" : list.join("+"); }
function checkedLayers() {
  return LAYER_IDS.filter((id) => {
    const cb = els.instGrid.querySelector('input[data-inst="' + id + '"]');
    return cb && cb.checked;
  });
}
function setInstrumentChecks(list) {
  const set = new Set(list);
  for (const id of LAYER_IDS) {
    const cb = els.instGrid.querySelector('input[data-inst="' + id + '"]');
    if (!cb) continue;
    const on = set.has(id);
    cb.checked = on;
    const chip = cb.closest(".inst");
    if (chip) chip.classList.toggle("on", on);
  }
  els.instCount.textContent = list.length + "/" + LAYER_IDS.length;
}
function syncLayerSelect(list) {
  const key = Object.keys(LAYER_GROUPS).find((g) => sameSet(LAYER_GROUPS[g], list));
  els.layers.value = key || "custom";
}
function syncInstruments(value) {
  const list = resolveLayers(value);
  setInstrumentChecks(list);
  syncLayerSelect(list);
}
function onInstrumentChange(ev) {
  const list = checkedLayers();
  if (!list.length) {
    ev.target.checked = true;
    setInstrumentChecks(checkedLayers());
    syncLayerSelect(checkedLayers());
    setStatus("Keep at least one instrument checked", "bad");
    return;
  }
  setInstrumentChecks(list);
  settings.LAYERS = layersValue(list);
  syncLayerSelect(list);
  markCustom();
}
function applyLayerGroup(value) {
  if (value === "custom") return;
  const list = (value === "all" ? LAYER_IDS.slice() : (LAYER_GROUPS[value] || LAYER_IDS).slice());
  setInstrumentChecks(list);
  settings.LAYERS = value;
  syncLayerSelect(list);
  markCustom();
}

// ---------------------------------------------------------------- render / collect
function render() {
  for (const c of CONTROLS) {
    const input = els.faders.querySelector('input[data-key="' + c.key + '"]');
    const val = settings[c.key] == null ? c.min : settings[c.key];
    input.value = val;
    const fader = input.closest(".fader");
    fader.querySelector("[data-val]").textContent = val;
  }
  for (const b of els.barsSeg.querySelectorAll("button")) b.classList.toggle("on", Number(b.dataset.bars) === Number(settings.BARS));
  els.key.value = settings.KEY || "A";
  els.scale.value = settings.SCALE || "minor";
  syncInstruments(settings.LAYERS || "all");
  els.seed.value = settings.SEED || "";
  selectPresetOption(settings.PRESET || CUSTOM);
}

function markCustom() {
  if (currentPreset !== CUSTOM) {
    currentPreset = CUSTOM;
    settings.PRESET = CUSTOM;
    els.presetSelect.value = CUSTOM;
    els.delBtn.disabled = true;
  }
  scheduleLive();
}

function collect() {
  const s = {};
  for (const c of CONTROLS) {
    const input = els.faders.querySelector('input[data-key="' + c.key + '"]');
    s[c.key] = Number(input.value);
  }
  s.BARS = Number(els.barsSeg.querySelector("button.on") ? els.barsSeg.querySelector("button.on").dataset.bars : settings.BARS || 16);
  s.KEY = els.key.value;
  s.SCALE = els.scale.value;
  s.LAYERS = layersValue(checkedLayers());
  s.SEED = els.seed.value.trim();
  s.PRESET = currentPreset;
  return s;
}

function setBusy(on) {
  busy = on;
  els.generate.classList.toggle("busy", on);
  els.generate.disabled = on;
  els.generate.innerHTML = on ? 'RENDERING <span>◌</span>' : 'GENERATE <span>▶</span>';
}

// ---------------------------------------------------------------- takes / downloads
function pushTake(t) {
  if (!t || !t.name) return;
  takes = [t, ...takes.filter((x) => x.name !== t.name)].slice(0, MAX_TAKES);
  buildTakes();
}

function showTake(t) {
  lastTake = t;
  els.outFile.textContent = t.name || "render failed";
  els.outFile.title = t.name || "";
  els.download.disabled = !t.bytes;
  els.downloadRecipe.disabled = !t.recipe;
  els.copyReport.disabled = !t.report;
  els.report.textContent = (t.report || "") + (t.error ? "\n\n" + t.error : "");
  els.report.classList.toggle("err", !t.ok);
}

async function setTake(res, opts = {}) {
  const bytes = res.midi_b64 ? b64ToBytes(res.midi_b64) : null;
  const verify = (res.report || "").split("\n").find((l) => l.startsWith("Verify:")) || "";
  const take = {
    name: res.file_name || "render",
    bytes, recipe: res.recipe || null, seed: res.seed || "", ok: !!res.ok,
    report: res.report || "", error: (res.error || "").trim(), verify
  };
  showTake(take);
  if (res.ok && bytes) await window.LofiPlayer.setBytes(bytes, take.name);
  else window.LofiPlayer.clear();
  if (!opts.noRecent) pushTake(take);
  saveLastSettings(collect());
  return take;
}

function loadTake(t) {
  showTake(t);
  if (t.ok && t.bytes) window.LofiPlayer.setBytes(t.bytes, t.name);
  else window.LofiPlayer.clear();
  setStatus(t.ok ? "loaded " + t.name : "loaded a failed render", t.ok ? "good" : "bad");
}

function downloadData(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------------------------------------------------------------- generate
async function generate() {
  if (busy) return;
  clearTimeout(liveTimer);
  window.LofiPlayer.stop();
  setBusy(true);
  setStatus("rendering…");
  els.report.classList.remove("err");
  els.report.textContent = "Generating MIDI, then reading the file back and verifying it…";
  try {
    const res = await generateRemote(collect());
    const take = await setTake(res);
    if (res.ok) {
      settings.SEED = res.seed || settings.SEED;
      els.seed.value = settings.SEED;
      saveLastSettings(collect());
      setStatus("verified ✓ " + (take.verify || ""), "good");
    } else {
      setStatus("verify failed", "bad");
    }
    setConn(true, "ready");
  } catch (e) {
    els.report.textContent = "ERROR: " + e.message;
    els.report.classList.add("err");
    setStatus("failed", "bad");
    setConn(false, "function error");
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- live
function liveEnabled() { return !!(els.live && els.live.checked); }

function scheduleLive() {
  if (!liveEnabled() || !window.LofiPlayer || !window.LofiPlayer.isPlaying()) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(liveRegenerate, 420);
}

async function liveRegenerate() {
  if (liveBusy) { liveAgain = true; return; }
  if (busy || !liveEnabled() || !window.LofiPlayer || !window.LofiPlayer.isPlaying()) return;
  liveBusy = true;
  try {
    if (!settings.SEED) { settings.SEED = randomSeed(); els.seed.value = settings.SEED; }
    const before = window.LofiPlayer.getState();
    const frac = before.duration ? Math.min(0.98, Math.max(0, before.elapsed / before.duration)) : 0;
    setStatus("live rendering…");
    const res = await generateRemote(collect());
    await setTake(res, { noRecent: true });
    if (!res.ok) { setStatus("live render failed", "bad"); return; }
    const after = window.LofiPlayer.getState();
    window.LofiPlayer.playAt(frac * (after.duration || 0));
    setStatus("live ✓ " + (lastTake.verify || ""), "good");
  } catch (e) {
    setStatus("live: " + e.message, "bad");
  } finally {
    liveBusy = false;
    if (liveAgain) { liveAgain = false; scheduleLive(); }
  }
}

// ---------------------------------------------------------------- random / reset
function randomSeed() { return String(Math.floor(10000000 + Math.random() * 89999999)); }

function randomize() {
  for (const c of CONTROLS) {
    let lo = c.min, hi = c.max;
    if (c.key === "TEMPO") { lo = 62; hi = 108; }
    if (c.key === "SWING") { lo = 52; hi = 68; }
    const steps = Math.floor((hi - lo) / c.step);
    settings[c.key] = lo + Math.floor(Math.random() * (steps + 1)) * c.step;
  }
  settings.SEED = randomSeed();
  settings.PRESET = CUSTOM;
  render();
  scheduleLive();
}

function reset() {
  settings = { ...DEFAULTS, PRESET: CUSTOM };
  render();
  scheduleLive();
}

// ---------------------------------------------------------------- bind
function bind() {
  els.barsSeg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-bars]");
    if (!b) return;
    settings.BARS = Number(b.dataset.bars);
    for (const x of els.barsSeg.querySelectorAll("button")) x.classList.toggle("on", x === b);
    markCustom();
  });
  els.key.addEventListener("change", () => { settings.KEY = els.key.value; markCustom(); });
  els.scale.addEventListener("change", () => { settings.SCALE = els.scale.value; markCustom(); });
  els.layers.addEventListener("change", () => applyLayerGroup(els.layers.value));
  els.seed.addEventListener("input", () => { settings.SEED = els.seed.value.trim(); markCustom(); });
  els.dice.addEventListener("click", () => { els.seed.value = randomSeed(); settings.SEED = els.seed.value; markCustom(); });
  els.seedClear.addEventListener("click", () => { els.seed.value = ""; settings.SEED = ""; markCustom(); });
  els.presetSelect.addEventListener("change", () => {
    const v = els.presetSelect.value;
    if (v === CUSTOM) { settings.PRESET = CUSTOM; currentPreset = CUSTOM; els.delBtn.disabled = true; return; }
    applyPreset(v.slice(2));
  });
  els.saveBtn.addEventListener("click", () => {
    els.saveRow.classList.toggle("hidden");
    if (!els.saveRow.classList.contains("hidden")) {
      const isUser = !!(currentPreset !== CUSTOM && boot.user[currentPreset]);
      els.presetName.value = isUser ? currentPreset : "";
      els.presetName.focus();
    }
  });
  els.saveCancel.addEventListener("click", () => els.saveRow.classList.add("hidden"));
  els.saveOk.addEventListener("click", savePreset);
  els.presetName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") savePreset();
    if (e.key === "Escape") els.saveRow.classList.add("hidden");
  });
  els.delBtn.addEventListener("click", deletePreset);
  els.live.addEventListener("change", () => {
    if (els.live.checked) scheduleLive();
    else clearTimeout(liveTimer);
  });
  els.randomBtn.addEventListener("click", randomize);
  els.resetBtn.addEventListener("click", reset);
  els.generate.addEventListener("click", generate);
  els.download.addEventListener("click", () => {
    if (!lastTake || !lastTake.bytes) return;
    downloadData(lastTake.name, lastTake.bytes, "audio/midi");
  });
  els.downloadRecipe.addEventListener("click", () => {
    if (!lastTake || !lastTake.recipe) return;
    downloadData(lastTake.name.replace(/\.mid$/, "") + ".recipe.json", JSON.stringify(lastTake.recipe, null, 2), "application/json");
  });
  els.copyReport.addEventListener("click", async () => {
    if (!lastTake || !lastTake.report) return;
    try { await navigator.clipboard.writeText(lastTake.report); setStatus("report copied", "good"); }
    catch { setStatus("could not copy", "bad"); }
  });
}

// ---------------------------------------------------------------- init
function init() {
  buildFaders();
  fillSelects();
  buildInstruments();
  bind();
  boot = { defaults: DEFAULTS, factory: FACTORY, user: loadUserPresets() };
  const last = loadLastSettings();
  settings = last ? { ...DEFAULTS, ...last } : { ...DEFAULTS };
  if (!settings.PRESET) settings.PRESET = CUSTOM;
  presetOptions(settings.PRESET);
  render();
  buildTakes();
  setConn(true, "ready");
  els.report.textContent = "Set the faders, then press GENERATE. Everything runs in your browser; only the MIDI render uses the Netlify Function.";
}

document.addEventListener("keydown", (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === "Space") { e.preventDefault(); generate(); }
});

init();
