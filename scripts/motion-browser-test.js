/* ============================================================================
   Uji browser nyata untuk animasi gerak.
   ----------------------------------------------------------------------------
   Chrome/Edge headless lewat CDP; masukan pointer tetap event nyata
   (Input.dispatchMouseEvent), bukan .click() programatik.

   Yang diuji:
   1. Popup klik ganda memakai animasi boing (dialog dan gambar).
   2. Seret kartu ke kiri menariknya ke kanan, lalu kembali elastis
      tanpa memicu klik.
   3. Scroll turun/naik mengganti data-scroll-direction.
   4. Enter di pencarian menarik #mainScroll ke bagian hasil.
   5. Sentuhan nyata di viewport ponsel 390 px: geser kiri menarik kartu
      ke kanan lewat Input.dispatchTouchEvent.
   6. Sentuhan vertikal tetap menggulir #mainScroll selama jari masih
      menempel, dan kartu tidak ikut tertarik ke samping.

   Jalankan: npm run test:motion
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

async function dispatchTouch(cdp, type, points) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

/* Sentuhan nyata: touchStart -> beberapa touchMove -> touchEnd. Titik
   disentuh memakai id tetap supaya Chrome memperlakukannya sebagai satu
   jari yang sama, bukan jari baru di tiap langkah. */
async function touchDrag(cdp, from, to, { steps = 8, hold = 16, onStep } = {}) {
  const point = (x, y) => ({ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 });
  await dispatchTouch(cdp, "touchStart", [point(from.x, from.y)]);
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await dispatchTouch(cdp, "touchMove", [point(x, y)]);
    if (onStep) await onStep(step, { x, y });
    await sleep(hold);
  }
}

async function touchRelease(cdp) {
  await dispatchTouch(cdp, "touchEnd", []);
}

