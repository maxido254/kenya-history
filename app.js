const CACHE_BOOKS = "kh-books-v1";
let books = [];
const $ = (id) => document.getElementById(id);

async function init() {
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    books = (await res.json()).filter((b) => b.permission_from && b.license);
  } catch (e) {
    $("status").textContent = "Could not load the catalog. Check your connection.";
    return;
  }
  const topics = [...new Set(books.flatMap((b) => b.topics || []))].sort();
  topics.forEach((t) => {
    const o = document.createElement("option");
    o.value = t; o.textContent = t;
    $("topic").appendChild(o);
  });
  ["search", "topic", "savedOnly"].forEach((id) => $(id).addEventListener("input", render));
  $("closeReader").addEventListener("click", closeReader);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  render();
}

async function isSaved(file) {
  if (!file || !("caches" in window)) return false;
  const c = await caches.open(CACHE_BOOKS);
  return !!(await c.match(file));
}

async function render() {
  const q = $("search").value.trim().toLowerCase();
  const topic = $("topic").value;
  const savedOnly = $("savedOnly").checked;
  const grid = $("grid");
  grid.innerHTML = "";
  let shown = 0;

  for (const b of books) {
    const hay = [b.title, b.author, b.description, ...(b.topics || [])].join(" ").toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (topic && !(b.topics || []).includes(topic)) continue;
    const saved = await isSaved(b.file);
    if (savedOnly && !saved) continue;
    grid.appendChild(card(b, saved));
    shown++;
  }
  $("status").textContent = books.length
    ? `${shown} of ${books.length} book${books.length === 1 ? "" : "s"}`
    : "No books yet. Add entries to books.json (see README).";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function card(b, saved) {
  const c = el("article", "card");
  c.appendChild(el("h2", "", b.title));
  c.appendChild(el("div", "meta", [b.author, b.year].filter(Boolean).join(" · ")));
  c.appendChild(el("p", "desc", b.description || ""));
  const tags = el("div", "tags");
  (b.topics || []).forEach((t) => tags.appendChild(el("span", "tag", t)));
  c.appendChild(tags);
  c.appendChild(el("div", "permission", `Shared with permission from ${b.permission_from} · ${b.license}`));

  const actions = el("div", "actions");
  if (!b.file && b.link) {
    // Free copy hosted by the rights holder or an open-access library
    const open = el("a", "btn", "Open free copy ↗");
    open.href = b.link;
    open.target = "_blank";
    open.rel = "noopener";
    actions.append(open);
  } else {
    const read = el("button", "", "Read");
    read.onclick = () => openReader(b);
    const save = el("button", "secondary", saved ? "Saved offline ✓" : "Save offline");
    save.onclick = async () => {
      save.disabled = true;
      save.textContent = saved ? "Removing..." : "Saving...";
      try {
        const cache = await caches.open(CACHE_BOOKS);
        if (saved) await cache.delete(b.file);
        else await cache.add(b.file);
      } catch (e) {
        alert("Could not save this book offline.");
      }
      render();
    };
    actions.append(read, save);
  }
  c.appendChild(actions);
  return c;
}

let blobUrl = null;
async function openReader(b) {
  $("readerTitle").textContent = b.title;
  let url = b.file;
  try {
    const cache = await caches.open(CACHE_BOOKS);
    const hit = await cache.match(b.file);
    if (hit) {
      blobUrl = URL.createObjectURL(await hit.blob());
      url = blobUrl;
    }
  } catch (e) { /* fall back to network */ }
  $("readerFrame").src = url;
  $("downloadLink").href = url;
  $("downloadLink").setAttribute("download", b.file.split("/").pop());
  $("reader").hidden = false;
}

function closeReader() {
  $("reader").hidden = true;
  $("readerFrame").src = "about:blank";
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
}

init();
