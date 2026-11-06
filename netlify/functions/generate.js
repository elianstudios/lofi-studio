// Netlify Function: run the Lofi Electroacoustic Beats generator and return the .mid as base64.
// The generator itself is the same file the local Studio uses (gen-lib.js). Nothing is stored:
// it renders into /tmp, reads the three files, and returns them in the JSON response.

"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gen = require("./gen-lib.js");

const FACTORY = new Set(["custom", "dusty", "broken", "cloud", "overdrive"]);
const MAX_BODY = 200_000;

function settingsText(settings) {
  const lines = [];
  for (const [k, v] of Object.entries(settings || {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
    lines.push(k + "=" + String(v).replace(/[\r\n]+/g, " ").slice(0, 120));
  }
  return lines.join("\n") + "\n";
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });
  let raw = event.body || "{}";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "body too large" });

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: "invalid JSON" }); }
  const settings = Object.assign({}, body.settings || {});

  // A saved user preset name is just a bundle of values: the generator only knows its factory names.
  const preset = String(settings.PRESET || "").toLowerCase();
  if (!FACTORY.has(preset)) settings.PRESET = "custom";
  delete settings.SEED_ARTIFACT; // never trust unknown keys

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lofi-"));
  const out = path.join(dir, "out");
  fs.mkdirSync(out, { recursive: true });
  const settingsFile = path.join(dir, "settings.env");
  fs.writeFileSync(settingsFile, settingsText(settings));

  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = (s) => { stdout += s; return true; };
  process.stderr.write = (s) => { stderr += s; return true; };
  let code = 1;
  try {
    code = gen.cmdGenerate({ settings: settingsFile, out, state: dir });
  } catch (e) {
    stderr += String((e && e.message) || e) + "\n";
    code = 1;
  } finally {
    process.stdout.write = oldOut;
    process.stderr.write = oldErr;
  }

  try {
    const files = fs.readdirSync(out);
    const mid = files.find((f) => f.endsWith(".mid"));
    if (!mid) {
      return json(400, { ok: false, error: (stderr || "generation failed").trim(), report: stdout.trim() });
    }
    const base = mid.replace(/\.mid$/, "");
    const midi = fs.readFileSync(path.join(out, mid));
    const report = fs.readFileSync(path.join(out, base + ".report.txt"), "utf8");
    let recipe = null;
    try { recipe = JSON.parse(fs.readFileSync(path.join(out, base + ".recipe.json"), "utf8")); } catch {}
    return json(200, {
      ok: code === 0,
      code,
      file_name: mid,
      seed: recipe ? recipe.seed : (report.match(/^Seed: (.+)$/m) || [])[1] || "",
      midi_b64: midi.toString("base64"),
      report,
      recipe,
      error: (stderr || "").trim()
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
};
