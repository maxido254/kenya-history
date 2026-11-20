const $ = (id) => document.getElementById(id);
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
    const res = await fetch("books.json", { cache: "no-cache" });
    // Only books that can be read inside the app are listed
    books = (await res.json()).filter((b) => b.permission_from && b.license && b.text);
  } catch (e) {
    $("status").textContent = "The library could not be loaded. Check your connection.";
    return;
  }
  buildFilters();
  render();
  wire();
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
  return m.year ? String(m.year) : "Read · Download PDF";
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
    const res = await fetch(m.text);
    if (!res.ok) throw new Error("bad response");
    data = await res.json();
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

init();
