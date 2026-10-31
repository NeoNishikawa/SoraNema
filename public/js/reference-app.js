import { registerSeal } from "./integrity.js";
registerSeal("referenceapp", "copyright SoraNema");
import { api } from "./api.js?v=1.3.3";
import { attach, closeActive } from "./dropdown.js";
import { pageSizeFor, pageCountFor, pageSlice, isItemComplete, isAllowedAvatarFile, buildExportPayload, mergeImportedProfile, continueCandidates, nextUnwatched, episodeLabel, remainingCount, formatCompactNumber, topCompletedGenre, posterSrc, createBootWatcher, attachPressLimiter } from "./app-utils.js";
import { animate, createTimeline, stagger, utils } from "animejs";
import { createScreenTimeTracker, mountScreenTimeUI, mountDoubleClickReminder } from "./screen-time.js?v=1.2.0";
import { createPerformanceController } from "./performance-mode.js";
import { createNetworkMonitor, mountNetworkBadge } from "./net-status.js";
import { mountMaintenanceNotice } from "./maintenance-notice.js";
import { mountSearchOrb } from "./search-orb.js";
import { runSealCheck } from "./integrity.js";
import { tautanMati, tautanHidup, kunciUnduhan, kunciMirror, kunciLaporan, gabungLaporan, idPelapor, saringMirror, sidikTautan } from "./tautan-mati.js";

/* Kunci integritas diperiksa sebelum data apa pun dimuat. Kalau kunci tidak
   cocok, aplikasi berhenti di design: tidak ada anime, tidak ada hasil
   pencarian, tidak ada episode.

   ambient.js dimuat sebagai <script> terpisah di HTML, jadi bisa belum selesai
   dievaluasi ketika modul ini berjalan. Tunggu dulu supaya semua pecahan
   kunci terdaftar — kalau tidak, aplikasi akan mengunci dirinya sendiri. */
let SEAL_OK = false;
const sealReady = import("./ambient.js").catch(() => {}).then(() => {
  SEAL_OK = runSealCheck().ok;
  return SEAL_OK;
});

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const TRACKING_KEY = "iln_tracking";
const PREFS_KEY = "soranema.reference.prefs";
/* Profil dan tema dari kunci lama dipindahkan sekali supaya pengguna tidak
   kehilangan setelan hanya karena nama merek berubah. Kunci lama tidak
   ditulis ulang di sini; cukup dicari dari akhiran yang sama. */
function migrateLegacyPrefs() {
  try {
    if (localStorage.getItem(PREFS_KEY) != null) return;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key === PREFS_KEY || !key.endsWith(".reference.prefs")) continue;
      const lama = localStorage.getItem(key);
      if (lama == null) continue;
      localStorage.setItem(PREFS_KEY, lama);
      localStorage.removeItem(key);
      return;
    }
  } catch { /* localStorage bisa diblokir; setelan kembali ke bawaan */ }
}
migrateLegacyPrefs();
const esc = (v = "") => String(v).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* XP naik dua kali lipat per level: 10, 20, 40, 80, … */
function xpForLevel(level) { return 10 * Math.pow(2, level - 1); }
function levelFromWatched(watched) { let level = 1; let remaining = Math.max(0, Math.floor(watched)); while (remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level += 1; } return { level, intoLevel: remaining, need: xpForLevel(level) }; }
const isMobileViewport = () => window.matchMedia("(max-width: 1023px)").matches;
const statusText = (v) => ({ planned: "Plan to Watch", watching: "Watching", completed: "Complete", dropped: "Dislike" }[v] || v || "All");
const mobileQuery = window.matchMedia("(max-width: 1023px)");
/* Bawaan prefs. Dipakai saat inisialisasi dan saat "Delete Data" supaya
   tempatnya mengulang nilai yang sama tidak lagi berbeda. */
const DEFAULT_PREFS = { theme: "dark", sidebarCollapsed: false, username: "Anime watcher", handle: "Local profile", avatarUrl: "" };
let prefs = (() => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...DEFAULT_PREFS }; } })();
const state = { daily: [], genres: [], searchResults: [], storageItems: [], mainGenres: new Set(), storageGenres: new Set(), activeGenres: new Set(), currentTab: "All", localQuery: "", searchQuery: "", searchLoading: false, storageFilterLoading: false, updateLoading: true, detail: null, episodeIndex: -1, mirrors: [], mirrorIndex: 0, selectedStorageItems: new Set(), editMode: false, searchToken: 0, searchPage: 0, storagePage: 0, filteredSearchCount: 0, filteredStorageCount: 0, recPopular: [], recPopularLoading: false, recPopularError: false, recGenre: [], recGenreName: "", recGenreLoading: false, tampilMati: false, tampilMatiMirror: false, mirrorSlug: "", laporan: { unduhan: new Set(), mirror: new Map(), ambang: 2 } };

let screenTimeUI = null;
const screenTimeTracker = createScreenTimeTracker({ storage: localStorage, documentRef: document, windowRef: window, onReminder: (reminder) => screenTimeUI?.show(reminder) });
screenTimeUI = mountScreenTimeUI({ tracker: screenTimeTracker, documentRef: document });
const doubleClickReminder = mountDoubleClickReminder({ documentRef: document, windowRef: window });
screenTimeTracker.start();
const performanceController = createPerformanceController({ storage: localStorage, documentRef: document, navigatorRef: navigator });
window.ilnPerformanceController = performanceController;
/* Badge ikon jaringan di header. Latensi nyata dilaporkan lewat timed()
   di bawah setiap panggilan API, jadi ikon tidak hanya menebak dari
   effectiveType browser. */
const networkMonitor = createNetworkMonitor();
mountNetworkBadge({ monitor: networkMonitor });
networkMonitor.start();
async function timed(promise) {
  const started = performance.now();
  try { return await promise; } finally { networkMonitor.setLatency(performance.now() - started); }
}
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.ilnScreenTimeServiceWorker = navigator.serviceWorker.register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
}

/* ---------- Drawer mobile ---------- */
const sidebar = $("#sidebar");
const drawerOverlay = document.createElement("div");
drawerOverlay.className = "drawer-overlay";
drawerOverlay.hidden = true;
document.body.appendChild(drawerOverlay);

function setDrawer(open) {
  const isMobileNow = mobileQuery.matches;
  if (!isMobileNow) return;
  sidebar.classList.toggle("is-mobile-open", open);
  document.getElementById("app").classList.toggle("drawer-open", open);
  drawerOverlay.hidden = !open;
  $("#hamburgerBtn").setAttribute("aria-expanded", String(open));
  if (!open) drawerOverlay.hidden = true;
}
$("#hamburgerBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  setDrawer(!sidebar.classList.contains("is-mobile-open"));
});
drawerOverlay.addEventListener("click", () => setDrawer(false));
mobileQuery.addEventListener("change", () => { if (!mobileQuery.matches) setDrawer(false); /* page size berubah (6×3 ↔ 3×3): render ulang grid */ renderStorage(); renderSearch(); });

/* ---------- Reveal / stagger animasi kartu ---------- */
function staggerIn(container) {
  if (!container) return;
  const items = [...container.children];
  if (!items.length) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tier = document.documentElement.dataset.performanceTier || "full";
  const limit = tier === "balanced" ? 8 : 12;
  items.forEach((item) => item.classList.remove("card-enter"));
  if (reduced || tier === "low") return;
  const animated = items.slice(0, limit);
  animated.forEach((item, index) => item.style.setProperty("--enter-delay", `${index * 28}ms`));
  requestAnimationFrame(() => {
    if (document.documentElement.dataset.performanceTier === "low" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animated.forEach((item) => item.classList.add("card-enter"));
  });
}

/* ---------- Deal: kartu hasil search "dibagikan" dari bawah search main ----------
   Jatuh staggered ala membagi kartu, impact squash multi-stage scale(1.4,.6),
   rebound, lalu settle — spring feel tanpa library. */
function dealCards(container) {
  if (!container) return;
  const items = [...container.children];
  if (!items.length) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tier = document.documentElement.dataset.performanceTier || "full";
  if (reduced || tier === "low") { staggerIn(container); return; }
  const limit = tier === "balanced" ? 8 : 12;
  const animated = items.slice(0, limit);
  animated.forEach((item) => { item.classList.remove("deal-card"); item.classList.remove("card-enter"); });
  animated.forEach((item, index) => {
    item.style.setProperty("--deal-delay", `${index * 55}ms`);
    item.style.setProperty("--deal-rot", `${index % 2 ? 1.6 : -1.6}deg`);
  });
  requestAnimationFrame(() => {
    if (document.documentElement.dataset.performanceTier === "low" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animated.forEach((item) => item.classList.add("deal-card"));
  });
}

/* ---------- Ganti halaman grid: kartu masuk bergeser sadar arah ---------- */
function turnPageIn(container, direction = 1) {
  if (!container) return;
  const items = [...container.children];
  if (!items.length) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tier = document.documentElement.dataset.performanceTier || "full";
  if (reduced || tier === "low") { staggerIn(container); return; }
  const limit = tier === "balanced" ? 9 : 18;
  const animated = items.slice(0, limit);
  animated.forEach((item) => item.classList.remove("turn-card", "from-left", "card-enter", "deal-card"));
  animated.forEach((item, index) => item.style.setProperty("--turn-i", String(index)));
  requestAnimationFrame(() => animated.forEach((item) => {
    if (direction < 0) item.classList.add("from-left");
    item.classList.add("turn-card");
  }));
}

/* ---------- Scroll fade in/out (IntersectionObserver) ----------
   Kartu muncul (fade+slide) saat masuk viewport dan memudar kembali saat
   keluar — hanya animasi opacity/transform, tanpa layout thrashing. */
let scrollObserver = null;
function setupScrollReveal() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollObserver?.disconnect();
  scrollObserver = null;
  if (reduced || document.documentElement.dataset.performanceTier === "low" || !("IntersectionObserver" in window)) return;
  scrollObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("scroll-hidden", !entry.isIntersecting);
  }, { root: $("#mainScroll"), rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
}
function observeScrollReveal(container) {
  if (!container || !scrollObserver) return;
  const items = [...container.querySelectorAll(".anime-card")];
  items.forEach((item) => { item.classList.add("scroll-reveal"); scrollObserver.observe(item); });
}

/* ---------- Arah scroll: kartu masuk dari sisi yang sesuai ----------
   Scroll turun -> kartu muncul dari bawah. Scroll naik -> kartu muncul dari
   atas. Hanya atribut di <html>; CSS yang memilih transform-nya, jadi tidak
   ada pembacaan layout per frame. */
function setupScrollDirection() {
  const scroller = $("#mainScroll");
  if (!scroller) return;
  document.documentElement.dataset.scrollDirection = "down";
  let last = scroller.scrollTop;
  let ticking = false;
  scroller.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const now = scroller.scrollTop;
      const delta = now - last;
      if (Math.abs(delta) < 4) return;
      document.documentElement.dataset.scrollDirection = delta > 0 ? "down" : "up";
      last = now;
    });
  }, { passive: true });
}

/* ---------- Gestur geser kartu: karet elastis berlawanan arah ----------
   Seret kartu ke kiri -> gambarnya tertarik ke kanan, dan sebaliknya.
   Hanya di .card-grid (bukan rail horizontal) supaya geser rail tetap
   native. Sentuhan vertikal tidak pernah ditahan: touch-action pan-y dan
   pointercancel membuat scroll tetap mulus. */
function setupSwipeCards() {
  const scroller = $("#mainScroll");
  if (!scroller || !window.PointerEvent) return;
  const MAX = 52;
  const RESIST = 0.34;
  const releaseTimers = new WeakMap();
  let card = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let active = false;
  let moved = 0;
  let suppressUntil = 0;
  let suppressCard = null;
  const motionOff = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.performanceTier === "low";
  /* Satu klik sesudah seret tidak boleh membuka anime. Penjaga ini menetap
     dan hanya aktif selama jendela singkat, jadi tidak ada listener yang
     tertinggal atau terhapus oleh pointerdown berikutnya. */
  document.addEventListener("click", (event) => {
    if (performance.now() > suppressUntil) return;
    if (!suppressCard?.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressUntil = 0;
    suppressCard = null;
  }, true);
  const release = (target) => {
    if (!target) return;
    clearTimeout(releaseTimers.get(target));
    target.classList.remove("swipe-dragging");
    target.classList.add("swipe-release");
    target.style.setProperty("--swipe-x", "0px");
    target.style.setProperty("--swipe-r", "0deg");
    const timer = window.setTimeout(() => {
      target.classList.remove("swipe-release");
      target.style.removeProperty("--swipe-x");
      target.style.removeProperty("--swipe-r");
      target.style.willChange = "";
    }, 620);
    timer?.unref?.();
    releaseTimers.set(target, timer);
  };
  scroller.addEventListener("pointerdown", (event) => {
    if (motionOff() || (event.pointerType === "mouse" && event.button !== 0)) return;
    const target = event.target.closest?.(".card-grid .anime-card");
    if (!target) return;
    clearTimeout(releaseTimers.get(target));
    target.classList.remove("swipe-release");
    card = target;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    active = false;
    moved = 0;
  }, { passive: true });
  scroller.addEventListener("pointermove", (event) => {
    if (!card || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!active) {
      /* Butuh niat horizontal yang jelas; geser vertikal dibiarkan ke scroll. */
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      active = true;
      card.classList.add("swipe-dragging");
      card.style.willChange = "transform";
      try { card.setPointerCapture?.(event.pointerId); } catch { /* pointer sudah lepas */ }
    }
    moved = Math.abs(dx);
    suppressUntil = performance.now() + 450;
    suppressCard = card;
    const tertarik = Math.max(-MAX, Math.min(MAX, -dx * RESIST));
    card.style.setProperty("--swipe-x", `${tertarik.toFixed(2)}px`);
    card.style.setProperty("--swipe-r", `${(-dx * 0.03).toFixed(2)}deg`);
  }, { passive: true });
  const finish = (event) => {
    if (!card || event.pointerId !== pointerId) return;
    const target = card;
    const dragged = active && moved > 10;
    const touched = active;
    card = null;
    pointerId = null;
    active = false;
    if (dragged) {
      suppressUntil = performance.now() + 450;
      suppressCard = target;
    }
    /* Ketukan/scroll vertikal yang tidak pernah menyeret tidak perlu
       memantul atau menahan hover. */
    if (touched) release(target);
  };
  scroller.addEventListener("pointerup", finish, { passive: true });
  scroller.addEventListener("pointercancel", finish, { passive: true });
}

/* ---------- Boing rail horizontal ----------
   Saat rail digeser ke kiri (scrollLeft turun), kartu memantul ke kanan;
   geser ke kanan memantul ke kiri. Hanya kelas di rail yang dipasang,
   lalu CSS memakai properti `translate` supaya transform hover dan gestur
   seret kartu tidak ditimpa. Reduced motion dan tier rendah tidak memantul. */
function setupRailBoing() {
  const rails = ["#continueRail", "#recPopularRail", "#recGenreRail"]
    .map((selector) => $(selector))
    .filter(Boolean);
  if (!rails.length) return;
  const motionOff = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.dataset.performanceTier === "low";
  for (const rail of rails) {
    let lastLeft = rail.scrollLeft;
    let lastDir = 0;
    let frame = 0;
    let lastBoing = 0;
    let settleTimer = 0;
    const boing = (dir) => {
      if (motionOff()) return;
      const now = performance.now();
      /* Jangan memulai ulang animasi di setiap frame scroll. */
      if (now - lastBoing < 220) return;
      lastBoing = now;
      rail.classList.remove("rail-boing-left", "rail-boing-right");
      /* Reflow sekali agar kelas yang sama bisa memutar animasi lagi. */
      void rail.offsetWidth;
      rail.classList.add(dir > 0 ? "rail-boing-right" : "rail-boing-left");
    };
    rail.addEventListener("scroll", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const nextLeft = rail.scrollLeft;
        const delta = nextLeft - lastLeft;
        lastLeft = nextLeft;
        if (Math.abs(delta) < 2) return;
        const dir = delta < 0 ? 1 : -1;
        if (dir !== lastDir) {
          lastDir = dir;
          boing(dir);
        }
        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => { lastDir = 0; }, 180);
      });
    }, { passive: true });
  }
}

/* ---------- Enter di pencarian: tarik layar ke bagian hasil ----------
   Section sudah tampil (skeleton) sebelum request jalan, jadi scroll bisa
   dimulai segera. Reduced motion dan tier rendah melompat tanpa animasi. */
function scrollToSearchResults() {
  const section = $("#searchSection");
  const scroller = $("#mainScroll");
  if (!section || !scroller) return;
  requestAnimationFrame(() => {
    if (section.hidden) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.performanceTier === "low";
    const top = scroller.scrollTop + section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = Math.max(0, Math.min(top, max));
    if (Math.abs(target - scroller.scrollTop) < 4) return;
    if (typeof scroller.scrollTo === "function") scroller.scrollTo({ top: target, behavior: reduced ? "auto" : "smooth" });
    else scroller.scrollTop = target;
  });
}
function installDevLongTaskMonitor() {
  if (new URLSearchParams(window.location.search).get("iln-dev") !== "1" || !("PerformanceObserver" in window)) return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) console.info(`[SoraNema dev] long task ${Math.round(entry.duration)}ms`, entry);
    });
    observer.observe({ type: "longtask", buffered: true });
    window.__ilnLongTaskObserver = observer;
  } catch { /* Long Task API is not available in every browser. */ }
}

/* ---------- Pager grid: slide 6×3 (desktop) / 3×3 (mobile) ---------- */
/* Sidebar tertutup di desktop -> grid jadi 7 kolom, jadi satu halaman muat
   7×3 = 21 kartu (bukan 18). Mobile tetap 3×3 = 9; sidebar terbuka 6×3 = 18.
   Angka 21 ini HARUS sama dengan grid-template-columns di layout.css. */
const SIDEBAR_ANIM_MS = 380;
/* Jumlah kartu per halaman DIHITUNG dari kolom grid yang benar-benar aktif
   (baris selalu 3), bukan angka manual — kalau kolom berubah lagi (mis. 6->5
   untuk tablet), pager otomatis ikut dan baris terakhir tidak bolong lagi.
   Kolom dibaca dari #storageGrid karena section itu selalu tampil. */
function pageSize() {
  const grid = $("#storageGrid");
  const kolom = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
  return kolom > 0 ? kolom * 3 : pageSizeFor(isMobileViewport());
}
function pagerHTML(page, pageCount, idPrefix) {
  return `<div class="grid-pager" role="navigation" aria-label="Navigasi halaman">
    <button class="pager-btn" data-pager-prev="${idPrefix}" ${page <= 0 ? "disabled" : ""} aria-label="Halaman sebelumnya"><svg class="ico"><use href="#i-chev-left"/></svg></button>
    <span class="pager-info">Halaman <b>${page + 1}</b> / ${pageCount}</span>
    <button class="pager-btn" data-pager-next="${idPrefix}" ${page >= pageCount - 1 ? "disabled" : ""} aria-label="Halaman berikutnya"><svg class="ico"><use href="#i-chev-right"/></svg></button>
  </div>`;
}
function setGridPage(which, delta) {
  if (which === "search") { state.searchPage = Math.max(0, state.searchPage + delta); renderSearch({ pageDir: delta }); }
  else { state.storagePage = Math.max(0, state.storagePage + delta); renderStorage({ pageDir: delta }); }
}
function bindPager(root) {
  if (!root) return;
  const prev = $("[data-pager-prev]", root), next = $("[data-pager-next]", root);
  prev?.addEventListener("click", () => setGridPage(prev.dataset.pagerPrev, -1));
  next?.addEventListener("click", () => setGridPage(next.dataset.pagerNext, 1));
}
function scrollToGrid(grid) { grid?.closest("section")?.posisiMenu?.({ behavior: "smooth", block: "start" }); }

/* ---------- Data helpers ---------- */
function normalizeStored(raw = {}) { const watchedEpisodes = Array.isArray(raw.watchedEpisodes) ? [...new Set(raw.watchedEpisodes.map(Number).filter(Number.isFinite))].sort((a, b) => a - b) : []; const progress = Math.max(Number(raw.progress || 0), watchedEpisodes.at(-1) || 0); const status = raw.status || (raw.dislike ? "dropped" : raw.planToWatch || !progress ? "planned" : raw.total && progress >= raw.total ? "completed" : "watching"); return { ...raw, characters: Array.isArray(raw.characters) ? raw.characters.map((c) => typeof c === "string" ? c : c.name).filter(Boolean) : [], slug: String(raw.slug || raw.animeId || ""), animeId: String(raw.animeId || raw.slug || ""), title: String(raw.title || "Unknown title"), image: raw.image || raw.posterUrl || "", posterUrl: raw.posterUrl || raw.image || "", total: Number(raw.total || raw.totalEpisodes || 0), totalEpisodes: Number(raw.totalEpisodes || raw.total || 0), progress, watchedEpisodes, status, genres: Array.isArray(raw.genres) ? raw.genres.map((g) => typeof g === "string" ? g : g.name).filter(Boolean) : [] }; }
function readTracking() { try { const parsed = JSON.parse(localStorage.getItem(TRACKING_KEY) || "[]"); return Array.isArray(parsed) ? parsed.map(normalizeStored).filter((x) => x.slug) : []; } catch { return []; } }
state.storageItems = readTracking();
function saveState() { localStorage.setItem(TRACKING_KEY, JSON.stringify(state.storageItems.map(normalizeStored))); localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
function normAnime(a = {}) { const title = a.title || "Untitled"; const total = Number(a.totalEpisodes || a.total || a.episodes?.length || String(a.episode || "").match(/\d+/)?.[0] || 0); return { ...a, id: String(a.id || a.slug || ""), slug: String(a.slug || a.id || ""), title, posterUrl: a.posterUrl || a.image || "", image: a.image || a.posterUrl || "", totalEpisodes: total, total, rating: Number(a.rating || 0), genres: (a.genres || []).map((g) => typeof g === "string" ? g : g.name).filter(Boolean) }; }
function allKnown() { return state.daily.concat(state.searchResults, state.storageItems, state.recPopular, state.recGenre); }
function findAnime(id) { return allKnown().map(normAnime).find((a) => a.id === id || a.slug === id) || state.storageItems.find((i) => i.slug === id); }
function getStored(id) { return state.storageItems.find((i) => i.slug === id || i.animeId === id); }
function totalWatched() { return state.storageItems.reduce((sum, item) => sum + Number(item.progress || item.watchedEpisodes?.at(-1) || 0), 0); }
function isComplete(item) { return isItemComplete(item); }
function imageHTML(anime) { return anime.posterUrl ? `<img src="${esc(posterSrc(anime.posterUrl))}" alt="${esc(anime.title)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed')">` : `<span class="art-placeholder">ANIME IMAGE</span>`; }
/* Loader Thinking Orb (kartu "Reading search / Complete" dengan orb dan
   progress bar) sudah DIHAPUS: wave physics loader di dalam grid jauh lebih
   modern dan tidak pernah menutupi konten. Semua pemanggilnya (cari, import,
   retry) sekarang toasted saja, jadi tidak ada lagi node Thought di DOM. */
function toastBusy(title, message) { toast(title, message); }
/* Retry HTTP masih perlu diberi tahu ke user. Dulu lewat kartu Thought
   loader, sekarang lewat toast: kartu itu menutupi konten dan sudah
   digantikan wave loader di dalam grid. */
window.addEventListener("iln:catalog-retry", (event) => {
  if (!state.searchLoading) return;
  toastBusy("Mencoba lagi", `Server sedang sibuk — percobaan ${event.detail.attempt}.`, 2200);
});
function toast(title, message = "", duration = 3600) { const el = document.createElement("div"); el.className = "toast"; el.innerHTML = `<div class="t-ico"><svg class="ico"><use href="#i-bell"/></svg></div><div class="t-body"><div class="t-title">${esc(title)}</div><div class="t-msg">${esc(message)}</div></div><button class="t-close" aria-label="Tutup"><svg class="ico"><use href="#i-close"/></svg></button><div class="toast-progress running" style="animation-duration:${duration}ms"></div>`; const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 240); }; $(".t-close", el).onclick = close; $("#toastStack").appendChild(el); if (duration > 0) setTimeout(close, duration); }
function applyProfile() { const name = prefs.username || "Anime watcher"; const initial = name.trim().slice(0, 1).toUpperCase() || "A"; const { level, intoLevel, need } = levelFromWatched(totalWatched()); $$("#pcName,#sbName").forEach((el) => el.textContent = name); $("#pcHandle").textContent = prefs.handle; $("#pcTitle").textContent = level >= 5 ? "Anime Scholar" : level >= 3 ? "Otaku Enthusiast" : "Watcher Novice"; $("#sbLevel").textContent = `Level ${level}`; $("#pcLevelText").textContent = `Level ${level}`; $("#pcXpText").textContent = `${intoLevel} / ${need} XP`;  $("#pcXpBar").style.width = `${Math.min(100, (intoLevel / need) * 100)}%`;
  const levelTitle = level >= 5 ? "Anime Scholar" : level >= 3 ? "Otaku Enthusiast" : "Watcher Novice";
  $("#ppLevelTitle").textContent = `Level ${level} — ${levelTitle}`;
  $("#ppLevelBadge").textContent = `Lv ${level}`;
  $("#ppXpBar").style.width = `${Math.min(100, (intoLevel / need) * 100)}%`;
  $("#ppXpTextLeft").textContent = `${intoLevel} XP`;
  $("#ppXpTextRight").textContent = `${intoLevel} / ${need}`;  $("#pcStorage").innerHTML = `${state.storageItems.length} <small>Titles</small>`;
  $("#pcEpisodes").innerHTML = `${totalWatched()} <small>Episodes</small>`;
  /* Stat popup profil: sinkron dengan data nyata (dulu selalu 0) */
  const ppEps = $("#ppTotalEps"), ppTitles = $("#ppTotalTitles"), ppDone = $("#ppCompleted");
  if (ppEps) ppEps.textContent = totalWatched();
  if (ppTitles) ppTitles.textContent = state.storageItems.length;
  if (ppDone) ppDone.textContent = state.storageItems.filter(isComplete).length;
  $("#navStorageCount").textContent = state.storageItems.length; [$("#pcAvatar"), $("#sbAvatar"), $("#ppAvatar")].forEach((el) => { if (!el) return; el.classList.toggle("level-border", level >= 5); el.classList.toggle("level-water", level >= 10); el.innerHTML = prefs.avatarUrl ? `<img class="avatar-img" src="${esc(prefs.avatarUrl)}" alt="${esc(name)}">` : `<span class="avatar-initial">${esc(initial)}</span>`; }); }

