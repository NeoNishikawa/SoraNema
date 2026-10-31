if (typeof globalThis.registerSeal === "function") globalThis.registerSeal("apputils", "copyright SoraNema");
/* ==========================================================================
   SoraNema — Helper murni (tanpa DOM) agar bisa diuji unit di Node.
   Dipakai reference-app.js; saling terhubung dengan state & prefs di sana.
   ========================================================================== */

/* Ukuran slide grid: mobile 3x3 (9 judul), desktop 6x3 (18 judul) */
export function pageSizeFor(isMobile = false) { return isMobile ? 9 : 18; }
export function pageCountFor(total, pageSize) { return Math.max(1, Math.ceil((total || 0) / (pageSize || 1))); }
export function clampPage(page, pageCount) { return Math.min(Math.max(0, page), Math.max(0, pageCount - 1)); }
export function pageSlice(items = [], page = 0, pageSize = 18) {
  const start = clampPage(page, pageCountFor(items.length, pageSize)) * pageSize;
  return items.slice(start, start + pageSize);
}

/* Tamat = statusnya memang "completed", ATAU total diketahui dan progres
   sudah mencapai total (item lama yang statusnya completed tapi totalnya
   0/korup tetap terhitung — dulu hilang dari tab Complete & stat popup). */
export function isItemComplete(item = {}) {
  if (String(item.status || "") === "completed") return true;
  const total = Number(item.total || item.totalEpisodes || 0);
  const progress = Number(item.progress || (item.watchedEpisodes || []).at(-1) || 0);
  return total > 0 && progress >= total;
}

/* ===== Rekomendasi ===== */

/* Angka view AniList bisa ratusan ribu; kartu tidak punya ruang untuk
   angka penuh. 83.867 -> "83,9rb", 1.250.000 -> "1,3jt". */
