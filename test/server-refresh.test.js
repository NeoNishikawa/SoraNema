const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let utils;
test.before(async () => {
  const source = read("public/js/app-utils.js");
  utils = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

test("bootBerubah: patokan pertama bukan restart, id berubah berarti restart", () => {
  assert.equal(utils.bootBerubah("", "boot-1"), false, "tab baru hanya mencatat patokan");
  assert.equal(utils.bootBerubah(undefined, "boot-1"), false);
  assert.equal(utils.bootBerubah("boot-1", "boot-1"), false);
  assert.equal(utils.bootBerubah("boot-1", "boot-2"), true);
  assert.equal(utils.bootBerubah("boot-1", ""), false, "health tanpa bootId bukan bukti restart");
  assert.equal(utils.bootBerubah("boot-1", null), false);
});

test("createBootWatcher: satu pemberitahuan per restart dan tahan server mati sesaat", async () => {
  const jawaban = ["boot-1", "boot-1", "mati", "boot-2", "boot-2", "boot-3"];
  let posisi = 0;
  const restart = [];
  const pengamat = utils.createBootWatcher({
    ambilBootId: async () => {
      const nilai = jawaban[posisi++] ?? "boot-3";
      if (nilai === "mati") throw new Error("server sedang restart");
      return nilai;
    },
    onRestart: (info) => restart.push(info),
    setIntervalRef: () => ({ unref() { } }),
    clearIntervalRef: () => { },
  });

  assert.equal(await pengamat.periksa(), false, "periksa pertama hanya mencatat patokan");
  assert.equal(pengamat.bootId(), "boot-1");
  assert.equal(await pengamat.periksa(), false, "id sama bukan restart");
  assert.equal(await pengamat.periksa(), false, "server mati sesaat bukan bukti restart");
  assert.equal(await pengamat.periksa(), true);
  assert.deepEqual(restart, [{ dari: "boot-1", ke: "boot-2" }]);
  assert.equal(await pengamat.periksa(), false, "id baru sudah dicatat, tidak berulang");
  assert.equal(await pengamat.periksa(), true);
  assert.equal(restart.length, 2);

  pengamat.hentikan();
  assert.equal(await pengamat.periksa(), false, "pemantau yang dihentikan tidak memeriksa lagi");
});

test("health publik membawa bootId sebagai penanda proses", () => {
  const server = read("server.js");
  assert.match(server, /const BOOT_ID = crypto\.randomBytes\(6\)\.toString\("hex"\)/);
  assert.match(server, /const publicView = \{ ok: true, sourceStatus: primary\.status, bootId: BOOT_ID \}/);
});

test("pemberitahuan restart ada di markup, tersembunyi sampai bootId berubah", () => {
  const html = read("public/index.html");
  const app = read("public/js/reference-app.js");
  assert.match(html, /id="serverRefresh"[^>]*hidden/, "pemberitahuan harus mulai tersembunyi");
  assert.match(html, /id="serverRefreshReload"[^>]*>\s*Muat ulang/, "tombol muat ulang ada di pemberitahuan");
  assert.match(app, /createBootWatcher\(\{/);
  assert.match(app, /ambilBootId: async \(\) => String\(\(await api\.health\(\)\)\?\.bootId \|\| ""\)/);
  assert.match(app, /tombol\.addEventListener\("click", \(\) => window\.location\.reload\(\)\)/);

  /* Reload hanya dari klik pengguna: tab yang sedang memutar episode tidak
     boleh tiba-tiba dimuat ulang sendiri. */
  const blok = app.slice(app.indexOf("function mountServerRefresh"), app.indexOf("sealReady.then"));
  assert.equal((blok.match(/location\.reload/g) || []).length, 1, "hanya tombol yang boleh memuat ulang");
  assert.match(blok, /kotak\.hidden = false/, "pemberitahuan muncul saat restart terdeteksi");
});

test("CSS pemberitahuan punya aturan tampil dan sembunyi", () => {
  const css = read("public/css/components.css");
  assert.match(css, /\.server-refresh\{[\s\S]*?position:fixed/);
  assert.match(css, /\.server-refresh\[hidden\]\{display:none\}/);
  assert.match(css, /@media \(max-width:560px\)\{\s*\.server-refresh\{left:12px;right:12px/, "di layar sempit pemberitahuan melebar");
});