function cardHTML(anime, options = {}) { const a = normAnime(anime); const item = options.storageItem || getStored(a.slug); const watched = Number(item?.progress || item?.watchedEpisodes?.at(-1) || 0); const total = Number(a.totalEpisodes || item?.total || 0); const pct = total ? Math.min(100, Math.round(watched / total * 100)) : 0; const selected = options.selected ? " selected" : ""; const inStorage = Boolean(item || options.inStorage); /* Permintaan Neo: menu morph HANYA untuk kartu di bagian Local Storage. Di tampilan lain, kartu yang sudah tersimpan tidak menampilkan tombol + lagi — begitu anime masuk lewat + dan halaman di-render ulang, + hilang dan tersisa tombol mata. */   /* Permintaan Neo 6 Okt: di beranda dan Local Storage, tombol "See Detail" dan ikon mata digabung jadi SATU tombol selebar dua tombol; lanjutan permintaannya isi tombol ini CUKUP ikon mata saja (tanpa teks). Icon-only tetap dipakai di hasil pencarian dan di tombol kedua saat anime belum tersimpan. Lanjutan 6 Okt: di Local Storage tombol detail disamakan ukurannya dengan tombol + (ikon-only 44px); lebar penuh hanya tersisa di beranda untuk kartu tersimpan. */
  const btnDetailWide = `<button class="btn btn-sm" data-act="detail" data-id="${esc(a.slug)}" aria-label="Lihat detail" title="Lihat detail"><svg class="ico"><use href="#i-eye"/></svg></button>`;
  const btnDetailIcon = `<button class="btn btn-sm btn-icon-only" data-act="detail" data-id="${esc(a.slug)}" aria-label="Lihat detail" title="Lihat detail"><svg class="ico"><use href="#i-eye"/></svg></button>`;
  const actionButtons = options.removeMode ? `<button class="btn btn-sm btn-remove" data-act="remove" data-id="${esc(a.slug)}" aria-label="Remove" title="Klik untuk hapus, tahan untuk hapus langsung"><span class="hold-fill"></span><svg class="ico"><use href="#i-trash"/></svg><span class="btn-label">Remove</span></button>` : `${inStorage && options.storageSection ? `<button class="btn btn-sm btn-primary btn-icon-only btn-morph" data-act="goo" data-id="${esc(a.slug)}" aria-haspopup="menu" aria-expanded="false" aria-label="Aksi ${esc(a.title)}" title="Favorite, Dislike, Reset, Hapus"><svg class="ico ico-plus"><use href="#i-plus"/></svg></button>${btnDetailIcon}` : inStorage ? (options.homeSection ? btnDetailWide : btnDetailIcon) : `<button class="btn btn-sm btn-primary btn-icon-only" data-act="add" data-id="${esc(a.slug)}" aria-label="Tambah ke storage" title="Tambah ke Local Storage"><svg class="ico"><use href="#i-plus"/></svg></button><button class="btn btn-sm btn-icon-only" data-act="detail" data-id="${esc(a.slug)}" aria-label="Lihat detail" title="Lihat detail"><svg class="ico"><use href="#i-eye"/></svg></button>`}`; return `<article class="anime-card${selected}"${options.removeMode || options.checkbox ? "" : " data-card-open"} data-id="${esc(a.slug)}"><div class="thumb">${options.rank ? `<span class="rank-badge${options.rank <= 2 ? " top" : ""}">#${options.rank}</span>` : ""}${options.epsBadge ? `<span class="eps-badge">${esc(options.epsBadge)}</span>` : ""}${item?.favorite ? `<span class="fav-mark"><svg class="ico"><use href="#i-star"/></svg></span>` : ""}${options.checkbox ? `<button class="check-wrap${options.selected ? " on" : ""}" data-act="check" data-id="${esc(a.slug)}" aria-label="Pilih ${esc(a.title)}">${options.selected ? "✓" : ""}</button>` : ""}${options.removeMode || options.checkbox ? "" : `<button class="card-play" type="button" data-act="play" data-id="${esc(a.slug)}" aria-label="Tonton ${esc(a.title)}"><svg class="ico"><use href="#i-play"/></svg><span>Tonton</span></button>`}${imageHTML(a)}</div><div class="card-body"><h3 class="card-title" title="${esc(a.title)}">${esc(a.title)}</h3><div class="card-meta"><span class="star"><svg class="ico"><use href="#i-star"/></svg>${a.rating ? a.rating.toFixed(1) : "—"}</span>${options.hideEps ? "" : `<span class="dot"></span><span>${total || "?"} Eps</span>`}${options.showViews ? `<span class="dot"></span><span class="views" title="Jumlah penonton di AniList"><svg class="ico"><use href="#i-eye"/></svg>${a.views ? formatCompactNumber(a.views) : "—"}</span>` : ""}${isComplete({ ...a, progress: watched }) ? `<span class="dot"></span><span style="color:var(--gold)">Complete</span>` : ""}</div>${options.showProgress ? `<div class="progress-row"><div class="progress-top"><span>Ep <b>${watched}</b> / ${total || "?"}</span><span>${pct}%</span></div><div class="bar thin"><i style="width:${pct}%"></i></div></div>` : ""}<div class="card-actions">${actionButtons}</div></div></article>`; }
function empty(title, message) { return `<div class="empty-mini"><strong>${esc(title)}</strong>${esc(message)}</div>`; }
function typeMatches(item, wanted) { if (!wanted) return true; const type = String(item.type || item.format || "").toLowerCase(); if (wanted === "Serial TV") return ["tv", "series", "serial tv", "ona"].some((v) => type.includes(v)); return type === wanted.toLowerCase(); }
function statusMatches(item, wanted) { if (!wanted || wanted === "Rating" || wanted === "Terpopuler") return true; const status = String(item.airingStatus || item.status || "").toLowerCase(); if (wanted === "Selesai Tayang") return /complete|completed|finished|selesai/.test(status); if (wanted === "Sedang Tayang") return /ongoing|airing|sedang|new today/.test(status); if (wanted === "Segera Tayang") return /upcoming|segera|not yet/.test(status); return status === wanted.toLowerCase(); }
function sortItems(items, key) { return [...items].sort((a,b) => key === "az" ? a.title.localeCompare(b.title) : key === "za" ? b.title.localeCompare(a.title) : key === "rating" ? Number(b.rating||0)-Number(a.rating||0) : key === "newest" || key === "updated" ? String(b.updatedAt || b.updateAt || b.aired || "").localeCompare(String(a.updatedAt || a.updateAt || a.aired || "")) : key === "oldest" ? String(a.updatedAt || a.updateAt || a.aired || "").localeCompare(String(b.updatedAt || b.updateAt || b.aired || "")) : key === "popular" ? Number(b.views||b.popularity||0)-Number(a.views||a.popularity||0) : 0); }
async function hydrateStorageMetadata() { const targets = state.storageItems.filter((item) => (!item.genres?.length || !Number(item.rating)) && item.slug); await Promise.allSettled(targets.map(async (item) => { const response = await api.detail(item.slug); const data = response.data || {}; item.genres = (data.genres || item.genres || []).map((g) => typeof g === "string" ? g : g.name).filter(Boolean); item.characters = (data.characters || item.characters || []).map((c) => typeof c === "string" ? c : c.name).filter(Boolean); item.type = data.type || item.type; item.airingStatus = data.status || item.airingStatus || ""; item.rating = Number(data.rating || item.rating || 0); })); saveState(); }
async function refreshStorageFilters() { state.storageFilterLoading = true; renderStorage(); await hydrateStorageMetadata(); state.storageFilterLoading = false; renderStorage(); }
function renderStorage(options = {}) { const q = state.localQuery.toLowerCase(); let items = state.storageItems.filter((item) => { if (state.currentTab === "Complete" && !isComplete(item)) return false; if (state.currentTab === "Plan to Watch" && item.progress) return false; if (state.currentTab === "Dislike" && !item.dislike && item.status !== "dropped") return false; if (state.currentTab === "Favorite" && !item.favorite) return false; if (!typeMatches(item, state.storageType)) return false; if (!statusMatches(item, state.storageStatus)) return false; if (!tagMatch(item, state.storageGenres, "genres")) return false; return !q || `${item.title} ${item.genres.join(" ")}`.toLowerCase().includes(q); }); if (state.storageStatus === "Rating") items = sortItems(items, "rating"); else if (state.storageStatus === "Terpopuler") items = sortItems(items, "popular"); else items = sortItems(items, state.storageSort); const counts = { All: state.storageItems.length, Complete: state.storageItems.filter(isComplete).length, "Plan to Watch": state.storageItems.filter((i) => !i.progress).length, Dislike: state.storageItems.filter((i) => i.dislike || i.status === "dropped").length, Favorite: state.storageItems.filter((i) => i.favorite).length }; $$("#storageTabs .count").forEach((el) => el.textContent = counts[el.dataset.count] || 0); $$("#storageTabs .tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === state.currentTab)); $("#editBar").hidden = !state.editMode; $("#editCount").textContent = `${state.selectedStorageItems.size} dipilih`;
  /* Slide 6×3 (desktop) / 3×3 (mobile): pager muncul hanya jika > 1 halaman */
  const size = pageSize(); const pageCount = pageCountFor(items.length, size);
  state.storagePage = Math.min(state.storagePage, pageCount - 1); state.filteredStorageCount = items.length;
  const paged = pageSlice(items, state.storagePage, size);
  const gridEl = $("#storageGrid");
  gridEl.innerHTML = state.storageFilterLoading ? `<div class="search-skeleton-grid">${[1,2].map(() => `<div class="skeleton-card"></div>`).join("")}</div>` : (paged.length ? paged.map((item) => cardHTML(item, { storageItem: item, storageSection: true, showProgress: true, removeMode: state.editMode, checkbox: state.editMode, selected: state.selectedStorageItems.has(item.slug) })).join("") : empty(state.storageItems.length ? "Tidak ada anime yang ditemukan." : "Belum ada anime di Local Storage.", state.storageItems.length ? "Coba ubah kata kunci, genre, atau kategori." : "Tambahkan anime dari tombol +Storage pada card."));
  const pagerSlot = $("#storagePager"); if (pagerSlot) pagerSlot.innerHTML = pageCount > 1 ? pagerHTML(state.storagePage, pageCount, "storage") : "";
  if (options.pageDir && !state.storageFilterLoading && paged.length) turnPageIn(gridEl, options.pageDir); else staggerIn(gridEl);
  observeScrollReveal(gridEl); bindPager(pagerSlot); bindActions(); }
function renderProfile() { applyProfile(); }
function renderAll() { renderProfile(); renderUpdates(); renderStorage(); renderSearch(); renderContinue(); renderRecommendations(); bindActions(); }

/* ---------- Wave Physics Loader ----------
   Tongak + bola bouncing-ball. Fisikanya dihitung sekali jadi keyframe, lalu
   diputar lewat Web Animations API — bukan rAF — supaya loader tetap hidup
   walau tab tidak terlihat. Tinggi tongbak diubah lewat scaleY supaya tidak
   ada layout tiap frame. */
const WAVE_BARS = 15;
const WAVE_MAX_H = 64;
const WAVE_STEP = 20;
const WAVE_FRAMES = 81;
const WAVE_DURATION = 4000;
function buildWavePhysics() {
  const barScale = [], barOpacity = [], ballX = [], ballY = [], ballScale = [];
  for (let k = 0; k < WAVE_FRAMES; k += 1) {
    const t = k / (WAVE_FRAMES - 1);
    const xFrac = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
    const ballIdx = xFrac * (WAVE_BARS - 1);
    ballX.push(`${(ballIdx * WAVE_STEP).toFixed(2)}px`);
    let bounceF = (xFrac * 4) % 1;
    if (xFrac === 1 || xFrac === 0) bounceF = 0;
    const bounceH = 4 * bounceF * (1 - bounceF);
    const heightFactor = Math.max(0, 1 - bounceH * 2);
    ballY.push(`${(-((16 + 48 - heightFactor * 20) + bounceH * 60)).toFixed(2)}px`);
    /* WAAPI menolak scale(a b) — harus koma. Tanpa ini keyframe bola jadi
       kosong dan bola diam di tempat. */
    ballScale.push(`${(1 + heightFactor * 0.25).toFixed(4)}, ${(1 - heightFactor * 0.3).toFixed(4)}`);
    for (let i = 0; i < WAVE_BARS; i += 1) {
      const dist = Math.abs(i - ballIdx);
      const wave = dist < 3 ? Math.cos((dist / 3) * (Math.PI / 2)) : 0;
      const indent = dist < 1.5 ? Math.cos((dist / 1.5) * (Math.PI / 2)) * heightFactor * 20 : 0;
      barScale.push((Math.max(4, 16 + wave * 48 - indent) / WAVE_MAX_H).toFixed(4));
      barOpacity.push((0.34 + wave * 0.66).toFixed(4));
    }
  }
  return { barScale, barOpacity, ballX, ballY, ballScale };
}
const wavePhysics = buildWavePhysics();
/* Orb "searching" di dalam input pencarian. Dipasang sekali saat boot,
   lalu hanya dikendalikan lewat setBusy(). */
let orb = null;

/* ---------- Kunci input search saat permintaan berjalan ----------
   Setelah Enter, kolom dikunci sampai hasil benar-benar keluar atau gagal.
   Dipakai readOnly, bukan disabled: disabled membuat kolom kehilangan fokus dan
   caret, sedangkan yang kita mau adalah "tidak bisa di otak atik" tanpa
   membuat kolom terasa mati. */
function lockSearch(locked) {
  const input = $("#globalSearch");
  const wrap = $(".search-wrap");
  if (input) input.readOnly = locked;
  wrap?.classList.toggle("is-locked", locked);
  const sub = $("#searchSub");
  sub?.classList.toggle("shiny", locked);
}

/* ---------- Placeholder mesin ketik (text-type) ----------
   Mengganti placeholder statis "Cari anime…" dengan beberapa frasa yang
   diketik lalu dihapus bergantian. Berhenti saat input dipakai supaya tidak
   bertabrakan dengan ketikan pengguna, dan mati total saat reduced-motion. */
(function typePlaceholder() {
  const input = $("#globalSearch");
  if (!input || !input.placeholder) return;
  const PHRASES = ["Cari anime…", "Ketik judul atau genre…", "Contoh: Sailor moon "];
  /* Mobile: satu perintah saja. Genre di sana tidak punya picker, jadi
     "/genre" yang mengiklankannya. Desktop tidak boleh tersentuh - genre
     masih punya tombolnya, jadi placeholder yang lama masih jujur. */
  const mobileCmd = window.matchMedia("(max-width: 767px)");
  const PHRASES_MOBILE = ["/"];
  const phrases = () => (mobileCmd.matches ? PHRASES_MOBILE : PHRASES);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return;
  input.placeholder = phrases()[0];
  let phrase = 0, chars = 0, deleting = false, timer = 0;
  const tick = () => {
    const list = phrases();
    const current = list[phrase % list.length];
    /* Mobile: satu frasa "/genre" yang diketik-hapus membuat layar
       berkedip. Diam saja di situ. */
    if (list === PHRASES_MOBILE) { input.placeholder = current; return; }
    chars += deleting ? -1 : 1;
    input.placeholder = current.slice(0, chars);
    let wait = deleting ? 45 : 95;
    if (!deleting && chars === current.length) { deleting = true; wait = 1500; }
    else if (deleting && chars === 0) { deleting = false; phrase = (phrase + 1) % list.length; wait = 500; }
    timer = setTimeout(tick, wait);
  };
  const stop = () => { clearTimeout(timer); timer = 0; };
  input.addEventListener("focus", stop, { once: true });
  input.addEventListener("input", stop, { once: true });
  /* Jangan mengetik ketika ada permintaan yang sedang jalan. */
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") stop(); });
  mobileCmd.addEventListener("change", () => { stop(); input.placeholder = phrases()[0]; });
  timer = setTimeout(tick, 900);
})();
function waveLoaderHTML(caption = "Memuat update terbaru…") {
  const bars = Array.from({ length: WAVE_BARS }, (_, index) => {
    /* Bentuk diam dipakai kalau Web Animations atau reduced-motion tidak
       tersedia: lengkung sinus ringan, bukan tongak rata. */
    const rest = 0.3 + 0.34 * Math.sin((Math.PI * (index + 0.5)) / WAVE_BARS);
    return `<span class="wave-bar" style="transform:scaleY(${rest.toFixed(3)})"></span>`;
  }).join("");
  const skeleton = Array.from({ length: 6 }, () => `<div class="fluid-skel update-skel-card"></div>`).join("");
  return `<div class="wave-loader" id="waveLoader" role="status" aria-live="polite">
      <div class="wave-stage">${bars}<span class="wave-ball"></span></div>
      <div class="wave-caption">${caption}</div>
    </div>${skeleton}`;
}
function startWavePhysics(root) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!root || reduced || document.documentElement.dataset.performanceTier === "low" || !root.querySelector(".wave-bar")?.animate) return;
  const timing = { duration: WAVE_DURATION, iterations: Infinity, easing: "linear" };
  $$(".wave-bar", root).forEach((bar, index) => {
    const from = index * WAVE_BARS;
    bar.animate({
      transform: wavePhysics.barScale.slice(from, from + WAVE_BARS).map((value) => `scaleY(${value})`),
      opacity: wavePhysics.barOpacity.slice(from, from + WAVE_BARS).map(String),
    }, timing);
  });
  $(".wave-ball", root)?.animate({
    transform: wavePhysics.ballScale.map((scale, index) => `translate(${wavePhysics.ballX[index]}, ${wavePhysics.ballY[index]}) scale(${scale})`),
  }, timing);
}
function renderUpdates() {
  const sub = $("#updateSub");
  const grid = $("#updateGrid");
  /* API butuh waktu memberi feedback, jadi selama itu section New Update
     menampilkan wave loader + fluid skeleton, bukan "Belum ada update". */
  if (state.updateLoading) {
    if (sub) sub.textContent = "Memuat update terbaru…";
    if (grid) { grid.innerHTML = waveLoaderHTML(); startWavePhysics($("#waveLoader", grid)); }
    return;
  }
  if (sub) sub.textContent = `New Update — ${state.daily.length} Title`;
  if (grid) grid.innerHTML = state.daily.length ? state.daily.map((a) => cardHTML(a, { epsBadge: "New Update", homeSection: true })).join("") : empty("Belum ada update.", "Coba lagi nanti.");
  staggerIn(grid); bindActions();
}
/* ---------- Rekomendasi populer & genre ----------
   Dua rail horizontal dengan tombol geser. Populer selalu tampil (10 kartu);
   genre hanya tampil kalau pengguna sudah menamatkan minimal dua anime dengan
   genre yang sama. Data rating/view datang dari /api/recommendations. */
const REC_UI = {
  popular: { section: "#recPopularSection", rail: "#recPopularRail", wrap: "#recPopularSection .rec-rail-wrap", sub: "#recPopularSub", label: "Rekomendasi Populer" },
  genre: { section: "#recGenreSection", rail: "#recGenreRail", wrap: "#recGenreSection .rec-rail-wrap", sub: "#recGenreSub", label: "Rekomendasi Genre" },
};
function recNodes(kind) { const cfg = REC_UI[kind]; return { cfg, section: $(cfg.section), rail: $(cfg.rail), wrap: $(cfg.wrap), sub: $(cfg.sub) }; }
function recSkeletonHTML(count = 6) { return Array.from({ length: count }, () => '<div class="rec-card-skeleton" aria-hidden="true"><span class="rec-skel-art"></span><span class="rec-skel-line"></span><span class="rec-skel-line short"></span></div>').join(""); }
function recCardsHTML(items = []) { return items.map((anime, index) => cardHTML(anime, { rank: index + 1, homeSection: true, showViews: true, hideEps: true })).join(""); }
function updateRecNav(kind) {
  const { rail, wrap } = recNodes(kind);
  if (!rail || !wrap) return;
  const max = rail.scrollWidth - rail.clientWidth;
  wrap.classList.toggle("has-overflow", max > 4);
  const prev = wrap.querySelector("[data-rec-prev]");
  const next = wrap.querySelector("[data-rec-next]");
  if (prev) prev.disabled = rail.scrollLeft <= 2;
  if (next) next.disabled = rail.scrollLeft >= max - 2;
}
function scrollRec(kind, direction) {
  const { rail } = recNodes(kind);
  if (!rail) return;
  const card = rail.querySelector(".anime-card");
  const gap = 14;
  const step = (card ? card.getBoundingClientRect().width : 162) + gap;
  const visible = Math.max(1, Math.floor(rail.clientWidth / step) - 1);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  rail.scrollBy({ left: direction * step * visible, behavior: reduced ? "auto" : "smooth" });
}
function setupRecRails() {
  for (const kind of ["popular", "genre"]) {
    const { rail, wrap } = recNodes(kind);
    wrap?.querySelector("[data-rec-prev]")?.addEventListener("click", () => scrollRec(kind, -1));
    wrap?.querySelector("[data-rec-next]")?.addEventListener("click", () => scrollRec(kind, 1));
    rail?.addEventListener("scroll", () => updateRecNav(kind), { passive: true });
    updateRecNav(kind);
  }
  window.addEventListener("resize", () => { updateRecNav("popular"); updateRecNav("genre"); }, { passive: true });
}
function renderPopularRecommendations() {
  const { section, rail, sub } = recNodes("popular");
  if (!section || !rail) return;
  const show = state.recPopularLoading || state.recPopular.length > 0;
  section.hidden = !show;
  if (!show) return;
  if (sub) sub.textContent = state.recPopularLoading ? "Mencari anime paling populer…" : `${state.recPopular.length} anime · urut view lalu rating`;
  rail.innerHTML = state.recPopularLoading ? recSkeletonHTML() : recCardsHTML(state.recPopular);
  if (!state.recPopularLoading) staggerIn(rail);
  requestAnimationFrame(() => updateRecNav("popular"));
}
function renderGenreRecommendations() {
  const top = topCompletedGenre(state.storageItems, 2);
  const { section, rail, sub } = recNodes("genre");
  if (!section || !rail) return;
  const show = Boolean(top) && (state.recGenreLoading || state.recGenre.length > 0 || state.recGenreName === top.name);
  section.hidden = !show;
  if (!show) return;
  if (state.recGenreLoading) {
    if (sub) sub.textContent = `Mencari anime ${top.name}…`;
    rail.innerHTML = recSkeletonHTML();
  } else if (state.recGenre.length) {
    if (sub) sub.textContent = `${top.count} anime ${top.name} sudah tamat · ${state.recGenre.length} rekomendasi`;
    rail.innerHTML = recCardsHTML(state.recGenre);
    staggerIn(rail);
  } else {
    if (sub) sub.textContent = `Genre ${top.name} · belum ada rekomendasi`;
    rail.innerHTML = empty("Belum ada rekomendasi.", "Coba lagi nanti atau tambah anime lain di genre ini.");
  }
  requestAnimationFrame(() => updateRecNav("genre"));
}
function renderRecommendations() { renderPopularRecommendations(); renderGenreRecommendations(); }
async function loadPopularRecommendations() {
  if (state.recPopularLoading || state.recPopular.length) return;
  state.recPopularLoading = true;
  state.recPopularError = false;
  renderRecommendations();
  try {
    const response = await timed(api.recommendations());
    state.recPopular = (response?.data || []).map(normAnime).filter((anime) => anime.slug);
  } catch (_) {
    state.recPopular = [];
    state.recPopularError = true;
  } finally {
    state.recPopularLoading = false;
    renderRecommendations();
  }
}
async function loadGenreRecommendations({ force = false } = {}) {
  const target = topCompletedGenre(state.storageItems, 2);
  if (!target) {
    state.recGenre = [];
    state.recGenreName = "";
    state.recGenreLoading = false;
    renderRecommendations();
    return;
  }
  /* Genre yang sama dan sudah ada hasil/permintaan berjalan tidak perlu
     ditembak ulang. Ini yang membuat render ulang storage tidak membanjiri
     server. */
  if (!force && state.recGenreName === target.name && (state.recGenre.length || state.recGenreLoading)) {
    renderRecommendations();
    return;
  }
  const requested = target.name;
  state.recGenreName = requested;
  state.recGenre = [];
  state.recGenreLoading = true;
  renderRecommendations();
  try {
    const response = await timed(api.recommendations(requested));
    if (state.recGenreName !== requested) return;
    state.recGenre = (response?.data || []).map(normAnime).filter((anime) => anime.slug);
  } catch (_) {
    if (state.recGenreName === requested) state.recGenre = [];
  } finally {
    if (state.recGenreName === requested) {
      state.recGenreLoading = false;
      renderRecommendations();
    }
  }
}
async function loadRecommendations() {
  /* Berurutan, bukan bersamaan: populer mengisi cache judul AniList lebih
     dulu, jadi genre tidak menembak judul yang sama dan tidak memicu 429. */
  await loadPopularRecommendations();
  await loadGenreRecommendations();
}

function renderSearch(options = {}) { const active = state.searchQuery || state.mainGenres.size || state.mainType || state.mainStatus; const section = $("#searchSection"); if (!active) { hideSection(section); if (orb) orb.setBusy(false); updateSearchUI(); return; } showSection(section); let items = state.searchResults.filter((a) => typeMatches(a, state.mainType) && statusMatches(a, state.mainStatus)); if (state.mainStatus === "Rating") items = sortItems(items, "rating"); else if (state.mainStatus === "Terpopuler") items = sortItems(items, "popular"); $("#searchSub").textContent = state.searchLoading ? "Mencari…" : `${items.length} hasil`;
  /* Slide 6×3 (desktop) / 3×3 (mobile): pager muncul hanya jika > 1 halaman */
  const size = pageSize(); const pageCount = pageCountFor(items.length, size);
  state.searchPage = Math.min(state.searchPage, pageCount - 1); state.filteredSearchCount = items.length;
  const paged = pageSlice(items, state.searchPage, size);
  const gridEl = $("#searchGrid");
  /* Skeleton search disuntik LANGSUNG ke .card-grid, sama seperti
     renderUpdates(). Sebelumnya dibungkus .search-skeleton-grid, dan
     wrapper itu jadi satu cell grid — akibatnya kartu skeleton turun ke
     bawah satu per satu, bukan mendatar seperti kartu hasil aslinya.
     Loader-nya juga disamakan dengan New Update: wave physics + fluid
     skeleton, supaya tidak ada dua bahasa loading di aplikasi yang sama. */
  if (state.searchLoading) {
    gridEl.innerHTML = waveLoaderHTML("Mencari…");
    startWavePhysics($("#waveLoader", gridEl));
    if (orb) orb.setBusy(true);
    lockSearch(true);
  } else {
    lockSearch(false);
    if (orb) orb.setBusy(false);
    gridEl.innerHTML = paged.length ? paged.map((a) => cardHTML(a, { showProgress: true, inStorage: Boolean(getStored(a.slug)) })).join("") : empty("Tidak ada anime yang ditemukan.", "Coba ubah kata kunci atau filter.");
  }
  const pagerSlot = $("#searchPager"); if (pagerSlot) pagerSlot.innerHTML = pageCount > 1 ? pagerHTML(state.searchPage, pageCount, "search") : "";
  if (options.deal && !state.searchLoading && paged.length) dealCards(gridEl);
  else if (options.pageDir && !state.searchLoading && paged.length) turnPageIn(gridEl, options.pageDir);
  else staggerIn(gridEl);
  observeScrollReveal(gridEl); bindPager(pagerSlot); bindActions(); updateSearchUI(); }

