// Local dev server: static files from ./public + the Netlify function at its production path.
//   node dev.js   ->   http://127.0.0.1:8790/
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const fn = require("./netlify/functions/generate.js");

const PUB = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
const PORT = Number(process.env.PORT || 8790);

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/.netlify/functions/generate") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const r = await fn.handler({ httpMethod: "POST", body });
      res.writeHead(r.statusCode, r.headers);
      res.end(r.body);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
    return;
  }
  let p = (req.url || "/").split("?")[0];
  if (p === "/") p = "/index.html";
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log("Lofi Studio dev: http://127.0.0.1:" + PORT + "/"));
