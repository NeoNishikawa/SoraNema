if (typeof globalThis.registerSeal === "function") globalThis.registerSeal("tautanmati", "copyright SoraNema");
/* ==========================================================================
   SoraNema — Catatan tautan mati (unduhan & mirror)

   Server sengaja TIDAK memprobe host unduhan sebelum menampilkan tautan:
   probe HEAD/Range ke Google Drive memberi sinyal palsu dan bisa memicu
   kuota, sementara Pixeldrain/Mega menolak permintaan tanpa halaman asal.
   Karena itu "mati" adalah pengetahuan yang datang dari pengguna sendiri
   saat sebuah tautan/mirror gagal dibuka. Catatan disimpan lokal, dipakai
   untuk menyembunyikan tautan itu pada render berikutnya, dan kedaluwarsa
   sendiri supaya tautan yang sudah diperbaiki sumbernya bisa muncul lagi.
   ========================================================================== */
export const KUNCI_SIMPAN = "iln:tautan-mati:v1";
/* Tanda "sudah hidup lagi" dari pengguna. Dipakai untuk menimpa laporan
   publik: kalau pengguna sendiri melihat tautan itu berfungsi, laporan
   orang lain tidak boleh menyembunyikannya lagi untuk pengguna ini. */
export const KUNCI_HIDUP = "iln:tautan-hidup:v1";
/* Token anonim per browser. Server hanya menerima hash-nya, jadi laporan
   dari dua perangkat bisa dihitung dua tanpa menyimpan IP. */
export const KUNCI_PELAPOR = "iln:pelapor:v1";
export const UMUR_HARI = 30;
export const UMUR_MS = UMUR_HARI * 24 * 60 * 60 * 1000;
export const BATAS_ITEM = 400;

const teks = (value) => String(value ?? "").trim();

/* Identitas stabil untuk sebuah tautan unduhan. Halaman perantara
   /unduh/<token> TIDAK bisa dipakai sebagai kunci: token ditandatangani
   dengan masa berlaku, jadi path-nya berubah setiap render (dan berubah
   lagi setelah server restart). Kalau kuncinya path, tanda mati tidak
   pernah cocok lagi saat daftar dirender ulang. Hash dari URL asli stabil
   selamanya, sekaligus menjaga URL host tidak tertulis di markup. */
export function sidikTautan(url) {
  const isi = String(url ?? "");
  if (!isi) return "";
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < isi.length; i += 1) {
    const kode = isi.charCodeAt(i);
    a = Math.imul(a ^ kode, 0x01000193) >>> 0;
    b = Math.imul(b + kode * (i + 1), 0x85ebca6b) >>> 0;
  }
  return `t${a.toString(36)}${b.toString(36)}`;
}

export function kunciUnduhan(url) {
  const bersih = teks(url);
  return bersih ? `unduh|${bersih}` : "";
}

/* Slug episode ikut jadi bagian kunci: URL mirror yang sama bisa dipakai
   episode lain, dan satu mirror yang rusak di episode ini belum tentu rusak
   di episode berikutnya. */
export function kunciMirror(episodeSlug, url) {
  const bersih = teks(url);
  if (!bersih) return "";
  return `mirror|${teks(episodeSlug)}|${bersih}`;
}

/* Kunci yang dipakai saat mengirim laporan: tanpa URL, hanya jenis dan hash
   tautan. Bentuknya sama dengan kunci penyimpanan lokal supaya tanda
   "hidup lagi" bisa menimpa laporan publik dengan mudah. */
export function kunciLaporan(jenis, episode, identitas) {
  const id = teks(identitas);
  if (!id) return "";
  if (teks(jenis) === "unduhan") return `unduh|${id}`;
  if (teks(jenis) === "mirror") {
    const slug = teks(episode);
    return slug ? `mirror|${slug}|${id}` : "";
  }
  return "";
}

/* Laporan publik baru dipakai kalau jumlah pelapornya mencapai ambang.
   Satu klik keliru tidak boleh menyembunyikan tautan untuk semua orang. */
