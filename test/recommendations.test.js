const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const server = require("../server");
const client = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
const api = fs.readFileSync(path.join(ROOT, "public/js/api.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/css/components.css"), "utf8");

let utils;
test.before(async () => {
  const source = fs.readFileSync(path.join(ROOT, "public/js/app-utils.js"), "utf8");
  utils = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

/* ---------- Pencocokan judul ke AniList ---------- */

test("judul Animasu dibersihkan sebelum dicari di AniList", () => {
  assert.equal(server.titleForAniList("One Piece Serial Sub Indo"), "One Piece");
  assert.equal(server.titleForAniList("  Kusuriya no Hitorigoto Season 3  "), "Kusuriya no Hitorigoto Season 3");
});

test("skor judul tahan terhadap sufiks season yang berbeda", () => {
  assert.equal(server.titleMatchScore("Kusuriya no Hitorigoto Season 3", "Kusuriya no Hitorigoto 3rd Season"), 1);
  assert.equal(server.titleMatchScore("Steel Ball Run: JoJo no Kimyou na Bouken", "JoJo no Kimyou na Bouken Part 7: Steel Ball Run"), 1);
  assert.equal(server.titleMatchScore("Naruto", "Bleach"), 0);
});

/* ---------- Urutan kartu ---------- */

test("rekomendasi diurutkan dari rating lalu view, dan dibatasi sepuluh", () => {
  const items = [
    { title: "A", views: 10, rating: 9 },
    { title: "B", views: 100, rating: 7 },
    { title: "C", views: 10, rating: 9.5 },
    { title: "D" },
  ];
  assert.deepEqual(server.sortRecommendations(items, 3).map((item) => item.title), ["C", "A", "B"]);
});

test("tanpa view/rating sama sekali, urutan asli tidak diacak", () => {
  const items = [{ title: "A" }, { title: "B" }, { title: "C" }];
  assert.deepEqual(server.sortRecommendations(items).map((item) => item.title), ["A", "B", "C"]);
});

test("daftar genre menyimpan nama sekaligus slug untuk pencarian", () => {
  const fixture = '<a href="https://animasu.love/genre/aksi/">Aksi</a>'
    + '<a href="/genre/slice-of-life/">Slice of Life</a>'
    + '<a href="/genre/aksi/">Aksi</a>';
  const list = server.parseGenreLinks(fixture, "https://animasu.love");
  assert.deepEqual(list.map((genre) => [genre.name, genre.slug]), [["Aksi", "aksi"], ["Slice of Life", "slice-of-life"]]);
});

/* ---------- Helper klien ---------- */

test("format angka view ringkas dan memakai koma Indonesia", () => {
  assert.equal(utils.formatCompactNumber(83867), "83,9rb");
  assert.equal(utils.formatCompactNumber(1_250_000), "1,3jt");
  assert.equal(utils.formatCompactNumber(980), "980");
  assert.equal(utils.formatCompactNumber(0), "0");
});

test("genre rekomendasi hanya muncul setelah dua anime tamat di genre yang sama", () => {
  const items = [
    { slug: "a", status: "completed", genres: ["Aksi", "Drama"], lastWatchedAt: 1 },
    { slug: "b", total: 12, progress: 12, genres: ["Aksi"], lastWatchedAt: 5 },
    { slug: "c", status: "completed", genres: ["Drama"], lastWatchedAt: 3 },
    { slug: "d", status: "watching", genres: ["Aksi"] },
  ];
  assert.deepEqual(utils.topCompletedGenre(items, 2), { name: "Aksi", count: 2, lastAt: 5 });
  assert.equal(utils.topCompletedGenre(items.slice(0, 1), 2), null);
});

/* ---------- Pemasangan UI ---------- */

test("section rekomendasi berada di posisi yang diminta", () => {
  const iContinue = html.indexOf('id="continueSection"');
  const iPopular = html.indexOf('id="recPopularSection"');
  const iUpdate = html.indexOf('id="updateSection"');
  const iGenre = html.indexOf('id="recGenreSection"');
  const iStorage = html.indexOf('id="storageSection"');
  assert.ok(iContinue > 0 && iPopular > iContinue, "populer harus setelah Lanjutkan Menonton");
  assert.ok(iUpdate > iPopular, "populer harus sebelum New Update");
  assert.ok(iGenre > iUpdate, "genre harus setelah New Update");
  assert.ok(iStorage > iGenre, "genre harus sebelum Local Storage");
  assert.equal((html.match(/data-rec-prev=/g) || []).length, 2);
  assert.equal((html.match(/data-rec-next=/g) || []).length, 2);
});

test("klien memakai ambang dua anime tamat dan menampilkan view", () => {
  assert.match(client, /topCompletedGenre\(state\.storageItems, 2\)/);
  assert.match(client, /function loadRecommendations\(/);
  assert.match(client, /showViews: true/);
  assert.match(client, /function setupRecRails\(/);
  assert.match(api, /recommendations: \(genre = ""\)/);
  assert.match(css, /\.rec-nav\{/);
  assert.match(css, /\.rec-rail>/);
});

test("endpoint rekomendasi memakai AniList dan cache", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"), /app\.get\("\/api\/recommendations"/);
  assert.match(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"), /ANILIST_ENDPOINT\s*=/);
  assert.match(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"), /graphql\.anilist\.co/);
});
