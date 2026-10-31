/* Mematikan server dengan anggun: listener ditutup SEKARANG, request yang
   sedang berjalan diselesaikan dulu, baru proses keluar.

   Kenapa tidak cukup process.exit(): pencarian dan unduhan Samehadaku bisa
   memakan 10-20 detik, jadi restart di tengah request memotong respons dan
   browser melaporkan kegagalan yang sebenarnya cuma "server baru di-restart".

   server.close() menutup socket listener secara sinkron, lalu callback-nya
   menunggu semua koneksi selesai. Artinya port sudah bebas dipakai proses
   pengganti sementara permintaan lama masih dilayani proses ini - tidak ada
   jeda "port kosong" saat npm run dev me-restart.

   Keep-alive yang tidak pernah menutup tidak boleh menahan proses selamanya,
   jadi ada batas waktu: lewat batas, keluar paksa dengan peringatan. */
function createGracefulShutdown(server, options = {}) {
  const batasMs = Number(options.batasMs) > 0 ? Number(options.batasMs) : 60_000;
  const keluar = typeof options.keluar === "function" ? options.keluar : (kode) => process.exit(kode);
  const log = typeof options.log === "function" ? options.log : () => {};
  const setelahListenerDitutup = typeof options.setelahListenerDitutup === "function" ? options.setelahListenerDitutup : () => {};
  let sedangDitutup = false;
  let paksa = null;

  function matikan(signal) {
    if (sedangDitutup) return false;
    sedangDitutup = true;
    log(`${signal} diterima: listener ditutup, koneksi aktif dibiarkan selesai.`);
    server.close((error) => {
      if (paksa) clearTimeout(paksa);
      if (error) log(`Penutupan server melaporkan: ${error.message}`);
      keluar(0);
    });
    /* Koneksi idle (keep-alive yang tidak dipakai) tidak perlu ditunggu, dan
       kalau dibiarkan server.close tidak pernah selesai. Koneksi yang sedang
       mengirim/menerima tetap jalan. */
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    /* Kabar ke supervisor dev bahwa port sudah lepas, jadi proses pengganti
       boleh dijalankan sekarang juga tanpa menunggu request terakhir. */
    setelahListenerDitutup();
    paksa = setTimeout(() => {
      log(`Koneksi masih aktif setelah ${Math.round(batasMs / 1000)} detik; keluar paksa.`);
      keluar(0);
    }, batasMs);
    if (typeof paksa.unref === "function") paksa.unref();
    return true;
  }

  return { matikan, sedangDitutup: () => sedangDitutup };
}

module.exports = { createGracefulShutdown };
