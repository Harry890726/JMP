'use strict';
/* Application shell: menus, toolbar, dialogs for columns/rows, file I/O, home window. */

const App = {
  tables: [], reports: [], active: null,
  setActive(t) { this.active = t; status(t ? `Current data table: ${t.name}  (${t.nrows} rows, ${t.columns.length} columns)` : 'Ready'); },
  openTable(t) {
    this.tables.push(t);
    const v = new TableView(t);
    this.setActive(t);
    WM.refreshList();
    return v;
  },
  closeTable(t) {
    WM.wins.filter(w => w.table === t && w.kind !== 'table').forEach(w => w.close());
    const v = WM.wins.find(w => w.kind === 'table' && w.table === t); if (v && v.view) v.view.close();
    this.tables = this.tables.filter(x => x !== t);
    if (this.active === t) this.setActive(this.tables[this.tables.length - 1] || null);
    setTimeout(() => WM.refreshList(), 0);
  },
  scratch() { return this.active || this.tables[0] || new DataTable('Untitled'); },
  need(fn) {
    return () => {
      const t = this.active;
      if (!t) { UI.alert('Open a data table first (File ▸ Open, or File ▸ Sample Data).', 'No data table'); return; }
      fn(t);
    };
  },
  byLaunch(t, platform, spec, by) {
    if (!by || !by.length) return new Report(t, platform, spec);
    const ci = by[0];
    for (const l of t.levels(ci, t.analysisRows())) new Report(t, platform, { ...spec, by: { ci, level: String(l), label: `${t.columns[ci].name}=${l}` } });
  },
  launch(name, extra) { return this.need(t => Platforms[name].launch(t, extra)); },

  // ---------------- column dialogs ----------------
  modelingTypeMenu(t, ci) {
    const col = t.columns[ci];
    return ['continuous', 'ordinal', 'nominal'].map(mt => ({
      label: MT_LABEL[mt], checked: col.modelingType === mt, disabled: mt === 'continuous' && col.dataType !== 'numeric',
      action: () => { (t.selCols.has(ci) ? [...t.selCols] : [ci]).forEach(i => { if (mt !== 'continuous' || t.columns[i].dataType === 'numeric') t.columns[i].modelingType = mt; }); t.emit('structure'); },
    }));
  },
  columnMenu(t, ci) {
    return [
      { label: 'Column Info...', action: () => this.columnInfo(t, ci) },
      { label: 'Formula...', action: () => this.formulaEditor(t, ci) },
      { label: 'Recode...', action: () => this.recode(t, ci) },
      { label: 'Modeling Type', submenu: this.modelingTypeMenu(t, ci) },
      '-',
      { label: 'Sort Ascending', action: () => this.sortBy(t, ci, 1) }, { label: 'Sort Descending', action: () => this.sortBy(t, ci, -1) },
      { label: 'Label / Unlabel (use as point labels)', checked: t.labelCol === ci, action: () => { t.labelCol = t.labelCol === ci ? null : ci; t.emit('rows'); } },
      { label: 'Color or Mark by Column', action: () => this.colorBy(t, ci) },
      '-',
      { label: 'Distribution', action: () => new Report(t, 'distribution', { y: t.selCols.size ? [...t.selCols] : [ci] }) },
      { label: 'Insert Columns', action: () => { t.addColumn({ name: 'Column', at: ci }); t.selCols.clear(); t.emit('structure'); } },
      { label: 'Delete Columns', action: () => this.deleteColumns(t, t.selCols.size ? [...t.selCols] : [ci]) },
    ];
  },
  sortBy(t, ci, dir) {
    const col = t.columns[ci];
    const order = [...t.rows.keys()].sort((a, b) => {
      const x = col.values[a], y = col.values[b];
      if (DataTable.isMissing(x) || DataTable.isMissing(y)) return DataTable.isMissing(x) - DataTable.isMissing(y);
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir || a - b;
    });
    t.rows = order.map(i => t.rows[i]); for (const c of t.columns) c.values = order.map(i => c.values[i]);
    t.emit('data');
  },
  deleteColumns(t, cis) {
    if (!cis.length) return;
    UI.confirm(`Delete ${cis.length} column(s): <b>${cis.map(i => esc(t.columns[i].name)).join(', ')}</b>?`).then(ok => {
      if (!ok) return;
      WM.wins.filter(w => w.report && w.table === t).forEach(w => w.close());
      t.deleteColumns(cis); t.emit('structure');
    });
  },
  columnInfo(t, ci) {
    const c = t.columns[ci];
    const fields = [
      { key: 'name', label: 'Column Name', type: 'text', value: c.name },
      { key: 'dataType', label: 'Data Type', type: 'select', options: [['numeric', 'Numeric'], ['character', 'Character']], value: c.dataType },
      { key: 'modelingType', label: 'Modeling Type', type: 'select', options: [['continuous', 'Continuous'], ['ordinal', 'Ordinal'], ['nominal', 'Nominal']], value: c.modelingType },
      { key: 'formula', label: 'Formula (optional)', type: 'textarea', rows: 2, value: c.formula || '' },
      { key: 'order', label: 'Value Ordering (comma separated, optional)', type: 'text', value: (c.levelOrder || []).join(', ') },
      { key: 'width', label: 'Display width (px)', type: 'number', value: c.width || 96 },
    ];
    UI.prompt(`${c.name} — Column Info`, fields, { width: 460 }).then(v => {
      if (!v) return;
      const nm = v.name.trim();
      if (nm && nm !== c.name) { if (t.columns.some((x, i) => i !== ci && x.name === nm)) return UI.alert('A column with that name already exists.'); this.renameRefs(t, c.name, nm); c.name = nm; }
      t.setDataType(ci, v.dataType);
      c.modelingType = v.dataType === 'character' && v.modelingType === 'continuous' ? 'nominal' : v.modelingType;
      c.formula = v.formula.trim() || null;
      c.levelOrder = v.order.trim() ? v.order.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      if (v.width > 20) c.width = v.width;
      t.emit('structure');
    });
  },
  renameRefs(t, oldN, newN) {
    for (const col of t.columns) if (col.formula) col.formula = col.formula.split(`:"${oldN}"`).join(`:"${newN}"`).replace(new RegExp(`:${oldN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g'), `:"${newN}"`);
  },
  newColumn(t, preset = {}) {
    const fields = [
      { key: 'name', label: 'Column Name', type: 'text', value: preset.name || t.uniqueName('Column ' + (t.columns.length + 1)) },
      { key: 'dataType', label: 'Data Type', type: 'select', options: [['numeric', 'Numeric'], ['character', 'Character']], value: 'numeric' },
      { key: 'modelingType', label: 'Modeling Type', type: 'select', options: [['continuous', 'Continuous'], ['ordinal', 'Ordinal'], ['nominal', 'Nominal']], value: 'continuous' },
      { key: 'init', label: 'Initialize Data', type: 'select', options: [['missing', 'Missing / Empty'], ['seq', 'Sequence Data (1, 2, 3 …)'], ['normal', 'Random: Normal(0,1)'], ['uniform', 'Random: Uniform(0,1)'], ['const', 'Constant (value below)'], ['formula', 'Formula (below)']], value: preset.formula ? 'formula' : 'missing' },
      { key: 'val', label: 'Constant value', type: 'text', value: '' },
      { key: 'formula', label: 'Formula, e.g.  :weight / (:height * :height) * 703', type: 'textarea', rows: 2, value: preset.formula || '' },
      { key: 'count', label: 'Number of columns to add', type: 'number', value: 1 },
    ];
    return UI.prompt('New Column', fields, { width: 480 }).then(v => {
      if (!v) return;
      const k = Math.max(1, Math.min(50, Math.round(v.count || 1)));
      for (let q = 0; q < k; q++) {
        const n = t.nrows; let values;
        if (v.init === 'seq') values = Array.from({ length: n }, (_, i) => v.dataType === 'numeric' ? i + 1 : String(i + 1));
        else if (v.init === 'normal') { const R = rng(Date.now() + q); values = Array.from({ length: n }, () => R.normal()); }
        else if (v.init === 'uniform') values = Array.from({ length: n }, () => Math.random());
        else if (v.init === 'const') values = Array.from({ length: n }, () => v.dataType === 'numeric' ? Number(v.val) : v.val);
        const formula = v.init === 'formula' && v.formula.trim() ? v.formula.trim() : null;
        const dt = (v.init === 'normal' || v.init === 'uniform') ? 'numeric' : v.dataType;
        t.addColumn({ name: k > 1 ? `${v.name} ${q + 1}` : v.name, dataType: dt, modelingType: dt === 'character' && v.modelingType === 'continuous' ? 'nominal' : v.modelingType, values, formula });
      }
      if (!t.nrows) t.addRows(20);
      t.emit('structure');
      const last = t.columns[t.columns.length - 1];
      if (last.formulaError) UI.alert(`Formula error: ${esc(last.formulaError)}`);
    });
  },
  formulaEditor(t, ci) {
    const c = t.columns[ci];
    const fnList = ['If( cond, then, else )', 'Log( x )', 'Log10( x )', 'Exp( x )', 'Sqrt( x )', 'Abs( x )', 'Round( x, d )', 'Floor( x )', 'Ceiling( x )', 'Power( x, p )', 'Modulo( a, b )', 'Row()', 'NRow()', 'Mean( a, b, … )', 'Sum( a, b, … )', 'Min( a, b, … )', 'Max( a, b, … )', 'IsMissing( x )', 'RandomNormal( mean, sd )', 'RandomUniform( a, b )', 'RandomInteger( a, b )', 'ColMean( :col )', 'ColStdDev( :col )', 'ColSum( :col )', 'ColMin( :col )', 'ColMax( :col )', 'ColMedian( :col )', 'Lag( :col, k )', 'Concat( a, b )', 'Uppercase( s )', 'Lowercase( s )', 'Length( s )', 'Substr( s, start, n )', 'Contains( s, x )', 'Num( s )', 'Char( x )'];
    const content = el(`<div class="fed">
      <div class="fed-top"><div class="fed-cols"><div class="lh">Columns</div><ul>${t.columns.map(x => `<li data-n="${esc(x.name)}">${typeIcon(x.modelingType)}${esc(x.name)}</li>`).join('')}</ul></div>
      <div class="fed-fns"><div class="lh">Functions</div><ul>${fnList.map(f => `<li data-f="${esc(f.replace(/\s*\(.*$/, '('))}">${esc(f)}</li>`).join('')}</ul></div></div>
      <div class="lh">Formula for <b>${esc(c.name)}</b></div>
      <textarea class="fed-text" rows="3" spellcheck="false">${esc(c.formula || '')}</textarea>
      <div class="fed-ops">${['+', '-', '*', '/', '^', '(', ')', '==', '!=', '<', '>', '&', '|'].map(o => `<button class="btn sm" data-op="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <div class="fed-prev small"></div></div>`);
    const ta = $('.fed-text', content), prev = $('.fed-prev', content);
    const ins = s => { const a = ta.selectionStart, b = ta.selectionEnd; ta.value = ta.value.slice(0, a) + s + ta.value.slice(b); ta.focus(); ta.selectionStart = ta.selectionEnd = a + s.length; upd(); };
    const upd = () => {
      if (!ta.value.trim()) { prev.innerHTML = '<span class="mut">Enter a formula. Reference columns as :name or :"name with spaces".</span>'; return; }
      try { const f = Formula.compile(t, ta.value); const v = []; for (let r = 0; r < Math.min(5, t.nrows); r++) v.push(fmt(f(r))); prev.innerHTML = `Preview (first rows): <b>${v.map(esc).join(', ')}</b>`; }
      catch (e) { prev.innerHTML = `<span class="psig">${esc(e.message)}</span>`; }
    };
    content.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (li && li.dataset.n) ins(/^[A-Za-z_]\w*$/.test(li.dataset.n) ? `:${li.dataset.n}` : `:"${li.dataset.n}"`);
      else if (li && li.dataset.f) ins(li.dataset.f);
      const op = e.target.closest('[data-op]'); if (op) ins(` ${op.dataset.op} `);
    });
    ta.addEventListener('input', upd); upd();
    UI.dialog({ title: 'Formula Editor', content, width: 620, buttons: [{ label: 'OK', primary: true, onClick: () => ta.value }, { label: 'Clear Formula', value: '' }, { label: 'Cancel', value: null }] }).then(v => {
      if (v === null) return;
      c.formula = v.trim() || null;
      if (c.formula && c.dataType === 'character') {
        try { const f = Formula.compile(t, c.formula); if (typeof f(0) === 'number') { c.dataType = 'numeric'; c.modelingType = 'continuous'; } } catch (e) { /* ignore */ }
      }
      t.emit('structure');
      if (c.formulaError) UI.alert(`Formula error: ${esc(c.formulaError)}`);
    });
  },
  recode(t, ci) {
    const c = t.columns[ci]; const lv = t.levels(ci).slice(0, 80);
    const content = el(`<div><div class="small mut">Edit the New Value for each level. Values left unchanged are kept.</div><table class="rt recode"><thead><tr><th class="l">Old Value</th><th class="l">New Value</th></tr></thead><tbody>${lv.map((l, i) => `<tr><td>${esc(String(l))}</td><td><input data-i="${i}" value="${esc(String(l))}"></td></tr>`).join('')}</tbody></table>
      <label class="fchk"><input type="checkbox" class="rc-new" checked> Create new column (otherwise replace in place)</label></div>`);
    UI.dialog({ title: `Recode ${c.name}`, content, width: 440, buttons: [{ label: 'Recode', primary: true, onClick: b => ({ map: new Map(lv.map((l, i) => [String(l), $(`input[data-i="${i}"]`, b).value])), newCol: $('.rc-new', b).checked }) }, { label: 'Cancel', value: null }] }).then(v => {
      if (!v) return;
      const outVals = c.values.map(x => DataTable.isMissing(x) ? x : (v.map.has(String(x)) ? v.map.get(String(x)) : x));
      const allNum = outVals.every(x => DataTable.isMissing(x) || (String(x).trim() !== '' && !isNaN(Number(x))));
      const dt = allNum && c.dataType === 'numeric' ? 'numeric' : 'character';
      const vals = outVals.map(x => dt === 'numeric' ? (DataTable.isMissing(x) ? NaN : Number(x)) : (DataTable.isMissing(x) ? '' : String(x)));
      if (v.newCol) t.addColumn({ name: c.name + ' 2', dataType: dt, modelingType: dt === 'character' ? (c.modelingType === 'continuous' ? 'nominal' : c.modelingType) : c.modelingType, values: vals });
      else { c.dataType = dt; c.values = vals; if (dt === 'character' && c.modelingType === 'continuous') c.modelingType = 'nominal'; }
      t.emit('structure');
    });
  },
  colorBy(t, ci) {
    const c = t.columns[ci];
    if (t.isCat(ci)) { const lv = t.levels(ci).map(String); t.rows.forEach((r, i) => { const k = lv.indexOf(String(c.values[i])); r.color = k >= 0 ? PALETTE[k % PALETTE.length] : null; }); }
    else {
      const v = c.values.filter(isNum), lo = S.min(v), hi = S.max(v);
      t.rows.forEach((r, i) => { const x = c.values[i]; if (!isNum(x)) { r.color = null; return; } const f = (x - lo) / (hi - lo || 1); r.color = `hsl(${220 - f * 220},75%,45%)`; });
    }
    t.emit('rows'); status(`Rows colored by ${c.name}`);
  },

  // ---------------- rows ----------------
  rowsMenu(t) {
    const sel = () => t.selectedRows();
    const flag = (k, val) => () => { const s = sel(); if (!s.length) return UI.alert('Select rows first.'); const on = val !== undefined ? val : !s.every(r => t.rows[r][k]); s.forEach(r => t.rows[r][k] = on); t.emit('rows'); };
    return [
      { label: 'Exclude/Unexclude', key: 'Ctrl+E', action: flag('exc') },
      { label: 'Hide/Unhide', key: 'Ctrl+H', action: flag('hid') },
      { label: 'Label/Unlabel', action: flag('lab') },
      { label: 'Colors', submenu: [...PALETTE.slice(0, 10).map((c, i) => ({ label: ['Blue', 'Red', 'Green', 'Orange', 'Purple', 'Teal', 'Pink', 'Olive', 'Brown', 'Slate'][i], action: () => { sel().forEach(r => t.rows[r].color = c); t.emit('rows'); } })), '-', { label: 'No Color', action: () => { sel().forEach(r => t.rows[r].color = null); t.emit('rows'); } }] },
      '-',
      { label: 'Select All Rows', key: 'Ctrl+A', action: () => t.select([...t.rows.keys()]) },
      { label: 'Invert Row Selection', action: () => t.select([...t.rows.keys()], 'toggle') },
      { label: 'Clear Row Selection', action: () => t.select([], 'replace') },
      { label: 'Row Selection', submenu: [
        { label: 'Select Where...', action: () => this.selectWhere(t) },
        { label: 'Select Excluded', action: () => t.select([...t.rows.keys()].filter(r => t.rows[r].exc)) },
        { label: 'Select Hidden', action: () => t.select([...t.rows.keys()].filter(r => t.rows[r].hid)) },
        { label: 'Select Matching Cells (selected columns)', action: () => { const cs = [...t.selCols]; const s = sel(); if (!cs.length || !s.length) return UI.alert('Select a column and some rows first.'); const keys = new Set(s.map(r => cs.map(c => String(t.columns[c].values[r])).join('|'))); t.select([...t.rows.keys()].filter(r => keys.has(cs.map(c => String(t.columns[c].values[r])).join('|')))); } },
        { label: 'Select Duplicate Rows', action: () => { const seen = new Set(), d = []; t.rows.forEach((_, r) => { const k = t.columns.map(c => String(c.values[r])).join('|'); if (seen.has(k)) d.push(r); else seen.add(k); }); t.select(d); } },
        { label: 'Select Randomly...', action: () => UI.prompt('Select Randomly', [{ key: 'p', label: 'Sampling rate (0-1) or count', type: 'number', value: 0.1 }]).then(v => { if (!v) return; const n = t.nrows, k = v.p < 1 ? Math.round(n * v.p) : Math.round(v.p); const idx = [...t.rows.keys()].sort(() => Math.random() - 0.5).slice(0, k); t.select(idx); }) },
      ] },
      '-',
      { label: 'Clear Row States', action: () => { t.rows.forEach(r => Object.assign(r, { sel: false, exc: false, hid: false, lab: false, color: null })); t.emit('rows'); } },
      { label: 'Color or Mark by Column...', action: () => UI.prompt('Color or Mark by Column', [{ key: 'c', label: 'Column', type: 'select', options: t.columns.map((c, i) => [i, c.name]) }]).then(v => v && this.colorBy(t, +v.c)) },
      '-',
      { label: 'Add Rows...', action: () => UI.prompt('Add Rows', [{ key: 'n', label: 'How many rows to add', type: 'number', value: 10 }, { key: 'where', label: 'Where', type: 'select', options: [['end', 'At end'], ['start', 'At start'], ['after', 'After first selected row']], value: 'end' }]).then(v => { if (!v || !(v.n > 0)) return; const s = sel(); const at = v.where === 'start' ? 0 : v.where === 'after' && s.length ? s[0] + 1 : undefined; t.addRows(Math.round(v.n), at); t.emit('data'); }) },
      { label: 'Delete Rows', action: () => { const s = sel(); if (!s.length) return UI.alert('Select rows to delete.'); UI.confirm(`Delete ${s.length} selected row(s)?`).then(ok => { if (ok) { t.deleteRows(s); t.emit('data'); } }); } },
    ];
  },
  selectWhere(t) {
    return UI.prompt('Select Where', [
      { key: 'c', label: 'Column', type: 'select', options: t.columns.map((c, i) => [i, c.name]) },
      { key: 'op', label: 'Condition', type: 'select', options: ['equals', 'does not equal', 'is greater than', 'is greater than or equal to', 'is less than', 'is less than or equal to', 'contains', 'does not contain', 'starts with', 'is missing', 'is not missing'], value: 'equals' },
      { key: 'v', label: 'Value', type: 'text', value: '' },
      { key: 'mode', label: 'Action', type: 'select', options: [['replace', 'Select rows (replace)'], ['extend', 'Extend current selection'], ['restrict', 'Restrict current selection']], value: 'replace' },
    ]).then(o => {
      if (!o) return;
      const col = t.columns[+o.c], num = col.dataType === 'numeric', target = num ? Number(o.v) : String(o.v);
      const test = x => {
        const miss = DataTable.isMissing(x);
        switch (o.op) {
          case 'is missing': return miss; case 'is not missing': return !miss;
          case 'contains': return String(x).toLowerCase().includes(String(o.v).toLowerCase());
          case 'does not contain': return !String(x).toLowerCase().includes(String(o.v).toLowerCase());
          case 'starts with': return String(x).toLowerCase().startsWith(String(o.v).toLowerCase());
        }
        if (miss) return false;
        const a = num ? x : String(x), b = target;
        const cmp = num ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
        return { equals: cmp === 0, 'does not equal': cmp !== 0, 'is greater than': cmp > 0, 'is greater than or equal to': cmp >= 0, 'is less than': cmp < 0, 'is less than or equal to': cmp <= 0 }[o.op];
      };
      let rows = [...t.rows.keys()].filter(r => test(col.values[r]));
      if (o.mode === 'restrict') rows = rows.filter(r => t.rows[r].sel);
      t.select(rows, o.mode === 'extend' ? 'extend' : 'replace');
      status(`${rows.length} rows matched`);
    });
  },

  // ---------------- files ----------------
  openFiles(files) {
    for (const f of files) {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const name = f.name.replace(/\.(csv|tsv|txt|json)$/i, '');
          if (/\.json$/i.test(f.name)) {
            const o = JSON.parse(rd.result);
            const list = o.tables ? o.tables : [o];
            list.forEach(x => this.openTable(DataTable.fromJSON(x)));
          } else this.openTable(DataTable.fromCSV(rd.result, name));
        } catch (e) { UI.alert(`Could not open ${esc(f.name)}: ${esc(e.message)}`); }
      };
      rd.readAsText(f);
    }
  },
  saveCSV(t) { download(`${t.name}.csv`, t.toCSV(), 'text/csv'); },
  saveProject() {
    if (!this.tables.length) return UI.alert('Nothing to save.');
    download('project.statlab.json', JSON.stringify({ app: 'StatLab Explorer', version: 1, tables: this.tables.map(t => t.toJSON()) }), 'application/json');
  },
  async exportReport() {
    const w = WM.active; if (!w || !w.report) return UI.alert('Activate a report window first.');
    let css = '';
    try { css = await (await fetch('css/app.css')).text(); } catch (e) { css = ''; }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(w.title)}</title><style>${css}\nbody{overflow:auto;height:auto;background:#fff}.report{padding:12px}</style></head><body><div class="report">${w.body.innerHTML}</div></body></html>`;
    download(`${w.title.replace(/[^\w\- ]+/g, '_')}.html`, html, 'text/html');
  },
  async pasteTable() {
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt.trim()) return UI.alert('Clipboard is empty.');
      this.openTable(DataTable.fromCSV(txt, 'Pasted Data'));
    } catch (e) {
      UI.prompt('New Table from Text', [{ key: 'txt', label: 'Paste tab/comma separated data with a header row', type: 'textarea', rows: 10, value: '' }], { width: 560 }).then(v => v && v.txt.trim() && this.openTable(DataTable.fromCSV(v.txt, 'Pasted Data')));
    }
  },
  copyRows(t) {
    const rows = t.selCount ? t.selectedRows() : [...t.rows.keys()];
    const cols = t.selCols.size ? [...t.selCols].sort((a, b) => a - b) : [...t.columns.keys()];
    const txt = [cols.map(c => t.columns[c].name).join('\t'), ...rows.map(r => cols.map(c => { const v = t.columns[c].values[r]; return DataTable.isMissing(v) ? '' : v; }).join('\t'))].join('\n');
    navigator.clipboard?.writeText(txt).then(() => status(`Copied ${rows.length} rows × ${cols.length} columns`), () => UI.alert('Clipboard not available.'));
  },
  newTable() {
    const t = new DataTable(`Untitled ${DataTable._n + 1}`);
    t.addColumn({ name: 'Column 1' }); t.addRows(20);
    this.openTable(t);
  },
  openSample(name) { this.openTable(Samples.get(name)); },

  // ---------------- menus ----------------
  tableMenu(t) {
    return [
      { label: 'Rename Table...', action: () => UI.prompt('Rename Table', [{ key: 'n', label: 'Name', type: 'text', value: t.name }]).then(v => { if (v && v.n.trim()) { t.name = v.n.trim(); t.emit('structure'); WM.refreshList(); } }) },
      { label: 'Copy Table', action: () => this.openTable(t.clone(t.name + ' Copy')) },
      { label: 'Save As CSV', action: () => this.saveCSV(t) },
      '-', { label: 'Distribution of All Columns', action: () => new Report(t, 'distribution', { y: [...t.columns.keys()] }) },
      { label: 'Columns Viewer', action: () => new Report(t, 'colviewer', { y: [...t.columns.keys()] }) },
    ];
  },
  menus() {
    const N = fn => this.need(fn);
    return [
      { label: 'File', items: [
        { label: 'New Data Table', key: 'Ctrl+N', action: () => this.newTable() },
        { label: 'Open...', key: 'Ctrl+O', action: () => $('#fileinput').click() },
        { label: 'Sample Data', submenu: Samples.names.map(n => ({ label: n, action: () => this.openSample(n) })) },
        { label: 'New Table from Clipboard', action: () => this.pasteTable() },
        '-',
        { label: 'Save As CSV...', key: 'Ctrl+S', action: N(t => this.saveCSV(t)) },
        { label: 'Save Project (all tables)...', action: () => this.saveProject() },
        { label: 'Export Report as HTML', action: () => this.exportReport() },
        { label: 'Print Window', key: 'Ctrl+P', action: () => window.print() },
        '-',
        { label: 'Close Window', key: 'Ctrl+W', action: () => WM.active && WM.active.close() },
        { label: 'Close All', action: () => WM.closeAll() },
      ] },
      { label: 'Edit', items: [
        { label: 'Copy Rows (tab-delimited)', key: 'Ctrl+C', action: N(t => this.copyRows(t)) },
        { label: 'Select All Rows', key: 'Ctrl+A', action: N(t => t.select([...t.rows.keys()])) },
        { label: 'Clear Selection', key: 'Esc', action: N(t => { t.selCols.clear(); t.select([], 'replace'); }) },
        '-', { label: 'Preferences: Reset Recall Memory', action: () => { UI._recall = {}; status('Launch dialog recall cleared'); } },
      ] },
      { label: 'Tables', items: [
        { label: 'Summary', action: N(t => TableOps.summary(t)) },
        { label: 'Subset', action: N(t => TableOps.subset(t)) },
        { label: 'Sort', action: N(t => TableOps.sort(t)) },
        { label: 'Stack', action: N(t => TableOps.stack(t)) },
        { label: 'Split', action: N(t => TableOps.split(t)) },
        { label: 'Transpose', action: N(t => TableOps.transpose(t)) },
        { label: 'Concatenate', action: N(t => TableOps.concatenate(t)) },
        { label: 'Join', action: N(t => TableOps.join(t)) },
        '-', { label: 'Tabulate', action: this.launch('tabulate') },
      ] },
      { label: 'Rows', items: () => this.active ? this.rowsMenu(this.active) : [{ label: '(no data table)', disabled: true }] },
      { label: 'Cols', items: [
        { label: 'New Columns...', action: N(t => this.newColumn(t)) },
        { label: 'Column Info...', action: N(t => this.columnInfo(t, this.selCol(t))) },
        { label: 'Formula...', action: N(t => this.formulaEditor(t, this.selCol(t))) },
        { label: 'Recode...', action: N(t => this.recode(t, this.selCol(t))) },
        { label: 'Modeling Type', submenu: () => this.active ? this.modelingTypeMenu(this.active, this.selCol(this.active)) : [] },
        '-', { label: 'Columns Viewer', action: this.launch('colviewer') },
        { label: 'Delete Columns', action: N(t => this.deleteColumns(t, [...t.selCols])) },
      ] },
      { label: 'DOE', items: [
        { label: 'Full Factorial Design', action: () => DOE.fullFactorial() },
        { label: 'Screening Design', action: () => DOE.screening() },
        { label: 'Response Surface Design', action: () => DOE.rsm() },
        '-', { label: 'Sample Size and Power', action: () => Platforms.power.launch(this.active) },
      ] },
      { label: 'Analyze', items: [
        { label: 'Distribution', action: this.launch('distribution') },
        { label: 'Fit Y by X', action: this.launch('fitxy') },
        { label: 'Tabulate', action: this.launch('tabulate') },
        '-', { label: 'Fit Model', action: this.launch('fitmodel') },
        { label: 'Multivariate Methods', submenu: [{ label: 'Multivariate', action: this.launch('multivariate') }, { label: 'Principal Components', action: this.launch('pca') }] },
        { label: 'Clustering', submenu: [{ label: 'Hierarchical Cluster', action: this.launch('hclust') }, { label: 'K Means Cluster', action: this.launch('kmeans') }] },
        { label: 'Quality and Process', submenu: [
          { label: 'Control Chart', submenu: ['IR', 'XBar & R', 'XBar & S', 'P'].map(c => ({ label: c, action: this.launch('control', c) })) },
          { label: 'Process Capability', action: this.launch('capability') },
          { label: 'Pareto Plot', action: this.launch('pareto') },
        ] },
      ] },
      { label: 'Graph', items: [
        { label: 'Graph Builder', key: 'Ctrl+G', action: this.launch('graphbuilder') },
        { label: 'Scatterplot Matrix', action: this.launch('spm') },
        { label: 'Pareto Plot', action: this.launch('pareto') },
        { label: 'Control Chart', submenu: ['IR', 'XBar & R', 'XBar & S', 'P'].map(c => ({ label: c, action: this.launch('control', c) })) },
      ] },
      { label: 'Window', items: () => [
        { label: 'Cascade', action: () => WM.arrange('cascade') }, { label: 'Tile', action: () => WM.arrange('tile') },
        { label: 'Show/Hide Window List', action: () => $('#home').classList.toggle('hidden') },
        { label: 'Close All Reports', action: () => WM.closeAll(w => !!w.report) },
        { label: 'Home Window', action: () => this.home() },
        '-', ...WM.wins.map(w => ({ label: w.title, checked: w === WM.active, action: () => w.focus() })),
      ] },
      { label: 'Help', items: [
        { label: 'Getting Started', action: () => this.home() },
        { label: 'Formula Functions', action: () => this.help('formula') },
        { label: 'Keyboard Shortcuts', action: () => this.help('keys') },
        { label: 'About StatLab Explorer', action: () => this.help('about') },
      ] },
    ];
  },
  selCol(t) { return t.selCols.size ? [...t.selCols][0] : (t.columns.length ? 0 : -1); },
  buildMenubar() {
    const mb = $('#menubar');
    mb.innerHTML = `<span class="brand">${LOGO}<b>StatLab</b></span>` + this.menus().map((m, i) => `<span class="mb" data-i="${i}">${esc(m.label)}</span>`).join('');
    const open = sp => {
      $$('.mb', mb).forEach(x => x.classList.remove('open'));
      sp.classList.add('open');
      const m = this.menus()[+sp.dataset.i]; const r = sp.getBoundingClientRect();
      UI.menu(typeof m.items === 'function' ? m.items() : m.items, r.left, r.bottom);
      sp.classList.add('open');
    };
    mb.addEventListener('click', e => { const sp = e.target.closest('.mb'); if (!sp) return; if (sp.classList.contains('open')) UI.closeMenus(0); else open(sp); });
    mb.addEventListener('mouseover', e => { const sp = e.target.closest('.mb'); if (sp && $('.mb.open', mb) && !sp.classList.contains('open')) open(sp); });
  },
  buildToolbar() {
    const B = (icon, title, fn) => ({ icon, title, fn });
    const items = [
      B(TB.new, 'New Data Table', () => this.newTable()), B(TB.open, 'Open', () => $('#fileinput').click()), B(TB.save, 'Save As CSV', this.need(t => this.saveCSV(t))), '|',
      B(TB.sample, 'Sample Data', e => { const r = e.currentTarget.getBoundingClientRect(); UI.menu(Samples.names.map(n => ({ label: n, action: () => this.openSample(n) })), r.left, r.bottom); }), '|',
      B(TB.dist, 'Distribution', this.launch('distribution')), B(TB.fxy, 'Fit Y by X', this.launch('fitxy')), B(TB.fm, 'Fit Model', this.launch('fitmodel')),
      B(TB.tab, 'Tabulate', this.launch('tabulate')), B(TB.gb, 'Graph Builder', this.launch('graphbuilder')), B(TB.cc, 'Control Chart', this.launch('control', 'IR')), '|',
      B(TB.newcol, 'New Column', this.need(t => this.newColumn(t))), B(TB.sel, 'Select Where', this.need(t => this.selectWhere(t))), '|',
      B(TB.casc, 'Cascade Windows', () => WM.arrange('cascade')), B(TB.tile, 'Tile Windows', () => WM.arrange('tile')),
    ];
    const tb = $('#toolbar');
    items.forEach(it => {
      if (it === '|') { tb.appendChild(el('<span class="tbsep"></span>')); return; }
      const b = el(`<button class="tbb" title="${esc(it.title)}">${it.icon}</button>`);
      b.addEventListener('click', it.fn); tb.appendChild(b);
    });
  },
  home() {
    const ex = WM.wins.find(w => w.kind === 'home'); if (ex) { ex.focus(); return; }
    const w = WM.create({ title: 'Home', kind: 'home', w: 720, h: 520, x: 24, y: 16, icon: ICONS.home });
    w.body.innerHTML = `<div class="homepage">
      <div class="hp-hero">${LOGO_BIG}<div><h1>StatLab Explorer</h1><p>Interactive statistical discovery in the browser: data tables, dynamic linked graphs, and point-and-click analysis.</p></div></div>
      <div class="hp-cols">
        <div><h3>Start</h3>
          <button class="hp-btn" data-h="new">${TB.new}<span>New Data Table</span></button>
          <button class="hp-btn" data-h="open">${TB.open}<span>Open CSV / JSON file…</span></button>
          <button class="hp-btn" data-h="paste">${TB.tab}<span>New Table from Clipboard</span></button>
          <h3>Sample Data</h3>
          ${Samples.names.map(n => `<button class="hp-btn sample" data-s="${esc(n)}">${ICONS.table}<span>${esc(n)}</span></button>`).join('')}
        </div>
        <div><h3>How it works</h3><ol class="hp-steps">
          <li>Open a data table. Each column has a <b>modeling type</b>: ${typeIcon('continuous')} Continuous, ${typeIcon('ordinal')} Ordinal, ${typeIcon('nominal')} Nominal — click the icon to change it.</li>
          <li>Choose a platform from <b>Analyze</b> or <b>Graph</b>, cast columns into roles, and click <b>OK</b>.</li>
          <li>Use the red triangle <span class="hot static"></span> menus for more options and the blue disclosure triangles to open or close report sections.</li>
          <li>Everything is linked: click or drag-select points or bars in any graph to select rows in the data table and every other report.</li>
          <li>Exclude, hide, color or label rows from the <b>Rows</b> menu; reports update automatically.</li>
        </ol>
        <p class="small mut">Tip: you can also drag &amp; drop .csv files onto the workspace.</p></div>
      </div></div>`;
    w.body.addEventListener('click', e => {
      const b = e.target.closest('.hp-btn'); if (!b) return;
      if (b.dataset.s) this.openSample(b.dataset.s);
      else if (b.dataset.h === 'new') this.newTable();
      else if (b.dataset.h === 'open') $('#fileinput').click();
      else if (b.dataset.h === 'paste') this.pasteTable();
    });
  },
  help(k) {
    if (k === 'about') return UI.alert(`<div style="display:flex;gap:14px;align-items:center">${LOGO_BIG}<div><b>StatLab Explorer</b><br>An open, browser-based interactive statistics workbench.<br><span class="small mut">Independent project; not affiliated with or endorsed by any commercial statistics software vendor.</span></div></div>`, 'About');
    if (k === 'keys') return UI.alert(`<table class="rt kv">${[['Ctrl+N', 'New data table'], ['Ctrl+O', 'Open file'], ['Ctrl+S', 'Save current table as CSV'], ['Ctrl+A', 'Select all rows'], ['Ctrl+E', 'Exclude/unexclude selected rows'], ['Ctrl+H', 'Hide/unhide selected rows'], ['Ctrl+G', 'Graph Builder'], ['Ctrl+W', 'Close window'], ['Esc', 'Clear selection / close menus'], ['Shift+click', 'Extend selection'], ['Ctrl+click', 'Toggle selection'], ['Drag on plot', 'Brush-select points'], ['Double-click cell', 'Edit value'], ['Double-click column header', 'Column Info']].map(([a, b]) => `<tr><td><b>${a}</b></td><td>${b}</td></tr>`).join('')}</table>`, 'Keyboard Shortcuts');
    if (k === 'formula') return UI.alert(`<div class="small">Reference columns with <code>:name</code> or <code>:"name with spaces"</code>. Operators: + - * / ^ == != &lt; &gt; &amp; |</div><pre class="small">If(:age &gt; 14, "Teen", "Child")
:weight / (:height ^ 2) * 703
Log(:Spend)
(:x - ColMean(:x)) / ColStdDev(:x)
Row()
Concat(:sex, "-", Char(:age))
RandomNormal(0, 1)</pre>`, 'Formula Functions');
  },
  init() {
    this.buildMenubar(); this.buildToolbar();
    $('#fileinput').addEventListener('change', e => { this.openFiles([...e.target.files]); e.target.value = ''; });
    const ws = $('#workspace');
    ws.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); ws.classList.add('dropping'); } });
    ws.addEventListener('dragleave', () => ws.classList.remove('dropping'));
    ws.addEventListener('drop', e => { ws.classList.remove('dropping'); if (e.dataTransfer.files.length) { e.preventDefault(); this.openFiles([...e.dataTransfer.files]); } });
    $('#winlist').addEventListener('click', e => { const it = e.target.closest('.wl-item'); if (!it) return; const w = WM.wins[+it.dataset.win]; if (w) w.focus(); });
    document.addEventListener('keydown', e => {
      if (e.target.matches('input,textarea,select') || $('.overlay')) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { UI.closeMenus(0); if (this.active) { this.active.selCols.clear(); this.active.select([], 'replace'); } return; }
      if (!mod) return;
      const map = { n: () => this.newTable(), o: () => $('#fileinput').click(), s: this.need(t => this.saveCSV(t)), a: this.need(t => t.select([...t.rows.keys()])), g: this.launch('graphbuilder'), w: () => WM.active && WM.active.close(),
        e: this.need(t => { const s = t.selectedRows(); const on = !s.every(r => t.rows[r].exc); s.forEach(r => t.rows[r].exc = on); t.emit('rows'); }),
        h: this.need(t => { const s = t.selectedRows(); const on = !s.every(r => t.rows[r].hid); s.forEach(r => t.rows[r].hid = on); t.emit('rows'); }),
        c: this.need(t => { if (!window.getSelection().toString()) this.copyRows(t); }) };
      if (map[k]) { if (k === 'c' && window.getSelection().toString()) return; e.preventDefault(); map[k](); }
    });
    this.home();
    WM.refreshList();
  },
};

