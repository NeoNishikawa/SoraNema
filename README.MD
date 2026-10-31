# SoraNema V3

Pelacak anime pribadi: katalog, detail, episode, mirror unduhan, dan progres
menonton yang tersimpan di browser sendiri. Proyek ini adalah aplikasi web
Node.js; paket desktop dan Android dibangun dari rencana terpisah.

## Menjalankan

```bash
npm install
npm start
```

Server lokal memakai port `3099` secara bawaan. Buka
`http://127.0.0.1:3099/`.

## Pemeriksaan

```bash
npm test
npm run seal:check
npm run test:keys
```

`npm run test:browser:all` menjalankan rangkaian uji browser yang tersedia.
Halaman bantuan dan halaman pemeliharaan sengaja tidak memuat JavaScript.

## Unduhan

- **Windows** — `SoraNema-Setup-x64.exe` dari GitHub Releases.
- **Android** — `SoraNema-release.apk` dari GitHub Releases.

Nama berkas sengaja tidak membawa nomor versi supaya tautan tetap hidup antar
rilis. Aset harus diunggah ke repo rilis `NeoNishikawa/soranema-model` dengan
tag `exe` dan `apk`; kalau aset belum ada, tombol unduh akan menampilkan
halaman yang tidak tersedia.

## Peringatan Windows

Installer belum memakai sertifikat penerbit resmi, jadi Windows SmartScreen
dapat menampilkan **Unknown Publisher**. Itu normal untuk build independen.
Klik **More info** lalu **Run anyway** hanya untuk berkas yang kamu unduh dari
halaman rilis resmi SoraNema.

## Struktur singkat

| Path | Isi |
|---|---|
| `server.js` | server Express, API, dan halaman perantara unduhan |
| `public/` | UI, aset, halaman bantuan, dan halaman pemeliharaan |
| `edge/` | lapisan PHP opsional untuk proxy dan halaman tepi |
| `scripts/` | seal, audit, dan skrip uji |
| `test/` | test Node untuk kontrak server dan UI |
