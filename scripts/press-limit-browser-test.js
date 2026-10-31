/* ============================================================================
   Uji browser nyata untuk batas satu tekan.
   ----------------------------------------------------------------------------
   Tidak memakai Playwright/Puppeteer. Chrome/Edge dibuka headless dengan
   remote debugging, lalu klik dikirim lewat Chrome DevTools Protocol supaya
   event-nya benar-benar trusted seperti klik pengguna.

   Yang diuji:
   1. Dua klik cepat pada tombol yang sama -> handler hanya sekali.
   2. Klik tombol berbeda tepat setelahnya -> tetap diterima.
   3. Klik yang ditolak memunculkan pengingat "Bersabarlah sedikit".
   4. Pengingat hanya punya satu tombol dan terbuka setelah hitungan 2 detik.
   5. Gambar double-click.webp benar-benar termuat dan dirender kecil.

   Jalankan: npm run test:browser
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
      }, 15000);
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

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
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

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-press-browser-"));
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=900,700",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    appUrl,
  ];
  if (process.platform === "linux") chromeArgs.splice(1, 0, "--no-sandbox", "--disable-dev-shm-usage");

  let chromeOutput = "";
  const chrome = spawn(chromePath, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (chunk) => { chromeOutput += chunk.toString(); });
  chrome.once("error", (error) => { chromeOutput += `\nspawn error: ${error.message}`; });

  let cdp = null;
  try {
    const target = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      return targets.find((item) => item.type === "page" && item.url.startsWith(appUrl)) || null;
    }, { timeoutMs: 20000, label: "target browser" });

    cdp = await new Cdp(target.webSocketDebuggerUrl).connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => evaluate(cdp, "document.readyState").then((state) => state === "complete"), { label: "halaman selesai dimuat" });
    await waitFor(() => evaluate(cdp, "document.querySelector('#pcName')?.textContent?.trim() || ''").then((name) => name && name !== "Dummy User"), { label: "modul aplikasi siap" });

    const points = await evaluate(cdp, `
      (() => {
        const host = document.createElement('div');
        host.id = 'iln-press-test-host';
        host.style.cssText = 'position:fixed;left:24px;top:220px;z-index:2147483647;display:flex;gap:12px;';
        const make = (id, label) => {
          const button = document.createElement('button');
          button.id = id;
          button.type = 'button';
          button.textContent = label;
          button.style.cssText = 'width:96px;height:44px;font:14px system-ui,sans-serif;';
          button.addEventListener('click', () => { window.__pressTest[id] = (window.__pressTest[id] || 0) + 1; });
          return button;
        };
        window.__pressTest = {};
        host.append(make('press-a', 'A'), make('press-b', 'B'));
        document.body.append(host);
        return ['press-a', 'press-b'].map((id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return { id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
      })()
    `, { awaitPromise: false });

    const a = points.find((point) => point.id === "press-a");
    const b = points.find((point) => point.id === "press-b");
    if (!a || !b) throw new Error("tombol uji tidak berhasil dibuat");

    /* Dua klik berurutan tanpa jeda; keduanya event mouse nyata. */
    await mouseClick(cdp, a.x, a.y);
    await mouseClick(cdp, a.x, a.y);
    await sleep(180);

    const afterDouble = await evaluate(cdp, "JSON.stringify(window.__pressTest)");
    const counts = JSON.parse(afterDouble);
    if (counts["press-a"] !== 1) {
      throw new Error(`klik kedua pada tombol yang sama tidak diblokir: ${afterDouble}`);
    }

    const reminder = JSON.parse(await evaluate(cdp, `
      (() => {
        const overlay = document.querySelector('[data-double-click-overlay]');
        const button = overlay?.querySelector('[data-double-click-ok]');
        return JSON.stringify({
          hidden: overlay?.hidden,
          title: overlay?.querySelector('h2')?.textContent?.trim(),
          buttons: overlay?.querySelectorAll('button').length,
          disabled: button?.disabled,
          label: button?.textContent?.trim(),
          countdown: overlay?.querySelector('[data-double-click-countdown]')?.textContent?.trim(),
          image: overlay?.querySelector('img')?.getAttribute('src'),
        });
      })()
    `));
    if (reminder.hidden !== false) throw new Error("pengingat double-click tidak muncul");
    if (reminder.title !== "Bersabarlah sedikit") throw new Error(`judul pengingat salah: ${reminder.title}`);
    if (reminder.buttons !== 1) throw new Error(`pengingat harus punya satu tombol, ditemukan ${reminder.buttons}`);
    if (!reminder.disabled) throw new Error("tombol pengingat harus terkunci saat hitungan mundur");
    if (!/Tunggu 2 detik/.test(reminder.label || "")) throw new Error(`label hitungan salah: ${reminder.label}`);
    if (!/\/assets\/double-click\.webp$/.test(reminder.image || "")) throw new Error(`gambar pengingat salah: ${reminder.image}`);

    /* Gambar harus benar-benar termuat dan dirender kecil, bukan sekadar
       punya atribut src. Ukuran render maksimal 148 px sesuai CSS. */
    const gambar = await waitFor(() => evaluate(cdp, `
      (() => {
        const image = document.querySelector('[data-double-click-overlay] img');
        if (!image || !image.complete || !image.naturalWidth) return null;
        /* getBoundingClientRect ikut menghitung scale animasi boing; yang
           diuji di sini ukuran layout CSS-nya, jadi ambil computed width. */
        const lebar = parseFloat(getComputedStyle(image).width);
        const tinggi = parseFloat(getComputedStyle(image).height);
        return JSON.stringify({ alami: image.naturalWidth, lebar, tinggi });
      })()
    `).then((value) => value && JSON.parse(value)), { timeoutMs: 5000, label: "gambar pengingat termuat" });
    if (gambar.lebar > 148.5 || gambar.lebar < 96) throw new Error(`ukuran render gambar tidak wajar: ${JSON.stringify(gambar)}`);

    await sleep(2200);
    const ready = JSON.parse(await evaluate(cdp, `
      (() => {
        const overlay = document.querySelector('[data-double-click-overlay]');
        const button = overlay?.querySelector('[data-double-click-ok]');
        return JSON.stringify({ hidden: overlay?.hidden, disabled: button?.disabled, label: button?.textContent?.trim(), countdown: overlay?.querySelector('[data-double-click-countdown]')?.textContent?.trim() });
      })()
    `));
    if (ready.hidden !== false || ready.disabled !== false || ready.label !== "Lanjut") {
      throw new Error(`tombol tidak terbuka setelah 2 detik: ${JSON.stringify(ready)}`);
    }

    const okRect = JSON.parse(await evaluate(cdp, `
      (() => {
        const rect = document.querySelector('[data-double-click-ok]').getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()
    `));
    await mouseClick(cdp, okRect.x, okRect.y);
    await sleep(180);
    if (await evaluate(cdp, "document.querySelector('[data-double-click-overlay]')?.hidden") !== true) {
      throw new Error("pengingat tidak tertutup setelah tombol Lanjut diklik");
    }

    /* Tombol berbeda harus tetap bisa ditekan walau tombol A baru saja diklik. */
    await mouseClick(cdp, a.x, a.y);
    await mouseClick(cdp, b.x, b.y);
    await sleep(180);
    const afterDifferent = JSON.parse(await evaluate(cdp, "JSON.stringify(window.__pressTest)"));
    if (afterDifferent["press-a"] !== 2 || afterDifferent["press-b"] !== 1) {
      throw new Error(`tombol berbeda ikut terkunci: ${JSON.stringify(afterDifferent)}`);
    }

    console.log("LULUS: dua klik cepat pada tombol yang sama -> 1 handler.");
    console.log("LULUS: pengingat 'Bersabarlah sedikit' muncul dengan 1 tombol dan hitungan 2 detik.");
    console.log(`LULUS: gambar double-click.webp termuat dan dirender ${Math.round(gambar.lebar)} px.`);
    console.log("LULUS: tombol berbeda tetap bisa ditekan saat tombol lain baru diklik.");
  } finally {
    try { await cdp?.send("Browser.close"); } catch { /* browser mungkin sudah tertutup */ }
    cdp?.close();
    if (!chrome.killed) chrome.kill();
    await new Promise((resolve) => server.close(resolve));
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
