'use strict';
/* Tabulate, Columns Viewer, Scatterplot Matrix, Sample Size & Power. */

const STATS = {
  N: v => v.length, Mean: S.mean, 'Std Dev': S.sd, Min: S.min, Max: S.max, Sum: S.sum, Median: S.median,
  Variance: S.variance, 'Std Err': v => S.sd(v) / Math.sqrt(v.length), Range: v => S.max(v) - S.min(v),
};

Platforms.tabulate = {
  title: () => 'Tabulate', w: 760, h: 520,
  launch(t) {
    return UI.launch({
      title: 'Tabulate', table: t, recallKey: 'tab',
      roles: [{ key: 'rows', label: 'Grouping (Rows)' }, { key: 'cols', label: 'Grouping (Columns)', max: 1 }, { key: 'y', label: 'Analysis Columns' }],
      params: [{ key: 'stats', type: 'checks', label: 'Statistics', options: Object.keys(STATS), value: ['N', 'Mean'] }, { key: 'pct', type: 'check', label: 'Include % of Total (for counts)', value: true }, { key: 'all', type: 'check', label: 'Add aggregate row (All)', value: true }],
    }).then(r => {
      if (!r) return;
      if (!r.roles.rows.length && !r.roles.cols.length && !r.roles.y.length) return UI.alert('Specify at least one grouping or analysis column.');
      new Report(t, 'tabulate', { rows: r.roles.rows, cols: r.roles.cols, y: r.roles.y.filter(c => !t.isCat(c)), stats: r.params.stats.length ? r.params.stats : ['N'], pct: r.params.pct, all: r.params.all });
    });
  },
  render(ctx) {
    const t = ctx.t, sp = ctx.spec;
    const rows = t.complete([...sp.rows, ...sp.cols], ctx.rows);
    const key = (r, cis) => cis.map(ci => String(t.columns[ci].values[r])).join('\u0001');
    const rowKeys = new Map(), colLevels = sp.cols.length ? t.levels(sp.cols[0], rows).map(String) : [null];
    // ordered row combos
    const combos = [];
    const rec = (depth, prefix, subset) => {
      if (depth === sp.rows.length) { combos.push({ parts: prefix, rows: subset }); return; }
      for (const lv of t.levels(sp.rows[depth], subset)) rec(depth + 1, [...prefix, String(lv)], subset.filter(r => String(t.columns[sp.rows[depth]].values[r]) === String(lv)));
    };
    rec(0, [], rows);
    if (sp.all && sp.rows.length) combos.push({ parts: ['All', ...sp.rows.slice(1).map(() => '')], rows, all: true });
    const measures = sp.y.length ? sp.y.flatMap(y => sp.stats.map(s => ({ y, s }))) : [{ y: null, s: 'N' }, ...(sp.pct ? [{ y: null, s: '% of Total' }] : [])];
    const N = rows.length;
    const value = (rs, m) => {
      if (m.y === null) return m.s === 'N' ? rs.length : 100 * rs.length / N;
      const v = rs.map(r => t.columns[m.y].values[r]).filter(isNum);
      return v.length ? STATS[m.s](v) : NaN;
    };
    const mh = m => `<th>${m.y !== null ? esc(ctx.cn(m.y)) + '<br>' : ''}${esc(m.s)}</th>`;
    let thead;
    if (sp.cols.length) {
      const rg = sp.rows.map(ci => `<th class="l" rowspan="3">${esc(ctx.cn(ci))}</th>`).join('');
      thead = `<tr>${rg}<th colspan="${colLevels.length * measures.length}">${esc(ctx.cn(sp.cols[0]))}</th></tr>` +
        `<tr>${colLevels.map(l => `<th colspan="${measures.length}">${esc(l)}</th>`).join('')}</tr>` +
        `<tr>${colLevels.map(() => measures.map(mh).join('')).join('')}</tr>`;
    } else thead = `<tr>${sp.rows.map(ci => `<th class="l">${esc(ctx.cn(ci))}</th>`).join('')}${measures.map(mh).join('')}</tr>`;
    const bodyRows = (sp.rows.length ? combos : [{ parts: [], rows }]).map(c => {
      const cells = colLevels.map(cl => { const rs = cl === null ? c.rows : c.rows.filter(r => String(t.columns[sp.cols[0]].values[r]) === cl); return measures.map(m => { const v = value(rs, m); return `<td class="n" data-rows="${rs.join(',')}">${m.s === '% of Total' ? fmtD(v, 2) : fmt(v)}</td>`; }).join(''); }).join('');
      return `<tr class="${c.all ? 'tot' : ''}">${c.parts.map(p => `<th class="l">${esc(p)}</th>`).join('')}${cells}</tr>`;
    }).join('');
    return ctx.outline('Tabulate', `<div class="gwrap"><table class="rt tabulate"><thead>${thead}</thead><tbody>${bodyRows}</tbody></table></div><div class="small mut">Click a cell to select its rows.</div>`, {
      key: 'tab', menu: [{
        label: 'Make Into Data Table', action: () => {
          const nt = new DataTable(t.name + ' Tabulate');
          sp.rows.forEach((ci, i) => nt.addColumn({ name: ctx.cn(ci), dataType: 'character', values: combos.map(c => c.parts[i]) }));
          if (!sp.rows.length) nt.addRows(1);
          colLevels.forEach(cl => measures.forEach(m => nt.addColumn({ name: [cl, m.y !== null ? ctx.cn(m.y) : '', m.s].filter(Boolean).join(' '), values: (sp.rows.length ? combos : [{ rows }]).map(c => value(cl === null ? c.rows : c.rows.filter(r => String(t.columns[sp.cols[0]].values[r]) === cl), m)) })));
          App.openTable(nt);
        },
      }],
    });
  },
};

