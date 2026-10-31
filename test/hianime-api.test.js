/* Jalur API hianimes.se (29 Oktober 2026). Yang diuji di sini adalah
   pemetaan data mentah dan aturan penyaringan - bukan jaringan. Tujuannya
   satu: kalau bentuk respons upstream berubah, tes ini yang berbunyi lebih
   dulu, bukan halaman detail yang diam-diam kehilangan episode. */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hianimeApiUrl,
  hianimeModeApi,
  petakanHasilHianimeApi,
  petakanEpisodeHianimeApi,
  streamsDariEpisodeHianime,
  detailDariAnimeHianime,
  kartuDariHasilHianime,
  gabungKartuKatalog,
  metaEpisodeHianimeTersimpan,
} = require("../server");
const settings = require("../settings");

/* Bentuk asli POST /api/filter: { total, page, limit, totalPages, results[] }. */
const FILTER_PAYLOAD = {
  total: 14,
  page: 1,
  limit: 20,
  totalPages: 1,
  results: [
    {
      _id: "68ff4cc05ecb2f5eb6a69d50",
      title: "That Time I Got Reincarnated as a Slime",
      slug: "that-time-i-got-reincarnated-as-a-slime-zkll85",
      mal_id: 37430,
      Type: "TV",
      totalEpisodes: 24,
      Status: "Finished Airing",
    },
    {
      _id: "68ff4cc05ecb2f5eb6a69d51",
      title: "That Time I Got Reincarnated as a Slime Season 2",
      slug: "that-time-i-got-reincarnated-as-a-slime-season-2-abc123",
      mal_id: 39551,
      Type: "TV",
      totalEpisodes: 12,
      Status: "Finished Airing",
    },
    /* Duplikat slug: hanya yang pertama dipakai. */
    {
      _id: "duplikat",
      title: "That Time I Got Reincarnated as a Slime",
      slug: "that-time-i-got-reincarnated-as-a-slime-zkll85",
      mal_id: 37430,
    },
    /* Tanpa _id atau judul: dibuang, bukan menghasilkan kartu setengah. */
    { title: "Tanpa id", slug: "tanpa-id" },
    { _id: "tanpa-judul", title: "", slug: "tanpa-judul" },
  ],
};

const EPISODE_PAYLOAD = {
  total: 3,
  episodes: [
    {
      _id: "ep1",
      episodeNumber: 1,
      slug: "that-time-i-got-reincarnated-as-a-slime-episode-1-jogb84",
      link: {
        sub: ["https://zokoanime.video/stream/mal/37430/1/sub?autostart=false&asi=0"],
        dub: ["https://zokoanime.video/stream/mal/37430/1/dub"],
      },
    },
    {
      _id: "ep2",
      episodeNumber: 2,
      slug: "that-time-i-got-reincarnated-as-a-slime-episode-2-0qz077",
      link: { sub: ["https://zokoanime.video/stream/mal/37430/2/sub"], dub: [] },
    },
    /* Nomor ganda: yang pertama menang. */
    {
      _id: "ep2-lagi",
      episodeNumber: 2,
      slug: "duplikat-episode-2",
      link: { sub: ["https://zokoanime.video/stream/mal/37430/2/sub-lain"] },
    },
    /* Nomor tidak valid dan slug kosong: dibuang. */
    { _id: "rusak", episodeNumber: 0, slug: "episode-nol" },
    { _id: "rusak2", episodeNumber: 3, slug: "" },
  ],
};

test("URL API disusun dari base tanpa garis miring ganda", () => {
  assert.equal(hianimeApiUrl("filter"), `${settings.HIANIME_API_BASE_URL.replace(/\/+$/, "")}/filter`);
  assert.equal(hianimeApiUrl("/episodes/abc"), `${settings.HIANIME_API_BASE_URL.replace(/\/+$/, "")}/episodes/abc`);
});

test("mode bawaan adalah API; html hanya kalau diminta eksplisit", () => {
  assert.equal(hianimeModeApi(), String(settings.HIANIME_MODE || "api").toLowerCase() !== "html");
  assert.equal(settings.HIANIME_MODE, "api");
});