export function gabungLaporan(data, ambang = 2) {
  const batas = Number(ambang) > 0 ? Number(ambang) : 2;
  const hasil = { unduhan: new Set(), mirror: new Map(), ambang: batas };
  for (const item of Array.isArray(data) ? data : []) {
    const jenis = String(item?.jenis || "");
    const id = String(item?.id || "");
    const jumlah = Number(item?.jumlah);
    if (!id || !Number.isFinite(jumlah) || jumlah < batas) continue;
    if (jenis === "unduhan") { hasil.unduhan.add(id); continue; }
    if (jenis !== "mirror") continue;
    const slug = String(item?.episode || "");
    if (!slug) continue;
    if (!hasil.mirror.has(slug)) hasil.mirror.set(slug, new Set());
    hasil.mirror.get(slug).add(id);
  }
  return hasil;
}

/* Dibuat sekali per browser lalu dipakai lagi. Kalau storage tidak bisa
   ditulis (mode privat), nilai cadangan di memori dipakai supaya satu
   pengguna tidak terhitung berkali-kali karena id selalu baru. */
let pelaporCadangan = "";
let pelaporCadanganUntuk = null;
export function idPelapor({ storage, acak } = {}) {
  let simpanan = storage;
  if (!simpanan) {
    try { simpanan = globalThis.localStorage || null; } catch { simpanan = null; }
  }
  const sah = (nilai) => /^[a-z0-9-]{12,64}$/i.test(String(nilai ?? ""));
  try {
    const ada = simpanan?.getItem?.(KUNCI_PELAPOR);
    if (sah(ada)) return String(ada);
  } catch { /* storage diblokir: pakai cadangan di bawah */ }
  if (pelaporCadanganUntuk === (simpanan || null) && sah(pelaporCadangan)) return pelaporCadangan;
  const mentah = acak ? String(acak()) : (globalThis.crypto?.randomUUID?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  const dibuat = mentah.replace(/[^a-z0-9-]/gi, "").slice(0, 64);
  if (!sah(dibuat)) return "";
  try {
    simpanan?.setItem?.(KUNCI_PELAPOR, dibuat);
  } catch {
    /* Storage menolak tulisan (mode privat/penuh): simpan di memori supaya
       satu pengguna tidak terhitung berkali-kali karena id selalu baru. */
    pelaporCadangan = dibuat;
    pelaporCadanganUntuk = simpanan || null;
  }
  if (!simpanan) { pelaporCadangan = dibuat; pelaporCadanganUntuk = null; }
  return dibuat;
}

function penyimpananMemori() {
  const isi = new Map();
  return {
    getItem: (kunci) => (isi.has(kunci) ? isi.get(kunci) : null),
    setItem: (kunci, nilai) => { isi.set(kunci, String(nilai)); },
    removeItem: (kunci) => { isi.delete(kunci); },
  };
}

/* Storage disuntikkan supaya modul bisa diuji tanpa browser. Kalau
   localStorage tidak tersedia (Node, mode privat, kuota penuh), memori
   dipakai: penanda tetap berlaku selama tab hidup, bukan hilang diam-diam. */
export function buatDaftarMati({ storage, kunciSimpan = KUNCI_SIMPAN, sekarang = () => Date.now(), umurMs = UMUR_MS, batas = BATAS_ITEM } = {}) {
  const kunciAman = teks(kunciSimpan) || KUNCI_SIMPAN;
  let simpanan = storage;
  let cadangan = null;
  /* Lapisan memori: kalau storage menolak tulisan (kuota/mode privat),
     penanda yang baru dipasang tetap berlaku sampai tab ditutup. */
  const memori = new Map();
  const ambilStorage = () => {
    if (simpanan) return simpanan;
    if (cadangan) return cadangan;
    try {
      if (globalThis.localStorage) { simpanan = globalThis.localStorage; return simpanan; }
    } catch { /* akses localStorage bisa melempar di mode privat */ }
    cadangan = penyimpananMemori();
    return cadangan;
  };
  const usia = () => (Number.isFinite(Number(umurMs)) && Number(umurMs) > 0 ? Number(umurMs) : UMUR_MS);
  const maks = () => (Number.isFinite(Number(batas)) && Number(batas) > 0 ? Number(batas) : BATAS_ITEM);

  /* Membaca sambil membersihkan: entri kedaluwarsa dibuang, dan kalau
     jumlahnya melewati batas, yang paling lama pergi lebih dulu. Dengan
     begitu berkas simpanan tidak tumbuh selamanya. */
  const baca = () => {
    const result = new Map();
    let mentah = "";
    try { mentah = ambilStorage().getItem(kunciAman) || ""; } catch { return result; }
    let data = null;
    try { data = JSON.parse(mentah); } catch { data = null; }
    const item = data?.item && typeof data.item === "object" ? data.item : null;
    const sekarangMs = Number(sekarang());
    const batasUsia = sekarangMs - usia();
    for (const [kunci, nilai] of Object.entries(item || {})) {
      const waktu = Number(nilai?.t);
      const kunciAman = teks(kunci);
      if (!kunciAman || !Number.isFinite(waktu) || waktu < batasUsia) continue;
      result.set(kunciAman, { t: waktu, sebab: teks(nilai?.sebab) });
    }
    for (const [kunci, nilai] of memori) {
      if (Number(nilai?.t) >= batasUsia) result.set(kunci, nilai);
    }
    const urut = [...result.entries()].sort((a, b) => b[1].t - a[1].t);
    const dipangkas = urut.slice(0, maks());
    const hasil = new Map(dipangkas);
    if (hasil.size !== Object.keys(item || {}).length) tulis(hasil);
    return hasil;
  };

  const tulis = (peta) => {
    const item = {};
    for (const [kunci, nilai] of peta) item[kunci] = nilai;
    try {
      ambilStorage().setItem(kunciAman, JSON.stringify({ v: 1, item }));
    } catch { /* storage penuh/diblokir: penanda tetap ada di memori pemanggil */ }
  };

  const tandai = (kunci, { sebab = "" } = {}) => {
    const kunciAman = teks(kunci);
    if (!kunciAman) return false;
    const nilai = { t: Number(sekarang()), sebab: teks(sebab) };
    memori.set(kunciAman, nilai);
    const peta = baca();
    peta.set(kunciAman, nilai);
    tulis(peta);
    return true;
  };
  const hapus = (kunci) => {
    const kunciAman = teks(kunci);
    if (!kunciAman) return false;
    memori.delete(kunciAman);
    const peta = baca();
    if (!peta.delete(kunciAman)) return false;
    tulis(peta);
    return true;
  };
  const bersihkan = () => { memori.clear(); tulis(new Map()); };

  return {
    punya: (kunci) => baca().has(teks(kunci)),
    tandai,
    hapus,
    bersihkan,
    semua: () => [...baca().keys()],
    jumlah: () => baca().size,
  };
}

/* Menyaring daftar mirror untuk ditampilkan. Fungsi murni: tidak menyentuh
   DOM maupun storage, jadi bisa diuji dan dipakai ulang. Indeks asli
   dipertahankan supaya state.mirrorIndex tetap menunjuk mirror yang benar
   setelah sebagian disembunyikan. */
export function saringMirror(mirrors, matiUrls, tampilMati = false) {
  const daftar = [];
  let tersembunyi = 0;
  (Array.isArray(mirrors) ? mirrors : []).forEach((mirror, index) => {
    /* URL asli dipakai untuk tanda lokal; hash dipakai untuk laporan publik
       supaya satu tautan yang sama tetap dikenali walau URL host tidak
       pernah ditulis di mana pun. */
    const url = String(mirror?.url || "");
    const mati = Boolean(matiUrls?.has?.(url) || matiUrls?.has?.(sidikTautan(url)));
    if (mati && !tampilMati) { tersembunyi += 1; return; }
    daftar.push({ mirror, index, mati });
  });
  return { daftar, tersembunyi };
}

export const tautanMati = buatDaftarMati();
export const tautanHidup = buatDaftarMati({ kunciSimpan: KUNCI_HIDUP });
