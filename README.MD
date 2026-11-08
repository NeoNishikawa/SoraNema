<div align="center">

<img src="public/assets/logo.png" alt="Logo SoraNema" width="120" />

# SoraNema

### *Your Anime Dekstop*

Pelacak anime pribadi: katalog, detail, episode, mirror unduhan, dan progres menonton
yang tersimpan di browser sendiri — tanpa akun, tanpa server antara, tanpa ribet.

[![versi](https://img.shields.io/badge/versi-3.0.0-ef6c00?style=flat-square)](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe)
[![unduh-exe](https://img.shields.io/badge/%E4%B8%8B%E4%BD%8D%E5%AF%B9%E4%B8%BA%8B-Windows%20%28EXE%29-007acc?style=for-the-badge)](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe)
[![web](https://img.shields.io/badge/%E4%B8%8B%E4%BD%8D%E5%AF%B9%E4%B8%BA%8B-Web%20%28Railway%29-0db97e?style=for-the-badge)](https://soranema.up.railway.app)
[![node](https://img.shields.io/badge/Node-%3E%3D24.22.1-43853d?style=flat-square)](https://nodejs.org)
[![test](https://img.shields.io/badge/test-492%20lulus-2ea44f?style=flat-square)](#pemeriksaan)
[![seal](https://img.shields.io/badge/seal-iln:3520811581-8a2be2?style=flat-square)](#pemeriksaan)

</div>

---

## ✨ Fitur

- **Katalog ganda** — Animasu + HiAnime, judul Animasu menang, HiAnime menambah yang tidak ada (mis. Cyberpunk: Edgerunners 2).
- **Detail + episode** — daftar episode, player mirror, label episode, kontrol Lengkap.
- **Unduhan link-out** — resolusi → sumber (Masu/Mega) → tautan; host difilter server (Google Drive, Mega, MediaFire, Pixeldrain).
- **Local Storage** — koleksi, progres, favorit, import/export, edit mode, sediakan data tanpa server.
- **Lanjutkan Menonton + Rekomendasi Genre** — rail horizontal, satu baris kartu yang bisa digeser.
- **Screen time** — penghitung waktu menonton, ambang, aman multi-tab.
- **Spring-clean** — pemeliharaan katalog & pencarian otomatis, data pribadi tidak hilang.

## 📥 Unduh

| Platform | Berkas | Ukuran | Tautan |
|---|---|---|---|
| 🌐 Web | — (langsung jalan) | — | [soranema.up.railway.app](https://soranema.up.railway.app) |
| 🪟 Windows (.exe) | `SoraNema_X0.V4.N6_x64-setup.exe` | ~45 MB | [GitHub Releases — tag `exe`](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe) |
| 🤖 Android (.apk) | `SoraNema-release.apk` | ~2,4 MB | GitHub Releases — tag `apk` |

> Installer EXE **X0.V4.N6** (0.4.6) — pembaruan otomatis dari aplikasi: cek → unduh → pasang → aplikasi dibuka kembali sendiri. Kalau SmartScreen menampilkan **Unknown Publisher**, klik **More info** lalu **Run anyway** — itu normal untuk build independen, dan hanya untuk berkas dari halaman rilis resmi SoraNema.

## 🚀 Menjalankan

```bash
npm install
npm start
```

Server lokal memakai port `3099` secara bawaan. Buka `http://127.0.0.1:3099/`.

## ✅ Pemeriksaan

```bash
npm test            # 492 lulus, 1 gagal pre-existing (TRUST_PROXY lama)
npm run seal:check  # segel integritas iln:3520811581
npm run test:keys   # audit kunci pencarian
```

`npm run test:browser:all` menjalankan rangkaian uji browser yang tersedia.
Halaman bantuan dan halaman pemeliharaan sengaja tidak memuat JavaScript.

## 🧱 Struktur singkat

| Path | Isi |
|---|---|
| `server.js` | Server Express, API `/api/*`, dan halaman perantara unduhan |
| `public/` | UI, aset, halaman bantuan, dan halaman pemeliharaan |
| `edge/` | Lapisan PHP opsional untuk proxy dan halaman tepi |
| `scripts/` | Seal, audit, dan skrip uji |
| `test/` | Test Node untuk kontrak server dan UI |

## 📜 Catatan rilis

Semua catatan rilis, termasuk rilis desktop terbaru, ada di halaman
[GitHub Releases](https://github.com/NeoNishikawa/SoraNema/releases/tag/exe).

---

<div align="center">

*Dibuat dengan ♥ oleh Neo dan Ciel — SoraNema, rumah anime di Gratis untukmu.*

</div>
