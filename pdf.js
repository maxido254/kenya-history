// Makes a plain, readable PDF from a book's text. No libraries, works offline.
(function () {
  const W = 595, H = 842, M = 64, TEXT_W = W - 2 * M;

  // Times-Roman character widths (per 1000 units) for ASCII 32..126
  const WIDTHS = [
    250,333,408,500,500,833,778,333,333,333,500,564,250,333,250,278,
    500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,
    722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,
    333,278,333,469,500,333,
    444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,
    480,200,480,541
  ];
  const SPECIAL = { 0x91: 333, 0x92: 333, 0x93: 444, 0x94: 444, 0x96: 500, 0x97: 1000, 0x85: 1000, 0x95: 350 };
  const MAP = {
    "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94,
    "–": 0x96, "—": 0x97, "…": 0x85, "•": 0x95
  };

  // Convert text to WinAnsi byte codes. Letters outside it lose their accent.
  function codes(s) {
    const out = [];
    for (const ch of String(s).normalize("NFC")) {
      if (MAP[ch]) { out.push(MAP[ch]); continue; }
      const c = ch.charCodeAt(0);
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) { out.push(c); continue; }
      const base = ch.normalize("NFD").charCodeAt(0);
      out.push(base >= 32 && base <= 126 ? base : 63);
    }
    return out;
  }
  function cw(c) {
    if (c >= 32 && c <= 126) return WIDTHS[c - 32];
    return SPECIAL[c] || 500;
  }
  function esc(cs) {
    let s = "";
    for (const c of cs) {
      if (c === 40) s += "\\(";
      else if (c === 41) s += "\\)";
      else if (c === 92) s += "\\\\";
      else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0");
      else s += String.fromCharCode(c);
    }
    return s;
  }
  function width(cs, size, bold) {
    let w = 0;
    for (const c of cs) w += cw(c);
    return (w * size / 1000) * (bold ? 1.07 : 1);
  }
  function wrap(text, size, maxW, bold) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = [];
    let lineW = 0;
    const space = cw(32) * size / 1000;
    for (const word of words) {
      const wc = codes(word);
      const ww = width(wc, size, bold);
      if (line.length && lineW + space + ww > maxW) {
        lines.push(line);
        line = [wc];
        lineW = ww;
      } else {
        lineW += (line.length ? space : 0) + ww;
        line.push(wc);
      }
    }
    if (line.length) lines.push(line);
    return lines.map((ws) => {
      const all = [];
      ws.forEach((wc, i) => { if (i) all.push(32); all.push(...wc); });
      return all;
    });
  }

  function makePdf(book) {
    const pages = [];
    let ops = [];
    let y = H - M;

    function newPage() { if (ops.length) pages.push(ops); ops = []; y = H - M; }
    function put(cs, font, size, x, lead) {
      if (y - lead < M) newPage();
      y -= lead;
      ops.push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(cs)}) Tj ET`);
    }
    function block(text, font, size, lead, after, bold) {
      wrap(text, size, TEXT_W, bold).forEach((l) => put(l, font, size, M, lead));
      y -= after;
    }

    // Title page
    y = H - 230;
    block(book.title || "Untitled", "F2", 26, 32, 14, true);
    if (book.author) block(book.author, "F1", 14, 20, 30, false);
    if (book.rights) block(book.rights, "F1", 10, 14, 0, false);
    newPage();

    (book.chapters || []).forEach((c, i) => {
      newPage();
      y -= 20;
      put(codes("CHAPTER " + (i + 1)), "F1", 9, M, 12);
      block(c.title, "F2", 18, 24, 14, true);
      (c.paragraphs || []).forEach((p) => {
        if (p.startsWith("## ")) { y -= 6; block(p.slice(3), "F2", 12, 17, 4, true); }
        else block(p, "F1", 11, 16, 7, false);
      });
    });
    if (ops.length || !pages.length) pages.push(ops);

    // Page numbers
    pages.forEach((p, i) => {
      const cs = codes(String(i + 1));
      const x = (W - width(cs, 9, false)) / 2;
      p.push(`BT /F1 9 Tf ${x.toFixed(1)} 36 Td (${esc(cs)}) Tj ET`);
    });

    // Assemble the file
    const objs = [];
    objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
    const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ");
    objs[2] = `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`;
    objs[3] = "<</Type/Font/Subtype/Type1/BaseFont/Times-Roman/Encoding/WinAnsiEncoding>>";
    objs[4] = "<</Type/Font/Subtype/Type1/BaseFont/Times-Bold/Encoding/WinAnsiEncoding>>";
    pages.forEach((p, i) => {
      const content = p.join("\n");
      objs[5 + 2 * i] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${6 + 2 * i} 0 R>>`;
      objs[6 + 2 * i] = `<</Length ${content.length}>>\nstream\n${content}\nendstream`;
    });
    let out = "%PDF-1.4\n";
    const offsets = [];
    for (let n = 1; n < objs.length; n++) {
      offsets[n] = out.length;
      out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let n = 1; n < objs.length; n++) out += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<</Size ${objs.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }

  (typeof window !== "undefined" ? window : globalThis).makePdf = makePdf;
})();
