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
    this.menus = ctx.menus;
    this.body.innerHTML = html;
    this.body.scrollTop = st; this.body.scrollLeft = sl;
    if (this.platform.after) this.platform.after(this);
  }
  bind() {
    const b = this.body;
    b.addEventListener('click', e => {
      const hot = e.target.closest('.hot');
      if (hot) { const items = this.menus[hot.dataset.menu]; if (items) { const r = hot.getBoundingClientRect(); UI.menu(items, r.left, r.bottom + 1); } return; }
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
