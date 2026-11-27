'use strict';
/* Distribution platform: histograms, box plots, quantiles, summary statistics, fits. */

Platforms.distribution = {
  title: () => 'Distribution',
  w: 960, h: 640,
  launch(t) {
    return UI.launch({
      title: 'Distribution', table: t, recallKey: 'distribution',
      roles: [{ key: 'y', label: 'Y, Columns', required: true }, { key: 'by', label: 'By', max: 1 }],
      help: 'Shows the distribution of each Y column: histogram, outlier box plot, quantiles and moments for continuous columns; bar chart and frequencies for categorical columns.',
    }).then(r => r && App.byLaunch(t, 'distribution', { y: r.roles.y }, r.roles.by));
  },
  render(ctx) {
    const parts = ctx.spec.y.map(ci => ctx.t.isCat(ci) ? this.cat(ctx, ci) : this.cont(ctx, ci));
    const stack = ctx.opt('stack', true);
    return ctx.outline('Distributions' + (ctx.spec.by ? ' ' + esc(ctx.spec.by.label) : ''), `<div class="${stack ? 'stackcol' : 'sidebyside'}">${parts.join('')}</div>`, {
      menu: [ctx.check('Stack', 'stack', true), ctx.check('Uniform Scaling', 'uniform'), '-',
        { label: 'Save Script to Clipboard', action: () => navigator.clipboard?.writeText(JSON.stringify({ platform: 'Distribution', y: ctx.spec.y.map(i => ctx.cn(i)) })) }],
    });
  },
  rowsFor(ctx) { return ctx.rows; },
  cont(ctx, ci) {
    const t = ctx.t, col = t.columns[ci], K = k => ci + ':' + k;
    const rows = this.rowsFor(ctx).filter(r => isNum(col.values[r]));
    const vals = rows.map(r => col.values[r]);
    const nMiss = this.rowsFor(ctx).length - rows.length;
    const menu = [
      { label: 'Display Options', submenu: [ctx.check('Quantiles', K('q'), true), ctx.check('Summary Statistics', K('ss'), true), ctx.check('Customize: Show All Statistics', K('allss')), ctx.check('Histogram', K('hist'), true), ctx.check('Outlier Box Plot', K('box'), true), ctx.check('Count Axis', K('count'), true)] },
      { label: 'Histogram Options', submenu: [ctx.act('Set Bin Width...', () => { UI.prompt('Set Bin Width', [{ key: 'bw', label: 'Bin width', type: 'number', value: ctx.opt(K('bw'), '') }]).then(v => { if (v) { ctx.rep.opts[K('bw')] = v.bw > 0 ? v.bw : null; ctx.rep.render(); } }); return false; }), ctx.check('Shadowgram (density outline)', K('shadow'))] },
      ctx.check('Normal Quantile Plot', K('nq')), ctx.check('CDF Plot', K('cdf')),
      ctx.act('Test Mean...', () => { UI.prompt('Test Mean', [{ key: 'mu', label: 'Specify hypothesized mean', type: 'number', value: ctx.opt(K('mu0'), 0) }, { key: 'sigma', label: 'Enter true std dev (optional, z test)', type: 'number', value: '' }]).then(v => { if (v && isNum(v.mu)) { ctx.rep.opts[K('mu0')] = v.mu; ctx.rep.opts[K('sig0')] = v.sigma; ctx.rep.render(); } }); return false; }),
      ctx.check('Confidence Interval (std dev)', K('ci')),
      { label: 'Continuous Fit', submenu: [ctx.check('Normal', K('fitn')), ctx.check('Smooth Curve (kernel density)', K('kde'))] },
      ctx.act('Prediction Interval...', () => { UI.prompt('Prediction Interval', [{ key: 'k', label: 'Number of future observations', type: 'number', value: 1 }]).then(v => { if (v) { ctx.rep.opts[K('pi')] = Math.max(1, Math.round(v.k || 1)); ctx.rep.render(); } }); return false; }),
      ctx.act('Tolerance Interval (95%/90%)', () => { ctx.rep.opts[K('ti')] = !ctx.opt(K('ti')); }),
      '-',
      { label: 'Save', submenu: [
        ctx.act('Standardized', () => { const m = S.mean(vals), s = S.sd(vals); saveColumn(t, 'Std ' + col.name, col.values.map(v => isNum(v) ? (v - m) / s : NaN), `(:"${col.name}" - ColMean(:"${col.name}")) / ColStdDev(:"${col.name}")`); return false; }),
        ctx.act('Level Numbers (bins)', () => { const { edges } = Plot.bins(vals, ctx.opt(K('bw'))); saveColumn(t, 'Bin ' + col.name, col.values.map(v => isNum(v) ? edges.findIndex((e, i) => v >= e && v < edges[i + 1]) + 1 : NaN)); return false; }),
        ctx.act('Ranks', () => { const rk = S.ranks(vals); const out = col.values.map(() => NaN); rows.forEach((r, i) => out[r] = rk[i]); saveColumn(t, 'Rank ' + col.name, out); return false; }),
      ] },
    ];
    if (!vals.length) return ctx.outline(esc(col.name), ctx.note('No nonmissing values.'), { menu, key: 'd' + ci, cls: 'distcol' });

    const s = S.sorted(vals), n = vals.length, m = S.mean(vals), sd = S.sd(vals);
    const uniform = ctx.opt('uniform') && ctx._uni;
    let lo = s[0], hi = s[n - 1];
    const { edges, bw } = Plot.bins(vals, ctx.opt(K('bw')));
    const W = 420;
    const xr = { min: Math.min(lo, edges[0]), max: Math.max(hi, edges[edges.length - 1]) };
    let html = '';
    // ---- box plot (above) ----
    if (ctx.opt(K('box'), true)) {
      const p = Plot.frame({ w: W, h: 56, x: xr, y: { min: 0, max: 1 }, noYAxis: true, noXAxis: true, ml: 58, grid: false, mb: 4, mt: 4 });
      p.add(Plot.boxPlot(p, t, rows, vals, { center: (p.T + p.B) / 2, width: 20 }));
      html += `<div class="gwrap">${p.svg()}</div>`;
    }
    // ---- histogram ----
    if (ctx.opt(K('hist'), true)) {
      const counts = edges.slice(0, -1).map(() => []);
      rows.forEach((r, i) => { let k = Math.floor((vals[i] - edges[0]) / bw + 1e-9); k = Math.min(Math.max(k, 0), counts.length - 1); counts[k].push(r); });
      const maxc = Math.max(...counts.map(c => c.length));
      let ymax = maxc * 1.08;
      if (ctx.opt(K('fitn'))) ymax = Math.max(ymax, n * bw * S.normPdf(m, m, sd) * 1.05);
      const p = Plot.frame({ w: W, h: 230, x: xr, y: { min: 0, max: ymax, pad: false }, yLabel: ctx.opt(K('count'), true) ? 'Count' : '', ml: 58 });
      counts.forEach((c, k) => { if (c.length) p.add(Plot.bar(t, p.X(edges[k]), p.Y(0), p.X(edges[k + 1]), p.Y(c.length), c)); });
      if (ctx.opt(K('fitn'))) {
        const pts = []; for (let i = 0; i <= 80; i++) { const x = p.xt.lo + (p.xt.hi - p.xt.lo) * i / 80; pts.push([p.X(x), p.Y(n * bw * S.normPdf(x, m, sd))]); }
        p.add(Plot.line(pts, 'fit', 'stroke:#d9412b'));
      }
      if (ctx.opt(K('kde')) || ctx.opt(K('shadow'))) {
        const h = 1.06 * sd * n ** -0.2; const pts = [];
        for (let i = 0; i <= 100; i++) { const x = p.xt.lo + (p.xt.hi - p.xt.lo) * i / 100; let d = 0; for (const v of vals) d += S.normPdf(x, v, h); pts.push([p.X(x), p.Y(bw * d)]); }
        p.add(Plot.line(pts, 'fit', 'stroke:#2e9a3a'));
      }
      if (isNum(ctx.opt(K('mu0')))) p.add(Plot.vline(p, ctx.opt(K('mu0')), 'ref', 'stroke:#8e44ad;stroke-dasharray:4 3'));
      html += `<div class="gwrap">${p.svg()}</div>`;
    }
    // ---- normal quantile plot ----
    if (ctx.opt(K('nq'))) {
      const order = rows.map((r, i) => i).sort((a, b) => vals[a] - vals[b]);
      const q = order.map((_, k) => S.normInv((k + 1) / (n + 1)));
      const p = Plot.frame({ w: W, h: 170, x: xr, y: { min: Math.min(...q), max: Math.max(...q) }, yLabel: 'Normal Quantile', ml: 58 });
      p.add(`<line class="fit" style="stroke:#d9412b" x1="${p.X(m + sd * p.yt.lo)}" y1="${p.Y(p.yt.lo)}" x2="${p.X(m + sd * p.yt.hi)}" y2="${p.Y(p.yt.hi)}"/>`);
      order.forEach((i, k) => p.add(Plot.pt(t, rows[i], p.X(vals[i]), p.Y(q[k]))));
      html += ctx.outline('Normal Quantile Plot', `<div class="gwrap">${p.svg()}</div>`, { key: 'nq' + ci });
    }
    // ---- CDF ----
    if (ctx.opt(K('cdf'))) {
      const p = Plot.frame({ w: W, h: 190, x: xr, y: { min: 0, max: 1, pad: false }, yLabel: 'Cum Prob', xLabel: col.name, ml: 58 });
      const pts = [[p.X(p.xt.lo), p.Y(0)]];
      s.forEach((v, i) => { pts.push([p.X(v), p.Y(i / n)]); pts.push([p.X(v), p.Y((i + 1) / n)]); });
      pts.push([p.X(p.xt.hi), p.Y(1)]);
      p.add(Plot.line(pts, 'fit', 'stroke:#2f6bc6'));
      html += ctx.outline('CDF Plot', `<div class="gwrap">${p.svg()}</div>`, { key: 'cdf' + ci });
    }
    // ---- quantiles ----
    if (ctx.opt(K('q'), true)) {
      const Q = [[1, 'maximum'], [0.995, ''], [0.975, ''], [0.9, ''], [0.75, 'quartile'], [0.5, 'median'], [0.25, 'quartile'], [0.1, ''], [0.025, ''], [0.005, ''], [0, 'minimum']];
      html += ctx.outline('Quantiles', ctx.table([{ h: '' }, { h: '' }, { h: '' }], Q.map(([p, lab]) => [(p * 100).toFixed(1) + '%', lab, p === 1 ? s[n - 1] : p === 0 ? s[0] : S.quantile(s, p)]), { cls: 'noh' }), { key: 'q' + ci });
    }
    // ---- summary statistics ----
    if (ctx.opt(K('ss'), true)) {
      const se = sd / Math.sqrt(n), tc = n > 1 ? S.tInv(0.975, n - 1) : NaN;
      const rowsSS = [['Mean', m], ['Std Dev', sd], ['Std Err Mean', se], ['Upper 95% Mean', m + tc * se], ['Lower 95% Mean', m - tc * se], ['N', n]];
      if (ctx.opt(K('allss'))) rowsSS.push(['N Missing', nMiss], ['Sum', S.sum(vals)], ['Variance', sd * sd], ['Skewness', S.skewness(vals)], ['Kurtosis', S.kurtosis(vals)], ['CV', 100 * sd / m], ['Minimum', s[0]], ['Maximum', s[n - 1]], ['Median', S.quantile(s, 0.5)], ['Range', s[n - 1] - s[0]], ['Interquartile Range', S.quantile(s, 0.75) - S.quantile(s, 0.25)], ['Mode', (() => { const c = new Map(); let best = s[0], bc = 0; for (const v of s) { const k = (c.get(v) || 0) + 1; c.set(v, k); if (k > bc) { bc = k; best = v; } } return best; })()]);
      html += ctx.outline('Summary Statistics', ctx.kv(rowsSS), { key: 'ss' + ci });
    }
    // ---- fitted normal ----
    if (ctx.opt(K('fitn'))) {
      const se = sd / Math.sqrt(n), tc = S.tInv(0.975, n - 1);
      const sw = S.shapiroWilk(vals);
      let c = ctx.table(['Type', 'Parameter', 'Estimate', 'Lower 95%', 'Upper 95%'], [
        ['Location', 'μ', m, m - tc * se, m + tc * se],
        ['Dispersion', 'σ', sd, sd * Math.sqrt((n - 1) / S.chi2Inv(0.975, n - 1)), sd * Math.sqrt((n - 1) / S.chi2Inv(0.025, n - 1))]], { title: 'Parameter Estimates' });
      c += `<div class="small">-2log(Likelihood) = ${fmt(n * Math.log(2 * Math.PI * sd * sd * (n - 1) / n) + n)}</div>`;
      if (sw) c += ctx.outline('Goodness-of-Fit Test', `<div class="small">Shapiro-Wilk W Test</div>` + ctx.table(['W', 'Prob&lt;W'], [[sw.W, { p: sw.p }]]) + `<div class="small mut">Note: H0 = The data is from the Normal distribution. Small p-values reject H0.</div>`, { key: 'gof' + ci });
      html += ctx.outline('Fitted Normal Distribution', c, { key: 'fn' + ci, menu: [ctx.act('Remove Fit', () => { ctx.rep.opts[K('fitn')] = false; })] });
    }
    // ---- test mean ----
    if (isNum(ctx.opt(K('mu0')))) {
      const mu0 = ctx.opt(K('mu0')), sig0 = ctx.opt(K('sig0'));
      const se = (isNum(sig0) && sig0 > 0 ? sig0 : sd) / Math.sqrt(n);
      const tt = (m - mu0) / se, df = n - 1;
      const z = isNum(sig0) && sig0 > 0;
      const pTwo = z ? 2 * (1 - S.normCdf(Math.abs(tt))) : S.tP2(tt, df);
      const pGt = z ? 1 - S.normCdf(tt) : 1 - S.tCdf(tt, df);
      // Wilcoxon signed rank
      const d = vals.map(v => v - mu0).filter(v => v !== 0);
      const rk = S.ranks(d.map(Math.abs)); let Wp = 0; d.forEach((v, i) => { if (v > 0) Wp += rk[i]; });
      const nd = d.length, ew = nd * (nd + 1) / 4, vw = nd * (nd + 1) * (2 * nd + 1) / 24 - rk.ties.reduce((a, tt2) => a + (tt2 ** 3 - tt2) / 48, 0);
      const zw = (Wp - ew) / Math.sqrt(vw);
      const c = `<div class="small">Hypothesized Value ${fmt(mu0)}<br>Actual Estimate ${fmt(m)}<br>DF ${df}<br>Std Dev ${fmt(sd)}</div>` +
        ctx.table(['', z ? 'z Test' : 't Test', 'Signed-Rank'], [['Test Statistic', tt, Wp - ew], ['Prob > |t|', { p: pTwo }, { p: 2 * (1 - S.normCdf(Math.abs(zw))) }], ['Prob > t', { p: pGt }, { p: 1 - S.normCdf(zw) }], ['Prob < t', { p: 1 - pGt }, { p: S.normCdf(zw) }]]);
      html += ctx.outline(`Test Mean`, c, { key: 'tm' + ci, menu: [ctx.act('Remove Test', () => { ctx.rep.opts[K('mu0')] = null; })] });
    }
    if (ctx.opt(K('ci'))) {
      const se = sd / Math.sqrt(n), tc = S.tInv(0.975, n - 1);
      html += ctx.outline('Confidence Intervals', ctx.table(['Parameter', 'Estimate', 'Lower CI', 'Upper CI', '1-Alpha'], [
        ['Mean', m, m - tc * se, m + tc * se, 0.95],
        ['Std Dev', sd, sd * Math.sqrt((n - 1) / S.chi2Inv(0.975, n - 1)), sd * Math.sqrt((n - 1) / S.chi2Inv(0.025, n - 1)), 0.95]]), { key: 'ci' + ci });
    }
    if (ctx.opt(K('pi'))) {
      const k = ctx.opt(K('pi')); const tc = S.tInv(1 - 0.025 / k, n - 1); const hw = tc * sd * Math.sqrt(1 + 1 / n);
      html += ctx.outline('Prediction Interval', ctx.table(['', 'Estimate', 'Lower PI', 'Upper PI', '1-Alpha'], [[`Individual (${k} future)`, m, m - hw, m + hw, 0.95]]), { key: 'pi' + ci });
    }
    if (ctx.opt(K('ti'))) {
      // two-sided normal tolerance interval (Howe approximation): 90% coverage, 95% confidence
      const z = S.normInv(0.95), chi = S.chi2Inv(0.05, n - 1);
      const kf = Math.sqrt((n - 1) * (1 + 1 / n) * z * z / chi);
      html += ctx.outline('Tolerance Interval', ctx.table(['Proportion', 'Lower TI', 'Upper TI', '1-Alpha'], [[0.9, m - kf * sd, m + kf * sd, 0.95]]), { key: 'ti' + ci });
    }
    return ctx.outline(esc(col.name), html, { menu, key: 'd' + ci, cls: 'distcol' });
  },
  cat(ctx, ci) {
    const t = ctx.t, col = t.columns[ci], K = k => ci + ':' + k;
    const all = this.rowsFor(ctx);
    const rows = all.filter(r => !DataTable.isMissing(col.values[r]));
    let levels = t.levels(ci, rows);
    const groups = new Map(levels.map(l => [String(l), []]));
    rows.forEach(r => groups.get(String(col.values[r])).push(r));
    if (ctx.opt(K('ordc'))) levels = [...levels].sort((a, b) => groups.get(String(b)).length - groups.get(String(a)).length);
    const n = rows.length;
    const menu = [
      { label: 'Display Options', submenu: [ctx.check('Frequencies', K('freq'), true), ctx.check('Horizontal Layout', K('horiz')), ctx.check('Order By Count', K('ordc')), ctx.check('Count Axis', K('cax'), true)] },
      ctx.check('Confidence Interval', K('ci')), ctx.check('Mosaic Plot', K('mos')),
      ctx.act('Test Probabilities (equal)', () => { ctx.rep.opts[K('tp')] = !ctx.opt(K('tp')); }),
      '-',
      { label: 'Save', submenu: [ctx.act('Level Numbers', () => { const idx = new Map(t.levels(ci).map((l, i) => [String(l), i + 1])); saveColumn(t, 'Level ' + col.name, col.values.map(v => DataTable.isMissing(v) ? NaN : idx.get(String(v)))); return false; })] },
    ];
    let html = '';
    const maxc = Math.max(1, ...levels.map(l => groups.get(String(l)).length));
    const p = Plot.frame({ w: 420, h: 240, x: { levels }, y: { min: 0, max: maxc * 1.08, pad: false }, yLabel: ctx.opt(K('cax'), true) ? 'Count' : '' });
    levels.forEach((l, i) => { const g = groups.get(String(l)); const x0 = p.L + p.xb * i + p.xb * 0.06, x1 = p.L + p.xb * (i + 1) - p.xb * 0.06; p.add(Plot.bar(t, x0, p.Y(0), x1, p.Y(g.length), g, { fill: col.modelingType === 'ordinal' ? '#86c08d' : '#e3917f' })); });
    html += `<div class="gwrap">${p.svg()}</div>`;
    if (ctx.opt(K('mos'))) {
      let x = 0; let s = '';
      levels.forEach((l, i) => { const g = groups.get(String(l)); const w = 380 * g.length / n; s += `<rect class="bar" x="${20 + x}" y="10" width="${w}" height="34" fill="${PALETTE[i % PALETTE.length]}" data-rows="${g.join(',')}"/>`; x += w; });
      html += ctx.outline('Mosaic Plot', `<svg class="plot" width="420" height="54">${s}</svg>`, { key: 'mos' + ci });
    }
    if (ctx.opt(K('freq'), true)) {
      const rowsT = levels.map(l => { const c = groups.get(String(l)).length, pr = c / n; return [String(l), c, pr, Math.sqrt(pr * (1 - pr) / n), c / n * 100]; });
      rowsT.push(Object.assign(['Total', n, 1, 0, 100], { cls: 'tot' }));
      html += ctx.outline('Frequencies', ctx.table([{ h: 'Level', a: 'l' }, 'Count', 'Prob', 'StdErr Prob', 'Cum %'], rowsT.map((r, i) => i < levels.length ? [r[0], r[1], r[2], r[3], rowsT.slice(0, i + 1).reduce((a, x) => a + x[2], 0) * 100] : r)) +
        `<div class="small">N Missing ${all.length - rows.length}<br>${levels.length} Levels</div>`, { key: 'fq' + ci });
    }
    if (ctx.opt(K('ci'))) {
      const z = 1.96;
      html += ctx.outline('Confidence Intervals', ctx.table([{ h: 'Level', a: 'l' }, 'Count', 'Prob', 'Lower CI', 'Upper CI', '1-Alpha'], levels.map(l => {
        const c = groups.get(String(l)).length, ph = c / n;
        const den = 1 + z * z / n, cen = (ph + z * z / (2 * n)) / den, hw = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den;
        return [String(l), c, ph, cen - hw, cen + hw, 0.95];
      })) + '<div class="small mut">Score (Wilson) confidence intervals</div>', { key: 'cci' + ci });
    }
    if (ctx.opt(K('tp'))) {
      const k = levels.length, e = n / k;
      let x2 = 0, g2 = 0;
      for (const l of levels) { const o = groups.get(String(l)).length; x2 += (o - e) ** 2 / e; if (o) g2 += 2 * o * Math.log(o / e); }
      html += ctx.outline('Test Probabilities', ctx.table(['Test', 'ChiSquare', 'DF', 'Prob&gt;Chisq'], [['Likelihood Ratio', g2, k - 1, { p: S.chi2Surv(g2, k - 1) }], ['Pearson', x2, k - 1, { p: S.chi2Surv(x2, k - 1) }]]) + '<div class="small mut">H0: all levels have equal probability.</div>', { key: 'tp' + ci });
    }
    return ctx.outline(esc(col.name), html, { menu, key: 'd' + ci, cls: 'distcol' });
  },
};
