const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const baca = (relatif) => fs.readFileSync(path.join(ROOT, relatif), "utf8");
const app = baca("public/js/reference-app.js");
const animations = baca("public/css/animations.css");
const screenTimeCss = baca("public/css/screen-time.css");
const indexHtml = baca("public/index.html");
const pkg = JSON.parse(baca("package.json"));

test("popup klik ganda memakai boing dan pop gambar", () => {
  assert.match(screenTimeCss, /\.double-click-dialog\{[^}]*animation:doubleClickBoing \.62s var\(--ease-spring\) both/);
  assert.match(screenTimeCss, /@keyframes doubleClickBoing\{[\s\S]*?38%\{[^}]*scale\(1\.035\)[\s\S]*?100%\{opacity:1;transform:none\}/);
  assert.match(screenTimeCss, /animation:doubleClickFace \.58s var\(--ease-spring\) \.05s both/);
  assert.match(screenTimeCss, /@keyframes doubleClickFace\{[\s\S]*?scale\(\.55\) rotate\(-6deg\)[\s\S]*?100%\{opacity:1;transform:none\}/);
  /* Tier rendah tidak ikut memantul. */
  assert.match(screenTimeCss, /\[data-performance-tier="low"\] \.double-click-dialog,[\s\S]*?animation:none/);
});

test("reveal kartu mengikuti arah scroll naik dan turun", () => {
  assert.match(animations, /\.scroll-reveal\.scroll-hidden\{opacity:0;transform:translateY\(14px\) scale\(\.99\)/);
  assert.match(animations, /html\[data-scroll-direction="up"\] \.scroll-reveal\.scroll-hidden\{transform:translateY\(-14px\) scale\(\.99\)\}/);
  assert.match(app, /function setupScrollDirection\(\)/);
  assert.match(app, /document\.documentElement\.dataset\.scrollDirection = "down";/);
  assert.match(app, /dataset\.scrollDirection = delta > 0 \? "down" : "up";/);
  assert.match(app, /setupScrollDirection\(\); setupSwipeCards\(\);/);
});

test("gestur geser menarik kartu berlawanan arah dengan karet", () => {
  assert.match(app, /function setupSwipeCards\(\)/);
  assert.match(app, /const target = event\.target\.closest\?\.\("\.card-grid \.anime-card"\)/);
  assert.match(app, /const tertarik = Math\.max\(-MAX, Math\.min\(MAX, -dx \* RESIST\)\)/);
  assert.match(animations, /\.card-grid \.anime-card\{touch-action:pan-y\}/);
  assert.match(animations, /\.anime-card\.swipe-dragging\{transform:translateX\(var\(--swipe-x,0px\)\) rotate\(var\(--swipe-r,0deg\)\)/);
  assert.match(animations, /\.anime-card\.swipe-release\{transform:translateX\(var\(--swipe-x,0px\)\) rotate\(var\(--swipe-r,0deg\)\);transition:transform \.55s var\(--ease-spring\)/);
});

test("geser horizontal tidak menahan scroll vertikal dan tidak membuka anime", () => {
  assert.match(app, /if \(Math\.abs\(dx\) < 8 \|\| Math\.abs\(dx\) <= Math\.abs\(dy\)\) return;/);
  assert.match(app, /scroller\.addEventListener\("pointercancel", finish, \{ passive: true \}\)/);
  assert.match(app, /suppressUntil = performance\.now\(\) \+ 450;/);
  assert.match(app, /event\.stopImmediatePropagation\(\);\s*suppressUntil = 0;\s*suppressCard = null;/);
  assert.match(app, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \|\| document\.documentElement\.dataset\.performanceTier === "low"/);
});

test("rail memantul elastis mengikuti arah geser", () => {
  assert.match(app, /function setupRailBoing\(\)/);
  assert.match(app, /const dir = delta < 0 \? 1 : -1;/);
  assert.match(app, /rail\.classList\.add\(dir > 0 \? "rail-boing-right" : "rail-boing-left"\)/);
  assert.match(app, /setupSwipeCards\(\); setupRailBoing\(\);/);
  assert.match(animations, /@keyframes railBoingRight\{[\s\S]*?translate:16px 0[\s\S]*?translate:-6px 0/);
  assert.match(animations, /@keyframes railBoingLeft\{[\s\S]*?translate:-16px 0[\s\S]*?translate:6px 0/);
  assert.match(animations, /\.rail-boing-right>\.anime-card,\.rail-boing-right>\.cw-card\{animation:railBoingRight \.62s var\(--ease-spring\) both\}/);
  assert.match(animations, /\[data-performance-tier="low"\] \.rail-boing-right>\.anime-card/);
});

test("Enter di pencarian menarik layar ke bagian hasil", () => {
  assert.match(app, /function scrollToSearchResults\(\)/);
  assert.match(app, /if \(section\.hidden\) return;/);
  assert.match(app, /section\.getBoundingClientRect\(\)\.top - scroller\.getBoundingClientRect\(\)\.top - 10/);
  assert.match(app, /scroller\.scrollTo\(\{ top: target, behavior: reduced \? "auto" : "smooth" \}\)/);
  assert.match(app, /search\(e\.currentTarget\.value\); scrollToSearchResults\(\);/);
  assert.match(app, /else \{ search\(\$\("#globalSearch"\)\.value\); scrollToSearchResults\(\); \}/);
  assert.doesNotMatch(app, /scrollIntoView/);
});

test("uji sentuhan 390 px dan unduhan Drive tetap terpasang", () => {
  const gerak = baca("scripts/motion-browser-test.js");
  assert.match(gerak, /Emulation\.setTouchEmulationEnabled/);
  assert.match(gerak, /Input\.dispatchTouchEvent/);
  assert.match(gerak, /width: 390/);
  assert.match(gerak, /touch-card-2/);
  assert.match(gerak, /sentuhan vertikal menggulir bertahap/);

  assert.equal(pkg.scripts["test:download"], "node scripts/download-drive-browser-test.js");
  const unduh = baca("scripts/download-drive-browser-test.js");
  assert.match(unduh, /Browser\.setDownloadBehavior/);
  assert.match(unduh, /Browser\.cancelDownload/);
  assert.match(unduh, /attachment; filename=/);
  assert.match(unduh, /Page\.getNavigationHistory/);
  assert.match(unduh, /Fetch\.enable/);
  /* Klik kedua pada tautan Drive dalam 1 detik harus ditolak limiter. */
  assert.match(unduh, /jarakKlik >= 1000/);
  assert.match(unduh, /unduhan\.length !== 1/);
  assert.match(unduh, /driveRequests\.length !== 1/);
  assert.match(unduh, /data-double-click-overlay/);
  /* Setelah jendela 1 detik, klik harus diterima dan unduhan kedua mulai. */
  assert.match(unduh, /jarakKlikKetiga < 1000/);
  assert.match(unduh, /unduhan\[1\]/);
  assert.match(unduh, /data-double-click-ok/);
});

test("uji laporan dua pengguna memakai context terpisah dan memulihkan tautan", () => {
  assert.equal(pkg.scripts["test:laporan"], "node scripts/laporan-dua-pengguna-browser-test.js");
  const skrip = baca("scripts/laporan-dua-pengguna-browser-test.js");
  /* Context browser terpisah = localStorage dan token pelapor berbeda. */
  assert.match(skrip, /Target\.createBrowserContext/);
  assert.match(skrip, /Target\.createTarget/);
  /* Berkas laporan uji tidak boleh menulis ke data produksi. */
  assert.match(skrip, /process\.env\.ILN_LAPORAN_FILE/);
  assert.match(skrip, /process\.env\.LAPORAN_AMBANG/);
  assert.match(skrip, /Fetch\.enable/);
  /* Pemulihan unduhan dan mirror harus diuji lewat tombol nyata. */
  assert.match(skrip, /data-dl-tampil-mati/);
  assert.match(skrip, /data-dl-hidup/);
  assert.match(skrip, /data-mirror-tampil-mati/);
  assert.match(skrip, /data-mirror-hidup/);
  assert.match(skrip, /iln:tautan-hidup:v1/);
});

test("uji gerak di browser dan cache-buster ikut terpasang", () => {
  assert.equal(pkg.scripts["test:motion"], "node scripts/motion-browser-test.js");
  /* Satu perintah untuk ketiga uji browser, berurutan supaya tidak berebut
     server/Chrome, dan tetap lanjut walau salah satu suite gagal. */
  assert.equal(pkg.scripts["test:browser:all"], "node scripts/browser-tests-all.js");
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/browser-tests-all.js")));
  const pelari = baca("scripts/browser-tests-all.js");
  assert.match(pelari, /press-limit-browser-test/);
  assert.match(pelari, /motion-browser-test/);
  assert.match(pelari, /download-drive-browser-test/);
  assert.match(pelari, /laporan-dua-pengguna-browser-test/);
  assert.match(pelari, /for \(const suite of SUITES\)/);
  assert.match(pelari, /process\.exitCode/);
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/motion-browser-test.js")));
  const skrip = baca("scripts/motion-browser-test.js");
  assert.match(skrip, /doubleClickBoing/);
  assert.match(skrip, /document\.documentElement\.dataset\.scrollDirection/);
  assert.match(skrip, /scrollTop > awal \+ 40/);
  assert.match(indexHtml, /reference-app\.js\?v=\d+(?:\.\d+)+/);
  assert.match(indexHtml, /screen-time\.css\?v=1\.0\.4/);
  assert.match(indexHtml, /animations\.css\?v=2\.4\.1/);
});
