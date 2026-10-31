/* Test fallback unduhan Samehadaku dan mirror HiAnime.

   Semua fixture HTML lokal. Yang diuji adalah keputusan yang bisa merusak
   pengalaman menonton kalau salah:

   1. Samehadaku satu-satunya sumber unduhan. Animasu TIDAK dipakai sebagai
      cadangan karena tautan Drive/Pixeldrain-nya banyak yang sudah mati.
      Parsernya membaca .download-eps, bukan markup Animasu, dan host di
      luar Drive/Mega/MediaFire/Pixeldrain harus dibuang.
   2. Film Samehadaku tidak memakai "-episode-" di URL, jadi halaman unduhan
      episode/film dikumpulkan terpisah dari daftar episode.
   3. Mirror HiAnime hanya boleh dipakai kalau h1 halaman tujuan benar-benar
      cocok. Season 2 tidak boleh dipetakan ke Season 4 hanya karena kata
      "slime" sama.
   4. Tombol server HiAnime menyimpan iframe dalam base64; nilai rusak atau
      iframe TeraBox tidak boleh lolos. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const server = require("../server");

const {
  parseSamehadakuAnime,
  parseSamehadakuDownloads,
  fetchSamehadakuDownloads,
  kandidatSlugSamehadaku,
  kunciJudulSamehadaku,
  batchSamehadakuTersimpan,
  pilihBatchUnduhan,
  parseAnimasuEpisodeMeta,
  parseHianimeSearch,
  judulHianimeCocok,
  pilihKandidatHianime,
  parseHianimeEpisodeLinks,
  decodeHianimeServers,
  iframeHianimePertama,
  bukaHianimeEmbed,
  bukaSemuaHianimeEmbed,
  mergeMirrorStreams,
} = server;

const SH = "https://v2.samehadaku.how";
const SLUG_S4 = "tensei-shitara-slime-datta-ken-season-4";
const SLUG_MOVIE = "tensei-shitara-slime-datta-ken-movie-2-soukai-no-namida-hen";

const ANIME_S4_HTML = `
<html><body>
  <h1>Tensei shitara Slime Datta Ken Season 4</h1>
  <div class="anime-grid">
    <a href="/${SLUG_S4}-episode-24/" class="eps"><span>Eps 24</span></a>
    <a href="/${SLUG_S4}-episode-23/" class="eps"><span>Eps 23</span></a>
    <a href="/${SLUG_S4}-episode-24/" class="eps"><span>duplikat</span></a>
    <a href="/batch/${SLUG_S4}-batch-1/">Batch 1</a>
    <a href="/batch/${SLUG_S4}-batch-2/">Batch 2</a>
    <a href="/batch/one-piece-batch-1/">Batch anime lain</a>
  </div>
  <div class="sidebar">
    <a href="/anime/one-piece/">One Piece</a>
    <a href="/one-piece-episode-1000/">One Piece Episode 1000</a>
    <a href="https://contoh-lain.com/${SLUG_S4}-episode-99/">Situs lain</a>
  </div>
</body></html>`;

const ANIME_MOVIE_HTML = `
<html><body>
  <h1>Tensei shitara Slime Datta Ken Movie 2: Soukai no Namida-hen</h1>
  <div class="info">
    <a href="/${SLUG_MOVIE}-movie/">Download Movie</a>
    <a href="/${SLUG_MOVIE}-movie/">Download Movie (duplikat)</a>
    <a href="/tensura-movie-2/">Film lain</a>
    <a href="/anime/${SLUG_MOVIE}/">Informasi Anime</a>
  </div>
</body></html>`;

const DOWNLOAD_S4_HTML = `
<html><body>
  <h1>Download Tensei shitara Slime Datta Ken Season 4 Batch [ 1 - 24 ]</h1>
  <div class="download-eps">
    <p><b>MKV</b></p>
    <ul>
      <li>
        <strong>360p</strong>
        <div class="download-eps-links">
          <span><a href="https://gofile.io/d/O0VH2gia">Gofile</a></span>
          <span><a href="https://mir.cr/EF4E630F">Mirrored</a></span>
          <span><a href="https://pixeldrain.com/u/4h9Le6WB">Pixeldrain</a></span>
          <span><a href="https://www.mediafire.com/file/abc/tss-360p.rar/file">Mediafire</a></span>
          <span><a href="https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing">Google Drive</a></span>
        </div>
      </li>
      <li>
        <strong>480p</strong>
        <div class="download-eps-links">
          <span><a href="https://mega.nz/folder/AbCdEf#kunci">Mega</a></span>
          <span><a href="https://pixeldrain.com/u/4h9Le6WB">Pixeldrain (duplikat)</a></span>
          <span><a href="javascript:alert(1)">jahat</a></span>
          <span><a href="https://acefile.co/f/11947017/tss-480p">Acefile</a></span>
        </div>
      </li>
    </ul>
  </div>
  <div class="download-eps">
    <p><b>MP4</b></p>
    <ul>
      <li>
        <strong>720p</strong>
        <div class="download-eps-links">
          <span><a href="https://pixeldrain.com/u/AbCdEf12">Pixeldrain</a></span>
        </div>
      </li>
    </ul>
  </div>
</body></html>`;

const DOWNLOAD_MOVIE_HTML = `
<html><body>
  <h1>Download Tensei shitara Slime Datta Ken Movie 2: Soukai no Namida-hen</h1>
  <div class="download-eps">
    <p><b>MKV</b></p>
    <ul>
      <li>
        <strong>480p</strong>
        <div class="download-eps-links">
          <span><a href="https://pixeldrain.com/u/hmE1vUSo">Pixeldrain</a></span>
          <span><a href="https://www.mediafire.com/file/wccz/tensura-m2.rar/file">Mediafire (RAR)</a></span>
          <span><a href="https://krakenfiles.com/view/5DAN423Bph/file.html">Krakenfiles</a></span>
        </div>
      </li>
    </ul>
  </div>
</body></html>`;

const ANIMASU_EPISODE_HTML = `
<html><body>
  <h1>Nonton Tensei shitara Slime Datta Ken Season 4 Episode 24 Sub Indo</h1>
  <div class="info">
    <a href="https://animasu.love/anime/${SLUG_S4}/">Informasi Anime</a>
    <a href="https://animasu.love/anime/${SLUG_S4}/">Tensei shitara Slime Datta Ken Season 4</a>
  </div>
</body></html>`;

const ANIMASU_MOVIE_HTML = `
<html><body>
  <h1>Nonton Tensei shitara Slime Datta Ken Movie 2: Soukai no Namida-hen Sub Indo</h1>
  <a href="https://animasu.love/anime/${SLUG_MOVIE}/">Informasi Anime</a>
</body></html>`;

const HIANIME_SEARCH_HTML = `
<html><body>
  <div class="listupd">
    <div class="bsx"><a href="https://hianimetv.su/anime/that-time-i-got-reincarnated-as-a-slime-season-4/" title="That Time I Got Reincarnated as a Slime Season 4">Slime S4</a></div>
    <div class="bsx"><a href="https://hianimetv.su/anime/that-time-i-got-reincarnated-as-a-slime-season-2/" title="That Time I Got Reincarnated as a Slime Season 2">Slime S2</a></div>
    <div class="bsx"><a href="https://hianimetv.su/anime/that-time-i-got-reincarnated-as-a-slime-season-4/" title="That Time I Got Reincarnated as a Slime Season 4">Duplikat</a></div>
  </div>
  <div class="leftseries">
    <div class="bs"><a href="https://hianimetv.su/anime/one-piece/" title="One Piece">One Piece</a></div>
    <div class="bs"><a href="https://hianimetv.su/anime/naruto/" title="Naruto">Naruto</a></div>
  </div>
</body></html>`;

const HIANIME_SLUG_S4 = "that-time-i-got-reincarnated-as-a-slime-season-4";

const HIANIME_ANIME_HTML = `
<html><body>
  <h1>That Time I Got Reincarnated as a Slime Season 4</h1>
  <div class="episodes">
    <a href="/${HIANIME_SLUG_S4}-episode-24-english-subbed/">Episode 24</a>
    <a href="/${HIANIME_SLUG_S4}-episode-24-english-subbed/">Duplikat</a>
    <a href="/${HIANIME_SLUG_S4}-episode-23-english-subbed/">Episode 23</a>
    <a href="/${HIANIME_SLUG_S4}-batch/">Batch</a>
    <a href="/one-piece-episode-1000-english-subbed/">Anime lain</a>
  </div>
</body></html>`;

function base64Iframe(src) {
  return Buffer.from(`<iframe width="100%" height="100%" src="${src}" frameborder="0" allowfullscreen></iframe>`, "utf8").toString("base64");
}

const HIANIME_EPISODE_HTML = `
<html><body>
  <div class="server-buttons">
    <button class="server-button" onclick="loadMi({ value: '${base64Iframe("https://player.contoh.com/embed/slime-24")}' });">Fast</button>
    <button class="server-button" onclick="loadMi({ value: '${base64Iframe("https://www.terabox.com/s/abc123")}' });">TeraBox</button>
    <button class="server-button" onclick="loadMi({ value: '${Buffer.from("bukan iframe", "utf8").toString("base64")}' });">Rusak</button>
    <button class="server-button" onclick="loadMi({ value: '%%%bukan-base64%%%' });">Junk</button>
    <button class="server-button" onclick="loadMi({ value: '${base64Iframe("https://player.contoh.com/embed/slime-24")}' });">Duplikat</button>
    <button class="server-button">Tanpa onclick</button>
  </div>
</body></html>`;

test("Halaman anime Samehadaku: episode, batch, dan halaman unduhan dipisah", () => {
  const anime = parseSamehadakuAnime(ANIME_S4_HTML, `${SH}/anime/${SLUG_S4}/`, SH);
  assert.equal(anime.title, "Tensei shitara Slime Datta Ken Season 4");
  assert.equal(anime.episodes.length, 2, "episode duplikat harus dibuang");
  assert.deepEqual(anime.episodes.map((item) => item.slug), [`${SLUG_S4}-episode-24`, `${SLUG_S4}-episode-23`]);
  assert.deepEqual(anime.batchUrls, [
    `${SH}/batch/${SLUG_S4}-batch-1/`,
    `${SH}/batch/${SLUG_S4}-batch-2/`,
  ]);
  assert.deepEqual(anime.downloadPages.map((item) => item.url), [
    `${SH}/${SLUG_S4}-episode-24/`,
    `${SH}/${SLUG_S4}-episode-23/`,
  ]);
  assert.ok(!anime.batchUrls.some((url) => url.includes("one-piece")), "batch anime lain tidak boleh ikut");
  assert.ok(!anime.downloadPages.some((item) => item.url.includes("one-piece")), "episode anime lain tidak boleh ikut");
  assert.ok(!anime.downloadPages.some((item) => item.url.includes("contoh-lain")), "origin lain tidak boleh ikut");
});

test("Halaman film Samehadaku: tautan -movie/ masuk halaman unduhan", () => {
  const anime = parseSamehadakuAnime(ANIME_MOVIE_HTML, `${SH}/anime/${SLUG_MOVIE}/`, SH);
  assert.equal(anime.episodes.length, 0, "film tidak boleh dihitung sebagai episode");
  assert.deepEqual(anime.downloadPages.map((item) => item.url), [`${SH}/${SLUG_MOVIE}-movie/`]);
  assert.equal(anime.downloadPages[0].number, 1);
  assert.ok(!anime.downloadPages.some((item) => item.slug === "tensura-movie-2"), "film lain tidak boleh ikut");
});

test("Unduhan batch Samehadaku: format, kualitas, dan host dibaca", () => {
  const batches = parseSamehadakuDownloads(DOWNLOAD_S4_HTML, SH);
  assert.equal(batches.length, 2, "dua format menghasilkan dua batch");

  const mkv = batches[0];
  assert.match(mkv.title, /MKV$/);
  assert.equal(mkv.format, "MKV", "format dikirim terpisah untuk catatan kecil di UI");
  assert.equal(mkv.range, "1-24");
  assert.equal(mkv.source, "samehadaku");
  assert.deepEqual(mkv.mirrors.map((mirror) => mirror.quality), ["360p", "480p"]);

  const links360 = mkv.mirrors[0].links;
  assert.deepEqual(links360.map((link) => link.host), [
    "pixeldrain.com",
    "www.mediafire.com",
    "drive.google.com",
  ], "Gofile dan Mirrored harus dibuang");
  const drive = links360.find((link) => link.host === "drive.google.com");
  assert.match(drive.download, /^\/api\/download\?url=/);
  assert.equal(links360.find((link) => link.host === "pixeldrain.com").download, undefined);
  for (const link of links360) {
    assert.match(link.page, /^\/unduh\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, `${link.host} harus punya halaman perantara`);
  }

  const links480 = mkv.mirrors[1].links;
  assert.deepEqual(links480.map((link) => link.host), ["mega.nz", "pixeldrain.com"], "Acefile dan skema javascript dibuang");

  const mp4 = batches[1];
  assert.match(mp4.title, /MP4$/);
  assert.equal(mp4.format, "MP4");
  assert.equal(mp4.mirrors.length, 1);
  assert.deepEqual(mp4.mirrors[0].links.map((link) => link.url), ["https://pixeldrain.com/u/AbCdEf12"]);
});

test("Unduhan film Samehadaku: tanpa rentang episode, tetap satu batch", () => {
  const batches = parseSamehadakuDownloads(DOWNLOAD_MOVIE_HTML, SH);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].range, "");
  assert.match(batches[0].title, /Movie 2/);
  assert.deepEqual(batches[0].mirrors[0].links.map((link) => link.host), [
    "pixeldrain.com",
    "www.mediafire.com",
  ], "Krakenfiles harus dibuang");
});

test("Fallback unduhan dengan judul kosong tidak menyentuh jaringan", async () => {
  const hasil = await fetchSamehadakuDownloads("", "");
  assert.deepEqual(hasil, { batches: [], pageUrl: "" });
});

test("Pembungkus batch Samehadaku menyimpan array, bukan objek kosong", async () => {
  /* Array kosong penting: cached memperlakukannya sebagai data kosong dan
     mengizinkan percobaan lagi setelah 20 detik, bukan 30 menit. */
  const hasil = await batchSamehadakuTersimpan("", "");
  assert.deepEqual(hasil, []);
});