/* Animasi buka/tutup section search */
function showSection(section) {
  if (!section.hidden) return;
  section.hidden = false;
  section.classList.add("section-in");
  section.addEventListener("animationend", () => section.classList.remove("section-in"), { once: true });
  window.setTimeout(() => section.classList.remove("section-in"), 450);
}
function hideSection(section) {
  if (section.hidden) return;
  section.classList.add("section-out");
  const finish = () => { section.hidden = true; section.classList.remove("section-out"); };
  section.addEventListener("animationend", finish, { once: true });
  window.setTimeout(finish, 300);
}

/* Pencarian gabungan: nama + genre dikirim ke server; tipe & status difilter
   dari hasil yang sama di sisi klien (endpoint server hanya menerima search
   + genre). Satu tekan cari = nama + genre + tipe + status sekaligus. */
async function search(query = state.searchQuery) {
  state.searchQuery = String(query || "").trim();
  const input = $("#globalSearch"); if (input && input.value !== state.searchQuery) input.value = state.searchQuery;
  state.searchLoading = true; state.searchResults = []; state.searchPage = 0; renderSearch(); const token = ++state.searchToken;
  try {
    const selectedGenres = [...state.mainGenres]; const results = [];
    if (selectedGenres.length) { for (const genre of selectedGenres) { const part = await timed(api.catalog(state.searchQuery, genre)); results.push(...(part.data || [])); } }
    else { const result = await timed(api.catalog(state.searchQuery, "")); results.push(...(result.data || [])); }
    if (token !== state.searchToken) return;
    state.searchResults = [...new Map(results.map((item) => [item.slug || item.id || item.title, item])).values()].map(normAnime);
    state.searchLoading = false; renderSearch({ deal: true });
  } catch (error) {
    if (token !== state.searchToken) return;
    state.searchResults = []; state.searchLoading = false; $("#searchSub").textContent = error.message; renderSearch();
  }
}

/* ---------- Search main: hint, chip pilihan, morph Search↔X ---------- */
function activeSearchPicks() {
  const picks = [];
  [...state.mainGenres].forEach((slug) => picks.push({ kind: "genre", label: labelForGenre(slug), slug }));
  if (state.mainType) picks.push({ kind: "tipe", label: state.mainType });
  if (state.mainStatus) picks.push({ kind: "status", label: state.mainStatus });
  return picks;
}
function updateSearchUI() {
  const picks = activeSearchPicks();
  const hasPicks = picks.length > 0;
  /* Ketikan hidup juga dihitung agar chip naik ke dalam search SEGERA saat
     pengguna menulis nama, bukan hanya setelah Enter. */
  const liveQuery = ($("#globalSearch")?.value || "").trim();
  const hasQuery = Boolean(liveQuery || state.searchQuery);
  const hasSearched = Boolean(state.searchQuery || state.searchResults.length);
  const hint = $("#searchHint"), tags = $("#searchHintTags"), chips = $("#searchFilterChips"), morph = $("#searchMorphBtn");
  /* Pemilihan saja → hint dropdown "Cari sesuai pilihan" di bawah kotak.
     Pemilihan + nama → hint naik jadi chip di dalam kotak search. */
  if (hint) {
    hint.hidden = !(hasPicks && !hasQuery);
    /* Bersihkan isi saat tersembunyi agar tidak menyisakan tag basi */
    /* Tag di bawah kotak dibuat bisa diklik, bukan sekadar label. Di mobile
       inilah satu-satunya tempat pilihan genre terlihat (picker-nya
       disembunyikan), jadi tag yang tak bisa dihapus berarti pilihan yang
       tidak bisa dibatalkan dari layar yang sama. */
    tags.innerHTML = !hint.hidden ? picks.map((p) => `<button type="button" class="sh-tag" data-chip-kind="${p.kind}" data-chip-key="${esc(p.slug || p.label)}" title="Hapus pilihan ini">${esc(p.label)}<svg class="ico"><use href="#i-close"/></svg></button>`).join("") : "";
    if (!hint.hidden) $$("[data-chip-key]", tags).forEach((btn) => btn.onclick = (event) => { event.stopPropagation(); removeSearchPick(btn.dataset.chipKind, btn.dataset.chipKey); });
  }
  if (chips) {
    chips.hidden = !(hasPicks && hasQuery);
    /* Kosongkan saat tersembunyi — jangan tinggalkan chip basi di dalam DOM */
    chips.innerHTML = !chips.hidden ? picks.map((p) => `<button class="sf-chip" data-chip-kind="${p.kind}" data-chip-key="${esc(p.slug || p.label)}" title="Hapus pilihan ini">${esc(p.label)}<svg class="ico"><use href="#i-close"/></svg></button>`).join("") : "";
    if (!chips.hidden) $$("[data-chip-kind]", chips).forEach((btn) => btn.onclick = (event) => { event.stopPropagation(); removeSearchPick(btn.dataset.chipKind, btn.dataset.chipKey); });
  }
  if (morph) {
    morph.classList.toggle("is-clear", hasSearched);
    morph.dataset.mode = hasSearched ? "clear" : "search";
    morph.title = hasSearched ? "Bersihkan pencarian & pilihan" : "Cari";
  }
  $(".search-wrap")?.classList.toggle("has-picks", hasPicks);
}
function removeSearchPick(kind, key) {
  if (kind === "genre") {
    state.mainGenres.delete(key);
    $(`.gf-header .gf-chip[data-genre="${CSS.escape(key)}"]`)?.classList.remove("on");
    updateFilterLabel($(".gf-header"), state.mainGenres, "All Genre");
  } else if (kind === "tipe") { state.mainType = ""; resetDropdownUI("mainType"); }
  else { state.mainStatus = ""; resetDropdownUI("mainStatus"); }
  renderSearch(); updateSearchUI();
}
function resetDropdownUI(key) {
  const root = $(`.styled-filter[data-filter="${key}"]`);
  if (!root) return;
  $(".gf-label", root).textContent = root.dataset.label || "—";
  root.classList.remove("has-active-root");
  $(".gf-trigger", root).classList.remove("has-active");
  $$(".gf-chip.on", root).forEach((b) => b.classList.remove("on"));
}
/* X di search main: bersihkan kata kunci + semua pilihan (genre/tipe/status)
   + hasil sekaligus. */
function clearAllSearch() {
  const input = $("#globalSearch");
  if (input) input.value = "";
  state.searchQuery = ""; state.searchResults = []; state.searchPage = 0;
  state.mainType = ""; state.mainStatus = "";
  $(".gf-header [data-gf-clear]")?.click();
  resetDropdownUI("mainType"); resetDropdownUI("mainStatus");
  renderSearch(); updateSearchUI();
}

/* ---------- Tema: morph icon sun/moon + transisi warna halaman ----------
   View Transitions API untuk crossfade warna dark↔light; browser tanpa
   dukungan dapat fallback fade ringan. Tanpa slide kanan-kiri. */
function applyTheme(theme, { animate = false } = {}) {
  const rootEl = document.documentElement;
  const commit = () => {
    rootEl.dataset.theme = theme;
    $$("[data-theme-toggle]").forEach((btn) => btn.classList.toggle("is-light", theme === "light"));
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduced || typeof document.startViewTransition !== "function") {
    if (animate && !reduced) rootEl.animate?.([{ opacity: 0.88 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    commit();
    return;
  }
  document.startViewTransition(commit);
}
/* ---------- Urutan tombol + ----------
   cross-spinner → tombol bergetar + sapuan shine + partikel kilau → tombol
   pecah → baru anime masuk ke Local Storage. Semua murni CSS/WAAPI; kalau
   pengguna minta reduced motion atau tier rendah, commit langsung. */
const ADD_FX_SPIN_MS = 460;
const ADD_FX_SHAKE_MS = 280;
const ADD_FX_BURST_MS = 300;
const ADD_FX_SPARKS = 14;
function addFxBurst(button) {
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const layer = document.createElement("div");
  layer.className = "add-fx";
  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  const sweep = document.createElement("div");
  sweep.className = "add-fx-sweep";
  layer.appendChild(sweep);
  /* Partikel meledak radial dari tengah tombol, setengah emas setengah putih. */
  for (let index = 0; index < ADD_FX_SPARKS; index += 1) {
    const angle = (Math.PI * 2 * index) / ADD_FX_SPARKS + (index % 3) * 0.22;
    const distance = 26 + (index % 4) * 13;
    const spark = document.createElement("i");
    spark.className = index % 2 ? "add-fx-spark gold" : "add-fx-spark";
    spark.style.left = "50%";
    spark.style.top = "50%";
    spark.style.setProperty("--dx", `${(Math.cos(angle) * distance).toFixed(1)}px`);
    spark.style.setProperty("--dy", `${(Math.sin(angle) * distance).toFixed(1)}px`);
    spark.style.animationDelay = `${(index % 4) * 22}ms`;
    layer.appendChild(spark);
  }
  document.body.appendChild(layer);
  return layer;
}
function playAddSequence(button, commit) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!button || reduced || document.documentElement.dataset.performanceTier === "low") { commit(); return; }
  button.classList.add("btn-add-busy");
  const spinner = document.createElement("span");
  spinner.className = "cross-spinner is-on";
  spinner.innerHTML = "<i></i><i></i>";
  button.appendChild(spinner);
  let layer = null;
  setTimeout(() => {
    spinner.remove();
    button.classList.add("btn-add-shake");
    layer = addFxBurst(button);
    setTimeout(() => {
      button.classList.remove("btn-add-shake");
      button.classList.add("btn-add-burst");
      setTimeout(() => {
        layer?.remove();
        button.classList.remove("btn-add-busy", "btn-add-burst");
        commit();
      }, ADD_FX_BURST_MS);
    }, ADD_FX_SHAKE_MS);
  }, ADD_FX_SPIN_MS);
}
function commitAddStorage(id) {
  const a = normAnime(findAnime(id));
  if (!a || getStored(a.slug)) return;
  state.storageItems.unshift(normalizeStored({ slug: a.slug, title: a.title, image: a.image, total: a.total, status: "planned", progress: 0, watchedEpisodes: [], genres: a.genres }));
  saveState(); renderAll();
  toast("Ditambahkan ke Local Storage", a.title);
}
function addStorage(id, button) {
  const a = normAnime(findAnime(id));
  if (!a || getStored(a.slug)) return;
  playAddSequence(button, () => commitAddStorage(id));
}
function removeStorage(id) { const removed = state.storageItems.find((i) => i.slug === id); state.storageItems = state.storageItems.filter((i) => i.slug !== id); state.selectedStorageItems.delete(id); saveState(); renderAll(); loadGenreRecommendations(); toast("Berhasil dihapus", `${removed?.title || "Anime"} dihapus dari Local Storage.`); }
/* Favorite / Dislike dari detail page: membuat entri storage bila belum ada,
   lalu toggle reaksinya (saling eksklusif). Tombol di-update langsung tanpa
   renderDetail penuh agar player yang sedang berjalan tidak ikut ter-reset. */
function setAnimeReaction(slug, kind) {
  let item = getStored(slug);
  if (!item) {
    const a = normAnime(findAnime(slug) || state.detail);
    if (!a?.slug) return;
    state.storageItems.unshift(normalizeStored({ slug: a.slug, title: a.title, image: a.image, total: a.total, status: "watching", progress: 0, watchedEpisodes: [], genres: a.genres }));
    item = getStored(a.slug);
  }
  if (!item) return;
  const next = kind === "favorite" ? { favorite: !item.favorite, dislike: false } : { dislike: !item.dislike, favorite: false };
  Object.assign(item, next);
  saveState();
  if (next.favorite) toast("Ditambahkan ke Favorite", item.title || "Anime");
  else if (next.dislike) toast("Ditandai Dislike", item.title || "Anime");
  const stored = getStored(slug);
  const favBtn = $("[data-detail-fav]"), disBtn = $("[data-detail-dislike]");
  if (favBtn) { favBtn.classList.toggle("is-fav", Boolean(stored?.favorite)); favBtn.setAttribute("aria-pressed", String(Boolean(stored?.favorite))); $(".rb-label", favBtn).textContent = stored?.favorite ? "Favorit" : "Favorite"; }
  if (disBtn) { disBtn.classList.toggle("is-dislike", Boolean(stored?.dislike)); disBtn.setAttribute("aria-pressed", String(Boolean(stored?.dislike))); }
  renderProfile(); renderStorage();
}
/* options.silent = true melewati animasi "Menghapus data…". Animasi itu
   bernada perpisahan dan hanya cocok untuk penghapusan permanen; untuk
   aksi lain (mis. reset progress) hanya membingungkan. */
function openConfirm(title, message, onConfirm, options = {}) { const root = $("#confirmRoot"); /* Dialog bersifat modal: jangan menumpuk kalau pemicu terpicu dua kali (mis. hold selesai dua kali). */ root.querySelectorAll(".overlay").forEach((lama) => lama.remove()); const overlay = document.createElement("div"); overlay.className = "overlay"; const confirmLabel = options.confirmLabel || "Hapus"; const confirmClass = options.confirmClass || "btn btn-danger"; overlay.innerHTML = `<div class="confirm-modal${options.silent ? "" : " destructive"}" role="dialog" aria-modal="true"><div class="confirm-alert"><svg class="ico"><use href="#i-alert"/></svg></div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="confirm-actions">${options.hold ? `<button class="${confirmClass} hold-btn" data-confirm title="Tahan ${(options.hold / 1000).toFixed(1)} detik untuk menghapus"><span class="hold-fill"></span>${esc(confirmLabel)} — Hold ${(options.hold / 1000).toFixed(1)}s</button>` : `<button class="${confirmClass}" data-confirm>${esc(confirmLabel)}</button>`}<button class="btn btn-ghost" data-cancel>Batal</button></div></div>`; root.appendChild(overlay); const close = () => { overlay.classList.add("is-closing"); $(".confirm-modal", overlay).classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); }; const runConfirm = () => { close(); setTimeout(() => (options.silent ? onConfirm() : playEraseSequence(onConfirm)), 230); }; $("[data-cancel]", overlay).onclick = close; const confirmBtn = $("[data-confirm]", overlay); /* Hapus-total jadi tahan tombol, sama seperti Delete Data di sidebar: satu klik tak boleh menghapus semua koleksi. */ if (options.hold) holdable(confirmBtn, options.hold, runConfirm); else confirmBtn.onclick = runConfirm; overlay.onclick = (e) => { if (e.target === overlay) close(); }; }
/* Alert popup sederhana (bukan window.alert) — gaya sama dengan confirm */
function openAlert(title, message) { const root = $("#confirmRoot"); const overlay = document.createElement("div"); overlay.className = "overlay"; overlay.innerHTML = `<div class="confirm-modal" role="alertdialog" aria-modal="true"><div class="confirm-alert warn"><svg class="ico"><use href="#i-alert"/></svg></div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="confirm-actions"><button class="btn btn-primary" data-alert-close>Mengerti</button></div></div>`; root.appendChild(overlay); const close = () => { overlay.classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); }; $("[data-alert-close]", overlay).onclick = close; overlay.onclick = (e) => { if (e.target === overlay) close(); }; }
/* Urutan hapus data: overlay sad.jpg + progress erase, lalu jalankan aksi */
function playEraseSequence(onDone) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { onDone(); return; }
  const wrap = document.createElement("div");
  wrap.className = "erase-overlay";
  wrap.innerHTML = `<div class="erase-card"><img class="erase-sad" src="/assets/sad.jpg" alt="Sedih kehilangan data"><div class="erase-title">Menghapus data…</div><div class="erase-sub">Koleksi dan progresmu sedang dihapus. Semoga bertemu lagi di lain pengaturan.</div><div class="erase-track"><i class="erase-fill"></i></div><div class="erase-pct">0%</div></div>`;
  document.body.appendChild(wrap);
  const fill = $(".erase-fill", wrap), pct = $(".erase-pct", wrap);
  const started = performance.now();
  const DURATION = 1800;
  const tick = (now) => {
    const p = Math.min(1, (now - started) / DURATION);
    fill.style.width = `${p * 100}%`;
    pct.textContent = `${Math.round(p * 100)}%`;
    if (p < 1) requestAnimationFrame(tick);
    else { $(".erase-card", wrap).classList.add("erase-done"); setTimeout(() => { wrap.remove(); onDone(); }, 650); }
  };
  requestAnimationFrame(tick);
}
function holdable(el, duration, onDone) { if (!el) return; let raf = 0; let start = 0; let holding = false; const stop = (done = false) => { holding = false; cancelAnimationFrame(raf); el.style.setProperty("--hold", done ? 1 : 0); if (done) onDone(); }; const tick = () => { if (!holding) return; const progress = Math.min(1, (performance.now() - start) / duration); el.style.setProperty("--hold", progress); if (progress >= 1) stop(true); else raf = requestAnimationFrame(tick); }; el.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); holding = true; start = performance.now(); raf = requestAnimationFrame(tick); }); ["pointerup", "pointerleave", "pointercancel"].forEach((event) => el.addEventListener(event, () => stop(false))); }
function markWatched(number) { const a = state.detail; if (!a) return; const current = getStored(a.slug) || normalizeStored({ slug: a.slug, title: a.title, image: a.image, total: a.total, watchedEpisodes: [], progress: 0, status: "watching", genres: a.genres }); current.watchedEpisodes = [...new Set([...(current.watchedEpisodes || []), Number(number)])].sort((x, y) => x - y); current.progress = Math.max(current.progress, Number(number)); current.status = isComplete(current) ? "completed" : "watching"; current.lastWatchedAt = Date.now(); state.storageItems = [...state.storageItems.filter((i) => i.slug !== current.slug), current]; saveState(); renderProfile(); renderStorage(); renderContinue(); renderRecommendations(); loadGenreRecommendations(); syncWatchedMarks(); }

/* ---------- Jam tonton: episode hanya dicentang setelah benar-benar ditonton ----------
   Dulu episode langsung dicentang begitu iframe selesai dimuat. Akibatnya
   pengguna yang kebetulan membuka lalu menutup episode ikut tercentang, dan
   "Lanjutkan Menonton" melompat ke episode berikutnya. Centang baru muncul
   setelah nonton cukup lama.

   Mirror berada di iframe lintas domain, jadi posisi playback tidak bisa
   dibaca dari sini. Yang dipakai adalah waktu tempel (wall clock) selama
   modal terbuka dan tab sedang terlihat. */
const WATCHED_SECONDS = 600;
let watchClock = { number: 0, elapsed: 0, timer: null, committed: false };

function startWatchClock(number) {
  stopWatchClock();
  watchClock = { number: Number(number), elapsed: 0, timer: null, committed: false };
  if (!Number.isFinite(watchClock.number) || watchClock.number <= 0) return;
  watchClock.timer = setInterval(() => {
    /* Tab tersembunyi atau minimize tidak dihitung sebagai menonton. */
    if (document.visibilityState !== "visible" || !state.detail) return;
    watchClock.elapsed += 5;
    if (watchClock.elapsed >= WATCHED_SECONDS) commitWatchClock();
  }, 5000);
}
function commitWatchClock() {
  if (watchClock.committed) return;
  watchClock.committed = true;
  const number = watchClock.number;
  stopWatchClock();
  markWatched(number);
  toast("Episode ditandai ditonton", `EP ${String(number).padStart(2, "0")} sudah cukup ditonton.`);
}
function stopWatchClock() {
  clearInterval(watchClock.timer);
  watchClock = { number: 0, elapsed: 0, timer: null, committed: false };
}

/* Centang di daftar episode diperbarui tanpa renderDetail(), karena
   renderDetail() mengosongkan #playerBox dan player yang sedang berjalan
   ikut ter-reset. */
function syncWatchedMarks() {
  const slug = state.detail?.slug;
  if (!slug) return;
  const watched = new Set((getStored(slug)?.watchedEpisodes || []).map(Number));
  $$("#episodeList .ep-item").forEach((button) => {
    const on = watched.has(Number(button.dataset.episodeNumber));
    button.classList.toggle("watched", on);
    const mark = $(".st", button);
    if (mark) mark.textContent = on ? "✓" : "";
  });
}

/* ---------- Hapus seluruh data lokal ----------
   Koleksi/progres TIDAK CUMA dihapus: prefs (nama, foto, tema, sidebar) juga
   dikembalikan ke bawaan. Sebelumnya prefs tidak pernah disentuh sehingga
   nama dan foto profil tetap nempel padahal pesan konfirmasinya menjanjikan
   semuanya terhapus. */
function deleteAllLocal() {
  state.storageItems = [];
  state.selectedStorageItems.clear();
  state.currentTab = "All";
  state.localQuery = "";
  state.storageGenres.clear();
  state.editMode = false;
  prefs = { ...DEFAULT_PREFS };
  localStorage.removeItem(PREFS_KEY);
  saveState();
  applyTheme(prefs.theme);
  $("#app").classList.remove("collapsed");
  $("#profilePopup").hidden = true;
  renderAll();
  toast("Data lokal dihapus", "Koleksi, progres, dan profil sudah kembali ke awal.");
}

/* ---------- Reset progress ----------
   Mengosongkan episode yang ditandai, mengembalikan status ke "planned", lalu
   memutar ulang dari episode pertama. Item tetap ada di Local Storage. */
function resetProgress(slug) {
  const item = getStored(slug);
  if (!item) return;
  stopWatchClock();
  item.watchedEpisodes = [];
  item.progress = 0;
  item.status = "planned";
  delete item.lastWatchedAt;
  state.storageItems = state.storageItems.map((i) => (i.slug === slug ? item : i));
  saveState(); renderProfile(); renderStorage(); renderContinue();
  const first = state.detail?.episodes?.[0];
  if (first?.slug) playEpisode(first.slug, Number(first.number), null);
  else renderDetail();
  toast("Progress direset", `${item.title} kembali ke Episode 1.`);
}

/* Sandbox iframe mirror: scripts dan same-origin tetap diizinkan supaya
   player pihak ketiga bisa memutar video, tapi popup, top-navigation,
   modal, form, dan unduhan otomatis tidak. Tanpa allow-popups dan
   allow-top-navigation, iklan tidak bisa melempar pengguna ke tab/halaman
   lain. allowfullscreen tetap ada karena aplikasi ini belum punya tombol
   fullscreen sendiri untuk iframe mirror. */
const MIRROR_SANDBOX = "allow-scripts allow-same-origin allow-presentation";
function buatIframeMirror(url, title = "Anime stream", options = {}) {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch { return null; }
  const frame = document.createElement("iframe");
  frame.src = raw;
  frame.title = title;
  frame.setAttribute("sandbox", MIRROR_SANDBOX);
  frame.allow = options.allow || "autoplay; fullscreen; picture-in-picture";
  if (options.allowFullscreen !== false) frame.setAttribute("allowfullscreen", "");
  if (options.className) frame.className = options.className;
  if (options.loading) frame.loading = options.loading;
  return frame;
}

async function playEpisode(slug, number, button) { const episodes = state.detail?.episodes || []; state.mirrorSlug = slug; const newIndex = episodes.findIndex((e) => e.slug === slug); const direction = newIndex > state.episodeIndex ? "right" : "left"; state.episodeIndex = newIndex; startWatchClock(number); renderDetail(); updateEpisodeNav(); $("#playerBox").innerHTML = `<div class="player-loading"><div class="spinner"></div></div>`; try { const response = await api.mirrors(slug); state.mirrors = response.data || []; muatLaporanPublik(slug); if (!state.mirrors.length) throw new Error("Mirror tidak tersedia saat ini."); state.mirrorIndex = 0; loadMirror(0, direction); button?.classList.add("watched"); } catch (error) { state.mirrors = []; state.mirrorIndex = 0; $("#mirrorLabel").textContent = "Mirror tidak tersedia"; $("#playerBox").innerHTML = `<div class="player-ph"><div class="msg">${esc(error.message)}</div></div>`; } }
/* Mirror yang ditandai mati disembunyikan dari daftar, tetapi state.mirrors
   tidak diubah: indeks asli tetap dipakai supaya mirrorIndex dan pemutar
   tidak menunjuk entri yang salah. Penandanya dipasang manual oleh pengguna
   setelah sebuah mirror hanya menampilkan layar hitam/halaman asing. */
function slugMirrorAktif() {
  return state.mirrorSlug || state.detail?.episodes?.[state.episodeIndex]?.slug || "";
}
function opsiMirrorTampil() {
  return saringMirror(state.mirrors, urlMatiMirror(slugMirrorAktif()), state.tampilMatiMirror);
}
function renderOpsiMirror(index) {
  const box = $("#mirrorOptions");
  if (!box) return;
  const { daftar, tersembunyi } = opsiMirrorTampil();
  const baris = daftar.map(({ mirror, index: i, mati }) => {
    const nama = esc(mirror.name || `Mirror ${i + 1}`);
    const tombol = mati
      ? `<button type="button" class="mirror-mark is-on" data-mirror-hidup="${i}" title="Batalkan tanda mati mirror ini" aria-label="Batalkan tanda mati ${nama}"><svg class="ico"><use href="#i-refresh"/></svg></button>`
      : `<button type="button" class="mirror-mark" data-mirror-mati="${i}" title="Tandai mirror ini mati" aria-label="Tandai ${nama} mati"><svg class="ico"><use href="#i-close"/></svg></button>`;
    return `<div class="mirror-row${mati ? " is-mati" : ""}"><button data-mirror-index="${i}" class="${i === index ? "active" : ""}">${nama}</button>${tombol}</div>`;
  }).join("");
  const tampil = tersembunyi
    ? `<button type="button" class="mirror-tampil-mati" data-mirror-tampil-mati="1">${state.tampilMatiMirror ? `Sembunyikan ${tersembunyi} mirror mati` : `Tampilkan ${tersembunyi} mirror mati`}</button>`
    : "";
  box.innerHTML = baris + tampil;
  $$("#mirrorOptions [data-mirror-index]").forEach((b) => b.onclick = (event) => { event.stopPropagation(); loadMirror(Number(b.dataset.mirrorIndex), Number(b.dataset.mirrorIndex) > index ? "right" : "left"); });
  $$("#mirrorOptions [data-mirror-mati]").forEach((b) => b.onclick = (event) => { event.stopPropagation(); tandaiMirrorMati(Number(b.dataset.mirrorMati)); });
  $$("#mirrorOptions [data-mirror-hidup]").forEach((b) => b.onclick = (event) => { event.stopPropagation(); hidupkanMirror(Number(b.dataset.mirrorHidup)); });
  const pembuka = $("#mirrorOptions [data-mirror-tampil-mati]");
  if (pembuka) pembuka.onclick = (event) => { event.stopPropagation(); state.tampilMatiMirror = !state.tampilMatiMirror; renderOpsiMirror(state.mirrorIndex); };
}
function tandaiMirrorMati(index) {
  const mirror = state.mirrors[index];
  if (!mirror) return;
  const slug = slugMirrorAktif();
  const hash = sidikTautan(mirror.url);
  if (!tautanMati.tandai(kunciMirror(slug, mirror.url), { sebab: "tidak bisa diputar" })) return;
  tautanHidup.hapus(kunciLaporan("mirror", slug, hash));
  laporkanMati("mirror", hash, slug);
  const { daftar } = opsiMirrorTampil();
  const pengganti = daftar.find((item) => item.index !== index);
  toast("Mirror ditandai mati", "Mirror disembunyikan dari daftar. Pakai tombol tampilkan untuk melihatnya lagi.");
  /* Yang sedang diputar ikut pindah supaya pengguna tidak tertinggal di
     layar hitam. Kalau semua mirror sudah ditandai, daftar tetap tampil
     dengan tombol untuk membuka kembali. */
  if (index === state.mirrorIndex && pengganti) loadMirror(pengganti.index, "left");
  else renderOpsiMirror(state.mirrorIndex);
}
function hidupkanMirror(index) {
  const mirror = state.mirrors[index];
  if (!mirror) return;
  const slug = slugMirrorAktif();
  tautanMati.hapus(kunciMirror(slug, mirror.url));
  /* Laporan publik untuk mirror ini tidak boleh menyembunyikannya lagi di
     perangkat pengguna yang sudah melihatnya berfungsi. */
  tautanHidup.tandai(kunciLaporan("mirror", slug, sidikTautan(mirror.url)), { sebab: "terbukti hidup" });
  renderOpsiMirror(state.mirrorIndex);
  toast("Tanda mati dihapus", "Mirror muncul lagi di daftar.");
}
/* Kirim laporan ke server tanpa menahan UI. Gagal kirim bukan kegagalan
   pengguna: tanda lokal sudah disimpan lebih dulu, dan laporan dikirim lagi
   saat tautan yang sama ditandai pada kesempatan berikutnya. */
