/* ============================================================================
   Uji browser nyata: laporan tautan mati antar-pengguna.
   ----------------------------------------------------------------------------
   Tiga pengguna dijalankan di TIGA browser context terpisah (localStorage dan
   token pelapor berbeda), semuanya menunjuk server lokal yang sama:

     A  menandai tautan unduhan + mirror pertama
     B  menandai objek yang sama -> jumlah pelapor menjadi 2
     C  pengguna baru: objek itu harus sudah tersembunyi tanpa pernah
        menandainya, lalu memulihkannya dan tetap terlihat setelah reload

   Semua data anime dipalsukan lewat Fetch domain supaya uji tidak menyentuh
   Animasu/Samehadaku. Yang TIDAK dipalsukan hanya /api/laporan-tautan:
   endpoint itu harus benar-benar menulis ke server lokal, karena inti uji ini
   adalah laporan dari satu pengguna sampai ke pengguna lain.

   Request /api/ lain yang tidak punya fixture GAGAL, tidak dijawab kosong.
   Jadi endpoint baru tidak bisa lolos diam-diam hanya karena fallback.

   Jalankan: npm run test:laporan
   Chrome/Edge dicari otomatis; override dengan CHROME_PATH bila perlu.
   ========================================================================== */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

/* Diset SEBELUM server dimuat: laporan uji tidak boleh menulis ke data
   produksi, dan ambang dipaku 2 supaya hasilnya tidak bergantung env mesin. */
const LAPORAN_FILE = path.join(os.tmpdir(), `iln-laporan-browser-${process.pid}-${Date.now()}.json`);
process.env.ILN_LAPORAN_FILE = LAPORAN_FILE;
process.env.LAPORAN_AMBANG = "2";

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

const SLUG = "uji-laporan";
const EPISODE = `${SLUG}-episode-1`;
const MIRROR_INDEX = 0;

const ANIME = {
  slug: SLUG,
  id: SLUG,
  title: "Uji Laporan Dua Pengguna",
  posterUrl: "/assets/double-click.webp",
  rating: 8.1,
  totalEpisodes: 1,
  type: "Series",
  status: "Selesai Tayang",
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

function fixturesUntuk(port) {
  const mirrorUrl = (nomor) => `http://127.0.0.1:${port}/api/mirror-uji/${nomor}`;
  const batch = {
    title: "Batch [1]",
    range: "1",
    mirrors: [
      {
        quality: "720p",
        range: "",
        links: [
          { label: "Pixeldrain", url: "https://pixeldrain.test/u/uji-satu", host: "pixeldrain.test" },
          { label: "Mediafire", url: "https://mediafire.test/file/uji-dua", host: "mediafire.test" },
        ],
      },
    ],
  };
  return {
    "/api/health": { ok: true },
    "/api/daily": { data: [ANIME], slides: [], total: 1 },
    "/api/genres": { data: [] },
    "/api/recommendations": { data: [], total: 0 },
    "/api/catalog": { data: [], total: 0 },
    [`/api/anime/${SLUG}`]: {
      data: {
        ...ANIME,
        studio: "Studio Uji",
        synopsis: "Fixture lokal untuk uji laporan tautan mati antar-pengguna.",
        genres: [],
        episodes: [{ number: 1, slug: EPISODE, title: "Episode 1" }],
        batches: [],
      },
    },
    [`/api/anime/${SLUG}/downloads`]: { data: [batch], provider: "samehadaku", fallback: false, pending: false },
    [`/api/streams/${EPISODE}`]: {
      data: [
        { name: "MasuServer1", url: mirrorUrl(1), source: "animasu" },
        { name: "MasuServer2", url: mirrorUrl(2), source: "animasu" },
        { name: "MasuServer3", url: mirrorUrl(3), source: "animasu" },
      ],
      total: 3,
      provider: "yaoi",
    },
  };
}

/* Pola luas: SEMUA request /api/ ikut ditangkap, bukan hanya endpoint yang
   sudah dikenal. Endpoint baru karena itu tidak bisa lolos diam-diam dengan
   jawaban kosong - lihat penanganan "tak dikenal" di pasangFetchPalsu. */
const FETCH_PATTERNS = [
  { urlPattern: "*/api/*", requestStage: "Request" },
];

/* Satu-satunya jalur API yang memang harus sampai ke server lokal: uji ini
   memverifikasi laporan benar-benar tersimpan di sana. */
const API_TERUSKAN = new Set(["/api/laporan-tautan"]);

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

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
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
      this.socket.send(JSON.stringify({ id, method, params }));
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

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "eval gagal";
    throw new Error(description);
  }
  return response.result?.value;
}

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

