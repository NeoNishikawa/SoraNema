#!/usr/bin/env node
/* Server pengembangan yang selalu memuat kode terbaru TANPA memotong request
   yang sedang berjalan.

   `node --watch` tidak bisa dipakai untuk ini: ia me-restart di dalam proses
   yang sama, jadi socket yang sedang dilayani ikut dibuang. Diuji langsung
   dengan request 2,5 detik: begitu file disentuh, curl menerima HTTP 000
   (koneksi putus) di tengah respons.

   Skrip ini menjalankan server.js sebagai proses anak lalu memakai jalur yang
   sama dengan Ctrl+C (lihat shutdown.js):
     1. kirim "berhenti-anggun" lewat IPC - anak menutup listener tapi tetap
        menyelesaikan request yang sedang berjalan;
     2. tunggu kabar "listener-ditutup", artinya port sudah lepas;
     3. jalankan proses pengganti SAAT ITU JUGA, jadi tidak ada jeda ketika
        port kosong sementara request lama masih dilayani proses lama.

   Restart memakai IPC, bukan SIGTERM, karena di Windows child.kill() langsung
   mematikan proses tanpa menjalankan handler JS apa pun. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const AKAR = path.resolve(__dirname, "..");
const ENTRI = path.resolve(AKAR, process.env.DEV_ENTRY || "server.js");
/* Perubahan disatukan dulu: satu penyimpanan editor bisa memicu beberapa
   event, dan restart berlapis akan menjalankan dua server sekaligus. */
const JEDA_GABUNG_MS = 250;
const BATAS_TUNGGU_TUTUP_MS = 8000;
const JEDA_ULANG_AWAL_MS = 300;
const JEDA_ULANG_MAKS_MS = 5000;

/* Berkas yang dipantau = entri ditambah semua modul lokal yang di-require
   (langsung atau tidak langsung), mis. settings.js. public/ sengaja tidak
   dipantau: aset statis dibaca dari disk setiap request, jadi tidak perlu
   restart, dan menontonnya akan me-restart server setiap kali CSS disimpan. */
function kumpulkanBerkas(berkas, hasil = new Set()) {
  const absolut = path.resolve(berkas);
  if (hasil.has(absolut) || !fs.existsSync(absolut) || !fs.statSync(absolut).isFile()) return hasil;
  hasil.add(absolut);
  const isi = fs.readFileSync(absolut, "utf8");
  for (const cocok of isi.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const dasar = path.resolve(path.dirname(absolut), cocok[1]);
    for (const kandidat of [dasar, `${dasar}.js`, path.join(dasar, "index.js")]) {
      if (fs.existsSync(kandidat) && fs.statSync(kandidat).isFile()) {
        kumpulkanBerkas(kandidat, hasil);
        break;
      }
    }
  }
  return hasil;
}

const dipantau = kumpulkanBerkas(ENTRI);
for (const tambahan of String(process.env.DEV_WATCH_EXTRA || "").split(",")) {
  const nama = tambahan.trim();
  if (nama) kumpulkanBerkas(path.resolve(AKAR, nama), dipantau);
}

function tandaBerkas(berkas) {
  try {
    const info = fs.statSync(berkas);
    return `${info.mtimeMs}:${info.size}`;
  } catch (_) {
    return null;
  }
}

let jedaUbah = null;
function jadwalkanUlang(sebab) {
  /* Cap mtime disegarkan sekarang juga: perubahan ini akan termuat oleh
     proses pengganti, jadi pemeriksa berkala di bawah tidak me-restart untuk
     kedua kalinya pada perubahan yang sama. */
  for (const berkas of dipantau) {
    const tanda = tandaBerkas(berkas);
    if (tanda) tandaTerakhir.set(berkas, tanda);
  }
  if (jedaUbah) clearTimeout(jedaUbah);
  jedaUbah = setTimeout(() => { jedaUbah = null; mulaiUlang(sebab); }, JEDA_GABUNG_MS);
}

/* Memantau direktori, bukan masing-masing file: editor di Windows menyimpan
   dengan rename, yang membuat watcher per-file berhenti menerima kabar
   setelah penyimpanan pertama. */
const perDirektori = new Map();
for (const berkas of dipantau) {
  const direktori = path.dirname(berkas);
  if (!perDirektori.has(direktori)) perDirektori.set(direktori, new Set());
  perDirektori.get(direktori).add(path.basename(berkas));
}
for (const [direktori, nama] of perDirektori) {
  try {
    fs.watch(direktori, { persistent: true }, (_peristiwa, berkas) => {
      if (berkas && !nama.has(String(berkas))) return;
      jadwalkanUlang(path.relative(AKAR, berkas ? path.join(direktori, String(berkas)) : direktori) || path.basename(direktori));
    });
  } catch (error) {
    console.error(`[dev] tidak bisa memantau ${direktori}: ${error.message}`);
  }
}

