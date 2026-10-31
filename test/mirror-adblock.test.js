/* Adblock mirror: server menolak URL shortener/iklan sebelum dikirim ke
   klien, dan klien memasang iframe dengan sandbox tanpa popup maupun
   top-navigation. Dua lapis ini yang mencegah pengguna terlempar ke halaman
   iklan saat memilih mirror. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalisasiMirror, parseMirrorOptions } = require("../server");

const ROOT = path.join(__dirname, "..");
const baca = (relatif) => fs.readFileSync(path.join(ROOT, relatif), "utf8");

/* ---------- 1. Server: URL yang boleh dipasang ---------- */

test("mirror http/https biasa diterima apa adanya", () => {
  assert.equal(normalisasiMirror("https://player.contoh.com/embed/abc"), "https://player.contoh.com/embed/abc");
  assert.equal(normalisasiMirror("http://cdn.contoh.com/video.mp4"), "http://cdn.contoh.com/video.mp4");
  assert.equal(normalisasiMirror("  https://player.contoh.com/embed/abc  "), "https://player.contoh.com/embed/abc");
});

test("host yang kebetulan mengandung \"ad\" tetap diterima", () => {
  /* Filter tidak boleh memblokir kata "ad" secara umum: "adventure",
     "download", "shadow" adalah host yang sah. */
  for (const host of ["adventure-player.com", "download.contoh.com", "shadowplay.tv"]) {
    assert.equal(normalisasiMirror(`https://${host}/embed/1`), `https://${host}/embed/1`, host);
  }
});

test("skema selain http/https ditolak", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://contoh.com/file.mp4",
    "file:///C:/Windows/System32/calc.exe",
    "//player.contoh.com/embed/abc",
    "",
    "   ",
  ]) {
    assert.equal(normalisasiMirror(url), "", `seharusnya ditolak: ${url}`);
  }
});

test("kredensial dan port aneh ditolak", () => {
  assert.equal(normalisasiMirror("https://user:pass@player.contoh.com/embed/1"), "");
  assert.equal(normalisasiMirror("https://player.contoh.com:8443/embed/1"), "");
  assert.equal(normalisasiMirror("http://player.contoh.com:8080/embed/1"), "");
});

test("host privat dan loopback ditolak", () => {
  for (const url of [
    "http://localhost/embed/1",
    "http://127.0.0.1:80/embed/1",
    "http://10.0.0.5/embed/1",
    "http://192.168.1.20/embed/1",
    "http://172.16.0.9/embed/1",
    "http://[::1]/embed/1",
  ]) {
    assert.equal(normalisasiMirror(url), "", `seharusnya ditolak: ${url}`);
  }
});

test("host shortener/iklan ditolak, termasuk subdomainnya", () => {
  for (const host of [
    "adf.ly",
    "bit.ly",
    "shrinkme.io",
    "linkvertise.com",
    "ouo.io",
    "sub2unlock.com",
    "cutt.ly",
  ]) {
    assert.equal(normalisasiMirror(`https://${host}/abc123`), "", host);
    assert.equal(normalisasiMirror(`https://www.${host}/abc123`), "", `www.${host}`);
    assert.equal(normalisasiMirror(`https://sub.${host}/abc123`), "", `sub.${host}`);
  }
});

test("mirror TeraBox ditolak, termasuk subdomain dan domain alternatifnya", () => {
  /* TeraBox tidak bisa diputar di iframe: halamannya meminta aplikasi atau
     login, jadi jangan pernah ditawarkan sebagai mirror streaming. */
  for (const host of [
    "terabox.com",
    "teraboxapp.com",
    "terabox.app",
    "teraboxlink.com",
    "1024tera.com",
    "4funbox.com",
  ]) {
    assert.equal(normalisasiMirror(`https://${host}/s/abc123`), "", host);
    assert.equal(normalisasiMirror(`https://www.${host}/s/abc123`), "", `www.${host}`);
    assert.equal(normalisasiMirror(`https://sub.${host}/s/abc123`), "", `sub.${host}`);
  }
});