test("Slug Samehadaku dicoba langsung sebelum pencarian", () => {
  assert.deepEqual(kandidatSlugSamehadaku("Black Clover Season 2"), ["black-clover-season-2"]);
  assert.deepEqual(
    kandidatSlugSamehadaku("Jujutsu Kaisen", "Jujutsu Kaisen (TV)"),
    ["jujutsu-kaisen", "jujutsu-kaisen-tv"],
    "slug dasar dicoba lebih dulu, lalu bentuk lengkapnya",
  );
  assert.deepEqual(
    kandidatSlugSamehadaku("Jujutsu Kaisen (TV) Sub Indo", "Sorcery Fight"),
    ["jujutsu-kaisen", "jujutsu-kaisen-tv", "sorcery-fight"],
    "judul Animasu dengan (TV) Sub Indo tetap menghasilkan slug dasar",
  );
  assert.deepEqual(
    kandidatSlugSamehadaku("Anime Baru (2026)"),
    ["anime-baru", "anime-baru-2026"],
    "tahun dalam kurung dicoba setelah slug tanpa kurung",
  );
  assert.deepEqual(kandidatSlugSamehadaku(""), []);
});

test("h1 Samehadaku tanpa (TV) tetap cocok dengan judul Animasu", () => {
  const kunci = kunciJudulSamehadaku("Jujutsu Kaisen (TV) Sub Indo");
  assert.ok(kunci.includes("jujutsu kaisen"), "bentuk longgar harus ada");
  assert.ok(kunci.includes("jujutsu kaisen tv"), "bentuk penuh tetap dipertahankan");
  assert.deepEqual(kunciJudulSamehadaku(""), []);
});

