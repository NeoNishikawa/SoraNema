const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* Nama lama tidak boleh kembali lewat file yang ikut dikirim ke pengguna.
   Test ini sengaja membaca isi, bukan cuma nama berkas: satu komentar atau
   judul yang tertinggal sudah cukup membuat paket membawa merek lama. */
const ROOT = path.join(__dirname, "..");
/* Disusun dari potongan supaya berkas test ini sendiri tidak membawa
   rangkaian nama lama ke paket yang diperiksa. */
const OLD_BRAND = new RegExp(
  `${["i", "love", "nime"].join("")}|i[\\s_-]?${["love", "nime"].join("")}`,
  "i",
);
const TEXT_EXT = new Set([".js", ".mjs", ".html", ".css", ".json", ".php", ".md", ".txt", ".svg", ".webmanifest", ".yml", ".yaml"]);
const SKIP_DIRS = new Set(["node_modules", "release", "dist", "build", ".git", ".freebuff"]);

function walk(dir, hasil = []) {
  if (!fs.existsSync(dir)) return hasil;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, hasil);
      continue;
    }
    hasil.push(full);
  }
  return hasil;
}

const shipped = [
  "server.js",
  "settings.js",
  "package.json",
  "README.MD",
  ...walk(path.join(ROOT, "public")),
  ...walk(path.join(ROOT, "edge")),
  ...walk(path.join(ROOT, "desktop")),
].map((item) => path.join(ROOT, item));

test("nama merek lama tidak ada di sumber yang ikut dipaketkan", () => {
  const offenders = [];
  for (const file of shipped) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    if (OLD_BRAND.test(relative)) offenders.push(relative);
    if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
    if (OLD_BRAND.test(fs.readFileSync(file, "utf8"))) offenders.push(relative);
  }
  assert.deepEqual([...new Set(offenders)], [],
    "nama merek lama ditemukan di berkas yang ikut dipaketkan");
});
