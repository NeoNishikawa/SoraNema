/* ============================================================================
   Uji browser: header seal klien -> PHP edge mode enforce.
   ----------------------------------------------------------------------------
   Rantai yang diuji adalah rantai sungguhan, bukan tiruan di dalam test:

     Chrome -> proxy uji -> edge/public/index.php -> backend stub

   Halaman tetap disajikan server Node (aset statis), sedangkan semua
   /api/* dialihkan proxy ke PHP. Backend stub hanya mengembalikan fixture,
   jadi uji tidak menyentuh Animasu/Samehadaku.

   Yang dibuktikan:
   1. Klien mengirim X-ILN-Seal berisi digest dari integrity.js.
   2. Mode enforce dengan digest yang cocok meneruskan data.
   3. Kalau header itu dihapus dari request (simulasi seal dibuang), edge
      menjawab bentuk kosong biasa - bukan 403/503 dan tanpa kata "seal".
   4. Aplikasi tidak lagi menampilkan kartu anime setelah data kosong.

   Jalankan: npm run test:seal-edge
   Butuh PHP 8.2+ di PATH dan Chrome/Edge.
   ========================================================================== */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { app } = require("../server");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

const SLUG = "uji-seal";
const ANIME = {
  slug: SLUG,
  id: SLUG,
  title: "Uji Seal Edge",
  posterUrl: "/assets/double-click.webp",
  rating: 8.2,
  totalEpisodes: 12,
  type: "Series",
  status: "Selesai Tayang",
};

const FIXTURES = {
  "/api/health": { ok: true, bootId: "uji-seal" },
  "/api/daily": { data: [ANIME], slides: [], total: 1 },
  "/api/genres": { data: [] },
  "/api/recommendations": { data: [], total: 0 },
  "/api/catalog": { data: [], total: 0 },
  [`/api/anime/${SLUG}`]: {
    data: {
      ...ANIME,
      studio: "Studio Uji",
      synopsis: "Fixture lokal untuk uji header seal.",
      genres: [],
      episodes: [{ number: 1, slug: `${SLUG}-episode-1`, title: "Episode 1" }],
      batches: [],
    },
  },
  [`/api/anime/${SLUG}/downloads`]: { data: [], provider: "", fallback: false, pending: false },
  [`/api/streams/${SLUG}-episode-1`]: { data: [] },
  "/api/laporan-tautan": { data: [], ambang: 2 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, { timeoutMs = 15000, intervalMs = 100, label = "kondisi" } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError ? `: ${lastError.message}` : "";
  throw new Error(`timeout menunggu ${label}${detail}`);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.socket = null;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => reject(new Error("timeout membuka WebSocket CDP")), 10000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", (event) => { clearTimeout(timer); reject(new Error(`WebSocket CDP gagal: ${event.message || event.type}`)); }, { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.method) {
          for (const handler of this.handlers.get(message.method) || []) {
            try { handler(message.params || {}); } catch { /* handler tidak boleh memutus koneksi */ }
          }
          return;
        }
        if (!message.id) return;
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.resolve(message.result);
      });
    });
    return this;
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP tertutup saat memanggil ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout CDP ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params: { ...params } }));
    });
  }

  close() {
    try { this.socket?.close(); } catch { /* sudah tertutup */ }
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("CDP ditutup"));
    }
    this.pending.clear();
  }
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "eval gagal";
    throw new Error(description);
  }
  return response.result?.value;
}

function bacaJson(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function tutup(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function startEdge(port, mode, digest, stubPort) {
  const child = spawn("php", [
    "-S", `127.0.0.1:${port}`,
    path.join(ROOT, "edge", "public", "index.php"),
  ], {
    env: {
      ...process.env,
      ILN_BACKEND_URL: `http://127.0.0.1:${stubPort}`,
      ILN_SEAL_MODE: mode,
      ILN_SEAL_DIGEST: digest,
      ILN_EDGE_SECRET: "rahasia-uji",
      ILN_UPSTREAM_TIMEOUT_MS: "3000",
    },
    stdio: "ignore",
  });
  child.on("error", () => { /* ditangani oleh waitFor HTTP */ });
  return child;
}

async function waitHttp(url, headers = {}) {
  await waitFor(async () => {
    try {
      const response = await fetch(url, { headers });
      return response.ok;
    } catch {
      return false;
    }
  }, { timeoutMs: 15000, label: url });
}

function mulaiStub() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const fixture = FIXTURES[url.pathname];
    if (fixture === undefined) {
      bacaJson(res, { data: [], total: 0 }, 404);
      return;
    }
    bacaJson(res, fixture);
  });
}

function mulaiProxy({ appPort, stats }) {
  return http.createServer((req, res) => {
    if (req.url === "/__stats") {
      bacaJson(res, stats);
      return;
    }
    const isApi = String(req.url || "").startsWith("/api/");
    const headers = { ...req.headers };
    delete headers.host;
    if (isApi) {
      stats.api += 1;
      stats.lastSealHeader = String(req.headers["x-iln-seal"] || "");
      stats.lastForwardedSeal = stripSeal ? "" : stats.lastSealHeader;
      if (stripSeal) delete headers["x-iln-seal"];
    }
    const upstream = http.request({
      host: "127.0.0.1",
      port: isApi ? edgePort : appPort,
      path: req.url,
      method: req.method,
      headers,
    }, (up) => {
      if (isApi && String(req.url || "").startsWith("/api/daily")) {
        const chunks = [];
        up.on("data", (chunk) => chunks.push(chunk));
        up.on("end", () => { stats.lastDailyBody = Buffer.concat(chunks).toString("utf8"); });
      }
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      bacaJson(res, { data: [], total: 0 }, 502);
    });
    req.pipe(upstream);
  });
}

