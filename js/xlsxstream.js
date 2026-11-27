'use strict';
/* Streaming .xlsx reader for very large workbooks (millions of rows).
   The file is read from disk in slices, unzipped incrementally (fflate) and each
   worksheet's XML is parsed chunk by chunk, so no single string ever holds a whole
   sheet. Values are stored column by column. */

const XlsxStream = (() => {
  const SLICE = 4 * 1024 * 1024;
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unesc = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
  const colNum = letters => { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; };
  const AR = {};
  const attr = (s, name) => { const re = AR[name] || (AR[name] = new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '="([^"]*)"')); const m = re.exec(s); return m ? m[1] : null; };
  const textOf = inner => { let out = '', m; const re = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g; while ((m = re.exec(inner))) out += m[1]; return unesc(out); };
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  /** Incremental XML element scanner: feeds text, calls fn(block) for each complete <tag ...>...</tag> or <tag/> */
  function scanner(tag, fn) {
    let buf = '';
    const open = new RegExp(`<(?:\\w+:)?${tag}[\\s>/]`, 'g');
    const closeTag = new RegExp(`</(?:\\w+:)?${tag}>`, 'g');
    return {
      push(text, final) {
        buf += text;
        let pos = 0;
        for (;;) {
          open.lastIndex = pos;
          const o = open.exec(buf); if (!o) { pos = buf.length; break; }
          const gt = buf.indexOf('>', o.index); if (gt < 0) { pos = o.index; break; }
          if (buf[gt - 1] === '/') { fn(buf.slice(o.index, gt + 1), true); pos = gt + 1; continue; }
          closeTag.lastIndex = gt;
          const c = closeTag.exec(buf); if (!c) { pos = o.index; break; }
          fn(buf.slice(o.index, c.index + c[0].length), false);
          pos = c.index + c[0].length;
        }
        buf = buf.slice(pos);
        if (final) buf = '';
      },
    };
  }

  /** Per-sheet column store */
  function sheetStore() {
    return { cols: [], maxCol: -1, rows: new Set(), firstRow: Infinity, nf: [], ff: [], styles: [] };
  }
  function cellParser(store) {
    let lastRow = -1;
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    return scanner('row', (block) => {
      const head = block.slice(0, block.indexOf('>'));
      const rAttr = attr(head, 'r');
      const r = rAttr ? +rAttr - 1 : lastRow + 1; lastRow = r;
      let col = -1, m;
      cellRe.lastIndex = 0;
      while ((m = cellRe.exec(block))) {
        const at = m[1], inner = m[2] || '';
        const ref = attr(at, 'r');
        col = ref ? colNum(ref.replace(/\d+$/, '')) : col + 1;
        const t = attr(at, 't') || 'n';
        let v = null;
        if (t === 'inlineStr') v = textOf(inner);
        else {
          const vm = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
          if (vm) {
            const raw = vm[1];
            if (t === 's') v = { s: +raw };
            else if (t === 'n') v = raw === '' ? null : +raw;
            else if (t === 'b') v = raw === '1' ? 1 : 0;
            else if (t === 'e') v = null;
            else v = unesc(raw); // str, d
          }
        }
        const fm = /<(?:\w+:)?f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/.exec(inner);
        if (v === null && !fm) continue;
        let C = store.cols[col]; if (!C) C = store.cols[col] = [];
        C[r] = v;
        if (col > store.maxCol) store.maxCol = col;
        store.rows.add(r);
        if (r < store.firstRow) store.firstRow = r;
        if (fm) {
          store.nf[col] = (store.nf[col] || 0) + 1;
          if (fm[2] && (!store.ff[col] || store.ff[col].length < 3)) (store.ff[col] = store.ff[col] || []).push({ r, f: unesc(fm[2]) });
        }
        if (t === 'n' && v !== null && store.styles[col] === undefined) { const s = attr(at, 's'); if (s !== null) store.styles[col] = { r, s: +s }; }
      }
    });
  }

  function isDateFmt(id, fmts) {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
    const f = fmts.get(id); if (!f) return false;
    const clean = f.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(clean) && !/^[#0.,%E+\- ]+$/.test(clean);
  }
  const excelDate = (n, d1904) => {
    const ms = Math.round(((d1904 ? n + 1462 : n) - 25569) * 86400000);
    const d = new Date(ms); const p = x => String(x).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const tm = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : '';
    return date + tm;
  };

  async function read(file, onProgress = () => {}) {
    if (typeof fflate === 'undefined') throw new Error('The unzip library could not be loaded (it needs an internet connection the first time).');
    const sheets = new Map();      // path -> store
    const sst = [];
    let workbookXml = '', relsXml = '', stylesXml = '';
    const pending = [];
    const uz = new fflate.Unzip(f => {
      const name = f.name;
      let handler = null;
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        const store = sheetStore(); sheets.set(name, store);
        const p = cellParser(store); const dec = new TextDecoder();
        handler = (chunk, final) => p.push(dec.decode(chunk, { stream: !final }), final);
      } else if (/^xl\/sharedStrings\.xml$/i.test(name)) {
        const dec = new TextDecoder();
        const p = scanner('si', blk => { sst.push(textOf(blk)); });
        handler = (chunk, final) => p.push(dec.decode(chunk, { stream: !final }), final);
      } else if (/^xl\/workbook\.xml$/i.test(name)) { const dec = new TextDecoder(); handler = (c, fin) => { workbookXml += dec.decode(c, { stream: !fin }); }; }
      else if (/^xl\/_rels\/workbook\.xml\.rels$/i.test(name)) { const dec = new TextDecoder(); handler = (c, fin) => { relsXml += dec.decode(c, { stream: !fin }); }; }
      else if (/^xl\/styles\.xml$/i.test(name)) { const dec = new TextDecoder(); handler = (c, fin) => { stylesXml += dec.decode(c, { stream: !fin }); }; }
      if (!handler) return;
      f.ondata = (err, chunk, final) => { if (err) { pending.push(err); return; } try { handler(chunk, final); } catch (e) { pending.push(e); } };
      f.start();
    });
    uz.register(fflate.UnzipInflate);
    const size = file.size;
    for (let off = 0; off < size; off += SLICE) {
      const buf = new Uint8Array(await file.slice(off, Math.min(size, off + SLICE)).arrayBuffer());
      uz.push(buf, off + SLICE >= size);
      if (pending.length) throw pending[0];
      onProgress(Math.min(1, (off + SLICE) / size));
      await yieldUI();
    }
    if (!sheets.size) throw new Error('No worksheets found. Is this an .xlsx file?');
    // workbook: sheet names in order
    const rel = new Map(); let m; const relRe = /<Relationship\b([^>]*)\/?>/g;
    while ((m = relRe.exec(relsXml))) rel.set(attr(m[1], 'Id'), attr(m[1], 'Target'));
    const order = []; const shRe = /<(?:\w+:)?sheet\b([^>]*)\/?>/g;
    while ((m = shRe.exec(workbookXml))) {
      const id = attr(m[1], 'r:id') || attr(m[1], 'id'); let tgt = rel.get(id) || '';
      tgt = tgt.replace(/^\/?xl\//, '').replace(/^\//, ''); order.push({ name: unesc(attr(m[1], 'name') || 'Sheet'), path: 'xl/' + tgt });
    }
    if (!order.length) [...sheets.keys()].forEach((p, i) => order.push({ name: 'Sheet' + (i + 1), path: p }));
    const d1904 = /date1904="(1|true)"/.test(workbookXml);
    // styles: cellXfs numFmtId + custom numFmts
    const fmts = new Map(); const nfRe = /<(?:\w+:)?numFmt\b([^>]*)\/?>/g;
    while ((m = nfRe.exec(stylesXml))) fmts.set(+attr(m[1], 'numFmtId'), unesc(attr(m[1], 'formatCode') || ''));
    const xfs = []; const cx = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml);
    if (cx) { const xr = /<(?:\w+:)?xf\b([^>]*)/g; while ((m = xr.exec(cx[1]))) xfs.push(+(attr(m[1], 'numFmtId') || 0)); }
    return order.filter(o => sheets.has(o.path)).map(o => ({ name: o.name, store: sheets.get(o.path), sst, isDate: col => { const st = sheets.get(o.path).styles[col]; return st ? isDateFmt(xfs[st.s] ?? 0, fmts) : false; }, d1904 }));
  }

  /** Convert a parsed sheet into a DataTable (header = first non-empty row) */
  function toTable(sh, tableName) {
    const st = sh.store, sst = sh.sst;
    const t = new DataTable(tableName);
    if (st.maxCol < 0) return t;
    const hdr = st.firstRow;
    const bodyRows = [...st.rows].filter(r => r > hdr).sort((a, b) => a - b);
    const val = v => v && typeof v === 'object' ? (sst[v.s] ?? '') : v;
    for (let c = 0; c <= st.maxCol; c++) {
      const C = st.cols[c] || [];
      let name = C[hdr] !== undefined ? val(C[hdr]) : '';
      name = String(name ?? '').trim() || `Column ${c + 1}`;
      const n = bodyRows.length;
      let numeric = true, any = false;
      for (let i = 0; i < n; i++) { const v = C[bodyRows[i]]; if (v === undefined || v === null) continue; any = true; if (typeof v !== 'number') { const s = val(v); if (s === '' || s === '.' || s === 'NA') continue; numeric = false; break; } }
      numeric = numeric && any;
      const isDate = numeric && sh.isDate(c);
      let values;
      if (numeric && !isDate) { values = new Array(n); for (let i = 0; i < n; i++) { const v = C[bodyRows[i]]; values[i] = typeof v === 'number' ? v : NaN; } }
      else { values = new Array(n); for (let i = 0; i < n; i++) { const v = C[bodyRows[i]]; values[i] = v === undefined || v === null ? '' : typeof v === 'number' ? (isDate ? excelDate(v, sh.d1904) : String(v)) : String(val(v)); } }
      const dataType = numeric && !isDate ? 'numeric' : 'character';
      t.columns.push({ name: t.uniqueName(name), dataType, modelingType: dataType === 'numeric' ? 'continuous' : 'nominal', values, formula: null });
    }
    t.rows = Array.from({ length: bodyRows.length }, DataTable.newRow);
    // formula columns: every body cell holds a formula and the translated first formula reproduces the values
    const colsMap = new Map(t.columns.map((c, ci) => [ci, c.name]));
    const first = bodyRows[0] + 1, last = bodyRows[bodyRows.length - 1] + 1;
    let nf = 0;
    t.columns.forEach((c, ci) => {
      const cnt = st.nf[ci] || 0, ff = (st.ff[ci] || []).filter(x => x.r > hdr);
      if (!ff.length || cnt < bodyRows.length - 2) return;
      let done = false, lastF = ff[0].f;
      for (const cand of [...ff].reverse()) {
        const text = Excel.fromExcel(cand.f, colsMap, cand.r + 1, first, last);
        if (!text) continue;
        try {
          const fn = Formula.compile(t, text); let bad = 0;
          const ok = c.values.every((v, r) => {
            let x; try { x = fn(r); } catch (e) { x = NaN; } if (typeof x === 'boolean') x = +x;
            const xm = x === '' || (typeof x === 'number' && isNaN(x)), vm = v === '' || (typeof v === 'number' && isNaN(v));
            if (vm) return xm || ++bad <= bodyRows.length - cnt;
            if (typeof v === 'number') return typeof x === 'number' && Math.abs(x - v) <= 1e-9 * Math.max(1, Math.abs(v));
            return String(x) === String(v);
          });
          if (ok || /Random/.test(text)) { c.formula = text; nf++; done = true; break; }
        } catch (e) { /* try next */ }
        lastF = cand.f;
      }
      if (!done) t.notes = (t.notes || '') + `Column "${c.name}": formula kept as values (=${lastF}). `;
    });
    t.formulaCount = nf;
    return t;
  }

  return { read, toTable };
})();
