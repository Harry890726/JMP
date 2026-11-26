'use strict';
/* Data table window: side panels (table / columns / rows) and a virtualised grid. */

class TableView {
  constructor(table) {
    this.t = table;
    this.rowH = 22;
    this.anchor = null;
    this.win = WM.create({
      title: table.name, kind: 'table', table, w: 860, h: 470, icon: ICONS.table,
      onFocus: () => { App.setActive(table); },
      onClose: () => App.closeTable(table),
    });
    this.win.view = this;
    this.build();
    this.unsub = table.on(k => this.refresh(k));
  }
  build() {
    const b = this.win.body;
    b.innerHTML = `<div class="dt">
      <div class="dt-side">
        <div class="pnl"><div class="pnl-h"><span class="tri">&#9662;</span><span class="hot" data-m="table"></span><span class="pnl-title tname"></span></div><div class="pnl-b tinfo"></div></div>
        <div class="pnl grow"><div class="pnl-h"><span class="tri">&#9662;</span><span class="pnl-title ccount"></span></div><div class="pnl-b"><ul class="collist"></ul></div></div>
        <div class="pnl"><div class="pnl-h"><span class="tri">&#9662;</span><span class="pnl-title">Rows</span></div><div class="pnl-b rinfo"></div></div>
      </div>
      <div class="dt-grid"><table class="grid"><colgroup></colgroup><thead></thead><tbody></tbody></table></div>
    </div>`;
    this.grid = $('.dt-grid', b);
    this.grid.addEventListener('scroll', () => { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this.renderBody(); }); });
    this.bindEvents();
    this.refresh('structure');
  }
  refresh(kind) {
    this.renderSide();
    if (kind === 'structure' || kind === 'data' || !this._built) { this.renderHead(); this._built = true; }
    this.renderBody(true);
    this.win.setTitle(this.t.name);
  }
  renderSide() {
    const t = this.t, b = this.win.body;
    $('.tname', b).textContent = t.name;
    $('.tinfo', b).innerHTML = `<div class="mut">${t.nrows} rows × ${t.columns.length} cols</div>`;
    $('.ccount', b).textContent = `Columns (${t.selCols.size}/${t.columns.length})`;
    $('.collist', b).innerHTML = t.columns.map((c, i) => `<li class="${t.selCols.has(i) ? 'sel' : ''}" data-ci="${i}" draggable="true"><span class="mtbtn" data-ci="${i}">${typeIcon(c.modelingType)}</span><span class="cname">${esc(c.name)}</span>${c.formula ? `<span class="fbadge" title="Formula: ${esc(c.formula)}">+</span>` : ''}</li>`).join('');
    const n = t.nrows, cnt = k => t.rows.filter(r => r[k]).length;
    $('.rinfo', b).innerHTML = `<table class="rtab"><tr><td>All rows</td><td>${n}</td></tr><tr><td>Selected</td><td>${t.selCount}</td></tr><tr><td>Excluded</td><td>${cnt('exc')}</td></tr><tr><td>Hidden</td><td>${cnt('hid')}</td></tr><tr><td>Labelled</td><td>${cnt('lab')}</td></tr></table>`;
  }
  renderHead() {
    const t = this.t;
    $('colgroup', this.grid).innerHTML = `<col style="width:56px">${t.columns.map(c => `<col style="width:${c.width || 96}px">`).join('')}<col style="width:60px">`;
    $('thead', this.grid).innerHTML = `<tr><th class="corner" title="Click: clear selection"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M2 2 L18 2 L2 18 Z" fill="#c7d0db"/><path d="M18 2 L18 18 L2 18 Z" fill="#dde3ea"/></svg></th>${t.columns.map((c, i) => `<th class="ch ${t.selCols.has(i) ? 'sel' : ''}" data-ci="${i}" title="${esc(c.name)} (${MT_LABEL[c.modelingType]}${c.formula ? ', formula' : ''})"><span class="chn">${esc(c.name)}</span>${c.formula ? '<span class="fbadge">+</span>' : ''}</th>`).join('')}<th class="newcol" title="Double-click to add a new column"></th></tr>`;
  }
  renderBody(force) {
    const t = this.t, g = this.grid;
    const total = t.nrows + 1; // +1 blank row for appending
    const h = g.clientHeight || 400;
    const start = Math.max(0, Math.floor(g.scrollTop / this.rowH) - 6);
    const end = Math.min(total, start + Math.ceil(h / this.rowH) + 14);
    if (!force && this._range && this._range[0] === start && this._range[1] === end) return;
    this._range = [start, end];
    const ncol = t.columns.length;
    let html = `<tr class="spacer" style="height:${start * this.rowH}px"><td colspan="${ncol + 2}"></td></tr>`;
    for (let r = start; r < end; r++) {
      if (r >= t.nrows) { html += `<tr class="newrow" data-r="${r}"><td class="rn"></td>${t.columns.map((c, ci) => `<td data-ci="${ci}"></td>`).join('')}<td></td></tr>`; continue; }
      const st = t.rows[r];
      const marks = `${st.exc ? '<span class="rs exc" title="Excluded">&#8856;</span>' : ''}${st.hid ? '<span class="rs hid" title="Hidden">&#9681;</span>' : ''}${st.lab ? '<span class="rs lab" title="Labelled">&#9873;</span>' : ''}${st.color ? `<span class="rs dot" style="background:${st.color}"></span>` : ''}`;
      html += `<tr class="${st.sel ? 'sel' : ''}" data-r="${r}"><td class="rn"><span class="marks">${marks}</span>${r + 1}</td>`;
      for (let ci = 0; ci < ncol; ci++) {
        const c = t.columns[ci], v = c.values[r];
        const num = c.dataType === 'numeric';
        html += `<td class="${num ? 'num' : ''}${t.selCols.has(ci) ? ' csel' : ''}" data-ci="${ci}">${num ? (isNaN(v) ? '<span class="miss">•</span>' : esc(fmt(v, 10))) : esc(v)}</td>`;
      }
      html += '<td></td></tr>';
    }
    html += `<tr class="spacer" style="height:${Math.max(0, (total - end) * this.rowH)}px"><td colspan="${ncol + 2}"></td></tr>`;
    $('tbody', g).innerHTML = html;
  }
  bindEvents() {
    const b = this.win.body, t = this.t;
    // side panel: columns
    const cl = $('.collist', b);
    cl.addEventListener('click', e => {
      const mt = e.target.closest('.mtbtn');
      if (mt) { const ci = +mt.dataset.ci; const r = mt.getBoundingClientRect(); UI.menu(App.modelingTypeMenu(t, ci), r.left, r.bottom); return; }
      const li = e.target.closest('li'); if (li) this.selectCol(+li.dataset.ci, e);
    });
    cl.addEventListener('dblclick', e => { const li = e.target.closest('li'); if (li) App.columnInfo(t, +li.dataset.ci); });
    cl.addEventListener('contextmenu', e => { const li = e.target.closest('li'); if (!li) return; e.preventDefault(); const ci = +li.dataset.ci; if (!t.selCols.has(ci)) this.selectCol(ci, {}); UI.menu(App.columnMenu(t, ci), e.clientX, e.clientY); });
    cl.addEventListener('dragstart', e => { const li = e.target.closest('li'); if (!li) return; const ci = +li.dataset.ci; const sel = t.selCols.has(ci) ? [...t.selCols] : [ci]; e.dataTransfer.setData('text/plain', 'cols:' + sel.join(',')); });
    $$('.pnl-h', b).forEach(h => h.addEventListener('click', e => { if (e.target.closest('.hot')) return; h.parentElement.classList.toggle('closed'); }));
    $('.hot[data-m="table"]', b).addEventListener('click', e => { const r = e.target.getBoundingClientRect(); UI.menu(App.tableMenu(t), r.left, r.bottom); });

    const g = this.grid;
    g.addEventListener('click', e => {
      if (e.target.closest('.corner')) { t.selCols.clear(); t.select([], 'replace'); this.refresh('structure'); return; }
      const th = e.target.closest('th.ch'); if (th) { this.selectCol(+th.dataset.ci, e); return; }
      const rn = e.target.closest('td.rn'); if (rn) { const r = +rn.parentElement.dataset.r; if (r < t.nrows) this.selectRow(r, e); return; }
    });
    g.addEventListener('dblclick', e => {
      if (e.target.closest('th.newcol')) { App.newColumn(t); return; }
      const th = e.target.closest('th.ch'); if (th) { App.columnInfo(t, +th.dataset.ci); return; }
      const td = e.target.closest('td[data-ci]'); if (td) this.edit(td);
    });
    g.addEventListener('contextmenu', e => {
      const th = e.target.closest('th.ch');
      if (th) { e.preventDefault(); const ci = +th.dataset.ci; if (!t.selCols.has(ci)) this.selectCol(ci, {}); UI.menu(App.columnMenu(t, ci), e.clientX, e.clientY); return; }
      const tr = e.target.closest('tr[data-r]');
      if (tr && +tr.dataset.r < t.nrows) { e.preventDefault(); const r = +tr.dataset.r; if (!t.rows[r].sel) t.select([r]); UI.menu(App.rowsMenu(t), e.clientX, e.clientY); }
    });
  }
  selectCol(ci, e) {
    const t = this.t;
    if (e.ctrlKey || e.metaKey) { t.selCols.has(ci) ? t.selCols.delete(ci) : t.selCols.add(ci); }
    else if (e.shiftKey && this.colAnchor !== undefined) { const a = Math.min(this.colAnchor, ci), z = Math.max(this.colAnchor, ci); for (let i = a; i <= z; i++) t.selCols.add(i); }
    else { const only = t.selCols.size === 1 && t.selCols.has(ci); t.selCols.clear(); if (!only) t.selCols.add(ci); }
    if (!e.shiftKey) this.colAnchor = ci;
    this.refresh('structure');
  }
  selectRow(r, e) {
    const t = this.t;
    if (e.shiftKey && this.anchor !== null) { const a = Math.min(this.anchor, r), z = Math.max(this.anchor, r); t.select(Array.from({ length: z - a + 1 }, (_, i) => a + i), 'extend'); }
    else if (e.ctrlKey || e.metaKey) t.select([r], 'toggle');
    else t.select([r], t.rows[r].sel && t.selCount === 1 ? 'deselect' : 'replace');
    if (!e.shiftKey) this.anchor = r;
  }
  edit(td) {
    const t = this.t, ci = +td.dataset.ci, r = +td.parentElement.dataset.r;
    const col = t.columns[ci];
    if (col.formula) { UI.alert(`Column <b>${esc(col.name)}</b> is computed by a formula and cannot be edited directly.<br><code>${esc(col.formula)}</code>`, 'Formula column'); return; }
    const old = r < t.nrows ? col.values[r] : '';
    const inp = el(`<input class="cellin ${col.dataType === 'numeric' ? 'num' : ''}">`);
    inp.value = DataTable.isMissing(old) ? '' : String(old);
    td.innerHTML = ''; td.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const commit = (move) => {
      if (done) return; done = true;
      if (inp.value !== (DataTable.isMissing(old) ? '' : String(old))) {
        if (col.dataType === 'numeric' && inp.value.trim() !== '' && isNaN(Number(inp.value.replace(/,/g, '')))) {
          // switch to character if user types text into an empty numeric column
          if (col.values.every(v => DataTable.isMissing(v))) { t.setDataType(ci, 'character'); }
        }
        t.setCell(r, ci, inp.value);
        t.emit('data');
      } else this.renderBody(true);
      if (move) {
        const nr = move === 'down' ? r + 1 : r, nc = move === 'right' ? ci + 1 : ci;
        if (nc < t.columns.length) setTimeout(() => {
          const ntd = $(`tr[data-r="${nr}"] td[data-ci="${nc}"]`, this.grid); if (ntd) this.edit(ntd);
        }, 0);
      }
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
      else if (e.key === 'Escape') { done = true; this.renderBody(true); }
    });
    inp.addEventListener('blur', () => commit());
  }
  close() { this.unsub(); }
}
