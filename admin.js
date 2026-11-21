const MAX = 6;
const TOPICS = ["Overview", "Pre-colonial and early history", "Colonial era", "Mau Mau",
  "Independence and post-independence", "Human rights and transitional justice", "Reference"];
const $ = (id) => document.getElementById(id);
const cardsEl = $("cards");

function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "book";
}

// A chapter starts at "Chapter ...", "Part ...", "Section ..." or a line beginning "# ".
// Lines starting "## " stay as sub-headings inside the chapter.
function toChapters(raw) {
  const text = raw.replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const chapters = [];
  let cur = null;
  const isHead = (b) => /^#\s+\S/.test(b) || (/^(chapter|part|section)\s+[\w.]+/i.test(b) && b.length < 90);
  for (const b of blocks) {
    if (isHead(b)) {
      cur = { title: b.replace(/^#\s+/, ""), paragraphs: [] };
      chapters.push(cur);
    } else {
      if (!cur) { cur = { title: "Introduction", paragraphs: [] }; chapters.push(cur); }
      cur.paragraphs.push(b);
    }
  }
  return chapters.filter((c) => c.paragraphs.length);
}

async function readPdf(file) {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  if (!window.pdfjsLib) {
    await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = base + "pdf.min.js";
      s.onload = ok;
      s.onerror = () => fail(new Error("Could not load the PDF reader. Check your internet connection, or paste the text instead."));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
  }
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    let lastY = null, line = "";
    const lines = [];
    for (const it of content.items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push({ t: line.trim(), y: lastY }); line = ""; }
      line += it.str + (it.hasEOL ? " " : "");
      lastY = y;
    }
    if (line.trim()) lines.push({ t: line.trim(), y: lastY });
    const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).sort((a, b) => a - b);
    const normal = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    lines.forEach((l, i) => {
      out += l.t + (i < lines.length - 1 && Math.abs(l.y - lines[i + 1].y) > normal * 1.5 ? "\n\n" : " ");
    });
    out += "\n\n";
  }
  return out;
}

// ---- Book cards ----------------------------------------------------------
function cards() { return Array.from(cardsEl.children); }

function refresh() {
  const list = cards();
  list.forEach((c, i) => { c.querySelector(".bk-num").textContent = `Book ${i + 1}`; });
  $("add").disabled = list.length >= MAX;
  $("count").textContent = `${list.length} of ${MAX} books`;
  $("make").disabled = list.length === 0;
}

async function loadFile(card, file) {
  const msg = card.querySelector(".card-warn");
  msg.textContent = "";
  try {
    const isPdf = /\.pdf$/i.test(file.name);
    card.querySelector(".f-text").value = isPdf ? await readPdf(file) : await file.text();
    const t = card.querySelector(".f-title");
    if (!t.value) t.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    if (isPdf) msg.textContent = "PDF text loaded. Check it: scanned pages and page numbers may need tidying.";
  } catch (err) {
    msg.textContent = err.message || "That file could not be read.";
  }
}

function addCard() {
  if (cards().length >= MAX) return null;
  const card = $("card-tpl").content.firstElementChild.cloneNode(true);
  const sel = card.querySelector(".f-topic");
  TOPICS.forEach((t) => { const o = document.createElement("option"); o.textContent = t; sel.appendChild(o); });
  card.querySelector(".rm").onclick = () => { card.remove(); refresh(); };
  card.querySelector(".f-file").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(card, e.target.files[0]); });
  cardsEl.appendChild(card);
  refresh();
  return card;
}

$("add").addEventListener("click", () => addCard());

$("many").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  const room = MAX - cards().length;
  $("msg").textContent = "";
  if (files.length > room) {
    $("msg").textContent = `Only ${MAX} books can be added at a time. The first ${room} file${room === 1 ? " was" : "s were"} added.`;
  }
  for (const f of files.slice(0, Math.max(room, 0))) {
    const card = addCard();
    if (card) await loadFile(card, f);
  }
  e.target.value = "";
});

// ---- Cover pictures ------------------------------------------------------
// Crops to a 2:3 book shape, 400x600, JPEG, so every cover is small and tidy.
async function coverBytes(file) {
  const bmp = await createImageBitmap(file);
  const W = 400, H = 600;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const s = Math.max(W / bmp.width, H / bmp.height);
  const w = bmp.width * s, h = bmp.height * s;
  g.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.85));
  return new Uint8Array(await blob.arrayBuffer());
}
const coverFile = (id) => `books/covers/${id}.jpg`;

// ---- Zip (store only, no compression) ------------------------------------
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => Uint8Array.of(v & 255, (v >>> 8) & 255);
  const u32 = (v) => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name);
    parts.push(local, f.data);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    offset += local.length + f.data.length;
  }
  const cd = cat(...central);
  const end = cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0));
  return new Blob([...parts, cd, end], { type: "application/zip" });
}