const LOGO = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="13" width="4" height="9" rx="1" fill="#2f6bc6"/><rect x="8" y="8" width="4" height="14" rx="1" fill="#2e9a3a"/><rect x="14" y="4" width="4" height="18" rx="1" fill="#f39c12"/><path d="M2 10 L9 5 L14 8 L22 2" fill="none" stroke="#d9412b" stroke-width="2"/></svg>';
const LOGO_BIG = LOGO.replace('width="20" height="20"', 'width="64" height="64"');
const TB = {
  new: '<svg viewBox="0 0 20 20"><path d="M4 2h8l4 4v12H4z" fill="#fff" stroke="#555"/><path d="M12 2v4h4" fill="none" stroke="#555"/><path d="M7 11h6M10 8v6" stroke="#2e9a3a" stroke-width="1.6"/></svg>',
  open: '<svg viewBox="0 0 20 20"><path d="M2 5h6l2 2h8v9H2z" fill="#f5cf6b" stroke="#a37b16"/></svg>',
  save: '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="1" fill="#5b8fd6" stroke="#2c5ea8"/><rect x="6" y="3" width="8" height="5" fill="#fff"/><rect x="6" y="11" width="8" height="6" fill="#dfe8f5"/></svg>',
  sample: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" fill="#fff" stroke="#3a6fb5"/><path d="M2.5 7h15M7 3.5v13M12 3.5v13M2.5 10.5h15M2.5 13.5h15" stroke="#3a6fb5" stroke-width=".7"/><circle cx="15" cy="15" r="4" fill="#f39c12"/></svg>',
  dist: '<svg viewBox="0 0 20 20"><rect x="3" y="10" width="3" height="7" fill="#7ea3d4"/><rect x="6" y="5" width="3" height="12" fill="#7ea3d4"/><rect x="9" y="3" width="3" height="14" fill="#7ea3d4"/><rect x="12" y="7" width="3" height="10" fill="#7ea3d4"/><rect x="15" y="12" width="3" height="5" fill="#7ea3d4"/><path d="M2 17h17" stroke="#333"/></svg>',
  fxy: '<svg viewBox="0 0 20 20"><path d="M3 3v14h14" fill="none" stroke="#333"/><circle cx="6" cy="13" r="1.3"/><circle cx="9" cy="11" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="14" cy="7" r="1.3"/><path d="M4 15 L17 4" stroke="#d9412b" stroke-width="1.4"/></svg>',
  fm: '<svg viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="14" fill="#fff" stroke="#555"/><path d="M4 7h8M4 10h10M4 13h6" stroke="#2f6bc6" stroke-width="1.4"/><text x="13" y="8" font-size="6" fill="#d9412b">β</text></svg>',
  tab: '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" fill="#fff" stroke="#555"/><rect x="2.5" y="3.5" width="15" height="3" fill="#cfe0f5"/><rect x="2.5" y="3.5" width="4" height="13" fill="#e5eaf0"/><path d="M2.5 9.5h15M2.5 12.5h15M10 3.5v13" stroke="#999" stroke-width=".6"/></svg>',
  gb: '<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="2" fill="#fff" stroke="#555"/><circle cx="6" cy="13" r="1.4" fill="#2f6bc6"/><circle cx="9" cy="9" r="1.4" fill="#d9412b"/><circle cx="13" cy="11" r="1.4" fill="#2e9a3a"/><circle cx="14" cy="6" r="1.4" fill="#f39c12"/><path d="M4 15 C8 6, 12 12, 16 5" fill="none" stroke="#2f6bc6" stroke-width="1.2"/></svg>',
  cc: '<svg viewBox="0 0 20 20"><path d="M2 5h16M2 15h16" stroke="#d9412b" stroke-dasharray="2 1"/><path d="M2 10h16" stroke="#2e9a3a"/><path d="M2 11 L5 8 L8 12 L11 9 L14 13 L17 7" fill="none" stroke="#333" stroke-width="1.3"/></svg>',
  newcol: '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="14" fill="#fff" stroke="#555"/><rect x="11" y="3" width="6" height="14" fill="#e6f3e7" stroke="#2e9a3a"/><path d="M14 7v6M11 10h6" stroke="#2e9a3a" stroke-width="1.5"/></svg>',
  sel: '<svg viewBox="0 0 20 20"><circle cx="8" cy="8" r="5" fill="none" stroke="#555" stroke-width="1.6"/><path d="M12 12l5 5" stroke="#555" stroke-width="2"/></svg>',
  casc: '<svg viewBox="0 0 20 20"><rect x="2" y="2" width="10" height="8" fill="#fff" stroke="#555"/><rect x="5" y="5" width="10" height="8" fill="#fff" stroke="#555"/><rect x="8" y="8" width="10" height="8" fill="#cfe0f5" stroke="#555"/></svg>',
  tile: '<svg viewBox="0 0 20 20"><rect x="2" y="2" width="7" height="7" fill="#fff" stroke="#555"/><rect x="11" y="2" width="7" height="7" fill="#fff" stroke="#555"/><rect x="2" y="11" width="7" height="7" fill="#fff" stroke="#555"/><rect x="11" y="11" width="7" height="7" fill="#cfe0f5" stroke="#555"/></svg>',
};

window.addEventListener('DOMContentLoaded', () => App.init());