function laporkanMati(jenis, identitas, episode = "") {
  const id = String(identitas || "");
  if (!id) return;
  try {
    const pelapor = idPelapor();
    if (!pelapor) return;
    api.laporkanTautan({ jenis, id, episode: String(episode || ""), pelapor })
      .then((hasil) => {
        if (Number(hasil?.jumlah) >= Number(hasil?.ambang || 2)) muatLaporanPublik(episode || "", true);
      })
      .catch(() => { /* offline: penanda lokal tetap dipakai */ });
  } catch { /* storage diblokir, jangan sampai menandai ikut gagal */ }
}
/* Laporan publik diambil maksimal sekali per menit per episode. Ambangnya
   datang dari server; satu laporan tidak cukup untuk menyembunyikan tautan. */
const laporanTerakhir = new Map();
async function muatLaporanPublik(episode = "", paksa = false) {
  const slug = String(episode || "");
  const sekarang = Date.now();
  if (!paksa && sekarang - (laporanTerakhir.get(slug) || 0) < 60_000) return;
  laporanTerakhir.set(slug, sekarang);
  try {
    const hasil = await api.laporan(slug);
    const ambang = Number(hasil?.ambang) > 0 ? Number(hasil.ambang) : 2;
    /* Digabung, bukan diganti: laporan episode sebelumnya tetap berlaku saat
       pengguna berpindah-pindah episode dalam satu sesi. */
    const baru = gabungLaporan(hasil?.data, ambang);
    if (!(state.laporan?.unduhan instanceof Set)) state.laporan = { unduhan: new Set(), mirror: new Map(), ambang };
    for (const id of baru.unduhan) state.laporan.unduhan.add(id);
    if (!(state.laporan.mirror instanceof Map)) state.laporan.mirror = new Map();
    for (const [episodeSlug, ids] of baru.mirror) state.laporan.mirror.set(episodeSlug, ids);
    state.laporan.ambang = ambang;
    if (state.detail) renderUnduhan();
    /* Mirror yang sedang diputar bisa saja baru dilaporkan mati oleh orang
       lain. Pindah ke mirror yang masih dianggap hidup, jangan tinggalkan
       pengguna di layar hitam. */
    if (state.mirrors.length) {
      const { daftar } = opsiMirrorTampil();
      if (!daftar.some((item) => item.index === state.mirrorIndex)) {
        if (daftar[0]) loadMirror(daftar[0].index, "left");
      } else renderOpsiMirror(state.mirrorIndex);
    }
  } catch { /* offline: penanda lokal tetap berlaku */ }
}
function loadMirror(index, direction = "right") { const mirror = state.mirrors[index]; if (!mirror) return; state.mirrorIndex = index; const box = $("#playerBox"); box.classList.add("mirror-fading"); setTimeout(() => { const frame = buatIframeMirror(mirror.url, "Anime stream"); if (!frame) { box.classList.remove("mirror-fading"); box.innerHTML = `<div class="player-ph"><div class="msg">Mirror ini diblokir karena mengarah ke halaman iklan.</div></div>`; return; } box.replaceChildren(frame); box.classList.remove("mirror-fading"); box.classList.add(`mirror-in-${direction === "left" ? "left" : "right"}`); box.addEventListener("animationend", () => box.classList.remove("mirror-in-right", "mirror-in-left"), { once: true }); showVideoControls(); }, 170); $("#mirrorLabel").textContent = mirror.name || `Mirror ${index + 1}`; renderOpsiMirror(index); closeActive(); /* #mirrorNote dihapus bersama sidebar kanannya: catatan itu hanya relevan
   kalau kontrol player melayang di atas video. Sekarang mirror select jadi
   baris sendiri di bawah iframe, jadi catatan tidak lagi dibutuhkan.
   Optional chaining dipakai kalau nanti elemennya dikembalikan. */
  $("#mirrorNote")?.replaceChildren(); }
/* Blok unduhan: tautan ke host pihak ketiga, bukan file di server kita.
   Skema URL diperiksa lagi di sini - nilainya datang dari sumber luar,
   dan atribut href adalah tempat paling berbahaya untuk data asing. */
/* Saat detail baru terbuka, tautan unduhan masih diambil. Tidak ada
   tautan yang ditampilkan sebelum data itu tiba. */
function renderDownloadPending() {
  return `<div class="dl-head" id="watchDownloadsTitle" role="status" aria-live="polite"><span class="dl-head-title"><svg class="ico"><use href="#i-download"/></svg> Memuat unduhan</span><span class="dl-head-meta">Server unduhan</span></div><div class="dl-note">Sedang memuat tautan, harap tunggu sebentar.</div>`;
}
/* Tidak ada batch dari Masu maupun Mega = tidak ada tautan. Pesannya jangan
   menyalahkan salah satu sumber; keduanya sudah dicoba. */
function renderDownloadEmpty(pesan = "Server unduhan belum menyediakan batch untuk judul ini. Coba lagi nanti.") {
  return `<div class="dl-head" id="watchDownloadsTitle"><span class="dl-head-title"><svg class="ico"><use href="#i-download"/></svg> Belum ada unduhan</span><span class="dl-head-meta">Server unduhan</span></div><div class="dl-note">${esc(pesan)}</div>`;
}
/* Renderer unduhan hanya butuh daftar URL yang ditandai mati; kunci
   penyimpanan tetap tinggal di modul tautan-mati supaya satu tempat. */
function urlMatiUnduhan() {
  const hasil = new Set();
  for (const kunci of tautanMati.semua()) {
    if (kunci.startsWith("unduh|")) hasil.add(kunci.slice("unduh|".length));
  }
  /* Laporan publik baru dipakai setelah ambang pelapor; lihat gabungLaporan. */
  for (const id of state.laporan?.unduhan || []) hasil.add(id);
  /* Pengguna ini sudah membuktikan tautannya hidup: jangan sembunyikan. */
  for (const kunci of tautanHidup.semua()) {
    if (kunci.startsWith("unduh|")) hasil.delete(kunci.slice("unduh|".length));
  }
  return hasil;
}
function urlMatiMirror(slug) {
  const awalan = `mirror|${String(slug || "")}|`;
  const hasil = new Set();
  for (const kunci of tautanMati.semua()) {
    if (kunci.startsWith(awalan)) hasil.add(kunci.slice(awalan.length));
  }
  for (const id of state.laporan?.mirror?.get?.(String(slug || "")) || []) hasil.add(id);
  for (const kunci of tautanHidup.semua()) {
    if (kunci.startsWith(awalan)) hasil.delete(kunci.slice(awalan.length));
  }
  return hasil;
}
function tandaiUnduhanMati(identitas) {
  if (!identitas || !tautanMati.tandai(kunciUnduhan(identitas), { sebab: "tidak bisa dibuka" })) return;
  tautanHidup.hapus(kunciLaporan("unduhan", "", identitas));
  laporkanMati("unduhan", identitas);
  renderUnduhan();
  toast("Tautan ditandai mati", "Tautan disembunyikan dari daftar. Pakai tombol tampilkan untuk melihatnya lagi.");
}
function hidupkanUnduhan(identitas) {
  if (!identitas) return;
  tautanMati.hapus(kunciUnduhan(identitas));
  tautanHidup.tandai(kunciLaporan("unduhan", "", identitas), { sebab: "terbukti hidup" });
  renderUnduhan();
  toast("Tanda mati dihapus", "Tautan muncul lagi di daftar.");
}
function renderDownloadBatches(batches, anime, opsi = {}) {
  const list = Array.isArray(batches) ? batches : [];
  const episodes = Array.isArray(anime?.episodes) ? anime.episodes : [];
  const mati = opsi?.mati instanceof Set ? opsi.mati : null;
  const tampilMati = Boolean(opsi?.tampilMati);
  let jumlahBatch = 0;
  let totalTautan = 0;
  let jumlahMati = 0;
  /* Nama sumber di UI sengaja bukan nama asli. Pengguna memilih sumber
     SETELAH resolusi: Masu (Animasu) atau Mega (Samehadaku). Keduanya bisa
     punya resolusi yang sama tetapi tautan, format, atau rentang yang
     berbeda - jadi jangan dicampur menjadi satu daftar buta. */
  const namaSumber = (source) => source === "samehadaku" ? "Mega" : source === "animasu" ? "Masu" : "Sumber";
  const urutSumber = (source) => source === "animasu" ? 0 : source === "samehadaku" ? 1 : 2;
  const asalBatch = (batch) => batch?.source === "samehadaku" ? "samehadaku" : batch?.source === "animasu" ? "animasu" : "lain";
  /* Rentang yang datang dari server sudah dinormalisasi ("1-12"). Angka
     tunggal tetap diterima supaya batch film tidak hilang. */
  const bacaRentang = (nilai) => {
    const m = String(nilai || "").trim().match(/^(\d{1,4})(?:\s*[-\u2013\u2014]\s*(\d{1,4}))?$/);
    if (!m) return null;
    const mulai = Number(m[1]);
    const akhir = m[2] ? Number(m[2]) : mulai;
    return mulai > 0 && akhir >= mulai ? [mulai, akhir] : null;
  };
  const rapiKualitas = (label) => {
    const teks = String(label || "").trim();
    if (/^\d{3,4}p$/i.test(teks)) return teks.toLowerCase();
    if (/^full\s*hd$/i.test(teks)) return "Full HD";
    if (/^mp4\s*hd$/i.test(teks)) return "MP4 HD";
    if (/^4k$/i.test(teks)) return "4K";
    return teks;
  };
  const nilaiKualitas = (label) => {
    const m = String(label || "").match(/(\d{3,4})\s*p/i);
    if (m) return Number(m[1]);
    if (/^4k$/i.test(label)) return 2160;
    if (/full\s*hd/i.test(label)) return 1080;
    if (/mp4\s*hd|^hd$/i.test(label)) return 720;
    return 9999;
  };
  const nomorEpisode = episodes.map((ep) => Number(ep?.number)).filter((n) => Number.isFinite(n) && n > 0);
  const rentangEpisode = nomorEpisode.length ? [Math.min(...nomorEpisode), Math.max(...nomorEpisode)] : null;
  /* Rentang yang tidak ditulis source hanya ditebak kalau sumber itu cuma
     punya SATU batch. Kalau ada beberapa batch tanpa rentang, tidak ada cara
     tahu batch mana mencakup episode mana - biarkan kosong daripada salah. */
  const jumlahBatchSumber = new Map();
  for (const batch of list) {
    const source = asalBatch(batch);
    jumlahBatchSumber.set(source, (jumlahBatchSumber.get(source) || 0) + 1);
  }
  const item = list.map((batch) => {
    const source = asalBatch(batch);
    const asli = bacaRentang(batch?.range);
    const range = asli || (rentangEpisode && jumlahBatchSumber.get(source) === 1 ? rentangEpisode : null);
    return { batch, source, range, tebakan: !asli && Boolean(range) };
  }).filter((entry) => Array.isArray(entry.batch?.mirrors)
    && entry.batch.mirrors.some((mirror) => Array.isArray(mirror?.links) && mirror.links.length));
  /* Rentang yang bersambung atau tumpang tindih digabung. Animasu sering
     memecah 1-24 menjadi 1-12 + 13-24, sementara Mega menulis 1-24; tanpa
     penggabungan pengguna melihat dua kartu untuk hal yang sama. */
  const berRentang = item.filter((entry) => entry.range)
    .sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  const grup = [];
  for (const entry of berRentang) {
    const terakhir = grup[grup.length - 1];
    if (terakhir && entry.range[0] <= terakhir.akhir + 1) {
      terakhir.akhir = Math.max(terakhir.akhir, entry.range[1]);
      terakhir.entries.push(entry);
    } else {
      grup.push({ mulai: entry.range[0], akhir: entry.range[1], entries: [entry] });
    }
  }
  /* Batch tanpa rentang yang tidak bisa ditebak mendapat kartu sendiri. */
  for (const entry of item.filter((entry) => !entry.range)) {
    grup.push({ mulai: null, akhir: null, entries: [entry] });
  }
  const blok = grup.map((bagian, gi) => {
    /* Tingkat 1: resolusi. Satu resolusi bisa datang dari dua sumber
       sekaligus, jadi yang disimpan adalah daftar entri per sumber. */
    const kualitas = new Map();
    for (const entry of bagian.entries) {
      for (const mirror of (Array.isArray(entry.batch?.mirrors) ? entry.batch.mirrors : [])) {
        const mentah = String(mirror?.quality || "").trim();
        const rentangBaris = String(mirror?.range || "").replace(/\s*-\s*/g, "-").trim();
        /* Kadang baris bukan resolusi, tapi rentang episode (anime Naruto
           menulisnya "01-25"). Yang tampil tetap yang kita tahu isinya:
           resolusi, atau rentang episode. */
        const label = rapiKualitas(mentah || (rentangBaris ? `Episode ${rentangBaris}` : ""));
        if (!label) continue;
        const kunci = label.toLowerCase().replace(/\s+/g, "");
        if (!kualitas.has(kunci)) kualitas.set(kunci, { label, entries: [] });
        kualitas.get(kunci).entries.push({ entry, mirror });
      }
    }
    const daftarKualitas = [...kualitas.values()]
      .sort((a, b) => nilaiKualitas(a.label) - nilaiKualitas(b.label) || a.label.localeCompare(b.label));
    const siap = [];
    for (const kualitasSatu of daftarKualitas) {
      const perSumber = new Map();
      for (const { entry, mirror } of kualitasSatu.entries) {
        /* Tautan divalidasi lebih dulu: baris tanpa satu pun tautan yang
           boleh dibuka tidak boleh muncul sebagai pilihan. */
        const tautan = [];
        let disembunyikan = 0;
        for (const link of (Array.isArray(mirror?.links) ? mirror.links : [])) {
          const href = String(link?.url || "").trim();
          if (!/^https?:\/\//i.test(href)) continue;
          const nama = String(link?.label || link?.host || "Mirror").trim();
          /* Hanya Google Drive yang mendapat path resolver dari server.
             Buka di tab yang sama: respons Drive membawa
             Content-Disposition: attachment, jadi browser mengunduh tanpa
             berpindah halaman. Pixeldrain menolak hotlink lintas situs
             (403 hotlink_detected), jadi ia dan host lain tetap link-out
             ke tab baru. */
          /* Semua tautan memakai halaman perantara /unduh/<token> supaya URL
             sumber tidak tertulis di href. Resolver Drive lama tetap
             didukung untuk data cache yang belum punya field page. */
          const halaman = String(link?.page || "").trim();
          const resolver = String(link?.download || "").trim();
          /* Identitas penanda = hash stabil dari URL asli. Halaman
             perantara /unduh/<token> tidak boleh dipakai: token membawa
             masa berlaku sehingga path-nya berganti setiap render dan
             tanda mati tidak pernah cocok lagi. URL host sendiri tetap
             tidak tertulis di markup - alasannya sama dengan hilangnya
             href upstream. */
          const identitas = sidikTautan(href);
          /* Tautan yang sudah ditandai mati tidak dirender sampai pengguna
             memilih "tampilkan". Tidak ada probe host di sini: penandanya
             berasal dari klik pengguna sebelumnya. */
          const ditandai = Boolean(mati?.has(identitas));
          /* Dihitung walau sedang ditampilkan: tombol "sembunyikan" butuh
             angka yang sama dengan saat tautannya disembunyikan. */
          if (ditandai) disembunyikan += 1;
          if (ditandai && !tampilMati) continue;
          let jangkar;
          if (/^\/unduh\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(halaman)) {
            /* href tetap ada supaya klik tengah / Ctrl+klik bisa membuka
               halaman cadangan di tab baru. Klik biasa dicegat handler
               dokumen dan dibuka sebagai pop-up di aplikasi. */
            jangkar = `<a class="dl-link" href="${esc(halaman)}" data-dl-page="${esc(halaman)}" rel="nofollow" referrerpolicy="no-referrer">${esc(nama)}</a>`;
          } else if (/^\/api\/download\?url=[^"<>]+$/i.test(resolver)) {
            jangkar = `<a class="dl-link" href="${esc(resolver)}" rel="nofollow" referrerpolicy="no-referrer">${esc(nama)}</a>`;
          } else {
            jangkar = `<a class="dl-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(nama)}</a>`;
          }
          const tombol = ditandai
            ? `<button type="button" class="dl-mark is-on" data-dl-hidup="${esc(identitas)}" title="Tampilkan lagi tautan ini" aria-label="Batalkan tanda mati ${esc(nama)}"><svg class="ico"><use href="#i-refresh"/></svg></button>`
            : `<button type="button" class="dl-mark" data-dl-mati="${esc(identitas)}" title="Tandai tautan ini mati" aria-label="Tandai ${esc(nama)} mati"><svg class="ico"><use href="#i-close"/></svg></button>`;
          tautan.push(`<span class="dl-link-row${ditandai ? " is-mati" : ""}">${jangkar}${tombol}</span>`);
        }
        /* Hitung yang disembunyikan SEBELUM membuang baris kosong: kalau
           semua tautan satu baris ditandai mati, baris itu tidak punya
           tautan lagi, tetapi jumlahnya tetap harus muncul di kepala blok. */
        jumlahMati += disembunyikan;
        if (!tautan.length) continue;
        if (!perSumber.has(entry.source)) perSumber.set(entry.source, []);
        perSumber.get(entry.source).push({ entry, tautan });
      }
      const sumber = [...perSumber.entries()]
        .map(([source, isi]) => ({ source, isi }))
        .sort((a, b) => urutSumber(a.source) - urutSumber(b.source));
      if (sumber.length) siap.push({ label: kualitasSatu.label, sumber });
    }
    if (!siap.length) return "";
    jumlahBatch += 1;
    const idDasar = `dl-${gi}`;
    /* Tingkat 1: daftar resolusi. Keterangan kecil menyebut sumber yang
       tersedia, supaya pengguna tahu ada dua jalur sebelum memilih. */
    const opsi = siap.map((satu, qi) => {
      const jumlah = satu.sumber.reduce((n, s) => n + s.isi.reduce((m, isi) => m + isi.tautan.length, 0), 0);
      const nama = satu.sumber.map((s) => namaSumber(s.source)).join(" · ");
      return `<button type="button" data-dl-option="${esc(satu.label)}" data-dl-target="${idDasar}-r${qi}"><span>${esc(satu.label)}</span><small>${esc(nama)} · ${jumlah} tautan</small></button>`;
    }).join("");
    /* Tingkat 2 dan 3: setelah resolusi dipilih, dua tombol sumber muncul.
       Tombol itu membuka daftar tautannya sendiri; tidak ada tautan yang
       dirender terbuka sebelum pengguna memilih. */
    const panel = siap.map((satu, qi) => {
      const idResolusi = `${idDasar}-r${qi}`;
      const tombolSumber = [];
      const panelSumber = [];
      satu.sumber.forEach((s, si) => {
        const idSumber = `${idResolusi}-s${si}`;
        const jumlah = s.isi.reduce((n, isi) => n + isi.tautan.length, 0);
        tombolSumber.push(`<button type="button" class="dl-sumber-btn" data-dl-source="${esc(s.source)}" data-dl-source-target="${idSumber}" aria-expanded="false" aria-controls="${idSumber}"><span>${esc(namaSumber(s.source))}</span><small>${jumlah} tautan</small></button>`);
        const isiSumber = s.isi.map(({ entry, tautan }) => {
          const catatan = [];
          const format = String(entry.batch?.format || "").trim();
          if (format && format.length <= 24) catatan.push(format);
          /* Rentang batch ditulis hanya kalau ia tidak sama dengan rentang
             kartu - mis. Masu cuma punya 1-12 di kartu 1-24. */
          if (entry.range && bagian.mulai !== null
            && (entry.range[0] !== bagian.mulai || entry.range[1] !== bagian.akhir)) {
            catatan.push(entry.range[0] === entry.range[1] ? `Episode ${entry.range[0]}` : `Episode ${entry.range[0]}-${entry.range[1]}`);
          }
          return `<div class="dl-sumber-grup">${catatan.length ? `<span class="dl-sumber-note">${esc(catatan.join(" · "))}</span>` : ""}<span class="dl-links">${tautan.join("")}</span></div>`;
        }).join("");
        panelSumber.push(`<div class="dl-sumber-links" id="${idSumber}" data-dl-source-links hidden>${isiSumber}</div>`);
      });
      return `<div class="dl-sub" id="${idResolusi}" data-dl-sub hidden><span class="dl-sub-label">Pilih sumber</span><div class="dl-sumber">${tombolSumber.join("")}</div>${panelSumber.join("")}</div>`;
    }).join("");
    totalTautan += siap.reduce((n, satu) => n + satu.sumber.reduce((m, s) => m + s.isi.reduce((k, isi) => k + isi.tautan.length, 0), 0), 0);
    /* Rentang kartu. Kalau source tak menulis rentang sama sekali, tetapi
       seluruh batch sumber itu kosong, rentangnya diambil dari daftar
       episode yang tampil - dan itu dinyatakan lewat tooltip. */
    const judulRentang = bagian.mulai === null
      ? ""
      : bagian.mulai === bagian.akhir ? `Episode ${bagian.mulai}` : `Episode ${bagian.mulai}-${bagian.akhir}`;
    const catatanRentang = bagian.mulai === null
      ? "Sumber tidak menulis rentang episode untuk batch ini."
      : bagian.entries.some((entry) => !entry.tebakan)
        ? "Rentang episode diambil dari judul batch di source."
        : `Rentang dihitung dari ${episodes.length} episode yang tampil, bukan dari judul batch.`;
    const pemicu = siap.every((satu) => /\d{3,4}\s*p\b/i.test(satu.label) || /^(4k|full hd|mp4 hd)$/i.test(satu.label))
      ? "Pilih resolusi" : "Pilih episode";
    return `<article class="dl-batch"><h4><span class="dl-range" title="${esc(catatanRentang)}">${esc(judulRentang || "Download")}</span></h4><div class="dl-picker" data-dl-picker><button class="dl-trigger" type="button" data-dl-toggle aria-expanded="false" aria-haspopup="true"><svg class="ico"><use href="#i-chev-down"/></svg><span data-dl-label>${esc(pemicu)}</span></button><div class="dl-options" data-dl-options hidden>${opsi}</div></div><div class="dl-subs">${panel}</div></article>`;
  }).filter(Boolean).join("");
  /* Satu tombol global, bukan satu tombol per baris: baris yang SELURUH
     tautannya ditandai mati tidak dirender sama sekali, jadi tombolnya
     harus tetap ada di kepala blok. */
  const tombolTampil = jumlahMati
    ? `<button type="button" class="dl-tampil-mati" data-dl-tampil-mati="global">${tampilMati ? `Sembunyikan ${jumlahMati} tautan mati` : `Tampilkan ${jumlahMati} tautan mati`}</button>`
    : "";
  if (!blok) {
    /* Semua tautan sudah ditandai mati: tetap tampilkan jalan kembali,
       jangan jadikan blok unduhan menghilang tanpa penjelasan. */
    if (!jumlahMati) return "";
    return `<div class="dl-head" id="watchDownloadsTitle"><span class="dl-head-title"><svg class="ico"><use href="#i-download"/></svg> Download Batch</span><span class="dl-head-meta">${jumlahMati} tautan mati</span></div><div class="dl-note">Semua tautan untuk judul ini ditandai mati. Kalau sumber sudah memperbaikinya, tampilkan lagi lalu coba buka.${tombolTampil}</div>`;
  }
  return `<div class="dl-head" id="watchDownloadsTitle"><span class="dl-head-title"><svg class="ico"><use href="#i-download"/></svg> Download Batch</span><span class="dl-head-meta">${jumlahBatch} batch · ${totalTautan} tautan${jumlahMati ? ` · ${jumlahMati} mati` : ""}</span></div><div class="dl-note">Pilih resolusi, lalu pilih sumber <strong>Masu</strong> atau <strong>Mega</strong>. Semua tautan melewati halaman unduhan SoraNema. Berkas tetap di-host pihak ketiga, bukan di server kami. Google Drive bisa diunduh langsung dari halaman itu; Pixeldrain, Mega, dan MediaFire membuka halaman host. <a href="/bantuan/pixeldrain/" target="_blank" rel="noopener">Kenapa Pixeldrain menolak unduhan langsung?</a> Kalau Drive menampilkan kuota, <a href="/bantuan/kuota-drive/" target="_blank" rel="noopener">lihat panduan memilih mirror</a>. Tautan bisa kedaluwarsa.${tombolTampil}</div>${blok}`;
}
/* Satu pintu render blok unduhan: selama data unduhan dimuat tampilkan
   status, setelah itu batch dari kedua sumber atau pesan "belum ada unduhan". */
function renderUnduhan(a = state.detail) {
  const box = $("#watchDownloads");
  if (!box) return;
  if (a?.downloadPending) box.innerHTML = renderDownloadPending();
  else if (Array.isArray(a?.batches) && a.batches.length) box.innerHTML = renderDownloadBatches(a.batches, a, { mati: urlMatiUnduhan(), tampilMati: state.tampilMati });
  else box.innerHTML = renderDownloadEmpty(a?.downloadEmptyNote || undefined);
}
/* ---------- Pop-up unduhan ----------
   Klik tautan /unduh/<token> di aplikasi membuka pop-up, bukan halaman baru.
   Datanya diambil dari server lewat ?format=json: host, tombol direct, dan
   masa berlaku tetap satu sumber dengan halaman cadangan. href asli tidak
   dihapus, jadi Ctrl+klik / klik tengah tetap bisa membuka halaman itu. */
let popupUnduhanAsal = null;
function tutupPopupUnduhan(overlay = $("#dlPopupRoot")?.querySelector(".overlay")) {
  if (!overlay) return;
  overlay.classList.add("is-closing");
  overlay.querySelector(".dl-pop")?.classList.add("is-closing");
  const asal = popupUnduhanAsal;
  popupUnduhanAsal = null;
  setTimeout(() => {
    overlay.remove();
    if (asal && asal.isConnected) asal.focus({ preventScroll: true });
  }, 200);
}
function isiPopupUnduhan(overlay, halaman, payload) {
  const d = payload.data;
  const baris = [
    d.quality ? `<div class="dl-pop-row"><dt>Kualitas</dt><dd>${esc(d.quality)}</dd></div>` : "",
    d.episode ? `<div class="dl-pop-row"><dt>Episode</dt><dd>${esc(d.episode)}</dd></div>` : "",
    d.mirror ? `<div class="dl-pop-row"><dt>Mirror</dt><dd>${esc(d.mirror)}</dd></div>` : "",
  ].join("");
  const aksi = d.direct
    ? `<a class="dl-pop-btn dl-pop-btn-primary" href="${esc(halaman)}?direct=1" rel="nofollow">Unduh dari ${esc(d.host)}</a><a class="dl-pop-btn dl-pop-btn-alt" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer nofollow">Buka halaman ${esc(d.host)}</a>`
    : `<a class="dl-pop-btn dl-pop-btn-primary" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer nofollow">Buka ${esc(d.host)}</a>`;
  const bantuan = d.help ? `<a href="${esc(d.help.url)}" target="_blank" rel="noopener">${esc(d.help.label)}</a>` : "";
  overlay.innerHTML = `<div class="dl-pop" role="dialog" aria-modal="true" aria-labelledby="dlPopTitle" tabindex="-1"><button type="button" class="dl-pop-x" data-dl-pop-close aria-label="Tutup unduhan"><svg class="ico"><use href="#i-close"/></svg></button><p class="dl-pop-eyebrow">Link unduhan</p><h2 class="dl-pop-title" id="dlPopTitle">${esc(d.host)}</h2><p class="dl-pop-sub">Berkas tidak disimpan di server SoraNema. Tautan ini berlaku sampai ${esc(d.expiresLabel)}.</p><div class="dl-pop-rows">${baris}</div><div class="dl-pop-actions">${aksi}</div><p class="dl-pop-note">${esc(d.note)}${bantuan ? ` ${bantuan}` : ""}</p><div class="dl-pop-foot"><button type="button" class="dl-pop-back" data-dl-pop-close>Kembali</button></div></div>`;
}
function pesanPopupUnduhan(overlay, halaman, pesan) {
  overlay.innerHTML = `<div class="dl-pop" role="alertdialog" aria-modal="true" aria-labelledby="dlPopTitle" tabindex="-1"><button type="button" class="dl-pop-x" data-dl-pop-close aria-label="Tutup unduhan"><svg class="ico"><use href="#i-close"/></svg></button><p class="dl-pop-eyebrow">Link unduhan</p><h2 class="dl-pop-title" id="dlPopTitle">Tautan tidak tersedia</h2><p class="dl-pop-note">${esc(pesan)}</p><div class="dl-pop-actions"><a class="dl-pop-btn dl-pop-btn-primary" href="${esc(halaman)}" rel="nofollow">Buka halaman unduhan</a></div><div class="dl-pop-foot"><button type="button" class="dl-pop-back" data-dl-pop-close>Kembali</button></div></div>`;
}
function bukaPopupUnduhan(halaman, pemicu) {
  const root = $("#dlPopupRoot");
  if (!root || !/^\/unduh\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(halaman)) return false;
  root.querySelectorAll(".overlay").forEach((lama) => lama.remove());
  const overlay = document.createElement("div");
  overlay.className = "overlay dl-pop-overlay";
  overlay.innerHTML = `<div class="dl-pop" role="dialog" aria-modal="true" aria-labelledby="dlPopTitle" tabindex="-1"><button type="button" class="dl-pop-x" data-dl-pop-close aria-label="Tutup unduhan"><svg class="ico"><use href="#i-close"/></svg></button><p class="dl-pop-eyebrow">Link unduhan</p><h2 class="dl-pop-title" id="dlPopTitle">Menyiapkan tautan…</h2><p class="dl-pop-sub">Sebentar, tautan unduhan sedang disiapkan.</p><div class="dl-pop-loading" role="status"><span class="dl-pop-spinner" aria-hidden="true"></span>Memuat…</div></div>`;
  root.appendChild(overlay);
  popupUnduhanAsal = pemicu || null;
  overlay.querySelector(".dl-pop")?.focus({ preventScroll: true });
  overlay.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-dl-pop-close]") || event.target === overlay) tutupPopupUnduhan(overlay);
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      tutupPopupUnduhan(overlay);
      return;
    }
    if (event.key !== "Tab") return;
    const fokus = [...overlay.querySelectorAll('a[href],button:not([disabled])')].filter((el) => el.offsetParent !== null);
    if (!fokus.length) return;
    const pertama = fokus[0];
    const terakhir = fokus[fokus.length - 1];
    if (event.shiftKey && document.activeElement === pertama) { event.preventDefault(); terakhir.focus(); }
    else if (!event.shiftKey && document.activeElement === terakhir) { event.preventDefault(); pertama.focus(); }
  });
  fetch(`${halaman}?format=json`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!overlay.isConnected) return;
      if (!response.ok || !payload?.data) {
        pesanPopupUnduhan(overlay, halaman, payload?.error || "Tautan unduhan tidak bisa dibuka sekarang.");
        return;
      }
      isiPopupUnduhan(overlay, halaman, payload);
    })
    .catch(() => {
      if (overlay.isConnected) pesanPopupUnduhan(overlay, halaman, "Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.");
    })
    .finally(() => {
      if (!overlay.isConnected) return;
      (overlay.querySelector(".dl-pop-btn-primary") || overlay.querySelector(".dl-pop-x"))?.focus({ preventScroll: true });
    });
  return true;
}
/* Escape saat pop-up terbuka hanya menutup pop-up. Ditangkap di fase
   capture supaya handler Escape lain (mis. penutup modal tontonan di
   belakangnya) tidak ikut jalan, walau fokus sedang tidak di dalam pop-up. */
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const overlay = $("#dlPopupRoot")?.querySelector(".overlay");
  if (!overlay) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  tutupPopupUnduhan(overlay);
}, true);
/* ---------- Dropdown unduhan (tiga tingkat) ----------
   Tingkat 1: pilih resolusi. Tingkat 2: pilih sumber (Masu/Mega).
   Tingkat 3: daftar tautan sumber itu. Dipasang di document SEKALI, bukan
   per render, jadi handler-nya tetap hidup walau blok unduhan dirender ulang. */
