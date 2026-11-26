'use strict';
/* Tables menu operations and Design of Experiments generators. */

const TableOps = {
  summary(t) {
    return UI.launch({
      title: 'Summary', table: t, recallKey: 'summary',
      roles: [{ key: 'g', label: 'Group' }, { key: 'y', label: 'Statistics Columns' }],
      params: [{ key: 'stats', type: 'checks', label: 'Statistics', options: Object.keys(STATS), value: ['Mean'] }],
    }).then(r => {
      if (!r) return;
      const g = r.roles.g, ys = r.roles.y.filter(c => !t.isCat(c)), stats = r.params.stats.length ? r.params.stats : ['Mean'];
      const rows = t.complete(g, t.analysisRows());
      const m = new Map();
      for (const rr of rows) { const k = g.map(ci => String(t.columns[ci].values[rr])).join('\u0001'); if (!m.has(k)) m.set(k, { vals: g.map(ci => t.columns[ci].values[rr]), rows: [] }); m.get(k).rows.push(rr); }
      let groups = [...m.values()];
      groups.sort((a, b) => { for (let i = 0; i < g.length; i++) { const x = a.vals[i], y = b.vals[i]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); if (c) return c; } return 0; });
      if (!g.length) groups = [{ vals: [], rows }];
      const nt = new DataTable(`${t.name} By (${g.map(c => t.columns[c].name).join(', ') || 'All'})`);
      nt.addRows(groups.length);
      g.forEach((ci, i) => { const c = t.columns[ci]; nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: groups.map(x => x.vals[i]) }); });
      nt.addColumn({ name: 'N Rows', values: groups.map(x => x.rows.length) });
      for (const y of ys) for (const s of stats) nt.addColumn({ name: `${s}(${t.columns[y].name})`, values: groups.map(x => { const v = x.rows.map(rr => t.columns[y].values[rr]).filter(isNum); return v.length ? STATS[s](v) : NaN; }) });
      App.openTable(nt);
    });
  },
  subset(t) {
    const nsel = t.selCount;
    return UI.prompt('Subset', [
      { key: 'which', label: 'Rows', type: 'select', options: [['sel', `Selected Rows (${nsel})`], ['all', 'All rows'], ['rand', 'Random - sampling rate'], ['excl', 'Not excluded rows']], value: nsel ? 'sel' : 'all' },
      { key: 'rate', label: 'Sampling rate (0-1) for random', type: 'number', value: 0.5 },
      { key: 'cols', label: 'Columns', type: 'select', options: [['all', 'All columns'], ['sel', `Selected columns (${t.selCols.size})`]], value: 'all' },
      { key: 'name', label: 'Output table name', type: 'text', value: `Subset of ${t.name}` },
    ]).then(v => {
      if (!v) return;
      let rows = [...t.rows.keys()];
      if (v.which === 'sel') rows = t.selectedRows();
      else if (v.which === 'rand') rows = rows.filter(() => Math.random() < (v.rate || 0.5));
      else if (v.which === 'excl') rows = t.analysisRows();
      if (!rows.length) return UI.alert('No rows to subset.');
      const cols = v.cols === 'sel' && t.selCols.size ? [...t.selCols].sort((a, b) => a - b) : null;
      App.openTable(t.clone(v.name, rows, cols));
    });
  },
  sort(t) {
    return UI.launch({ title: 'Sort', table: t, roles: [{ key: 'by', label: 'By', required: true }], params: [{ key: 'desc', type: 'check', label: 'Descending' }, { key: 'replace', type: 'check', label: 'Replace table', value: true }] }).then(r => {
      if (!r) return;
      const by = r.roles.by, dir = r.params.desc ? -1 : 1;
      const order = [...t.rows.keys()].sort((a, b) => {
        for (const ci of by) {
          const x = t.columns[ci].values[a], y = t.columns[ci].values[b];
          const mx = DataTable.isMissing(x), my = DataTable.isMissing(y);
          if (mx || my) { if (mx && my) continue; return mx ? -1 : 1; }
          const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          if (c) return c * dir;
        }
        return a - b;
      });
      if (r.params.replace) {
        t.rows = order.map(i => t.rows[i]);
        for (const c of t.columns) c.values = order.map(i => c.values[i]);
        t.emit('data');
      } else App.openTable(t.clone(`${t.name} Sorted`, order));
    });
  },
  stack(t) {
    return UI.launch({ title: 'Stack', table: t, roles: [{ key: 'cols', label: 'Stack Columns', required: true }], params: [{ key: 'label', label: 'Stacked label column', type: 'text', value: 'Label' }, { key: 'data', label: 'Stacked data column', type: 'text', value: 'Data' }] }).then(r => {
      if (!r) return;
      const sc = r.roles.cols, keep = t.columns.map((_, i) => i).filter(i => !sc.includes(i));
      const nt = new DataTable(`${t.name} Stacked`);
      const n = t.nrows * sc.length; nt.addRows(n);
      const numeric = sc.every(ci => t.columns[ci].dataType === 'numeric');
      for (const ci of keep) { const c = t.columns[ci]; nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: Array.from({ length: n }, (_, k) => c.values[Math.floor(k / sc.length)]) }); }
      nt.addColumn({ name: r.params.label || 'Label', dataType: 'character', values: Array.from({ length: n }, (_, k) => t.columns[sc[k % sc.length]].name) });
      nt.addColumn({ name: r.params.data || 'Data', dataType: numeric ? 'numeric' : 'character', values: Array.from({ length: n }, (_, k) => { const v = t.columns[sc[k % sc.length]].values[Math.floor(k / sc.length)]; return numeric ? v : (DataTable.isMissing(v) ? '' : String(v)); }) });
      App.openTable(nt);
    });
  },
  split(t) {
    return UI.launch({ title: 'Split', table: t, roles: [{ key: 'by', label: 'Split By', required: true, max: 1 }, { key: 'cols', label: 'Split Columns', required: true }, { key: 'grp', label: 'Group' }] }).then(r => {
      if (!r) return;
      const by = r.roles.by[0], sc = r.roles.cols, grp = r.roles.grp;
      const lv = t.levels(by);
      const m = new Map();
      for (let i = 0; i < t.nrows; i++) { const k = grp.map(c => String(t.columns[c].values[i])).join('\u0001'); if (!m.has(k)) m.set(k, { vals: grp.map(c => t.columns[c].values[i]), cells: new Map() }); m.get(k).cells.set(String(t.columns[by].values[i]), i); }
      const g = [...m.values()];
      const nt = new DataTable(`${t.name} Split`); nt.addRows(g.length);
      grp.forEach((c, i) => nt.addColumn({ name: t.columns[c].name, dataType: t.columns[c].dataType, modelingType: t.columns[c].modelingType, values: g.map(x => x.vals[i]) }));
      for (const c of sc) for (const l of lv) { const col = t.columns[c]; nt.addColumn({ name: sc.length > 1 ? `${col.name} ${l}` : String(l), dataType: col.dataType, values: g.map(x => { const r0 = x.cells.get(String(l)); return r0 === undefined ? DataTable.missing(col.dataType) : col.values[r0]; }) }); }
      App.openTable(nt);
    });
  },
  transpose(t) {
    return UI.launch({ title: 'Transpose', table: t, roles: [{ key: 'cols', label: 'Transpose Columns', required: true }, { key: 'lab', label: 'Label', max: 1 }] }).then(r => {
      if (!r) return;
      const cols = r.roles.cols, lab = r.roles.lab[0];
      const nt = new DataTable(`Transpose of ${t.name}`); nt.addRows(cols.length);
      nt.addColumn({ name: 'Label', dataType: 'character', values: cols.map(c => t.columns[c].name) });
      const numeric = cols.every(c => t.columns[c].dataType === 'numeric');
      for (let i = 0; i < t.nrows; i++) nt.addColumn({ name: lab !== undefined ? String(t.columns[lab].values[i]) : `Row ${i + 1}`, dataType: numeric ? 'numeric' : 'character', values: cols.map(c => numeric ? t.columns[c].values[i] : String(t.columns[c].values[i] ?? '')) });
      App.openTable(nt);
    });
  },
  otherTables(t) { return App.tables.filter(x => x !== t); },
  concatenate(t) {
    const others = this.otherTables(t);
    if (!others.length) return UI.alert('Open another data table to concatenate with.');
    return UI.prompt('Concatenate', [{ key: 'other', label: 'Append rows from', type: 'select', options: others.map(o => [o.id, o.name]) }, { key: 'name', label: 'Output name', type: 'text', value: `Concatenate of ${t.name}` }]).then(v => {
      if (!v) return; const o = App.tables.find(x => x.id === +v.other);
      const nt = t.clone(v.name);
      const base = nt.nrows; nt.addRows(o.nrows);
      for (const c of o.columns) {
        let ci = nt.colIndex(c.name);
        if (ci < 0 || nt.columns[ci].name !== c.name) { nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType }); ci = nt.columns.length - 1; }
        const tc = nt.columns[ci];
        for (let i = 0; i < o.nrows; i++) tc.values[base + i] = nt.parseValue(tc, c.values[i]);
      }
      App.openTable(nt);
    });
  },
  join(t) {
    const others = this.otherTables(t);
    if (!others.length) return UI.alert('Open another data table to join with.');
    return UI.prompt('Join', [
      { key: 'other', label: 'With table', type: 'select', options: others.map(o => [o.id, o.name]) },
      { key: 'key', label: 'Matching column (this table)', type: 'select', options: t.columns.map(c => c.name) },
      { key: 'key2', label: 'Matching column (other table, blank = same name)', type: 'text', value: '' },
      { key: 'type', label: 'Join type', type: 'select', options: [['inner', 'Inner (matching rows only)'], ['left', 'Left outer (keep all rows of this table)']], value: 'left' },
    ]).then(v => {
      if (!v) return; const o = App.tables.find(x => x.id === +v.other);
      const k1 = t.colIndex(v.key), k2 = o.colIndex(v.key2 || v.key);
      if (k2 < 0) return UI.alert(`Column "${esc(v.key2 || v.key)}" not found in ${esc(o.name)}.`);
      const idx = new Map(); for (let i = 0; i < o.nrows; i++) { const k = String(o.columns[k2].values[i]); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(i); }
      const pairs = [];
      for (let i = 0; i < t.nrows; i++) { const m = idx.get(String(t.columns[k1].values[i])); if (m) m.forEach(j => pairs.push([i, j])); else if (v.type === 'left') pairs.push([i, -1]); }
      const nt = new DataTable(`${t.name} + ${o.name}`); nt.addRows(pairs.length);
      for (const c of t.columns) nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: pairs.map(([i]) => c.values[i]) });
      o.columns.forEach((c, ci) => { if (ci === k2) return; nt.addColumn({ name: nt.columns.some(x => x.name === c.name) ? `${c.name} of ${o.name}` : c.name, dataType: c.dataType, modelingType: c.modelingType, values: pairs.map(([, j]) => j < 0 ? DataTable.missing(c.dataType) : c.values[j]) }); });
      App.openTable(nt);
    });
  },
};

