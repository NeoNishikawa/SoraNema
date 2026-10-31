const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const serverSource = read("server.js");
const appSource = read("public/js/reference-app.js");

const srv = require("../server");

const SH_PLAYER = `
  <div id="server"><ul>
    <li><div id="player-option-1" class="east_player_option player-server-btn on"
      data-post="54947" data-nume="1" data-type="schtml"
      data-embed="&lt;iframe src=&quot;https://filedon.co/embed/uqp4vUMsvq&quot; class=&quot;w-full&quot;&gt;&lt;/iframe&gt;">
      <span>VIP STREAMING</span></div></li>
    <li><div class="east_player_option"
      data-embed="&lt;iframe src=&quot;https://mega.nz/embed/FYhCyASB#kunci&quot;&gt;&lt;/iframe&gt;">
      <span>Mega 720p</span></div></li>
    <li><div class="east_player_option"
      data-embed="&lt;iframe src=&quot;https://mega.nz/embed/FYhCyASB#kunci&quot;&gt;&lt;/iframe&gt;">
      <span>Duplikat</span></div></li>
    <li><div class="east_player_option"
      data-embed="&lt;iframe src=&quot;https://www.facebook.com/plugins/like.php?href=x&quot;&gt;&lt;/iframe&gt;">
      <span>Mirror 8</span></div></li>
    <li><div class="east_player_option"
      data-embed="&lt;iframe src=&quot;https://www5.cbox.ws/box/?boxid=1&quot;&gt;&lt;/iframe&gt;">
      <span>Mirror 9</span></div></li>
  </ul></div>
  <div id="player-frame-wrapper"><iframe src="https://filedon.co/embed/uqp4vUMsvq"></iframe></div>
`;

test("Parser mirror Samehadaku membaca data-embed, label, dan membuang duplikat/junk", () => {
  const streams = srv.parseSamehadakuMirrors(SH_PLAYER);
  assert.deepEqual(streams.map((item) => item.name), ["VIP STREAMING", "Mega 720p"]);
  assert.equal(streams[0].url, "https://filedon.co/embed/uqp4vUMsvq");
  assert.equal(streams[1].url, "https://mega.nz/embed/FYhCyASB#kunci");
  assert.ok(streams.every((item) => item.source === "samehadaku"));
  assert.equal(streams.some((item) => /facebook|cbox/.test(item.url)), false, "plugin like dan kotak obrolan bukan mirror");
});

test("Parser mirror Samehadaku punya cadangan #pembed untuk tema lama", () => {
  const streams = srv.parseSamehadakuMirrors('<div id="pembed"><iframe src="https://filedon.co/embed/lama"></iframe></div>');
  assert.deepEqual(streams, [{ name: "Samehadaku", url: "https://filedon.co/embed/lama", source: "samehadaku" }]);
  assert.deepEqual(srv.parseSamehadakuMirrors("<p>tanpa player</p>"), []);
  assert.deepEqual(srv.parseSamehadakuMirrors(""), []);
});

test("Nomor episode dibaca dari slug, termasuk episode desimal", () => {
  assert.equal(srv.nomorEpisodeDariSlug("tank-chair-episode-12"), 12);
  assert.equal(srv.nomorEpisodeDariSlug("judul-episode-1-5"), 1.5);
  assert.equal(srv.nomorEpisodeDariSlug("judul-tanpa-nomor"), 0);
  assert.equal(srv.nomorEpisodeDariSlug(""), 0);
});

test("metaEpisodeDariSlug menjadi judul cadangan saat halaman Animasu gagal diparse", () => {
  assert.deepEqual(srv.metaEpisodeDariSlug("nonton-tank-chair-episode-3"), {
    title: "Tank Chair",
    synonym: "",
    animeSlug: "",
    episodeNumber: 3,
  });
  assert.equal(srv.metaEpisodeDariSlug("nonton-film-movie").episodeNumber, 1);
});