function tutupDropdownUnduhan() {
  document.querySelectorAll("[data-dl-options]").forEach((opsi) => { opsi.hidden = true; });
  document.querySelectorAll("[data-dl-picker]").forEach((picker) => picker.classList.remove("open"));
  document.querySelectorAll("[data-dl-toggle]").forEach((tombol) => tombol.setAttribute("aria-expanded", "false"));
}
document.addEventListener("click", (event) => {
  const tandai = event.target.closest?.("[data-dl-mati]");
  if (tandai) {
    event.preventDefault();
    event.stopPropagation();
    tandaiUnduhanMati(tandai.getAttribute("data-dl-mati"));
    return;
  }
  const hidupkan = event.target.closest?.("[data-dl-hidup]");
  if (hidupkan) {
    event.preventDefault();
    event.stopPropagation();
    hidupkanUnduhan(hidupkan.getAttribute("data-dl-hidup"));
    return;
  }
  const tampil = event.target.closest?.("[data-dl-tampil-mati]");
  if (tampil) {
    event.preventDefault();
    event.stopPropagation();
    state.tampilMati = !state.tampilMati;
    renderUnduhan();
    return;
  }
  /* Pop-up hanya untuk klik kiri biasa. Ctrl/Shift/klik tengah tetap
     membuka halaman /unduh/<token> di tab baru sebagai jalan cadangan. */
  const tautanHalaman = event.target.closest?.("a.dl-link[data-dl-page]");
  if (tautanHalaman && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    bukaPopupUnduhan(tautanHalaman.getAttribute("data-dl-page"), tautanHalaman);
    return;
  }
  const toggle = event.target.closest?.("[data-dl-toggle]");
  if (toggle) {
    const picker = toggle.closest("[data-dl-picker]");
    const opsi = picker?.querySelector("[data-dl-options]");
    const kebuka = Boolean(opsi && !opsi.hidden);
    tutupDropdownUnduhan();
    if (!kebuka && opsi) { opsi.hidden = false; picker.classList.add("open"); toggle.setAttribute("aria-expanded", "true"); }
    return;
  }
  const pilihan = event.target.closest?.("[data-dl-option]");
  if (pilihan) {
    const batch = pilihan.closest(".dl-batch");
    batch?.querySelectorAll("[data-dl-sub]").forEach((sub) => { sub.hidden = true; });
    /* Ganti resolusi = sumber harus dipilih ulang. Panel tautan lama tidak
       boleh tetap terbuka dan membuat orang mengira itu tautan resolusi baru. */
    batch?.querySelectorAll("[data-dl-source-links]").forEach((panel) => { panel.hidden = true; });
    batch?.querySelectorAll("[data-dl-source]").forEach((tombol) => { tombol.classList.remove("is-active"); tombol.setAttribute("aria-expanded", "false"); });
    const target = pilihan.getAttribute("data-dl-target");
    const sub = target && batch ? batch.querySelector(`#${CSS.escape(target)}`) : null;
    if (sub) sub.hidden = false;
    const labelPemilih = pilihan.closest("[data-dl-picker]")?.querySelector("[data-dl-label]");
    const teks = pilihan.querySelector("span")?.textContent?.trim();
    if (labelPemilih && teks) labelPemilih.textContent = teks;
    tutupDropdownUnduhan();
    return;
  }
  const sumber = event.target.closest?.("[data-dl-source]");
  if (sumber) {
    event.preventDefault();
    const sub = sumber.closest("[data-dl-sub]");
    const sudah = sumber.classList.contains("is-active");
    sub?.querySelectorAll("[data-dl-source-links]").forEach((panel) => { panel.hidden = true; });
    sub?.querySelectorAll("[data-dl-source]").forEach((tombol) => { tombol.classList.remove("is-active"); tombol.setAttribute("aria-expanded", "false"); });
    const target = sumber.getAttribute("data-dl-source-target");
    const panel = target && sub ? sub.querySelector(`#${CSS.escape(target)}`) : null;
    if (panel && !sudah) {
      panel.hidden = false;
      sumber.classList.add("is-active");
      sumber.setAttribute("aria-expanded", "true");
    }
    return;
  }
  /* Klik di luar menutup dropdown. */
  if (!event.target.closest?.("[data-dl-picker]")) tutupDropdownUnduhan();
});
/* ---------- Label episode ----------
   Yang ditampilkan bukan nomor telanjang, tapi judul dari source
   ("Episode 1", "Episode 2", ...). Untuk anime yang punya nama episode
   sungguhan, itu yang muncul. Kalau source tidak memberi judul,
   dirakit dari nomornya - supaya tidak pernah buta angka. */
function labelEpisode(ep) {
  const judul = String(ep?.title || ep?.episode || "").trim();
  if (judul) return judul;
  const nomor = String(ep?.number ?? "").trim();
  return nomor ? `Episode ${nomor}` : "Episode";
}
function labelEpisodeBerikutnya(anime, index) {
  /* Kalau anime masih tayang DAN pengguna sudah di episode terakhir,
     tombol "Next" tidak lagi berarti apa-apa. Dia berubah jadi
     "silahkan tunggu update selanjutnya" dan tetap mati. */
  const total = (anime?.episodes || []).length;
  const diAkhir = index >= total - 1;
  if (diAkhir && anime?.ongoing) return "Silahkan tunggu update selanjutnya";
  return "Next \u2192";
}
function gulirKeUnduhan() {
  const blok = $("#watchDownloads");
  if (!blok) return;
  /* Gulir container yang BENAR: .watch-left di desktop, .watch-grid di HP.
     Fungsi gulir bawaan tidak dipakai karena ia memilih leluhur sendiri dan
     pernah menggulir sidebar, bukan modal. */
  const kandidat = [blok.closest(".watch-grid"), blok.closest(".watch-left")].filter(Boolean);
  const scroller = kandidat.find((el) => el.scrollHeight > el.clientHeight + 1) || kandidat[0];
  if (scroller) scroller.scrollTop += blok.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
  blok.querySelector("[data-dl-toggle]")?.focus({ preventScroll: true });
}
/* Tombol Download di header baru bisa dipasang setelah server unduhan
   menjawab (sebelumnya mungkin belum ada batch sama sekali). Jangan render
   ulang seluruh header: itu memasang ulang handler dan mengganggu fokus. */
function pasangTombolUnduhan() {
  if (!state.detail?.batches?.length) return;
  if ($("#watchActions [data-detail-download]")) return;
  const reset = $("#watchActions [data-detail-reset]");
  if (!reset) return;
  const tombol = document.createElement("button");
  tombol.className = "btn";
  tombol.dataset.detailDownload = "1";
  tombol.title = "Lihat link download batch";
  tombol.innerHTML = `<svg class="ico"><use href="#i-download"/></svg><span class="rb-label">Download</span>`;
  tombol.onclick = gulirKeUnduhan;
  reset.before(tombol);
}
function renderDetail() { const a = state.detail; const item = getStored(a.slug); $("#watchTitle").textContent = a.title; $("#watchSub").textContent = `${a.type || "Series"} · ${a.status || "Unknown"}`; const epMulai = cwNextFor(item || {}) || (a.episodes || [])[0]; $("#playerBox").innerHTML = (a.episodes || []).length ? `<div class="player-ph"><button class="play-cta" type="button" data-player-start aria-label="Mulai episode ${esc(String(epMulai?.number ?? 1))}"><svg class="ico"><use href="#i-play"/></svg><span>Mulai EP ${String(epMulai?.number ?? 1).padStart(2, "0")}</span></button><div class="msg">${item?.watchedEpisodes?.length ? "Lanjut ke episode berikutnya, atau pilih di daftar." : "Satu klik untuk mulai — atau pilih episode di daftar."}</div></div>` : `<div class="player-ph"><div class="msg">Episode belum tersedia.</div></div>`; const tombolMulai = $("[data-player-start]"); if (tombolMulai && epMulai?.slug) tombolMulai.onclick = () => playEpisode(epMulai.slug, Number(epMulai.number), null); $("#watchDetailGrid").innerHTML = `<div class="detail-item"><div class="k">Episodes</div><div class="v">${a.episodes?.length || a.total || "?"}</div></div><div class="detail-item"><div class="k">Rating</div><div class="v">${a.rating || "—"}</div></div><div class="detail-item"><div class="k">Studio</div><div class="v">${esc(a.studio || "—")}</div></div>`; $("#watchSynopsis").textContent = a.synopsis || "Sinopsis belum tersedia dari source."; $("#watchGenres").innerHTML = (a.genres || []).map((g) => `<span class="chip">${esc(g.name || g)}</span>`).join(""); renderUnduhan(a); const favOn = Boolean(item?.favorite), disOn = Boolean(item?.dislike);
$("#watchActions").innerHTML = `<button class="btn react-btn${favOn ? " is-fav" : ""}" data-detail-fav aria-pressed="${favOn}" title="Favorite"><svg class="ico"><use href="#i-star"/></svg><span class="rb-label">${favOn ? "Favorit" : "Favorite"}</span></button><button class="btn react-btn${disOn ? " is-dislike" : ""}" data-detail-dislike aria-pressed="${disOn}" title="Dislike"><svg class="ico"><use href="#i-thumb-down"/></svg><span class="rb-label">Dislike</span></button><button class="btn btn-primary" data-detail-add>${item ? "Saved locally" : "+Storage"}</button>${(a.batches || []).length ? `<button class="btn" data-detail-download title="Lihat link download batch"><svg class="ico"><use href="#i-download"/></svg><span class="rb-label">Download</span></button>` : ""}<button class="btn reset-btn" data-detail-reset ${item && (item.watchedEpisodes?.length || item.progress) ? "" : "disabled"} title="Ulangi dari Episode 1"><svg class="ico"><use href="#i-refresh"/></svg><span class="rb-label">Reset</span></button><button class="btn" data-detail-prev ${state.episodeIndex <= 0 ? "disabled" : ""}>← Previous</button><button class="btn" data-detail-next ${state.episodeIndex >= (a.episodes?.length || 1) - 1 ? "disabled" : ""}>${labelEpisodeBerikutnya(a, state.episodeIndex)}</button>`; $("#episodeList").innerHTML = (a.episodes || []).map((ep, index) => `<button class="ep-item ${item?.watchedEpisodes?.includes(Number(ep.number)) ? "watched" : ""}" data-episode-slug="${esc(ep.slug)}" data-episode-number="${esc(ep.number)}" title="${esc(labelEpisode(ep))}"><span class="st">${item?.watchedEpisodes?.includes(Number(ep.number)) ? "✓" : ""}</span><span class="ep-name">${esc(labelEpisode(ep))}</span></button>`).join("") || empty("Episode belum tersedia.", "Source belum mengembalikan episode."); if (a.ongoing && (a.episodes || []).length) $("#episodeList").insertAdjacentHTML("beforeend", '<p class="ep-wait">Tunggu eps selanjutnya</p>'); $("[data-detail-add]").onclick = (event) => addStorage(a.slug, event.currentTarget); $("[data-detail-reset]").onclick = () => { const item = getStored(a.slug); if (!item) return; openConfirm("Reset progress?", `Semua centang episode ${item.title} akan dihapus dan mulai lagi dari Episode 1.`, () => resetProgress(a.slug), { silent: true, confirmLabel: "Reset", confirmClass: "btn btn-primary" }); }; $("[data-detail-fav]").onclick = () => setAnimeReaction(a.slug, "favorite"); $("[data-detail-dislike]").onclick = () => setAnimeReaction(a.slug, "dislike"); const tombolDownload = $("[data-detail-download]"); if (tombolDownload) tombolDownload.onclick = gulirKeUnduhan; $("[data-detail-prev]").onclick = () => navigateEpisode(-1); $("[data-detail-next]").onclick = () => navigateEpisode(1); $$('[data-episode-slug]').forEach((b) => b.onclick = () => playEpisode(b.dataset.episodeSlug, Number(b.dataset.episodeNumber), b)); }
function navigateEpisode(delta) { const episodes = state.detail?.episodes || []; const target = episodes[state.episodeIndex + delta]; if (!target) return; playEpisode(target.slug, Number(target.number), null); updateEpisodeNav(); }
function updateEpisodeNav() { $("[data-detail-prev]")?.toggleAttribute("disabled", state.episodeIndex <= 0); $("[data-detail-next]")?.toggleAttribute("disabled", state.episodeIndex >= (state.detail?.episodes?.length || 1) - 1); /* Sinkronkan tombol overlay video */ const prev = $("#prevEpBtn"), next = $("#nextEpBtn"); prev?.toggleAttribute("disabled", state.episodeIndex <= 0); next?.toggleAttribute("disabled", state.episodeIndex >= (state.detail?.episodes?.length || 1) - 1); const tunggu = Boolean(state.detail?.ongoing) && state.episodeIndex >= (state.detail?.episodes?.length || 1) - 1; next?.setAttribute("title", tunggu ? "Silahkan tunggu update selanjutnya" : "Episode berikutnya"); /* Label tombol Next ikut diperbarui saat episode berpindah - bukan hanya saat render, karena render tidak selalu jalan. */ const tombolBerikutnya = $("[data-detail-next]"); if (tombolBerikutnya) tombolBerikutnya.textContent = labelEpisodeBerikutnya(state.detail, state.episodeIndex); }

/* ---------- In-video control overlay ----------
   Klik di area video memunculkan kontrol (mirror, prev/next, PiP);
   toolbar tetap tersedia, sementara area iframe tetap menerima klik video. */
const videoOverlay = $("#videoOverlay");
const playerStage = $("#playerStage");
let voHideTimer = 0;
function showVideoControls() {
  if (!videoOverlay || videoOverlay.closest("#watchOverlay")?.hidden) return;
  if (!state.mirrors.length) return;
  videoOverlay.hidden = false;
  videoOverlay.classList.add("show");
}
function hideVideoControls() { /* Jangan hilangkan bar selama panel mirror masih
   terbuka - orang sedang memilih mirror, bukan sedang menyingkirkan
   kontrol. Kalau masih terbuka, coba lagi beberapa detik lagi. */
  if (!$("#mirrorOptions")?.hidden) { voHideTimer = setTimeout(hideVideoControls, 3000); return; }
  videoOverlay?.classList.remove("show"); clearTimeout(voHideTimer); }
/* Dengarkan klik dari stage, bukan dari lapisan di atas iframe. Dengan begitu
   klik pertama tetap diterima kontrol play milik mirror di dalam iframe. */
playerStage?.addEventListener("click", (event) => {
  if (event.target.closest("#videoOverlay")) return;
  showVideoControls();
});
playerStage?.addEventListener("pointerenter", showVideoControls);
playerStage?.addEventListener("pointermove", showVideoControls);
videoOverlay?.addEventListener("click", (event) => {
  /* Klik pada area kosong overlay (di luar bar) menyembunyikan kontrol */
  if (event.target === videoOverlay) { hideVideoControls(); return; }
  if (!event.target.closest(".vo-bar")) return;
  clearTimeout(voHideTimer);
  voHideTimer = window.setTimeout(hideVideoControls, 3000);
});
$("#prevEpBtn")?.addEventListener("click", () => { if (state.episodeIndex > 0) navigateEpisode(-1); });
$("#nextEpBtn")?.addEventListener("click", () => { const total = state.detail?.episodes?.length || 0; if (state.episodeIndex < total - 1) navigateEpisode(1); });

/* ---------- Draggable mini popup player (Picture-in-Picture-like) ----------
   Untuk iframe cross-origin, gunakan floating PiP di dokumen yang sama.
   Memindahkan iframe ke Document PiP lintas window dapat membuat browser
   me-reparent/reload browsing context dan menimbulkan jeda atau reset waktu.
   Floating PiP memindahkan node iframe yang sama tanpa mengganti src. */
