'use strict';
/* Data table model: columns, row states, formulas, import/export. */

const Formula = (() => {
  const colStat = (t, name, fn) => {
    const ci = t.colIndex(name); if (ci < 0) throw new Error('Unknown column ' + name);
    const vals = t.columns[ci].values.filter((v, r) => isNum(v) && !t.rows[r].exc);
    return fn(vals);
  };
  function helpers(t, ctx) {
    const H = {
      If(...a) { for (let i = 0; i + 1 < a.length; i += 2) if (a[i]) return a[i + 1]; return a.length % 2 ? a[a.length - 1] : NaN; },
      Log: Math.log, Log10: Math.log10, Exp: Math.exp, Sqrt: Math.sqrt, Abs: Math.abs, Floor: Math.floor, Ceiling: Math.ceil,
      Round(x, d = 0) { const f = 10 ** d; return Math.round(x * f) / f; },
      Power: Math.pow, Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Modulo: (a, b) => a % b,
      Row: () => ctx.r + 1, NRow: () => t.nrows, Pi: () => Math.PI,
      Mean: (...a) => S.mean(a.filter(isNum)), Sum: (...a) => S.sum(a.filter(isNum)),
      Min: (...a) => S.min(a.filter(isNum)), Max: (...a) => S.max(a.filter(isNum)),
      IsMissing: v => v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)),
      RandomNormal: (m = 0, s = 1) => m + s * Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random()),
      RandomUniform: (a = 0, b = 1) => a + (b - a) * Math.random(),
      RandomInteger: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
      ColMean: n => colStat(t, n, S.mean), ColStdDev: n => colStat(t, n, S.sd), ColSum: n => colStat(t, n, S.sum),
      ColMin: n => colStat(t, n, S.min), ColMax: n => colStat(t, n, S.max), ColNumber: n => colStat(t, n, a => a.length),
      ColMedian: n => colStat(t, n, S.median),
      Lag: (n, k = 1) => { const ci = t.colIndex(n); return ctx.r - k >= 0 ? t.columns[ci].values[ctx.r - k] : NaN; },
      Concat: (...a) => a.map(v => isNum(v) || typeof v === 'string' ? v : '').join(''),
      Char: v => String(v), Num: v => Number(v), Uppercase: s => String(s).toUpperCase(), Lowercase: s => String(s).toLowerCase(),
      Length: s => String(s).length, Substr: (s, i, n) => String(s).substr(i - 1, n), Contains: (s, x) => String(s).includes(x) ? 1 : 0,
    };
    // also accept spaced JMP-like names
    H['Random Normal'] = H.RandomNormal;
    return H;
  }
  /** Translate formula text to a JS expression */
  function translate(text) {
    let js = text;
    js = js.replace(/\b(Col\w+|Lag)\(\s*:\s*(?:"([^"]+)"|\{([^}]+)\}|([A-Za-z_\u0080-￿][\w\u0080-￿]*))/g,
      (m, f, a, b, c) => `${f}(${JSON.stringify(a || b || c)}`);
    js = js.replace(/:\s*"([^"]+)"|:\s*\{([^}]+)\}|:\s*([A-Za-z_\u0080-￿][\w\u0080-￿]*)/g,
      (m, a, b, c) => `__c(${JSON.stringify(a || b || c)})`);
    js = js.replace(/\^/g, '**');
    js = js.replace(/(?<![&])&(?![&])/g, '&&').replace(/(?<![|])\|(?![|])/g, '||');
    js = js.replace(/(?<![=!<>])=(?!=)/g, '==');
    return js;
  }
  function compile(t, text) {
    const js = translate(text);
    const ctx = { r: 0 };
    const H = helpers(t, ctx);
    // eslint-disable-next-line no-new-func
    const fn = new Function('__c', '__H', `with(__H){ return (${js}); }`);
    const getter = name => {
      const ci = t.colIndex(name); if (ci < 0) throw new Error('Unknown column: ' + name);
      const v = t.columns[ci].values[ctx.r];
      return v === '' ? (t.columns[ci].dataType === 'numeric' ? NaN : '') : v;
    };
    return r => { ctx.r = r; return fn(getter, H); };
  }
  return { compile, translate };
})();

class DataTable {
  constructor(name = 'Untitled') {
    this.id = ++DataTable._n;
    this.name = name;
    this.columns = [];
    this.rows = [];
    this.selCols = new Set();
    this.selCount = 0;
    this._ls = new Set();
    this.labelCol = null;
  }
  get nrows() { return this.rows.length; }
  static newRow() { return { sel: false, exc: false, hid: false, lab: false, color: null }; }

  on(fn) { this._ls.add(fn); return () => this._ls.delete(fn); }
  emit(kind = 'data') {
    if (kind === 'data' || kind === 'structure') this.recalc();
    this.selCount = this.rows.reduce((s, r) => s + (r.sel ? 1 : 0), 0);
    for (const f of [...this._ls]) { try { f(kind); } catch (e) { console.error(e); } }
  }