const BATCH_SAMEHADAKU = [{
  range: "1-24",
  mirrors: [{ quality: "480p", links: [{ label: "Pixeldrain", url: "https://pixeldrain.com/u/abc", host: "pixeldrain.com" }] }],
}];
const BATCH_ANIMASU = [{
  range: "1-12",
  mirrors: [{ quality: "720p", links: [{ label: "Google Drive", url: "https://drive.google.com/x", host: "drive.google.com" }] }],
}];

test("Batch Animasu dan Samehadaku dikirim bersama dengan penanda sumber", () => {
  const hasil = pilihBatchUnduhan(BATCH_ANIMASU, BATCH_SAMEHADAKU);
  assert.equal(hasil.provider, "animasu+samehadaku");
  assert.equal(hasil.fallback, false);
  assert.deepEqual(hasil.batches.map((batch) => batch.source), ["animasu", "samehadaku"]);
  assert.equal(hasil.batches[0].mirrors[0].quality, "720p", "batch Animasu tetap utuh");
  assert.equal(hasil.batches[1].mirrors[0].quality, "480p", "batch Samehadaku tetap utuh");
});

test("Satu sumber tetap dikirim walau sumber lain kosong", () => {
  const masu = pilihBatchUnduhan(BATCH_ANIMASU, []);
  assert.equal(masu.provider, "animasu");
  assert.deepEqual(masu.batches.map((batch) => batch.source), ["animasu"]);
  const mega = pilihBatchUnduhan([], BATCH_SAMEHADAKU);
  assert.equal(mega.provider, "samehadaku");
  assert.deepEqual(mega.batches.map((batch) => batch.source), ["samehadaku"]);
});