let pipPort = null;
let pipDragCleanup = null;
const SEAMLESS_IFRAME_PIP = true;
function clampPipPosition(el, left, top) {
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - rect.width);
  const maxTop = Math.max(0, window.innerHeight - rect.height);
  return { left: Math.max(0, Math.min(Number(left) || 0, maxLeft)), top: Math.max(0, Math.min(Number(top) || 0, maxTop)) };
}
function setPipPosition(el, left, top) {
  const position = clampPipPosition(el, left, top);
  el.style.left = `${position.left}px`;
  el.style.top = `${position.top}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
  return position;
}
function setupPipDrag(el) {
  const handle = el.querySelector("[data-pip-drag-handle]");
  if (!handle) return;
  const initial = el.getBoundingClientRect();
  setPipPosition(el, initial.left, initial.top);
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("iln:pip-position") || "null"); } catch { return null; } })();
  if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) setPipPosition(el, saved.left, saved.top);
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest("button")) return;
    const rect = el.getBoundingClientRect();
    dragging = true;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    el.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    const position = setPipPosition(el, event.clientX - offsetX, event.clientY - offsetY);
    try { sessionStorage.setItem("iln:pip-position", JSON.stringify(position)); } catch { }
  };
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("is-dragging");
    if (event?.pointerId !== undefined) handle.releasePointerCapture?.(event.pointerId);
    const rect = el.getBoundingClientRect();
    try { sessionStorage.setItem("iln:pip-position", JSON.stringify({ left: rect.left, top: rect.top })); } catch { }
  };
  const onKeyDown = (event) => {
    if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    const rect = el.getBoundingClientRect();
    const step = event.shiftKey ? 80 : 24;
    const next = event.key === "Home" ? { left: window.innerWidth - rect.width - 20, top: window.innerHeight - rect.height - 20 } : {
      left: rect.left + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      top: rect.top + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
    };
    setPipPosition(el, next.left, next.top);
    const position = el.getBoundingClientRect();
    try { sessionStorage.setItem("iln:pip-position", JSON.stringify({ left: position.left, top: position.top })); } catch { }
    event.preventDefault();
  };
  const onViewportChange = () => { const rect = el.getBoundingClientRect(); setPipPosition(el, rect.left, rect.top); };
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  pipDragCleanup = () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    handle.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("orientationchange", onViewportChange);
  };
}
async function openPipWindow() {
  const mirror = state.mirrors[state.mirrorIndex];
  if (!mirror || !state.detail) { toast("Belum ada video", "Pilih episode dulu sebelum membuka popup."); return; }
  const iframe = $("#playerBox iframe");
  if (!iframe) { toast("Belum ada video", "Player belum memuat stream."); return; }
  if (document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch { } }
  if (!SEAMLESS_IFRAME_PIP && "documentPictureInPicture" in window && window.documentPictureInPicture.requestWindow) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 480, height: 300 });
      const doc = win.document;
      doc.body.style.cssText = "margin:0;background:#000;font-family:system-ui;overflow:hidden";
      const style = doc.createElement("style");
      style.textContent = `.pipbar{position:fixed;top:0;left:0;right:0;height:40px;display:flex;align-items:center;gap:6px;padding:4px 6px;background:linear-gradient(rgba(0,0,0,.7),transparent);z-index:9;transition:opacity .2s;opacity:0}.pipbar:hover{opacity:1}.pipbar button{width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;display:grid;place-items:center;cursor:pointer;font-size:13px}.pipbar button:hover{border-color:#FFD700;color:#FFD700}.pipbar .t{flex:1;font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pipwrap{position:fixed;inset:40px 0 0 0}.pipwrap iframe{width:100%;height:100%;border:0}`;
      doc.head.appendChild(style);
      const bar = doc.createElement("div"); bar.className = "pipbar";
      bar.innerHTML = `<span class="t">${esc(state.detail.title)} — EP ${state.episodeIndex + 1}</span><button data-p="prev" title="Episode sebelumnya">‹</button><button data-p="next" title="Episode berikutnya">›</button><button data-p="close" title="Tutup popup">✕</button>`;
      const wrapEl = doc.createElement("div"); wrapEl.className = "pipwrap";
      wrapEl.appendChild(iframe); /* pindahkan iframe: video tetap jalan */
      doc.body.append(bar, wrapEl);
      bar.addEventListener("click", async (event) => {
        const act = event.target.closest("button")?.dataset.p;
        if (act === "close") {
          $("#playerBox").appendChild(iframe); /* kembalikan iframe */
          win.close();
        } else if (act === "prev" || act === "next") {
          const delta = act === "prev" ? -1 : 1;
          const episodes = state.detail?.episodes || [];
          const target = episodes[state.episodeIndex + delta];
          if (target) {
            state.episodeIndex += delta;
            startWatchClock(target.number);
            try { const response = await api.mirrors(target.slug); state.mirrors = response.data || []; state.mirrorIndex = 0; const m = state.mirrors[0]; if (m) { iframe.src = m.url; bar.querySelector(".t").textContent = `${state.detail.title} — EP ${state.episodeIndex + 1}`; $("#mirrorLabel").textContent = m.name || "Mirror 1"; } } catch { }
          }
        }
      });
      win.addEventListener("pagehide", () => { if (iframe.isConnected && !$("#playerBox").contains(iframe)) $("#playerBox").appendChild(iframe); });
      return;
    } catch { /* fall through ke fallback */ }
  }
  /* Fallback: window mengambang di dalam halaman */
  closePipWindow();
  const el = document.createElement("div");
  el.className = "pip-window always-bar";
  el.innerHTML = `<div class="pip-head" data-pip-drag-handle tabindex="0" role="group" aria-label="Pindahkan popup player"><span class="pip-title">${esc(state.detail.title)} — EP ${state.episodeIndex + 1}</span><button class="pip-btn" data-pip-prev title="Episode sebelumnya" aria-label="Episode sebelumnya"><svg class="ico"><use href="#i-prev"/></svg></button><button class="pip-btn" data-pip-next title="Episode berikutnya" aria-label="Episode berikutnya"><svg class="ico"><use href="#i-next"/></svg></button><button class="pip-btn" data-pip-close title="Tutup popup" aria-label="Tutup popup"><svg class="ico"><use href="#i-close"/></svg></button></div><div class="pip-body"></div>`;
  $(".pip-body", el).appendChild(iframe);
  document.body.appendChild(el);
  pipPort = el;
  setupPipDrag(el);
  el.addEventListener("click", (event) => {
    const act = event.target.closest("[data-pip-prev],[data-pip-next],[data-pip-close]")?.dataset;
    if (!act) return;
    if (act.pipClose !== undefined) closePipWindow();
    else if (act.pipPrev !== undefined) { const target = state.detail?.episodes?.[state.episodeIndex - 1]; if (target) { playEpisodeInPip(target); } }
    else if (act.pipNext !== undefined) { const target = state.detail?.episodes?.[state.episodeIndex + 1]; if (target) { playEpisodeInPip(target); } }
  });
}
async function playEpisodeInPip(target) {
  state.episodeIndex = state.detail.episodes.findIndex((e) => e.slug === target.slug);
  startWatchClock(target.number);
  updateEpisodeNav(); renderDetail();
  try { const response = await api.mirrors(target.slug); state.mirrors = response.data || []; state.mirrorIndex = 0; const m = state.mirrors[0]; const iframe = pipPort?.querySelector("iframe"); if (m && iframe) { iframe.src = m.url; $("#mirrorLabel").textContent = m.name || "Mirror 1"; const t = pipPort?.querySelector(".pip-title"); if (t) t.textContent = `${state.detail.title} — EP ${state.episodeIndex + 1}`; } } catch { }
}
function closePipWindow() { if (!pipPort) return; const iframe = pipPort.querySelector("iframe"); if (iframe) $("#playerBox").appendChild(iframe); pipDragCleanup?.(); pipDragCleanup = null; pipPort.classList.add("is-closing"); const el = pipPort; setTimeout(() => el.remove(), 220); pipPort = null; }
$("#pipBtn")?.addEventListener("click", () => openPipWindow());
/* Ambil tautan unduhan setelah detail tampil. Kalau endpoint menjawab
   `pending` (batch salah satu sumber belum selesai), coba sekali lagi
   setelah 2,5 detik. Batch yang sudah ada tetap ditampilkan selama
   menunggu - jangan sembunyikan tautan yang sudah bisa dipakai. */
async function muatUnduhan(slug, percobaan = 0) {
  const detail = state.detail;
  if (!detail || detail.slug !== slug) return;
  detail.downloadPending = percobaan === 0;
  detail.downloadEmptyNote = percobaan > 0 ? "Sedang memuat tautan, harap tunggu sebentar." : "";
  renderUnduhan(detail);
  muatLaporanPublik();
  let hasil = null;
  try { hasil = await api.downloads(slug); } catch { hasil = null; }
  if (state.detail !== detail) return;
  const batches = Array.isArray(hasil?.data) ? hasil.data : [];
  detail.batches = batches;
  detail.downloadSource = hasil?.provider || "";
  detail.downloadPending = false;
  if (!batches.length) {
    detail.downloadEmptyNote = hasil?.pending
      ? "Sedang memuat tautan, harap tunggu sebentar."
      : hasil
        ? "Server unduhan belum menyediakan batch untuk judul ini. Coba lagi nanti."
        : "Tautan unduhan gagal dimuat. Tutup lalu buka lagi detail ini untuk mencoba ulang.";
  }
  renderUnduhan(detail);
  pasangTombolUnduhan();
  if (hasil?.pending && percobaan < 1) {
    setTimeout(() => { if (state.detail === detail) muatUnduhan(slug, percobaan + 1); }, 2500);
  }
}
async function openDetail(id, options = {}) { const source = normAnime(findAnime(id) || { slug: id, id }); $("#watchOverlay").hidden = false; document.body.style.overflow = "hidden"; $("#watchTitle").textContent = source.title; $("#watchSub").textContent = ""; $("#playerBox").innerHTML = `<div class="player-loading"><div class="spinner"></div></div>`; try { const response = await api.detail(source.slug); state.detail = normAnime({ ...response.data, id: response.data.slug || source.slug }); state.detail.episodes = response.data.episodes || []; state.detail.downloadPending = true; state.episodeIndex = -1; renderDetail(); /* preferUnwatched: dipakai rail "Lanjutkan Menonton" supaya membuka
       episode BERIKUTNYA, bukan episode 1. Modal-nya tetap sama persis
       dengan tombol "See Detail" supaya pengguna tidak bingung. */
       const start = options.preferUnwatched ? (cwNextFor(getStored(state.detail.slug) || {}) || state.detail.episodes[0]) : state.detail.episodes[0]; if (start?.slug) playEpisode(start.slug, Number(start.number), null); muatUnduhan(state.detail.slug); } catch (error) { $("#watchSub").textContent = error.message; } }
function closeWatch() { const overlay = $("#watchOverlay"); const modal = $("#watchModal"); stopWatchClock(); closePipWindow(); hideVideoControls(); overlay.classList.add("is-closing"); modal.classList.add("is-closing"); setTimeout(() => { overlay.hidden = true; overlay.classList.remove("is-closing"); modal.classList.remove("is-closing"); document.body.style.overflow = ""; state.detail = null; bindActions(); }, 200); }
function bindActions() { /* hold pada Remove dipasang di sini (jalan tiap render); klik singkat ditangani delegasi di setup() */ $$('[data-act="remove"]').forEach((b) => { if (b.dataset.holdBound === "1") return; b.dataset.holdBound = "1"; holdable(b, 1200, () => { b.dataset.holdDone = String(Date.now()); removeStorage(b.dataset.id); }); }); }
const GENRE_OPTIONS = "Aksi|Anak-Anak|Antariksa|Avant Garde|Dimensia|Donghua|Drama|Ecchi|Fantasi|Fantasi Urban|Game|Gourmet|Harem|Horror|Iblis|Isekai|Josei|Ketegangan|Komedi|Live Action|Makanan|Martial Arts|Medis|Militer|Misteri|Mitologi|Mobil|Musik|Olahraga|Parodi|Perang|Petualangan|Polisi|Politik|Psikologis|Reinkarnasi|Robot|Romansa|Samurai|Sci-Fi|Seinen|Sejarah|Sekolahan|Shoujo|Shoujo Ai|Shounen|Shounen Ai|Sihir|Slice of Life|Super Power|Supranatural|Thriller|Time Travel|Vampir".split("|").map((name) => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
function labelForGenre(slug) { return state.genres.find((g) => g.slug === slug)?.name || slug; }
function tagMatch(item, selected, key) { if (!selected.size) return true; const values = (item[key] || []).map((v) => String(typeof v === "string" ? v : v.name || v.slug || "").toLowerCase()); return [...selected].some((value) => values.includes(String(value).toLowerCase()) || values.some((v) => v.includes(String(value).toLowerCase()))); }
function updateFilterLabel(root, set, fallback) { $(".gf-label", root).textContent = set.size ? `${set.size} dipilih` : fallback; root.classList.toggle("has-active-root", set.size > 0); $(".gf-trigger", root).classList.toggle("has-active", set.size > 0); }
const FILTER_OPTIONS = { mainType: [["","Tipe"],["Serial TV","Serial TV"],["Live Action","Live Action"],["Movie","Movie"],["OVA","OVA"],["ONA","ONA"],["Spesial","Spesial"]], storageType: [["","Tipe"],["Serial TV","Serial TV"],["Live Action","Live Action"],["Movie","Movie"],["OVA","OVA"],["ONA","ONA"],["Spesial","Spesial"]], mainStatus: [["","Status"],["Segera Tayang","Segera Tayang"],["Sedang Tayang","Sedang Tayang"],["Selesai Tayang","Selesai Tayang"],["Rating","Rating"],["Terpopuler","Terpopuler"]], storageStatus: [["","Status"],["Segera Tayang","Segera Tayang"],["Sedang Tayang","Sedang Tayang"],["Selesai Tayang","Selesai Tayang"],["Rating","Rating"],["Terpopuler","Terpopuler"]] };
/* Tipe/Status: klik chip aktif = batal pilih, klik chip lain = ganti pilihan.
   Scope main TIDAK memicu render/pencarian otomatis (anti auto-search) —
   hanya memperbarui hint & chip di search main; pencarian lewat tombol cari
   atau Enter. Scope storage tetap memfilter daftar lokal secara langsung. */
/* ---------- Menu Download ---------- */
/* URL unduhan diisi terpisah, sengaja TIDAK ditebak di sini: installer .exe
   sekitar 96 MB dan .apk 1,5 MB tidak disimpan di repo ini.

   .apk juga sudah diisi (rilis 11 Oktober 2026).

   tombol yang disabled dengan alasannya ditulis.

   PENTING: URL .exe ini juga dipakai oleh auto-update EXE sebagai sumber
   metadata (latest.yml). Jadi kalau tautan ini diganti ke tempat lain,
   build berikutnya harus ikut mengarahkan publish-nya, atau pemeriksaan
   update akan mengarahkan pengguna ke rilis yang salah. */
const DOWNLOAD_LINKS = {
  exe: "https://github.com/NeoNishikawa/SoraNema-app/releases/download/exe/SoraNema_0.1.0_x64-setup.exe",
  /* Nama berkas sengaja tidak membawa nomor versi. Tag "apk" dan nama
     berkas tetap, jadi tautan tidak mati setiap rilis baru; yang berubah
     adalah nama berkas setelahnya. Itu yang dibutuhkan pemeriksaan
     versi nanti - satu tag tetap, berkas di belakangnya yang
     diperbarui.

     Kalau nanti .-url ini diganti ke tempat lain, build berikutnya harus
     ikut mengarahkan publish-nya, persis seperti catatan .exe di atas. */
  apk: "nothing",
};

/* EXE punya aplikasinya sendiri; APK memblokir navigasi ke luar lewat NavGuard
   dan mematikan multi-window. Di keduanya tombol unduh tidak berguna, jadi
   dibuang dari DOM (bukan disembunyikan) supaya tidak pernah bisa diklik. */
function diDesktop() { return Boolean(window.ilnDesktop && window.ilnDesktop.isElectron) || /Electron/i.test(navigator.userAgent || ""); }
function diWebViewAndroid() { const ua = navigator.userAgent || ""; return /;\s*wv\)/.test(ua) || (/Android/.test(ua) && /Version\/[\d.]+\s*Chrome/.test(ua)); }
/* Shell SoraNema yang sudah terpasang memuat "?shell=apk". Penanda ini
   dibaca server juga, supaya halaman maintenance tidak.snare shell yang
   tidak punya browser untuk ditutup. */
function shellTerpasang() { try { return new URLSearchParams(window.location.search).get("shell") === "apk"; } catch (_) { return false; } }

function pasangMenuDownload() {
  const wrap = $("#dlWrap");
  if (!wrap) return;
  if (diDesktop() || diWebViewAndroid()) { wrap.remove(); return; }
  /* Penjaga listener ganda. Dua listener document untuk hal yang sama
     tidak merusak apa pun, tapi boros dan menutup menu dua kali. Pola ini
     sama dengan penjaga holdBound di bindActions(). */
  if (wrap.dataset.dlBound === "1") return;
  wrap.dataset.dlBound = "1";

  const toggle = $("#dlToggle");
  const menu = $("#dlMenu");
  const items = $$(".dl-item");
  /* Posisi menu diukur RELATIF KE SIDEBAR, bukan ke layar. Alasannya
     .sidebar punya transform (translateX untuk drawer), jadi ia yang
     jadi containing block position:fixed di dalamnya. Kalau koordinatnya
     diukur terhadap viewport, panel akan meleset sebesar pergeseran
     drawer - persis seperti yang terjadi dengan .header + backdrop-filter
     di perintah /genre.

     Dipakai relatif ke sidebar juga menyelesaikan masalah aslinya: menu
     ini item terakhir dari .sb-nav yang overflow-y:auto, jadi ia ikut
     terpotong. Dengan position:fixed ia keluar dari flow nav itu, dan
     tetap ikut bergerak bersama drawer. */
  const posisiMenu = () => {
    const induk = wrap.closest(".sidebar") || document.body;
    /* .sidebar HANYA jadi containing block position:fixed kalau punya
       transform/filter/backdrop-filter/will-change/contain. Di mobile ia
       punya transform (translateX untuk drawer) - jadi koordinat relatif
       ke sidebar benar. Di desktop TIDAK punya transform, jadi
       position:fixed dihitung dari viewport - dan koordinat yang kita
       hitung dari sidebar meleset sebesar tinggi sidebar (65px), sehingga
       menu muncul 23px di ATAS tombolnya.

       Mengukur dari basis yang benar, bukan dari asumsi. */
    const g = getComputedStyle(induk);
    const jadiBasis = g.transform !== "none" || g.filter !== "none" || g.backdropFilter !== "none"
      || g.willChange !== "auto" || g.contain !== "none" || g.perspective !== "none";
    const basis = jadiBasis ? induk : document.documentElement;
    const rInduk = basis.getBoundingClientRect();
    const rTombol = toggle.getBoundingClientRect();
    /* Di layar sangat pendek, .sb-nav meluap dan tombol ini bisa berada
       di luar kotak nav -.clip, tapi di tempat yang persis sama dengan
       tombol "Delete Data" yang ada di luar nav.-diukur 320x568: tap mendarat
       ke Delete Data, yang holdable() jadi tidak melakukan apa-apa. Jadi
       nav digulirkan dulu supaya tombolnya benar-benar terlihat, baru
       rect-nya diukur ulang. */
    const nav = wrap.closest(".sb-nav");
    if (nav) {
      const rNav = nav.getBoundingClientRect();
      if (rTombol.bottom > rNav.bottom || rTombol.top < rNav.top) {
        nav.scrollTop += (rTombol.top - rNav.top) - 8;
      }
    }
    const rTombol2 = toggle.getBoundingClientRect();
    const w = Math.min(Math.max(rTombol2.width, 200), rInduk.width - 24);
    /* Menu SELALU dibuka di bawah tombol, jadi di layar pendek ia keluar
       dari bawah. Diukur lewat sweep 13 ukuran (Chrome headless, tap
       sentuh asli): menu selalu muncul di y=550 dengan tinggi 112, jadi
       batasnya 662px. Semua viewport yang lebih pendek dari itu -
       termasuk 412x600 - menunya jatuh di bawah layar dan user tidak
       melihat apa pun.

    /* Tiga tingkat, berurutan dari yang paling wajar:
       1. di bawah tombol - bentuk yang biasa dan paling diharapkan
       2. di atas tombol - kalau di bawah tidak muat
       3. dipatok ke tepi, dan menu-nya yg menggulir - kalau dua-duanya
          tidak muat, misal di drawer yang sangat pendek

       Versi pertama hanya tingkat 1, jadi di desktop menu Download terpotong
       tepat di bawah "Android .apk": .sidebar punya overflow:hidden dan
       Download adalah item terakhir di nav, jadi tidak ada ruang sama
       sekali di bawahnya. Menempelkan tinggi maksimum di CSS (lihat
       .dl-wrap.open .dl-menu) memastikan tingkat 3 tidak pernah
       terpotong diam-diam. */
    const tinggi = menu.getBoundingClientRect().height || 112;
    const jarak = 4;
    const ruangBawah = rInduk.height - (rTombol2.bottom - rInduk.top) - 8;
    const ruangAtas = rTombol2.top - rInduk.top - 8;
    let top;
    if (tinggi <= ruangBawah) top = rTombol2.bottom - rInduk.top + jarak;
    else if (tinggi <= ruangAtas) top = rTombol2.top - rInduk.top - tinggi - jarak;
    else top = Math.max(8, rInduk.height - tinggi - 8);
    menu.style.setProperty("--dl-menu-top", Math.round(top) + "px");
    menu.style.setProperty("--dl-menu-left", Math.round(rTombol2.left - rInduk.left) + "px");
    menu.style.setProperty("--dl-menu-w", Math.round(w) + "px");
  };
  const tutup = () => { wrap.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); menu.hidden = true; };
  const buka = () => { wrap.classList.add("open"); toggle.setAttribute("aria-expanded", "true"); menu.hidden = false; /* Menu ini dulu anak Biasa dari .sb-nav (overflow-y:auto) dan item
     terakhir di dalamnya, jadi ia ikut terpotong. Sekarang posisinya
     diukur: lihat posisiMenu di atas. */
    posisiMenu(); };

  toggle.onclick = (event) => { event.stopPropagation(); menu.hidden ? buka() : tutup(); };
  document.addEventListener("click", (event) => { if (!wrap.contains(event.target)) tutup(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) { tutup(); toggle.focus(); } });

  const kosong = items.every((item) => !DOWNLOAD_LINKS[item.dataset.dl]);
  if (kosong) {
    items.forEach((item) => { item.disabled = true; });
    $("#dlNote").hidden = false;
    return;
  }
  items.forEach((item) => {
    const url = DOWNLOAD_LINKS[item.dataset.dl];
    if (!url) { item.disabled = true; return; }
    item.onclick = () => {
      setDrawer(false);
      /* Installer belum ditandatangani CA, jadi Windows pasti menampilkan
         "Windows protected your PC". Menosokan pengguna ke file 96 MB tanpa
         penjelasan membuat mereka mengira aplikasinya rusak - dan browser
         yang menampilkan SmartScreen bukan situs kita, jadipenjelasannya
         harus muncul SEBELUM unduhan mulai.

         .apk lewat showPlayProtectNotice() dengan alasan yang sama seperti
         .exe lewat showSmartScreenNotice(): keduanya keluar dari luar store
         resmi, jadi sistem menampilkan peringatan sebelum pemasangan.
         Android punya Play Protect - cuma namanya berbeda dari SmartScreen. */
      if (item.dataset.dl === "exe") { showSmartScreenNotice(url); return; }
      if (item.dataset.dl === "apk") { showPlayProtectNotice(url); return; }
      window.open(url, "_blank", "noopener");
    };
  });
}

/* Konfirmasi sebelum unduh .apk. Pasangannya showSmartScreenNotice(),
   dan tujuannya sama: sistem akan menampilkan peringatan
   sebelum pemasangan, jadi penjelasan harus muncul SEBELUM unduhan
   mulai - bukan jadi kejutan setelah berkas terbuka.

   Kenapa tidak sekadar "boleh install saja": kalimat seperti itu
   menyuruh pengguna mematikan peringatan tanpa syarat. Kalau someday
   build-nya diretas, kalimat yang sama itu yang membuat orang menekan
   tombolnya tanpa berpikir. Jadi urutannya: normalkan dulu (peringatan
   itu diharapkan), beri cara MEMERIKSA sendiri, baru bolehkan. */
function showPlayProtectNotice(url) {
  const root = $("#confirmRoot");
  if (!root || !url) return;
  root.querySelectorAll(".overlay").forEach((lama) => lama.remove());
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="confirm-modal ss-modal" role="dialog" aria-modal="true" aria-labelledby="ppTtl">
    <div class="confirm-alert warn"><svg class="ico"><use href="#i-info"/></svg></div>
    <div class="ss-modal-body">
    <h3 id="ppTtl">Sebelum memasang di Android</h3>
    <p class="ss-lead">Saat dipasang, Android akan meminta izin memindai berkas ini dengan <strong>Google Play Protect</strong>. <strong>Izinkan pindainya</strong> - itu pemeriksaan yang memang diwajibkan Google sebelum aplikasi apa pun dipasang, dan izinlah yang diminta.</p>
    <p class="ss-why">Play Protect hanya bisa memverifikasi aplikasi yang berasal dari Google Play. Berkas .apk di luar store tidak punya verifikasi itu, jadi Android tetap memindainya lebih dulu. OnePlus, Oppo, dan Xiaomi menamai langkahnya sedikit berbeda, tapi intinya sama: Allow/Ya/Setuju saat ditanya memindai.</p>
    <p class="ss-steps-t">Urutan pasang di Android:</p>
    <ol class="ss-steps">
      <li>Unduh berkasnya.</li>
      <li>Buka dari notifikasi unduhan - Android akan menampilkan dialog pemindaian.</li>
      <li>Izinkan pindai (Allow / Scan anyway / Ya).</li>
      <li>Tunggu pemeriksaan selesai, lalu pemasangan diteruskan.</li>
    </ol>
    <p class="ss-why">Kalau kamu memilih untuk tidak mengizinkan pemindaian dari luar Play Store, jangan pasang lewat cara ini - aplikasi ini memang tidak ada di Google Play. Itu pilihan yang wajar, dan tidak ada yang perlu diotomatisasi di sini.</p>
    </div>
    <div class="confirm-actions">
      <button class="btn btn-primary" data-pp-go>Lanjut unduh</button>
      <button class="btn btn-ghost" data-pp-cancel>Batal</button>
    </div></div>`;
  root.appendChild(overlay);
  const close = () => { overlay.classList.add("is-closing"); $(".confirm-modal", overlay).classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); };
  $("[data-pp-cancel]", overlay).onclick = close;
  $("[data-pp-go]", overlay).onclick = () => { close(); setTimeout(() => window.open(url, "_blank", "noopener"), 230); };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  $("[data-pp-go]", overlay).focus();
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/* Konfirmasi sebelum unduh .exe. Ada dua tombol: "Batal" membatalkan,
   "Saya mengerti" baru membuka link GitHub. Menaruh link langsung di menu
   berarti link tanpa penjelasan; menaruhnya setelah konfirmasi
   berarti penundaan yang perlu dibaca dulu. */
function showSmartScreenNotice(url) {
  const root = $("#confirmRoot");
  if (!root || !url) return;
  /* Jangan menumpuk kalau klik berulang cepat. */
  root.querySelectorAll(".overlay").forEach((lama) => lama.remove());
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="confirm-modal ss-modal" role="dialog" aria-modal="true" aria-labelledby="ssTtl">
    <div class="confirm-alert warn"><svg class="ico"><use href="#i-info"/></svg></div>
    <div class="ss-modal-body">
    <h3 id="ssTtl">Sebelum mengunduh</h3>
    <p class="ss-lead">Saat installer dibuka, Windows mungkin menampilkan peringatan <strong>"Windows protected your PC"</strong> atau <strong>"Unknown Publisher"</strong>. Itu <strong>wajar</strong> untuk perangkat lunak independen yang baru - bukan tanda file rusak.</p>
    <p class="ss-why">SoraNema dibuat independen, jadi installer-nya belum punya sertifikat digital resmi. Windows tidak mengenali penerbitnya, makanya peringatan muncul.</p>
    <p class="ss-steps-t">Cara membukanya:</p>
    <ol class="ss-steps">
      <li>Klik <strong>"More info"</strong> di kiri bawah jendela.</li>
      <li>Klik <strong>"Run anyway"</strong>.</li>
    </ol>
    </div>
    <div class="confirm-actions">
      <button class="btn btn-primary" data-ss-go>Lanjut unduh</button>
      <button class="btn btn-ghost" data-ss-cancel>Batal</button>
    </div></div>`;
  root.appendChild(overlay);
  const close = () => { overlay.classList.add("is-closing"); $(".confirm-modal", overlay).classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); };
  $("[data-ss-cancel]", overlay).onclick = close;
  $("[data-ss-go]", overlay).onclick = () => { close(); setTimeout(() => window.open(url, "_blank", "noopener"), 230); };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  /* Fokus ke tombol utama: keyboard bisa menyelesaikan tanpa mouse, dan
     Escape membatalkan - dialog yang bisa dijebak mouse saja menyisakan
     pengguna yang masih terjebak. */
  $("[data-ss-go]", overlay).focus();
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function bindDropdown(root) {
  if (!root) return;
  const key = root.dataset.filter; const panel = $(".gf-panel", root); attach(root);
  const isStorage = Boolean(root.closest("[data-filter-scope=storage]"));
  const applyLabel = () => {
    const chosen = (FILTER_OPTIONS[key] || []).find(([value]) => value && value === state[key]);
    $(".gf-label", root).textContent = chosen ? chosen[1] : root.dataset.label || "—";
    root.classList.toggle("has-active-root", Boolean(state[key]));
    $(".gf-trigger", root).classList.toggle("has-active", Boolean(state[key]));
  };
  const setOptions = () => { $(".gf-grid", root).innerHTML = (FILTER_OPTIONS[key] || []).map(([value,label]) => `<button class="gf-chip ${state[key] === value ? "on" : ""}" data-value="${esc(value)}">${esc(label)}</button>`).join(""); };
  setOptions(); applyLabel();
  /* Delegasi event di panel — setOptions() membuat ulang chip setiap klik,
     handler per-chip akan mati setelah render pertama (akar bug "tidak bisa
     ganti/cancel pilihan"). Delegasi bertahan lintas render. */
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-value]");
    if (!button) return;
    state[key] = state[key] === button.dataset.value ? "" : button.dataset.value;
    applyLabel(); setOptions(); closeActive();
    isStorage ? refreshStorageFilters() : updateSearchUI();
  });
}