/* Titik tengah elemen yang benar-benar terlihat dan tidak tertutup lapisan
   lain. Elemen tersembunyi (mis. tautan yang baru disembunyikan laporan)
   mengembalikan null, jadi kegagalan uji jelas sebabnya. */
async function rectOf(cdp, selector, label = selector) {
  return JSON.parse(await waitFor(() => evaluate(cdp, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return null;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) return null;
      return JSON.stringify({ x, y });
    })()
  `), { timeoutMs: 8000, label }));
}

async function clickSelector(cdp, selector, label = selector) {
  const rect = await rectOf(cdp, selector, label);
  await mouseClick(cdp, rect.x, rect.y);
  return rect;
}

function pasangFetchPalsu(cdp, fixtures, errors, takDikenal) {
  cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/mirror-uji/")) {
        const html = "<!doctype html><meta charset=\"utf-8\"><title>Mirror uji</title><body>mirror uji</body>";
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
          body: Buffer.from(html).toString("base64"),
        });
        return;
      }
      if (API_TERUSKAN.has(url.pathname)) {
        await cdp.send("Fetch.continueRequest", { requestId });
        return;
      }
      const fixture = fixtures[url.pathname];
      if (fixture === undefined) {
        /* Bukan jalur yang diizinkan dan tidak ada fixture: jangan jawab
           kosong. Catat lalu gagalkan request supaya uji berhenti dengan
           nama endpoint yang jelas. */
        takDikenal.push(url.pathname);
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
        return;
      }
      await cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/json; charset=utf-8" },
          { name: "Cache-Control", value: "no-store" },
        ],
        body: Buffer.from(JSON.stringify(fixture)).toString("base64"),
      });
    } catch (error) {
      errors.push(error);
    }
  });
}

async function bukaPengguna({ browserCdp, debugPort, appUrl, fixtures, errors, takDikenal, label }) {
  const { browserContextId } = await browserCdp.send("Target.createBrowserContext", { disposeOnDetach: false });
  const { targetId } = await browserCdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const target = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((item) => item.id === targetId) || null;
  }, { timeoutMs: 15000, label: `target ${label}` });

  const cdp = await new Cdp(target.webSocketDebuggerUrl).connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  pasangFetchPalsu(cdp, fixtures, errors, takDikenal);
  await cdp.send("Fetch.enable", { patterns: FETCH_PATTERNS });
  await cdp.send("Page.navigate", { url: appUrl });
  await waitFor(() => evaluate(cdp, "document.readyState").then((state) => state === "complete"), { label: `halaman ${label} dimuat` });
  await waitFor(() => evaluate(cdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`), { timeoutMs: 15000, label: `kartu ${label} tampil` });
  return { cdp, browserContextId, targetId, label };
}