test("Batch rusak diabaikan, batch sah tetap dikirim", () => {
  const hasil = pilihBatchUnduhan(BATCH_ANIMASU, [null, {}, { mirrors: [] }]);
  assert.equal(hasil.provider, "animasu");
  assert.equal(hasil.batches.length, 1);
  assert.equal(hasil.batches[0].source, "animasu");
  assert.deepEqual(pilihBatchUnduhan(undefined, null), { batches: [], provider: "", fallback: false });
});

test("Meta episode Animasu: judul, slug anime, dan nomor episode", () => {
  const meta = parseAnimasuEpisodeMeta(ANIMASU_EPISODE_HTML, `${SLUG_S4}-episode-24`);
  assert.equal(meta.animeSlug, SLUG_S4);
  assert.equal(meta.episodeNumber, 24);
  assert.equal(meta.title, "Tensei shitara Slime Datta Ken Season 4");

  const film = parseAnimasuEpisodeMeta(ANIMASU_MOVIE_HTML, SLUG_MOVIE);
  assert.equal(film.animeSlug, SLUG_MOVIE);
  assert.equal(film.episodeNumber, 1, "film tanpa nomor episode dianggap episode 1");
  assert.match(film.title, /Movie 2/);
});

test("Pencarian HiAnime hanya membaca kartu hasil, bukan sidebar", () => {
  const hasil = parseHianimeSearch(HIANIME_SEARCH_HTML);
  assert.deepEqual(hasil.map((item) => item.slug), [
    "that-time-i-got-reincarnated-as-a-slime-season-4",
    "that-time-i-got-reincarnated-as-a-slime-season-2",
  ]);
  assert.ok(!hasil.some((item) => item.slug === "one-piece"), "sidebar tidak boleh ikut");
});

