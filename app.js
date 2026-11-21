const $ = (id) => document.getElementById(id);

// Opening screen: shown once each time the app is opened
(function () {
  const splash = $("splash");
  if (!splash) return;
  let seen = null;
  try { seen = sessionStorage.getItem("kh-splash"); } catch (e) { /* ignore */ }
  if (seen) { splash.remove(); return; }
  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 600);
    try { sessionStorage.setItem("kh-splash", "1"); } catch (e) { /* ignore */ }
  }, 1600);
})();

// In the Android and iOS apps the library is read from the live website, so
// new books appear without reinstalling. In a browser it reads its own folder.
const LIVE = "https://maxido254.github.io/kenya-history/";
const IN_APP = !!(window.Capacitor || /^(capacitor|ionic):/.test(location.protocol) || location.hostname === "localhost" && !location.port);
const BASE = IN_APP ? LIVE : "";

// Try the live site, remember what arrived, fall back to the saved copy,
// and finally to the copy bundled inside the app.
async function getJSON(path) {
  const key = LIVE + path;
  try {
    const res = await fetch(BASE + path, { cache: "no-cache" });
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    try {
      const c = await caches.open("kh-data");
      await c.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
    } catch (e) { /* storage not available */ }
    return data;
  } catch (e) {
    try {
      const c = await caches.open("kh-data");
      const hit = await c.match(key);
      if (hit) return await hit.json();
    } catch (e2) { /* ignore */ }
    if (IN_APP) {
      const res = await fetch(path);
      if (res.ok) return res.json();
    }
    throw e;
  }
}

let books = [];
let topic = "All";
let cur = null; // { m: catalogue entry, data: book text, ch: chapter index }