test("jalur penanda iklan di host sah tetap ditolak", () => {
  /* Shortener kadang menumpang domain lain lewat path. Yang dicek hanya
     penanda yang dikenal supaya "/adventure" tidak ikut kena. */
  for (const url of [
    "https://player.contoh.com/popunder/abc",
    "https://player.contoh.com/adsbatch720.php",
    "https://cdn.contoh.com/adsterra/embed",
    "https://contoh.com/onclickads?id=1",
  ]) {
    assert.equal(normalisasiMirror(url), "", `seharusnya ditolak: ${url}`);
  }
  assert.equal(normalisasiMirror("https://player.contoh.com/adventure/1"), "https://player.contoh.com/adventure/1");
});

/* ---------- 2. Server: HTML mirror yang di-parse ---------- */

test("iframe iklan dibuang dari daftar mirror", () => {
  const html = `
    <div class="mirror">
      <option data-url="https://player.contoh.com/embed/1">Mirror A</option>
      <option data-url="https://adf.ly/abc123">Mirror B</option>
      <option data-url="javascript:alert(1)">Mirror C</option>
      <option data-url="http://192.168.1.5/embed">Mirror D</option>
    </div>`;
  const streams = parseMirrorOptions(html);
  assert.equal(streams.length, 1, "hanya mirror sah yang tersisa");
  assert.equal(streams[0].url, "https://player.contoh.com/embed/1");
  assert.equal(streams[0].name, "Mirror A");
});

test("mirror ganda hanya muncul sekali", () => {
  const html = `
    <div class="mirror">
      <option data-url="https://player.contoh.com/embed/1">Mirror A</option>
      <option data-url="https://player.contoh.com/embed/1">Mirror A lagi</option>
    </div>`;
  const streams = parseMirrorOptions(html);
  assert.equal(streams.length, 1);
});

test("tanpa mirror sah, daftar kosong - bukan URL mentah", () => {
  const html = '<iframe src="https://bit.ly/iklan"></iframe>';
  assert.deepEqual(parseMirrorOptions(html), []);
});

/* ---------- 3. Klien: sandbox iframe ---------- */

/* Ambil nilai sandbox yang benar-benar dipasang, bukan komentar di
   sekitarnya: komentar memang menyebut allow-popups untuk menjelaskan
   kenapa token itu sengaja tidak dipakai. */
function nilaiSandbox(sumber) {
  return [...sumber.matchAll(/setAttribute\("sandbox",\s*([^)]+)\)/g)].map((m) => m[1].trim());
}

function assertSandboxKetat(nilai) {
  assert.ok(nilai.length > 0, "harus ada setAttribute sandbox");
  for (const sandbox of nilai) {
    assert.doesNotMatch(sandbox, /allow-popups|allow-top-navigation|allow-modals|allow-forms|allow-downloads/, sandbox);
    assert.match(sandbox, /allow-scripts/, sandbox);
  }
}

test("player utama memasang sandbox tanpa popup dan top-navigation", () => {
  const sumber = baca("public/js/reference-app.js");
  const konstanta = sumber.match(/const MIRROR_SANDBOX = "([^"]+)"/);
  assert.ok(konstanta, "MIRROR_SANDBOX harus dideklarasikan");
  assert.match(sumber, /setAttribute\("sandbox", MIRROR_SANDBOX\)/);
  assertSandboxKetat([konstanta[1]]);
});

test("halaman maintenance memakai sandbox yang sama", () => {
  const sumber = baca("public/maintenance-page/maintenance.js");
  assertSandboxKetat(nilaiSandbox(sumber));
});

test("iframe hanya dibuat dari URL http/https", () => {
  const sumber = baca("public/js/reference-app.js");
  assert.match(sumber, /function buatIframeMirror/);
  assert.match(sumber, /parsed\.protocol !== "http:" && parsed\.protocol !== "https:"/);
  assert.match(sumber, /box\.innerHTML = `<div class="player-ph">.*diblokir/);
});
