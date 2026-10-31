/* ============================================================================
   Uji browser nyata untuk unduhan Google Drive dari halaman detail.
   ----------------------------------------------------------------------------
   Chrome/Edge headless lewat CDP. Semua request /api/* dipalsukan lewat
   Fetch domain supaya uji tidak menyentuh source luar, KECUALI
   /api/download: klik tautan benar-benar sampai ke server lokal, server
   membalas 302 ke endpoint direct Google Drive, dan endpoint itulah yang
   dipalsukan menjadi file kecil. Jadi resolver server ikut teruji.

   Request /api/ lain yang tidak punya fixture GAGAL, tidak dijawab kosong.
   Jadi endpoint baru tidak bisa lolos diam-diam hanya karena fallback.

   Yang diuji:
   1. Kartu di New Update membuka halaman detail.
   2. Tautan Google Drive dirender same-tab (tanpa target=_blank).
   3. Klik tautan memulai unduhan tanpa memindahkan tab: URL, riwayat, dan
      dokumen tetap sama; tidak ada navigasi main frame yang commit.
   4. Setelah unduhan mulai, Browser.cancelDownload membatalkannya.
   5. Klik kedua pada tautan yang sama dalam 1 detik ditolak batas satu
      tekan: hanya satu unduhan, dan pengingat "Bersabarlah sedikit" muncul.
   6. Setelah jendela 1 detik lewat, tautan yang sama menerima klik lagi:
      unduhan kedua benar-benar mulai, lalu dibatalkan.

   Jalankan: npm run test:download
   Chrome/Edge dicari otomatis; override dengan CHROME_PATH bila perlu.
   ========================================================================== */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

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

const SLUG = "uji-drive";
const DRIVE_FILE_ID = "1UjiDriveFileId1234567890abcdef";
const DRIVE_URL = `https://drive.google.com/file/d/${DRIVE_FILE_ID}/view`;
const DOWNLOAD_BYTES = 3 * 1024 * 1024;
const DOWNLOAD_NAME = "uji-drive.txt";

const ANIME_FIXTURE = {
  slug: SLUG,
  id: SLUG,
  title: "Uji Unduhan Drive",
  posterUrl: "/assets/double-click.webp",
  rating: 8.4,
  totalEpisodes: 12,
  type: "Series",
  status: "Selesai Tayang",
};

const DETAIL_FIXTURE = {
  data: {
    ...ANIME_FIXTURE,
    studio: "Studio Uji",
    synopsis: "Fixture lokal untuk menguji unduhan Google Drive di halaman detail.",
    genres: [{ name: "Aksi", slug: "aksi" }],
    episodes: [{ number: 1, slug: `${SLUG}-episode-1`, title: "Episode 1" }],
    batches: [
      {
        title: "Batch [1-12]",
        range: "1-12",
        mirrors: [
          {
            quality: "720p",
            range: "",
            links: [
              {
                label: "Google Drive",
                host: "drive.google.com",
                url: DRIVE_URL,
                download: `/api/download?url=${encodeURIComponent(DRIVE_URL)}`,
              },
            ],
          },
        ],
      },
    ],
  },
};

/* Halaman detail mengambil batch lewat endpoint terpisah, bukan dari
   payload detail. Tanpa fixture ini endpoint menjawab { data: [] } dan
   menimpa batch fixture, sehingga tautan Drive tidak pernah dirender. */
const DOWNLOADS_FIXTURE = {
  data: DETAIL_FIXTURE.data.batches,
  provider: "uji",
  pending: false,
};