/* Batas pemilihan genre. Dua, bukan satu: satu genre sering terlalu luas
   (Action = hampir semua), tiga sudah jadi daftar yang lebih panjang dari
   yang perlu dibaca. Dipakai di scope pencarian utama, desktop dan mobile
   alike - filter yang berbeda di dua tampilan akan membingungkan.
   Scope storage TIDAK dibatasi: itu daftar lokal, bukan hasil pencarian. */
const GENRE_PICK_LIMIT = 2;
/* Chip yang tidak bisa dipilih karena batas tercapai harus diberi tahu,
   bukan diam. Tanpa pesan ini panelnya kelihatan seperti rusak. */
function genreLimitWarn(root) {
  let el = $(".gf-warn", root);
  if (!el) {
    el = document.createElement("p");
    el.className = "gf-warn";
    el.textContent = "Maksimal " + GENRE_PICK_LIMIT + " genre. Hapus satu dulu.";
    el.hidden = true;
    $(".gf-panel", root).appendChild(el);
  }
  return el;
}
function bindGenre(root) { if (!root) return; attach(root); const panel = $(".gf-panel", root); const storage = root.classList.contains("gf-storage"); const set = storage ? state.storageGenres : state.mainGenres; const genres = [...new Map([...GENRE_OPTIONS, ...state.genres].map((g) => [g.slug, g])).values()]; $(".gf-grid", root).innerHTML = genres.map((g) => `<button class="gf-chip ${set.has(g.slug) ? "on" : ""}" data-genre="${esc(g.slug)}" data-name="${esc(g.name)}">${esc(g.name)}</button>`).join(""); updateFilterLabel(root, set, "All Genre"); $$('[data-genre]', panel).forEach((b) => b.onclick = () => { if (set.has(b.dataset.genre)) { set.delete(b.dataset.genre); } else { if (set.size >= GENRE_PICK_LIMIT) { genreLimitWarn(root).hidden = false; return; } set.add(b.dataset.genre); } b.classList.toggle("on", set.has(b.dataset.genre)); genreLimitWarn(root).hidden = set.size < GENRE_PICK_LIMIT; updateFilterLabel(root, set, "All Genre"); storage ? refreshStorageFilters() : updateSearchUI(); }); $(`[data-gf-clear]`, root).onclick = () => { set.clear(); updateFilterLabel(root, set, "All Genre"); $$("[data-genre]", panel).forEach((b) => b.classList.remove("on")); genreLimitWarn(root).hidden = true; storage ? refreshStorageFilters() : updateSearchUI(); }; }
/* Pindah section: crossfade — section lama memudar, scroll, section tujuan
   muncul. Menghormati prefers-reduced-motion (langsung tanpa animasi). */
/* Pindah section: crossfade — section lama memudar, scroll, section tujuan
   muncul. Ada token supaya transisi yang sudah kalah tidak ikut membersihkan
   state milik transisi yang lebih baru, dan pembersihannya selalu mengembalikan
   SEMUA section (bukan cuma daftar saat ini) supaya tidak ada section yang
   tersangkut is-crossfading dan jadi tak terlihat selamanya. */
let sectionTransitionToken = 0;
function clearSectionFx() {
  $$(".canvas>section").forEach((section) => {
    section.style.opacity = "";
    section.style.transform = "";
    section.classList.remove("is-crossfading", "section-in");
  });
}
function scrollToSection(selector, button) { const target = $(selector); if (!target) return; $$(".nav-item[data-nav]").forEach((b) => b.classList.toggle("active", b === button)); const scroller = $("#mainScroll"); if (!scroller) return; const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.performanceTier === "low"; const jump = () => scroller.scrollTo({ top: target.offsetTop - 20, behavior: "smooth" }); const token = ++sectionTransitionToken; if (reduced) { clearSectionFx(); target.classList.add("section-in"); jump(); setTimeout(() => clearSectionFx(), 420); return; } /* Target dibersihkan DULU: kalau transisi sebelumnya sempat menandainya is-crossfading, ia harus dilepas sekarang, bukan nanti. */
  target.style.opacity = ""; target.style.transform = ""; target.classList.remove("is-crossfading", "section-in");
  const current = $$(".canvas>section").filter((s) => { const r = s.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; });
  current.forEach((s) => { if (s !== target) s.classList.add("is-crossfading"); });
  const fadeOut = { opacity: [1, 0], duration: 170, ease: "outQuad", onComplete: () => { if (token !== sectionTransitionToken) return; jump(); target.classList.add("section-in"); animate(target, { opacity: [0, 1], translateY: [10, 0], duration: 320, ease: "outQuad", composition: "replace", onComplete: () => { if (token !== sectionTransitionToken) return; clearSectionFx(); } }); } };
  animate(current.length ? current : target, { ...fadeOut, composition: "replace" });
  /* Pengaman: kalau animasi somehow tidak menyelesaikan onComplete-nya, section
     tetap dikembalikan supaya tidak ada konten yang hilang permanen. */
  setTimeout(() => { if (token === sectionTransitionToken) clearSectionFx(); }, 900); }
function openAbout() { const root = $("#confirmRoot"); const overlay = document.createElement("div"); overlay.className = "overlay"; overlay.innerHTML = 
  `<div class="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
  <h3 id="about-modal-title">Tentang SoraNema</h3>
  
  <div class="modal-content">
    <p><strong>SoraNema</strong> adalah platform streaming anime independen yang dapat diakses secara gratis dan bebas dari iklan.</p>
    
    <hr class="modal-divider" />

    <div class="about-section">
      <h4>📌 Penting Mengenai Data &amp; Progres</h4>
      <p>Koleksi dan progres menonton Anda disimpan secara lokal di browser (<em>Local Storage</em>). Karena domain berganti secara berkala, pastikan untuk menggunakan fitur <strong>Export</strong> untuk mencadangkan data, dan <strong>Import</strong> di domain baru agar progres tidak hilang.</p>
    </div>

    <div class="about-section">
      <h4>🌐 Server &amp; Pergantian Domain</h4>
      <p>Ketersediaan <em>source</em> dan <em>mirror</em> dapat berubah mengikuti kondisi jaringan. Kami memohon maaf jika alamat web harus berganti link setiap bulannya demi menekan biaya operasional hosting agar layanan tetap gratis.</p>
    </div>

  </div>

  <div class="confirm-actions">
    <button class="btn btn-primary" data-close-about>Tutup</button>
  </div>
</div>`; root.appendChild(overlay); $("[data-close-about]", overlay).onclick = () => overlay.remove(); overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); }; }
/* ==========================================================================
   Lanjutkan Menonton — rail episode berikutnya + stage ala Netflix.
   Anime.js dipakai di sini untuk slide kiri/kanan dan crossfade section.
   Data episodes hanya ada dari /api/anime/:slug, jadiRail dirender dari
   localStorage dulu (tanpa network), lalu dilengkapi bertahap.
   ========================================================================== */
const CW_MAX_CARDS = 8;
const CW_PREVIEW_DELAY = 420;
const CW_DETAIL_CONCURRENCY = 3;
const cw = { episodes: new Map(), pending: new Set(), stage: null };
let sectionFadeObserver = null;

/* Amber iterator sederhana: detail diambil bertahap supaya 25 item di
   Local Storage tidak menembak 25 request sekaligus ke upstream. */
function cwPool(tasks, limit = CW_DETAIL_CONCURRENCY) {
  const queue = [...tasks];
  if (!queue.length) return Promise.resolve();
  return new Promise((resolve) => {
    let active = 0;
    const next = () => {
      if (active >= limit) return;
      const task = queue.shift();
      /* Antrean kosong + tidak ada yang jalan = selesai. Kalau masih ada
         yang aktif, Jangan resolve dulu — pemanggil akan merender rail
         sebelum episode-nya siap. */
      if (!task) { if (!active) resolve(); return; }
      active += 1;
      Promise.resolve().then(task).catch(() => null).then(() => { active -= 1; next(); });
    };
    next();
  });
}

function cwNextFor(item) {
  const episodes = cw.episodes.get(item.slug);
  if (!episodes) return null;
  return nextUnwatched(item.watchedEpisodes || [], episodes);
}

function cwProgressPct(item, episodes = null) {
  const list = episodes || cw.episodes.get(item.slug) || [];
  const total = Number(item.total || item.totalEpisodes || list.length || 0);
  const watched = new Set((item.watchedEpisodes || []).map(Number)).size || Number(item.progress || 0);
  return total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0;
}

/* ---------- Render rail ---------- */
function renderContinue() {
  const rail = $("#continueRail"); if (!rail) return;
  clearCwPreviews();
  const candidates = continueCandidates(state.storageItems, CW_MAX_CARDS);
  const badge = $("#navContinueCount");
  if (badge) badge.textContent = String(candidates.length);
  const sub = $("#continueSub");

  if (!candidates.length) {
    /* role="listitem" ikut di keadaan kosong, bukan hanya di kartu yang sudah
       terisi. Tanpa ini, role="list" pada #continueRail punya anak yang bukan
       listitem, dan itu persis yang dit auditorium Lighthouse - pada tampilan
       yang paling sering dilihat pengguna baru. */
    rail.innerHTML = `<div class="cw-empty" role="listitem"><strong>Belum ada yang bisa dilanjutkan</strong><span>Mulai tonton satu episode dari anime mana pun, lalu episode berikutnya akan otomatis muncul di sini.</span></div>`;
    if (sub) sub.textContent = "Belum ada tontonan berjalan";
    rail.parentElement?.querySelectorAll(".cw-nav").forEach((b) => b.toggleAttribute("disabled", true));
    return;
  }

  rail.innerHTML = candidates.map((item) => {
    const ep = cwNextFor(item);
    const pct = cwProgressPct(item);
    const ready = Boolean(ep);
    return `<article class="cw-card${ready ? "" : " is-loading"}" role="listitem" tabindex="0" data-cw-slug="${esc(item.slug)}">
      ${ready ? "" : `<div class="cw-skel"></div>`}
      <div class="cw-art">${item.image ? `<img src="${esc(posterSrc(item.image))}" alt="${esc(item.title)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed')">` : `<span class="cw-art-fallback">ANIME IMAGE</span>`}</div>
      <button class="cw-play" type="button" data-cw-play="${esc(item.slug)}" ${ready ? "" : "disabled"}><svg class="ico"><use href="#i-play"/></svg><span>Lanjutkan</span></button>
      <div class="cw-body">
        <span class="cw-eyebrow">EP ${ready ? String(ep.number).padStart(2, "0") : "—"}</span>
        <h3 class="cw-title">${esc(item.title)}</h3>
        <p class="cw-ep">${ready ? esc(episodeLabel(ep, item.title)) : "Memuat episode berikutnya…"}</p>
        <div class="cw-bar"><i style="width:${pct}%"></i></div>
      </div>
    </article>`;
  }).join("");

  if (sub) sub.textContent = `${candidates.length} anime menunggu episode berikutnya`;
  bindCwCards();
  syncCwNav();
  loadCwDetails(candidates);
}

/* Detail belum pernah diambil: ambil sekarang, lalu render ulang hanya rail. */
async function loadCwDetails(candidates) {
  const todo = candidates.filter((i) => !cw.episodes.has(i.slug) && !cw.pending.has(i.slug));
  todo.forEach((i) => cw.pending.add(i.slug));
  if (todo.length) await cwPool(todo.map((item) => async () => {
    try { const res = await api.detail(item.slug); cw.episodes.set(item.slug, res?.data?.episodes || []); }
    catch (_) { cw.episodes.set(item.slug, []); }
    finally { cw.pending.delete(item.slug); }
  }));
  const rail = $("#continueRail"); if (!rail) return;
  /* Anime yang ternyata sudah tamat (tidak ada episode tersisa) dibuang. */
  const valid = candidates.filter((item) => cwNextFor(item));
  if (!valid.length) { renderContinue(); return; }
  rail.innerHTML = valid.map((item) => cwCardHTML(item)).join("");
  const subLabel = $("#continueSub");
  if (subLabel) subLabel.textContent = `${valid.length} anime menunggu episode berikutnya`;
  const countBadge = $("#navContinueCount");
  if (countBadge) countBadge.textContent = String(valid.length);
  bindCwCards(); syncCwNav();
}

function cwCardHTML(item) {
  const ep = cwNextFor(item);
  const pct = cwProgressPct(item);
  const left = remainingCount(item, cw.episodes.get(item.slug)?.length || 0);
  return `<article class="cw-card${ep ? "" : " is-loading"}" role="listitem" tabindex="0" data-cw-slug="${esc(item.slug)}">
    ${ep ? "" : `<div class="cw-skel"></div>`}
    <div class="cw-art">${item.image ? `<img src="${esc(posterSrc(item.image))}" alt="${esc(item.title)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed')">` : `<span class="cw-art-fallback">ANIME IMAGE</span>`}</div>
    <button class="cw-play" type="button" data-cw-play="${esc(item.slug)}" ${ep ? "" : "disabled"}><svg class="ico"><use href="#i-play"/></svg><span>Lanjutkan</span></button>
    <div class="cw-body">
      <span class="cw-eyebrow">EP ${ep ? String(ep.number).padStart(2, "0") : "—"}</span>
      <h3 class="cw-title">${esc(item.title)}</h3>
      <p class="cw-ep">${ep ? `${esc(episodeLabel(ep, item.title))}${left > 1 ? ` · ${left} episode tersisa` : ""}` : "Memuat episode berikutnya…"}</p>
      <div class="cw-bar"><i style="width:${pct}%"></i></div>
    </div>
  </article>`;
}

/* ---------- Interaksi kartu ---------- */
function bindCwCards() {
  const rail = $("#continueRail"); if (!rail) return;
  $$(".cw-card", rail).forEach((card) => {
    const slug = card.dataset.cwSlug;
    card.onmouseenter = () => schedulePreview(card, slug);
    card.onmouseleave = () => clearCwPreviews(card);
    card.onfocus = () => schedulePreview(card, slug);
    card.onblur = () => clearCwPreviews(card);
    const play = $("[data-cw-play]", card);
    /* Membuka modal yang SAMA dengan tombol "See Detail" (bukan player
       terpisah), hanya boleh dimulai dari episode berikutnya. */
    const open = (event) => { event?.stopPropagation(); openDetail(slug, { preferUnwatched: true }); };
    if (play) play.onclick = open;
    card.onclick = open;
    card.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
  });
}

/* Pratinjau Netflix: hanya satu iframe aktif pada satu waktu. Status
   pratinjau disimpan PADA KARTU ITU SENDIRI (bukan satu variabel global),
   jadi rail yang kebetulan re-render tidak membuat iframe yatim atau
   menumpuk: setiap kartu selalu tahu pratinjaunya sendiri. */
function schedulePreview(card, slug) {
  if (!card) return;
  clearTimeout(Number(card.dataset.cwTimer || 0));
  card.dataset.cwTimer = String(setTimeout(() => startPreview(card, slug), CW_PREVIEW_DELAY));
}
async function startPreview(card, slug) {
  if (!card || card.dataset.cwBusy === "1") return;
  /* Cuma satu pratinjau pada satu waktu: SEMUA kartu yang sedang aktif
     dibersihkan lebih dulu, bukan hanya kartu ini. Kalau kursor pindah
     cepat atau mouseleave sempat terlewat, dua iframe tidak akan menumpuk. */
  clearCwPreviews();
  const episode = cwNextFor(getStored(slug) || {});
  if (!episode?.slug) return;
  card.dataset.cwBusy = "1";
  try {
    const res = await api.mirrors(episode.slug);
    const mirror = res?.data?.[0];
    /* Sambil menunggu mirror, kursor bisa sudah pergi, kartu sudah
       dilepas karena re-render, atau kartu lain sudah mengambil alih. */
    if (!mirror?.url || !document.body.contains(card) || card.dataset.cwBusy !== "1") return;
    const frame = buatIframeMirror(mirror.url, "Pratinjau episode", { className: "cw-preview", loading: "lazy", allow: "autoplay", allowFullscreen: false });
    if (!frame) return;
    frame.muted = true;
    frame.setAttribute("muted", "");
    card.classList.add("is-previewing");
    card.insertBefore(frame, $(".cw-body", card));
    /* Iframe dibongkar setelah 12 detik: halaman mirror sering menampilkan
       halaman interstitial yang menutupi video setelah beberapa detik. */
    setTimeout(() => { if (card.contains(frame)) frame.remove(); }, 12000);
  } catch (_) { /* pratinjau gagal = diamkan saja, kartu tetap bisa dibuka manual */ }
  finally { card.dataset.cwBusy = "0"; }
}
/* Bersihkan satu kartu, atau seluruh kartu bila argumen dikosongkan. */
function clearCwPreviews(onlyCard = null) {
  const cards = onlyCard ? [onlyCard] : $$(".cw-card");
  for (const card of cards) {
    clearTimeout(Number(card.dataset.cwTimer || 0));
    card.dataset.cwTimer = "0";
    card.dataset.cwBusy = "0";
    card.classList.remove("is-previewing");
    $$(".cw-preview", card).forEach((frame) => frame.remove());
  }
}

/* Panah geser rail */
function syncCwNav() {
  const rail = $("#continueRail"); if (!rail) return;
  const max = rail.scrollWidth - rail.clientWidth;
  const prev = $("[data-cw-prev]"), next = $("[data-cw-next]");
  if (prev) prev.toggleAttribute("disabled", rail.scrollLeft <= 4);
  if (next) next.toggleAttribute("disabled", rail.scrollLeft >= max - 4);
}
function cwScrollRail(dir) {
  const rail = $("#continueRail"); if (!rail) return;
  const card = $(".cw-card", rail);
  const step = card ? card.getBoundingClientRect().width + 14 : rail.clientWidth * 0.8;
  rail.scrollBy({ left: dir * step * 2, behavior: "smooth" });
  setTimeout(syncCwNav, 320);
}

/* ---------- Crossfade ikut scroll ---------- */
/* Section yang sedang terlihat penuh; yang lain memudar redup. Pakai
   IntersectionObserver supaya tidak ada handler scroll yang berat. */
function setupSectionCrossfade() {
  sectionFadeObserver?.disconnect();
  sectionFadeObserver = null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.performanceTier === "low";
  if (reduced || !("IntersectionObserver" in window)) { $$(".canvas>section").forEach((s) => s.classList.remove("is-scroll-dim")); return; }
  sectionFadeObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("is-scroll-dim", !entry.isIntersecting);
  }, { root: $("#mainScroll"), rootMargin: "-12% 0px -12% 0px", threshold: 0.01 });
  $$(".canvas>section").forEach((section) => sectionFadeObserver.observe(section));
}

function bindSelect(id, key, render) { const el = $(id); if (!el) return; el.value = state[key] || ""; el.onchange = () => { state[key] = el.value; render(); }; }
function setup() {
  document.addEventListener("click", (event) => { const play = event.target.closest?.('[data-act="play"]'); const detail = event.target.closest?.('[data-act="detail"]'); const add = event.target.closest?.('[data-act="add"]'); const check = event.target.closest?.('[data-act="check"]'); const remove = event.target.closest?.('[data-act="remove"]'); /* Kartu bisa diklik langsung untuk buka detail, jadi tidak wajib pakai tombol mata.
   Guard pertama: APAPUN elemen yang punya data-act TIDAK boleh memicu buka
   detail. Tombol morph punya listener klik document-nya sendiri (baris lain),
   jadi tanpa guard ini satu klik goo akan membuka menu DAN modal detail. */
   const aksi = event.target.closest?.('[data-act]'); const card = (aksi || event.target.closest?.('a,input,select,textarea,label')) ? null : event.target.closest?.('.anime-card[data-card-open]'); if (play) { event.preventDefault(); event.stopPropagation(); openDetail(play.dataset.id, { preferUnwatched: true }); } else if (detail) { event.preventDefault(); event.stopPropagation(); openDetail(detail.dataset.id); } else if (add) { event.preventDefault(); event.stopPropagation(); addStorage(add.dataset.id, add); } else if (check) { event.preventDefault(); event.stopPropagation(); const id = check.dataset.id; state.selectedStorageItems.has(id) ? state.selectedStorageItems.delete(id) : state.selectedStorageItems.add(id); renderStorage(); } else if (remove) { /* Hold selesai memicu removeStorage sendiri (holdDone).
     Klik singkat TIDAK menghapus dan TIDAK memunculkan popup — hanya
     memberi petunjuk cara memakainya. Konsisten dengan menu morph, dan
     popup konfirmasi kini khusus Delete All Data di sidebar. */
     const btn = remove; const heldAt = Number(btn.dataset.holdDone || 0); if (Date.now() - heldAt < 600) return; event.preventDefault(); event.stopPropagation(); const item = state.storageItems.find((i) => i.slug === btn.dataset.id); toast("Tahan tombol Remove", `${item?.title || "Anime ini"} — tahan 1,2 detik untuk menghapus, lepas lebih awal untuk batal.`, 2600); } else if (card) { event.preventDefault(); openDetail(card.dataset.id); } });
  document.documentElement.dataset.theme = prefs.theme;
  $$('[data-theme-toggle]').forEach((btn) => btn.classList.toggle("is-light", prefs.theme === "light"));
  /* Kontrol manual mode performa (dropdown Animasi) dihapus dari UI;
     auto-tier performance-mode.js tetap berjalan di belakang layar. */
  document.addEventListener("iln:performance-change", () => setupScrollReveal());
  installDevLongTaskMonitor();
  $$('[data-theme-toggle]').forEach((btn) => { btn.classList.toggle("is-light", prefs.theme === "light"); btn.onclick = () => { prefs.theme = prefs.theme === "light" ? "dark" : "light"; saveState(); /* View Transitions: crossfade warna halaman (fallback ringan bila tak didukung) */ applyTheme(prefs.theme, { animate: true }); }; });
  /* Grid cuma perlu digambar ulang kalau UKURAN HALAMAN berubah. Di desktop
     sidebar tertutup = 7 kolom = 21 kartu; di tablet dan mobile pageSize
     tetap 9, jadi di sana tidak boleh ada render sama sekali — stutter
     ~1 detik itu persis dari renderAll() yang jalan di tengah animasi.
     Kalau memang berubah, render SETELAH animasi sidebar selesai supaya
     perpindahan 6 -> 7 kolom tidak men-drop frame. */
  $("#sbToggle").onclick = () => { const appEl = $("#app"); /* Matikan biaya paint mahal (backdrop-filter & transisi kartu)
     selama animasi collapse/expand agar frame tidak drop */ appEl.classList.add("animating"); /* Ukuran halaman dibaca SEBELUM dan SESUDAH class ditoggle — bukan snapshot saat load, supaya tetap benar walau viewport berubah. */ const sizeSebelum = pageSize(); appEl.classList.toggle("collapsed"); prefs.sidebarCollapsed = appEl.classList.contains("collapsed"); saveState(); setTimeout(() => appEl.classList.remove("animating"), SIDEBAR_ANIM_MS); const nextSize = pageSize(); if (nextSize === sizeSebelum) return; setTimeout(() => { renderStorage(); renderSearch(); }, SIDEBAR_ANIM_MS + 40); };
  if (prefs.sidebarCollapsed && !mobileQuery.matches) $("#app").classList.add("collapsed");
/* ---------- Perintah /genre: (mobile saja) ---------- */
/* Genre disembunyikan di mobile supaya header tidak penuh, jadi pickernya
   tidak ada di layar itu. Perintah ini yang membukanya. Hanya di mobile:
   di 768px ke atas picker-nya masih terlihat, dan dua jalan ke genre di
   satu layar bukan tambahan, cuma kebocoran.

   Ambangnya 767px, sama dengan dropdown.js:8 dan sama dengan aturan CSS
   yang menyembunyikan .genre-filter. BUKAN isMobileViewport() yang 1023px
   - itu untuk drawer dan ukuran halaman, bukan untuk filter.

   "/genre:" buka panel, lalu teks setelahnya menyaring chip LANGSUNG
   saat diketik: A -> yang berawalan A, Ac -> yang berawalan Ac. Tanpa
   penyaringan ini perintahnya cuma dua ketukan ekstra tanpa untung.
   Penyaringan memakai awalan, bukan "mengandung", karena orang mengetik
   dari awal kata. */
const genreCmdQuery = window.matchMedia("(max-width: 767px)");
const genreCmdRoot = $(".genre-filter.gf-header");
const GENRE_CMD_RE = /^\/(?:genre)?[:\s]*(.*)$/i;
let genreCmdBound = false;
let genreCmdNote = null;
let genreCmdBackdrop = null;
const isGenreCommand = () => genreCmdQuery.matches && GENRE_CMD_RE.test(($("#globalSearch")?.value || "").trim());
const genreFilterText = () => {
  if (!genreCmdQuery.matches) return null;
  const m = GENRE_CMD_RE.exec(($("#globalSearch")?.value || "").trim());
  return m ? m[1] : null;
};
/* Chip tidak dirender ulang: yang disembunyikan hanya yang tidak cocok.
   Dua alasan. Pertama, bindGenre() memasang onclick per chip, jadi render
   ulang mematikan handler-nya - itu persis bug "tidak bisa ganti pilihan"
   yang sudah pernah dicatat di file ini. Kedua, menyembunyikan chip lebih
   murah daripada membangun ulang grid setiap kali huruf diketik. */
function filterGenreCommand(q) {
  const grid = $(".gf-grid", genreCmdRoot);
  if (!grid) return 0;
  if (!genreCmdNote) {
    genreCmdNote = document.createElement("p");
    genreCmdNote.className = "gf-empty";
    genreCmdNote.textContent = "Tidak ada genre yang cocok.";
    grid.after(genreCmdNote);
  }
  const needle = q.trim().toLowerCase();
  let shown = 0;
  $$("[data-genre]", grid).forEach((b) => {
    const name = (b.dataset.name || "").toLowerCase();
    const cocok = !needle || name.startsWith(needle);
    b.hidden = !cocok;
    if (cocok) shown++;
  });
  genreCmdNote.hidden = shown > 0;
  if (needle) grid.scrollTop = 0;
  return shown;
}
/* Panel diletakkan persis di bawah kotak pencarian. Koordinatnya dikirim
   lewat custom property supaya CSS tidak perlu meng tahu tata letak;
   JS yang mengukur, karena kotak pencarian bisa menyempit sendiri
   (.search-wrap punya width clamp). Lebar minimal 260px supaya grid
   2 kolom tidak tergencet di layar sempit, lalu dibatasi 20px dari
   tepi layar supaya tidak keluar viewport. */
function positionGenreCommand() {
  const panel = $(".gf-panel", genreCmdRoot);
  const zone = $(".search-zone") || $("#globalSearch");
  if (!panel || !zone) return;
  const r = zone.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.width, 260), vw - 20);
  const left = Math.min(Math.max(10, r.left), vw - w - 10);
  const top = Math.min(r.bottom + 8, vh - 90);
  panel.style.setProperty("--genre-cmd-left", Math.round(left) + "px");
  panel.style.setProperty("--genre-cmd-w", Math.round(w) + "px");
  panel.style.setProperty("--genre-cmd-top", Math.round(top) + "px");
}
/* Latar redup. Tanpa ini panelnya tidak terbaca sebagai lapisan di atas
   halaman: kartu anime di belakangnya tetap terang dan terlihat bisa
   diklik. Elemen sungguhan, bukan ::before, supaya bisa diuji dan
   diklik - dan klik di sana otomatis menutup lewat listener klik luar
   milik dropdown.js. */
