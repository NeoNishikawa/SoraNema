const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { parseAnimeDetail, ambilRentangEpisode } = require(path.join(ROOT, "server.js"));

/* Hash identitas tautan yang SAMA dengan yang dipakai renderer. Kalau tes
   memakai stub sendiri, ia tidak membuktikan renderer memakai identitas
   stabil - hanya membuktikan stub cocok dengan stub. */
let sidikTautan = (nilai) => String(nilai ?? "");
test.before(async () => {
  const source = fs.readFileSync(path.join(ROOT, "public/js/tautan-mati.js"), "utf8");
  const modul = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  sidikTautan = modul.sidikTautan;
});

/* Markup batch unduhan di halaman detail source. Disalin apa adanya dari
   bentuk yang benar-benar muncul: .bixbox > .mctnx > .soraddlx (satu per
   batch) > .sorattlx h3 + .soraurlx (satu per resolusi). */
const DETAIL_HTML = `
<html><body>
  <div class="infox">
    <h1 itemprop="headline">Tensei shitara Slime Datta Ken</h1>
    <div class="spe"><span>Status: Ongoing</span><span>Episode: 24</span></div>
  </div>
  <div class="bixbox">
    <div class="releases"><h3>Download Tensei shitara Slime Datta Ken</h3></div>
    <div class="mctnx">
      <div class="soraddlx soradlg">
        <div class="sorattlx"><h3>Download Tensei shitara Slime Datta Ken Batch [ 1 - 12]</h3></div>
        <div class="soraurlx"><strong>480p</strong>
          <a href="https://drive.usercontent.google.com/download?id=1Co9Co4">Google Drive</a>
          <a href="https://hxfile.co/2izclhpgxgdt">Hxfileco</a>
          <a href="https://acefile.co/f/11947017/kusonime-001-012-bd-480p-rar">acefile</a>
        </div>
        <div class="soraurlx"><strong>720p</strong>
          <a href="https://drive.google.com/uc?export=download&amp;id=1Kg2MPKc">Google Drive</a>
          <a href="https://mediafire.com/file/abc/xyz">MediaFire</a>
          <a href="https://pixeldrain.com/u/AbCdEf">Pixeldrain</a>
        </div>
      </div>
      <div class="soraddlx soradlg">
        <div class="sorattlx"><h3>Download Tensei shitara Slime Datta Ken Batch [ 12 - 24 ]</h3></div>
        <div class="soraurlx"><strong>1080p</strong>
          <a href="https://mega.nz/folder/AbCdEf#key123">Mega</a>
          <a href="javascript:alert(1)">jahat</a>
          <a href="data:text/html,<b>x">jahat juga</a>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

const TANPA_BATCH = `
<html><body>
  <div class="infox"><h1 itemprop="headline">Black Clover Season 2</h1></div>
  <div class="ep-list"><ul><li><a href="/black-clover-season-2-episode-1/">Episode 1</a></li></ul></div>