test("hasil /filter: identitas anime dipetakan, duplikat dan entri rusak dibuang", () => {
  const hasil = petakanHasilHianimeApi(FILTER_PAYLOAD);
  assert.equal(hasil.length, 2);
  assert.equal(hasil[0].id, "68ff4cc05ecb2f5eb6a69d50");
  assert.equal(hasil[0].slug, "that-time-i-got-reincarnated-as-a-slime-zkll85");
  assert.equal(hasil[0].malId, 37430);
  assert.equal(hasil[0].totalEpisodes, 24);
  assert.equal(hasil[0].status, "Finished Airing");
  assert.equal(hasil[0].key, "that time i got reincarnated as a slime");
  assert.match(hasil[0].sourceUrl, /^https:\/\/hianimes\.se\/watch\//);
  assert.equal(hasil[1].malId, 39551);
});

test("payload kosong atau rusak menghasilkan daftar kosong, bukan lemparan", () => {
  assert.deepEqual(petakanHasilHianimeApi(null), []);
  assert.deepEqual(petakanHasilHianimeApi({ results: "bukan array" }), []);
  assert.deepEqual(petakanHasilHianimeApi({}), []);
});

test("episode: sub dan dub dipisah, nomor ganda dan entri rusak dibuang", () => {
  const daftar = petakanEpisodeHianimeApi(EPISODE_PAYLOAD);
  assert.equal(daftar.length, 2);
  assert.deepEqual(daftar.map((item) => item.number), [1, 2]);
  assert.equal(daftar[0].sub.length, 1);
  assert.equal(daftar[0].dub.length, 1);
  assert.equal(daftar[1].dub.length, 0);
  assert.match(daftar[0].url, /^https:\/\/hianimes\.se\/watch\//);
});

test("nama mirror netral: sub sebelum dub, host terlarang dibuang", () => {
  const streams = streamsDariEpisodeHianime({
    sub: ["https://zokoanime.video/stream/mal/37430/1/sub", "https://www.terabox.com/s/abc"],
    dub: ["https://zokoanime.video/stream/mal/37430/1/dub"],
  });
  assert.deepEqual(streams.map((stream) => stream.url), [
    "https://zokoanime.video/stream/mal/37430/1/sub",
    "https://zokoanime.video/stream/mal/37430/1/dub",
  ]);
  assert.deepEqual(streams.map((stream) => stream.name), ["Server Sub", "Server Dub"]);
  assert.ok(streams.every((stream) => stream.source === "hianimetv"));
});

test("URL mirror yang sama tidak ditawarkan dua kali", () => {
  const streams = streamsDariEpisodeHianime({
    sub: ["https://zokoanime.video/stream/mal/37430/1/sub"],
    dub: ["https://zokoanime.video/stream/mal/37430/1/sub"],
  });
  assert.equal(streams.length, 1);
});

test("episode tanpa sub maupun dub tidak menghasilkan mirror", () => {
  assert.deepEqual(streamsDariEpisodeHianime({}), []);
  assert.deepEqual(streamsDariEpisodeHianime({ sub: [], dub: [] }), []);
});

/* ---------- Katalog kedua: kartu, dedupe, detail ---------- */

test("nilai rating diambil dari Score, bukan rating umur di score", () => {
  const hasil = petakanHasilHianimeApi({
    results: [
      { _id: "a", title: "Cyberpunk: Edgerunners", slug: "a-1", Score: "8.5", score: "PG-13" },
      { _id: "b", title: "Cyberpunk: Edgerunners 2", slug: "b-1", Score: "", score: "PG-13" },
      { _id: "c", title: "Tanpa nilai", slug: "c-1", Score: "0", score: "R-17" },
    ],
  });
  assert.equal(hasil[0].score, 8.5);
  assert.equal(hasil[1].score, 0);
  assert.equal(hasil[2].score, 0);
});

test("kartu HiAnime punya field yang dibaca normAnime di klien", () => {
  const kartu = kartuDariHasilHianime({
    title: "Cyberpunk: Edgerunners 2",
    slug: "cyberpunk:-edgerunners-2-eddnc7",
    image: "https://contoh/poster.jpg",
    type: "ONA",
    totalEpisodes: 10,
    status: "Not yet aired",
    score: 8.4,
    malId: 61990,
    sourceUrl: "https://hianimes.se/watch/cyberpunk:-edgerunners-2-eddnc7",
  });
  assert.equal(kartu.title, "Cyberpunk: Edgerunners 2");
  assert.equal(kartu.slug, "cyberpunk:-edgerunners-2-eddnc7");
  assert.equal(kartu.image, "https://contoh/poster.jpg");
  assert.equal(kartu.posterUrl, "https://contoh/poster.jpg");
  assert.equal(kartu.episode, "10 Eps");
  assert.equal(kartu.totalEpisodes, 10);
  assert.equal(kartu.rating, 8.4);
  assert.equal(kartu.status, "UPCOMING");
  assert.equal(kartu.sourceProvider, "hianimetv");
});

test("status kartu: tayang jadi ONGOING, selesai jadi COMPLETE", () => {
  assert.equal(kartuDariHasilHianime({ title: "A", slug: "a", status: "Currently Airing" }).status, "ONGOING");
  assert.equal(kartuDariHasilHianime({ title: "B", slug: "b", status: "Finished Airing" }).status, "COMPLETE");
  assert.equal(kartuDariHasilHianime({ title: "C", slug: "c", status: "" }).status, "COMPLETE");
});

test("gabung katalog: hasil Animasu menang, judul baru dari HiAnime ditambahkan", () => {
  const utama = [
    { title: "Cyberpunk: Edgerunners", slug: "cyberpunk-edgerunners" },
    { title: "Maou 2099", slug: "maou-2099" },
  ];
  const tambahan = [
    { title: "Cyberpunk: Edgerunners", slug: "cyberpunk:-edgerunners-0chqfh" },
    { title: "Cyberpunk: Edgerunners 2", slug: "cyberpunk:-edgerunners-2-eddnc7" },
  ];
  const hasil = gabungKartuKatalog(utama, tambahan);
  assert.deepEqual(hasil.map((kartu) => kartu.title), [
    "Cyberpunk: Edgerunners",
    "Maou 2099",
    "Cyberpunk: Edgerunners 2",
  ]);
  assert.equal(hasil[0].slug, "cyberpunk-edgerunners", "kartu Animasu tidak boleh diganti kartu HiAnime");
});

test("gabung katalog mengenali alias, bukan hanya judul yang sama", () => {
  const utama = [{
    title: "Maou 2099",
    slug: "maou-2099",
    englishTitle: "Demon Lord 2099",
    aliases: ["Maou 2099", "Demon Lord 2099"],
  }];
  const tambahan = [{ title: "Demon Lord 2099", slug: "demon-lord-2099-abc123" }];
  assert.equal(gabungKartuKatalog(utama, tambahan).length, 1);
});

test("gabung katalog membuang slug dan entri tanpa judul", () => {
  const hasil = gabungKartuKatalog(
    [{ title: "Satu", slug: "satu" }, { title: "Tanpa slug", slug: "" }, null],
    [{ title: "", slug: "tanpa-judul" }, { title: "Satu", slug: "satu-lagi" }],
  );
  assert.deepEqual(hasil.map((kartu) => kartu.slug), ["satu"]);
});

test("detail HiAnime memakai bentuk detail Animasu dan mengingat meta episode", () => {
  const anime = {
    _id: "6ad6a6bb4e1a627ba04bb086",
    title: "Cyberpunk: Edgerunners 2",
    slug: "cyberpunk:-edgerunners-2-eddnc7",
    alternateTitle: "Cyberpunk: Edgerunners 2",
    English: "Cyberpunk: Edgerunners 2",
    image: "https://contoh/poster.jpg",
    synopsis: "Sinopsis dari sumber.",
    Score: "8.4",
    score: "PG-13",
    genres: ["Action", "Drama", "Sci-Fi"],
    Status: "Finished Airing",
    Aired: "2026",
    Type: "ONA",
    Duration: "24 min",
    Premiered: "Fall 2026",
    totalEpisodes: 10,
    mal_id: 61990,
  };
  const episodes = [
    { number: 1, slug: "cyberpunk-edgerunners-2-episode-1-21m3n7", url: "https://hianimes.se/watch/ep-1" },
    { number: 2, slug: "cyberpunk-edgerunners-2-episode-2-abc123", url: "https://hianimes.se/watch/ep-2" },
  ];
  const detail = detailDariAnimeHianime(anime, episodes);

  assert.equal(detail.title, "Cyberpunk: Edgerunners 2");
  assert.equal(detail.slug, "cyberpunk:-edgerunners-2-eddnc7");
  assert.equal(detail.rating, 8.4, "rating tidak boleh membaca rating umur PG-13");
  assert.equal(detail.status, "Finished Airing");
  assert.equal(detail.type, "ONA");
  assert.equal(detail.totalEpisodes, 10);
  assert.equal(detail.malId, 61990);
  assert.equal(detail.sourceProvider, "hianimetv");
  assert.match(detail.sourceUrl, /^https:\/\/hianimes\.se\/watch\//);
  assert.deepEqual(detail.genres.map((genre) => genre.name), ["Action", "Drama", "Sci-Fi"]);
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].episode, "Episode 1");
  assert.equal(detail.episodes[0].sourceProvider, "hianimetv");

  const meta = metaEpisodeHianimeTersimpan("cyberpunk-edgerunners-2-episode-1-21m3n7");
  assert.equal(meta.title, "Cyberpunk: Edgerunners 2");
  assert.equal(meta.animeSlug, "cyberpunk:-edgerunners-2-eddnc7");
  assert.equal(meta.episodeNumber, 1);
  assert.equal(meta.dariHianime, true);
  assert.equal(metaEpisodeHianimeTersimpan("slug-yang-tidak-ada"), null);
});

test("detail HiAnime dengan data kosong tetap aman, bukan melempar", () => {
  const detail = detailDariAnimeHianime({}, []);
  assert.equal(detail.title, "");
  assert.equal(detail.rating, 0);
  assert.deepEqual(detail.episodes, []);
  assert.equal(detail.totalEpisodes, 0);
});
