const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let modul;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/tautan-mati.js"), "utf8");
  modul = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

function penyimpananPalsu() {
  const isi = new Map();
  return {
    getItem: (kunci) => (isi.has(kunci) ? isi.get(kunci) : null),
    setItem: (kunci, nilai) => isi.set(kunci, String(nilai)),
    removeItem: (kunci) => isi.delete(kunci),
    mentah: isi,
  };
}

test("kunci unduhan dan mirror memakai awalan berbeda", () => {
  assert.equal(modul.kunciUnduhan(" https://pixeldrain.com/u/a "), "unduh|https://pixeldrain.com/u/a");
  assert.equal(modul.kunciUnduhan(""), "");
  assert.equal(modul.kunciMirror("nonton-x-episode-1", "https://mega.nz/embed/a"), "mirror|nonton-x-episode-1|https://mega.nz/embed/a");
  assert.equal(modul.kunciMirror("", ""), "");
});

test("sidik tautan stabil, berbeda antar URL, dan tidak memuat URL aslinya", () => {
  const a = modul.sidikTautan("https://pixeldrain.com/u/abc");
  const b = modul.sidikTautan("https://pixeldrain.com/u/abc");
  const c = modul.sidikTautan("https://pixeldrain.com/u/abd");
  assert.equal(a, b, "hash harus deterministik supaya tanda mati bertahan");
  assert.notEqual(a, c, "URL berbeda butuh identitas berbeda");
  assert.match(a, /^t[0-9a-z]+$/);
  assert.ok(!a.includes("pixeldrain"), "URL host tidak boleh tertulis di markup");
  assert.equal(modul.sidikTautan(""), "");
  const banyak = new Set();
  for (let i = 0; i < 300; i += 1) banyak.add(modul.sidikTautan(`https://mega.nz/file/${i}#kunci-${i}`));
  assert.equal(banyak.size, 300, "tidak boleh ada tabrakan pada ratusan tautan");
});

test("tandai, punya, hapus, dan semua bekerja di storage mana pun", () => {
  const storage = penyimpananPalsu();
  const daftar = modul.buatDaftarMati({ storage, sekarang: () => 1000 });
  assert.equal(daftar.jumlah(), 0);
  assert.equal(daftar.tandai(modul.kunciUnduhan("https://a.test/1"), { sebab: "404" }), true);
  assert.equal(daftar.tandai("", {}), false);
  assert.equal(daftar.punya(modul.kunciUnduhan("https://a.test/1")), true);
  assert.deepEqual(daftar.semua(), ["unduh|https://a.test/1"]);
  assert.equal(daftar.hapus(modul.kunciUnduhan("https://a.test/1")), true);
  assert.equal(daftar.hapus("unduh|tidak-ada"), false);
  assert.equal(daftar.jumlah(), 0);
});

test("entri kedaluwarsa dibuang saat dibaca, bukan setelah puluhan hari", () => {
  let sekarang = 10_000;
  const storage = penyimpananPalsu();
  const daftar = modul.buatDaftarMati({ storage, sekarang: () => sekarang, umurMs: 5_000 });
  daftar.tandai("unduh|https://a.test/lama");
  sekarang = 14_000;
  assert.equal(daftar.punya("unduh|https://a.test/lama"), true, "masih di dalam masa berlaku");
  sekarang = 16_000;
  assert.equal(daftar.punya("unduh|https://a.test/lama"), false, "lewat 5 detik harus hilang");
  assert.equal(JSON.parse(storage.getItem(modul.KUNCI_SIMPAN)).item["unduh|https://a.test/lama"], undefined, "entri lama ikut dibersihkan dari storage");
});

test("jumlah entri dibatasi, yang paling lama keluar lebih dulu", () => {
  let sekarang = 1_000;
  const storage = penyimpananPalsu();
  const daftar = modul.buatDaftarMati({ storage, sekarang: () => sekarang, umurMs: 60_000, batas: 2 });
  daftar.tandai("unduh|a");
  sekarang += 10;
  daftar.tandai("unduh|b");
  sekarang += 10;
  daftar.tandai("unduh|c");
  const isi = daftar.semua().sort();
  assert.deepEqual(isi, ["unduh|b", "unduh|c"], "yang paling lama dibuang");
});

test("storage rusak atau penuh tidak melempar", () => {
  const rusak = {
    getItem: () => "{bukan json",
    setItem: () => { throw new Error("penuh"); },
    removeItem: () => { },
  };
  const daftar = modul.buatDaftarMati({ storage: rusak, sekarang: () => 1 });
  assert.equal(daftar.jumlah(), 0);
  assert.equal(daftar.tandai("unduh|a"), true, "gagal menulis bukan alasan untuk melempar");
  assert.equal(daftar.punya("unduh|a"), true, "nilai tetap hidup selama proses");
});

test("kunci laporan sejajar dengan kunci penyimpanan lokal", () => {
  assert.equal(modul.kunciLaporan("unduhan", "", "t7abc"), "unduh|t7abc");
  assert.equal(modul.kunciLaporan("mirror", "nonton-x-episode-1", "t8def"), "mirror|nonton-x-episode-1|t8def");
  assert.equal(modul.kunciLaporan("mirror", "", "t8def"), "", "mirror tanpa episode tidak punya kunci");
  assert.equal(modul.kunciLaporan("unduhan", "", ""), "");
  assert.equal(modul.kunciLaporan("lain", "", "t7abc"), "");
});

