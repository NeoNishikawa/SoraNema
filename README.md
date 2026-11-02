<div align="center">
  <img src="https://raw.githubusercontent.com/NeoNishikawa/SoraNema/main/public/assets/logo.png" width="120" alt="Logo SoraNema">
  <h1>SoraNema</h1>
  <p><strong>Pelacak anime untuk Windows.</strong><br>
  Katalog, episode, progres tonton, dan pustaka unduhan lokal dalam satu aplikasi.</p>

  <a href="https://github.com/NeoNishikawa/SoraNema/releases/tag/exe">
    <img src="https://img.shields.io/badge/Unduh-Windows%20x64-2ea44f?style=for-the-badge&logo=windows&logoColor=white" alt="Unduh SoraNema untuk Windows">
  </a>
  <br><br>
  <img src="https://img.shields.io/badge/versi-0.2.0-1f6feb?style=flat-square" alt="Versi 0.2.0">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4?style=flat-square&logo=windows" alt="Windows 10 dan 11">
  <img src="https://img.shields.io/badge/status-aktif-2ea44f?style=flat-square" alt="Status aktif">
</div>

---

## Tentang

SoraNema adalah aplikasi desktop Windows untuk menjelajah dan menonton anime dari katalog Animasu, lalu menyimpan sendiri progres serta daftar tontonanmu. Episode dan mirror tetap berasal dari sumber pihak ketiga; SoraNema tidak menghosting video dan tidak meminta akun.

Aplikasi ini dibuat untuk dipakai sendiri: koleksi, progres, dan favorit tersimpan di perangkat, bukan di server SoraNema. Kalau kamu sudah mengunduh anime ke komputer, fitur **Download** memindai folder itu dan menampilkannya sebagai pustaka lokal dengan judul dari nama folder dan episode dari nama berkas.

Build yang dibagikan di sini adalah **Windows x64**. Versi Android belum memiliki build publik, jadi README ini sengaja hanya memuat tautan Windows.

## Fitur

| Fitur | Yang didapat |
|---|---|
| Katalog dan pencarian | Judul, jadwal harian, genre, dan daftar episode dari Animasu. Episode yang belum tersedia bisa dilengkapi dari Samehadaku. |
| Rekomendasi | Rail **Terpopuler** dan rekomendasi genre dari anime yang sudah kamu tamatkan. |
| Pemutar | Mirror pilihan sumber, Picture-in-Picture, episode sebelumnya/berikutnya, dan lanjut otomatis. |
| Pustaka Download | Pindai folder lokal, filter persentase, sudah ditonton, favorit, rentang persentase, dan pencarian nama. Tanpa filter genre. |
| Progres dan favorit | Tersimpan di perangkat. Data online dan lokal dipisah supaya tidak saling mengotori. |
| Pembaruan | Cek versi dan pasang dari dalam aplikasi, lengkap dengan prompt administrator. |

## Unduh

| Platform | Berkas | Ukuran |
|---|---|---|
| Windows 10 / 11 (x64) | `SoraNema_0.2.0_x64-setup.exe` | 53 MB |

Tombol di atas menuju halaman rilis `exe`, tempat installer dan `latest.yml` disimpan. Halaman itu selalu menampilkan rilis Windows terbaru.

Build Android belum dibagikan. Kalau nanti sudah selesai, tautannya akan ditambahkan di halaman rilis yang sama.

## Cara pasang

1. Unduh installer dari halaman rilis.
2. Jalankan berkasnya. Instalasi bersifat per-mesin, jadi Windows akan meminta izin administrator.
3. Kalau SmartScreen menampilkan **Unknown Publisher**, pilih **More info** lalu **Run anyway**. Installer belum memakai sertifikat penerbit resmi.
4. Setelah terpasang, buka SoraNema. Kalau WebView2 belum ada, installer akan mengunduh komponennya.
5. Untuk fitur Download, pilih folder induk yang berisi semua anime, masing-masing di subfolder sendiri.

**Penting untuk versi lama:** pengguna 0.1.0 dan Electron 1.7.x harus memasang 0.2.0 **sekali secara manual**. Updater 0.1.0 menunjuk alamat repo yang salah, dan nomor 0.1.0 lebih rendah dari 1.7.x. Setelah 0.2.0 terpasang, pembaruan berikutnya berjalan di dalam aplikasi.

## Persyaratan

| | |
|---|---|
| Sistem | Windows 10 atau 11, 64-bit |
| Ruang | sekitar 53 MB untuk aplikasi, belum termasuk berkas video |
| Koneksi | diperlukan untuk katalog, episode, dan mirror |
| WebView2 | dipasang otomatis oleh installer bila belum ada |
| Akun | tidak diperlukan |

## Data dan privasi

- Tidak ada akun dan tidak ada unggahan koleksi ke server SoraNema.
- Koleksi, progres, dan favorit disimpan di localStorage WebView2.
- Folder unduhan hanya **dibaca**. Lokasi folder disimpan di `%APPDATA%\SoraNema\unduhan.json`.
- Permintaan katalog dan mirror dikirim langsung ke sumber pihak ketiga, bukan lewat akun atau server pribadi.
- Menghapus data aplikasi akan menghapus koleksi dan progres. Video di folder unduhan tidak disentuh.

## Yang baru di 0.2.0

- Rekomendasi **Terpopuler** dan genre dari anime yang sudah ditamatkan.
- Pustaka **Download** untuk memindai folder anime lokal, lengkap dengan PiP dan lanjut otomatis.
- Perbaikan updater: installer dijalankan dengan elevasi, menampilkan progres pasif, lalu aplikasi dibuka ulang dalam versi baru.
- Penguatan jembatan desktop dengan token sesi dan penolakan redirect lintas host atau port.

Catatan rilis lengkap ada di halaman [rilis `exe`](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe).

## Isi repo

| Path | Isi |
|---|---|
| `server.js` | Server Express, API katalog, dan halaman perantara unduhan |
| `public/` | UI, aset, halaman bantuan, dan halaman pemeliharaan |
| `edge/` | Lapisan PHP opsional untuk proxy dan halaman tepi |
| `scripts/` | Seal, audit, dan skrip uji |
| `test/` | Test Node untuk kontrak server dan UI |

## Laporan

Menemukan bug atau punya saran? Buka [Issues](https://github.com/NeoNishikawa/SoraNema/issues) dan sertakan versi aplikasi, langkah yang kamu lakukan, dan pesan error yang muncul.

## Catatan

SoraNema tidak berafiliasi dengan Animasu, Samehadaku, atau layanan mirror mana pun. Aplikasi ini tidak menghosting video dan tidak menyediakan tautan unduhan anime. Gunakan sesuai hukum yang berlaku di tempatmu.

<div align="center">
  <sub>Dibuat dan dirawat oleh NeoNishikawa.</sub>
</div>
