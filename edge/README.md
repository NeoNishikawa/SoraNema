# edge — lapisan tepi PHP

Front controller kecil untuk `/api/*`. Tugasnya hanya tiga:

1. meneruskan request ke backend internal lewat daftar rute yang sudah dikenal,
2. menandatangani request edge → backend (`X-ILN-Edge`),
3. memeriksa pecahan seal dari klien tanpa memberi tahu penyerang bagian mana
   yang gagal.

Lapisan ini **tidak** melayani halaman, tidak menyimpan cache, dan tidak
menggantikan rate limit backend. Satu rute tetap satu pemilik.

## Struktur

| Berkas | Isi |
|---|---|
| `public/index.php` | front controller; hanya menangani `/api/*` |
| `src/ApiClient.php` | pemanggil cURL, allowlist rute, sanitasi path/query, tanda tangan HMAC |
| `src/SealGuard.php` | perbandingan digest dengan `hash_equals`, log server-side |
| `src/Config.php` | environment, batas waktu, batas ukuran respons |
| `tests/run.php` | uji unit allowlist, sanitasi, tanda tangan, seal |
| `tests/smoke.php` | dua server PHP sungguhan + stub backend, request HTTP nyata |
| `tests/stub-backend.php` | backend palsu untuk smoke test |

## Menjalankan

Butuh PHP 8.2+ dengan ekstensi `curl` dan `json`.

```bash
ILN_BACKEND_URL=http://127.0.0.1:3099 \
php -S 127.0.0.1:8080 edge/public/index.php
```

`public/index.php` dipakai sebagai router script. Untuk nginx + PHP-FPM:

```nginx
location /api/ {
    try_files $uri /index.php$is_args$args;
}
```

lalu arahkan `fastcgi_pass` ke PHP-FPM seperti biasa. Backend sebaiknya hanya
mendengar di loopback atau dilindungi firewall; `X-ILN-Edge` bukan pengganti
firewall.

## Environment

| Variabel | Default | Arti |
|---|---|---|
| `ILN_BACKEND_URL` | `http://127.0.0.1:3099` | alamat backend internal; hanya `http`/`https`, tanpa userinfo |
| `ILN_SEAL_MODE` | `off` | `off`, `report`, atau `enforce` |
| `ILN_SEAL_DIGEST` | kosong | digest yang diharapkan, mis. `iln:123456789`; wajib saat mode bukan `off` |
| `ILN_EDGE_SECRET` | kosong | kunci HMAC untuk header `X-ILN-Edge`; kosong = header tidak dikirim |
| `ILN_UPSTREAM_TIMEOUT_MS` | `8000` | batas waktu request ke backend (500–30000) |
| `ILN_MAX_RESPONSE_BYTES` | `2097152` | batas ukuran respons backend (64 KiB–8 MiB) |

## Mode seal

Klien mengirim digest yang tertanam di halaman:

```
X-ILN-Seal: iln:123456789
```

`public/js/api.js` sudah mengirim header ini otomatis pada setiap request
API, memakai `verify().digest` dari `public/js/integrity.js`. Untuk mengetahui
nilai digest di mesin ini, buka DevTools di halaman aplikasi:

```js
import("/js/integrity.js").then((m) => console.log(m.verify().digest));
```

Lalu set `ILN_SEAL_DIGEST` ke nilai itu. `npm run test:seal-edge`
membuktikan rantai klien → edge → backend, termasuk saat header dihapus.

| Mode | Perilaku |
|---|---|
| `off` | tidak memeriksa; berguna saat klien lama belum mengirim header |
| `report` | memeriksa dan mencatat kegagalan, tetapi request tetap diteruskan |
| `enforce` | kegagalan dijawab `200` dengan `{"data":[],"total":0}` — bentuk yang sama dengan dataset kosong yang sah |

Saat `enforce`, respons **tidak** memuat kata "seal", "kunci", atau "invalid",
dan tidak ada header penanda. Detail hanya masuk `error_log` server (path dan
hash IP, bukan IP mentah).

Contoh mengaktifkan:

```bash
ILN_SEAL_MODE=enforce \
ILN_SEAL_DIGEST='iln:123456789' \
ILN_EDGE_SECRET='ganti-dengan-nilai-acak-panjang' \
ILN_BACKEND_URL=http://127.0.0.1:3099 \
php -S 127.0.0.1:8080 edge/public/index.php
```

## Batas keamanan

Ini penting, jangan dilebih-lebihkan:

- Header `X-ILN-Seal` **bukan autentikasi**. Siapa pun yang bisa membaca
  halaman bisa menyalin digest-nya. Pemeriksaan ini hanya menaikkan biaya
  bypass; ia tidak membuat bypass mustahil.
- `X-ILN-Edge` membuktikan sebuah request dibuat oleh lapisan tepi, bukan oleh
  pengunjung. Backend tetap harus menolak koneksi langsung dari luar.
- Respons datar saat seal gagal membuat percobaan bypass tidak mendapat sinyal
  "pemeriksaan ini yang menangkapmu". Ia tidak menyembunyikan fakta bahwa
  aplikasi tidak menampilkan data.
- Jangan taruh rahasia bisnis di klien. Seal sisi klien selalu bisa dibuka oleh
  pemilik salinan file.

## Uji

```bash
php edge/tests/run.php
php edge/tests/smoke.php
# atau
npm run test:edge
```

Smoke test menjalankan backend palsu dan edge di port acak, lalu memeriksa:
seal valid meneruskan data, seal salah/hilang mendapat bentuk kosong, rute tak
dikenal dan traversal 404, error backend tidak membocorkan pesan, POST dan
redirect diteruskan, serta `X-Powered-By` tidak muncul.
