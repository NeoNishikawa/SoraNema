<div align="center">

<img src="public/assets/logo.png" alt="Logo SoraNema" width="120" />

# SoraNema

### Your Anime Desktop

Pelacak anime pribadi: katalog, detail, episode, dan progres menonton
yang tersimpan di perangkat sendiri — tanpa akun, tanpa server perantara, tanpa ribet.

[![Windows EXE](https://img.shields.io/badge/Windows%20EXE-007acc?style=for-the-badge&logo=windows)](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe-Hane)
[![Android APK](https://img.shields.io/badge/Android%20APK-3ddc84?style=for-the-badge&logo=android)](https://github.com/NeoNishikawa/SoraNema/releases/tag/apk)
[![Web Railway](https://img.shields.io/badge/Web%20Railway-0db97e?style=for-the-badge)](https://soranema.up.railway.app)

</div>

---

## Tentang

SoraNema adalah aplikasi pelacak anime pribadi: katalog, detail, episode, dan progres menonton, dengan seluruh data tersimpan di perangkat sendiri. Tidak ada akun, tidak ada server perantara antara perangkat dan sumber katalog; data pribadi tidak pernah meninggalkan perangkat.

## SoraHane (Windows)

SoraHane adalah varian Windows yang lebih ringan dari SoraNema X0.V4.N6. Bagian antarmuka ditulis ulang tanpa framework, dengan server Express lokal minimal, supaya aplikasi terbuka cepat dan tidak membawa bagian yang tidak dipakai.

- **Intro 5 detik** — logo, nama, dan "O tanoshimi kudasai". Intro menutupi waktu muat data: katalog sudah diminta di latar belakang, jadi halaman utama langsung terisi saat intro selesai.
- **Auto-update** — sejak H1 aplikasi memeriksa `latest.json` saat dibuka dan memasang versi baru sendiri (selepas 1.0.1: otomatis).
- **Pencarian** — hanya hasil yang benar-benar cocok; sementara mencari, status "Mencari...".
- **Lanjutkan Menonton** — rail di atas katalog yang berisi episode terakhir (dari `localStorage`, maks 24); klik melanjutkan episode itu.
- **Pemutar** — Tutup/`Esc`, daftar mirror, penanda mirror mati (diputar yang hidup).
- **Data lokal** — progres menonton tersimpan di perangkat; tanpa akun dan tanpa server perantara.
- **Installer 4.6 MiB** (membawa dependensi server).

Unduh: **[SoraHane H1](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe-Hane)**

## Fitur (Windows, Android, Web)

- **Katalog & detail** — daftar anime, sinopsis, status, tipe, rating, studio, daftar episode.
- **Lanjutkan Menonton** — progres tersimpan per anime; ketuk kartu untuk langsung lanjut ke episode berikutnya.
- **Koleksi** — simpan anime favoritmu; hapus banyak sekaligus; ekspor dan impor koleksi sebagai file JSON.
- **Pencarian & genre** — ketik judul, atau tambahkan `/genre:romansa,isekai` untuk menyaring berdasarkan ratusan genre.
- **Episode berjendela** — daftar episode panjang dimuat bertahap agar aplikasi tetap ringan.
- **Layar utama** — koleksi, lanjutkan menonton, dan panduan muncul semuanya; progres tersimpan lokal.

### Android (.apk)

- **Streaming native** — player video bawaan; sumber video yang tidak bisa diputar langsung dibuka lewat browser.
- **Populer Hari Ini & Update Harian** — di halaman depan, data termuat otomatis.
- **Intro sistem** — setiap kali aplikasi dibuka, sistem intro diputarkan; data dimuat di latar selama intro berjalan, jadi Beranda langsung terisi.
- **Gratis sepenuhnya** — tanpa iklan, tanpa pembelian, tanpa biaya tersembunyi.

## Keamanan & cara memasang

Aplikasi belum terdaftar di App Store atau Google Play, jadi insting pertama perangkat kamu mungkin menolak. Itu normal — bukan tanda berbahaya.

### Android

1. Unduh `SoraNema-I0.V1-release.apk` dari [halaman rilis](https://github.com/NeoNishikawa/SoraNema/releases/tag/apk).
2. Buka berkas yang sudah diunduh.
3. Bila muncul jendela "Pemblokiran menginstal aplikasi dari sumber tidak dikenal", ketuk **Pengaturan** lalu aktifkan **Izinkan dari sumber ini**.
4. Kembali; ketuk **Install**.

Kamu hanya perlu menyalakan izin ini sekali khusus untuk SoraNema. Setelah pasang selesai, kamu boleh mematikan izinnya lagi di `Pengaturan → Aplikasi → SoraNema`.

### Windows

1. Unduh `SoraHane_1.0.0_x64-setup.exe` dari [halaman rilis](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe-Hane).
2. Buka berkas yang diunduh.
3. Bila muncul jendela **Windows SmartScreen**, ketuk **More info**, lalu **Run anyway**.
4. Ikuti petunjuk installer seperti biasa.

### Verifikasi

Di halaman [rilis](https://github.com/NeoNishikawa/SoraNema/releases/tag/apk), SHA-256 berkas `SoraNema-I0.V1-release.apk` tercantum; kamu boleh membandingkannya dengan berkas yang kamu unduh untuk memastikan cocok.

### Kenapa "sumber tidak dikenal"?

Karena perangkat memperlakukan semua aplikasi non–Play Store sebagai "tidak dikenal". Itu bukan peringatan virus; itu perangkat bertanya apakah kamu percaya aplikasi ini. Kamu yang memutuskan — kami tidak bisa menyalakan izinnya untuk kamu, dan kamu bisa kapan pun mematikannya lagi.
