/* Laporan tautan/mirror mati antar-pengguna.
   Yang dibuktikan di sini: server hanya menerima hash (bukan URL), pelapor
   dihitung sekali walau mengirim berkali-kali, laporan baru dipakai setelah
   ambang, data kedaluwarsa, dan tidak ada token/IP yang bocor di balasan. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "iln-laporan-"));
process.env.ILN_LAPORAN_FILE = path.join(DIR, "laporan.json");
process.env.LAPORAN_AMBANG = "2";

const {
  app,
  catatLaporanTautan,
  laporanTautanPublik,
  normalisasiLaporanTautan,
  kunciLaporanTautan,
  simpanLaporanTautanSekarang,
  kosongkanLaporanTautan,
  LAPORAN_TTL_MS,
  LAPORAN_BERKAS,
} = require("../server");

const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";
const C = "cccccccc-1111-2222-3333-444444444444";

function laporan(over = {}) {
  return { jenis: "unduhan", id: "t7abc", pelapor: A, ...over };
}

test.beforeEach(() => {
  kosongkanLaporanTautan();
  fs.rmSync(LAPORAN_BERKAS, { force: true });
});

test.after(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

test("validasi menolak jenis asing, URL, slug aneh, dan pelapor pendek", () => {
  assert.equal(normalisasiLaporanTautan(null), null);
  assert.equal(normalisasiLaporanTautan(laporan()).jenis, "unduhan");
  assert.equal(normalisasiLaporanTautan(laporan({ jenis: "lain" })), null);
  assert.equal(normalisasiLaporanTautan(laporan({ id: "https://mega.nz/file/x" })), null);
  assert.equal(normalisasiLaporanTautan(laporan({ id: "unduh|t7abc" })), null);
  assert.equal(normalisasiLaporanTautan(laporan({ pelapor: "pendek" })), null);
  assert.equal(normalisasiLaporanTautan(laporan({ jenis: "mirror" })), null, "mirror wajib punya episode");
  assert.equal(normalisasiLaporanTautan(laporan({ jenis: "mirror", episode: "../etc/passwd" })), null);
  assert.equal(normalisasiLaporanTautan(laporan({ jenis: "mirror", episode: "nonton-x-episode-1" })).jenis, "mirror");
  assert.equal(kunciLaporanTautan({ jenis: "unduhan", id: "t7abc" }), "unduhan|t7abc");
  assert.equal(kunciLaporanTautan({ jenis: "mirror", id: "t8def", episode: "nonton-x-episode-1" }), "mirror|nonton-x-episode-1|t8def");
});

test("pelapor yang sama tidak menambah hitungan, pelapor berbeda menambah", () => {
  assert.equal(catatLaporanTautan(laporan()).jumlah, 1);
  assert.equal(catatLaporanTautan(laporan()).jumlah, 1, "satu browser tidak boleh dihitung dua kali");
  assert.equal(catatLaporanTautan(laporan({ pelapor: B })).jumlah, 2);
  assert.equal(catatLaporanTautan(laporan({ pelapor: C })).jumlah, 3);
});

test("laporan mirror dipisah per episode, unduhan selalu ikut", () => {
  catatLaporanTautan(laporan({ pelapor: A }));
  catatLaporanTautan(laporan({ pelapor: B }));
  catatLaporanTautan(laporan({ jenis: "mirror", id: "t8def", episode: "nonton-x-episode-1", pelapor: A }));
  catatLaporanTautan(laporan({ jenis: "mirror", id: "t8def", episode: "nonton-x-episode-1", pelapor: B }));
  catatLaporanTautan(laporan({ jenis: "mirror", id: "t9ghi", episode: "nonton-y-episode-2", pelapor: A }));
  catatLaporanTautan(laporan({ jenis: "mirror", id: "t9ghi", episode: "nonton-y-episode-2", pelapor: B }));

  const satu = laporanTautanPublik({ episode: "nonton-x-episode-1" });
  assert.deepEqual(satu.data.map((item) => item.id).sort(), ["t7abc", "t8def"]);
  assert.equal(satu.ambang, 2);
  assert.equal(satu.data.find((item) => item.id === "t8def").jumlah, 2);

  const dua = laporanTautanPublik({ episode: "nonton-y-episode-2" });
  assert.deepEqual(dua.data.map((item) => item.id).sort(), ["t7abc", "t9ghi"]);

  const tanpaEpisode = laporanTautanPublik();
  assert.deepEqual(tanpaEpisode.data.map((item) => item.id), ["t7abc"], "tanpa episode, mirror tidak dibocorkan");
});

test("balasan tidak pernah memuat URL host, token pelapor, atau IP", () => {
  catatLaporanTautan(laporan({ pelapor: A }));
  catatLaporanTautan(laporan({ pelapor: B }));
  const isi = JSON.stringify(laporanTautanPublik({ episode: "nonton-x-episode-1" }));
  assert.ok(!isi.includes(A), "token pelapor tidak boleh keluar dari server");
  assert.ok(!isi.includes("http"), "tidak boleh ada URL di balasan");
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(isi), "tidak boleh ada IP di balasan");
});

test("entri kedaluwarsa dibuang dan tidak muncul lagi", () => {
  const awal = 1_000_000;
  catatLaporanTautan(laporan({ pelapor: A }), awal);
  catatLaporanTautan(laporan({ pelapor: B }), awal);
  assert.equal(laporanTautanPublik({ sekarang: awal + LAPORAN_TTL_MS - 1 }).data.length, 1);
  assert.equal(laporanTautanPublik({ sekarang: awal + LAPORAN_TTL_MS + 1 }).data.length, 0);
});

test("berkas simpanan hanya berisi hash pelapor, bukan token aslinya", () => {
  catatLaporanTautan(laporan({ pelapor: A }));
  catatLaporanTautan(laporan({ pelapor: B }));
  assert.equal(simpanLaporanTautanSekarang(), true);
  const mentah = fs.readFileSync(LAPORAN_BERKAS, "utf8");
  assert.ok(!mentah.includes(A), "token pelapor tidak boleh tersimpan apa adanya");
  assert.ok(!mentah.includes("mega.nz"), "URL sumber tidak boleh tersimpan");
  const isi = JSON.parse(mentah);
  assert.equal(isi.item["unduhan|t7abc"].p.length, 2);
  assert.match(isi.item["unduhan|t7abc"].p[0], /^[a-f0-9]{24}$/);
});

test("HTTP: kirim laporan, baca laporan, tolak input tidak valid", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const minta = (pathname, options = {}) => new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const teks = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(teks); } catch { /* biarkan null */ }
        resolve({ status: response.statusCode, headers: response.headers, json, teks });
      });
    });
    request.on("error", reject);
    request.end(body || undefined);
  });

  try {
    const satu = await minta("/api/laporan-tautan", { method: "POST", body: laporan({ pelapor: A }) });
    assert.equal(satu.status, 200);
    assert.equal(satu.json.ok, true);
    assert.equal(satu.json.jumlah, 1);
    assert.equal(satu.headers["cache-control"], "no-store");
    assert.ok(!satu.teks.includes(A));

    await minta("/api/laporan-tautan", { method: "POST", body: laporan({ pelapor: B }) });
    await minta("/api/laporan-tautan", { method: "POST", body: laporan({ jenis: "mirror", id: "t8def", episode: "nonton-x-episode-1", pelapor: A }) });
    await minta("/api/laporan-tautan", { method: "POST", body: laporan({ jenis: "mirror", id: "t8def", episode: "nonton-x-episode-1", pelapor: B }) });

    const baca = await minta("/api/laporan-tautan?episode=nonton-x-episode-1");
    assert.equal(baca.status, 200);
    assert.deepEqual(baca.json.data.map((item) => item.id).sort(), ["t7abc", "t8def"]);
    assert.equal(baca.json.ambang, 2);

    const asing = await minta("/api/laporan-tautan?episode=lain");
    assert.deepEqual(asing.json.data.map((item) => item.id), ["t7abc"], "mirror episode lain tidak ikut");

    const invalid = await minta("/api/laporan-tautan", { method: "POST", body: laporan({ id: "bukan-hash" }) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.ok, false);

    const kosong = await minta("/api/laporan-tautan", { method: "POST", body: {} });
    assert.equal(kosong.status, 400);

    const episodeAneh = await minta("/api/laporan-tautan?episode=../x");
    assert.equal(episodeAneh.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