</body></html>`;

test("Batch unduhan terbaca: judul, rentang episode, dan kualitas per batch", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  assert.equal(detail.batches.length, 2, "dua batch harus terbaca");
  assert.equal(detail.batches[0].range, "1-12");
  assert.equal(detail.batches[1].range, "12-24");
  assert.match(detail.batches[0].title, /Batch \[ 1 - 12\]/);
  assert.deepEqual(detail.batches[0].mirrors.map((mirror) => mirror.quality), ["480p", "720p"]);
  assert.deepEqual(detail.batches[1].mirrors.map((mirror) => mirror.quality), ["1080p"]);
});

test("Hanya Google Drive, Mega, MediaFire, dan Pixeldrain yang ditampilkan", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  const semua = detail.batches.flatMap((batch) => batch.mirrors.flatMap((mirror) => mirror.links));
  const hosts = [...new Set(semua.map((link) => link.host))].sort();
  assert.deepEqual(hosts, ["drive.google.com", "drive.usercontent.google.com", "mediafire.com", "mega.nz", "pixeldrain.com"]);
  /* Host yang tidak diizinkan harus hilang total, bukan disembunyikan. */
  for (const link of semua) {
    assert.ok(!/hxfile|acefile|gofile/i.test(link.host), `host tak diizinkan lolos: ${link.host}`);
  }
});

test("Setiap tautan membawa label dan host aslinya", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  const drive = detail.batches[0].mirrors[0].links[0];
  assert.equal(drive.label, "Google Drive");
  assert.equal(drive.host, "drive.usercontent.google.com");
  assert.match(drive.url, /^https:\/\/drive\.usercontent\.google\.com\//);
  const mega = detail.batches[1].mirrors[0].links[0];
  assert.equal(mega.label, "Mega");
  assert.equal(mega.host, "mega.nz");
});

test("Semua tautan memakai halaman perantara, bukan URL host langsung", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  const semua = detail.batches.flatMap((batch) => batch.mirrors.flatMap((mirror) => mirror.links));
  assert.equal(semua.length, 5, "lima tautan dari empat host");
  for (const link of semua) {
    assert.match(link.page, /^\/unduh\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, `${link.host} harus punya halaman perantara`);
    assert.ok(!link.page.includes(link.host), `href ${link.host} tidak boleh memuat host sumber`);
  }
});

test("Hanya Drive yang membawa path resolver same-tab; Pixeldrain dan host lain link-out", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  const semua = detail.batches.flatMap((batch) => batch.mirrors.flatMap((mirror) => mirror.links));
  for (const host of ["drive.google.com", "drive.usercontent.google.com"]) {
    const link = semua.find((item) => item.host === host);
    assert.ok(link, `tautan ${host} harus ada`);
    assert.match(link.download, /^\/api\/download\?url=/, `${host} harus punya resolver`);
    assert.equal(new URL(link.download, "http://localhost").searchParams.get("url"), link.url);
  }
  /* Pixeldrain menolak hotlink lintas situs dengan 403 JSON; jangan pernah
     memberi pengguna path yang mendarat di JSON itu. */
  for (const host of ["pixeldrain.com", "mediafire.com", "mega.nz"]) {
    const link = semua.find((item) => item.host === host);
    assert.ok(link, `tautan ${host} harus ada`);
    assert.equal(link.download, undefined, `${host} harus tetap link-out`);
  }
});

test("Skema non-http ditolak: hanya tautan yang bisa dibuka browser yang lolos", () => {
  const detail = parseAnimeDetail(DETAIL_HTML, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  const tautan = detail.batches[1].mirrors[0].links;
  assert.equal(tautan.length, 1, "hanya Mega yang boleh");
  assert.equal(tautan[0].host, "mega.nz");
  assert.ok(!tautan.some((link) => /javascript:|data:/i.test(link.url)));
});

test("Baris tanpa host yang diizinkan tidak membuat batch kosong", () => {
  /* Kalau satu baris kualitas kehilangan semua tautannya, baris itu
     hilang; kalau semua baris hilang, batch-nya hilang juga - bukan
     muncul sebagai kotak kosong. */
  const tanpaMega = DETAIL_HTML.replace(/<a href="https:\/\/mega\.nz[^"]*">Mega<\/a>/, "");
  const detail = parseAnimeDetail(tanpaMega, "tensei-shitara-slime-datta-ken", "https://animasu.love");
  assert.equal(detail.batches.length, 1, "batch kedua hilang karena tidak ada tautan yang boleh");
});

test("Halaman tanpa blok unduhan menjawab kosong, tidak melempar", () => {
  const detail = parseAnimeDetail(TANPA_BATCH, "black-clover-season-2", "https://animasu.love");
  assert.deepEqual(detail.batches, []);
  assert.equal(detail.title, "Black Clover Season 2");
});

/* Renderer-nya ada di reference-app.js, yang tidak diekspor ke modul lain.
  Jadi funksinya diekstrak dari sumber dan dijalankan di sandbox dengan
   stub esc - supaya yang diuji perilakunya, bukan hanya teksnya. */
function ambilRenderer() {
  const source = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  const awal = source.indexOf("function renderDownloadBatches(");
  assert.notEqual(awal, -1, "renderDownloadBatches harus ada di reference-app.js");
  const akhir = source.indexOf("\nfunction ", awal + 10);
  const kode = source.slice(awal, akhir === -1 ? source.length : akhir);
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  return new Function("esc", "sidikTautan", `${kode}; return renderDownloadBatches;`)(esc, sidikTautan);
}

test("Renderer client membuat tiga tingkat: resolusi, sumber, lalu tautan", () => {
  const render = ambilRenderer();
  const html = render([
    {
      title: "Download Slime Batch [ 1 - 12]",
      range: "1 - 12",
      source: "animasu",
      mirrors: [
        { quality: "480p", links: [{ label: "Google Drive", url: "https://drive.google.com/x", host: "drive.google.com" }] },
        { quality: "720p", links: [{ label: "MediaFire", url: "https://mediafire.com/y", host: "mediafire.com" }] },
      ],
    },
  ]);
  /* Tingkat 1: pemicu + daftar resolusi. */
  assert.match(html, /class="dl-trigger"/);
  assert.match(html, /data-dl-options/);
  assert.match(html, /data-dl-option="480p"/);
  assert.match(html, /data-dl-option="720p"/);
  /* Tingkat 2: sumber muncul setelah resolusi dipilih. */
  assert.match(html, /data-dl-source="animasu"/);
  assert.match(html, />Masu</);
  /* Tingkat 3: panel tautan, semua tersembunyi sampai dipilih. */
  assert.match(html, /class="dl-sub"[^>]*data-dl-sub hidden/);
  assert.match(html, /data-dl-source-links hidden/);
  assert.match(html, /href="https:\/\/drive\.google\.com\/x"/);
  assert.match(html, /href="https:\/\/mediafire\.com\/y"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /host pihak ketiga/);
  assert.match(html, /Episode 1-12/);
  assert.match(html, /class="dl-head"[^>]*id="watchDownloadsTitle"/);
  assert.match(html, /Download Batch/);
  assert.match(html, /1 batch · 2 tautan/);
  /* Judul anime TIDAK lagi ditampilkan - kartu cuma bawa rentang episode. */
  assert.doesNotMatch(html, /dl-title/);
  assert.doesNotMatch(html, /Batch \[/);
  assert.doesNotMatch(html, /Slime/);
  assert.match(html, /<h4><span class="dl-range"[^>]*>Episode 1-12<\/span><\/h4>/);
});

test("Renderer menggabungkan rentang dan menawarkan Masu + Mega pada resolusi yang sama", () => {
  const render = ambilRenderer();
  const html = render([
    {
      source: "animasu",
      range: "1-12",
      mirrors: [{ quality: "720p", links: [{ label: "Google Drive", url: "https://drive.google.com/a" }] }],
    },
    {
      source: "animasu",
      range: "13-24",
      mirrors: [{ quality: "720P", links: [{ label: "Google Drive", url: "https://drive.google.com/b" }] }],
    },
    {
      source: "samehadaku",
      range: "1-24",
      format: "MKV",
      mirrors: [{ quality: "720p", links: [{ label: "Mega", url: "https://mega.nz/a" }] }],
    },
  ]);
  /* 1-12 dan 13-24 dari Masu digabung dengan 1-24 dari Mega. */
  assert.equal((html.match(/class="dl-batch"/g) || []).length, 1, "rentang bersambung harus jadi satu kartu");
  assert.match(html, /Episode 1-24/);
  /* Satu resolusi 720p, dua sumber. "720P" dinormalisasi jadi "720p". */
  assert.equal((html.match(/data-dl-option=/g) || []).length, 1, "kapitalisasi resolusi tidak boleh memecah pilihan");
  assert.match(html, /data-dl-option="720p"[^>]*><span>720p<\/span><small>Masu · Mega · 3 tautan<\/small>/);
  assert.match(html, /data-dl-source="animasu"/);
  assert.match(html, /data-dl-source="samehadaku"/);
  assert.match(html, />Masu</);
  assert.match(html, />Mega</);
  /* Tautan tetap tersembunyi sampai sumber dipilih. */
  assert.match(html, /data-dl-source-links hidden/);
  /* Masu punya dua rentang, Mega punya format. Keduanya jadi catatan kecil. */
  assert.match(html, /Episode 1-12/);
  assert.match(html, /Episode 13-24/);
  assert.match(html, /MKV/);
});

test("Renderer memakai resolver same-tab untuk tautan yang punya download", () => {
  const render = ambilRenderer();
  const resolver = "/api/download?url=https%3A%2F%2Fdrive.google.com%2Ffile%2Fd%2FAbCdEf123456%2Fview";
  const html = render([
    {
      range: "1-12",
      mirrors: [
        {
          quality: "480p",
          links: [
            { label: "Google Drive", url: "https://drive.google.com/file/d/AbCdEf123456/view", download: resolver },
            { label: "MediaFire", url: "https://mediafire.com/y" },
          ],
        },
      ],
    },
  ]);
  assert.ok(
    html.includes(`<a class="dl-link" href="${resolver}" rel="nofollow" referrerpolicy="no-referrer">Google Drive</a>`),
    "Drive harus memakai resolver same-tab tanpa target",
  );
  assert.doesNotMatch(html, /<a[^>]+href="\/api\/download[^>]*target="_blank"/);
  assert.match(html, /<a class="dl-link" href="https:\/\/mediafire\.com\/y" target="_blank" rel="noopener noreferrer nofollow">MediaFire<\/a>/);
});

test("Renderer memakai halaman /unduh same-tab kalau tautan punya page", () => {
  const render = ambilRenderer();
  const halaman = "/unduh/abc.def";
  const html = render([
    {
      range: "1-12",
      mirrors: [
        {
          quality: "720p",
          links: [{ label: "Pixeldrain", url: "https://pixeldrain.com/u/AbCdEf", page: halaman }],
        },
      ],
    },
  ]);
  assert.ok(
    html.includes(`<a class="dl-link" href="${halaman}" data-dl-page="${halaman}" rel="nofollow" referrerpolicy="no-referrer">Pixeldrain</a>`),
    "page harus dipakai same-tab tanpa target dan membawa penanda pop-up",
  );
  assert.doesNotMatch(html, /pixeldrain\.com\/u\/AbCdEf/);
});

test("Renderer menolak skema berbahaya dan tidak memunculkan blok kosong", () => {
  const render = ambilRenderer();
  const html = render([{ title: "X", range: "", mirrors: [{ quality: "480p", links: [{ label: "jahat", url: "javascript:alert(1)" }] }] }]);
  assert.equal(html, "", "blok tanpa tautan sah harus kosong, bukan setengah jadi");
  assert.equal(render([]), "");
  assert.equal(render(undefined), "");
});

test("Wadah DOM ada di index.html dan unduhan dirender lewat renderUnduhan", () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const referenceApp = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  assert.match(indexHtml, /id="watchDownloads" aria-label="Download batch"/);
  assert.match(referenceApp, /function renderUnduhan\(a = state\.detail\)/);
  assert.match(referenceApp, /renderUnduhan\(a\)/);
  /* Selama Samehadaku diambil, blok menampilkan status. Kalau tidak ada
     batch, tampil pesan "belum ada unduhan" - bukan tautan Animasu. */
  assert.match(referenceApp, /if \(a\?\.downloadPending\) box\.innerHTML = renderDownloadPending\(\)/);
  assert.match(referenceApp, /function renderDownloadEmpty\(/);
  assert.doesNotMatch(referenceApp, /cadangan dari Animasu/);
});

test("Klik tautan unduhan membuka pop-up di aplikasi, bukan halaman baru", () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const referenceApp = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  assert.match(indexHtml, /id="dlPopupRoot"/);
  assert.match(referenceApp, /function bukaPopupUnduhan\(/);
  assert.match(referenceApp, /function tutupPopupUnduhan\(/);
  assert.match(referenceApp, /a\.dl-link\[data-dl-page\]/,
    "hanya tautan halaman yang dicegat, bukan tautan host lama");
  assert.match(referenceApp, /fetch\(`\$\{halaman\}\?format=json`/,
    "pop-up membaca data dari server, bukan menyusun host sendiri");
  assert.match(referenceApp, /event\.ctrlKey/,
    "Ctrl+klik harus tetap membuka halaman cadangan");
  assert.match(referenceApp, /class="dl-pop-btn dl-pop-btn-primary"/);
});

test("Unduhan dua sumber dimuat setelah detail tampil, bukan di route detail", () => {
  const referenceApp = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(ROOT, "public/js/api.js"), "utf8");
  assert.match(apiSource, /downloads: \(slug\) => request\(`\/api\/anime\/\$\{encodeURIComponent\(slug\)\}\/downloads`\)/);
  assert.match(referenceApp, /await api\.downloads\(slug\)/);
  assert.match(referenceApp, /muatUnduhan\(state\.detail\.slug\)/);
  assert.match(referenceApp, /detail\.downloadPending = false/);
  /* Respons telat tidak boleh menimpa detail anime lain. */
  assert.match(referenceApp, /if \(state\.detail !== detail\) return/);
  /* Route detail tidak boleh menunggu Samehadaku dan tidak boleh membawa
     batch Animasu sama sekali. */
  const awalDetail = serverSource.indexOf('app.get("/api/anime/:slug"');
  const awalUnduhan = serverSource.indexOf('app.get("/api/anime/:slug/downloads"');
  assert.notEqual(awalDetail, -1);
  assert.notEqual(awalUnduhan, -1);
  const routeDetail = serverSource.slice(awalDetail, awalUnduhan);
  assert.doesNotMatch(routeDetail, /fetchSamehadakuDownloads|batchSamehadakuTersimpan/);
  assert.match(routeDetail, /batches: \[\]/);
  assert.doesNotMatch(routeDetail, /downloadProvider = detail\.batches\.length/);
  const routeUnduhan = serverSource.slice(awalUnduhan);
  assert.match(routeUnduhan, /batchSamehadakuTersimpan\(detail\.title, detail\.synonym\)/);
  assert.match(routeUnduhan, /pilihBatchUnduhan\(batchesAnimasu, batchesSamehadaku\)/);
  assert.match(routeUnduhan, /if \(!hasil\.batches\.length \|\| hasil\.pending\) memory\.delete\(key\)/);
  assert.match(routeUnduhan, /pending: Boolean\(hasil\.pending\)/);
});

test("Tombol Download di header detail hanya muncul kalau ada batch", () => {
  const referenceApp = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  const awal = referenceApp.indexOf("${(a.batches || []).length ?");
  assert.notEqual(awal, -1, "tombol harus dibungkus conditional batches");
  const potongan = referenceApp.slice(awal, awal + 260);
  assert.match(potongan, /data-detail-download/);
  assert.match(referenceApp, /blok\.closest\("\.watch-grid"\), blok\.closest\("\.watch-left"\)/);
  assert.match(referenceApp, /scroller\.scrollTop \+= blok\.getBoundingClientRect\(\)\.top - scroller\.getBoundingClientRect\(\)\.top/);
  assert.match(referenceApp, /blok\.querySelector\("\[data-dl-toggle\]"\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test("Daftar episode di kolom kanan, susunannya turun", () => {
  const components = fs.readFileSync(path.join(ROOT, "public/css/components.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  /* Kolom kanan dibuat lewat grid-area di dalam .watch-left, jadi di HP
     sempit (bawah 1024) daftar episode tetap di bawah iframe. */
  assert.match(components, /@media \(min-width:1024px\)\{[\s\S]{0,2000}?grid-template-areas:[\s\S]{0,200}?"player eps"[\s\S]{0,400}?"detail eps"/);
  assert.match(components, /\.ep-panel\{grid-area:eps/);
  /* Di dalam kolom kanan daftarnya TURUN - satu per baris, bukan papan
     tombol mendatar (percobaan 21 Oktober yang dikoreksi). */
  assert.match(components, /\.ep-list\{\s*display:flex;flex-direction:column/);
  assert.doesNotMatch(components, /\.ep-list\{display:grid/);
  assert.match(indexHtml, /<div class="ep-panel">[\s\S]{0,200}?id="episodeList"/);
});

test("Gaya dropdown unduhan dua tingkat ada", () => {
  const components = fs.readFileSync(path.join(ROOT, "public/css/components.css"), "utf8");
  assert.match(components, /\.dl-trigger\{/);
  assert.match(components, /\.dl-options\{/);
  assert.match(components, /\.dl-sub\{/);
  assert.match(components, /\.dl-picker\.open \.dl-trigger/);
});

test("Tampilan unduhan jadi grid dua kolom dengan badge ringkas", () => {
  const components = fs.readFileSync(path.join(ROOT, "public/css/components.css"), "utf8");
  /* Dua kartu batch berdampingan, bukan menumpuk. */
  assert.match(components, /\.dl-block\{\s*[^}]*display:grid;\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  /* Di bawah 640px turun ke satu kolom. */
  assert.match(components, /@media \(max-width:640px\)\{\s*\.dl-block\{\s*grid-template-columns:minmax\(0,1fr\)/);
  /* Catatan melebar penuh, bukan ikut jadi kolom. */
  assert.match(components, /\.dl-note\{\s*grid-column:1\/-1/);
  /* Badge ringkas, bukan huruf besar dengan spasi. */
  assert.match(components, /\.dl-range\{[^}]*text-transform:none/);
  assert.doesNotMatch(components, /\.dl-range\{[^}]*text-transform:uppercase/);
});

test("Dropdown unduhan punya handler di reference-app.js", () => {
  const referenceApp = fs.readFileSync(path.join(ROOT, "public/js/reference-app.js"), "utf8");
  assert.match(referenceApp, /data-dl-toggle/);
  assert.match(referenceApp, /data-dl-option/);
  assert.match(referenceApp, /data-dl-sub/);
  /* Drive bisa menampilkan kuota; catatan harus mengarahkan ke mirror lain,
     bukan menjanjikan resolver selalu berhasil. */
  assert.match(referenceApp, /href="\/bantuan\/pixeldrain\/"/);
  assert.match(referenceApp, /Kenapa Pixeldrain menolak unduhan langsung\?/);
  assert.match(referenceApp, /Kalau Drive menampilkan kuota, <a href="\/bantuan\/kuota-drive\/"/);
  assert.match(referenceApp, /lihat panduan memilih mirror/);
});


/* ---------- Rentang episode dari berbagai bentuk judul batch ----------
   Bentuk judul di source bervariasi. Dulu hanya kurung siku yang dikenali,
   jadi banyak anime (Boruto, Jujutsu Kaisen) menampilkan kartu "Download"
   polos - pengguna tak tahu episode berapa yang akan diunduh. */

const JUDUL_BERBENTUK = `
<html><body>
  <div class="infox"><h1 itemprop="headline">Boruto</h1></div>
  <div class="bixbox"><div class="mctnx">
    <div class="soraddlx">
      <div class="sorattlx"><h3>Download Boruto: Naruto Next Generations Batch Subtitle Indonesia Episode 001-025</h3></div>
      <div class="soraurlx"><strong>480p</strong><a href="https://drive.usercontent.google.com/download?id=1Co9Co4">Google Drive</a></div>
    </div>
    <div class="soraddlx">
      <div class="sorattlx"><h3>Download Jujutsu Kaisen Episode 01-12 BD Batch Subtitle Indonesia</h3></div>
      <div class="soraurlx"><strong>720p</strong><a href="https://drive.usercontent.google.com/download?id=2Kd9Ko5">Google Drive</a></div>
    </div>
    <div class="soraddlx">
      <div class="sorattlx"><h3>Download Anime Subtitle Indonesia 2019-2020</h3></div>
      <div class="soraurlx"><strong>1080p</strong><a href="https://drive.usercontent.google.com/download?id=3Lf0Lp6">Google Drive</a></div>
    </div>
  </div></div>
