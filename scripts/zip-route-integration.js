const http = require("node:http");
const assert = require("node:assert/strict");

const requests = [];
const PORT = 4391;
const baseUrl = `http://127.0.0.1:${PORT}`;
/* Mirror juga dilayani lokal supaya tidak ada satu pun request keluar ke
   internet. 4392/4394 sengaja TIDAK didengarkan: keduanya dipakai sebagai
   sourceUrl "blocked" untuk membuktikan query itu diabaikan. */
const SAMEHADAKU_PORT = 4395;
const HIANIME_PORT = 4393;
const samehadakuUrl = `http://127.0.0.1:${SAMEHADAKU_PORT}`;
const hianimeUrl = `http://127.0.0.1:${HIANIME_PORT}`;
const samehadakuRequests = [];
const hianimeRequests = [];
const day = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Bangkok" }).format(new Date()).toLowerCase();
const card = `<div class="bixbox"><div class="releases"><h3><span>${day}</span></h3></div><div class="bs"><div class="bsx"><a href="${baseUrl}/anime/animasu-anime/"><div class="tt">Animasu Anime</div><span class="epx">Episode 1</span></a></div></div></div>`;
const detail = `<div class="infox"><h1>Animasu Anime</h1><div class="alter">Animasu Series</div><div class="spe"><span>Jenis: Series</span><span>Status: Ongoing</span><span>Episode: 1</span></div></div><div class="sinopsis"><p>Animasu detail</p></div><div id="daftarepisode"><ul><li><a href="/nonton-animasu-anime-episode-1/">Episode 1</a></li></ul></div>`;
const mirror = `<div class="player-embed"><iframe src="https://mirror.example/animasu"></iframe></div>`;
const genreDirectory = `<div class="genres"><a href="/genre/aksi/">Aksi</a></div>`;
/* Judul berbeda dari kartu harian supaya query AniList-nya cache miss dan
   jalur axios.post untuk rekomendasi genre benar-benar dieksekusi. */
const genreCard = `<div class="listupd"><div class="bs"><a href="${baseUrl}/anime/genre-anime/"><div class="tt">Genre Anime</div></a></div></div>`;

const animasu = http.createServer((request, response) => {
  const pathname = new URL(request.url, baseUrl).pathname;
  requests.push(pathname);
  const body = pathname === "/jadwal/" ? card
    : pathname.includes("/kumpulan-genre-anime-lengkap/") ? genreDirectory
      : pathname.startsWith("/genre/") ? genreCard
        : pathname.includes("/anime/animasu-anime/") ? detail
          : pathname.includes("nonton-animasu-anime-episode-1") ? mirror
            : card;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
});

/* Samehadaku palsu: pencarian selalu kosong. Itu cukup untuk memastikan
   request-nya benar-benar ke localhost; tidak perlu markup halaman detail. */
const samehadaku = http.createServer((request, response) => {
  const url = new URL(request.url, samehadakuUrl);
  samehadakuRequests.push(`${url.pathname}${url.search}`);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<html><body><p>Tidak ada hasil.</p></body></html>");
});

/* HiAnime palsu: judul cocok dan punya episode 2, jadi merge supplement
   benar-benar teruji, bukan cuma status "up". */
const hianime = http.createServer((request, response) => {
  const pathname = new URL(request.url, hianimeUrl).pathname;
  hianimeRequests.push(pathname);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<h1>Animasu Anime</h1><div class="spe"><span>Status: Ongoing</span></div>'
    + '<a href="/episode/animasu-anime-episode-2/" title="Episode 2">Episode 2</a>');
});

async function json(url) { const response = await fetch(url); return { status: response.status, body: await response.json() }; }

process.env.ANIMASU_BASE_URL = baseUrl;
process.env.SAMEHADAKU_BASE_URL = samehadakuUrl;
process.env.HIANIME_BASE_URL = hianimeUrl;
/* Server HiAnime palsu di bawah ini melayani HTML, bukan API. Uji integrasi
   sengaja mengunci jalur lama supaya rute dan merge tetap teruji tanpa
   jaringan; jalur API diuji di test unit dan probe langsung. */
process.env.HIANIME_MODE = "html";
process.env.REQUEST_TIMEOUT_MS = "1000";
/* Semua sumber lokal: jeda antar-request upstream tidak diperlukan dan
   hanya memperlambat uji. */