const DOE = {
  parseFactors(text) {
    return text.split(/[;\n]/).map(s => s.trim()).filter(Boolean).map(s => {
      const [name, lv] = s.split(':').map(x => x.trim());
      const levels = (lv || '-1,1').split(',').map(x => x.trim()).filter(Boolean);
      const numeric = levels.every(x => !isNaN(Number(x)));
      return { name, levels: numeric ? levels.map(Number) : levels, numeric };
    });
  },
  fullFactorial() {
    return UI.prompt('Full Factorial Design', [
      { key: 'f', label: 'Factors (name: levels; one per line)', type: 'textarea', rows: 5, value: 'Temperature: 150, 200\nPressure: 10, 20\nCatalyst: A, B, C' },
      { key: 'resp', label: 'Response name', type: 'text', value: 'Y' },
      { key: 'rep', label: 'Number of replicates', type: 'number', value: 1 },
      { key: 'center', label: 'Center points (continuous 2-level factors only)', type: 'number', value: 0 },
      { key: 'rand', type: 'check', label: 'Randomize run order', value: true },
    ], { width: 460, okLabel: 'Make Table' }).then(v => {
      if (!v) return;
      const fs = this.parseFactors(v.f); if (!fs.length) return;
      let runs = [[]];
      for (const f of fs) runs = runs.flatMap(r => f.levels.map(l => [...r, l]));
      const reps = Math.max(1, Math.round(v.rep || 1));
      runs = Array.from({ length: reps }, () => runs.map(r => [...r])).flat();
      if (v.center > 0 && fs.every(f => f.numeric && f.levels.length === 2)) for (let i = 0; i < v.center; i++) runs.push(fs.map(f => (f.levels[0] + f.levels[1]) / 2));
      this.makeTable('Full Factorial', fs, runs, v.resp, v.rand);
    });
  },
  rsm() {
    return UI.prompt('Response Surface Design (Central Composite)', [
      { key: 'f', label: 'Continuous factors (name: low, high; one per line)', type: 'textarea', rows: 4, value: 'Time: 10, 30\nTemperature: 150, 200\nRate: 1, 3' },
      { key: 'resp', label: 'Response name', type: 'text', value: 'Yield' },
      { key: 'alpha', label: 'Axial distance', type: 'select', options: [['rot', 'Rotatable'], ['face', 'Face-centered (α=1)']], value: 'rot' },
      { key: 'center', label: 'Center points', type: 'number', value: 4 },
      { key: 'rand', type: 'check', label: 'Randomize run order', value: true },
    ], { width: 460, okLabel: 'Make Table' }).then(v => {
      if (!v) return;
      const fs = this.parseFactors(v.f).filter(f => f.numeric && f.levels.length === 2); const k = fs.length; if (!k) return UI.alert('Enter at least one continuous factor with low, high.');
      const a = v.alpha === 'face' ? 1 : Math.pow(2 ** k, 0.25);
      let coded = [[]]; for (let i = 0; i < k; i++) coded = coded.flatMap(r => [[...r, -1], [...r, 1]]);
      for (let i = 0; i < k; i++) for (const s of [-a, a]) coded.push(Array.from({ length: k }, (_, j) => j === i ? s : 0));
      for (let i = 0; i < (v.center || 0); i++) coded.push(new Array(k).fill(0));
      const runs = coded.map(r => r.map((c, j) => { const [lo, hi] = fs[j].levels; return +(((lo + hi) / 2) + c * (hi - lo) / 2).toPrecision(8); }));
      this.makeTable('Central Composite Design', fs, runs, v.resp, v.rand, coded);
    });
  },
  screening() {
    return UI.prompt('Screening Design (2-level fractional factorial)', [
      { key: 'k', label: 'Number of factors (2-7)', type: 'number', value: 5 },
      { key: 'runs', label: 'Runs', type: 'select', options: [['8', '8 runs'], ['16', '16 runs']], value: '8' },
      { key: 'resp', label: 'Response name', type: 'text', value: 'Y' },
      { key: 'rand', type: 'check', label: 'Randomize run order', value: true },
    ], { okLabel: 'Make Table' }).then(v => {
      if (!v) return; const k = Math.min(7, Math.max(2, Math.round(v.k))); const n = +v.runs; const base = Math.log2(n);
      // base full factorial in `base` factors; extra factors from generators (products of base columns)
      const gens = base === 3 ? [[0, 1], [0, 2], [1, 2], [0, 1, 2]] : [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
      const coded = []; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < base; j++) r.push((i >> (base - 1 - j)) & 1 ? 1 : -1); coded.push(r); }
      const fs = []; for (let j = 0; j < k; j++) fs.push({ name: 'X' + (j + 1), levels: [-1, 1], numeric: true });
      const runs = coded.map(r => { const out = r.slice(0, Math.min(k, base)); for (let j = base; j < k; j++) out.push(gens[j - base].reduce((a, c) => a * r[c], 1)); return out; });
      this.makeTable(`Fractional Factorial ${k} factors ${n} runs`, fs, runs, v.resp, v.rand);
    });
  },
  makeTable(name, fs, runs, resp, rand, coded) {
    let order = runs.map((_, i) => i);
    if (rand) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const t = new DataTable(name); t.addRows(runs.length);
    t.addColumn({ name: 'Pattern', dataType: 'character', values: order.map(i => (coded ? coded[i] : runs[i]).map((v, j) => { const f = fs[j]; if (coded) return v === 0 ? '0' : Math.abs(v) === 1 ? (v > 0 ? '+' : '−') : (v > 0 ? 'A' : 'a'); return f.levels.length === 2 ? (v === f.levels[0] ? '−' : v === f.levels[1] ? '+' : '0') : String(f.levels.indexOf(v) + 1); }).join('')) });
    fs.forEach((f, j) => t.addColumn({ name: f.name, dataType: f.numeric ? 'numeric' : 'character', modelingType: f.numeric ? 'continuous' : 'nominal', values: order.map(i => runs[i][j]) }));
    t.addColumn({ name: resp || 'Y', dataType: 'numeric' });
    App.openTable(t);
    status(`${name}: ${runs.length} runs. Enter responses in "${resp}", then use Analyze ▸ Fit Model.`);
  },
};