</body></html>`;

const LABEL_BARIS_RENTANG = `
<html><body>
  <div class="infox"><h1 itemprop="headline">Naruto</h1></div>
  <div class="bixbox"><div class="mctnx">
    <div class="soraddlx">
      <div class="sorattlx"><h3>Download Naruto Batch Subtitle Indonesia</h3></div>
      <div class="soraurlx"><strong>01-25</strong><a href="https://drive.usercontent.google.com/download?id=1Co9Co4">Google Drive</a></div>
      <div class="soraurlx"><strong>051-100</strong><a href="https://drive.usercontent.google.com/download?id=2Kd9Ko5">Google Drive</a></div>
    </div>
  </div></div>
</body></html>`;

test("Rentang episode terbaca dari judul tanpa kurung siku", () => {
  const detail = parseAnimeDetail(JUDUL_BERBENTUK, "boruto", "https://animasu.love");
  assert.equal(detail.batches[0].range, "1-25");
  assert.equal(detail.batches[1].range, "1-12");
});

test("Tahun rilis tidak salah tangkap sebagai rentang episode", () => {
  const detail = parseAnimeDetail(JUDUL_BERBENTUK, "boruto", "https://animasu.love");
  assert.equal(detail.batches[2].range, "", "2019-2020 itu tahun, bukan rentang episode");
});

test("Rentang di label baris (bukan resolusi) terbaca, lalu digabung jadi rentang batch", () => {
  const detail = parseAnimeDetail(LABEL_BARIS_RENTANG, "naruto", "https://animasu.love");
  const batch = detail.batches[0];
  assert.equal(batch.range, "1-100", "union label baris jadi rentang batch");
  assert.deepEqual(batch.mirrors.map((mirror) => mirror.quality), ["", ""], "label rentang bukan kualitas");
  assert.deepEqual(batch.mirrors.map((mirror) => mirror.range), ["1-25", "51-100"]);
});

test("ambilRentangEpisode hanya menebak kalau ada kata episode", () => {
  assert.equal(ambilRentangEpisode("Download X Batch [ 1 - 25 ]"), "1-25");
  assert.equal(ambilRentangEpisode("Download X Episode 001-025"), "1-25");
  assert.equal(ambilRentangEpisode("Jujutsu Kaisen Episode BATCH 1-24 [END] MKV"), "1-24");
  assert.equal(ambilRentangEpisode("Download X Episode 12"), "12");
  assert.equal(ambilRentangEpisode("Download X Batch Subtitle Indonesia"), "");
  assert.equal(ambilRentangEpisode("Download X Subtitle Indonesia 2019-2020"), "");
  assert.equal(ambilRentangEpisode("Download X Season 1 Spesial"), "");
  assert.equal(ambilRentangEpisode(""), "");
});

test("Renderer: baris tanpa resolusi tapi ada rentangnya tetap jadi pilihan", () => {
  const render = ambilRenderer();
  const html = render([
    {
      title: "Download Naruto Batch Subtitle Indonesia",
      range: "1-220",
      mirrors: [
        { quality: "", range: "1-25", links: [{ label: "Google Drive", url: "https://drive.google.com/x", host: "drive.google.com" }] },
        { quality: "", range: "51-100", links: [{ label: "Mega", url: "https://mega.nz/y", host: "mega.nz" }] },
      ],
    },
  ]);
  assert.match(html, /data-dl-option="Episode 1-25"/);
  assert.match(html, /data-dl-option="Episode 51-100"/);
  assert.match(html, /Pilih episode/);
});

test("Renderer: batch tunggal tanpa rentang di source memakai rentang episode yang tampil", () => {
  const render = ambilRenderer();
  const html = render(
    [
      {
        title: "Download Chainsaw Man Batch Subtitle Indonesia",
        range: "",
        mirrors: [{ quality: "480p", links: [{ label: "Google Drive", url: "https://drive.google.com/x", host: "drive.google.com" }] }],
      },
    ],
    { episodes: [{ number: 1 }, { number: 2 }, { number: 12 }] },
  );
  assert.match(html, /Episode 1-12/);
  assert.match(html, /title="Rentang dihitung dari 3 episode yang tampil, bukan dari judul batch\."/);
});

test("Renderer: lebih dari satu batch tanpa rentang tidak menebak", () => {
  const render = ambilRenderer();
  const html = render(
    [
      { title: "A", range: "", mirrors: [{ quality: "480p", links: [{ label: "Drive", url: "https://drive.google.com/x", host: "drive.google.com" }] }] },
      { title: "B", range: "", mirrors: [{ quality: "720p", links: [{ label: "Mega", url: "https://mega.nz/y", host: "mega.nz" }] }] },
    ],
    { episodes: [{ number: 1 }, { number: 12 }] },
  );
  assert.doesNotMatch(html, /Episode 1-12/);
  assert.match(html, /<span class="dl-range"[^>]*>Download<\/span>/);
});

/* ---------- Penanda tautan mati ----------
   Tautan yang ditandai mati tidak dirender sampai pengguna meminta
   menampilkannya. Indeks/urutan tautan lain tidak berubah, dan blok yang
   seluruh tautannya ditandai tetap menyisakan jalan untuk membukanya lagi. */
function batchDuaLink() {
  return [{
    range: "1-12",
    mirrors: [
      { quality: "480p", links: [{ label: "Pixeldrain", url: "https://pixeldrain.com/u/mati", page: "/unduh/aaa.bbb" }] },
      { quality: "720p", links: [{ label: "Mega", url: "https://mega.nz/embed/hidup" }] },
    ],
  }];
}

/* Kunci yang disimpan adalah hash URL, bukan path token: token punya masa
   berlaku sehingga path-nya berubah setiap render. */
const KUNCI_PIXELDRAIN = () => sidikTautan("https://pixeldrain.com/u/mati");
const KUNCI_MEGA = () => sidikTautan("https://mega.nz/embed/hidup");

test("Renderer menyembunyikan tautan yang ditandai mati dan menyediakan tombol tampilkan", () => {
  const render = ambilRenderer();
  const html = render(batchDuaLink(), undefined, { mati: new Set([KUNCI_PIXELDRAIN()]), tampilMati: false });
  assert.doesNotMatch(html, /href="\/unduh\/aaa\.bbb"/, "tautan mati tidak boleh dirender");
  assert.match(html, /Tampilkan 1 tautan mati/);
  assert.match(html, /data-dl-tampil-mati="global"/);
  assert.match(html, /1 batch · 1 tautan · 1 mati/);
});

test("Renderer menampilkan kembali tautan mati dengan tombol batal tandai", () => {
  const render = ambilRenderer();
  const html = render(batchDuaLink(), undefined, { mati: new Set([KUNCI_PIXELDRAIN()]), tampilMati: true });
  assert.match(html, /href="\/unduh\/aaa\.bbb"/);
  assert.match(html, /class="dl-link-row is-mati"/);
  assert.match(html, new RegExp(`data-dl-hidup="${KUNCI_PIXELDRAIN()}"`));
  assert.doesNotMatch(html, /data-dl-hidup="\/unduh\//, "path token tidak boleh jadi identitas");
  assert.match(html, /Sembunyikan 1 tautan mati/);
});

test("Renderer tetap memberi jalan keluar saat semua tautan ditandai mati", () => {
  const render = ambilRenderer();
  const html = render(batchDuaLink(), undefined, { mati: new Set([KUNCI_PIXELDRAIN(), KUNCI_MEGA()]), tampilMati: false });
  assert.equal(html.includes("dl-link"), false, "tidak ada satu tautan pun yang dirender");
  assert.match(html, /Semua tautan untuk judul ini ditandai mati/);
  assert.match(html, /Tampilkan 2 tautan mati/);
  assert.match(html, /data-dl-tampil-mati="global"/);
});

test("Renderer tanpa opsi penanda berperilaku seperti sebelumnya", () => {
  const render = ambilRenderer();
  const html = render(batchDuaLink());
  assert.match(html, /1 batch · 2 tautan/);
  assert.match(html, new RegExp(`data-dl-mati="${KUNCI_PIXELDRAIN()}"`));
  assert.doesNotMatch(html, /ditandai mati/);
});