process.env.UPSTREAM_MIN_INTERVAL_MS = "0";
process.env.SEARCH_UPSTREAM_MIN_INTERVAL_MS = "0";
process.env.DAILY_CACHE_MS = "1";
process.env.MAX_SEARCH_PAGES = "2";
/* Skrip ini memakai /api/health untuk memeriksa isolasi source, jadi harus
   menyalakan mode detail. Tanpa ini health publik hanya membalas
   { ok, sourceStatus } sehingga daftar source tidak terlihat. */
process.env.HEALTH_DETAIL = "1";

/* Jaring pengaman terakhir: semua sumber sudah menunjuk localhost, tetapi
   kalau ada kode baru memanggil host luar lewat axios, request-nya ditolak
   dan dicatat. Uji gagal di akhir, bukan diam-diam menyentuh internet. */
const axios = require("axios");
const axiosGetAsli = axios.get.bind(axios);
const axiosPostAsli = axios.post.bind(axios);
const fetchAsli = globalThis.fetch.bind(globalThis);
const requestLuar = [];
function blokirLuar(url) {
  let host = "";
  try { host = new URL(String(url)).hostname; } catch { /* biarkan pemanggil yang menolak URL aneh */ }
  if (!host || host === "127.0.0.1" || host === "localhost" || host === "::1") return null;
  requestLuar.push(String(url));
  return Promise.reject(new Error(`request keluar diblokir oleh uji: ${url}`));
}
axios.get = (url, options) => blokirLuar(url) || axiosGetAsli(url, options);
axios.post = (url, data, options) => blokirLuar(url) || axiosPostAsli(url, data, options);
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  return blokirLuar(url) || fetchAsli(input, init);
};

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

