/* Load pass: gzip untuk aset teks, cache setahun untuk aset berversi, dan
   "New Update" yang tidak lagi menunggu daftar genre. Perubahannya harus
   terlihat di respons HTTP sungguhan, bukan hanya ada di kode. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");
const { app } = require("../server");

const ROOT = path.join(__dirname, "..");
const baca = (relatif) => fs.readFileSync(path.join(ROOT, relatif), "utf8");

let server;
let port;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function minta(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("CSS/JS dikirim gzip dan isinya utuh setelah di-decompress", async () => {
  const response = await minta("/css/components.css?v=2.24.5", { "Accept-Encoding": "gzip" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-encoding"], "gzip");
  const asli = fs.readFileSync(path.join(ROOT, "public/css/components.css"));
  const hasil = zlib.gunzipSync(response.body);
  assert.ok(hasil.equals(asli), "isi CSS harus sama persis setelah gunzip");
  assert.ok(response.body.length < hasil.length, "body gzip harus lebih kecil");
});

test("aset berversi boleh di-cache setahun, aset tanpa versi tidak", async () => {
  const berversi = await minta("/js/reference-app.js?v=2.39.21");
  assert.equal(berversi.status, 200);
  assert.match(berversi.headers["cache-control"], /max-age=31536000/);
  assert.match(berversi.headers["cache-control"], /immutable/);

  /* base.css tidak punya ?v=, jadi perbaikan di file itu tidak boleh
     terjebak setahun di browser pengguna. */
  const tanpaVersi = await minta("/css/base.css");
  assert.equal(tanpaVersi.status, 200);
  assert.doesNotMatch(String(tanpaVersi.headers["cache-control"] || ""), /immutable/);
});

test("shell memuat modul utama lebih awal, sebelum parser mencapai akhir body", () => {
  const html = baca("public/index.html");
  assert.match(html, /<link rel="modulepreload" href="\/js\/reference-app\.js\?v=\d+(?:\.\d+)+" \/>/);
  assert.match(html, /<link rel="modulepreload" href="\/js\/api\.js\?v=\d+(?:\.\d+)+" \/>/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/i[0-3]\.wp\.com" \/>/);
  /* modulepreload sebelum importmap membuat "animejs" gagal di-resolve. */
  assert.ok(html.indexOf("type=\"importmap\"") < html.indexOf("rel=\"modulepreload\""), "modulepreload harus setelah importmap");
});

test("New Update dirender dari daily tanpa menunggu genres", () => {
  const js = baca("public/js/reference-app.js");
  const mulai = js.indexOf("async function loadLive()");
  const akhir = js.indexOf("/* Kunci tidak cocok?", mulai);
  assert.ok(mulai > 0 && akhir > mulai, "loadLive harus bisa ditemukan");
  const isi = js.slice(mulai, akhir);
  assert.ok(isi.indexOf("api.daily()") < isi.indexOf("api.genres()"), "daily dikirim lebih dulu");
  /* Komentar boleh menyebut cara lama; yang diperiksa kode yang benar-benar jalan. */
  const kode = isi.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(kode, /Promise\.allSettled/);
  assert.match(kode, /state\.updateLoading = false;\s*renderUpdates\(\);/);
  assert.ok(kode.indexOf("loadRecommendations()") < kode.indexOf("await genreTask"), "genre ditunggu paling akhir");
});