/* fs.watch bisa melewatkan event: buffer ReadDirectoryChangesW penuh kalau
   banyak berkas berubah berdekatan, dan satu perubahan lalu tidak pernah
   termuat sampai restart berikutnya. Pemeriksaan mtime tiap detik jadi jaring
   pengaman - biayanya empat fs.stat per detik - sehingga "server selalu
   memuat kode terbaru" tidak bergantung pada event yang bisa hilang. */
const tandaTerakhir = new Map();
for (const berkas of dipantau) {
  const tanda = tandaBerkas(berkas);
  if (tanda) tandaTerakhir.set(berkas, tanda);
}
setInterval(() => {
  for (const berkas of dipantau) {
    const tanda = tandaBerkas(berkas);
    if (!tanda || tandaTerakhir.get(berkas) === tanda) continue;
    tandaTerakhir.set(berkas, tanda);
    jadwalkanUlang(path.relative(AKAR, berkas));
  }
}, 1000).unref?.();

const hidup = new Set();
let anak = null;
let mengganti = false;
let perluUlang = false;
let berhenti = false;
let jedaUlangMs = JEDA_ULANG_AWAL_MS;

function jalankan() {
  const mulai = Date.now();
  const proses = spawn(process.execPath, [ENTRI], {
    cwd: AKAR,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  anak = proses;
  hidup.add(proses);

  proses.on("exit", (kode, sinyal) => {
    hidup.delete(proses);
    if (berhenti) {
      if (hidup.size === 0) process.exit(0);
      return;
    }
    if (proses !== anak) {
      console.log("[dev] proses lama selesai: semua koneksinya sudah ditutup.");
      return;
    }
    anak = null;
    /* Server sehat berjalan lama; kalau baru saja hidup lalu mati lagi,
       beri jeda makin panjang supaya crash-loop (mis. port terpakai) tidak
       membanjiri log dan port dengan percobaan tiap 300 ms. */
    if (Date.now() - mulai > 10_000) jedaUlangMs = JEDA_ULANG_AWAL_MS;
    console.log(`[dev] server berhenti (${sinyal || `kode ${kode}`}); menjalankan ulang dalam ${jedaUlangMs} ms.`);
    setTimeout(() => { if (!berhenti && !anak) jalankan(); }, jedaUlangMs);
    jedaUlangMs = Math.min(jedaUlangMs * 2, JEDA_ULANG_MAKS_MS);
  });

  return proses;
}

function mulaiUlang(sebab) {
  if (berhenti) return;
  if (mengganti) { perluUlang = true; return; }
  const lama = anak;
  if (!lama) return;
  mengganti = true;
  perluUlang = false;
  console.log(`[dev] ${sebab} berubah -> restart (request aktif diselesaikan dulu).`);

  const lanjut = () => {
    if (!mengganti) return;
    mengganti = false;
    clearTimeout(batas);
    lama.removeListener("message", saatPesan);
    lama.removeListener("exit", saatKeluar);
    jalankan();
    if (perluUlang) { perluUlang = false; mulaiUlang("perubahan berikutnya"); }
  };
  const saatPesan = (pesan) => {
    if (pesan && pesan.type === "listener-ditutup") lanjut();
  };
  const saatKeluar = () => {
    /* Anak keluar sebelum sempat mengabari (crash saat start): port tidak
       ditahan siapa pun, jadi pengganti boleh langsung dijalankan. */
    lanjut();
  };
  const batas = setTimeout(() => {
    console.error(`[dev] proses lama tidak menutup listener dalam ${BATAS_TUNGGU_TUTUP_MS / 1000} detik; dihentikan paksa.`);
    lama.kill("SIGKILL");
  }, BATAS_TUNGGU_TUTUP_MS);
  if (typeof batas.unref === "function") batas.unref();

  lama.on("message", saatPesan);
  lama.on("exit", saatKeluar);
  try { lama.send({ type: "berhenti-anggun" }); } catch (_) { /* kanal sudah tertutup: prosesnya memang sudah berhenti */ }
}

function mintaBerhenti() {
  if (berhenti) {
    for (const proses of hidup) proses.kill("SIGKILL");
    process.exit(130);
  }
  berhenti = true;
  console.log("[dev] berhenti: menunggu koneksi aktif selesai (Ctrl+C sekali lagi untuk keluar paksa).");
  for (const proses of hidup) {
    if (proses === anak) {
      try { proses.send({ type: "berhenti-anggun" }); } catch (_) { proses.kill("SIGKILL"); }
    } else {
      proses.kill("SIGKILL");
    }
  }
  if (hidup.size === 0) process.exit(0);
}

process.on("SIGINT", mintaBerhenti);
process.on("SIGTERM", mintaBerhenti);

console.log(`[dev] memantau ${dipantau.size} berkas server (${path.relative(AKAR, ENTRI)}).`);
jalankan();