(async () => {
  await Promise.all([listen(animasu, PORT), listen(samehadaku, SAMEHADAKU_PORT), listen(hianime, HIANIME_PORT)]);
  const { app } = require("../server");
  const application = app.listen(0, "127.0.0.1", async () => {
    const base = `http://127.0.0.1:${application.address().port}`;
    try {
      const daily = await json(`${base}/api/daily`);
      assert.equal(daily.status, 200);
      assert.equal(daily.body.provider, "animasu");
      assert.equal(daily.body.data[0].sourceProvider, "animasu");

      const search = await json(`${base}/api/catalog?search=Animasu&genre=`);
      assert.equal(search.status, 200);
      assert.equal(search.body.provider, "animasu");
      assert.equal(search.body.data[0].slug, "animasu-anime");

      const detailResponse = await json(`${base}/api/anime/animasu-anime?provider=external&sourceUrl=http://127.0.0.1:4394/blocked`);
      assert.equal(detailResponse.status, 200);
      assert.equal(detailResponse.body.provider, "animasu");
      assert.equal(detailResponse.body.data.episodes[0].sourceProvider, "animasu");
      /* Mirror lokal benar-benar dipakai dan episode-nya ikut di-merge. */
      assert.ok(samehadakuRequests.length > 0, "samehadaku lokal tidak menerima request pencarian");
      assert.ok(hianimeRequests.length > 0, "hianimetv lokal tidak menerima request halaman");
      assert.match(detailResponse.body.supplementedFrom || "", /hianimetv/,
        "episode dari hianimetv lokal tidak ikut di-merge");
      assert.ok(detailResponse.body.data.episodes.some((episode) => episode.sourceProvider === "hianimetv"),
        "episode hianimetv tidak punya sourceProvider yang benar");

      const streams = await json(`${base}/api/streams/nonton-animasu-anime-episode-1?provider=external&sourceUrl=http://127.0.0.1:4392/blocked`);
      assert.equal(streams.status, 200);
      assert.equal(streams.body.provider, "yaoi");
      assert.equal(streams.body.data[0].url, "https://mirror.example/animasu");

      const health = await json(`${base}/api/health`);
      /* Bentuk ini berubah 17 Oktober 2026. `sources` dulu hanya
         `animasu` + `yaoi`. Sekarang health melaporkan SETIAP sumber yang
         dikonfigurasi - termasuk `samehadaku` dan `hianimetv` - supaya
         status mirror terlihat terpisah dari sumber utama. Melaporkan
         hanya yang kebetulan aktif membuat supplementing yang mati tidak
         pernah kelihatan.

         `MIRROR_ONLY_SOURCES` adalah konstanta modul, jadi samehadaku dan
         hianimetv memang terkonfigurasi di mode integrasi ini meski tidak
         dipakai di jalan request. Melaporkannya di sini adalah perilaku
         yang benar, jadi assertion yang usang - bukan kodenya. */
      assert.deepEqual(health.body.sources.map((source) => source.id), ["yaoi", "animasu", "samehadaku", "hianimetv"]);
      for (const source of health.body.sources) {
        assert.ok("status" in source, `${source.id} harus melaporkan status sendiri`);
        assert.ok("lastAttemptAt" in source && "lastError" in source,
          `${source.id} harus punya jejak waktu dan error, kalau tidak, mati diam-diam tidak akan terlihat`);
      }
      /* Mirror harus punya ember terpisah: status utama tidak boleh ikut
         berubah karena mirror-nya gagal. */
      assert.notEqual(health.body.sourceId, "samehadaku",
        "status publik tetap milik sumber utama, bukan mirror");
      /* Kedua mirror melaporkan "up" karena mock lokalnya menjawab 200.
         Kalau salah satu keluar ke internet, status ini tidak akan "up". */
      const statusSumber = Object.fromEntries(health.body.sources.map((source) => [source.id, source.status]));
      assert.equal(statusSumber.samehadaku, "up", "samehadaku lokal seharusnya sehat");
      assert.equal(statusSumber.hianimetv, "up", "hianimetv lokal seharusnya sehat");
      assert.equal(requests.some((path) => path.includes("blocked")), false);

      /* AniList dipanggil lewat axios.post. Guard harus menolaknya, tetapi
         endpoint tetap menjawab dari data Animasu - rekomendasi tidak boleh
         ikut mati hanya karena pengayaan gagal. */
      const rekomendasi = await json(`${base}/api/recommendations`);
      assert.equal(rekomendasi.status, 200);
      assert.equal(rekomendasi.body.source, "animasu");
      assert.ok((rekomendasi.body.data || []).some((item) => item.slug === "animasu-anime"),
        "rekomendasi lokal tidak memuat anime fixture");
      /* Genre memakai kartu dengan judul berbeda, jadi query AniList-nya
         tidak kena cache dan memicu axios.post kedua. */
      const rekomendasiGenre = await json(`${base}/api/recommendations?genre=Aksi`);
      assert.equal(rekomendasiGenre.status, 200);
      assert.equal(rekomendasiGenre.body.genre, "Aksi");
      assert.equal(rekomendasiGenre.body.source, "animasu");
      assert.ok((rekomendasiGenre.body.data || []).some((item) => item.slug === "genre-anime"),
        "rekomendasi genre lokal tidak memuat anime fixture");
      assert.ok(requestLuar.includes("https://graphql.anilist.co"),
        `axios.post AniList tidak terlihat; request luar: ${requestLuar.join(", ") || "(kosong)"}`);
      /* Dua jalur rekomendasi = dua percobaan AniList, semuanya ditolak
         sebelum keluar. */
      assert.equal(requestLuar.length, 2,
        `jumlah request luar tak terduga: ${requestLuar.join(", ")}`);
      assert.ok(requestLuar.every((url) => url === "https://graphql.anilist.co"),
        `request luar tak terduga: ${requestLuar.join(", ")}`);
      console.log(JSON.stringify({ mode: "animasu + yaoi + samehadaku + hianimetv, semuanya lokal", daily: "ok", search: "ok", detail: "ok", streams: "ok", sourceIsolation: "ok", recommendations: "ok (2 jalur, AniList diblokir)", animasuRequests: requests.length, samehadakuRequests: samehadakuRequests.length, hianimeRequests: hianimeRequests.length, blockedExternal: requestLuar.length }, null, 2));
    } finally {
      application.close(() => {
        animasu.close();
        samehadaku.close();
        hianime.close();
      });
    }
  });
})().catch((error) => {
  console.error(error);
  for (const server of [animasu, samehadaku, hianime]) {
    try { server.close(); } catch { /* server mungkin belum menyala */ }
  }
  process.exitCode = 1;
});
