# Audit Keterbacaan Font SoraNema

Tanggal audit: 30 Oktober 2026

## Tujuan

Audit ini dilakukan setelah meninjau screenshot bagian **Download Batch** dan **Pilih resolusi**. Tujuannya adalah mencari teks lain di aplikasi yang terlalu kecil bagi pengguna dengan rabun, lalu memperbesar teks informatif tanpa memperbesar gambar atau merusak hierarki visual.

## Temuan

Beberapa teks UI menggunakan ukuran sekitar 9–12 px, terutama pada:

- metadata sidebar dan label navigasi;
- filter genre, menu aksi, dan panel profil;
- metadata kartu anime dan progress episode;
- label detail, mirror, player, toast, dan dialog;
- kartu Continue Watching dan rekomendasi;
- keterangan Download Batch dan metadata sumber Masu/Mega;
- teks pengingat screen-time serta banner pemeliharaan.

Ukuran tersebut memang masih dapat terbaca pada layar besar, tetapi terlalu kecil pada screenshot berukuran sempit dan kurang nyaman untuk pengguna dengan gangguan penglihatan.

## Perubahan yang dilakukan

### 1. Area Download Batch

Ukuran teks pada `public/css/components.css` dinaikkan secara bertahap untuk:

- jumlah batch dan tautan;
- catatan instruksi unduhan;
- rentang episode;
- tombol `Pilih resolusi`;
- pilihan `360p`, `480p`, `720p`, `1080p`, dan `Full HD`;
- metadata Masu/Mega;
- catatan dan tautan unduhan.

Perubahannya bersifat ringan, sekitar 6–15%, agar panel tidak menjadi terlalu padat.

### 2. UI aplikasi lainnya

File baru `public/css/accessibility-fonts.css` ditambahkan dan dimuat paling akhir agar menjadi override aksesibilitas. File ini memperbesar teks informatif pada:

- sidebar dan menu navigasi;
- filter dan menu profil;
- kartu anime, metadata, progress, dan tombol kecil;
- detail anime dan daftar mirror;
- toast, dialog, Continue Watching, serta rekomendasi;
- screen-time reminder dan maintenance banner.

Teks dekoratif atau elemen yang memang berukuran kecil tidak diubah, misalnya:

- angka badge yang sangat ringkas;
- placeholder gambar seperti `ANIME IMAGE`;
- teks dekorasi cursor dan animasi;
- ikon tanpa teks.

### 3. Cache browser

`public/index.html` memuat stylesheet baru dengan query version:

```html
/css/accessibility-fonts.css?v=1.0.0
```

Dengan demikian browser tidak menggunakan stylesheet lama yang tersimpan di cache.

### 4. Pengujian

Test screen-time tetap disertakan dan sekarang memeriksa bahwa stylesheet aksesibilitas menyediakan ukuran minimum yang lebih nyaman untuk dialog screen-time.

Pemeriksaan sintaks JavaScript dapat dijalankan dengan:

```bash
for f in server.js settings.js shutdown.js public/js/*.js scripts/*.js test/*.test.js; do
  node --check "$f"
done
```

Test proyek utama dapat dijalankan setelah dependensi dipasang:

```bash
npm install
npm test
```

## Catatan

WCAG tidak menetapkan satu ukuran font universal untuk seluruh antarmuka. Karena itu perubahan ini memakai pendekatan proporsional: teks yang menyampaikan informasi diperbesar, sedangkan elemen dekoratif tetap kecil agar layout dan kepadatan kartu tidak berubah drastis.
