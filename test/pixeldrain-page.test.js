const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { app } = require("../server");

const ROOT = path.join(__dirname, "..");
const HTML_PATH = path.join(ROOT, "public", "bantuan", "pixeldrain", "index.html");
const CSS_PATH = path.join(ROOT, "public", "bantuan", "bantuan.css");
const html = fs.readFileSync(HTML_PATH, "utf8");
const css = fs.readFileSync(CSS_PATH, "utf8");

let server;
let port;

test.before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  port = server.address().port;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

function minta(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("halaman Pixeldrain adalah HTML statis tanpa JavaScript", () => {
  assert.ok(fs.existsSync(HTML_PATH), "index.html harus ada");
  assert.ok(fs.existsSync(CSS_PATH), "stylesheet bersama harus ada");
  assert.match(html, /<html lang="id"/);
  assert.equal((html.match(/<main[\s>]/g) || []).length, 1, "harus tepat satu landmark main");
  assert.doesNotMatch(html, /<script\b/i, "halaman bantuan tidak boleh membawa JavaScript");
  assert.match(html, /href="\/css\/tokens\.css\?v=/);
  assert.match(html, /href="\/bantuan\/bantuan\.css\?v=/);
});

test("isi menjelaskan 403 hotlink, bukan menyalahkan SoraNema", () => {
  assert.match(html, /Pixeldrain menolak unduhan langsung/);
  assert.match(html, /403 hotlink_detected/);
  assert.match(html, /bukan tautan yang rusak/);
  assert.match(html, /pixeldrain\.com\/u\//);
  assert.match(html, /Google Drive/);
  assert.match(html, /MediaFire/);
  assert.match(html, /Mega/);
  assert.match(html, /tab baru/);
  assert.match(html, /File anime sering berukuran 1–4 GB/);
  assert.match(html, /file tidak pernah melewati server SoraNema/);
});

test("tidak memanggil API dan hanya menautkan aset same-origin", () => {
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|\/api\//);
  const tautan = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(tautan.length > 0);
  for (const nilai of tautan) {
    assert.ok(nilai.startsWith("/") || nilai.startsWith("#"), `hanya same-origin/anchor: ${nilai}`);
  }
});

test("catatan unduhan menautkan panduan Pixeldrain", () => {
  const referenceApp = fs.readFileSync(path.join(ROOT, "public", "js", "reference-app.js"), "utf8");
  assert.match(referenceApp, /href="\/bantuan\/pixeldrain\/"/);
  assert.match(referenceApp, /Kenapa Pixeldrain menolak unduhan langsung\?/);
  assert.match(referenceApp, /target="_blank" rel="noopener"/);
});

test("stylesheet bersama memakai design token dan responsif", () => {
  assert.match(css, /var\(--gold\)/);
  assert.match(css, /var\(--surface-2\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i);
});

test("GET /bantuan/pixeldrain/ menyajikan halaman dari static", async () => {
  const response = await minta("/bantuan/pixeldrain/");
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /text\/html/);
  assert.match(response.body, /Pixeldrain menolak unduhan langsung/);
  assert.doesNotMatch(response.body, /<script\b/i);
});