Platforms.colviewer = {
  title: () => 'Columns Viewer', w: 820, h: 420,
  launch(t) {
    return UI.launch({ title: 'Columns Viewer', table: t, roles: [{ key: 'y', label: 'Show Summary', required: true }] }).then(r => r && new Report(t, 'colviewer', { y: r.roles.y }));
  },
  render(ctx) {
    const t = ctx.t;
    const rowsT = ctx.spec.y.map(ci => {
      const col = t.columns[ci], all = ctx.rows.map(r => col.values[r]);
      const nm = all.filter(v => DataTable.isMissing(v)).length;
      if (col.dataType === 'numeric') {
        const v = all.filter(isNum);
        return [col.name, v.length, nm, t.levels(ci, ctx.rows).length, v.length ? S.min(v) : NaN, v.length ? S.max(v) : NaN, S.mean(v), S.sd(v), S.median(v), S.quantile(S.sorted(v), 0.25), S.quantile(S.sorted(v), 0.75)];
      }
      return [col.name, all.length - nm, nm, t.levels(ci, ctx.rows).length, '', '', '', '', '', '', ''];
    });
    return ctx.outline('Summary Statistics', ctx.table([{ h: 'Columns', a: 'l' }, 'N', 'N Missing', 'N Categories', 'Min', 'Max', 'Mean', 'Std Dev', 'Median', 'Lower Quartile', 'Upper Quartile'], rowsT), {
      key: 'cv', menu: [{ label: 'Distribution', action: () => new Report(t, 'distribution', { y: ctx.spec.y }) }],
    });
  },
};

Platforms.spm = {
  title: () => 'Scatterplot Matrix', w: 760, h: 720,
  launch(t) {
    return UI.launch({ title: 'Scatterplot Matrix', table: t, recallKey: 'mv', roles: [{ key: 'y', label: 'Y, Columns', required: true, types: ['continuous'] }] })
      .then(r => r && new Report(t, 'spm', { y: r.roles.y.filter(c => !t.isCat(c)) }));
  },
  render(ctx) {
    const t = ctx.t, cis = ctx.spec.y, rows = t.complete(cis, ctx.rows);
    if (cis.length < 2) return ctx.note('Select at least two continuous columns.');
    return ctx.outline('Scatterplot Matrix', `<div class="gwrap">${scatterMatrix(ctx, cis, rows, { ell: ctx.opt('ell') })}</div>`, { key: 'spm', menu: [ctx.check('Density Ellipses', 'ell')] });
  },
};

Platforms.power = {
  title: () => 'Sample Size and Power', w: 620, h: 560,
  launch(t) {
    return UI.prompt('Sample Size Explorer: Two Sample Means', [
      { key: 'alpha', label: 'Alpha', type: 'number', value: 0.05 }, { key: 'sd', label: 'Std Dev', type: 'number', value: 1 },
      { key: 'diff', label: 'Difference to detect', type: 'number', value: 0.5 }, { key: 'power', label: 'Power', type: 'number', value: 0.8 },
    ]).then(v => v && new Report(t || App.scratch(), 'power', v));
  },
  render(ctx) {
    const { alpha, sd, diff, power } = ctx.spec;
    const powerAt = n => { const df = 2 * n - 2, ncp = diff / (sd * Math.sqrt(2 / n)), tc = S.tInv(1 - alpha / 2, df); return 1 - S.tCdf(tc - ncp, df) + S.tCdf(-tc - ncp, df); };
    let n = 2; while (n < 1e5 && powerAt(n) < power) n++;
    const pts = []; const nmax = Math.max(10, n * 2);
    for (let k = 2; k <= nmax; k++) pts.push([k, powerAt(k)]);
    const p = Plot.frame({ w: 480, h: 300, x: { min: 2, max: nmax }, y: { min: 0, max: 1, pad: false }, xLabel: 'Sample Size per group', yLabel: 'Power' });
    p.add(Plot.line(pts.map(([a, b]) => [p.X(a), p.Y(b)]), 'fit', 'stroke:#2f6bc6') + Plot.hline(p, power, 'ref', 'stroke:#d9412b;stroke-dasharray:4 3') + Plot.vline(p, n, 'ref', 'stroke:#d9412b;stroke-dasharray:4 3'));
    return ctx.outline('Two Sample Means', ctx.kv([['Alpha', alpha], ['Std Dev', sd], ['Difference to detect', diff], ['Power', power], ['Sample size per group', n], ['Total sample size', 2 * n], ['Actual power', powerAt(n)]]) + `<div class="gwrap">${p.svg()}</div>`, { key: 'pw' });
  },
};
