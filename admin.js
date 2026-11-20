const $ = (id) => document.getElementById(id);

function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "book";
}

// Turn plain text into chapters. A chapter starts at "Chapter ...", "Part ...",
// "Section ..." or a line beginning with "# ". Lines starting "## " stay as sub-headings.
function toChapters(raw) {
  const text = raw.replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const chapters = [];
  let cur = null;
  const isHead = (b) => /^#\s+\S/.test(b) || /^(chapter|part|section)\s+[\w.]+/i.test(b) && b.length < 90;
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
    let lastY = null;
    let line = "";
    const lines = [];
    for (const it of content.items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push({ t: line.trim(), y: lastY }); line = ""; }
      line += it.str + (it.hasEOL ? " " : "");
      lastY = y;
    }
    if (line.trim()) lines.push({ t: line.trim(), y: lastY });
    // A bigger gap between lines than usual marks a new paragraph
    const gaps = lines.slice(1).map((l, i) => Math.abs(lines[i].y - l.y)).sort((a, b) => a - b);
    const normal = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    lines.forEach((l, i) => {
      out += l.t + (i < lines.length - 1 && Math.abs(l.y - lines[i + 1].y) > normal * 1.5 ? "\n\n" : " ");
    });
    out += "\n\n";
  }
  return out;
}

$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("msg").textContent = "";
  try {
    $("text").value = /\.pdf$/i.test(f.name) ? await readPdf(f) : await f.text();
    if (!$("title").value) $("title").value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    if (/\.pdf$/i.test(f.name)) $("msg").textContent = "PDF text loaded. Check it below: scanned pages and page numbers may need tidying.";
  } catch (err) {
    $("msg").textContent = err.message || "That file could not be read.";
  }
});

function download(link, name, data) {
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  link.download = name;
}

$("make").addEventListener("click", async () => {
  const msg = $("msg");
  msg.textContent = "";
  const title = $("title").value.trim();
  const from = $("from").value.trim();
  const terms = $("license").value.trim();
  if (!title) return void (msg.textContent = "Please enter the title.");
  if (!from || !terms) return void (msg.textContent = "Please say who gave permission and the terms. The app hides books without them.");
  const chapters = toChapters($("text").value);
  if (!chapters.length) return void (msg.textContent = "There is no book text yet. Choose a file or paste the text.");

  const id = slug(title);
  const author = $("author").value.trim();
  const book = { title, author, rights: `Shared with permission from ${from}. ${terms}.`, chapters };
  const entry = {
    id, title, author,
    description: $("desc").value.trim(),
    topics: [$("topic").value],
    text: `books/${id}.json`,
    permission_from: from,
    license: terms
  };
  const year = parseInt($("year").value, 10);
  if (year) entry.year = year;

  let list = [];
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    if (res.ok) list = await res.json();
  } catch (e) {
    return void (msg.textContent = "Could not read the current library list. Open this page from your live website, not from a saved file.");
  }
  const i = list.findIndex((b) => b.id === id);
  if (i >= 0) list[i] = entry; else list.push(entry);

  download($("dl-book"), `${id}.json`, book);
  download($("dl-list"), "books.json", list);
  const words = chapters.reduce((n, c) => n + c.paragraphs.join(" ").split(/\s+/).length, 0);
  $("summary").textContent = `"${title}": ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}, about ${words.toLocaleString()} words. ${i >= 0 ? "This replaces the existing entry." : "This is a new entry."}`;
  $("out").hidden = false;
  $("out").scrollIntoView({ behavior: "smooth" });
});
