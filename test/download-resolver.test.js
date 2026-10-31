const test = require("node:test");
const assert = require("node:assert/strict");

const { app, targetUnduhanLangsung } = require("../server");

const DRIVE_ID = "testDriveId123456";
const PIXEL_ID = "AbCdEf123456";
const DRIVE_CANONICAL = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t`;


test("Drive dinormalisasi ke endpoint download dengan confirm=t", () => {
  const url = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&authuser=0`;
  assert.equal(targetUnduhanLangsung(url), DRIVE_CANONICAL);
  assert.equal(targetUnduhanLangsung(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`), DRIVE_CANONICAL);
  assert.equal(targetUnduhanLangsung(`https://drive.google.com/uc?export=download&id=${DRIVE_ID}`), DRIVE_CANONICAL);
  assert.equal(targetUnduhanLangsung(`http://drive.google.com/open?id=${DRIVE_ID}`), DRIVE_CANONICAL);
});

test("Pixeldrain tetap link-out: hotlink lintas situs ditolak 403 oleh Pixeldrain", () => {
  assert.equal(targetUnduhanLangsung(`https://pixeldrain.com/u/${PIXEL_ID}`), "");
  assert.equal(targetUnduhanLangsung(`https://www.pixeldrain.com/api/file/${PIXEL_ID}?download`), "");
  assert.equal(targetUnduhanLangsung(`http://pixeldrain.com/u/${PIXEL_ID}`), "");
});

test("host yang tidak didukung tetap fallback, bukan dipaksa lewat resolver", () => {
  for (const url of [
    "https://mega.nz/file/AbCdEf123456",
    "https://www.mediafire.com/file/abc/xyz",
    "https://drive.google.com/drive/folders/AbCdEf123456",
    "https://pixeldrain.com/l/AbCdEf123456",
    `https://pixeldrain.com/u/${PIXEL_ID}`,
  ]) {
    assert.equal(targetUnduhanLangsung(url), "", `seharusnya fallback: ${url}`);
  }
});

test("validasi host menolak suffix palsu, kredensial, port aneh, dan skema lain", () => {
  const jahat = [
    `https://drive.google.com.evil.test/file/d/${DRIVE_ID}/view`,
    `https://drive.google.com@evil.test/file/d/${DRIVE_ID}/view`,
    `https://drive.google.com:444/file/d/${DRIVE_ID}/view`,
    `https://pixeldrain.com.evil.test/u/${PIXEL_ID}`,
    `javascript:alert(1)`,
    `data:text/html,<b>x</b>`,
    `ftp://pixeldrain.com/u/${PIXEL_ID}`,
    `https://pixeldrain.com/u/..%2F..%2Fetc`,
    `https://pixeldrain.com/u/short`,
    "",
  ];
  for (const url of jahat) {
    assert.equal(targetUnduhanLangsung(url), "", `harus ditolak: ${url}`);
  }
  assert.equal(targetUnduhanLangsung(["https://pixeldrain.com/u/AbCdEf123456"]), "", "array tidak boleh lolos");
  assert.equal(targetUnduhanLangsung(`https://pixeldrain.com/u/${"a".repeat(5000)}`), "", "URL kepanjangan harus ditolak");
});

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

async function minta(pathname) {
  return fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
}

test("GET /api/download membalas 302 ke Drive kanonik", async () => {
  const sumber = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&authuser=0`;
  const response = await minta(`/api/download?url=${encodeURIComponent(sumber)}`);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), DRIVE_CANONICAL);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("file 3,5 GB langsung 302 tanpa menyentuh Google dari server", async () => {
  const idBesar = "besarDriveId123456";
  const sumber = `https://drive.google.com/file/d/${idBesar}/view`;
  let panggilanGoogle = 0;
  const fetchAsli = global.fetch;
  global.fetch = async (url, init) => {
    const host = new URL(String(url)).hostname;
    if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
      panggilanGoogle += 1;
      throw new Error("resolver tidak boleh memanggil Google");
    }
    return fetchAsli(url, init);
  };
  try {
    const response = await minta(`/api/download?url=${encodeURIComponent(sumber)}`);
    assert.equal(response.status, 302, "file 3,5 GB harus langsung diarahkan");
    assert.match(response.headers.get("location"), new RegExp(`id=${idBesar}`));
    assert.equal(panggilanGoogle, 0, "tidak ada probe yang bisa memicu kuota");
  } finally {
    global.fetch = fetchAsli;
  }
});

test("GET /api/download menolak Pixeldrain, bukan mengirim pengguna ke JSON 403", async () => {
  const sumber = `https://pixeldrain.com/u/${PIXEL_ID}`;
  const response = await minta(`/api/download?url=${encodeURIComponent(sumber)}`);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("location"), null);
  assert.match(await response.text(), /belum didukung/);
});

test("GET /api/download menolak host jahat tanpa Location", async () => {
  const response = await minta(`/api/download?url=${encodeURIComponent(`https://drive.google.com.evil.test/file/d/${DRIVE_ID}/view`)}`);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("location"), null);
  assert.match(await response.text(), /belum didukung/);
});

test("GET /api/download menolak URL kosong dan skema non-http", async () => {
  for (const sumber of ["", "javascript:alert(1)", "https://mega.nz/file/AbCdEf123456"]) {
    const response = await minta(`/api/download?url=${encodeURIComponent(sumber)}`);
    assert.equal(response.status, 400, `harus 400: ${sumber}`);
    assert.equal(response.headers.get("location"), null);
  }
});

test("Resolver membalas 429 yang bisa dicoba lagi, bukan memblokir permanen", async () => {
  const tautan = `/api/download?url=${encodeURIComponent(`https://drive.google.com/file/d/${DRIVE_ID}/view`)}`;
  let response;
  for (let i = 0; i < 400; i += 1) {
    response = await minta(tautan);
    if (response.status === 429) break;
    assert.equal(response.status, 302, "selama token tersedia harus tetap 302");
  }
  assert.equal(response.status, 429);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const retryDetik = Number(response.headers.get("retry-after"));
  assert.ok(Number.isFinite(retryDetik) && retryDetik >= 1 && retryDetik <= 2, `Retry-After harus pendek, dapat ${retryDetik}`);
  const html = await response.text();
  assert.match(html, /Terlalu banyak permintaan unduhan/);
  assert.match(html, /Coba lagi/, "429 harus punya tombol coba lagi, bukan jalan buntu");
  assert.match(html, /href="\/api\/download\?url=/, "tombol coba lagi menembak resolver yang sama");

  /* Limit adalah pengaman burst, bukan hukuman: satu token pulih dalam
     250 ms dan pengguna bisa melanjutkan tanpa membuka tab baru. */
  await new Promise((resolve) => setTimeout(resolve, 400));
  const pulih = await minta(tautan);
  assert.equal(pulih.status, 302, "setelah jeda singkat unduhan harus bisa lagi");
});