// ---- Make the files ------------------------------------------------------
let urls = [];
function link(name, blob, cls) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  urls.push(url);
  a.href = url; a.download = name; a.textContent = name; if (cls) a.className = cls;
  return a;
}
const jsonBlob = (data) => new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });

$("make").addEventListener("click", async () => {
  const msg = $("msg");
  msg.textContent = "";
  const problems = [];
  const books = [];
  cards().forEach((c, i) => {
    const v = (s) => c.querySelector(s).value.trim();
    const n = `Book ${i + 1}`;
    const title = v(".f-title"), from = v(".f-from"), terms = v(".f-license");
    if (!title) problems.push(`${n}: please enter the title.`);
    if (!from || !terms) problems.push(`${n}: please say who gave permission and the terms. The app hides books without them.`);
    const chapters = toChapters(c.querySelector(".f-text").value);
    if (!chapters.length) problems.push(`${n}: there is no book text yet.`);
    if (title && from && terms && chapters.length) books.push({ n, title, from, terms, chapters, c });
  });
  const ids = new Set();
  books.forEach((b) => {
    b.id = slug(b.title);
    if (ids.has(b.id)) problems.push(`${b.n}: another book in this batch has the same title.`);
    ids.add(b.id);
  });
  if (!cards().length) problems.push("Add at least one book.");
  if (problems.length) { msg.textContent = problems.join("\n"); return; }

  let list;
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    list = await res.json();
  } catch (e) {
    msg.textContent = "Could not read the current library list. Open this page from your live website, not from a saved file.";
    return;
  }

  const files = [];
  const enc = new TextEncoder();
  const lines = [];
  for (const b of books) {
    const v = (s) => b.c.querySelector(s).value.trim();
    const author = v(".f-author");
    const book = { title: b.title, author, rights: `Shared with permission from ${b.from}. ${b.terms}.`, chapters: b.chapters };
    const entry = {
      id: b.id, title: b.title, author, description: v(".f-desc"),
      topics: [b.c.querySelector(".f-topic").value], text: `books/${b.id}.json`,
      permission_from: b.from, license: b.terms, updated: new Date().toISOString()
    };
    const year = parseInt(v(".f-year"), 10);
    if (year) entry.year = year;
    const i = list.findIndex((x) => x.id === b.id);
    if (i >= 0 && list[i].cover) entry.cover = list[i].cover;
    const pic = b.c.querySelector(".f-cover").files[0];
    let coverNote = "";
    if (pic) {
      try {
        const data = await coverBytes(pic);
        files.push({ name: coverFile(b.id), data, blob: new Blob([data], { type: "image/jpeg" }) });
        entry.cover = coverFile(b.id) + "?v=" + Date.now();
        coverNote = " Cover added.";
      } catch (e) { coverNote = " The cover picture could not be read, so it was skipped."; }
    }
    if (i >= 0) list[i] = entry; else list.push(entry);
    files.push({ name: `books/${b.id}.json`, data: enc.encode(JSON.stringify(book, null, 2)), blob: jsonBlob(book) });
    const words = b.chapters.reduce((n, c) => n + c.paragraphs.join(" ").split(/\s+/).length, 0);
    let note = (i >= 0 ? " Replaces the existing entry." : "") + coverNote;
    if (b.chapters.length === 1 && words > 15000) note += " Warning: only one chapter was found. Add chapter headings so readers can move around.";
    lines.push(`${b.n}: "${b.title}" has ${b.chapters.length} chapter${b.chapters.length === 1 ? "" : "s"}, about ${words.toLocaleString()} words.${note}`);
  }
  files.push({ name: "books.json", data: enc.encode(JSON.stringify(list, null, 2)), blob: jsonBlob(list) });

  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const zipLink = $("dl-zip");
  zipLink.href = URL.createObjectURL(makeZip(files));
  urls.push(zipLink.href);
  zipLink.download = "african-history-upload.zip";
  const single = $("single");
  single.textContent = "";
  files.forEach((f) => single.appendChild(link(f.name.replace(/^books\//, ""), f.blob, "dl")));
  const sum = $("summary");
  sum.textContent = "";
  lines.forEach((t) => { const p = document.createElement("p"); p.textContent = t; sum.appendChild(p); });
  $("out").hidden = false;
  $("out").scrollIntoView({ behavior: "smooth" });
});

addCard();

// ---- Book pictures (all books on one list) ------------------------------
let covList = [];
$("loadCov").addEventListener("click", async () => {
  const msg = $("covMsg");
  msg.textContent = "";
  $("covOut").hidden = true;
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    covList = await res.json();
  } catch (e) {
    msg.textContent = "Could not read the current library list. Open this page from your live website, not from a saved file.";
    return;
  }
  const box = $("covList");
  box.textContent = "";
  covList.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "pick";
    const t = document.createElement("div");
    t.textContent = (b.title || b.id) + (b.cover ? "  (has a picture)" : "");
    const f = document.createElement("input");
    f.type = "file"; f.accept = "image/*"; f.dataset.i = String(i);
    row.append(t, f);
    box.appendChild(row);
  });
  $("makeCov").hidden = !covList.length;
  if (!covList.length) msg.textContent = "The library is empty.";
});

