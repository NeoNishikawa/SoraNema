const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const $ = cheerio.load(html);

/* #watchOverlay ber-display:none sampai ada video dibuka. Apa pun yang
   tertanam di dalamnya tidak punya layout (0x0), animasinya tidak jalan, dan
   opacity-nya macet di 0 - jadi toast, dialog konfirmasi, dan kanvas latar
   praktis mati. Struktur ini pernah rusak karena #watchOverlay tidak ditutup
   sampai akhir body; test ini menjaga supaya tidak terulang. */
test("#watchOverlay hanya berisi modal player, bukan elemen global", () => {
  const overlay = $("#watchOverlay");
  assert.equal(overlay.length, 1, "#watchOverlay harus ada");
  assert.equal($("#watchOverlay #watchModal").length, 1, "modal player ada di dalam overlay");
  const anak = overlay.children().toArray().map((el) => el.attribs?.id || el.tagName);
  assert.deepEqual(anak, ["watchModal"], `overlay hanya boleh berisi modal, bukan ${anak.join(", ")}`);
});

test("toast, dialog, menu, dan pemberitahuan restart ada langsung di <body>", () => {
  for (const id of ["confirmRoot", "toastStack", "gooMenu", "serverRefresh"]) {
    const el = $(`#${id}`);
    assert.equal(el.length, 1, `#${id} harus ada`);
    assert.equal(el.parent()[0]?.tagName, "body", `#${id} harus anak langsung <body>`);
    assert.equal($(`#watchOverlay #${id}`).length, 0, `#${id} tidak boleh tertanam di #watchOverlay`);
  }
});

test("main hanya satu dan milik #app, bukan nyasar di dalam overlay", () => {
  assert.equal($("main").length, 1, "hanya boleh ada satu <main>");
  assert.equal($("#app > main.main").length, 1, "<main> harus anak langsung #app");
  assert.equal($("#watchOverlay main").length, 0);
  /* Hitungan tag mentah: </main> nyasar pernah tersisa setelah modal dipindah. */
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  assert.ok(html.indexOf("</main>") < html.indexOf('id="watchOverlay"'), "<main> ditutup sebelum overlay player");
});

/* Efek partikel Three.js dimatikan: latar opak menutupinya sepenuhnya, jadi
   tidak ada kanvas di markup dan tidak ada loop WebGL yang berjalan. Test ini
   menahan supaya kanvas tidak muncul lagi tanpa disengaja (lihat AMBIENT_AKTIF
   di public/js/ambient.js). */
test("kanvas ambient tidak dipasang selama efeknya tidak dipakai", () => {
  assert.equal($("#ambientCanvas").length, 0, "markup tidak boleh punya #ambientCanvas");
  assert.equal((html.match(/ambient\.js/g) || []).length, 0, "ambient.js tidak perlu <script> terpisah");
  const ambient = fs.readFileSync(path.join(root, "public/js/ambient.js"), "utf8");
  assert.match(ambient, /const AMBIENT_AKTIF = false;/, "saklar ambient harus mati");
});

test("urutan elemen global setelah modul utama tetap: kunci <script> di akhir body", () => {
  const bodyAnak = $("body").children().toArray().map((el) => el.attribs?.id || el.tagName);
  const indeks = (nama) => bodyAnak.indexOf(nama);
  assert.ok(indeks("toastStack") > indeks("watchOverlay"), "toastStack setelah overlay (bukan di dalamnya)");
  assert.equal(bodyAnak.at(-1), "script", "script modul tetap di akhir body");
});
