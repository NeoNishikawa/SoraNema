const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let utils;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/app-utils.js"), "utf8");
  utils = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

function elemenPalsu() {
  const kelas = new Set();
  const target = {
    disabled: false,
    getAttribute: () => null,
    classList: {
      add: (nama) => kelas.add(nama),
      remove: (nama) => kelas.delete(nama),
      has: (nama) => kelas.has(nama),
    },
    closest: () => target,
  };
  return { target, kelas };
}

function akarPalsu() {
  const listener = new Map();
  return {
    listener,
    addEventListener: (jenis, fn) => listener.set(jenis, fn),
    removeEventListener: (jenis) => listener.delete(jenis),
  };
}

test("satu tombol hanya boleh ditekan sekali per detik", () => {
  let sekarang = 10_000;
  const limiter = utils.createPressLimiter({ cooldownMs: 1000, now: () => sekarang });
  const tombol = {};

  assert.equal(limiter.allow(tombol), true);
  assert.equal(limiter.remaining(tombol), 1000);
  sekarang += 999;
  assert.equal(limiter.allow(tombol), false);
  assert.equal(limiter.remaining(tombol), 1);
  sekarang += 1;
  assert.equal(limiter.allow(tombol), true);
});

test("cooldown berlaku per tombol, bukan global", () => {
  let sekarang = 0;
  const limiter = utils.createPressLimiter({ cooldownMs: 1000, now: () => sekarang });
  const a = {};
  const b = {};

  assert.equal(limiter.allow(a), true);
  sekarang = 100;
  assert.equal(limiter.allow(a), false);
  assert.equal(limiter.allow(b), true, "tombol lain tidak ikut terkunci");
  assert.equal(limiter.remaining(b), 1000);
});

test("nilai cooldown yang tidak masuk akal kembali ke satu detik", () => {
  const limiter = utils.createPressLimiter({ cooldownMs: Number.NaN });
  assert.equal(limiter.cooldownMs, 1000);
  assert.equal(utils.PRESS_COOLDOWN_MS, 1000);
  assert.match(utils.PRESS_TARGET_SELECTOR, /button/);
  assert.match(utils.PRESS_TARGET_SELECTOR, /a\.dl-link/);
});

test("attachPressLimiter menghentikan klik kedua pada elemen yang sama", () => {
  let sekarang = 0;
  const root = akarPalsu();
  const diblokir = [];
  const lepas = utils.attachPressLimiter(root, {
    cooldownMs: 1000,
    now: () => sekarang,
    onBlocked: (target, sisa) => diblokir.push({ target, sisa }),
  });
  const { target, kelas } = elemenPalsu();
  let dicegah = 0;
  let dihentikan = 0;
  const event = {
    target,
    button: 0,
    isTrusted: true,
    defaultPrevented: false,
    preventDefault: () => { dicegah += 1; },
    stopImmediatePropagation: () => { dihentikan += 1; },
  };

  const onClick = root.listener.get("click");
  assert.ok(onClick, "listener click harus terpasang di capture phase");
  onClick(event);
  assert.equal(dicegah, 0, "klik pertama harus lolos");
  assert.equal(kelas.has("is-press-cooling"), true);

  sekarang = 999;
  onClick(event);
  assert.equal(dicegah, 1, "klik kedua harus dicegah");
  assert.equal(dihentikan, 1, "handler tombol tidak boleh menerima klik kedua");
  assert.equal(kelas.has("is-press-blocked"), true);
  assert.equal(diblokir.length, 1);
  assert.equal(diblokir[0].sisa, 1);

  lepas();
  assert.equal(root.listener.has("click"), false, "detach harus melepas listener");
});

test("klik yang diblokir tidak membatalkan timer cooldown", async () => {
  const root = akarPalsu();
  const lepas = utils.attachPressLimiter(root, { cooldownMs: 120, now: () => Date.now() });
  const { target, kelas } = elemenPalsu();
  const event = {
    target,
    button: 0,
    isTrusted: true,
    defaultPrevented: false,
    preventDefault: () => {},
    stopImmediatePropagation: () => {},
  };
  const onClick = root.listener.get("click");

  onClick(event);
  await new Promise((resolve) => setTimeout(resolve, 20));
  onClick(event);
  assert.equal(kelas.has("is-press-cooling"), true);
  assert.equal(kelas.has("is-press-blocked"), true);

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(kelas.has("is-press-cooling"), false, "cooldown tetap berakhir sesuai waktunya");
  assert.equal(kelas.has("is-press-blocked"), true, "umpan balik blokir masih berjalan");

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(kelas.has("is-press-blocked"), false);
  lepas();
});

test("klik programatik dan tombol nonaktif tidak ikut dibatasi", () => {
  const root = akarPalsu();
  const lepas = utils.attachPressLimiter(root, { cooldownMs: 1000, now: () => 0 });
  const { target } = elemenPalsu();
  let dicegah = 0;
  const event = {
    target,
    button: 0,
    isTrusted: true,
    defaultPrevented: false,
    preventDefault: () => { dicegah += 1; },
    stopImmediatePropagation: () => {},
  };
  const onClick = root.listener.get("click");

  target.disabled = true;
  onClick(event);
  assert.equal(dicegah, 0, "tombol disabled sudah ditangani browser");

  target.disabled = false;
  const programatik = { ...event, isTrusted: false };
  onClick(programatik);
  onClick(programatik);
  assert.equal(dicegah, 0, "klik .click() internal tidak boleh ikut dikunci");

  lepas();
});

test("reference-app memasang pembatas dan CSS memberi umpan balik", () => {
  const referenceApp = fs.readFileSync(path.join(__dirname, "../public/js/reference-app.js"), "utf8");
  const components = fs.readFileSync(path.join(__dirname, "../public/css/components.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  assert.match(referenceApp, /import \{[^}]*attachPressLimiter[^}]*\} from "\.\/app-utils\.js"/);
  assert.match(referenceApp, /attachPressLimiter\(document, \{\s*onBlocked:/);
  assert.match(components, /\.is-press-cooling/);
  assert.match(components, /\.is-press-blocked/);
  assert.match(indexHtml, /reference-app\.js\?v=\d+(?:\.\d+)+/);
});

test("uji browser nyata tersedia untuk klik cepat dan tombol berbeda", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  const scriptPath = path.join(__dirname, "../scripts/press-limit-browser-test.js");
  const script = fs.readFileSync(scriptPath, "utf8");

  assert.equal(packageJson.scripts["test:browser"], "node scripts/press-limit-browser-test.js");
  assert.match(script, /Input\.dispatchMouseEvent/);
  assert.match(script, /counts\["press-a"\] !== 1/);
  assert.match(script, /afterDifferent\["press-a"\] !== 2 \|\| afterDifferent\["press-b"\] !== 1/);
  assert.match(script, /Bersabarlah sedikit/);
});