const prefs = { fs: 1.15, night: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("kh-prefs") || "{}")); } catch (e) { /* ignore */ }
function savePrefs() { try { localStorage.setItem("kh-prefs", JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
function applyPrefs() {
  document.documentElement.style.setProperty("--fs", prefs.fs + "rem");
  $("reader").classList.toggle("night", prefs.night);
  $("theme").textContent = prefs.night ? "Paper" : "Night";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

async function init() {
  applyPrefs();
  try {
    // Only books that can be read inside the app are listed
    books = (await getJSON("books.json")).filter((b) => b.permission_from && b.license && b.text);
  } catch (e) {
    $("status").textContent = "The library could not be loaded. Check your connection.";
    return;
  }
  buildFilters();
  await refreshSaved();
  render();
  wire();
  syncLibrary();
  window.addEventListener("online", async () => {
    // Internet came back: pick up the newest list, then download what is new
    try {
      books = (await getJSON("books.json")).filter((b) => b.permission_from && b.license && b.text);
      buildFilters();
    } catch (e) { /* keep the current list */ }
    syncLibrary();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function buildFilters() {
  const topics = ["All", ...new Set(books.flatMap((b) => b.topics || [])).values()].filter((t, i, a) => a.indexOf(t) === i);
  const box = $("filters");
  box.textContent = "";
  topics.forEach((t) => {
    const b = el("button", "", t);
    b.type = "button";
    b.setAttribute("aria-pressed", String(t === topic));
    b.onclick = () => { topic = t; buildFilters(); render(); };
    box.appendChild(b);
  });
}

function colourFor(title) {
  let n = 0;
  for (const ch of title) n += ch.charCodeAt(0);
  return n % 3;
}

function noteFor(m) {
  if (saved.has(bookKey(m))) return "Saved on this device ✓";
  return m.year ? String(m.year) : "Read · Download PDF";
}

// ---- Automatic downloads -------------------------------------------------
// Whenever the app opens with internet, any new or changed book is fetched
// and kept on the device, so it can be read later without a connection.
const saved = new Set();
const bookKey = (m) => m.id || m.title;
const verKey = (m) => "kh-ver-" + bookKey(m);

async function isCached(path) {
  try {
    const c = await caches.open("kh-data");
    return !!(await c.match(LIVE + path));
  } catch (e) { return false; }
}

async function refreshSaved() {
  saved.clear();
  for (const m of books) if (await isCached(m.text)) saved.add(bookKey(m));
}

// Books taken off the list are also removed from the device
async function pruneCache() {
  try {
    const c = await caches.open("kh-data");
    const keep = new Set(books.map((m) => LIVE + m.text));
    keep.add(LIVE + "books.json");
    for (const req of await c.keys()) {
      if (req.url.startsWith(LIVE + "books/") && !keep.has(req.url)) await c.delete(req);
    }
    try {
      const listed = new Set(books.map(bookKey));
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("kh-ver-") && !listed.has(k.slice(7))) localStorage.removeItem(k);
        if (k.startsWith("kh-pos-") && !listed.has(k.slice(7))) localStorage.removeItem(k);
      });
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

let syncing = false;
async function syncLibrary() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    await pruneCache();
    await refreshSaved();
    const todo = [];
    for (const m of books) {
      let stored = null;
      try { stored = localStorage.getItem(verKey(m)); } catch (e) { /* ignore */ }
      if (!(await isCached(m.text)) || stored !== String(m.updated || "")) todo.push(m);
    }
    if (!todo.length) return;
    let done = 0;
    for (const m of todo) {
      $("status").textContent = `Downloading new books… ${done} of ${todo.length}`;
      try {
        await getJSON(m.text);
        try { localStorage.setItem(verKey(m), String(m.updated || "")); } catch (e) { /* ignore */ }
      } catch (e) { /* try again next time */ }
      done++;
    }
    await refreshSaved();
    render();
  } finally {
    syncing = false;
  }
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const grid = $("covers");
  grid.textContent = "";
  let shown = 0;
  for (const m of books) {
    const hay = [m.title, m.author, m.description, ...(m.topics || [])].join(" ").toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (topic !== "All" && !(m.topics || []).includes(topic)) continue;
    const b = el("button", "book");
    b.type = "button";
    const cover = el("div", "cover c" + colourFor(m.title));
    cover.append(el("h2", "", m.title), el("span", "by", m.author || ""));
    b.append(cover, el("span", "note", noteFor(m)));
    b.onclick = () => openBook(m);
    grid.appendChild(b);
    shown++;
  }
  $("status").textContent = books.length
    ? `${shown} of ${books.length} title${books.length === 1 ? "" : "s"}`
    : "No titles yet.";
}

function posKey(m) { return "kh-pos-" + (m.id || m.title); }

async function openBook(m) {
  let data;
  try {
    data = await getJSON(m.text);
  } catch (e) {
    alert("This book is not available offline yet. Connect to the internet and open it once.");
    return;
  }
  let start = 0;
  try { start = parseInt(localStorage.getItem(posKey(m)) || "0", 10) || 0; } catch (e) { /* ignore */ }
  cur = { m, data, ch: start };
  $("rtitle").textContent = m.title;
  $("rights").textContent = `Shared with permission from ${m.permission_from}. ${m.license}.`;
  buildChapterList();
  $("reader").hidden = false;
  document.body.style.overflow = "hidden";
  if (location.hash !== "#read") location.hash = "read";
  showChapter(start);
}

function buildChapterList() {
  const ol = $("chapterList");
  ol.textContent = "";
  cur.data.chapters.forEach((c, i) => {
    const li = document.createElement("li");
    const b = el("button", "", `${i + 1}. ${c.title}`);
    b.type = "button";
    b.onclick = () => { $("drawer").hidden = true; showChapter(i); };
    li.appendChild(b);
    ol.appendChild(li);
  });
}

function showChapter(i) {
  const n = cur.data.chapters.length;
  i = Math.max(0, Math.min(n - 1, i));
  cur.ch = i;
  const c = cur.data.chapters[i];
  const page = $("page");
  page.textContent = "";
  page.append(el("div", "label", `Chapter ${i + 1} of ${n}`), el("h2", "", c.title));
  c.paragraphs.forEach((p) => {
    if (p.startsWith("## ")) page.appendChild(el("h3", "", p.slice(3)));
    else page.appendChild(el("p", "", p));
  });
  const pager = el("div", "pager");
  const prev = el("button", "", "← Previous");
  const next = el("button", "", "Next →");
  prev.type = next.type = "button";
  prev.disabled = i === 0;
  next.disabled = i === n - 1;
  prev.onclick = () => showChapter(i - 1);
  next.onclick = () => showChapter(i + 1);
  pager.append(prev, next);
  page.appendChild(pager);
  $("scroll").scrollTop = 0;
  Array.from($("chapterList").querySelectorAll("button")).forEach((b, k) => {
    if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  try { localStorage.setItem(posKey(cur.m), String(i)); } catch (e) { /* ignore */ }
}

function closeReader() {
  $("reader").hidden = true;
  $("drawer").hidden = true;
  document.body.style.overflow = "";
  cur = null;
  if (location.hash === "#read") history.back();
}

function downloadPdf() {
  if (!cur) return;
  try {
    const blob = makePdf(cur.data);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (cur.m.title || "book").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    alert("The PDF could not be made on this device.");
  }
}

function wire() {
  $("search").addEventListener("input", render);
  $("back").onclick = closeReader;
  $("chaptersBtn").onclick = () => { $("drawer").hidden = false; };
  $("drawer").addEventListener("click", (e) => { if (e.target === $("drawer")) $("drawer").hidden = true; });
  $("smaller").onclick = () => { prefs.fs = Math.max(0.95, +(prefs.fs - 0.1).toFixed(2)); applyPrefs(); savePrefs(); };
  $("larger").onclick = () => { prefs.fs = Math.min(1.8, +(prefs.fs + 0.1).toFixed(2)); applyPrefs(); savePrefs(); };
  $("theme").onclick = () => { prefs.night = !prefs.night; applyPrefs(); savePrefs(); };
  $("pdf").onclick = downloadPdf;
  window.addEventListener("hashchange", () => {
    if (location.hash !== "#read" && !$("reader").hidden) {
      $("reader").hidden = true;
      $("drawer").hidden = true;
      document.body.style.overflow = "";
      cur = null;
    }
  });
}

// ---- Install prompt (browser) / home-screen hint (iPhone) ----------------
(function () {
  const box = $("install");
  if (!box || IN_APP) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let dismissed = false;
  try { dismissed = localStorage.getItem("kh-install-dismissed") === "1"; } catch (e) { /* ignore */ }
  if (standalone || dismissed) return;
  let deferred = null;
  $("installClose").onclick = () => {
    box.hidden = true;
    try { localStorage.setItem("kh-install-dismissed", "1"); } catch (e) { /* ignore */ }
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    $("installBtn").hidden = false;
    box.hidden = false;
  });
  $("installBtn").onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) { /* ignore */ }
    deferred = null;
    box.hidden = true;
  };
  window.addEventListener("appinstalled", () => { box.hidden = true; });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    $("installBtn").hidden = true;
    $("installHint").textContent = "Tap the Share button, then \u201cAdd to Home Screen\u201d.";
    box.hidden = false;
  }
})();

init();