test("gabungLaporan membuang laporan di bawah ambang dan memisah mirror per episode", () => {
  const hasil = modul.gabungLaporan([
    { jenis: "unduhan", id: "t7abc", jumlah: 1 },
    { jenis: "unduhan", id: "t8def", jumlah: 2 },
    { jenis: "mirror", id: "t9ghi", episode: "nonton-x-episode-1", jumlah: 3 },
    { jenis: "mirror", id: "t9ghi", episode: "nonton-y-episode-2", jumlah: 1 },
    { jenis: "mirror", id: "t0jkl", episode: "", jumlah: 4 },
    { jenis: "asing", id: "t1mno", jumlah: 9 },
  ], 2);
  assert.deepEqual([...hasil.unduhan], ["t8def"], "laporan dengan satu pelapor belum dipakai");
  assert.deepEqual([...hasil.mirror.get("nonton-x-episode-1")], ["t9ghi"]);
  assert.equal(hasil.mirror.has("nonton-y-episode-2"), false);
  assert.equal(hasil.mirror.has(""), false);
  assert.equal(hasil.ambang, 2);
  assert.deepEqual([...modul.gabungLaporan(null).unduhan], []);
  assert.deepEqual([...modul.gabungLaporan([{ jenis: "unduhan", id: "t7abc", jumlah: 1 }], 1).unduhan], ["t7abc"], "ambang bisa diturunkan");
});

test("idPelapor stabil per browser dan tetap sama saat storage menolak tulisan", () => {
  const storage = penyimpananPalsu();
  const satu = modul.idPelapor({ storage, acak: () => "aaaa-bbbb-cccc-dddd" });
  const dua = modul.idPelapor({ storage, acak: () => "zzzz-yyyy-xxxx-wwww" });
  assert.equal(satu, "aaaa-bbbb-cccc-dddd");
  assert.equal(dua, satu, "id yang sudah tersimpan harus dipakai lagi");
  assert.equal(storage.getItem(modul.KUNCI_PELAPOR), satu);

  const rusak = {
    getItem: () => { throw new Error("diblokir"); },
    setItem: () => { throw new Error("penuh"); },
  };
  const a = modul.idPelapor({ storage: rusak, acak: () => "eeee-ffff-0000-1111" });
  const b = modul.idPelapor({ storage: rusak, acak: () => "2222-3333-4444-5555" });
  assert.equal(a, "eeee-ffff-0000-1111");
  assert.equal(b, a, "gagal menulis bukan alasan menghitung pengguna yang sama dua kali");
  assert.equal(modul.idPelapor({ storage: penyimpananPalsu(), acak: () => "x" }), "", "id terlalu pendek harus ditolak");
});

test("dua daftar dengan kunci simpanan berbeda tidak saling menimpa", () => {
  const storage = penyimpananPalsu();
  const mati = modul.buatDaftarMati({ storage });
  const hidup = modul.buatDaftarMati({ storage, kunciSimpan: modul.KUNCI_HIDUP });
  mati.tandai("unduh|t7abc");
  hidup.tandai("unduh|t7abc");
  assert.deepEqual(mati.semua(), ["unduh|t7abc"]);
  assert.deepEqual(hidup.semua(), ["unduh|t7abc"]);
  assert.ok(storage.getItem(modul.KUNCI_SIMPAN));
  assert.ok(storage.getItem(modul.KUNCI_HIDUP));
  hidup.hapus("unduh|t7abc");
  assert.deepEqual(mati.semua(), ["unduh|t7abc"], "menghapus tanda hidup tidak boleh menghapus tanda mati");
});

test("saringMirror juga mengenali hash laporan publik, bukan hanya URL lokal", () => {
  const mirrors = [
    { name: "Mirror 1", url: "https://a.test/1" },
    { name: "Mirror 2", url: "https://a.test/2" },
  ];
  const hash = modul.sidikTautan("https://a.test/2");
  const hasil = modul.saringMirror(mirrors, new Set([hash]), false);
  assert.deepEqual(hasil.daftar.map((item) => item.index), [0]);
  assert.equal(hasil.tersembunyi, 1);
});

test("saringMirror menyembunyikan yang ditandai tetapi mempertahankan indeks asli", () => {
  const mirrors = [
    { name: "Mirror 1", url: "https://a.test/1" },
    { name: "Mirror 2", url: "https://a.test/2" },
    { name: "Mirror 3", url: "https://a.test/3" },
  ];
  const mati = new Set(["https://a.test/2"]);
  const tertutup = modul.saringMirror(mirrors, mati, false);
  assert.deepEqual(tertutup.daftar.map((item) => item.index), [0, 2], "indeks 0 dan 2, bukan 0 dan 1");
  assert.equal(tertutup.tersembunyi, 1);
  const terbuka = modul.saringMirror(mirrors, mati, true);
  assert.deepEqual(terbuka.daftar.map((item) => item.index), [0, 1, 2]);
  assert.equal(terbuka.daftar[1].mati, true);
  assert.deepEqual(modul.saringMirror(null, mati).daftar, []);
  assert.equal(modul.saringMirror(mirrors, new Set()).tersembunyi, 0);
});
