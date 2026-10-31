const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createGracefulShutdown } = require("../shutdown");

const root = path.join(__dirname, "..");

function permintaan(port, jalur) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: jalur, agent: false }, (response) => {
      let isi = "";
      response.setEncoding("utf8");
      response.on("data", (potongan) => { isi += potongan; });
      response.on("end", () => resolve({ status: response.statusCode, body: isi }));
    });
    req.on("error", reject);
  });
}

test("mematikan anggun: listener ditutup dulu, request yang sedang jalan tetap selesai", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/lambat") {
      setTimeout(() => response.end("selesai"), 400);
      return;
    }
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const kodeKeluar = [];
  const pemutus = createGracefulShutdown(server, { keluar: (kode) => kodeKeluar.push(kode) });

  const sedangJalan = permintaan(port, "/lambat");
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(pemutus.matikan("SIGTERM"), true, "penutupan pertama diterima");
  assert.equal(pemutus.matikan("SIGTERM"), false, "penutupan kedua diabaikan");

  /* Port harus sudah lepas saat request lama masih berjalan: itu alasan
     proses pengganti bisa langsung memakai port yang sama. */
  await assert.rejects(permintaan(port, "/"), (error) => ["ECONNREFUSED", "ECONNRESET"].includes(error.code));

  const hasil = await sedangJalan;
  assert.equal(hasil.status, 200);
  assert.equal(hasil.body, "selesai", "respons yang sedang berjalan tidak boleh terpotong");

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(kodeKeluar, [0], "keluar sekali dengan kode 0 setelah koneksi habis");
});

test("npm run dev: perubahan file me-restart server tanpa memotong request yang sedang jalan", async (t) => {
  /* Berkas pemicu terpisah supaya test tidak mengubah sumber yang dipantau
     (menulis file sumber saat diuji bisa memicu restart berantai). */
  const pemicu = path.join(os.tmpdir(), `iln-dev-watch-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(pemicu, "1");

  const siap = [];
  let log = "";
  const anakDev = spawn(process.execPath, [path.join(root, "scripts", "dev-watch.js")], {
    cwd: root,
    env: { ...process.env, PORT: "0", DEV_ENTRY: "test/fixtures/dev-watch-child.js", DEV_WATCH_EXTRA: pemicu },
    stdio: ["ignore", "pipe", "pipe"],
  });
  anakDev.stdout.setEncoding("utf8");
  anakDev.stdout.on("data", (potongan) => {
    log += potongan;
    for (const cocok of potongan.matchAll(/FIXTURE_SIAP (\d+) (\d+)/g)) {
      siap.push({ port: Number(cocok[1]), pid: Number(cocok[2]) });
    }
  });
  anakDev.stderr.setEncoding("utf8");
  anakDev.stderr.on("data", (potongan) => { log += potongan; });

  t.after(() => {
    anakDev.kill("SIGKILL");
    for (const { pid } of siap) {
      try { process.kill(pid); } catch (_) { /* sudah keluar */ }
    }
    try { fs.unlinkSync(pemicu); } catch (_) { /* sudah hilang */ }
  });

  const tunggu = async (cek, pesan, batasMs = 15000) => {
    const akhir = Date.now() + batasMs;
    while (Date.now() < akhir) {
      if (cek()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`${pesan}\n--- log dev ---\n${log}`);
  };

  await tunggu(() => siap.length >= 1, "server pertama harus siap");
  const pertama = siap[0];

  const sedangJalan = permintaan(pertama.port, "/lambat");
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.writeFileSync(pemicu, `2 ${Date.now()}`);

  await tunggu(() => siap.length >= 2, "proses pengganti harus dijalankan setelah perubahan");
  assert.match(log, /restart \(request aktif diselesaikan dulu\)/);

  const hasil = await sedangJalan;
  assert.equal(hasil.status, 200, "koneksi yang sedang berjalan tidak boleh diputus restart");
  assert.equal(hasil.body, "selesai");

  const hasilPengganti = await permintaan(siap[1].port, "/");
  assert.equal(hasilPengganti.body, "ok", "proses pengganti melayani permintaan di port barunya");
});
