const test = require("node:test");
const assert = require("node:assert/strict");

const {
  app,
  targetUnduhanLangsung,
  targetUnduhanHalaman,
  buatTokenUnduhan,
  bacaTokenUnduhan,
  tautanUnduhan,
} = require("../server");

const DRIVE_ID = "testDriveId123456";
const DRIVE_URL = `https://drive.google.com/file/d/${DRIVE_ID}/view`;
const DRIVE_CANONICAL = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t`;
const DRIVE_LANGSUNG = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download`;
const PIXEL_URL = "https://pixeldrain.com/u/AbCdEf123456";
const MEGA_URL = "https://mega.nz/file/AbCdEf123456";
const MEDIAFIRE_URL = "https://www.mediafire.com/file/abc/xyz";

test("Halaman unduhan menerima empat host resmi dan menolak host lain", () => {
  for (const url of [DRIVE_URL, MEGA_URL, MEDIAFIRE_URL, PIXEL_URL]) {
    assert.ok(targetUnduhanHalaman(url), `host resmi harus diterima: ${url}`);
  }
  assert.equal(targetUnduhanHalaman(`https://drive.google.com.evil.test/file/d/${DRIVE_ID}/view`), "");
  assert.equal(targetUnduhanHalaman(`https://drive.google.com@evil.test/file/d/${DRIVE_ID}/view`), "");
  assert.equal(targetUnduhanHalaman(`https://drive.google.com:444/file/d/${DRIVE_ID}/view`), "");
  assert.equal(targetUnduhanHalaman("javascript:alert(1)"), "");
  assert.equal(targetUnduhanHalaman("ftp://pixeldrain.com/u/AbCdEf123456"), "");
  assert.equal(targetUnduhanHalaman(`https://pixeldrain.com/u/${"a".repeat(5000)}`), "");
  assert.equal(targetUnduhanHalaman(["https://pixeldrain.com/u/AbCdEf123456"]), "");
});

test("Resolver Drive tetap hanya untuk file Drive", () => {
  assert.equal(targetUnduhanLangsung(DRIVE_URL), DRIVE_CANONICAL);
  assert.equal(targetUnduhanLangsung(PIXEL_URL), "");
  assert.equal(targetUnduhanLangsung(MEGA_URL), "");
  assert.equal(targetUnduhanLangsung(MEDIAFIRE_URL), "");
});

test("Token membawa metadata, tidak menulis URL sumber di href, dan bisa kedaluwarsa", () => {
  const token = buatTokenUnduhan(PIXEL_URL, {
    label: "Pixeldrain",
    quality: "720p",
    range: "1-12",
    source: "animasu",
  });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const data = bacaTokenUnduhan(token);
  assert.equal(data.u, PIXEL_URL);
  assert.equal(data.host, "pixeldrain.com");
  assert.equal(data.l, "Pixeldrain");
  assert.equal(data.q, "720p");
  assert.equal(data.r, "1-12");
  assert.equal(data.s, "animasu");

  const tautan = tautanUnduhan(PIXEL_URL, { label: "Pixeldrain" });
  assert.match(tautan, /^\/unduh\//);
  assert.ok(!tautan.includes("pixeldrain.com"), "href tidak boleh memuat host sumber");

  const [isi, tanda] = token.split(".");
  const rusak = `${isi}.${tanda[0] === "A" ? "B" : "A"}${tanda.slice(1)}`;
  assert.equal(bacaTokenUnduhan(rusak), null, "tanda tangan yang diubah harus ditolak");
  assert.equal(bacaTokenUnduhan(`${token}x`), null, "token tambahan harus ditolak");
  assert.equal(bacaTokenUnduhan(""), null);

  const kedaluwarsa = buatTokenUnduhan(PIXEL_URL, {}, { now: Date.now() - 5000, ttlMs: 1000 });
  assert.equal(bacaTokenUnduhan(kedaluwarsa), null, "token kedaluwarsa harus ditolak");
  assert.equal(buatTokenUnduhan("https://drive.google.com.evil.test/x"), "", "host jahat tidak boleh ditoken");
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

test("GET /unduh/:token menampilkan halaman Drive dengan tombol direct", async () => {
  const token = buatTokenUnduhan(DRIVE_LANGSUNG, {
    label: "Google Drive",
    quality: "720p",
    range: "1-12",
    source: "animasu",
  });
  const response = await minta(`/unduh/${token}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await response.text();
  assert.match(html, /Google Drive/);
  assert.match(html, /720p/);
  assert.match(html, /Episode/);
  assert.match(html, /href="\/unduh\/[^"]+\?direct=1"/);
  const tujuanHtml = DRIVE_LANGSUNG.replace(/&/g, "&amp;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(html, new RegExp(`href="${tujuanHtml}"`));
  assert.doesNotMatch(html, /javascript:/);
});

test("GET /unduh/:token untuk Pixeldrain tidak menawarkan direct", async () => {
  const token = buatTokenUnduhan(PIXEL_URL, { label: "Pixeldrain", quality: "1080p" });
  const response = await minta(`/unduh/${token}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pixeldrain/);
  assert.match(html, /menolak unduhan langsung/);
  assert.doesNotMatch(html, /\?direct=1/);
  assert.match(html, new RegExp(`href="${PIXEL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
});

test("Query direct hanya mengarahkan Drive; host lain ditolak", async () => {
  const drive = buatTokenUnduhan(DRIVE_LANGSUNG, {});
  const langsung = await minta(`/unduh/${drive}?direct=1`);
  assert.equal(langsung.status, 302);
  assert.equal(langsung.headers.get("location"), DRIVE_CANONICAL);

  const pixel = buatTokenUnduhan(PIXEL_URL, {});
  const ditolak = await minta(`/unduh/${pixel}?direct=1`);
  assert.equal(ditolak.status, 400);
  assert.equal(ditolak.headers.get("location"), null);
  assert.match(await ditolak.text(), /tidak mendukung unduhan langsung/);
});

test("GET /unduh/:token?format=json memberi data pop-up tanpa HTML", async () => {
  const token = buatTokenUnduhan(DRIVE_LANGSUNG, {
    label: "Google Drive",
    quality: "1080p",
    range: "1-12",
    source: "animasu",
  });
  const response = await minta(`/unduh/${token}?format=json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const body = await response.json();
  assert.equal(body.data.host, "Google Drive");
  assert.equal(body.data.quality, "1080p");
  assert.equal(body.data.episode, "1-12");
  assert.equal(body.data.mirror, "Google Drive");
  assert.equal(body.data.direct, true);
  assert.equal(body.data.url, DRIVE_LANGSUNG);
  assert.match(body.data.expiresLabel, /WIB$/);
  assert.match(body.data.note, /langsung mengunduh/);
  assert.equal(body.data.help.url, "/bantuan/kuota-drive/");
});

test("JSON pop-up menolak token rusak dengan 410, bukan halaman HTML", async () => {
  const response = await minta("/unduh/rusak?format=json");
  assert.equal(response.status, 410);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.data, null);
  assert.match(body.error, /tidak valid atau sudah kedaluwarsa/);
});

test("Token rusak atau kedaluwarsa membalas 410 tanpa Location", async () => {
  for (const path of ["/unduh/rusak", "/unduh/a.b", `/unduh/${buatTokenUnduhan(PIXEL_URL, {}, { now: Date.now() - 5000, ttlMs: 1000 })}`]) {
    const response = await minta(path);
    assert.equal(response.status, 410, `harus 410: ${path}`);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /tidak valid atau sudah kedaluwarsa/);
  }
});