test("h1 HiAnime harus cocok persis, soft-404 ditolak", () => {
  const wanted = ["that time i got reincarnated as a slime season 4"];
  assert.equal(judulHianimeCocok("That Time I Got Reincarnated as a Slime Season 4", wanted), true);
  assert.equal(judulHianimeCocok("  That Time I Got Reincarnated as a Slime Season 4  ", wanted), true);
  assert.equal(judulHianimeCocok("HiAnime - Watch your favourite anime online in Dub or Sub", wanted), false);
  assert.equal(judulHianimeCocok("That Time I Got Reincarnated as a Slime Season 2", wanted), false);
});

test("Pemilihan kandidat HiAnime menjaga season dan film", () => {
  const hasil = parseHianimeSearch(HIANIME_SEARCH_HTML);
  const s4 = pilihKandidatHianime(hasil, ["that time i got reincarnated as a slime season 4"]);
  assert.equal(s4.slug, "that-time-i-got-reincarnated-as-a-slime-season-4");

  const s2 = pilihKandidatHianime(hasil, ["that time i got reincarnated as a slime season 2"]);
  assert.equal(s2.slug, "that-time-i-got-reincarnated-as-a-slime-season-2");

  const s3 = pilihKandidatHianime(hasil, ["that time i got reincarnated as a slime season 3"]);
  assert.equal(s3, null, "season yang tidak ada tidak boleh dipetakan ke season lain");

  const film = pilihKandidatHianime(hasil, ["that time i got reincarnated as a slime the movie tears of the azure sea"]);
  assert.equal(film, null, "film tidak boleh dipetakan ke seri");
});