test("Mirror Samehadaku dan HiAnime berjalan paralel dengan label sumber", () => {
  assert.match(serverSource, /withTimeout\(\(\) => hianimeMirrorUntukEpisode\(meta\), 9000, "HiAnime"\)/);
  assert.match(serverSource, /withTimeout\(\(\) => samehadakuMirrorUntukEpisode\(meta\), 9000, "Samehadaku"\)/);
  assert.match(serverSource, /Promise\.all\(\[/);
  assert.match(serverSource, /labelMergedMirrors\(merged\)/, "label dipasang setelah merge supaya nomor server rapat");
  assert.match(serverSource, /mergeMirrorStreams\(collected, samehadakuStreams, hianimeStreams\)/);
  /* HiAnime tetap dicoba walau halaman Animasu tidak memberi animeSlug. */
  assert.match(serverSource, /if \(!meta\?\.animeSlug && !teksAman\(meta\?\.title\)\.trim\(\)\) return \[\];/);
});

test("Nama mirror tidak membocorkan sumber scrape", () => {
  /* Nomor di depan resolusi adalah nomor server sumber itu: 2|48p berarti
     server 2 dengan 480p yang dipendekkan jadi 48p. */
  const samehadaku = srv.labelMirror([
    { name: "VIP STREAMING", url: "https://a.test/1" },
    { name: "Mega 480p", url: "https://a.test/2" },
    { name: "Mega 1080p", url: "https://a.test/3" },
  ], "samehadaku").map((s) => s.name);
  assert.deepEqual(samehadaku, ["Server VIP 1", "MegaServer 248p", "MegaServer 310p"]);

  assert.deepEqual(
    srv.labelMirror([{ name: "Server EMBED", url: "https://a.test/4" }, { name: "Server 2", url: "https://a.test/5" }], "hianime").map((s) => s.name),
    ["AnimeServer1", "AnimeServer2"],
  );

  const animasu = srv.labelMirror([
    { name: "Mirror 1", url: "https://a.test/6" },
    { name: "720p [1]", url: "https://a.test/7" },
    { name: "720p [2]", url: "https://a.test/8" },
    { name: "1080p [1]", url: "https://a.test/9" },
  ], "animasu").map((s) => s.name);
  assert.deepEqual(animasu, ["MasuServer1", "MasuServer72p", "MasuServer72p(2)", "MasuServer10p"]);

  /* Label apa pun tidak boleh lagi menyebut nama sumbernya. */
  for (const nama of [...samehadaku, ...animasu, "AnimeServer1"]) {
    assert.doesNotMatch(nama, /samehadaku|hianime|animasu/i);
  }
});

test("Nomor server dihitung setelah mirror duplikat dibuang", () => {
  const merged = srv.mergeMirrorStreams(
    [{ name: "Mirror 1", url: "https://blogger.test/x", source: "animasu" }],
    [
      { name: "Blogspot", url: "https://blogger.test/x", source: "samehadaku" },
      { name: "VIP STREAMING", url: "https://filedon.test/1", source: "samehadaku" },
      { name: "Mega 480p", url: "https://mega.test/2", source: "samehadaku" },
      { name: "Mega 1080p", url: "https://mega.test/3", source: "samehadaku" },
    ],
    [{ name: "Server EMBED", url: "https://megaplay.test/4", source: "hianimetv" }],
  );
  assert.deepEqual(srv.labelMergedMirrors(merged).map((s) => s.name), [
    "MasuServer1",
    "Server VIP 1",
    "MegaServer 248p",
    "MegaServer 310p",
    "AnimeServer1",
  ]);
});

test("Batas upstream dihitung per host, bukan satu slot untuk semua sumber", () => {
  /* Dengan satu slot global, tiga request berurutan HiAnime selalu kalah
     dari timeout 9 detik karena mengantre di belakang Animasu/Samehadaku. */
  assert.match(serverSource, /upstreamActiveByLaneOrigin\.get\(laneOriginKey\(request\.lane, request\.origin\)\)/);
  assert.match(serverSource, /const activeKey = laneOriginKey\(request\.lane, origin\);/);
  assert.doesNotMatch(serverSource, /const active = upstreamActiveByLane\.get\(request\.lane\)/);
});

test("Samehadaku dicoba lewat URL episode langsung sebelum halaman anime", () => {
  assert.match(serverSource, /const slug = kandidatSlugSamehadaku\(judul\)\[0\];/);
  assert.match(serverSource, /`\/\$\{slug\}-episode-\$\{nomor\}\/`/);
  assert.match(serverSource, /samehadaku:mirror:\$\{kunci\}:\$\{nomor\}/);
});

test("Klien menyaring mirror mati dengan indeks asli dan menyediakan tombol tandai", () => {
  assert.match(appSource, /import \{ tautanMati, tautanHidup, kunciUnduhan, kunciMirror, kunciLaporan, gabungLaporan, idPelapor, saringMirror, sidikTautan \} from "\.\/tautan-mati\.js";/);
  assert.match(appSource, /saringMirror\(state\.mirrors, urlMatiMirror\(slugMirrorAktif\(\)\), state\.tampilMatiMirror\)/);
  assert.match(appSource, /data-mirror-mati="\$\{i\}"/);
  assert.match(appSource, /data-mirror-hidup="\$\{i\}"/);
  assert.match(appSource, /data-mirror-tampil-mati/);
  assert.match(appSource, /tautanMati\.tandai\(kunciMirror\(slug, mirror\.url\)/);
  assert.match(appSource, /laporkanMati\("mirror", hash, slug\)/, "menandai mirror harus ikut dilaporkan ke server");
  assert.match(appSource, /muatLaporanPublik\(slug\)/, "laporan pengguna lain diambil saat episode diputar");
  assert.match(appSource, /loadMirror\(pengganti\.index, "left"\)/, "mirror rusak yang sedang diputar harus pindah ke mirror lain");
});

test("Blok unduhan memakai penanda mati yang sama", () => {
  assert.match(appSource, /renderDownloadBatches\(a\.batches, a, \{ mati: urlMatiUnduhan\(\), tampilMati: state\.tampilMati \}\)/);
  assert.match(appSource, /data-dl-tampil-mati="global"/);
  assert.match(appSource, /tautanMati\.tandai\(kunciUnduhan\(identitas\)/);
  assert.match(appSource, /laporkanMati\("unduhan", identitas\)/, "menandai tautan unduhan harus ikut dilaporkan ke server");
  /* Identitas tautan harus hash URL, bukan path /unduh/<token>: token
     kedaluwarsa sehingga path-nya berganti dan tanda mati hilang. */
  assert.match(appSource, /const identitas = sidikTautan\(href\);/);
  assert.doesNotMatch(appSource, /const identitas = halaman \|\| resolver \|\| href;/);
});
