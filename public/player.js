"use strict";
// Lofi Studio v2 — real-time preview.
// Reads the actual .mid the generator wrote and schedules its notes with the Web Audio API.
// No soundfont, no plugins: a small drum/pitched synth that is good enough to judge a groove.

(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    btn: $("playBtn"), track: $("track"), fill: $("progressFill"), time: $("time"),
    loop: $("loop"), vol: $("volume"), bar: $("playbar")
  };
  if (!els.btn) return;

  let file = "", ready = false;
  let notes = [], duration = 0;
  let ctx = null, master = null, noiseBuf = null;
  let startAt = 0, next = 0, timer = null;
  let playing = false, loopOn = false, volume = 0.8;

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const mmss = (s) => {
    s = Math.max(0, Number(s) || 0);
    return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  };
  const status = (t, k) => { if (typeof window.setLofiStatus === "function") window.setLofiStatus(t, k); };

  // ---------------------------------------------------------------- MIDI
  function parseMidi(buf) {
    const dv = new DataView(buf);
    let p = 0;
    const u8 = () => dv.getUint8(p++);
    const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
    const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
    const tag = () => { const s = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)); p += 4; return s; };
    const vlq = () => { let v = 0, b, n = 0; do { b = u8(); v = (v << 7) | (b & 0x7f); if (++n > 4) throw new Error("bad VLQ"); } while (b & 0x80); return v; };

    if (tag() !== "MThd") throw new Error("not a MIDI file");
    const hlen = u32();
    u16(); const ntrks = u16(); const division = u16();
    p += Math.max(0, hlen - 6);

    const tempos = [];
    const raw = [];
    for (let t = 0; t < ntrks; t++) {
      if (p + 8 > buf.byteLength) break;
      if (tag() !== "MTrk") { const skip = u32(); p += skip; continue; }
      const len = u32(); const end = p + len;
      let tick = 0, running = 0;
      const open = new Map();
      while (p < end) {
        tick += vlq();
        let statusByte = dv.getUint8(p);
        let status;
        if (statusByte & 0x80) { p++; running = statusByte; status = statusByte; }
        else status = running;
        if (status === 0xff) {
          const type = u8(); const l = vlq();
          if (type === 0x51 && l === 3) {
            const us = (dv.getUint8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2);
            tempos.push({ tick, us });
          }
          p += l;
          if (type === 0x2f) break;
        } else if (status === 0xf0 || status === 0xf7) {
          const l = vlq(); p += l;
        } else {
          const hi = status & 0xf0, ch = status & 0x0f;
          if (hi === 0x90 || hi === 0x80) {
            const pitch = u8(), vel = u8();
            const key = ch + ":" + pitch;
            if (hi === 0x90 && vel > 0) {
              if (!open.has(key)) open.set(key, []);
              open.get(key).push({ tick, vel });
            } else {
              const st = open.get(key);
              if (st && st.length) {
                const on = st.pop();
                raw.push({ tick: on.tick, durTicks: Math.max(1, tick - on.tick), ch, pitch, vel: on.vel });
              }
            }
          } else if (hi === 0xc0 || hi === 0xd0) { p += 1; }
          else { p += 2; }
        }
      }
      p = end;
    }

    if (!tempos.some((t) => t.tick === 0)) tempos.push({ tick: 0, us: 500000 });
    tempos.sort((a, b) => a.tick - b.tick);
    const secAt = (tick) => {
      let s = 0, last = 0, us = 500000;
      for (const t of tempos) {
        if (t.tick > tick) break;
        s += (t.tick - last) * us / 1e6 / division;
        last = t.tick; us = t.us;
      }
      return s + (tick - last) * us / 1e6 / division;
    };

    const out = [];
    for (const n of raw) {
      const time = secAt(n.tick);
      out.push({ time, dur: Math.max(0.01, secAt(n.tick + n.durTicks) - time), ch: n.ch, pitch: n.pitch, vel: n.vel });
    }
    out.sort((a, b) => a.time - b.time);
    const dur = out.reduce((m, n) => Math.max(m, n.time + n.dur), 0);
    return { notes: out, duration: Math.max(1, dur), division };
  }

  // ---------------------------------------------------------------- synth
  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 0.8);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function tone(type, f0, t, dur, gain, f1, filterHz) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + Math.max(0.02, dur * 0.9));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
    let node = o;
    if (filterHz) {
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filterHz; f.Q.value = 0.7;
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    o.start(t); o.stop(t + Math.max(0.05, dur) + 0.04);
  }

  function hit(t, dur, type, freq, gain, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, dur));
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + Math.max(0.03, dur) + 0.03);
  }

  function voice(n, t) {
    const v = Math.max(0.05, Math.min(1, n.vel / 127));
    switch (n.ch) {
      case 0: // kick
        tone("sine", 145, t, 0.20, 0.95 * v, 46);
        hit(t, 0.015, "highpass", 2200, 0.14 * v);
        break;
      case 1: // snare / rim
        if (n.pitch === 37) { hit(t, 0.05, "bandpass", 2600, 0.32 * v, 2.5); break; }
        hit(t, 0.18, "highpass", 1400, 0.55 * v);
        tone("triangle", 185, t, 0.10, 0.22 * v, 120);
        break;
      case 2: // hats
        if (n.pitch === 46) hit(t, 0.30, "highpass", 6500, 0.14 * v);
        else if (n.pitch === 44) hit(t, 0.035, "highpass", 8000, 0.10 * v);
        else hit(t, 0.055, "highpass", 7400, 0.13 * v);
        break;
      case 3: // toms / wood: a short tom (pitch drop + transient), never a held tone
        tone("sine", hz(n.pitch) * 1.6, t, 0.11, 0.22 * v, hz(n.pitch) * 0.55);
        hit(t, 0.02, "bandpass", 900 + Math.max(0, n.pitch - 41) * 90, 0.10 * v, 1.5);
        break;
      case 4: // clicks / glitch: noise clicks, NOT a pitched oscillator (no digital melody)
        hit(t, 0.028, "bandpass", 1500 + Math.max(0, n.pitch - 76) * 120, 0.20 * v, 2.5);
        if (v > 0.7) hit(t, 0.012, "highpass", 5000, 0.07 * v);
        break;
      case 5: // pops / dust
        hit(t, 0.03, "lowpass", 1500 + (n.pitch - 30) * 90, 0.20 * v);
        break;
      case 6: // bass: round sine, lowpassed, with a little body
        tone("sine", hz(n.pitch), t, Math.min(0.5, n.dur), 0.36 * v, hz(n.pitch) * 0.995, 520);
        tone("triangle", hz(n.pitch), t, Math.min(0.3, n.dur), 0.10 * v, hz(n.pitch) * 0.995, 380);
        break;
      case 7: // chord stabs
        tone("sawtooth", hz(n.pitch), t, Math.min(0.18, n.dur), 0.075 * v, hz(n.pitch), 1900);
        break;
      case 8: // texture grains
        tone("sine", hz(n.pitch), t, Math.min(0.20, n.dur), 0.06 * v);
        break;
      case 9: // accent: a click plus a low thud, not a pitched melody note
        hit(t, 0.05, "bandpass", 800, 0.22 * v, 1.2);
        tone("sine", 90, t, 0.12, 0.075 * v, 55);
        break;
      default:
        tone("sine", hz(n.pitch), t, 0.12, 0.08 * v);
    }
  }

  // ---------------------------------------------------------------- transport
  function paint(elapsed) {
    const pct = duration ? Math.max(0, Math.min(100, elapsed / duration * 100)) : 0;
    els.fill.style.width = pct + "%";
    els.time.textContent = mmss(elapsed) + " / " + mmss(duration);
  }

  function tick() {
    if (!ctx || !playing) return;
    const now = ctx.currentTime;
    const horizon = now - startAt + 0.30;
    while (next < notes.length && notes[next].time <= horizon) {
      const at = startAt + notes[next].time;
      if (at > now - 0.03) voice(notes[next], at);
      next++;
    }
    const elapsed = Math.max(0, now - startAt);
    paint(Math.min(duration, elapsed));
    if (elapsed >= duration + 0.35) {
      if (loopOn) {
        next = 0;
        startAt = now + 0.08;
        paint(0);
      } else stop();
    }
  }

  function play(offset) {
    if (!ready) return;
    if (playing) return stop();
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = makeNoise();
      const off = Math.max(0, Math.min(Math.max(0, duration - 0.05), Number(offset) || 0));
      startAt = ctx.currentTime + 0.08 - off;
      next = 0;
      while (next < notes.length && notes[next].time < off) next++;
      playing = true;
      els.btn.textContent = "■ Stop"; els.btn.classList.add("playing");
      els.bar.classList.add("playing");
      paint(off);
      ctx.resume().then(() => {
        if (ctx && ctx.state !== "running") status("Audio is blocked by the browser — press Play again", "bad");
      }).catch(() => {});
      timer = setInterval(tick, 50);
      tick();
      status("preview playing", "good");
    } catch (e) {
      status("preview failed: " + e.message, "bad");
      stop();
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (ctx) { try { ctx.close(); } catch {} ctx = null; master = null; noiseBuf = null; }
    playing = false; next = 0; startAt = 0;
    els.btn.textContent = ready ? "▶ Play" : "▶ Generate & Play";
    els.btn.classList.remove("playing");
    els.bar.classList.remove("playing");
    paint(0);
  }

  async function setBytes(bytes, name) {
    if (playing) stop();
    file = name || "";
    ready = false; notes = []; duration = 0;
    els.btn.disabled = false; els.btn.textContent = "▶ Generate & Play"; paint(0);
    if (!bytes) return;
    try {
      const buf = bytes instanceof ArrayBuffer ? bytes
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const p = parseMidi(buf);
      if (!p.notes.length) throw new Error("this render has no notes");
      notes = p.notes; duration = p.duration; ready = true;
      els.btn.disabled = false; els.btn.textContent = "▶ Play";
      els.time.textContent = "0:00 / " + mmss(duration);
    } catch (e) {
      els.time.textContent = "0:00 / 0:00";
      status("preview: " + e.message, "bad");
    }
  }

  function clear() {
    if (playing) stop();
    file = ""; notes = []; duration = 0; ready = false;
    els.btn.disabled = false; els.btn.textContent = "▶ Generate & Play"; paint(0);
  }

  els.loop.addEventListener("change", () => { loopOn = els.loop.checked; });
  els.vol.addEventListener("input", () => {
    volume = Math.max(0, Math.min(1, Number(els.vol.value) / 100));
    if (master) master.gain.value = volume;
  });

  window.LofiPlayer = {
    setBytes, clear, play, playAt: play, stop,
    isPlaying: () => playing,
    getState: () => ({ playing, duration, notes: notes.length, elapsed: ctx ? Math.max(0, ctx.currentTime - startAt) : 0, file, ready, ctxState: ctx ? ctx.state : null }),
    _parse: parseMidi
  };
})();