let covUrl = null;
$("makeCov").addEventListener("click", async () => {
  const msg = $("covMsg");
  msg.textContent = "";
  const picks = Array.from($("covList").querySelectorAll("input[type=file]")).filter((f) => f.files[0]);
  if (!picks.length) { msg.textContent = "Choose at least one picture."; return; }
  const files = [];
  const done = [];
  const bad = [];
  for (const f of picks) {
    const b = covList[parseInt(f.dataset.i, 10)];
    try {
      const data = await coverBytes(f.files[0]);
      files.push({ name: coverFile(b.id), data });
      b.cover = coverFile(b.id) + "?v=" + Date.now();
      done.push(b.title || b.id);
    } catch (e) { bad.push(b.title || b.id); }
  }
  if (!files.length) { msg.textContent = "Those pictures could not be read. Try JPG or PNG files."; return; }
  files.push({ name: "books.json", data: new TextEncoder().encode(JSON.stringify(covList, null, 2)) });
  if (covUrl) URL.revokeObjectURL(covUrl);
  covUrl = URL.createObjectURL(makeZip(files));
  const a = $("dl-cov");
  a.href = covUrl;
  a.download = "african-history-pictures.zip";
  $("covSummary").textContent = `Pictures ready for ${done.length} book${done.length === 1 ? "" : "s"}: ${done.join(", ")}.` + (bad.length ? ` Could not read: ${bad.join(", ")}.` : "");
  $("covOut").hidden = false;
  $("covOut").scrollIntoView({ behavior: "smooth" });
});

// ---- Remove books --------------------------------------------------------
let rmBooks = [];
let rmUrl = null;

function repoPath() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  return m ? { owner: m[1], repo: location.pathname.split("/")[1] || "kenya-history" } : { owner: "maxido254", repo: "kenya-history" };
}

$("loadList").addEventListener("click", async () => {
  const msg = $("rmMsg");
  msg.textContent = "";
  $("rmOut").hidden = true;
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    rmBooks = await res.json();
  } catch (e) {
    msg.textContent = "Could not read the current library list. Open this page from your live website, not from a saved file.";
    return;
  }
  const box = $("rmList");
  box.textContent = "";
  if (!rmBooks.length) { box.textContent = "The library is empty."; $("makeRm").hidden = true; return; }
  rmBooks.forEach((b, i) => {
    const label = document.createElement("label");
    label.className = "pick";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(i);
    const small = document.createElement("small");
    small.textContent = b.author ? "  " + b.author : "";
    label.append(cb, document.createTextNode(b.title || b.id), small);
    box.appendChild(label);
  });
  $("makeRm").hidden = false;
});

$("makeRm").addEventListener("click", () => {
  const msg = $("rmMsg");
  msg.textContent = "";
  const picked = Array.from($("rmList").querySelectorAll("input:checked")).map((c) => parseInt(c.value, 10));
  if (!picked.length) { msg.textContent = "Tick at least one book to remove."; return; }
  const removed = picked.map((i) => rmBooks[i]);
  const kept = rmBooks.filter((_, i) => !picked.includes(i));
  if (rmUrl) URL.revokeObjectURL(rmUrl);
  rmUrl = URL.createObjectURL(jsonBlob(kept));
  const a = $("dl-rm");
  a.href = rmUrl;
  a.download = "books.json";
  $("rmSummary").textContent = `Removing ${removed.length} book${removed.length === 1 ? "" : "s"}. ${kept.length} will stay in the library.`;
  const { owner, repo } = repoPath();
  const ul = $("rmLinks");
  ul.textContent = "";
  removed.forEach((b) => {
    const li = document.createElement("li");
    if (b.text) {
      const l = document.createElement("a");
      l.href = `https://github.com/${owner}/${repo}/delete/main/${b.text}`;
      l.target = "_blank";
      l.rel = "noopener";
      l.textContent = `Delete ${b.text}`;
      li.appendChild(l);
    } else {
      li.textContent = `${b.title}: no book file to delete.`;
    }
    ul.appendChild(li);
    if (b.cover) {
      const c = b.cover.split("?")[0];
      const li2 = document.createElement("li");
      const l2 = document.createElement("a");
      l2.href = `https://github.com/${owner}/${repo}/delete/main/${c}`;
      l2.target = "_blank";
      l2.rel = "noopener";
      l2.textContent = `Delete ${c}`;
      li2.appendChild(l2);
      ul.appendChild(li2);
    }
  });
  $("rmOut").hidden = false;
  $("rmOut").scrollIntoView({ behavior: "smooth" });
});