const API_FIXTURES = {
  "/api/health": { ok: true },
  "/api/daily": { data: [ANIME_FIXTURE], slides: [], total: 1 },
  "/api/genres": { data: [] },
  "/api/recommendations": { data: [], total: 0 },
  "/api/catalog": { data: [], total: 0 },
  [`/api/anime/${SLUG}`]: DETAIL_FIXTURE,
  [`/api/anime/${SLUG}/downloads`]: DOWNLOADS_FIXTURE,
  /* Dipanggil saat detail dibuka; tanpa fixture ia menembak berkas laporan
     asli dan membuat hasil bergantung pada isi disk. */
  "/api/laporan-tautan": { data: [], ambang: 2 },
  /* Episode pertama ikut diputar saat detail terbuka. Mirror kosong sudah
     cukup: uji ini hanya peduli pada tautan unduhan. */
  [`/api/streams/${SLUG}-episode-1`]: { data: [] },
};

/* Pola luas: SEMUA request /api/ ikut ditangkap, bukan hanya endpoint yang
   sudah dikenal. Endpoint baru karena itu tidak bisa lolos diam-diam dengan
   jawaban kosong - lihat penanganan "tak dikenal" di bawah. */
const FETCH_PATTERNS = [
  { urlPattern: "*/api/*", requestStage: "Request" },
  { urlPattern: "*drive.usercontent.google.com*", requestStage: "Request" },
];

/* Hanya jalur ini yang memang harus sampai ke server lokal. /api/download
   diuji resolver 302-nya, jadi tidak boleh dipalsukan. */