let edgePort = 0;
let stripSeal = false;
const stats = { api: 0, lastSealHeader: "", lastForwardedSeal: "", lastDailyBody: "" };

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  if (!chromePath) throw new Error("Chrome/Edge tidak ditemukan. Set CHROME_PATH ke executable browser.");

  const appServer = http.createServer(app);
  const appPort = await listen(appServer);
  const stubServer = mulaiStub();
  const stubPort = await listen(stubServer);
  const proxyServer = mulaiProxy({ appPort, stats });
  const proxyPort = await listen(proxyServer);

  const edgeOffPort = await freePort();
  const offEdge = startEdge(edgeOffPort, "off", "", stubPort);
  await waitHttp(`http://127.0.0.1:${edgeOffPort}/api/health`);
  edgePort = edgeOffPort;

  const debugPort = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-seal-edge-profil-"));
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=1100,900",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];
  if (process.platform === "linux") chromeArgs.splice(1, 0, "--no-sandbox", "--disable-dev-shm-usage");

  let chromeOutput = "";
  const chrome = spawn(chromePath, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (chunk) => { chromeOutput += chunk.toString(); });

  let browserCdp = null;
  let pageCdp = null;
  let enforceEdge = null;

  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, { timeoutMs: 20000, label: "browser CDP siap" });
    browserCdp = await new Cdp(version.webSocketDebuggerUrl).connect();

    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === "page") || null;
    }, { timeoutMs: 15000, label: "target halaman" });
    pageCdp = await new Cdp(target.webSocketDebuggerUrl).connect();
    await pageCdp.send("Page.enable");
    await pageCdp.send("Runtime.enable");

    const proxyUrl = `http://127.0.0.1:${proxyPort}/`;
    await pageCdp.send("Page.navigate", { url: proxyUrl });
    await waitFor(() => evaluate(pageCdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`), {
      timeoutMs: 20000,
      label: "kartu fixture tampil (edge off)",
    });

    const info = JSON.parse(await evaluate(pageCdp, `
      import("/js/integrity.js").then((m) => {
        const result = m.verify();
        return JSON.stringify({ ok: result.ok, digest: result.digest, wrong: result.wrong });
      })
    `, true));
    if (!info.ok) throw new Error(`seal klien tidak utuh: ${info.wrong?.join(", ")}`);
    if (!/^iln:[0-9]+$/.test(info.digest || "")) throw new Error(`digest klien tidak valid: ${info.digest}`);
    console.log(`LULUS: klien menghitung digest ${info.digest} dan mengirimkannya di header.`);

    const enforcePort = await freePort();
    enforceEdge = startEdge(enforcePort, "enforce", info.digest, stubPort);
    await waitHttp(`http://127.0.0.1:${enforcePort}/api/health`, { "X-ILN-Seal": info.digest });
    edgePort = enforcePort;

    stats.lastSealHeader = "";
    stats.lastForwardedSeal = "";
    stats.lastDailyBody = "";
    await pageCdp.send("Page.reload", { ignoreCache: true });
    await waitFor(() => evaluate(pageCdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`), {
      timeoutMs: 20000,
      label: "kartu fixture tampil (enforce)",
    });
    await waitFor(() => stats.lastDailyBody.includes("Uji Seal Edge"), { label: "data melewati edge enforce" });
    if (stats.lastSealHeader !== info.digest) throw new Error(`header seal tidak terkirim: "${stats.lastSealHeader}"`);
    if (stats.lastForwardedSeal !== info.digest) throw new Error("proxy tidak meneruskan header seal");
    console.log("LULUS: mode enforce meneruskan data saat digest klien cocok.");

    stripSeal = true;
    stats.lastDailyBody = "";
    stats.lastSealHeader = "";
    stats.lastForwardedSeal = "";
    await pageCdp.send("Page.reload", { ignoreCache: true });
    await sleep(3500);
    const masihTampil = await evaluate(pageCdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`);
    if (masihTampil) throw new Error("kartu tetap tampil setelah header seal dihapus");
    if (stats.lastDailyBody !== '{"data":[],"total":0}') {
      throw new Error(`edge tidak menjawab bentuk kosong: ${JSON.stringify(stats.lastDailyBody)}`);
    }
    if (/seal|kunci|invalid/i.test(stats.lastDailyBody)) throw new Error("respons membocorkan alasan penolakan");
    if (stats.lastForwardedSeal !== "") throw new Error("header seal masih diteruskan setelah dihapus");
    console.log("LULUS: tanpa header, edge menjawab data kosong biasa dan kartu tidak tampil.");
  } finally {
    try { await browserCdp?.send("Browser.close"); } catch { /* browser mungkin sudah tertutup */ }
    browserCdp?.close();
    pageCdp?.close();
    try { if (enforceEdge && !enforceEdge.killed) enforceEdge.kill(); } catch { /* sudah berhenti */ }
    try { if (!offEdge.killed) offEdge.kill(); } catch { /* sudah berhenti */ }
    if (!chrome.killed) chrome.kill();
    await tutup(proxyServer);
    await tutup(stubServer);
    await tutup(appServer);
    await sleep(150);
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* profil sementara bisa tertinggal */ }
    if (chromeOutput.trim()) {
      const lines = chromeOutput.trim().split(/\r?\n/).filter((line) => /error|failed|exception/i.test(line));
      if (lines.length) console.error(`Chrome: ${lines.slice(-3).join(" | ")}`);
    }
  }
}

main().catch((error) => {
  console.error(`GAGAL: ${error.message}`);
  process.exitCode = 1;
});