test("Daftar episode HiAnime: hanya milik anime yang sama, duplikat dibuang", () => {
  const daftar = parseHianimeEpisodeLinks(HIANIME_ANIME_HTML, "that-time-i-got-reincarnated-as-a-slime-season-4");
  assert.deepEqual(daftar.map((item) => item.number), [24, 23]);
  assert.equal(daftar[0].englishSubbed, true);
  assert.ok(!daftar.some((item) => item.slug.includes("one-piece")), "episode anime lain tidak boleh ikut");
  assert.ok(!daftar.some((item) => item.slug.endsWith("-batch")), "batch bukan episode");
});

test("Server HiAnime: base64 iframe di-decode, TeraBox dan nilai rusak dibuang", () => {
  const streams = decodeHianimeServers(HIANIME_EPISODE_HTML);
  assert.equal(streams.length, 1, "hanya satu URL unik yang lolos");
  assert.equal(streams[0].url, "https://player.contoh.com/embed/slime-24");
  assert.equal(streams[0].name, "Server Fast");
  assert.equal(streams[0].source, "hianimetv");
});

test("Merge mirror: Animasu di depan, duplikat dan URL tidak sah dibuang", () => {
  const hasil = mergeMirrorStreams(
    [
      { name: "Animasu A", url: "https://player.contoh.com/a", source: "animasu" },
      { name: "Animasu B", url: "https://player.contoh.com/b", source: "animasu" },
      { name: "Jahat", url: "javascript:alert(1)", source: "animasu" },
    ],
    [
      { name: "Server Fast", url: "https://player.contoh.com/a", source: "hianimetv" },
      { name: "Server Dua", url: "https://player.contoh.com/c", source: "hianimetv" },
      { name: "TeraBox", url: "https://terabox.com/s/abc", source: "hianimetv" },
    ],
  );
  assert.deepEqual(hasil.map((stream) => stream.url), [
    "https://player.contoh.com/a",
    "https://player.contoh.com/b",
    "https://player.contoh.com/c",
  ]);
  assert.equal(hasil[0].source, "animasu", "URL duplikat tetap milik Animasu");
  assert.equal(hasil[2].source, "hianimetv");
});

