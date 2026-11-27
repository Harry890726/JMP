'use strict';
/* Report windows: outline nodes with disclosure triangles, hotspot (red triangle) menus,
   report tables, linked row selection and brushing. */

const Platforms = {};

class Ctx {
  constructor(report) {
    this.rep = report; this.t = report.t; this.spec = report.spec; this.opts = report.opts;
    this.menus = {}; this.rows = report.t.analysisRows(); this._n = 0;
    const by = report.spec.by;
    if (by) { const v = report.t.columns[by.ci].values; this.rows = this.rows.filter(r => String(v[r]) === by.level); }
    this.baseRows = this.rows;
    if (report.ldf && report.ldf.conds.length) this.rows = LDF.apply(report.t, report.ldf, this.rows);
  }
  opt(k, d) { return k in this.opts ? this.opts[k] : d; }
  set(k, v) { this.opts[k] = v; }
  /** Menu item that toggles a boolean option */
  check(label, k, d = false, extra = {}) {
    return { label, checked: this.opt(k, d), action: () => { this.rep.opts[k] = !this.opt(k, d); this.rep.render(); }, ...extra };
  }
  act(label, fn, extra = {}) { return { label, action: () => { const r = fn(); if (r !== false) this.rep.render(); }, ...extra }; }
  hot(items) { const id = 'm' + (++this._n); this.menus[id] = items; return `<span class="hot" data-menu="${id}" title="Options"></span>`; }
  outline(title, content, { menu, key, closed = false, cls = '' } = {}) {
    key = key || title;
    const isClosed = this.rep.closed.has(key) ? true : this.rep.open.has(key) ? false : closed;
    return `<div class="ol ${isClosed ? 'closed' : ''} ${cls}" data-key="${esc(key)}"><div class="ol-h"><span class="tri"></span>${menu ? this.hot(menu) : ''}<span class="ol-t">${title}</span></div><div class="ol-b">${content}</div></div>`;
  }
  /** Report table. cols: [{h, a}] or strings; rows: arrays of cells */
  table(cols, rows, { cls = '', title } = {}) {
    cols = cols.map(c => typeof c === 'string' ? { h: c } : c);
    const cell = (v, i) => {
      const c = cols[i] || {};
      if (v && typeof v === 'object') {
        if ('p' in v) return `<td class="n">${fmtP(v.p)}</td>`;
        if ('h' in v) return `<td class="${v.c || ''}">${v.h}</td>`;
      }
      if (typeof v === 'number') return `<td class="n">${c.d !== undefined && isNum(v) ? v.toFixed(c.d) : fmt(v)}</td>`;
      return `<td class="${c.a === 'r' ? 'n' : ''}">${esc(v ?? '')}</td>`;
    };
    return `<table class="rt ${cls}">${title ? `<caption>${title}</caption>` : ''}<thead><tr>${cols.map(c => `<th class="${c.a === 'l' ? 'l' : ''}">${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="${r.cls || ''}">${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
  }
  /** 2-column key/value table */
  kv(pairs, cls = '') { return `<table class="rt kv ${cls}"><tbody>${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${typeof v === 'number' ? fmt(v) : v}</td></tr>`).join('')}</tbody></table>`; }
  cn(i) { return this.t.columns[i].name; }
  note(s) { return `<div class="note">${s}</div>`; }
}

class Report {
  constructor(table, platform, spec, opts = {}) {
    this.t = table; this.pname = platform; this.platform = Platforms[platform]; this.spec = spec;
    this.opts = { ...(this.platform.defaults || {}), ...opts }; this.closed = new Set(); this.open = new Set(); this.menus = {};
    const title = `${table.name} - ${this.platform.title(spec, table)}${spec.by ? ` (${spec.by.label})` : ''}`;
    this.win = WM.create({ title, kind: 'report', table, w: this.platform.w || 720, h: this.platform.h || 560, icon: ICONS.report, onFocus: () => App.setActive(table), onClose: () => this.dispose() });
    this.win.report = this;
    this.body = this.win.body; this.body.classList.add('report');
    this.unsub = table.on(kind => { if (this._rt) return; this._rt = requestAnimationFrame(() => { this._rt = null; this.render(); }); });
    this.bind();
    this.render();
    App.reports.push(this);
  }
  dispose() { this.unsub(); App.reports = App.reports.filter(r => r !== this); }
  render() {
    const st = this.body.scrollTop, sl = this.body.scrollLeft;
    const ctx = new Ctx(this);
    let html;
    try { html = this.platform.render(ctx); }
    catch (e) { console.error(e); html = `<div class="err">Error in analysis: ${esc(e.message)}</div>`; }
    if (this.t.nrows > POINT_LIMIT && /class="pt/.test(html)) html = `<div class="note small">Large table: graphs show a sample of about ${POINT_LIMIT.toLocaleString()} of ${this.t.nrows.toLocaleString()} points (selected rows always shown). All statistics use every row.</div>` + html;
    if (this.ldf) html = `<div class="ldf-wrap">${LDF.html(this, ctx)}<div class="ldf-main">${html}</div></div>`;
    this.menus = ctx.menus;
    this.body.innerHTML = html;
    // common items appended to the report's first (top-level) red triangle
    const top = this.body.querySelector('.ldf-main .hot, .hot:not(.ldf .hot)');
    if (top && this.menus[top.dataset.menu]) this.menus[top.dataset.menu] = [...this.menus[top.dataset.menu], '-', ...this.commonMenu()];
    this.body.scrollTop = st; this.body.scrollLeft = sl;
    if (this.platform.after) this.platform.after(this);
  }
  commonMenu() {
    const pf = this.platform;
    return [
      { label: 'Local Data Filter', checked: !!this.ldf, action: () => { if (this.ldf) this.ldf = null; else { this.ldf = { conds: [] }; LDF.addDialog(this); } this.render(); } },
      { label: 'Redo', submenu: [{ label: 'Redo Analysis', action: () => this.render() }, { label: 'Relaunch Analysis', disabled: !pf.launch, action: () => pf.launch(this.t) }] },
      { label: 'Save Script', submenu: [
        { label: 'To Script Window', disabled: !pf.toJSL, action: () => ScriptWin.open(this.win.title + '.jsl', pf.toJSL(this)) },
        { label: 'To Clipboard', disabled: !pf.toJSL, action: () => { try { navigator.clipboard.writeText(pf.toJSL(this)).then(() => status('Script copied'), () => ScriptWin.open('script.jsl', pf.toJSL(this))); } catch (e) { ScriptWin.open('script.jsl', pf.toJSL(this)); } } },
      ] },
    ];
  }
  bind() {
    const b = this.body;
    b.addEventListener('change', e => { const x = e.target.closest('[data-ldf]'); if (x && this.ldf) LDF.onChange(this, x); });
    b.addEventListener('input', e => { const x = e.target.closest('[data-ldf="q"]'); if (x && this.ldf) { clearTimeout(this._ldfq); this._ldfq = setTimeout(() => LDF.onChange(this, x), 300); } });
    b.addEventListener('click', e => {
      const hot = e.target.closest('.hot');
      if (hot) { const items = this.menus[hot.dataset.menu]; if (items) { const r = hot.getBoundingClientRect(); UI.menu(items, r.left, r.bottom + 1); } return; }
      const lx = e.target.closest('[data-ldf]');
      if (lx && this.ldf && e.type === 'click' && !lx.matches('input,select')) { LDF.onClick(this, lx, e); return; }
      const h = e.target.closest('.ol-h');
      if (h) {
        const ol = h.parentElement, key = ol.dataset.key;
        ol.classList.toggle('closed');
        if (ol.classList.contains('closed')) { this.closed.add(key); this.open.delete(key); } else { this.closed.delete(key); this.open.add(key); }
        return;
      }
      const act = e.target.closest('[data-action]');
      if (act && this.platform.actions && this.platform.actions[act.dataset.action]) { this.platform.actions[act.dataset.action](this, act, e); return; }
      if (this._brushed) { this._brushed = false; return; }
      const dr = e.target.closest('[data-rows]');
      if (dr) {
        const rows = dr.dataset.rows.split(',').filter(x => x !== '').map(Number);
        this.t.select(rows, e.shiftKey ? 'extend' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace');
        return;
      }
      if (e.target.closest('svg.plot') && this.t.selCount) this.t.select([], 'replace');
    });
    // brushing: drag a rectangle on a plot to select points
    b.addEventListener('pointerdown', e => {
      const svg = e.target.closest('svg.plot');
      if (!svg || e.button !== 0 || e.target.closest('[data-rows]') || e.target.closest('[data-action]')) return;
      const ctm = svg.getScreenCTM(); if (!ctm) return;
      const inv = ctm.inverse();
      const toSvg = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(inv); };
      const p0 = toSvg(e); let rect = null, moved = false;
      const move = ev => {
        const p = toSvg(ev);
        if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
        moved = true;
        if (!rect) { rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.setAttribute('class', 'brush'); svg.appendChild(rect); }
        rect.setAttribute('x', Math.min(p.x, p0.x)); rect.setAttribute('y', Math.min(p.y, p0.y));
        rect.setAttribute('width', Math.abs(p.x - p0.x)); rect.setAttribute('height', Math.abs(p.y - p0.y));
      };
      const up = ev => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!moved) return;
        const p = toSvg(ev);
        const x0 = Math.min(p.x, p0.x), x1 = Math.max(p.x, p0.x), y0 = Math.min(p.y, p0.y), y1 = Math.max(p.y, p0.y);
        const rows = [];
        svg.querySelectorAll('circle[data-rows]').forEach(c => {
          const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
          if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) for (const x of c.dataset.rows.split(',')) rows.push(Number(x));
        });
        this._brushed = true;
        setTimeout(() => { this._brushed = false; }, 50);
        this.t.select(rows, ev.shiftKey ? 'extend' : 'replace');
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }
}

/** Helper used by report-to-table "Save" actions */
function saveColumn(t, name, values, formula = null, dataType = 'numeric') {
  const col = t.addColumn({ name, dataType, values, formula });
  t.emit('structure');
  status(`Saved new column "${col.name}"`);
  return col;
}

/* ---------------- Local Data Filter (per report) ---------------- */
const LDF = {
  apply(t, f, rows) {
    const conds = f.conds.map(c => ({ c, v: t.columns[t.colIndex(c.name)]?.values })).filter(x => x.v);
    return rows.filter(r => conds.every(({ c, v }) => {
      const x = v[r];
      if (c.type === 'range') return isNum(x) && x >= c.lo && x <= c.hi;
      return !c.sel.length || c.sel.includes(String(x));
    }));
  },
  newCond(t, ci, rows) {
    const col = t.columns[ci];
    if (t.isCat(ci) || col.dataType !== 'numeric') return { name: col.name, type: 'levels', sel: [], q: '' };
    let lo = Infinity, hi = -Infinity; for (const r of rows) { const v = col.values[r]; if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    return { name: col.name, type: 'range', lo, hi, min: lo, max: hi };
  },
  addDialog(rep) {
    const t = rep.t;
    const content = el(`<div><div class="small mut">Choose columns to filter on, then click Add.</div><div class="rp-cols" style="max-height:300px">${t.columns.map((c, i) => `<label class="fchk"><input type="checkbox" value="${i}"> ${typeIcon(c.modelingType)} ${esc(c.name)}</label>`).join('')}</div></div>`);
    UI.dialog({ title: 'Local Data Filter', width: 380, content, buttons: [{ label: 'Add', primary: true, onClick: b => $$('input:checked', b).map(i => +i.value) }, { label: 'Cancel', value: null }] }).then(cis => {
      if (!cis || !cis.length) { if (rep.ldf && !rep.ldf.conds.length) { /* keep empty panel */ } return; }
      const base = new Ctx(rep).baseRows;
      for (const ci of cis) if (!rep.ldf.conds.some(c => c.name === t.columns[ci].name)) rep.ldf.conds.push(LDF.newCond(t, ci, base));
      rep.render();
    });
  },
  html(rep, ctx) {
    const t = rep.t, f = rep.ldf;
    const conds = f.conds.map((c, i) => {
      const ci = t.colIndex(c.name); if (ci < 0) return '';
      const col = t.columns[ci];
      let body = '';
      if (c.type === 'range') {
        const step = (c.max - c.min) / 1000 || 1;
        body = `<div class="ldf-rng"><input type="number" step="any" data-ldf="lo" data-i="${i}" value="${+c.lo.toPrecision(8)}"><span>≤ x ≤</span><input type="number" step="any" data-ldf="hi" data-i="${i}" value="${+c.hi.toPrecision(8)}"></div>
          <input type="range" class="ldf-sl" data-ldf="slo" data-i="${i}" min="${c.min}" max="${c.max}" step="${step}" value="${c.lo}"><input type="range" class="ldf-sl" data-ldf="shi" data-i="${i}" min="${c.min}" max="${c.max}" step="${step}" value="${c.hi}">`;
      } else {
        const cnt = new Map(); for (const r of ctx.baseRows) { const k = String(col.values[r]); if (k !== '' && k !== 'NaN') cnt.set(k, (cnt.get(k) || 0) + 1); }
        let lv = t.levels(ci, ctx.baseRows).map(String);
        const q = (c.q || '').toLowerCase(); if (q) lv = lv.filter(l => l.toLowerCase().includes(q));
        const shown = lv.slice(0, 300);
        body = `${t.levels(ci, ctx.baseRows).length > 12 ? `<input class="ldf-q" placeholder="Search levels" data-ldf="q" data-i="${i}" value="${esc(c.q || '')}">` : ''}
          <div class="ldf-lv">${shown.map(l => `<div class="ldf-l ${c.sel.includes(l) ? 'on' : ''}" data-ldf="lv" data-i="${i}" data-v="${esc(l)}"><span>${esc(l)}</span><span class="mut">${(cnt.get(l) || 0).toLocaleString()}</span></div>`).join('')}${lv.length > shown.length ? `<div class="mut small">${(lv.length - shown.length).toLocaleString()} more — type to search</div>` : ''}</div>
          ${c.sel.length ? `<div class="small"><a href="#" data-ldf="none" data-i="${i}">Clear selection (${c.sel.length})</a></div>` : '<div class="small mut">Click levels to include (none = all)</div>'}`;
      }
      return `<div class="ldf-c"><div class="ldf-ch">${typeIcon(col.modelingType)}<b>${esc(c.name)}</b><button class="ldf-x" data-ldf="rm" data-i="${i}" title="Remove">✕</button></div>${body}</div>`;
    }).join('');
    const menu = ctx.hot([{ label: 'Clear', action: () => { f.conds.forEach(c => { if (c.type === 'range') { c.lo = c.min; c.hi = c.max; } else { c.sel = []; c.q = ''; } }); rep.render(); } },
      { label: 'Add Filter Columns...', action: () => LDF.addDialog(rep) }, '-', { label: 'Remove Local Data Filter', action: () => { rep.ldf = null; rep.render(); } },
      { label: 'Select Matching Rows in Table', action: () => rep.t.select(ctx.rows) }]);
    return `<div class="ldf"><div class="ldf-h">${menu}<span>Local Data Filter</span></div>
      <div class="ldf-n small"><b>${ctx.rows.length.toLocaleString()}</b> of ${ctx.baseRows.length.toLocaleString()} rows match</div>
      ${conds || '<div class="small mut" style="padding:6px">No filter columns yet.</div>'}
      <button class="btn sm" data-ldf="add">+ Add Filter Columns</button></div>`;
  },
  onClick(rep, x, e) {
    const f = rep.ldf, i = +x.dataset.i, c = f.conds[i], a = x.dataset.ldf;
    if (a === 'add') return LDF.addDialog(rep);
    if (a === 'rm') { f.conds.splice(i, 1); return rep.render(); }
    if (a === 'none') { e.preventDefault(); c.sel = []; return rep.render(); }
    if (a === 'lv') {
      const v = x.dataset.v, k = c.sel.indexOf(v);
      if (e.ctrlKey || e.metaKey || e.shiftKey) { if (k >= 0) c.sel.splice(k, 1); else c.sel.push(v); }
      else c.sel = k >= 0 && c.sel.length === 1 ? [] : [v];
      return rep.render();
    }
  },
  onChange(rep, x) {
    const f = rep.ldf, i = +x.dataset.i, c = f.conds[i], a = x.dataset.ldf, v = x.value;
    if (!c) return;
    if (a === 'lo' || a === 'slo') c.lo = Math.min(Number(v), c.hi);
    else if (a === 'hi' || a === 'shi') c.hi = Math.max(Number(v), c.lo);
    else if (a === 'q') c.q = v;
    rep.render();
    if (a === 'q') { const inp = rep.body.querySelector(`[data-ldf="q"][data-i="${i}"]`); if (inp) { inp.focus(); inp.setSelectionRange(v.length, v.length); } }
  },
};