function genreCmdBackdropEl() {
  if (genreCmdBackdrop) return genreCmdBackdrop;
  genreCmdBackdrop = document.createElement("div");
  genreCmdBackdrop.className = "genre-cmd-backdrop";
  genreCmdBackdrop.hidden = true;
  document.body.appendChild(genreCmdBackdrop);
  return genreCmdBackdrop;
}
/* Panel bisa ditutup tanpa lewat closeGenreCommand(): Escape global dan
   klik luar di dropdown.js keduanya menutupnya. Kalau itu tidak
   tertangkap, html.genre-cmd dan body overflow="hidden" tertinggal -
   halaman tetap terkunci padahal tidak ada yang terbuka. */
function genreCmdChromeOff() {
  document.documentElement.classList.remove("genre-cmd");
  genreCmdRoot?.classList.remove("genre-cmd");
  if (genreCmdBackdrop) genreCmdBackdrop.hidden = true;
}
function genreCmdChromeOn() {
  document.documentElement.classList.add("genre-cmd");
  genreCmdRoot.classList.add("genre-cmd");
  genreCmdBackdropEl().hidden = false;
  positionGenreCommand();
}
function syncGenreCommand() {
  /* Keluar dari mobile: tutup paksa dan buang penanda, supaya tidak
     tertinggal saat layar melebar. dropdown.js juga menutup dropdown
     aktif di ambangnya (dropdown.js:99); ini untuk class-nya. */
  if (!genreCmdQuery.matches) {
    genreCmdChromeOff();
    /* Semua chip harus kembali terlihat, atau layar desktop mewarisi
       penyaringan yang ditinggalkan perintah mobile. */
    filterGenreCommand("");
  }
}
function openGenreCommand() {
  const trigger = $(".gf-trigger", genreCmdRoot);
  if (!trigger) return;
  genreCmdChromeOn();
  /* Lewati trigger, bukan setOpen langsung: setOpen tidak diekspor, dan
     ini membuat panel ikut listener Escape + klik luar yang sudah ada di
     dropdown.js - tanpa menambah listener baru. Kalau sudah terbuka,
     trigger.click() justru MENUTUP, jadi hanya klik saat masih tertutup. */
  if (!genreCmdRoot.classList.contains("open")) trigger.click();
}
function closeGenreCommand() {
  const trigger = $(".gf-trigger", genreCmdRoot);
  if (trigger && genreCmdRoot.classList.contains("open")) trigger.click();
  genreCmdChromeOff();
}
function bindGenreCommand() {
  const input = $("#globalSearch");
  if (!input || !genreCmdRoot || genreCmdBound) return;
  genreCmdBound = true;
  input.addEventListener("input", () => {
    const q = genreFilterText();
    if (q === null) { closeGenreCommand(); return; }
    openGenreCommand();
    filterGenreCommand(q);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isGenreCommand()) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
    if (e.key === "Enter" && isGenreCommand()) {
      e.preventDefault();
      openGenreCommand();
      filterGenreCommand(genreFilterText() || "");
      /* Enter memilih chip pertama yang cocok - seperti palette di Slack
         atau VS Code. Tanpa ini, orang yang tidak memakai tetikus harus
         memindai daftar dengan Shift+Tab dulu. Kalau tidak ada yang cocok,
         tidak terjadi apa-apa: pesan "tidak ada yang cocok" yang menjelaskan,
         bukan diam. */
      const pertama = $$("[data-genre]", $(".gf-grid", genreCmdRoot)).find((b) => !b.hidden);
      if (pertama) pertama.click();
    }
  });
  /* Chip genre diklik: kosongkan perintah supaya kotak cari kembali normal.
     Delegasi di grid, bukan per chip, karena bindGenre() merender
     ulang chip ketika daftar genre arrive - handler per chip akan mati. */
  $(".gf-grid", genreCmdRoot)?.addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    filterGenreCommand("");
  });
  /* dropdown.js menutup panel dari tiga arah (trigger, Escape global,
     klik luar). Hanya arah pertama yang lewat sini, jadi dua lainnya
     harus diamati lewat atribut hidden - kalau tidak, class dan
     overflow="hidden" tertinggal dan halaman terkunci. */
  const panelEl = $(".gf-panel", genreCmdRoot);
  if (panelEl) new MutationObserver(() => { if (panelEl.hidden) genreCmdChromeOff(); })
    .observe(panelEl, { attributes: true, attributeFilter: ["hidden"] });
  genreCmdQuery.addEventListener("change", syncGenreCommand);
  window.addEventListener("resize", () => { if (!genreCmdRoot.classList.contains("open")) return; positionGenreCommand(); });
  syncGenreCommand();
}
/* #confirmRoot dan #gooMenu dulu tertulis DI DALAM #watchOverlay di
   index.html, padahal #watchOverlay ber-display:none sampai ada video
   dibuka. Gejalanya: overlay 0x0, getAnimations() kosong, dan opacity
   macet di 0 karena fadeIn dimulai dari opacity:0.

   Markup index.html sudah diperbaiki (25 Okt 2026): #watchOverlay kini
   ditutup setelah #watchModal, jadi #confirmRoot, #gooMenu, #toastStack,
   dan #ambientCanvas berada langsung di <body>. Baris di bawah tinggal
   jadi jaring pengaman kalau elemen itu suatu saat kembali tertanam di
   dalam modal - supaya pop-up tidak lagi bergantung pada modal yang
   kebetulan terbuka. */
for (const id of ["confirmRoot", "gooMenu"]) {
  const el = document.getElementById(id);
  if (el && el.parentElement !== document.body) document.body.appendChild(el);
}
bindGenreCommand();

$("#globalSearch").onkeydown = (e) => { if (e.key === "Enter") { if (isGenreCommand()) return; e.preventDefault(); search(e.currentTarget.value); scrollToSearchResults(); } };
  $("#globalSearch").oninput = () => updateSearchUI();
  $("#searchMorphBtn").onclick = () => { if (state.searchQuery || state.searchResults.length) clearAllSearch(); else { search($("#globalSearch").value); scrollToSearchResults(); } };
  $("#clearSearchBtn").onclick = () => clearAllSearch();
  $("#localSearch").oninput = (e) => { state.localQuery = e.target.value; state.storagePage = 0; renderStorage(); };
  $$("#storageTabs .tab").forEach((b) => b.onclick = () => { state.currentTab = b.dataset.tab; state.storagePage = 0; renderStorage(); });
  /* Edit Mode pindah ke dalam dropdown Data (permintaan Neo 6 Okt) supaya
     toolbar storage lebih bersih. Label tombol tetap disinkronkan dari sini. */
  const editModeLabel = (on) => { const btn = $("#editModeBtn"); if (!btn) return; btn.innerHTML = on ? "Done" : `<svg class="ico"><use href="#i-edit"/></svg> Edit Mode`; btn.classList.toggle("is-on", on); };
  const closeDataMenu = () => { closeActive(); };
  $("#editModeBtn").onclick = () => { state.editMode = !state.editMode; state.selectedStorageItems.clear(); editModeLabel(state.editMode); closeDataMenu(); renderStorage(); };
  $("#selectAllBtn").onclick = () => { filterVisible().forEach((item) => state.selectedStorageItems.add(item.slug)); renderStorage(); };
  $("#cancelEditBtn").onclick = () => { state.editMode = false; state.selectedStorageItems.clear(); editModeLabel(false); renderStorage(); };
  holdable($("#bulkDeleteBtn"), 1500, () => { state.storageItems = state.storageItems.filter((i) => !state.selectedStorageItems.has(i.slug)); state.selectedStorageItems.clear(); saveState(); renderAll(); loadGenreRecommendations(); toast("Anime terpilih dihapus"); });
  holdable($("#deleteDataBtn"), 1500, () => openConfirm("Hapus seluruh data lokal?", "Tindakan ini permanen dan menghapus koleksi, progres, nama, foto profil, dan setelan lokal. Koleksi, progres, dan profile lokal.", () => deleteAllLocal(), { hold: 1500 }));
  holdable($("#ppDeleteBtn"), 1500, () => openConfirm("Hapus seluruh data lokal?", "Tindakan ini permanen dan menghapus koleksi, progres, nama, foto profil, dan setelan lokal. Koleksi, progres, dan profile lokal.", () => deleteAllLocal(), { hold: 1500 }));
  $("#watchClose").onclick = closeWatch;
  $("#watchOverlay").onclick = (e) => { if (e.target.id === "watchOverlay") closeWatch(); };
  attach($("#mirrorSelectWrapper"));
  attach($(".data-menu-wrap"));
  $("#sbUser").onclick = () => { if (mobileQuery.matches) return; /* profil sudah tampil di main saat mobile */ const popup = $("#profilePopup"); popup.hidden = !popup.hidden; $("#ppNameInput").value = prefs.username; };
  const openProfileEditor = () => { const popup = $("#profilePopup"); popup.hidden = false; popup.classList.add("is-inline"); $("#ppNameInput").value = prefs.username; applyProfile(); };
  $("#pcEditBtn").onclick = (event) => { event.stopPropagation(); openProfileEditor(); };
  const finishEdit = () => { $("#profilePopup").classList.remove("is-inline"); $("#profilePopup").hidden = true; saveState(); renderProfile(); };
  $("#ppClose").addEventListener("click", (event) => { event.stopPropagation(); finishEdit(); });
  $("#ppNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const value = e.currentTarget.value.trim(); if (value) { prefs.username = value; toast("Profil diperbarui", "Nama tersimpan di perangkat ini."); } finishEdit(); } });
  $("#ppChangeAvatar").addEventListener("click", (e) => {
    e.stopPropagation();
    /* Suspend 30 dtk setelah 3× memaksa format tidak didukung */
    const until = Number(prefs.avatarSuspendedUntil || 0);
    if (Date.now() < until) { toast("Upload ditangguhkan", `Coba lagi dalam ${Math.ceil((until - Date.now()) / 1000)} detik.`); return; }
    $("#ppAvatarFile").click();
  });
  $("#ppAvatarFile").onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    /* Hanya PNG / WebP / GIF — GIF membuat avatar beranimasi. */
    if (!isAllowedAvatarFile(file)) {
      e.target.value = "";
      const strikes = Number(prefs.avatarStrikes || 0) + 1;
      if (strikes >= 3) {
        prefs.avatarStrikes = 0;
        prefs.avatarSuspendedUntil = Date.now() + 30000;
        saveState();
        openAlert("Upload ditangguhkan", "Kamu 3 kali mencoba format yang tidak didukung. Ganti foto profil dikunci selama 30 detik.");
      } else {
        prefs.avatarStrikes = strikes;
        saveState();
        openAlert("Format tidak didukung", `Avatar hanya menerima PNG, WebP, atau GIF. Percobaan ke-${strikes} dari 3.`);
      }
      return;
    }
    prefs.avatarStrikes = 0;
    const reader = new FileReader();
    reader.onload = () => { prefs.avatarUrl = String(reader.result); saveState(); renderProfile(); toast("Foto profil diperbarui", /gif/i.test(file.type) ? "Avatar GIF beranimasi aktif." : ""); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  $("#ppNameInput").onchange = (e) => { prefs.username = e.target.value.trim() || "Anime watcher"; saveState(); renderProfile(); };
  $("#aboutButton")?.addEventListener("click", openAbout);
  $("#importBtn").onclick = () => { closeActive(); $("#dataMenu").hidden = true; $("#importFile").click(); };
  $("#exportBtn").onclick = () => { closeActive(); $("#dataMenu").hidden = true; const payload = buildExportPayload(state.storageItems, prefs); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); link.download = `soranema-tracking-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast("Backup diunduh", `${payload.items.length} anime + profil (nama & foto).`); };
  $("#importFile").onchange = (e) => { const file = e.target.files?.[0]; if (!file) return; toast("Membaca backup…", "Memulihkan koleksi dari file yang dipilih.", 2200); const reader = new FileReader(); reader.onload = async () => { try { const data = JSON.parse(reader.result); const items = Array.isArray(data) ? data : data.items || data.storageItems; if (!Array.isArray(items)) throw new Error("Format backup tidak dikenali."); state.storageItems = items.map(normalizeStored).filter((x) => x.slug); /* v2: pulihkan juga profil (nama, handle, foto, tema) */ const restoredProfile = Boolean(data.profile); if (restoredProfile) { prefs = mergeImportedProfile(data, prefs); applyTheme(prefs.theme); if (prefs.sidebarCollapsed && !mobileQuery.matches) $("#app").classList.add("collapsed"); else $("#app").classList.remove("collapsed"); } saveState(); renderAll(); loadGenreRecommendations(); toast("Import selesai", `${state.storageItems.length} anime dipulihkan.${restoredProfile ? " Profil juga dipulihkan." : ""}`); } catch (error) { toast("Import gagal", error.message); } }; reader.readAsText(file); e.target.value = ""; };
  $$(".nav-item[data-nav]").forEach((b) => b.onclick = () => { const map = { dashboard: "#profileSection", continue: "#continueSection", update: "#updateSection", storage: "#storageSection" }; scrollToSection(map[b.dataset.nav], b); setDrawer(false); });
  /* Rail "Lanjutkan Menonton": panah geser + tombol kiri/kanan keyboard. */
  $("[data-cw-prev]")?.addEventListener("click", () => cwScrollRail(-1));
  $("[data-cw-next]")?.addEventListener("click", () => cwScrollRail(1));
  $("#continueRail")?.addEventListener("scroll", syncCwNav, { passive: true });
  setupSectionCrossfade();
  const mainScroll = $("#mainScroll");
  let scrollFrame = 0;
  const updateActiveNav = () => {
    scrollFrame = 0;
    if (!mainScroll) return;
    const scrollTop = mainScroll.scrollTop;
    const sections = [["#profileSection", "dashboard"], ["#continueSection", "continue"], ["#updateSection", "update"], ["#storageSection", "storage"]]
      .map(([selector, name]) => ({ top: $(selector)?.offsetTop, name }))
      .filter((section) => Number.isFinite(section.top));
    let active = "dashboard";
    for (const section of sections) if (section.top - scrollTop < 180) active = section.name;
    const navItems = $$(".nav-item[data-nav]");
    navItems.forEach((button) => button.classList.toggle("active", button.dataset.nav === active));
  };
  mainScroll?.addEventListener("scroll", () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateActiveNav); }, { passive: true });
  updateActiveNav();
  $$(".nav-item[data-support]").forEach((b) => b.onclick = () => { setDrawer(false); if (b.dataset.support === "about") openAbout(); if (b.dataset.support === "donate") window.open("https://sociabuzz.com/neonishikawa/tribe", "_blank", "noopener"); if (b.dataset.support === "feedback") window.open("https://tally.so/r/7RAZd2", "_blank", "noopener"); });
  pasangMenuDownload();
  $("#profilePopup").addEventListener("click", (e) => { if (e.target === $("#profilePopup")) finishEdit(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("#dlPopupRoot")?.querySelector(".overlay")) return; if (!$("#watchOverlay").hidden) closeWatch(); else $("#profilePopup").hidden = true; } });
  [$(".gf-header"), $(".gf-storage")].forEach(bindGenre);
  $$(".styled-filter").forEach(bindDropdown);
}
function filterVisible() { const q = state.localQuery.toLowerCase(); return state.storageItems.filter((item) => { if (state.currentTab === "Complete" && !isComplete(item)) return false; if (state.currentTab === "Plan to Watch" && item.progress) return false; if (state.currentTab === "Dislike" && !item.dislike && item.status !== "dropped") return false; if (state.currentTab === "Favorite" && !item.favorite) return false; return !q || item.title.toLowerCase().includes(q); }); }
async function loadLive() {
  state.updateLoading = true;
  renderUpdates();
  /* Daily dikirim lebih dulu supaya ia yang mengambil slot upstream pertama;
     genre menyusul di antrean, bukan menahannya. Dulu keduanya ditunggu
     bersama (Promise.allSettled), padahal source hanya memproses satu request
     per 1,5 detik - jadi "New Update" menunggu genre yang tidak dipakai untuk
     merendernya. Sekarang daily tampil sendiri, genre menyusul di belakang. */
  const dailyTask = timed(api.daily());
  const genreTask = timed(api.genres())
    .then((response) => {
      state.genres = response.data || [];
      bindGenre($(".gf-header"));
      bindGenre($(".gf-storage"));
    })
    .catch(() => { /* filter genre tetap memakai GENRE_OPTIONS bawaan */ });
  try {
    const response = await dailyTask;
    state.daily = (response.data || []).map(normAnime);
  } catch {
    state.daily = [];
  }
  state.updateLoading = false;
  renderUpdates();
  bindActions();
  /* Rekomendasi dimulai SETELAH update utama tampil. Kalau dimulai lebih awal,
     endpoint rekomendasi ikut berebut antrean upstream dengan /api/daily. */
  loadRecommendations();
  await genreTask;
}
/* Satu tekan per detik untuk setiap tombol. Dipasang di capture phase
   supaya klik kedua sudah dihentikan sebelum handler tombol mana pun
   berjalan; tautan unduhan same-tab ikut dibatasi agar tidak memulai
   unduhan ganda. Klik yang ditolak memunculkan pengingat singkat, kecuali
   saat pengingat screen-time sedang terbuka. */
attachPressLimiter(document, {
  onBlocked: (target) => {
    if (target.closest?.("[data-double-click-overlay]")) return;
    if (document.querySelector("[data-screen-overlay]:not([hidden])")) return;
    doubleClickReminder?.show();
  },
});
/* Kunci tidak cocok? Kerangka design tetap dirender, tapi tidak ada satu pun
   request ke server: tanpa anime, tanpa hasil pencarian, tanpa episode. */
setup(); setupRecRails(); setupScrollReveal(); setupScrollDirection(); setupSwipeCards(); setupRailBoing(); renderAll();
/* Pemberitahuan pemeliharaan: muncul di kunjungan pertama, lalu sekali
   setiap 14 hari. Tidak bergantung pada server, jadi tetap tampil walau
   katalog sedang lambat.

   Tidak ditampilkan di shell APK. Dua alasan: shell terpasang memuat
   "?shell=apk" (penanda yang sama dipakai server untuk melewati halaman
   maintenance), dan WebView Android dikenali dari User-Agent-nya. Keduanya
   dicek supaya notifikasi tetap hilang walau suatu saat penanda URL tidak
   ikut terkirim. Browser biasa dan EXE tetap melihat notifikasi. */
if (!diWebViewAndroid() && !shellTerpasang()) mountMaintenanceNotice();
orb = mountSearchOrb($(".search-wrap"));

/* ---------- Gooey morph: tombol "+" di SETIAP kartu anime ----------
   Gumpalan/cairan dibuat oleh SVG filter (#gooFilter: blur + contrast alpha)
   yang sekarang tinggal SATU definisi global, dipakai ulang semua kartu lewat
   filter:url(#gooFilter). Ikon dan teks berada di luar filter itu, jadi tetap
   tajam. Menu juga tunggal: #gooMenu dipindah ke posisi tombol yang diklik,
   bukan satu panel per kartu (18 kartu = 18 panel sia-sia).
   Isi menu: Favorite, Dislike, Reset, Hapus — untuk SATU anime, itu sebabnya
   tombolnya ada di dalam box anime dan bukan di toolbar. */
const gooMenu = $("#gooMenu");
let gooAnchor = null;
/* Hapus dari menu morph memakai jalur yang SAMA dengan tombol Remove di Edit
   Mode: TAHAN tombolnya (holdable + fill progress), lalu removeStorage() yang
   sudah memunculkan toast. Tidak ada popup dan tidak ada animasi erase di
   sini — dua-duanyadialog khusus untuk Delete All Data di sidebar, satu-
   satunya hapus yang benar-benar menghapus semuanya sekaligus. */
const MORPH_HOLD_MS = 1200;
const closeGooMenu = (refocus) => {
  if (!gooMenu) return;
  gooMenu.setAttribute("hidden", "");
  gooMenu.classList.remove("is-open");
  if (gooAnchor) gooAnchor.setAttribute("aria-expanded", "false");
  if (refocus && gooAnchor) gooAnchor.focus();
  gooAnchor = null;
};
if (gooMenu) {
  const scopeLine = $(".goo-scope", gooMenu);
  /* Panel diposisikan relatif viewport: di atas tombol, tapi tetap di dalam
     layar kalau tombolnya berada di baris paling atas grid. */
  const place = (btn) => {
    const r = btn.getBoundingClientRect();
    gooMenu.style.visibility = "hidden";
    gooMenu.removeAttribute("hidden");
    const h = gooMenu.offsetHeight, w = gooMenu.offsetWidth;
    const above = r.top - h - 10;
    const top = above < 8 ? Math.min(r.bottom + 10, window.innerHeight - h - 8) : above;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    gooMenu.style.top = `${Math.round(Math.max(8, top))}px`;
    gooMenu.style.left = `${Math.round(left)}px`;
    gooMenu.style.visibility = "";
    gooMenu.classList.add("is-open");
  };
  const openGooMenu = (btn, slug) => {
    const item = getStored(slug);
    if (!item) return;
    gooAnchor = btn;
    btn.setAttribute("aria-expanded", "true");
    if (scopeLine) scopeLine.textContent = item.title || "Anime ini";
    place(btn);
    gooMenu.querySelector("button")?.focus();
  };
  gooMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-goo]");
    if (!item || !gooAnchor) return;
    e.stopPropagation();
    const action = item.dataset.goo;
    const slug = gooAnchor.dataset.id;
    const entry = getStored(slug);
    if (!entry) return;
    /* Hapus TIDAK menutup menu di sini: tombolnya harus tetap kelihatan
       supaya bisa ditahan. Semua aksi lain menutup. */
    if (action !== "remove") closeGooMenu(false);
    if (action === "favorite" || action === "dislike") {
      /* Favorite dan Dislike saling meniadakan, aturan sama seperti
         setAnimeReaction(). Di sini SET, bukan toggle: satu kartu, satu
         klik, status pasti. */
      const isFavorite = action === "favorite";
      const already = isFavorite ? entry.favorite : entry.dislike;
      if (already) { toast(isFavorite ? "Sudah Favorite" : "Sudah Dislike", entry.title || ""); return; }
      Object.assign(entry, isFavorite ? { favorite: true, dislike: false } : { dislike: true, favorite: false });
      saveState();
      renderStorage(); renderProfile();
      toast(isFavorite ? "Ditandai Favorite" : "Ditandai Dislike", entry.title || "");
      return;
    }
    if (action === "reset") {
      /* Reset lewat konfirmasi (silent), lalu aturan resetProgress() yang
         sudah ada: episode dikosongkan, status planned, mulai ulang. */
      if (!entry.watchedEpisodes?.length && !entry.progress) { toast("Tidak ada progress untuk direset.", entry.title || ""); return; }
      openConfirm("Reset progress?", `Semua centang episode ${entry.title} akan dihapus dan mulai lagi dari Episode 1.`, () => resetProgress(slug), { silent: true, confirmLabel: "Reset", confirmClass: "btn btn-primary" });
      return;
    }
    if (action === "remove") {
      /* Hapus: TIDAK langsung jalan. Tombol Hapus di menu ini di-bound
         holdable() di bawah — pointerdown + tahan 1200ms. Klik singkat
         hanya memberi petunjuk cara memakainya. Konsisten dengan tombol
         Remove di Edit Mode, dan popup erase dikhususkan untuk Delete All
         Data di sidebar. */
      toast("Tahan tombol Hapus", `${entry.title || "Anime ini"} — tahan 1,2 detik untuk menghapus, lepas lebih awal untuk batal.`, 2600);
      return;
    }
  });
  /* Hold pada tombol Hapus menu. Menu ini statis di HTML (satu panel untuk
     semua kartu), jadi cukup diikat sekali di sini. */
  const removeBtn = gooMenu.querySelector('[data-goo="remove"]');
  if (removeBtn) {
    holdable(removeBtn, MORPH_HOLD_MS, () => {
      const anchor = gooAnchor;
      if (!anchor) return;
      const slug = anchor.dataset.id;
      const entry = getStored(slug);
      closeGooMenu(false);
      if (!entry) return;
      removeStorage(slug);
    });
  }
  /* Klik di luar menutup; Escape menutup dan mengembalikan fokus ke tombol. */
  document.addEventListener("click", (e) => {
    if (!gooAnchor) return;
    if (gooMenu.contains(e.target) || e.target.closest?.('[data-act="goo"]')) return;
    closeGooMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !gooAnchor) return;
    const back = gooAnchor;
    closeGooMenu(false);
    back.focus();
  });
  /* Delegasi: tombol morph dibangun ulang tiap renderStorage/renderSearch/
     renderUpdates, jadi tidak boleh diikat satu per satu. */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.('[data-act="goo"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const slug = btn.dataset.id;
    if (gooAnchor === btn) { closeGooMenu(true); return; }
    closeGooMenu(false);
    openGooMenu(btn, slug);
  });
}
/* Tab yang dibiarkan terbuka masih memegang bundle lama. /api/health membawa
   bootId proses; kalau berubah, tab ini memberi tahu bahwa ada versi baru dan
   menyediakan tombol muat ulang. Sengaja TIDAK reload otomatis: memuat ulang
   sendiri bisa memotong episode yang sedang diputar atau menghapus dialog
   yang belum disimpan. */
function mountServerRefresh() {
  const kotak = $("#serverRefresh");
  const tombol = $("#serverRefreshReload");
  if (!kotak || !tombol) return null;
  tombol.addEventListener("click", () => window.location.reload());
  const pengamat = createBootWatcher({
    ambilBootId: async () => String((await api.health())?.bootId || ""),
    onRestart: () => { kotak.hidden = false; },
  });
  /* Tab yang baru kembali terlihat diperiksa lebih awal, tidak perlu menunggu
     putaran interval berikutnya. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pengamat.periksa();
  });
  window.addEventListener("online", () => pengamat.periksa());
  pengamat.mulai();
  return pengamat;
}

sealReady.then((ok) => {
  if (!ok) return;
  loadLive();
  /* Hydrate metadata storage (rating, genre, karakter) di belakang layar agar
     kartu storage & detail tidak menampilkan "—" selamanya */
  if (state.storageItems.length) hydrateStorageMetadata().then(() => { renderStorage(); renderProfile(); renderRecommendations(); loadGenreRecommendations(); });
});

/* Dipasang terpisah supaya urutan pemuatan data di blok di atas tidak berubah. */
sealReady.then((ok) => { if (ok) mountServerRefresh(); });