const WRAPPER_BASE = "https://hianimetv.su/wp-content/themes/animestream-child/player/?source=embed&url=x";

test("Wrapper HiAnime: iframe megaplay diambil, penolakan domain dan halaman kosong dibuang", () => {
  const halaman = `<!DOCTYPE html><html><body><div class="player-wrap">
    <iframe class="player-iframe" src="https://megaplay.su/embed.php?sid=ZGN1UDYyTEY2ZnQxV1RMUnZ2eTVXQT09" allowfullscreen></iframe>
  </div></body></html>`;
  assert.equal(iframeHianimePertama(halaman, WRAPPER_BASE), "https://megaplay.su/embed.php?sid=ZGN1UDYyTEY2ZnQxV1RMUnZ2eTVXQT09");
  assert.equal(iframeHianimePertama("Access denied. Your domain is not allowed.", WRAPPER_BASE), "", "penolakan domain bukan halaman player");
  assert.equal(iframeHianimePertama(`<html><body><div id="player"></div><script src="https://cdn.jwplayer.com/libraries/x.js"></script></body></html>`, WRAPPER_BASE), "", "blogger tanpa iframe tidak bisa diputar");
});

test("Wrapper HiAnime: src relatif diselesaikan, TeraBox dan wrapper bersarang ditolak", () => {
  assert.equal(
    iframeHianimePertama(`<iframe src="../embed.php?sid=abc"></iframe>`, WRAPPER_BASE),
    "https://hianimetv.su/wp-content/themes/animestream-child/embed.php?sid=abc",
  );
  assert.equal(iframeHianimePertama(`<iframe src="https://www.terabox.com/s/abc"></iframe>`, WRAPPER_BASE), "");
  assert.equal(
    iframeHianimePertama(`<iframe src="https://hianimetv.su/wp-content/themes/animestream-child/player/?source=embed&amp;url=y"></iframe>`, WRAPPER_BASE),
    "",
    "wrapper di dalam wrapper tidak akan pernah bisa diputar",
  );
});

test("Hanya wrapper hianimetv yang dibuka ulang; URL langsung dilewatkan", async () => {
  assert.equal(await bukaHianimeEmbed("https://megaplay.su/embed.php?sid=abc"), "https://megaplay.su/embed.php?sid=abc");
  assert.equal(await bukaHianimeEmbed("https://www.terabox.com/s/abc"), "");

  const hasil = await bukaSemuaHianimeEmbed([
    { name: "A", url: "https://megaplay.su/embed.php?sid=abc", source: "hianimetv" },
    { name: "B", url: "https://megaplay.su/embed.php?sid=abc", source: "hianimetv" },
    { name: "C", url: "javascript:alert(1)", source: "hianimetv" },
  ]);
  assert.deepEqual(hasil.map((stream) => stream.url), ["https://megaplay.su/embed.php?sid=abc"]);
});

test("Timeout mirror HiAnime menerima fungsi, bukan Promise yang sudah berjalan", () => {
  /* withTimeout menjalankan tugas lewat .then(task). Kalau yang dikirim
     Promise (bukan fungsi), .then mengabaikannya dan hasilnya undefined:
     mirror HiAnime hilang tanpa error, persis bug yang tertangkap saat uji
     live. Bentuk pemanggilan ini yang harus dipertahankan. */
  const sumber = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(sumber, /withTimeout\(\(\) => hianimeMirrorUntukEpisode\(meta\), 9000, "HiAnime"\)/);
  assert.doesNotMatch(sumber, /withTimeout\(hianimeMirrorUntukEpisode\(/);
});
