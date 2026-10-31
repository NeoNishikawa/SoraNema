/* ============================================================================
   Pelari ketiga uji browser.
   ----------------------------------------------------------------------------
   Suite dijalankan berurutan (supaya tidak berebut server/Chrome), tetapi
   TIDAK berhenti saat satu suite gagal: semua suite tetap dijalankan, lalu
   hasilnya dirangkum di akhir. Exit code 1 bila ada yang gagal, jadi aman
   dipakai sebagai gerbang sebelum rilis.

   Setiap suite punya batas waktu sendiri supaya browser yang menggantung
   tidak menahan seluruh rangkaian. Override dengan
   ILN_BROWSER_SUITE_TIMEOUT_MS (milidetik).

   Jalankan: npm run test:browser:all
   ========================================================================== */

const { spawn } = require("node:child_process");
const path = require("node:path");

const SUITES = [
  { name: "tekan", script: "press-limit-browser-test.js" },
  { name: "gerak", script: "motion-browser-test.js" },
  { name: "unduhan", script: "download-drive-browser-test.js" },
  { name: "laporan", script: "laporan-dua-pengguna-browser-test.js" },
];

const SUITE_TIMEOUT_MS = (() => {
  const nilai = Number(process.env.ILN_BROWSER_SUITE_TIMEOUT_MS);
  return Number.isFinite(nilai) && nilai >= 1000 ? nilai : 5 * 60 * 1000;
})();

function runSuite(suite) {
  return new Promise((resolve) => {
    const mulai = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, suite.script)], {
      stdio: "inherit",
      env: process.env,
    });
    let selesai = false;
    let kehabisanWaktu = false;
    const timer = setTimeout(() => {
      kehabisanWaktu = true;
      try { child.kill("SIGKILL"); } catch { /* proses mungkin sudah berhenti */ }
    }, SUITE_TIMEOUT_MS);
    timer.unref?.();
    const finish = (code, signal, error) => {
      if (selesai) return;
      selesai = true;
      clearTimeout(timer);
      resolve({ ...suite, code, signal, error, kehabisanWaktu, ms: Date.now() - mulai });
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("exit", (code, signal) => finish(code, signal, null));
  });
}

function detail(hasil) {
  if (hasil.error) return `error: ${hasil.error.message}`;
  if (hasil.kehabisanWaktu) return `timeout ${Math.round(SUITE_TIMEOUT_MS / 1000)} dtk`;
  if (hasil.signal) return `sinyal ${hasil.signal}`;
  return `exit ${hasil.code}`;
}

async function main() {
  console.log(`\n${SUITES.length} suite browser dijalankan berurutan.`);
  const hasil = [];
  for (const suite of SUITES) {
    console.log(`\n=== ${suite.name}: ${suite.script} ===`);
    const selesai = await runSuite(suite);
    const lulus = !selesai.error && !selesai.kehabisanWaktu && selesai.code === 0;
    console.log(`=== ${lulus ? "LULUS" : "GAGAL"} ${suite.name} (${detail(selesai)}) ===`);
    hasil.push({ ...selesai, lulus });
  }

  console.log("\n=== Ringkasan uji browser ===");
  for (const item of hasil) {
    const status = item.lulus ? "LULUS" : "GAGAL";
    console.log(`${status}  ${item.name.padEnd(8)} ${(item.ms / 1000).toFixed(1)} dtk  ${detail(item)}`);
  }
  const gagal = hasil.filter((item) => !item.lulus).length;
  console.log(`\n${hasil.length - gagal}/${hasil.length} suite lulus.`);
  if (gagal) console.log("Jalankan suite yang GAGAL satu per satu untuk detail lengkapnya.");
  process.exitCode = gagal ? 1 : 0;
}

main();