export function formatCompactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1).replace(".", ",")}m`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(".", ",")}jt`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(".", ",")}rb`;
  return String(Math.round(number));
}

/* Genre yang paling sering TAMAT. Minimal dua anime dengan genre yang sama,
   sesuai aturan tampil rekomendasi genre. Item tanpa genre (belum di-hydrate)
   tidak dihitung; nanti dicoba lagi setelah metadata storage terisi. */
export function topCompletedGenre(items = [], minCount = 2) {
  const counts = new Map();
  for (const item of items || []) {
    if (!isItemComplete(item)) continue;
    const seen = new Set();
    for (const genre of item.genres || []) {
      const name = String((typeof genre === "string" ? genre : genre?.name) || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const current = counts.get(name) || { name, count: 0, lastAt: 0 };
      current.count += 1;
      current.lastAt = Math.max(current.lastAt, Number(item.lastWatchedAt) || 0);
      counts.set(name, current);
    }
  }
  const eligible = [...counts.values()]
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.name.localeCompare(b.name));
  return eligible[0] || null;
}

/* ===== Lanjutkan Menonton ===== */

/* Satu episode yang cocok untuk ditampilkan di rail. episodes = daftar dari
   /api/anime/:slug (bukan data storage), sedangkan watched = array nomor
   episode yang sudah ditonton di localStorage. */
export function nextUnwatched(watched = [], episodes = []) {
  const done = new Set((watched || []).map(Number));
  return (episodes || []).find((ep) => ep && ep.slug && !done.has(Number(ep.number))) || null;
}

/* Kandidat rail: sudah ditonton minimal 1 episode, belum tamat, dan masih
   ada sisa episode. Item dengan total 0 (tidak diketahui) tetap lolos supaya
   bisa diverifikasi nanti lewat detail, bukan langsung hilang. */
export function continueCandidates(items = [], limit = 8) {
  const candidates = (items || []).filter((item) => {
    if (!item?.slug) return false;
    const watched = (item.watchedEpisodes || []).map(Number).filter(Number.isFinite);
    if (!watched.length && Number(item.progress || 0) < 1) return false;
    if (isItemComplete(item)) return false;
    const total = Number(item.total || item.totalEpisodes || 0);
    if (total > 0 && Number(item.progress || 0) >= total) return false;
    return true;
  });
  /* Urutan gabungan: yang paling baru ditonton dulu. Item lama yang belum
     punya lastWatchedAt diberi nilai tiruan dari progresnya supaya tetap
     masuk urutan dan tidak selalu tersingkir. */
  return candidates
    .map((item) => {
      const progress = Number(item.progress || 0);
      const ratio = Number(item.total || item.totalEpisodes || 0) > 0 ? progress / Number(item.total || item.totalEpisodes) : 0;
      const stamp = Number(item.lastWatchedAt || 0) || Math.round(ratio * 1000);
      return { item, stamp, ratio };
    })
    .sort((a, b) => b.stamp - a.stamp || b.ratio - a.ratio)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/* Label episode untuk kartu: "Episode 7" + judul bila ada. */
export function episodeLabel(episode = {}, animeTitle = "") {
  if (!episode?.number) return animeTitle || "Episode berikutnya";
  const base = `Episode ${Number(episode.number)}`;
  return episode.title ? `${base} · ${episode.title}` : base;
}

/* Sisa episode yang belum ditonton, dipakai untuk sub judul rail. */
export function remainingCount(item = {}, episodeTotal = 0) {
  const watched = new Set((item.watchedEpisodes || []).map(Number));
  const total = Number(episodeTotal || item.total || item.totalEpisodes || 0);
  if (!total) return 0;
  return Math.max(0, total - watched.size);
}

/* Avatar hanya menerima PNG, WebP, dan GIF (GIF = avatar beranimasi). */
export const AVATAR_ALLOWED_TYPES = ["image/png", "image/webp", "image/gif"];
export function isAllowedAvatarFile(file) {
  if (!file) return false;
  if (AVATAR_ALLOWED_TYPES.includes(file.type)) return true;
  return /\.(png|webp|gif)$/i.test(String(file.name || ""));
}

/* Export v2: koleksi + profil (nama, handle, foto, tema) agar pengguna
   tidak perlu mengatur ulang profil setelah import. */
/* Poster Animasu lewat proxy Jetpack (i0-i3.wp.com). Tanpa parameter, file
   aslinya 35 KB untuk satu kartu; `?w=320&quality=75` memotongnya sekitar
   separuh tanpa beda yang terlihat di thumbnail. Hanya host itu yang diubah:
   URL yang sudah punya parameter sendiri dibiarkan apa adanya. */
export function posterSrc(url, width = 320) {
  const raw = String(url || "");
  if (!/^https?:\/\/i[0-3]\.wp\.com\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if ([...parsed.searchParams.keys()].length) return raw;
    parsed.searchParams.set("w", String(width));
    parsed.searchParams.set("quality", "75");
    return parsed.toString();
  } catch { return raw; }
}

export function buildExportPayload(items = [], prefs = {}) {
  return {
    format: "soranema-tracking",
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: {
      username: String(prefs.username || "").slice(0, 30),
      handle: String(prefs.handle || "").slice(0, 40),
      avatarUrl: String(prefs.avatarUrl || ""),
      theme: prefs.theme === "light" ? "light" : "dark",
      sidebarCollapsed: Boolean(prefs.sidebarCollapsed),
    },
    items: items.map((i) => ({ slug: i.slug, title: i.title, image: i.image, total: i.total, status: i.status, progress: i.progress, watchedEpisodes: i.watchedEpisodes, genres: i.genres || [], characters: i.characters || [], type: i.type || "", airingStatus: i.airingStatus || "", rating: Number(i.rating || 0) })),
  };
}

/* Import: v1 (tanpa profile) tidak mengubah apa pun; v2 memulihkan profil
   dengan penyaringan ketat — avatarUrl hanya boleh data:image/* agar
   file JSON berbahaya tidak bisa menyuntik URL apa pun. */
export function mergeImportedProfile(parsed = {}, prefs = {}) {
  const p = parsed?.profile;
  if (!p || typeof p !== "object") return prefs;
  const next = { ...prefs };
  if (typeof p.username === "string" && p.username.trim()) next.username = p.username.trim().slice(0, 30);
  if (typeof p.handle === "string") next.handle = p.handle.slice(0, 40);
  if (p.avatarUrl === "" || (typeof p.avatarUrl === "string" && p.avatarUrl.startsWith("data:image/"))) next.avatarUrl = p.avatarUrl;
  if (p.theme === "light" || p.theme === "dark") next.theme = p.theme;
  if (typeof p.sidebarCollapsed === "boolean") next.sidebarCollapsed = p.sidebarCollapsed;
  return next;
}

/* ===== Batas tekan =====
   Satu tombol hanya boleh dipicu sekali per detik. Tujuannya mencegah
   klik ganda yang mengirim dua request, membuka dua dialog, atau memulai
   dua unduhan. Batas ini per elemen, jadi tombol berbeda tetap bisa
   ditekan berurutan tanpa saling menunggu.

   Klik programatik (isTrusted === false) sengaja dilewatkan: beberapa
   alur memanggil .click() untuk membuka file picker atau dropdown, dan
   itu bukan tekanan pengguna yang perlu dibatasi. */
export const PRESS_COOLDOWN_MS = 1000;
export const PRESS_TARGET_SELECTOR = "button, [role='button'], a.dl-link";

export function createPressLimiter({ cooldownMs = PRESS_COOLDOWN_MS, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const terakhir = new WeakMap();
  const jeda = Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : PRESS_COOLDOWN_MS;
  return {
    cooldownMs: jeda,
    remaining(target) {
      if (!target || typeof target !== "object") return 0;
      const sejak = terakhir.get(target);
      if (sejak === undefined) return 0;
      return Math.max(0, jeda - (now() - sejak));
    },
    allow(target) {
      if (!target || typeof target !== "object") return false;
      const sekarang = now();
      const sejak = terakhir.get(target);
      if (sejak !== undefined && sekarang - sejak < jeda) return false;
      terakhir.set(target, sekarang);
      return true;
    },
  };
}

export function attachPressLimiter(root, { cooldownMs = PRESS_COOLDOWN_MS, now, onBlocked } = {}) {
  if (!root?.addEventListener) return () => {};
  const limiter = createPressLimiter({ cooldownMs, now });
  /* Satu timer per kelas, bukan satu timer per elemen: saat klik kedua
     diblokir, timer is-press-cooling tidak boleh ikut dibatalkan. Kalau
     dibatalkan, kelas cooldown bisa tertinggal selamanya. */
  const timer = new WeakMap();
  const tandai = (target, kelas, durasi) => {
    if (!target?.classList) return;
    const slot = timer.get(target) || {};
    if (slot[kelas]) clearTimeout(slot[kelas]);
    target.classList.add(kelas);
    const t = setTimeout(() => {
      target.classList.remove(kelas);
      delete slot[kelas];
    }, durasi);
    t?.unref?.();
    slot[kelas] = t;
    timer.set(target, slot);
  };
  const onClick = (event) => {
    if (event.defaultPrevented || event.button > 0 || event.isTrusted === false) return;
    const target = event.target?.closest?.(PRESS_TARGET_SELECTOR);
    if (!target) return;
    if (target.disabled || target.getAttribute?.("aria-disabled") === "true") return;
    if (!limiter.allow(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      tandai(target, "is-press-blocked", 220);
      try { onBlocked?.(target, limiter.remaining(target)); } catch (_) { /* feedback tidak boleh merusak guard */ }
      return;
    }
    tandai(target, "is-press-cooling", limiter.cooldownMs);
  };
  root.addEventListener("click", onClick, true);
  return () => {
    root.removeEventListener("click", onClick, true);
  };
}

/* ===== Deteksi server restart ===== */

/* /api/health membawa bootId proses server. Id yang berbeda berarti proses
   baru sudah melayani, sementara tab ini masih memegang bundle lama.
   Patokan pertama BUKAN restart: tab yang baru dibuka hanya mencatat id yang
   sedang berlaku, kalau tidak setiap reload halaman memunculkan pemberitahuan. */
export function bootBerubah(sebelum, sesudah) {
  if (typeof sesudah !== "string" || !sesudah) return false;
  if (typeof sebelum !== "string" || !sebelum) return false;
  return sebelum !== sesudah;
}

/* Pemantau ringan: satu request /api/health tiap interval, plus pemeriksaan
   saat tab kembali terlihat. `ambilBootId` dan timer disuntikkan supaya bisa
   diuji tanpa browser dan tanpa menunggu interval sungguhan. */
export function createBootWatcher({
  ambilBootId,
  onRestart,
  intervalMs = 10000,
  setIntervalRef = globalThis.setInterval,
  clearIntervalRef = globalThis.clearInterval,
} = {}) {
  let bootId = "";
  let sibuk = false;
  let berhenti = false;
  let timer = null;

  const periksa = async () => {
    if (sibuk || berhenti || typeof ambilBootId !== "function") return false;
    sibuk = true;
    try {
      const id = await ambilBootId();
      if (typeof id !== "string" || !id) return false;
      if (!bootId) { bootId = id; return false; }
      if (!bootBerubah(bootId, id)) return false;
      const dari = bootId;
      bootId = id;
      try { onRestart?.({ dari, ke: id }); } catch (_) { /* pemberitahuan gagal tidak boleh mematikan pemantau */ }
      return true;
    } catch (_) {
      /* Server sedang mati di tengah restart: bukan bukti restart, coba lagi
         pada putaran berikutnya. */
      return false;
    } finally {
      sibuk = false;
    }
  };

  const mulai = () => {
    if (timer || berhenti || typeof setIntervalRef !== "function") return null;
    periksa();
    timer = setIntervalRef(() => { periksa(); }, intervalMs);
    if (typeof timer?.unref === "function") timer.unref();
    return timer;
  };

  const hentikan = () => {
    berhenti = true;
    if (timer && typeof clearIntervalRef === "function") clearIntervalRef(timer);
    timer = null;
  };

  return { periksa, mulai, hentikan, bootId: () => bootId };
}
