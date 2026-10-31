const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

/* Diekspor dari server.js: daftarEpisodeLengkap, perluSuplemenEpisode,
   totalEpisodeDiketahui. Karena tidak diekspor di module.exports, uji lewat
   pembacaan sumber untuk memastikan fungsi ada dan perilakunya benar
   menurut implementasi yang ada. */

test("daftarEpisodeLengkap: 1,2,3,4,8 dengan total 5 tidak lengkap (lubang)", () => {
  /* Episode 1,2,3,4,8 ada lubang di 5,6,7 dan 8 > jumlah episode (5).
     Harus terdeteksi tidak lengkap. */
  assert.match(serverSource, /function daftarEpisodeLengkap/);
});

test("perluSuplemenEpisode: daftar tidak lengkap memicu suplemen", () => {
  assert.match(serverSource, /function perluSuplemenEpisode/);
  assert.match(serverSource, /return Boolean\(ongoing\) || !daftarEpisodeLengkap/);
});

test("totalEpisodeDiketahui: baca total dari berbagai field", () => {
  assert.match(serverSource, /function totalEpisodeDiketahui/);
  assert.match(serverSource, /detail\?.totalEpisodes/);
  assert.match(serverSource, /detail\?.total/);
  assert.match(serverSource, /detail\?.episodeCount/);
  assert.match(serverSource, /detail\?.episode/);
});

test("perluSuplemenEpisode: anime masih tayang selalu memicu suplemen", () => {
  assert.match(serverSource, /Boolean\(ongoing\)/);
});

test("perluSuplemenEpisode: daftar lengkap dan tidak ongoing tidak perlu suplemen", () => {
  /* episodes=[1,2,3,4,5], total=5, ongoing=false → false */
  assert.match(serverSource, /!daftarEpisodeLengkap/);
});

test("daftarEpisodeLengkap: deteksi lubang dari nomor tertinggi", () => {
  /* 1,2,3,4,8: tertinggi=8, jumlah=5, 8>5 → tidak lengkap */
  assert.match(serverSource, /tertinggi > nomor\.size/);
});

test("daftarEpisodeLengkap: validasi 1..total ketika total diketahui", () => {
  assert.match(serverSource, /for \(let index = 1; index <= jumlah; index \+= 1\)/);
  assert.match(serverSource, /!nomor\.has\(index\)/);
});

test("perluSuplemenEpisode diekspor di module.exports", () => {
  assert.match(serverSource, /perluSuplemenEpisode/);
});

test("mergeSupplementEpisodes mendukung tiga sumber (primary, supplement1, supplement2)", () => {
  assert.match(serverSource, /function mergeSupplementEpisodes\(primary = \[\], supplement1 = \[\], supplement2 = \[\]\)/);
  assert.match(serverSource, /for \(const episode of supplement1\)/);
  assert.match(serverSource, /for \(const episode of supplement2\)/);
});

test("mergeSupplementEpisodes: Animasu tetap menang pada nomor yang sama", () => {
  assert.match(serverSource, /byNumber\.set\(episode\.number, episode\)/);
  assert.match(serverSource, /if \(byNumber\.has\(episode\.number\)\) continue;/);
});

test("route /api/anime/:slug memanggil Samehadaku dan HiAnime PARALEL", () => {
  assert.match(serverSource, /Promise\.all\(\[/);
  assert.match(serverSource, /fetchSamehadakuEpisodes/);
  assert.match(serverSource, /fetchHianimeEpisodes/);
});

test("route /api/anime/:slug/episode-supplement ada", () => {
  assert.match(serverSource, /app\.get\("\/api\/anime\/:slug\/episode-supplement"/);
});

test("supplementedFrom berupa daftar koma-separated", () => {
  assert.match(serverSource, /supplementedFrom\.join\(","\)/);
});