const API_TERUSKAN = new Set(["/api/download"]);

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
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    userGesture: true,
  });
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
   lain. Dipakai ulang oleh klik tunggal maupun klik ganda. */
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
      /* Koordinat harus menunjuk elemen ini juga, bukan lapisan di atasnya. */
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) return null;
      return JSON.stringify({ x, y });
    })()
  `), { timeoutMs: 6000, label }));
}

/* Klik nyata pada elemen: gulir ke tengah, pastikan benar-benar berada di
   dalam viewport, lalu kirim mouse event lewat CDP. */
async function clickSelector(cdp, selector, label = selector) {
  const rect = await rectOf(cdp, selector, label);
  await mouseClick(cdp, rect.x, rect.y);
  return rect;
}

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  if (!chromePath) {
    throw new Error("Chrome/Edge tidak ditemukan. Set CHROME_PATH ke executable browser.");
  }

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const appPort = server.address().port;
  const appUrl = `http://127.0.0.1:${appPort}/`;
  const debugPort = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-download-browser-"));
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-download-file-"));
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

  let cdp = null;
  let browserCdp = null;
  const pausedErrors = [];
  /* Setiap endpoint /api/ yang tidak punya fixture dicatat di sini. Uji
     GAGAL setelahnya, bukan menjawab { data: [] } dan lanjut diam-diam. */
  const apiTakDikenal = [];
  const driveRequests = [];
  let interceptedDrive = false;

  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === "page") || null;
    }, { timeoutMs: 20000, label: "target browser" });

    cdp = await new Cdp(target.webSocketDebuggerUrl).connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

    /* Download domain ada di sesi browser, bukan sesi page. */
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    browserCdp = await new Cdp(version.webSocketDebuggerUrl).connect();
    await browserCdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
      eventsEnabled: true,
    });

    cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
      try {
        const url = new URL(request.url);
        if (url.hostname === "drive.usercontent.google.com") {
          interceptedDrive = true;
          driveRequests.push(request.url);
          /* File kecil berukuran beberapa MB: cukup lama untuk dibatalkan
             setelah Browser.downloadWillBegin, tanpa menyentuh Drive asli. */
          const body = Buffer.alloc(DOWNLOAD_BYTES, 0x41).toString("base64");
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/octet-stream" },
              { name: "Content-Disposition", value: `attachment; filename="${DOWNLOAD_NAME}"` },
              { name: "Content-Length", value: String(DOWNLOAD_BYTES) },
            ],
            body,
          });
          return;
        }
        if (API_TERUSKAN.has(url.pathname)) {
          await cdp.send("Fetch.continueRequest", { requestId });
          return;
        }
        const fixture = API_FIXTURES[url.pathname];
        if (fixture === undefined) {
          apiTakDikenal.push(url.pathname);
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
        pausedErrors.push(error);
      }
    });
    await cdp.send("Fetch.enable", { patterns: FETCH_PATTERNS });

    await cdp.send("Page.navigate", { url: appUrl });
    await waitFor(() => evaluate(cdp, "document.readyState").then((state) => state === "complete"), { label: "halaman selesai dimuat" });
    await waitFor(() => evaluate(cdp, "document.querySelector('#pcName')?.textContent?.trim() || ''").then((name) => name && name !== "Dummy User"), { label: "modul aplikasi siap" });
    await waitFor(() => evaluate(cdp, `document.querySelector('#updateGrid .anime-card[data-id="${SLUG}"]') !== null`), { label: "kartu fixture tampil" });

    /* ---------- 1. Buka halaman detail dari kartu ---------- */
    await clickSelector(cdp, `#updateGrid .anime-card[data-id="${SLUG}"] .card-title`, "judul kartu");
    await waitFor(() => evaluate(cdp, `document.querySelector('#watchOverlay')?.hidden === false`), { timeoutMs: 8000, label: "modal detail terbuka" });
    const judul = await evaluate(cdp, "document.querySelector('#watchTitle')?.textContent?.trim()");
    if (judul !== ANIME_FIXTURE.title) throw new Error(`judul detail salah: ${judul}`);
    const tautan = JSON.parse(await waitFor(() => evaluate(cdp, `
      (() => {
        const link = document.querySelector('#watchDownloads .dl-link[href^="/api/download"]');
        if (!link) return null;
        return JSON.stringify({
          href: link.getAttribute('href'),
          target: link.getAttribute('target'),
          rel: link.getAttribute('rel'),
          label: link.textContent.trim(),
        });
      })()
    `), { timeoutMs: 6000, label: "tautan Drive same-tab" }));
    if (tautan.target) throw new Error(`tautan Drive seharusnya same-tab, target=${tautan.target}`);
    if (tautan.label !== "Google Drive") throw new Error(`label tautan salah: ${tautan.label}`);
    if (!tautan.href.includes(encodeURIComponent(DRIVE_URL))) throw new Error(`href tidak membawa URL Drive: ${tautan.href}`);
    if (apiTakDikenal.length) {
      throw new Error(`request API tanpa fixture: ${[...new Set(apiTakDikenal)].join(", ")}. Tambahkan ke API_FIXTURES.`);
    }

    /* ---------- 2. Buka dropdown lalu sub-menu Drive ---------- */
    await clickSelector(cdp, "#watchDownloads [data-dl-toggle]", "tombol pilih resolusi");
    await clickSelector(cdp, "#watchDownloads [data-dl-options]:not([hidden]) [data-dl-option]", "pilihan resolusi");
    await waitFor(() => evaluate(cdp, "document.querySelector('#watchDownloads [data-dl-sub]:not([hidden]) .dl-link[href^=\"/api/download\"]') !== null"), { label: "sub-menu Drive terbuka" });

    /* ---------- 3. Klik Drive: pantau unduhan dan navigasi ---------- */
    const sebelum = JSON.parse(await evaluate(cdp, "JSON.stringify({ href: location.href, ready: document.readyState })"));
    const riwayatSebelum = await cdp.send("Page.getNavigationHistory");
    let navigasiFrame = 0;
    const unduhan = [];
    browserCdp.on("Browser.downloadWillBegin", (params) => { unduhan.push({ ...params, at: Date.now() }); });
    /* Kalau respons Drive justru dirender sebagai halaman, navigasi commit
       lebih dulu. Gagalkan segera dengan sebab yang jelas, jangan menunggu
       timeout 20 detik. Promise-nya di-catch sekali supaya rejection setelah
       unduhan menang tidak menjadi unhandled rejection. */
    let tolakNavigasi = null;
    const gagalNavigasi = new Promise((_, reject) => { tolakNavigasi = reject; });
    gagalNavigasi.catch(() => { /* sudah ditangani; race tetap memakai promise aslinya */ });
    cdp.on("Page.frameNavigated", ({ frame }) => {
      if (frame?.parentId) return;
      navigasiFrame += 1;
      tolakNavigasi?.(new Error(`tab berpindah ke ${frame.url} sebelum unduhan dimulai`));
    });
    const progres = [];
    browserCdp.on("Browser.downloadProgress", (params) => progres.push(params));

    const tautanDrive = "#watchDownloads [data-dl-sub]:not([hidden]) .dl-link[href^=\"/api/download\"]";
    const kotak = await rectOf(cdp, tautanDrive, "tautan Drive");
    /* Tandai elemennya: klik ketiga harus memakai elemen yang SAMA, bukan
       tautan hasil render ulang yang cooldown-nya kosong. */
    await evaluate(cdp, `(() => { document.querySelector(${JSON.stringify(tautanDrive)}).dataset.ujiDrive = "1"; return true; })()`);
    /* Pengingat yang muncul nanti harus berasal dari klik kedua, bukan sisa
       klik sebelumnya. */
    if (await evaluate(cdp, "document.querySelector('[data-double-click-overlay]:not([hidden])') !== null")) {
      throw new Error("pengingat klik ganda sudah terbuka sebelum uji klik kedua");
    }
    /* Dua klik nyata pada tautan yang sama, berjarak ~120 ms — jauh di dalam
       jendela 1 detik batas satu tekan. Klik kedua harus ditolak limiter. */
    const klikPertama = Date.now();
    await mouseClick(cdp, kotak.x, kotak.y);
    await sleep(120);
    /* Klik pertama boleh menutup dropdown, tetapi tautannya harus tetap di
       posisi yang sama supaya klik kedua benar-benar mengena tautan itu. */
    const masihTautan = await evaluate(cdp, `
      (() => {
        const el = document.elementFromPoint(${kotak.x}, ${kotak.y});
        return Boolean(el?.closest?.('a.dl-link[href^="/api/download"]'));
      })()
    `);
    if (!masihTautan) throw new Error("posisi klik kedua bukan lagi tautan Drive");
    const klikKedua = Date.now();
    await mouseClick(cdp, kotak.x, kotak.y);
    const jarakKlik = klikKedua - klikPertama;
    if (jarakKlik >= 1000) throw new Error(`klik kedua terlalu lambat untuk menguji batas 1 detik: ${jarakKlik} ms`);

    const info = await Promise.race([
      waitFor(() => unduhan[0] || null, { timeoutMs: 20000, label: "Browser.downloadWillBegin" }),
      gagalNavigasi,
    ]);
    if (info.suggestedFilename !== DOWNLOAD_NAME) {
      throw new Error(`nama berkas unduhan salah: ${info.suggestedFilename}`);
    }
    if (!interceptedDrive || !driveRequests.length) {
      throw new Error("klik tidak sampai ke endpoint direct Google Drive lewat resolver server");
    }
    const driveUrl = new URL(driveRequests[0]);
    if (driveUrl.searchParams.get("id") !== DRIVE_FILE_ID || driveUrl.searchParams.get("export") !== "download") {
      throw new Error(`URL direct Drive tidak sesuai: ${driveRequests[0]}`);
    }

    /* ---------- 4. Batalkan segera setelah unduhan mulai ----------
       Klik kedua sudah dikirim tadi, jadi pengingatnya sudah tampil. Unduhan
       dibatalkan sekarang supaya berkas 3 MB tidak selesai lebih dulu. */
    await browserCdp.send("Browser.cancelDownload", { guid: info.guid });
    const dibatalkan = await waitFor(async () => {
      const akhir = progres.filter((item) => item.guid === info.guid).at(-1);
      if (!akhir) return null;
      if (akhir.state === "completed") throw new Error("unduhan selesai sebelum sempat dibatalkan");
      return akhir.state === "canceled" ? akhir : null;
    }, { timeoutMs: 10000, label: "unduhan dibatalkan" });

    /* ---------- 5. Klik kedua dalam 1 detik tidak memulai unduhan kedua ---------- */
    const pengingat = JSON.parse(await waitFor(() => evaluate(cdp, `
      (() => {
        const overlay = document.querySelector("[data-double-click-overlay]:not([hidden])");
        if (!overlay) return null;
        const dialog = overlay.querySelector("[data-double-click-dialog]");
        return JSON.stringify({
          title: dialog?.querySelector("h2")?.textContent?.trim() || "",
          buttons: dialog ? dialog.querySelectorAll("button").length : 0,
        });
      })()
    `).catch(() => null), { timeoutMs: 3000, label: "pengingat klik ganda tampil" }));
    if (pengingat.title !== "Bersabarlah sedikit") throw new Error(`pengingat klik ganda tidak muncul benar: ${pengingat.title}`);
    if (pengingat.buttons !== 1) throw new Error(`pengingat klik ganda punya ${pengingat.buttons} tombol, seharusnya 1`);
    /* Beri waktu lebih dari jendela 1 detik: kalau klik kedua lolos, unduhan
       dan request direct Drive kedua akan terlihat di sini. */
    await sleep(1200);
    if (unduhan.length !== 1) throw new Error(`klik kedua memulai unduhan kedua: ${unduhan.length} unduhan`);
    if (driveRequests.length !== 1) throw new Error(`klik kedua mengirim ${driveRequests.length} request direct Drive`);

    /* ---------- 6. Klik setelah jendela 1 detik diterima lagi ----------
       Pengingat ditutup lewat tombolnya sendiri, yang baru aktif setelah
       hitungan 2 detik. Setelah itu elemen yang sama harus boleh diklik. */
    await clickSelector(cdp, "[data-double-click-ok]:not([disabled])", "tombol Lanjut pengingat");
    await waitFor(() => evaluate(cdp, "document.querySelector('[data-double-click-overlay]:not([hidden])') === null"), { timeoutMs: 3000, label: "pengingat tertutup" });
    const kotakLagi = await rectOf(cdp, tautanDrive, "tautan Drive setelah pengingat");
    const tautanSama = await evaluate(cdp, `document.querySelector('a.dl-link[data-uji-drive="1"]') === document.querySelector(${JSON.stringify(tautanDrive)})`);
    if (!tautanSama) throw new Error("tautan Drive diganti, bukan elemen yang sama");
    const jarakKlikKetiga = Date.now() - klikPertama;
    if (jarakKlikKetiga < 1000) throw new Error(`klik ketiga belum melewati jendela 1 detik: ${jarakKlikKetiga} ms`);
    await mouseClick(cdp, kotakLagi.x, kotakLagi.y);
    const info2 = await waitFor(() => unduhan[1] || null, { timeoutMs: 15000, intervalMs: 10, label: "unduhan kedua mulai" });
    if (info2.suggestedFilename !== DOWNLOAD_NAME) {
      throw new Error(`nama berkas unduhan kedua salah: ${info2.suggestedFilename}`);
    }
    await waitFor(() => driveRequests.length === 2, { timeoutMs: 5000, label: "request direct Drive kedua" });
    const driveUrl2 = new URL(driveRequests[1]);
    if (driveUrl2.searchParams.get("id") !== DRIVE_FILE_ID || driveUrl2.searchParams.get("export") !== "download") {
      throw new Error(`URL direct Drive kedua tidak sesuai: ${driveRequests[1]}`);
    }
    await browserCdp.send("Browser.cancelDownload", { guid: info2.guid });
    const dibatalkan2 = await waitFor(async () => {
      const akhir = progres.filter((item) => item.guid === info2.guid).at(-1);
      if (!akhir) return null;
      if (akhir.state === "completed") throw new Error("unduhan kedua selesai sebelum sempat dibatalkan");
      return akhir.state === "canceled" ? akhir : null;
    }, { timeoutMs: 10000, label: "unduhan kedua dibatalkan" });
    if (await evaluate(cdp, "document.querySelector('[data-double-click-overlay]:not([hidden])') !== null")) {
      throw new Error("pengingat muncul lagi padahal klik setelah 1 detik diterima");
    }

    /* ---------- 7. Tab tidak berpindah ---------- */
    const sesudah = JSON.parse(await evaluate(cdp, `
      (() => JSON.stringify({
        href: location.href,
        ready: document.readyState,
        overlay: document.querySelector('#watchOverlay')?.hidden === false,
        title: document.querySelector('#watchTitle')?.textContent?.trim(),
      }))()
    `));
    const riwayatSesudah = await cdp.send("Page.getNavigationHistory");
    if (sesudah.href !== sebelum.href) throw new Error(`tab berpindah ke ${sesudah.href}`);
    if (sesudah.ready !== "complete") throw new Error(`dokumen tidak utuh setelah unduhan: ${sesudah.ready}`);
    if (!sesudah.overlay) throw new Error("modal detail tertutup setelah unduhan dimulai");
    if (sesudah.title !== ANIME_FIXTURE.title) throw new Error(`judul detail berubah: ${sesudah.title}`);
    if (navigasiFrame !== 0) throw new Error(`ada ${navigasiFrame} navigasi main frame yang commit`);
    const entriSebelum = riwayatSebelum.entries[riwayatSebelum.currentIndex];
    const entriSesudah = riwayatSesudah.entries[riwayatSesudah.currentIndex];
    if (riwayatSesudah.currentIndex !== riwayatSebelum.currentIndex || entriSesudah.url !== entriSebelum.url) {
      throw new Error(`riwayat tab berubah: ${JSON.stringify({ sebelum: entriSebelum.url, sesudah: entriSesudah.url })}`);
    }

    /* Chrome menghapus berkas .crdownload secara asinkron setelah cancel
       (apalagi kalau ada dua unduhan), jadi beri waktu terbatas sebelum
       menyatakan masih ada sisa. */
    const batasBersih = Date.now() + 5000;
    let sisa = [];
    do {
      sisa = fs.readdirSync(downloadDir).filter((name) => name.endsWith(".crdownload") || name === DOWNLOAD_NAME);
      if (!sisa.length) break;
      await sleep(100);
    } while (Date.now() < batasBersih);
    if (sisa.length) throw new Error(`berkas unduhan masih tersisa setelah batal: ${sisa.join(", ")}`);
    if (apiTakDikenal.length) {
      throw new Error(`request API tanpa fixture: ${[...new Set(apiTakDikenal)].join(", ")}. Tambahkan ke API_FIXTURES.`);
    }
    if (pausedErrors.length) throw new Error(`handler Fetch gagal: ${pausedErrors[0].message}`);

    console.log("LULUS: halaman detail terbuka dan tautan Google Drive dirender same-tab.");
    console.log("LULUS: klik Drive memulai unduhan lewat resolver server tanpa memindahkan tab.");
    console.log(`LULUS: klik kedua ${jarakKlik} ms setelah klik pertama ditolak; tetap satu unduhan.`);
    console.log(`LULUS: unduhan pertama dibatalkan setelah mulai (state ${dibatalkan.state}).`);
    console.log(`LULUS: klik ketiga ${jarakKlikKetiga} ms setelah klik pertama diterima; unduhan kedua mulai lalu dibatalkan (state ${dibatalkan2.state}).`);
  } finally {
    try { await browserCdp?.send("Browser.close"); } catch { /* browser mungkin sudah tertutup */ }
    browserCdp?.close();
    cdp?.close();
    if (!chrome.killed) chrome.kill();
    await new Promise((resolve) => server.close(resolve));
    await sleep(150);
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* profil sementara bisa tertinggal */ }
    try { fs.rmSync(downloadDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* folder unduhan sementara bisa tertinggal */ }
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