async function bukaDetail(user) {
  const { cdp } = user;
  await clickSelector(cdp, `#updateGrid .anime-card[data-id="${SLUG}"] .card-title`, `judul kartu ${user.label}`);
  await waitFor(() => evaluate(cdp, "document.querySelector('#watchOverlay')?.hidden === false"), { timeoutMs: 10000, label: `detail ${user.label} terbuka` });
  /* Minimal satu: pengguna C memang sudah kehilangan satu tautan karena
     laporan publik, jadi jumlah dua tidak boleh dijadikan syarat buka detail. */
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('#watchDownloads .dl-link').length >= 1`), { timeoutMs: 10000, label: `tautan unduhan ${user.label}` });
  /* Minimal satu: mirror yang dilaporkan sudah tersembunyi dari daftar,
     jadi jumlah tiga hanya berlaku untuk pengguna yang belum melihat laporan. */
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('#mirrorOptions [data-mirror-index]').length >= 1`), { timeoutMs: 10000, label: `mirror ${user.label}` });
}

async function muatUlang(user, appUrl) {
  await user.cdp.send("Page.navigate", { url: appUrl });
  await waitFor(() => evaluate(user.cdp, "document.readyState").then((state) => state === "complete"), { label: `halaman ${user.label} dimuat ulang` });
  await waitFor(() => evaluate(user.cdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`), { timeoutMs: 15000, label: `kartu ${user.label} setelah reload` });
}

async function idUnduhanPertama(cdp) {
  return evaluate(cdp, `document.querySelector('#watchDownloads [data-dl-mati]')?.getAttribute('data-dl-mati') || ''`);
}

async function daftarIdUnduhan(cdp) {
  const mentah = await evaluate(cdp, `JSON.stringify([...document.querySelectorAll('#watchDownloads [data-dl-mati]')].map((b) => b.getAttribute('data-dl-mati')))`);
  return JSON.parse(mentah);
}

async function teksPembuka(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ''`);
}

async function tandaiUnduhan(user, id) {
  const { cdp } = user;
  await clickSelector(cdp, "#watchDownloads [data-dl-toggle]", "pilih resolusi");
  await clickSelector(cdp, "#watchDownloads [data-dl-options]:not([hidden]) [data-dl-option]", "pilihan resolusi");
  await clickSelector(cdp, `#watchDownloads [data-dl-mati="${id}"]`, "tombol tandai unduhan");
  await waitFor(() => teksPembuka(cdp, "#watchDownloads [data-dl-tampil-mati]").then((text) => text.includes("1")), {
    timeoutMs: 6000,
    label: `unduhan ${user.label} ditandai`,
  });
}

async function pulihkanUnduhan(user, id) {
  const { cdp } = user;
  await clickSelector(cdp, "#watchDownloads [data-dl-tampil-mati]", "tampilkan tautan mati");
  /* Tombol pulih ada di dalam sub-menu resolusi yang tertutup; pengguna
     membukanya lewat dropdown yang sama seperti saat menandai. */
  await clickSelector(cdp, "#watchDownloads [data-dl-toggle]", "pilih resolusi untuk memulihkan");
  await clickSelector(cdp, "#watchDownloads [data-dl-options]:not([hidden]) [data-dl-option]", "pilihan resolusi untuk memulihkan");
  await clickSelector(cdp, `#watchDownloads [data-dl-hidup="${id}"]`, "pulihkan tautan unduhan");
  await waitFor(() => evaluate(cdp, `document.querySelector('#watchDownloads [data-dl-mati="${id}"]') !== null`), {
    timeoutMs: 6000,
    label: `unduhan ${user.label} dipulihkan`,
  });
}

async function bukaPilihanMirror(cdp) {
  if (await evaluate(cdp, "document.querySelector('#mirrorOptions')?.hidden === false")) return;
  await clickSelector(cdp, "#mirrorTrigger", "buka pilihan mirror");
  await waitFor(() => evaluate(cdp, "document.querySelector('#mirrorOptions')?.hidden === false"), {
    timeoutMs: 5000,
    label: "panel mirror terbuka",
  });
}

async function tandaiMirror(user, index) {
  const { cdp } = user;
  await bukaPilihanMirror(cdp);
  await clickSelector(cdp, `#mirrorOptions [data-mirror-mati="${index}"]`, "tombol tandai mirror");
  await waitFor(() => teksPembuka(cdp, "#mirrorOptions [data-mirror-tampil-mati]").then((text) => text.includes("1")), {
    timeoutMs: 6000,
    label: `mirror ${user.label} ditandai`,
  });
}

async function pulihkanMirror(user, index) {
  const { cdp } = user;
  await bukaPilihanMirror(cdp);
  await clickSelector(cdp, "#mirrorOptions [data-mirror-tampil-mati]", "tampilkan mirror mati");
  await clickSelector(cdp, `#mirrorOptions [data-mirror-hidup="${index}"]`, "pulihkan mirror");
  await waitFor(() => evaluate(cdp, `document.querySelector('#mirrorOptions [data-mirror-mati="${index}"]') !== null`), {
    timeoutMs: 6000,
    label: `mirror ${user.label} dipulihkan`,
  });
}

async function laporanServer(appUrl, episode = "") {
  const alamat = `${appUrl}api/laporan-tautan${episode ? `?episode=${encodeURIComponent(episode)}` : ""}`;
  const response = await fetch(alamat);
  if (!response.ok) throw new Error(`GET laporan gagal: HTTP ${response.status}`);
  return response.json();
}

async function tungguJumlah(appUrl, { episode = "", jenis, id, jumlah }) {
  return waitFor(async () => {
    const hasil = await laporanServer(appUrl, episode);
    const item = (hasil.data || []).find((entry) => entry.jenis === jenis && entry.id === id);
    if (!item || item.jumlah !== jumlah) return null;
    return item;
  }, { timeoutMs: 15000, label: `laporan ${jenis} ${id} berjumlah ${jumlah}` });
}

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  if (!chromePath) throw new Error("Chrome/Edge tidak ditemukan. Set CHROME_PATH ke executable browser.");

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const appPort = server.address().port;
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const fixtures = fixturesUntuk(appPort);
  const debugPort = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-laporan-profil-"));

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
  chrome.once("error", (error) => { chromeOutput += `\nspawn error: ${error.message}`; });

  let browserCdp = null;
  const users = [];
  const fetchErrors = [];
  /* Endpoint /api/ di luar fixture dan daftar teruskan dicatat di sini.
     Uji GAGAL setelahnya, bukan menjawab kosong dan lanjut diam-diam. */
  const apiTakDikenal = [];

  try {
    const version = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.ok ? response.json() : null;
    }, { timeoutMs: 20000, label: "browser CDP siap" });

    browserCdp = await new Cdp(version.webSocketDebuggerUrl).connect();
    const opsi = { browserCdp, debugPort, appUrl, fixtures, errors: fetchErrors, takDikenal: apiTakDikenal };

    /* ---------- Pengguna A: laporan pertama ---------- */
    const a = await bukaPengguna({ ...opsi, label: "A" });
    users.push(a);
    await bukaDetail(a);
    if (apiTakDikenal.length) {
      throw new Error(`request API tanpa fixture: ${[...new Set(apiTakDikenal)].join(", ")}. Tambahkan ke fixture atau API_TERUSKAN.`);
    }
    const idUnduhan = await idUnduhanPertama(a.cdp);
    if (!idUnduhan) throw new Error("tautan unduhan pertama tidak punya identitas penanda");
    if ((await daftarIdUnduhan(a.cdp)).length !== 2) throw new Error("fixture unduhan harus menampilkan tepat 2 tautan");
    await tandaiUnduhan(a, idUnduhan);
    await tungguJumlah(appUrl, { jenis: "unduhan", id: idUnduhan, jumlah: 1 });
    const tokenA = await evaluate(a.cdp, "localStorage.getItem('iln:pelapor:v1')");
    if (!tokenA) throw new Error("pengguna A tidak membuat token pelapor");
    console.log(`LULUS: A menandai unduhan ${idUnduhan}; laporan server berjumlah 1 dan disembunyikan lokal.`);

    /* ---------- Pengguna B: satu laporan belum cukup ---------- */
    const b = await bukaPengguna({ ...opsi, label: "B" });
    users.push(b);
    await bukaDetail(b);
    if (!(await daftarIdUnduhan(b.cdp)).includes(idUnduhan)) {
      throw new Error("laporan satu pengguna sudah menyembunyikan tautan untuk pengguna lain");
    }
    await tandaiUnduhan(b, idUnduhan);
    await tungguJumlah(appUrl, { jenis: "unduhan", id: idUnduhan, jumlah: 2 });
    const tokenB = await evaluate(b.cdp, "localStorage.getItem('iln:pelapor:v1')");
    if (!tokenB || tokenB === tokenA) throw new Error("dua pengguna memakai token pelapor yang sama");
    console.log("LULUS: B tetap melihat tautan setelah 1 laporan; laporan B membuat jumlah menjadi 2.");

    /* ---------- Pengguna C: laporan bersama sudah berlaku ---------- */
    const c = await bukaPengguna({ ...opsi, label: "C" });
    users.push(c);
    await bukaDetail(c);
    if ((await daftarIdUnduhan(c.cdp)).includes(idUnduhan)) {
      throw new Error("pengguna C tanpa riwayat lokal masih melihat tautan yang dilaporkan 2 orang");
    }
    const pembukaUnduhan = await teksPembuka(c.cdp, "#watchDownloads [data-dl-tampil-mati]");
    if (!/Tampilkan 1 tautan mati/.test(pembukaUnduhan)) {
      throw new Error(`tombol tampilkan unduhan tidak sesuai: "${pembukaUnduhan}"`);
    }
    await pulihkanUnduhan(c, idUnduhan);
    console.log("LULUS: C melihat tautan sudah tersembunyi oleh 2 laporan; setelah dipulihkan tautan kembali.");

    /* ---------- Mirror: alur yang sama, dipisah per episode ---------- */
    await tandaiMirror(a, MIRROR_INDEX);
    const laporanMirror = await laporanServer(appUrl, EPISODE);
    const mirrorPertama = (laporanMirror.data || []).find((item) => item.jenis === "mirror" && item.episode === EPISODE);
    if (!mirrorPertama || mirrorPertama.jumlah !== 1) throw new Error("laporan mirror A tidak tercatat");
    const idMirror = mirrorPertama.id;
    await tungguJumlah(appUrl, { episode: EPISODE, jenis: "mirror", id: idMirror, jumlah: 1 });

    await tandaiMirror(b, MIRROR_INDEX);
    await tungguJumlah(appUrl, { episode: EPISODE, jenis: "mirror", id: idMirror, jumlah: 2 });
    console.log(`LULUS: A dan B melaporkan mirror ${idMirror}; jumlah pelapor 2.`);

    /* C memuat ulang: laporan mirror terbaru ikut terambil, sedangkan
       pemulihan unduhan tadi harus tetap berlaku. */
    await muatUlang(c, appUrl);
    await bukaDetail(c);
    if (!(await daftarIdUnduhan(c.cdp)).includes(idUnduhan)) {
      throw new Error("tautan unduhan yang sudah dipulihkan tersembunyi lagi setelah reload");
    }
    if (await evaluate(c.cdp, `document.querySelector('#mirrorOptions [data-mirror-mati="${MIRROR_INDEX}"]') !== null`)) {
      throw new Error("mirror yang dilaporkan 2 orang masih tampil di pengguna C");
    }
    const pembukaMirror = await teksPembuka(c.cdp, "#mirrorOptions [data-mirror-tampil-mati]");
    if (!/Tampilkan 1 mirror mati/.test(pembukaMirror)) {
      throw new Error(`tombol tampilkan mirror tidak sesuai: "${pembukaMirror}"`);
    }
    await pulihkanMirror(c, MIRROR_INDEX);

    await muatUlang(c, appUrl);
    await bukaDetail(c);
    if (!(await daftarIdUnduhan(c.cdp)).includes(idUnduhan)) {
      throw new Error("pemulihan unduhan tidak bertahan setelah reload kedua");
    }
    if (await evaluate(c.cdp, `document.querySelector('#mirrorOptions [data-mirror-mati="${MIRROR_INDEX}"]') === null`)) {
      throw new Error("pemulihan mirror tidak bertahan setelah reload kedua");
    }
    const simpananHidup = JSON.parse(await evaluate(c.cdp, "localStorage.getItem('iln:tautan-hidup:v1')"));
    if (!simpananHidup?.item?.[`unduh|${idUnduhan}`]) throw new Error("penanda 'terbukti hidup' unduhan tidak tersimpan");
    if (!simpananHidup?.item?.[`mirror|${EPISODE}|${idMirror}`]) throw new Error("penanda 'terbukti hidup' mirror tidak tersimpan");
    console.log("LULUS: pemulihan unduhan dan mirror bertahan setelah reload; laporan publik tetap 2.");

    /* ---------- Laporan tidak membawa URL atau token asli ---------- */
    await sleep(900);
    if (!fs.existsSync(LAPORAN_FILE)) throw new Error("server tidak menulis berkas laporan uji");
    const mentah = fs.readFileSync(LAPORAN_FILE, "utf8");
    if (/https?:\/\//.test(mentah)) throw new Error("berkas laporan memuat URL sumber");
    if (mentah.includes(tokenA) || mentah.includes(tokenB)) throw new Error("berkas laporan memuat token pelapor asli");
    if (mentah.includes("pixeldrain")) throw new Error("berkas laporan memuat nama host");
    const isi = JSON.parse(mentah);
    if (!isi?.item?.[`unduhan|${idUnduhan}`]) throw new Error("laporan unduhan tidak tersimpan di berkas");
    if (!isi?.item?.[`mirror|${EPISODE}|${idMirror}`]) throw new Error("laporan mirror tidak tersimpan di berkas");
    console.log("LULUS: berkas laporan hanya berisi hash tautan dan hash pelapor.");

    const sisa = await laporanServer(appUrl, EPISODE);
    const unduhanAkhir = (sisa.data || []).find((item) => item.jenis === "unduhan" && item.id === idUnduhan);
    const mirrorAkhir = (sisa.data || []).find((item) => item.jenis === "mirror" && item.id === idMirror);
    if (unduhanAkhir?.jumlah !== 2 || mirrorAkhir?.jumlah !== 2) {
      throw new Error("jumlah laporan berubah setelah pemulihan; pemulihan seharusnya hanya lokal");
    }
    if (apiTakDikenal.length) {
      throw new Error(`request API tanpa fixture: ${[...new Set(apiTakDikenal)].join(", ")}. Tambahkan ke fixture atau API_TERUSKAN.`);
    }
    if (fetchErrors.length) throw new Error(`handler Fetch gagal: ${fetchErrors[0].message}`);
    console.log("LULUS: pemulihan tidak menghapus laporan pengguna lain.");
    console.log("LULUS: tidak ada request /api/ yang lolos tanpa fixture.");
  } finally {
    for (const user of users) {
      try { await browserCdp?.send("Target.disposeBrowserContext", { browserContextId: user.browserContextId }); } catch { /* konteks mungkin sudah hilang */ }
    }
    try { await browserCdp?.send("Browser.close"); } catch { /* browser mungkin sudah tertutup */ }
    browserCdp?.close();
    users.forEach((user) => user.cdp.close());
    if (!chrome.killed) chrome.kill();
    await new Promise((resolve) => server.close(resolve));
    await sleep(150);
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* profil sementara bisa tertinggal */ }
    try { fs.rmSync(LAPORAN_FILE, { force: true }); } catch { /* berkas uji bisa tertinggal */ }
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