async function dragLeft(cdp, x, y, distance = 90) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  for (const step of [0.35, 0.7, 1]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x - distance * step,
      y,
      button: "left",
      buttons: 1,
    });
    await sleep(24);
  }
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iln-motion-browser-"));
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=1000,820",
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
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 820, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await waitFor(() => evaluate(cdp, "document.readyState").then((state) => state === "complete"), { label: "halaman selesai dimuat" });
    await waitFor(() => evaluate(cdp, "document.querySelector('#pcName')?.textContent?.trim() || ''").then((name) => name && name !== "Dummy User"), { label: "modul aplikasi siap" });

    /* ---------- 1. Boing pada popup klik ganda ---------- */
    const tombol = JSON.parse(await evaluate(cdp, `
      (() => {
        const button = document.createElement('button');
        button.id = 'motion-popup-test';
        button.type = 'button';
        button.textContent = 'Uji popup';
        button.style.cssText = 'position:fixed;left:30px;top:260px;width:110px;height:44px;z-index:2147483647;font:14px system-ui,sans-serif;';
        document.body.append(button);
        const rect = button.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()
    `));
    await mouseClick(cdp, tombol.x, tombol.y);
    await mouseClick(cdp, tombol.x, tombol.y);
    const popup = JSON.parse(await waitFor(() => evaluate(cdp, `
      (() => {
        const overlay = document.querySelector('[data-double-click-overlay]');
        if (!overlay || overlay.hidden) return null;
        const dialog = overlay.querySelector('[data-double-click-dialog]');
        const image = overlay.querySelector('img');
        return JSON.stringify({
          dialog: dialog?.getAnimations().map((animation) => animation.animationName || ''),
          image: image?.getAnimations().map((animation) => animation.animationName || ''),
        });
      })()
    `), { timeoutMs: 5000, label: "popup boing muncul" }));
    if (!popup.dialog?.includes("doubleClickBoing")) throw new Error(`dialog tanpa animasi boing: ${JSON.stringify(popup)}`);
    if (!popup.image?.includes("doubleClickFace")) throw new Error(`gambar tanpa animasi pop: ${JSON.stringify(popup)}`);
    await evaluate(cdp, "document.querySelector('#motion-popup-test')?.remove()");
    const tombolLanjut = JSON.parse(await waitFor(() => evaluate(cdp, `
      (() => {
        const button = document.querySelector('[data-double-click-ok]');
        if (!button || button.disabled) return null;
        const rect = button.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()
    `), { timeoutMs: 4000, label: "tombol Lanjut terbuka" }));
    await mouseClick(cdp, tombolLanjut.x, tombolLanjut.y);
    await waitFor(() => evaluate(cdp, "document.querySelector('[data-double-click-overlay]')?.hidden === true"), { timeoutMs: 2000, label: "popup tertutup" });

    /* ---------- 2. Gestur geser kartu ---------- */
    /* Mode "full" dikunci lewat controller, bukan hanya dataset: pada mesin
       lambat sampling otomatis bisa menurunkan tier ke "low" di tengah uji
       dan mematikan gestur. setMode() menghentikan sampling itu. */
    await evaluate(cdp, "window.ilnPerformanceController?.setMode?.('full'); document.documentElement.dataset.performanceTier = 'full';");
    const kartu = JSON.parse(await evaluate(cdp, `
      (() => {
        const stage = document.createElement('section');
        stage.id = 'motion-gesture-stage';
        stage.innerHTML = '<div class="card-grid"><article class="anime-card" id="motion-card"><div class="thumb"></div><div class="card-body"><h3 class="card-title">Kartu uji</h3></div></article></div>';
        const scroller = document.querySelector('#mainScroll');
        scroller.prepend(stage);
        const card = document.querySelector('#motion-card');
        window.__motionClicks = 0;
        card.addEventListener('click', () => { window.__motionClicks += 1; });
        scroller.scrollTop = 0;
        scroller.style.scrollBehavior = 'auto';
        const rect = card.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
      })()
    `));
    await dragLeft(cdp, kartu.x, kartu.y);
    const ditarik = JSON.parse(await evaluate(cdp, `
      (() => {
        const card = document.querySelector('#motion-card');
        const matrix = new DOMMatrix(getComputedStyle(card).transform);
        return JSON.stringify({ x: matrix.m41, dragging: card.classList.contains('swipe-dragging') });
      })()
    `));
    if (!ditarik.dragging) {
      const sebab = await evaluate(cdp, `
        (() => JSON.stringify({
          tier: document.documentElement.dataset.performanceTier || '',
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          elemen: document.elementFromPoint(${kartu.x}, ${kartu.y})?.className || 'none',
          rect: (() => { const r = document.querySelector('#motion-card').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
        }))()
      `);
      throw new Error(`kartu tidak masuk mode seret: ${sebab}`);
    }
    if (ditarik.x < 15 || ditarik.x > 53) throw new Error(`kartu tidak tertarik berlawanan arah: ${ditarik.x}`);
    const seleksi = await evaluate(cdp, "String(getSelection() || '')");
    if (seleksi.trim()) throw new Error(`seret kartu memilih teks: ${seleksi}`);

    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: kartu.x - 90, y: kartu.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(80);
    const lepas = await evaluate(cdp, "document.querySelector('#motion-card').classList.contains('swipe-dragging')");
    if (lepas) throw new Error("kartu tidak kembali setelah pointer dilepas");
    /* Klik yang lahir dari pelepasan seret harus dibatalkan. */
    const klik = await evaluate(cdp, "window.__motionClicks");
    if (klik !== 0) throw new Error(`seret ikut membuka anime: ${klik}`);

    await waitFor(() => evaluate(cdp, `
      (() => {
        const card = document.querySelector('#motion-card');
        const matrix = new DOMMatrix(getComputedStyle(card).transform);
        return !card.classList.contains('swipe-dragging') && !card.classList.contains('swipe-release') && Math.abs(matrix.m41) < 1;
      })()
    `), { timeoutMs: 3000, label: "kartu kembali elastis" });

    /* ---------- 3. Arah scroll ---------- */
    await evaluate(cdp, `
      (() => {
        const scroller = document.querySelector('#mainScroll');
        const spacer = document.createElement('div');
        spacer.id = 'motion-scroll-spacer';
        spacer.style.height = '2600px';
        scroller.append(spacer);
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollTop = 900;
      })()
    `);
    /* Beri satu frame agar rAF membaca 900 dulu; kalau dua perubahan
       scrollTop terjadi dalam frame yang sama, delta terakhir bisa salah. */
    await sleep(180);
    const arahTurun = await evaluate(cdp, "document.documentElement.dataset.scrollDirection");
    if (arahTurun !== "down") throw new Error(`arah scroll turun salah: ${arahTurun}`);
    await evaluate(cdp, "document.querySelector('#mainScroll').scrollTop = 200");
    await waitFor(() => evaluate(cdp, "document.documentElement.dataset.scrollDirection").then((value) => value === "up"), { timeoutMs: 3000, label: "arah scroll naik" });

    /* ---------- 4. Enter di pencarian menarik layar ---------- */
    /* Rekomendasi populer ada DI ATAS bagian hasil dan baru muncul setelah
       /api/recommendations selesai. Kalau rail itu tampil sesudah layar
       ditarik, hasilnya ikut terdorong ke bawah - uji jadi gagal karena
       urutan jaringan, bukan karena animasinya. Tunggu sampai bagian itu
       menetap dulu. */
    await waitFor(() => evaluate(cdp, `
      (() => {
        const sub = document.querySelector('#recPopularSub')?.textContent || '';
        const section = document.querySelector('#recPopularSection');
        const kartu = document.querySelectorAll('#recPopularRail .anime-card').length;
        /* Entri resource hanya ada setelah request selesai (sukses atau
           gagal), jadi ini penanda yang tidak bisa balapan. */
        const selesai = performance.getEntriesByType('resource')
          .some((entry) => entry.name.includes('/api/recommendations'));
        return selesai && !sub.includes('Mencari') && Boolean(section?.hidden || kartu > 0);
      })()
    `), { timeoutMs: 15000, label: "rekomendasi populer selesai dimuat" });
    const awal = await evaluate(cdp, "document.querySelector('#mainScroll').scrollTop");
    await evaluate(cdp, `
      (() => {
        const input = document.querySelector('#globalSearch');
        input.value = 'naruto';
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      })()
    `);
    await sleep(1500);
    const hasil = JSON.parse(await evaluate(cdp, `
      (() => {
        const scroller = document.querySelector('#mainScroll');
        const section = document.querySelector('#searchSection');
        const rect = section.getBoundingClientRect();
        return JSON.stringify({ hidden: section.hidden, scrollTop: scroller.scrollTop, top: rect.top });
      })()
    `));
    if (hasil.hidden) throw new Error("section hasil tidak tampil setelah Enter");
    if (!(hasil.scrollTop > awal + 40)) throw new Error(`layar tidak ditarik ke hasil: ${JSON.stringify({ awal, hasil })}`);
    if (hasil.top > 220 || hasil.top < -40) throw new Error(`hasil tidak berada di atas layar: top=${hasil.top}`);

    /* ---------- 5. Sentuhan nyata di viewport ponsel 390 px ---------- */
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await sleep(320);
    const viewportPonsel = await evaluate(cdp, "JSON.stringify({ width: innerWidth, mobile: matchMedia('(max-width: 767px)').matches })");
    const ponselInfo = JSON.parse(viewportPonsel);
    if (ponselInfo.width !== 390 || !ponselInfo.mobile) {
      throw new Error(`viewport ponsel tidak aktif: ${viewportPonsel}`);
    }

    /* Kartu baru supaya sisa kelas dari uji mouse sebelumnya tidak ikut. */
    const ponsel = JSON.parse(await evaluate(cdp, `
      (() => {
        document.querySelector('#motion-touch-stage')?.remove();
        window.ilnPerformanceController?.setMode?.('full');
        document.documentElement.dataset.performanceTier = 'full';
        const stage = document.createElement('section');
        stage.id = 'motion-touch-stage';
        stage.innerHTML = '<div class="card-grid">' +
          '<article class="anime-card" id="touch-card"><div class="thumb"></div><div class="card-body"><h3 class="card-title">Kartu sentuh</h3></div></article>' +
          '<article class="anime-card" id="touch-card-2"><div class="thumb"></div><div class="card-body"><h3 class="card-title">Kartu kedua</h3></div></article>' +
          '</div>';
        const scroller = document.querySelector('#mainScroll');
        scroller.prepend(stage);
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollTop = 0;
        const card = document.querySelector('#touch-card');
        window.__touchClicks = 0;
        card.addEventListener('click', () => { window.__touchClicks += 1; });
        const rect = card.getBoundingClientRect();
        return JSON.stringify({ from: { x: rect.right - 6, y: rect.y + rect.height / 2 }, width: rect.width });
      })()
    `));
    if (!(ponsel.width > 60)) throw new Error(`kartu ponsel terlalu sempit: ${ponsel.width}`);

    await touchDrag(cdp, ponsel.from, { x: ponsel.from.x - 90, y: ponsel.from.y });
    const sentuh = JSON.parse(await evaluate(cdp, `
      (() => {
        const card = document.querySelector('#touch-card');
        const matrix = new DOMMatrix(getComputedStyle(card).transform);
        return JSON.stringify({ x: matrix.m41, dragging: card.classList.contains('swipe-dragging') });
      })()
    `));
    if (!sentuh.dragging) throw new Error("sentuhan horizontal tidak masuk mode seret");
    if (sentuh.x < 12 || sentuh.x > 53) {
      throw new Error(`sentuhan tidak menarik kartu berlawanan arah: ${sentuh.x}`);
    }
    await touchRelease(cdp);
    await waitFor(() => evaluate(cdp, `
      (() => {
        const card = document.querySelector('#touch-card');
        const matrix = new DOMMatrix(getComputedStyle(card).transform);
        return !card.classList.contains('swipe-dragging') && !card.classList.contains('swipe-release') && Math.abs(matrix.m41) < 1;
      })()
    `), { timeoutMs: 3000, label: "kartu ponsel kembali elastis" });
    const klikSentuh = await evaluate(cdp, "window.__touchClicks");
    if (klikSentuh !== 0) throw new Error(`menggeser dengan sentuhan ikut membuka anime: ${klikSentuh}`);

    /* ---------- 6. Sentuhan vertikal tetap menggulir ---------- */
    const siapGulir = JSON.parse(await evaluate(cdp, `
      (() => {
        const scroller = document.querySelector('#mainScroll');
        let spacer = document.querySelector('#motion-scroll-spacer');
        if (!spacer) { spacer = document.createElement('div'); spacer.id = 'motion-scroll-spacer'; scroller.append(spacer); }
        spacer.style.height = '3000px';
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollTop = 0;
        const card = document.querySelector('#touch-card-2');
        const rect = card.getBoundingClientRect();
        return JSON.stringify({ from: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, scrollTop: scroller.scrollTop });
      })()
    `));
    const sampel = [];
    await touchDrag(cdp, siapGulir.from, { x: siapGulir.from.x, y: siapGulir.from.y - 260 }, {
      steps: 10,
      hold: 20,
      onStep: async () => {
        sampel.push(await evaluate(cdp, "document.querySelector('#mainScroll').scrollTop"));
      },
    });
    const saatJariMenempel = JSON.parse(await evaluate(cdp, `
      (() => {
        const card = document.querySelector('#touch-card-2');
        const matrix = new DOMMatrix(getComputedStyle(card).transform);
        return JSON.stringify({
          scrollTop: document.querySelector('#mainScroll').scrollTop,
          dragging: card.classList.contains('swipe-dragging'),
          x: matrix.m41,
        });
      })()
    `));
    await touchRelease(cdp);
    await sleep(260);
    const akhirGulir = await evaluate(cdp, "document.querySelector('#mainScroll').scrollTop");

    const bertambah = sampel.filter((nilai, index) => index > 0 && nilai > sampel[index - 1] + 1).length;
    if (saatJariMenempel.scrollTop < 60) {
      throw new Error(`sentuhan vertikal tidak menggulir saat jari menempel: ${JSON.stringify({ sampel, saatJariMenempel })}`);
    }
    if (bertambah < 3) throw new Error(`gulir tidak bertahap/mulus: ${JSON.stringify(sampel)}`);
    if (saatJariMenempel.dragging || Math.abs(saatJariMenempel.x) > 1) {
      throw new Error(`kartu ikut tertarik saat gulir vertikal: ${JSON.stringify(saatJariMenempel)}`);
    }
    if (akhirGulir < saatJariMenempel.scrollTop) throw new Error(`gulir berbalik arah setelah sentuhan lepas: ${akhirGulir}`);

    console.log("LULUS: popup memakai animasi boing pada dialog dan gambar.");
    console.log("LULUS: seret kiri menarik kartu ke kanan, kembali elastis, klik dibatalkan.");
    console.log("LULUS: scroll turun/naik mengganti arah reveal.");
    console.log("LULUS: Enter di pencarian menarik layar ke bagian hasil.");
    console.log(`LULUS: sentuhan 390 px menarik kartu ${Math.round(sentuh.x)} px ke kanan tanpa klik.`);
    console.log(`LULUS: sentuhan vertikal menggulir bertahap (${bertambah} langkah, ${Math.round(akhirGulir)} px) tanpa menarik kartu.`);
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
