const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const baca = (relatif) => fs.readFileSync(path.join(ROOT, relatif), "utf8");
const screenTimeSource = baca("public/js/screen-time.js");
const referenceApp = baca("public/js/reference-app.js");
const screenTimeCss = baca("public/css/screen-time.css");
const indexHtml = baca("public/index.html");
const imagePath = path.join(ROOT, "public/assets/double-click.webp");

let screenTime;
test.before(async () => {
  screenTime = await import(`data:text/javascript,${encodeURIComponent(screenTimeSource)}`);
});

function badanFungsi(nama) {
  const mulai = screenTimeSource.indexOf(`export function ${nama}`);
  assert.notEqual(mulai, -1, `${nama} harus ada`);
  const akhir = screenTimeSource.indexOf("\n}\n", mulai);
  assert.notEqual(akhir, -1, `${nama} harus punya penutup`);
  return screenTimeSource.slice(mulai, akhir + 3);
}

test("gambar double-click sudah dioptimalkan untuk render", () => {
  assert.ok(fs.existsSync(imagePath), "public/assets/double-click.webp harus ada");
  const stat = fs.statSync(imagePath);
  assert.ok(stat.size < 50 * 1024, `gambar harus di bawah 50 KB, sekarang ${stat.size} byte`);
  const header = fs.readFileSync(imagePath).subarray(0, 12);
  assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(header.subarray(8, 12).toString("ascii"), "WEBP");
});

test("pengingat hanya punya satu tombol dan teks yang diminta", () => {
  const badan = badanFungsi("mountDoubleClickReminder");
  assert.match(badan, />Bersabarlah sedikit</);
  assert.match(badan, /role="dialog" aria-modal="true"/);
  assert.match(badan, /button\.dataset\.doubleClickOk = ""/);
  assert.equal((badan.match(/createElement\("button"\)/g) || []).length, 1, "hanya satu tombol");
  assert.match(badan, /Tunggu \$\{remaining\} detik/);
  assert.match(badan, /cooldownSeconds = 2/);
});

test("gambar baru dimuat saat pengingat dibuka", () => {
  const badan = badanFungsi("mountDoubleClickReminder");
  assert.match(badan, /imageSrc = "\/assets\/double-click\.webp"/);
  assert.match(badan, /if \(image && !image\.getAttribute\("src"\)\) image\.src = imageSrc/);
  assert.match(screenTimeSource, /class="screen-time-dialog__image double-click-dialog__image"[^>]*decoding="async"/);
});

test("gaya mengikuti screen-time tetapi tampil di atas modal lain", () => {
  assert.match(screenTimeCss, /\.double-click-overlay\{z-index:720\}/);
  assert.match(screenTimeCss, /\.double-click-dialog\{width:min\(430px,100%\);padding-top:24px;animation:doubleClickBoing/);
  assert.match(screenTimeCss, /@keyframes doubleClickBoing\{[^}]*translateY\(30px\) scale\(\.86\)[^]*?38%\{[^}]*scale\(1\.035\)/);
  assert.match(screenTimeCss, /@keyframes doubleClickFace\{[^}]*scale\(\.55\)[^]*?55%\{[^}]*scale\(1\.08\)/);
  assert.match(screenTimeCss, /\.double-click-dialog \.screen-time-dialog__image\{[^}]*clamp\(108px,26vw,148px\)/);
  assert.match(screenTimeCss, /border-radius:18px/);
});

test("reference-app memasang pengingat dari klik yang ditolak", () => {
  assert.match(referenceApp, /import \{[^}]*mountDoubleClickReminder[^}]*\} from "\.\/screen-time\.js\?v=1\.2\.0"/);
  assert.match(referenceApp, /const doubleClickReminder = mountDoubleClickReminder\(\{ documentRef: document, windowRef: window \}\);/);
  assert.match(referenceApp, /attachPressLimiter\(document, \{\s*onBlocked: \(target\) => \{/);
  assert.match(referenceApp, /target\.closest\?\.\("\[data-double-click-overlay\]"\)/);
  assert.match(referenceApp, /document\.querySelector\("\[data-screen-overlay\]:not\(\[hidden\]\)"\)/);
  assert.match(referenceApp, /doubleClickReminder\?\.show\(\)/);
});

test("cache-buster ikut naik untuk screen-time dan reference-app", () => {
  assert.match(indexHtml, /screen-time\.css\?v=1\.0\.4/);
  assert.match(indexHtml, /reference-app\.js\?v=\d+(?:\.\d+)+/);
  assert.match(indexHtml, /animations\.css\?v=2\.4\.1/);
  assert.equal(typeof screenTime.mountDoubleClickReminder, "function");
});