  colIndex(name) {
    if (typeof name === 'number') return name;
    let i = this.columns.findIndex(c => c.name === name);
    if (i < 0) i = this.columns.findIndex(c => c.name.toLowerCase() === String(name).toLowerCase());
    return i;
  }
  col(name) { return this.columns[this.colIndex(name)]; }
  uniqueName(base) {
    let name = base, k = 2;
    while (this.columns.some(c => c.name === name)) name = `${base} ${k++}`;
    return name;
  }
  static missing(dataType) { return dataType === 'numeric' ? NaN : ''; }
  static isMissing(v) { return v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)); }

  addColumn({ name = 'Column', dataType = 'numeric', modelingType, values, formula = null, at } = {}) {
    modelingType = modelingType || (dataType === 'numeric' ? 'continuous' : 'nominal');
    const vals = values ? [...values] : [];
    while (vals.length < this.nrows) vals.push(DataTable.missing(dataType));
    vals.length = Math.max(vals.length, this.nrows);
    if (vals.length > this.nrows) this.addRowsRaw(vals.length - this.nrows);
    const col = { name: this.uniqueName(name), dataType, modelingType, values: vals, formula };
    if (at === undefined) this.columns.push(col); else this.columns.splice(at, 0, col);
    return col;
  }
  addRowsRaw(n) {
    for (let i = 0; i < n; i++) {
      this.rows.push(DataTable.newRow());
      for (const c of this.columns) if (c.values.length < this.rows.length) c.values.push(DataTable.missing(c.dataType));
    }
  }
  addRows(n, at) {
    if (at === undefined || at >= this.nrows) { this.addRowsRaw(n); }
    else {
      this.rows = [...this.rows.slice(0, at), ...Array.from({ length: n }, DataTable.newRow), ...this.rows.slice(at)];
      for (const c of this.columns) c.values = [...c.values.slice(0, at), ...Array.from({ length: n }, () => DataTable.missing(c.dataType)), ...c.values.slice(at)];
    }
  }
  deleteRows(idx) {
    const del = new Set(idx);
    const keep = [...this.rows.keys()].filter(i => !del.has(i));
    this.rows = keep.map(i => this.rows[i]);
    for (const c of this.columns) c.values = keep.map(i => c.values[i]);
  }
  deleteColumns(idx) {
    const del = new Set(idx);
    this.columns = this.columns.filter((_, i) => !del.has(i));
    this.selCols.clear();
  }
  parseValue(col, text) {
    if (col.dataType === 'numeric') {
      if (typeof text === 'number') return text;
      const s = String(text).trim();
      if (s === '' || s === '.' || s === '•') return NaN;
      const v = Number(s.replace(/,/g, ''));
      return isNaN(v) ? NaN : v;
    }
    return text === null || text === undefined ? '' : String(text);
  }
  setCell(r, c, text) {
    const col = this.columns[c];
    if (r >= this.nrows) this.addRowsRaw(r - this.nrows + 1);
    col.values[r] = this.parseValue(col, text);
  }
  setDataType(ci, dt) {
    const col = this.columns[ci]; if (col.dataType === dt) return;
    col.dataType = dt;
    col.values = col.values.map(v => dt === 'numeric' ? this.parseValue(col, v) : (DataTable.isMissing(v) ? '' : String(v)));
    if (dt === 'character' && col.modelingType === 'continuous') col.modelingType = 'nominal';
  }
  /** Sorted unique non-missing levels for a column over rows */
  levels(ci, rows) {
    const col = this.columns[ci]; const set = new Map();
    const it = rows || this.rows.keys();
    for (const r of it) { const v = col.values[r]; if (!DataTable.isMissing(v)) set.set(String(v), v); }
    const vals = [...set.values()];
    if (col.levelOrder) {
      const ord = col.levelOrder.map(String);
      return vals.sort((a, b) => { const ia = ord.indexOf(String(a)), ib = ord.indexOf(String(b)); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || String(a).localeCompare(String(b)); });
    }
    return col.dataType === 'numeric' ? vals.sort((a, b) => a - b) : vals.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }
  analysisRows() { const out = []; for (let i = 0; i < this.nrows; i++) if (!this.rows[i].exc) out.push(i); return out; }
  selectedRows() { const out = []; for (let i = 0; i < this.nrows; i++) if (this.rows[i].sel) out.push(i); return out; }
  /** Rows (from given list) with no missing values in any of cis */
  complete(cis, rows = this.analysisRows()) {
    return rows.filter(r => cis.every(ci => !DataTable.isMissing(this.columns[ci].values[r])));
  }
  vals(ci, rows) { const v = this.columns[ci].values; return rows.map(r => v[r]); }
  isCat(ci) { return this.columns[ci].modelingType !== 'continuous'; }

  select(rows, mode = 'replace') {
    if (mode === 'replace') for (const s of this.rows) s.sel = false;
    for (const r of rows) {
      const s = this.rows[r]; if (!s) continue;
      if (mode === 'toggle') s.sel = !s.sel; else if (mode === 'deselect') s.sel = false; else s.sel = true;
    }
    this.emit('select');
  }
  labelValue(r) {
    let ci = this.labelCol !== null ? this.labelCol : this.columns.findIndex(c => c.dataType === 'character');
    if (ci < 0) return String(r + 1);
    return String(this.columns[ci].values[r]);
  }

  recalc() {
    for (const col of this.columns) {
      if (!col.formula) continue;
      try {
        const f = Formula.compile(this, col.formula);
        for (let r = 0; r < this.nrows; r++) {
          let v;
          try { v = f(r); } catch (e) { v = NaN; }
          if (col.dataType === 'numeric') v = typeof v === 'boolean' ? +v : (typeof v === 'number' ? v : this.parseValue(col, v));
          else v = DataTable.isMissing(v) ? '' : String(v);
          col.values[r] = v;
        }
        col.formulaError = null;
      } catch (e) { col.formulaError = e.message; }
    }
  }

  clone(name, rowIdx, colIdx) {
    const t = new DataTable(name || this.name + ' Copy');
    const rows = rowIdx || [...this.rows.keys()];
    const cols = colIdx || [...this.columns.keys()];
    for (const ci of cols) {
      const c = this.columns[ci];
      t.columns.push({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: rows.map(r => c.values[r]), formula: null, levelOrder: c.levelOrder });
    }
    t.rows = rows.map(r => ({ ...this.rows[r], sel: false }));
    return t;
  }

  toCSV(sep = ',') {
    const q = v => {
      const s = DataTable.isMissing(v) ? '' : String(v);
      return /[",\n\t;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [this.columns.map(c => q(c.name)).join(sep)];
    for (let r = 0; r < this.nrows; r++) lines.push(this.columns.map(c => q(c.values[r])).join(sep));
    return lines.join('\n');
  }
  toJSON() {
    return { name: this.name, columns: this.columns.map(c => ({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, formula: c.formula, levelOrder: c.levelOrder, values: c.values.map(v => typeof v === 'number' && isNaN(v) ? null : v) })), rows: this.rows };
  }
  static fromJSON(o) {
    const t = new DataTable(o.name);
    for (const c of o.columns) t.columns.push({ ...c, values: c.values.map(v => v === null && c.dataType === 'numeric' ? NaN : v) });
    t.rows = o.rows ? o.rows.map(r => ({ ...DataTable.newRow(), ...r })) : (t.columns[0]?.values || []).map(DataTable.newRow);
    t.recalc();
    return t;
  }

  static parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const counts = { ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length, ';': (first.match(/;/g) || []).length };
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  static fromCSV(text, name = 'Imported') {
    return DataTable.fromRows(DataTable.parseDelimited(text), name);
  }
  /** Build a table from a header row + body rows. Cells may be strings, numbers, booleans or Dates. */
  static fromRows(rows, name = 'Imported') {
    const t = new DataTable(name);
    rows = rows.filter(r => r && r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
    if (!rows.length) return t;
    const pad = n => String(n).padStart(2, '0');
    const cell = v => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return isNaN(v) ? '' : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` + (v.getHours() || v.getMinutes() || v.getSeconds() ? ` ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}` : '');
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    };
    const header = rows[0].map(cell), body = rows.slice(1).map(r => r.map(cell));
    let ncol = 0; for (const r of rows) if (r.length > ncol) ncol = r.length;
    const isMiss = v => v === '' || v === '.' || v === 'NA' || (typeof v === 'number' && isNaN(v));
    const asNum = v => typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
    for (let c = 0; c < ncol; c++) {
      const raw = body.map(r => { const v = r[c] ?? ''; return typeof v === 'string' ? v.trim() : v; });
      const nonEmpty = raw.filter(v => !isMiss(v));
      const numeric = nonEmpty.length > 0 && nonEmpty.every(v => !isNaN(asNum(v)));
      const values = numeric ? raw.map(v => isMiss(v) ? NaN : asNum(v)) : raw.map(v => isMiss(v) && v !== '.' && v !== 'NA' ? '' : String(v));
      const hn = String(header[c] ?? '').trim() || `Column ${c + 1}`;
      t.columns.push({ name: t.uniqueName(hn), dataType: numeric ? 'numeric' : 'character', modelingType: numeric ? 'continuous' : 'nominal', values, formula: null });
    }
    t.rows = body.map(DataTable.newRow);
    return t;
  }
}
DataTable._n = 0;
