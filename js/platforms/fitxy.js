'use strict';
/* Fit Y by X: Bivariate, Oneway, Contingency and Logistic, chosen by modeling types. */

const FIT_COLORS = ['#d9412b', '#2f6bc6', '#2e9a3a', '#8e44ad', '#f39c12', '#16a2b8'];

Platforms.fitxy = {
  title: s => s.kind || 'Fit Y by X',
  w: 760, h: 640,
  launch(t, preset) {
    return UI.launch({
      title: preset ? preset.title : 'Fit Y by X', table: t, recallKey: 'fitxy',
      roles: [{ key: 'y', label: 'Y, Response', required: true }, { key: 'x', label: 'X, Factor', required: true }, { key: 'by', label: 'By', max: 1 }],
      help: '<table class="rt"><tr><th>Y \\ X</th><th>Continuous</th><th>Categorical</th></tr><tr><td>Continuous</td><td>Bivariate</td><td>Oneway</td></tr><tr><td>Categorical</td><td>Logistic</td><td>Contingency</td></tr></table>',
    }).then(r => r && App.byLaunch(t, 'fitxy', { y: r.roles.y, x: r.roles.x }, r.roles.by));
  },
  render(ctx) {
    const out = [];
    for (const yi of ctx.spec.y) for (const xi of ctx.spec.x) {
      const yc = ctx.t.isCat(yi), xc = ctx.t.isCat(xi);
      out.push(!yc && !xc ? this.biv(ctx, yi, xi) : !yc && xc ? this.oneway(ctx, yi, xi) : yc && xc ? this.contin(ctx, yi, xi) : this.logit(ctx, yi, xi));
    }
    return out.join('');
  },
  K: (yi, xi) => k => `${yi}_${xi}:${k}`,
  by: ctx => ctx.spec.by ? ' ' + esc(ctx.spec.by.label) : '',

  // ======================= Bivariate =======================
  biv(ctx, yi, xi) {
    const t = ctx.t, K = this.K(yi, xi), yn = ctx.cn(yi), xn = ctx.cn(xi);
    const rows = t.complete([yi, xi], ctx.rows).filter(r => isNum(t.columns[yi].values[r]) && isNum(t.columns[xi].values[r]));
    const xs = t.vals(xi, rows), ys = t.vals(yi, rows), n = rows.length;
    const fits = ctx.opt(K('fits'), []), ells = ctx.opt(K('ell'), []);
    const setFits = f => { ctx.rep.opts[K('fits')] = f; ctx.rep.render(); };
    const addFit = f => ({ label: f.label, action: () => setFits([...ctx.opt(K('fits'), []), f]) });
    const menu = [
      ctx.check('Show Points', K('pts'), true),
      addFit({ label: 'Fit Mean', deg: 0 }), addFit({ label: 'Fit Line', deg: 1 }),
      { label: 'Fit Polynomial', submenu: [2, 3, 4, 5].map(d => addFit({ label: `${d}, ${['', '', 'quadratic', 'cubic', 'quartic', '5th'][d]}`, deg: d })) },
      ctx.check('Fit Spline (smoother)', K('spline')),
      { label: 'Density Ellipse', submenu: [0.5, 0.9, 0.95, 0.99].map(a => ({ label: String(a), checked: ells.includes(a), action: () => { ctx.rep.opts[K('ell')] = ells.includes(a) ? ells.filter(x => x !== a) : [...ells, a]; ctx.rep.render(); } })) },
      ctx.check('Histogram Borders', K('hb')),
      '-', ctx.act('Remove All Fits', () => { ctx.rep.opts[K('fits')] = []; ctx.rep.opts[K('ell')] = []; ctx.rep.opts[K('spline')] = false; }),
    ];
    if (n < 2) return ctx.outline(`Bivariate Fit of ${esc(yn)} By ${esc(xn)}${this.by(ctx)}`, ctx.note('Not enough data.'), { menu });
    const p = Plot.frame({ w: 440, h: 360, x: { min: S.min(xs), max: S.max(xs) }, y: { min: S.min(ys), max: S.max(ys) }, xLabel: xn, yLabel: yn });
    const xm = S.mean(xs);
    const design = (x, deg) => { const r = [1]; if (deg >= 1) r.push(x); for (let d = 2; d <= deg; d++) r.push((x - xm) ** d); return r; };
    let reports = '';
    fits.forEach((f, fi) => {
      const color = FIT_COLORS[fi % FIT_COLORS.length];
      const X = xs.map(x => design(x, f.deg));
      const m = S.ols(X, ys);
      if (!m) { reports += ctx.note('Fit is singular.'); return; }
      const grid = []; for (let i = 0; i <= 120; i++) grid.push(p.xt.lo + (p.xt.hi - p.xt.lo) * i / 120);
      const yhat = x => S.dot(design(x, f.deg), m.b);
      p.add(Plot.line(grid.map(x => [p.X(x), p.Y(yhat(x))]), 'fit', `stroke:${color}`));
      const tc = S.tInv(0.975, m.dfe);
      if (f.cf || f.ci) for (const [flag, extra] of [[f.cf, 0], [f.ci, 1]]) {
        if (!flag) continue;
        for (const sg of [-1, 1]) p.add(Plot.line(grid.map(x => { const d = design(x, f.deg); return [p.X(x), p.Y(yhat(x) + sg * tc * Math.sqrt(m.mse * (extra + S.quad(m.inv, d))))]; }), 'fit', `stroke:${color};stroke-dasharray:${extra ? '2 3' : '5 3'};stroke-width:1`));
      }
      // report
      const name = f.deg === 0 ? 'Fit Mean' : f.deg === 1 ? 'Linear Fit' : `Polynomial Fit Degree=${f.deg}`;
      const termNames = ['Intercept', xn, ...Array.from({ length: Math.max(0, f.deg - 1) }, (_, i) => `(${xn}-${fmt(xm, 5)})^${i + 2}`)].slice(0, m.b.length);
      const eq = `${esc(yn)} = ${m.b.map((b, i) => (i === 0 ? fmt(b, 6) : `${b < 0 ? '- ' : '+ '}${fmt(Math.abs(b), 6)}*${esc(termNames[i])}`)).join(' ')}`;
      let c = `<div class="eq" style="border-left:4px solid ${color}">${eq}</div>`;
      if (f.deg === 0) {
        c += ctx.kv([['Mean', m.b[0]], ['Std Dev [RMSE]', m.rmse], ['Std Error', m.se[0]], ['SSE', m.sse]]);
      } else {
        c += ctx.outline('Summary of Fit', ctx.kv([['RSquare', m.r2], ['RSquare Adj', m.adj], ['Root Mean Square Error', m.rmse], ['Mean of Response', m.ybar], ['Observations (or Sum Wgts)', n]]), { key: K('sf' + fi) });
        // lack of fit when replicates exist
        const reps = new Map(); xs.forEach((x, i) => { const k = String(x); if (!reps.has(k)) reps.set(k, []); reps.get(k).push(ys[i]); });
        if (reps.size < n && reps.size > m.b.length) {
          let pe = 0; for (const g of reps.values()) { const gm = S.mean(g); for (const v of g) pe += (v - gm) ** 2; }
          const dfpe = n - reps.size, dflof = m.dfe - dfpe, lof = m.sse - pe;
          if (dfpe > 0 && dflof > 0) {
            const F = (lof / dflof) / (pe / dfpe);
            c += ctx.outline('Lack Of Fit', ctx.table(['Source', 'DF', 'Sum of Squares', 'Mean Square', 'F Ratio'], [['Lack Of Fit', dflof, lof, lof / dflof, F], ['Pure Error', dfpe, pe, pe / dfpe, { h: `Prob &gt; F<br>${fmtP(S.fSurv(F, dflof, dfpe))}`, c: 'n' }], ['Total Error', m.dfe, m.sse, '', '']]), { key: K('lof' + fi), closed: true });
          }
        }
        c += ctx.outline('Analysis of Variance', ctx.table([{ h: 'Source', a: 'l' }, 'DF', 'Sum of Squares', 'Mean Square', 'F Ratio', 'Prob &gt; F'],
          [['Model', m.dfm, m.ssm, m.ssm / m.dfm, m.F, { p: m.pF }], ['Error', m.dfe, m.sse, m.mse, '', ''], ['C. Total', n - 1, m.sst, '', '', '']]), { key: K('av' + fi) });
        c += ctx.outline('Parameter Estimates', ctx.table([{ h: 'Term', a: 'l' }, 'Estimate', 'Std Error', 't Ratio', 'Prob&gt;|t|'], m.b.map((b, i) => [termNames[i], b, m.se[i], m.t[i], { p: m.p[i] }])), { key: K('pe' + fi) });
      }
      if (f.res) {
        const rp = Plot.frame({ w: 400, h: 200, x: { min: S.min(xs), max: S.max(xs) }, y: { min: S.min(m.resid), max: S.max(m.resid) }, xLabel: xn, yLabel: 'Residual' });
        rp.add(Plot.hline(rp, 0, 'ref')); rows.forEach((r, i) => rp.add(Plot.pt(t, r, rp.X(xs[i]), rp.Y(m.resid[i]))));
        c += ctx.outline('Diagnostics Plots', `<div class="gwrap">${rp.svg()}</div>`, { key: K('res' + fi) });
      }
      const upd = patch => { const arr = [...ctx.opt(K('fits'), [])]; arr[fi] = { ...arr[fi], ...patch }; setFits(arr); };
      const save = (lab, vals) => ({ label: lab, action: () => { const out = t.columns[yi].values.map(() => NaN); rows.forEach((r, i) => out[r] = vals[i]); saveColumn(t, `${lab.replace('Save ', '')} ${yn}`, out); } });
      reports += ctx.outline(name, c, {
        key: K('fit' + fi), menu: [
          { label: 'Confid Curves Fit', checked: !!f.cf, action: () => upd({ cf: !f.cf }) },
          { label: 'Confid Curves Indiv', checked: !!f.ci, action: () => upd({ ci: !f.ci }) },
          { label: 'Plot Residuals', checked: !!f.res, action: () => upd({ res: !f.res }) },
          '-', save('Save Predicteds', m.pred), save('Save Residuals', m.resid),
          f.deg >= 1 ? { label: 'Save Prediction Formula', action: () => saveColumn(t, `Pred Formula ${yn}`, null, m.b.map((b, i) => i === 0 ? `${b}` : i === 1 ? `${b} * :"${xn}"` : `${b} * (:"${xn}" - ${xm})^${i}`).join(' + ')) } : null,
          '-', { label: 'Remove Fit', action: () => setFits(ctx.opt(K('fits'), []).filter((_, j) => j !== fi)) },
        ],
      });
    });
    if (ctx.opt(K('spline'))) {
      const lo = S.loess(xs, ys, 0.5, 80);
      p.add(Plot.line(lo.map(([x, y]) => [p.X(x), p.Y(y)]), 'fit', 'stroke:#16a2b8'));
      reports += ctx.outline('Smoothing Spline Fit (local regression, span=0.5)', `<div class="small">Local linear smoother with tricube weights.</div>`, { key: K('spl') });
    }
    ells.forEach((a, ei) => {
      const mx = S.mean(xs), my = S.mean(ys), sx = S.sd(xs), sy = S.sd(ys), r = S.corr(xs, ys);
      const c2 = Math.sqrt(S.chi2Inv(a, 2));
      const L11 = sx, L21 = r * sy, L22 = sy * Math.sqrt(Math.max(0, 1 - r * r));
      const pts = []; for (let i = 0; i <= 90; i++) { const th = 2 * Math.PI * i / 90; const u = Math.cos(th) * c2, v = Math.sin(th) * c2; pts.push([p.X(mx + L11 * u), p.Y(my + L21 * u + L22 * v)]); }
      p.add(Plot.line(pts, 'fit', `stroke:${FIT_COLORS[(ei + 3) % FIT_COLORS.length]};fill:${FIT_COLORS[(ei + 3) % FIT_COLORS.length]}22`));
      reports += ctx.outline(`Bivariate Normal Ellipse P=${a}`, ctx.table([{ h: 'Variable', a: 'l' }, 'Mean', 'Std Dev'], [[xn, mx, sx], [yn, my, sy]]) + ctx.table(['Correlation', 'Signif. Prob', 'Number'], [[r, { p: S.corrP(r, n) }, n]]), { key: K('ell' + a) });
    });
    if (ctx.opt(K('pts'), true)) rows.forEach((r, i) => p.add(Plot.pt(t, r, p.X(xs[i]), p.Y(ys[i]))));
    let plot = p.svg();
    if (ctx.opt(K('hb'))) {
      const hx = Plot.frame({ w: 440, h: 60, x: { ticks: p.xt }, y: { min: 0, max: 1 }, noYAxis: true, noXAxis: true, ml: p.L, mt: 2, mb: 2, grid: false });
      const { edges: ex } = Plot.bins(xs); const cx = ex.slice(0, -1).map(() => []); rows.forEach((r, i) => cx[Math.min(cx.length - 1, Math.floor((xs[i] - ex[0]) / (ex[1] - ex[0])))].push(r));
      const mxc = S.max(cx.map(c => c.length)); cx.forEach((c, k) => c.length && hx.add(Plot.bar(t, hx.X(ex[k]), hx.B, hx.X(ex[k + 1]), hx.B - (hx.B - hx.T) * c.length / mxc, c)));
      plot = `<div>${hx.svg()}</div>` + plot;
    }
    return ctx.outline(`Bivariate Fit of ${esc(yn)} By ${esc(xn)}${this.by(ctx)}`, `<div class="gwrap">${plot}</div>${reports}`, { menu, key: K('biv') });
  },

  // ======================= Oneway =======================
  oneway(ctx, yi, xi) {
    const t = ctx.t, K = this.K(yi, xi), yn = ctx.cn(yi), xn = ctx.cn(xi);
    const rows = t.complete([yi, xi], ctx.rows).filter(r => isNum(t.columns[yi].values[r]));
    const levels = t.levels(xi, rows);
    const gmap = new Map(levels.map(l => [String(l), { rows: [], vals: [] }]));
    rows.forEach(r => { const g = gmap.get(String(t.columns[xi].values[r])); g.rows.push(r); g.vals.push(t.columns[yi].values[r]); });
    const groups = levels.map(l => ({ level: l, ...gmap.get(String(l)) })).filter(g => g.vals.length);
    const ys = groups.flatMap(g => g.vals), n = ys.length;
    const o = (k, d = false) => ctx.opt(K(k), d);
    const menu = [
      ctx.check('Quantiles', K('quant')), { label: 'Means/Anova', checked: o('anova'), action: () => { const v = !o('anova'); ctx.rep.opts[K('anova')] = v; ctx.rep.opts[K('diam')] = v; ctx.rep.render(); } }, ctx.check('Means and Std Dev', K('msd')),
      ctx.check('t Test', K('ttest'), false, { disabled: groups.length !== 2 }),
      { label: 'Compare Means', submenu: [ctx.check("Each Pair, Student's t", K('pairs')), ctx.check('All Pairs, Tukey-Kramer (approx.)', K('tukey')), ctx.check('With Control, Dunnett (Bonferroni)', K('dunn'))] },
      { label: 'Nonparametric', submenu: [ctx.check('Wilcoxon / Kruskal-Wallis Tests', K('np'))] },
      ctx.check('Unequal Variances', K('uv')),
      ctx.check('Normal Quantile Plot', K('nq')),
      { label: 'Display Options', submenu: [ctx.check('Points Jittered', K('jit'), true), ctx.check('Box Plots', K('box')), ctx.check('Mean Diamonds', K('diam')), ctx.check('Mean Lines', K('ml')), ctx.check('Mean Error Bars', K('meb')), ctx.check('Std Dev Lines', K('sdl')), ctx.check('Connect Means', K('conn')), ctx.check('Grand Mean', K('gm'))] },
    ];
    const title = `Oneway Analysis of ${esc(yn)} By ${esc(xn)}${this.by(ctx)}`;
    if (groups.length < 1 || n < 2) return ctx.outline(title, ctx.note('Not enough data.'), { menu });
    const av = groups.length > 1 && n > groups.length ? S.anova1(groups.map(g => g.vals)) : null;
    const p = Plot.frame({ w: 460, h: 340, x: { levels: groups.map(g => g.level) }, y: { min: S.min(ys), max: S.max(ys) }, xLabel: xn, yLabel: yn });
    groups.forEach((g, gi) => {
      const cx = p.L + p.xb * (gi + 0.5);
      const m = S.mean(g.vals), sd = S.sd(g.vals), ni = g.vals.length;
      if (o('box')) p.add(Plot.boxPlot(p, t, g.rows, g.vals, { vertical: true, center: cx, width: Math.min(40, p.xb * 0.35), outliers: false, meanDiamond: false, color: '#555' }));
      if (o('diam') && av) {
        const hw = p.xb * 0.42 * ni / S.max(groups.map(x => x.vals.length));
        const ci = S.tInv(0.975, av.dfw) * Math.sqrt(av.msw / ni);
        p.add(`<polygon class="mdiam" points="${cx - hw},${p.Y(m)} ${cx},${p.Y(m + ci)} ${cx + hw},${p.Y(m)} ${cx},${p.Y(m - ci)}"/><line class="mdl" x1="${cx - hw}" x2="${cx + hw}" y1="${p.Y(m)}" y2="${p.Y(m)}"/>`);
      }
      if (o('ml')) p.add(`<line class="fit" style="stroke:#2f6bc6" x1="${cx - p.xb * 0.3}" x2="${cx + p.xb * 0.3}" y1="${p.Y(m)}" y2="${p.Y(m)}"/>`);
      if (o('meb') && ni > 1) { const se = sd / Math.sqrt(ni); p.add(`<path class="fit" style="stroke:#2f6bc6;stroke-width:1.3" d="M${cx + 8},${p.Y(m - se)}V${p.Y(m + se)}M${cx + 4},${p.Y(m - se)}h8M${cx + 4},${p.Y(m + se)}h8"/>`); }
      if (o('sdl') && ni > 1) p.add(`<line class="fit" style="stroke:#2f6bc6;stroke-dasharray:3 2" x1="${cx - p.xb * 0.2}" x2="${cx + p.xb * 0.2}" y1="${p.Y(m + sd)}" y2="${p.Y(m + sd)}"/><line class="fit" style="stroke:#2f6bc6;stroke-dasharray:3 2" x1="${cx - p.xb * 0.2}" x2="${cx + p.xb * 0.2}" y1="${p.Y(m - sd)}" y2="${p.Y(m - sd)}"/>`);
      const jw = o('jit', true) ? Math.min(p.xb * 0.3, 26) : 0;
      g.rows.forEach((r, i) => p.add(Plot.pt(t, r, cx + (hash01(r) - 0.5) * jw, p.Y(g.vals[i]))));
    });
    if (o('conn')) p.add(Plot.line(groups.map((g, gi) => [p.L + p.xb * (gi + 0.5), p.Y(S.mean(g.vals))]), 'fit', 'stroke:#d9412b'));
    if (o('gm') || o('anova')) p.add(Plot.hline(p, S.mean(ys), 'ref', 'stroke:#2e9a3a'));

    let html = `<div class="gwrap">${p.svg()}</div>`;
    if (o('nq')) {
      const np = Plot.frame({ w: 440, h: 260, x: { min: -3, max: 3 }, y: { min: S.min(ys), max: S.max(ys) }, xLabel: 'Normal Quantile', yLabel: yn });
      groups.forEach((g, gi) => {
        const ord = g.vals.map((v, i) => i).sort((a, b) => g.vals[a] - g.vals[b]);
        ord.forEach((i, k) => np.add(Plot.pt(t, g.rows[i], np.X(S.normInv((k + 1) / (ord.length + 1))), np.Y(g.vals[i]), { color: PALETTE[gi % PALETTE.length] })));
      });
      html += ctx.outline('Normal Quantile Plot', `<div class="gwrap">${np.svg()}${Plot.legend(groups.map((g, gi) => [String(g.level), PALETTE[gi % PALETTE.length]]))}</div>`, { key: K('nqp') });
    }
    if (o('quant')) {
      html += ctx.outline('Quantiles', ctx.table([{ h: 'Level', a: 'l' }, 'Minimum', '10%', '25%', 'Median', '75%', '90%', 'Maximum'], groups.map(g => { const s = S.sorted(g.vals); return [String(g.level), s[0], S.quantile(s, 0.1), S.quantile(s, 0.25), S.quantile(s, 0.5), S.quantile(s, 0.75), S.quantile(s, 0.9), s[s.length - 1]]; })), { key: K('qt') });
    }
    if (o('anova') && av) {
      const c = ctx.outline('Summary of Fit', ctx.kv([['Rsquare', av.r2], ['Adj Rsquare', 1 - (1 - av.r2) * (n - 1) / av.dfw], ['Root Mean Square Error', Math.sqrt(av.msw)], ['Mean of Response', av.gm], ['Observations (or Sum Wgts)', n]]), { key: K('sof') }) +
        ctx.outline('Analysis of Variance', ctx.table([{ h: 'Source', a: 'l' }, 'DF', 'Sum of Squares', 'Mean Square', 'F Ratio', 'Prob &gt; F'], [[xn, av.dfb, av.ssb, av.msb, av.F, { p: av.p }], ['Error', av.dfw, av.ssw, av.msw, '', ''], ['C. Total', n - 1, av.sst, '', '', '']]), { key: K('aov') }) +
        ctx.outline('Means for Oneway Anova', ctx.table([{ h: 'Level', a: 'l' }, 'Number', 'Mean', 'Std Error', 'Lower 95%', 'Upper 95%'], groups.map(g => { const ni = g.vals.length, m = S.mean(g.vals), se = Math.sqrt(av.msw / ni), tc = S.tInv(0.975, av.dfw); return [String(g.level), ni, m, se, m - tc * se, m + tc * se]; })) + '<div class="small mut">Std Error uses a pooled estimate of error variance</div>', { key: K('mfa') });
      html += ctx.outline('Oneway Anova', c, { key: K('ow') });
    }
    if (o('msd')) {
      html += ctx.outline('Means and Std Deviations', ctx.table([{ h: 'Level', a: 'l' }, 'Number', 'Mean', 'Std Dev', 'Std Err Mean', 'Lower 95%', 'Upper 95%'], groups.map(g => { const ni = g.vals.length, m = S.mean(g.vals), sd = S.sd(g.vals), se = sd / Math.sqrt(ni), tc = ni > 1 ? S.tInv(0.975, ni - 1) : NaN; return [String(g.level), ni, m, sd, se, m - tc * se, m + tc * se]; })), { key: K('msdt') });
    }
    if (o('ttest') && groups.length === 2) {
      const [a, b] = groups; const ma = S.mean(a.vals), mb = S.mean(b.vals), va = S.variance(a.vals), vb = S.variance(b.vals), na = a.vals.length, nb = b.vals.length;
      const se = Math.sqrt(va / na + vb / nb), df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
      const d = mb - ma, tt = d / se, tc = S.tInv(0.975, df);
      const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)), sep = sp * Math.sqrt(1 / na + 1 / nb), tp = d / sep, dfp = na + nb - 2;
      html += ctx.outline(`t Test`, `<div class="small">${esc(String(b.level))}-${esc(String(a.level))}<br>Assuming unequal variances</div>` +
        ctx.kv([['Difference', d], ['Std Err Dif', se], ['Upper CL Dif', d + tc * se], ['Lower CL Dif', d - tc * se], ['Confidence', 0.95], ['t Ratio', tt], ['DF', df], ['Prob &gt; |t|', fmtP(S.tP2(tt, df))], ['Prob &gt; t', fmtP(1 - S.tCdf(tt, df))], ['Prob &lt; t', fmtP(S.tCdf(tt, df))]]) +
        ctx.outline('Pooled t Test (assuming equal variances)', ctx.kv([['Difference', d], ['Std Err Dif', sep], ['t Ratio', tp], ['DF', dfp], ['Prob &gt; |t|', fmtP(S.tP2(tp, dfp))]]), { key: K('pt'), closed: true }), { key: K('tt') });
    }
    if ((o('pairs') || o('tukey') || o('dunn')) && av) {
      const k = groups.length, npairs = k * (k - 1) / 2;
      const mk = (label, crit, pfun, pairsList) => {
        const ordered = [...groups].sort((x, y) => S.mean(y.vals) - S.mean(x.vals));
        const rowsP = [];
        for (const [a, b] of pairsList(ordered)) {
          const d = S.mean(a.vals) - S.mean(b.vals), se = Math.sqrt(av.msw * (1 / a.vals.length + 1 / b.vals.length));
          const tt = d / se; rowsP.push([String(a.level), String(b.level), d, se, d - crit * se, d + crit * se, { p: pfun(tt) }]);
        }
        rowsP.sort((x, y) => y[2] - x[2]);
        // connecting letters: maximal runs of ordered means with no significant pair inside
        const sig = new Set(rowsP.filter(r => r[6].p < 0.05).map(r => r[0] + '|' + r[1]));
        const isSig = (a, b) => sig.has(a + '|' + b) || sig.has(b + '|' + a);
        const lv = ordered.map(g => String(g.level));
        const letters = ordered.map(() => '');
        let lastJ = -1, L = 0;
        for (let i = 0; i < lv.length; i++) {
          let j = i;
          while (j + 1 < lv.length && !lv.slice(i, j + 1).some(x => isSig(x, lv[j + 1]))) j++;
          if (j > lastJ) { const ch = String.fromCharCode(65 + (L++ % 26)); for (let q = i; q <= j; q++) letters[q] += ch; lastJ = j; }
        }
        const cl = ctx.table([{ h: 'Level', a: 'l' }, '', 'Mean'], ordered.map((g, i) => [String(g.level), { h: `<b>${letters[i]}</b>` }, S.mean(g.vals)])) + '<div class="small mut">Levels not connected by same letter are significantly different.</div>';
        return ctx.outline(label, `<div class="small">Confidence Quantile ${fmt(crit)}  ·  Alpha 0.05</div>` + ctx.outline('Connecting Letters Report', cl, { key: K(label + 'cl') }) +
          ctx.outline('Ordered Differences Report', ctx.table([{ h: 'Level', a: 'l' }, { h: '- Level', a: 'l' }, 'Difference', 'Std Err Dif', 'Lower CL', 'Upper CL', 'p-Value'], rowsP), { key: K(label + 'od') }), { key: K(label) });
      };
      const allPairs = ord => { const out = []; for (let i = 0; i < ord.length; i++) for (let j = i + 1; j < ord.length; j++) out.push([ord[i], ord[j]]); return out; };
      if (o('pairs')) html += mk("Comparisons for each pair using Student's t", S.tInv(0.975, av.dfw), tt => S.tP2(tt, av.dfw), allPairs);
      if (o('tukey')) {
        // Tukey-Kramer approximated by Bonferroni-adjusted t (conservative)
        const crit = S.tInv(1 - 0.025 / npairs, av.dfw);
        html += mk('Comparisons for all pairs (Bonferroni-adjusted, Tukey-Kramer approx.)', crit, tt => Math.min(1, S.tP2(tt, av.dfw) * npairs), allPairs);
      }
      if (o('dunn')) {
        const ctrl = groups[0]; const crit = S.tInv(1 - 0.025 / (k - 1), av.dfw);
        html += mk(`Comparisons with a control (${esc(String(ctrl.level))}, Bonferroni)`, crit, tt => Math.min(1, S.tP2(tt, av.dfw) * (k - 1)), ord => ord.filter(g => g !== ctrl).map(g => [g, ctrl]));
      }
    }
    if (o('np') && groups.length > 1) {
      const allv = groups.flatMap(g => g.vals); const rk = S.ranks(allv); let off = 0; const N = allv.length;
      const rowsW = groups.map(g => { const rs = rk.slice(off, off + g.vals.length); off += g.vals.length; const sr = S.sum(rs), ni = g.vals.length, er = ni * (N + 1) / 2; return { l: String(g.level), ni, sr, er, mr: sr / ni }; });
      const tc = 1 - rk.ties.reduce((a, x) => a + x ** 3 - x, 0) / (N ** 3 - N);
      const H = (12 / (N * (N + 1)) * rowsW.reduce((a, w) => a + w.sr ** 2 / w.ni, 0) - 3 * (N + 1)) / (tc || 1);
      const vr = N * (N + 1) / 12 * tc;
      let c = ctx.table([{ h: 'Level', a: 'l' }, 'Count', 'Score Sum', 'Expected Score', 'Score Mean', '(Mean-Mean0)/Std0'], rowsW.map(w => [w.l, w.ni, w.sr, w.er, w.mr, (w.mr - (N + 1) / 2) / Math.sqrt(vr * (N - w.ni) / (w.ni * (N - 1)))]));
      if (groups.length === 2) {
        const w = rowsW[0].ni <= rowsW[1].ni ? rowsW[0] : rowsW[1];
        const n1 = w.ni, n2 = N - n1;
        const sdw = Math.sqrt(n1 * n2 / (N * (N - 1)) * (S.sum(rk.map(r => r * r)) - N * (N + 1) ** 2 / 4));
        const z = (w.sr - w.er + (w.sr < w.er ? 0.5 : -0.5)) / sdw;
        c += ctx.outline('2-Sample Test, Normal Approximation', ctx.table(['S', 'Z', 'Prob&gt;|Z|'], [[w.sr, z, { p: 2 * (1 - S.normCdf(Math.abs(z))) }]]), { key: K('w2') });
      }
      c += ctx.outline('1-way Test, ChiSquare Approximation', ctx.table(['ChiSquare', 'DF', 'Prob&gt;ChiSq'], [[H, groups.length - 1, { p: S.chi2Surv(H, groups.length - 1) }]]), { key: K('kw') });
      html += ctx.outline('Wilcoxon / Kruskal-Wallis Tests (Rank Sums)', c, { key: K('npw') });
    }
    if (o('uv') && groups.length > 1) {
      const N = n, k = groups.length;
      const dev = fn => groups.map(g => { const c = fn(g.vals); return g.vals.map(v => Math.abs(v - c)); });
      const lv = S.anova1(dev(S.mean)), bf = S.anova1(dev(S.median));
      const sp2 = groups.reduce((a, g) => a + (g.vals.length - 1) * S.variance(g.vals), 0) / (N - k);
      const B = ((N - k) * Math.log(sp2) - groups.reduce((a, g) => a + (g.vals.length - 1) * Math.log(S.variance(g.vals)), 0)) / (1 + (groups.reduce((a, g) => a + 1 / (g.vals.length - 1), 0) - 1 / (N - k)) / (3 * (k - 1)));
      const w = groups.map(g => g.vals.length / S.variance(g.vals)), W = S.sum(w), mw = S.sum(groups.map((g, i) => w[i] * S.mean(g.vals))) / W;
      const lam = S.sum(groups.map((g, i) => (1 - w[i] / W) ** 2 / (g.vals.length - 1)));
      const Fw = (S.sum(groups.map((g, i) => w[i] * (S.mean(g.vals) - mw) ** 2)) / (k - 1)) / (1 + 2 * (k - 2) * lam / (k * k - 1));
      const dfw2 = (k * k - 1) / (3 * lam);
      html += ctx.outline('Tests that the Variances are Equal',
        ctx.table([{ h: 'Level', a: 'l' }, 'Count', 'Std Dev', 'MeanAbsDif to Mean', 'MeanAbsDif to Median'], groups.map(g => [String(g.level), g.vals.length, S.sd(g.vals), S.mean(g.vals.map(v => Math.abs(v - S.mean(g.vals)))), S.mean(g.vals.map(v => Math.abs(v - S.median(g.vals))))])) +
        ctx.table([{ h: 'Test', a: 'l' }, 'F Ratio', 'DFNum', 'DFDen', 'p-Value'], [['Brown-Forsythe', bf.F, bf.dfb, bf.dfw, { p: bf.p }], ['Levene', lv.F, lv.dfb, lv.dfw, { p: lv.p }], ['Bartlett', B / (k - 1), k - 1, '•', { p: S.chi2Surv(B, k - 1) }]]) +
        ctx.outline('Welch\'s Test', `<div class="small">Welch Anova testing Means Equal, allowing Std Devs Not Equal</div>` + ctx.table(['F Ratio', 'DFNum', 'DFDen', 'Prob &gt; F'], [[Fw, k - 1, dfw2, { p: S.fSurv(Fw, k - 1, dfw2) }]]), { key: K('welch') }), { key: K('uvt') });
    }
    return ctx.outline(title, html, { menu, key: K('ow1') });
  },

  // ======================= Contingency =======================
  contin(ctx, yi, xi) {
    const t = ctx.t, K = this.K(yi, xi), yn = ctx.cn(yi), xn = ctx.cn(xi);
    const rows = t.complete([yi, xi], ctx.rows);
    const xl = t.levels(xi, rows), yl = t.levels(yi, rows);
    const cell = xl.map(() => yl.map(() => []));
    const xix = new Map(xl.map((l, i) => [String(l), i])), yix = new Map(yl.map((l, i) => [String(l), i]));
    rows.forEach(r => cell[xix.get(String(t.columns[xi].values[r]))][yix.get(String(t.columns[yi].values[r]))].push(r));
    const N = rows.length, rt = cell.map(r => r.reduce((a, c) => a + c.length, 0)), ct = yl.map((_, j) => cell.reduce((a, r) => a + r[j].length, 0));
    const menu = [ctx.check('Mosaic Plot', K('mos'), true), ctx.check('Contingency Table', K('ct'), true), ctx.check('Tests', K('tests'), true),
      ctx.check("Fisher's Exact Test", K('fisher'), xl.length === 2 && yl.length === 2), ctx.check('Analysis of Means for Proportions', K('anomp')), ctx.check('Correspondence Analysis', K('ca'))];
    const title = `Contingency Analysis of ${esc(yn)} By ${esc(xn)}${this.by(ctx)}`;
    if (!N) return ctx.outline(title, ctx.note('No data.'), { menu });
    let html = '';
    if (ctx.opt(K('mos'), true)) {
      const p = Plot.frame({ w: 440, h: 320, x: { min: 0, max: 1, pad: false }, y: { min: 0, max: 1, pad: false }, noXAxis: true, mb: 46, yLabel: yn, grid: false });
      let x = 0; const gap = 0.006 * (xl.length > 1 ? 1 : 0);
      const W = 1 - gap * (xl.length - 1);
      let labels = '';
      xl.forEach((lv, i) => {
        const w = W * rt[i] / N; let y = 0;
        yl.forEach((_, j) => {
          const h = rt[i] ? cell[i][j].length / rt[i] : 0;
          if (h > 0) p.add(Plot.bar(t, p.X(x), p.Y(y), p.X(x + w), p.Y(y + h), cell[i][j], { fill: PALETTE[j % PALETTE.length] }));
          y += h;
        });
        labels += `<text class="tl" x="${p.X(x + w / 2)}" y="${p.B + 14}" text-anchor="middle">${esc(String(lv).slice(0, 12))}</text>`;
        x += w + gap;
      });
      p.over.push(labels + `<text class="axl" x="${(p.L + p.R) / 2}" y="${p.H - 8}" text-anchor="middle">${esc(xn)}</text>`);
      html += ctx.outline('Mosaic Plot', `<div class="gwrap flex">${p.svg()}${Plot.legend(yl.map((l, j) => [String(l), PALETTE[j % PALETTE.length]]))}</div>`, { key: K('mosp') });
    }
    if (ctx.opt(K('ct'), true)) {
      const show = { c: ctx.opt(K('cnt'), true), t: ctx.opt(K('tp'), true), col: ctx.opt(K('colp'), true), row: ctx.opt(K('rowp'), true), e: ctx.opt(K('exp')), d: ctx.opt(K('dev')), x2: ctx.opt(K('cx2')) };
      const lines = (i, j) => {
        const c = cell[i][j].length, e = rt[i] * ct[j] / N; const out = [];
        if (show.c) out.push(c); if (show.t) out.push((100 * c / N).toFixed(2)); if (show.col) out.push(ct[j] ? (100 * c / ct[j]).toFixed(2) : '•'); if (show.row) out.push(rt[i] ? (100 * c / rt[i]).toFixed(2) : '•');
        if (show.e) out.push(fmt(e, 5)); if (show.d) out.push(fmt(c - e, 5)); if (show.x2) out.push(fmt(e ? (c - e) ** 2 / e : 0, 5));
        return `<td class="n ctc" data-rows="${cell[i][j].join(',')}">${out.join('<br>')}</td>`;
      };
      const keyLab = [show.c && 'Count', show.t && 'Total %', show.col && 'Col %', show.row && 'Row %', show.e && 'Expected', show.d && 'Deviation', show.x2 && 'Cell Chi^2'].filter(Boolean).join('<br>');
      const tb = `<table class="rt ctab"><thead><tr><th class="l small">${keyLab}</th>${yl.map(l => `<th>${esc(String(l))}</th>`).join('')}<th>Total</th></tr></thead><tbody>${xl.map((lv, i) => `<tr><th class="l">${esc(String(lv))}</th>${yl.map((_, j) => lines(i, j)).join('')}<td class="n">${rt[i]}<br>${(100 * rt[i] / N).toFixed(2)}</td></tr>`).join('')}<tr><th class="l">Total</th>${ct.map(c => `<td class="n">${c}<br>${(100 * c / N).toFixed(2)}</td>`).join('')}<td class="n">${N}</td></tr></tbody></table>`;
      html += ctx.outline('Contingency Table', `<div class="gwrap">${tb}</div>`, {
        key: K('ctt'), menu: [ctx.check('Count', K('cnt'), true), ctx.check('Total %', K('tp'), true), ctx.check('Col %', K('colp'), true), ctx.check('Row %', K('rowp'), true), ctx.check('Expected', K('exp')), ctx.check('Deviation', K('dev')), ctx.check('Cell Chi Square', K('cx2'))],
      });
    }
    if (ctx.opt(K('tests'), true)) {
      let x2 = 0, g2 = 0;
      xl.forEach((_, i) => yl.forEach((_, j) => { const o = cell[i][j].length, e = rt[i] * ct[j] / N; if (e > 0) x2 += (o - e) ** 2 / e; if (o > 0) g2 += 2 * o * Math.log(o / e); }));
      const df = (xl.length - 1) * (yl.length - 1);
      const llY = -ct.reduce((a, c) => a + (c ? c * Math.log(c / N) : 0), 0);
      const warn = xl.some((_, i) => yl.some((_, j) => rt[i] * ct[j] / N < 5)) ? '<div class="small warn">Warning: 20% of cells have expected count less than 5, ChiSquare suspect.</div>' : '';
      html += ctx.outline('Tests', ctx.table(['N', 'DF', '-LogLike', 'RSquare (U)'], [[N, df, g2 / 2, llY ? g2 / 2 / llY : NaN]]) +
        ctx.table([{ h: 'Test', a: 'l' }, 'ChiSquare', 'Prob&gt;ChiSq'], [['Likelihood Ratio', g2, { p: S.chi2Surv(g2, df) }], ['Pearson', x2, { p: S.chi2Surv(x2, df) }]]) + warn, { key: K('tst') });
    }
    if (ctx.opt(K('fisher'), xl.length === 2 && yl.length === 2) && xl.length === 2 && yl.length === 2) {
      const f = S.fisher2x2(cell[0][0].length, cell[0][1].length, cell[1][0].length, cell[1][1].length);
      html += ctx.outline("Fisher's Exact Test", ctx.table([{ h: 'Test', a: 'l' }, 'Prob', { h: 'Alternative Hypothesis', a: 'l' }], [['Left', { p: f.left }, `Prob(${yn}=${yl[1]}) is greater for ${xn}=${xl[0]} than ${xl[1]}`], ['Right', { p: f.right }, `Prob(${yn}=${yl[1]}) is greater for ${xn}=${xl[1]} than ${xl[0]}`], ['2-Tail', { p: f.two }, `Prob(${yn}=${yl[1]}) is different across ${xn}`]]), { key: K('fx') });
    }
    if (ctx.opt(K('ca')) && xl.length > 1 && yl.length > 1) {
      // correspondence analysis via eigen of standardized residual matrix
      const P = cell.map(r => r.map(c => c.length / N)), rm = rt.map(v => v / N), cm = ct.map(v => v / N);
      const Sm = P.map((r, i) => r.map((v, j) => (v - rm[i] * cm[j]) / Math.sqrt(rm[i] * cm[j] || 1)));
      const StS = cm.map((_, a) => cm.map((_, b) => Sm.reduce((s, r) => s + r[a] * r[b], 0)));
      const ev = S.eigSym(StS); const tot = S.sum(ev.values.filter(v => v > 0));
      const dims = Math.min(2, ev.values.filter(v => v > 1e-12).length);
      html += ctx.outline('Correspondence Analysis', ctx.table(['Singular Value', 'Inertia', 'Portion', 'Cumulative'], ev.values.filter(v => v > 1e-12).map((v, i, arr) => [Math.sqrt(v), v, v / tot, S.sum(arr.slice(0, i + 1)) / tot])) +
        (dims === 2 ? (() => {
          const colC = cm.map((c, j) => [0, 1].map(d => ev.vectors[d][j] * Math.sqrt(ev.values[d]) / Math.sqrt(c || 1)));
          const rowC = rm.map((r, i) => [0, 1].map(d => { let s = 0; cm.forEach((c, j) => s += Sm[i][j] * ev.vectors[d][j]); return s / Math.sqrt(r || 1); }));
          const all = [...colC, ...rowC];
          const cp = Plot.frame({ w: 400, h: 320, x: { min: S.min(all.map(a => a[0])), max: S.max(all.map(a => a[0])) }, y: { min: S.min(all.map(a => a[1])), max: S.max(all.map(a => a[1])) }, xLabel: 'c1', yLabel: 'c2' });
          cp.add(Plot.hline(cp, 0) + Plot.vline(cp, 0));
          colC.forEach((c, j) => cp.add(`<circle cx="${cp.X(c[0])}" cy="${cp.Y(c[1])}" r="4" fill="#d9412b"/><text class="ptlab" x="${cp.X(c[0]) + 6}" y="${cp.Y(c[1]) - 4}" fill="#d9412b">${esc(String(yl[j]))}</text>`));
          rowC.forEach((c, i) => cp.add(`<rect x="${cp.X(c[0]) - 3.5}" y="${cp.Y(c[1]) - 3.5}" width="7" height="7" fill="#2f6bc6"/><text class="ptlab" x="${cp.X(c[0]) + 6}" y="${cp.Y(c[1]) - 4}" fill="#2f6bc6">${esc(String(xl[i]))}</text>`));
          return `<div class="gwrap">${cp.svg()}</div>`;
        })() : ''), { key: K('cap') });
    }
    if (ctx.opt(K('anomp'))) {
      const j = 0, pbar = ct[j] / N;
      html += ctx.outline(`Analysis of Means for Proportions (${esc(String(yl[j]))})`, ctx.table([{ h: xn, a: 'l' }, 'N', 'Proportion', 'Lower Limit', 'Upper Limit', ''], xl.map((lv, i) => {
        const pr = rt[i] ? cell[i][j].length / rt[i] : NaN, se = Math.sqrt(pbar * (1 - pbar) * (N - rt[i]) / (N * rt[i]));
        const h = S.normInv(1 - 0.025 / xl.length) * se; const out = pr > pbar + h || pr < pbar - h;
        return [String(lv), rt[i], pr, pbar - h, pbar + h, { h: out ? '<span class="psig">Out of limits</span>' : '' }];
      })), { key: K('anomt') });
    }
    return ctx.outline(title, html, { menu, key: K('cont') });
  },

  // ======================= Logistic =======================
  logit(ctx, yi, xi) {
    const t = ctx.t, K = this.K(yi, xi), yn = ctx.cn(yi), xn = ctx.cn(xi);
    const rows = t.complete([yi, xi], ctx.rows).filter(r => isNum(t.columns[xi].values[r]));
    const yl = t.levels(yi, rows);
    const menu = [ctx.check('ROC Curve', K('roc')), ctx.check('Odds Ratios', K('or')), ctx.act('Save Probability Formula', () => { const f = ctx._lfit; if (!f) return false; saveColumn(t, `Prob[${yl[0]}]`, null, `1 / (1 + Exp(-(${f.b[0]} + ${f.b[1]} * :"${xn}")))`); return false; })];
    const title = `Logistic Fit of ${esc(yn)} By ${esc(xn)}${this.by(ctx)}`;
    if (yl.length !== 2) return ctx.outline(title, ctx.note(`Logistic fit here supports a binary response; ${esc(yn)} has ${yl.length} levels. Use Fit Model for details or recode the response.`), { menu });
    const xs = t.vals(xi, rows), y01 = rows.map(r => String(t.columns[yi].values[r]) === String(yl[0]) ? 1 : 0);
    const n = rows.length, n1 = S.sum(y01);
    const fit = S.logistic(xs.map(x => [1, x]), y01); ctx._lfit = fit;
    const p0 = n1 / n, ll0 = n1 * Math.log(p0) + (n - n1) * Math.log(1 - p0);
    const diff = fit.ll - ll0, chi = 2 * diff;
    const prob = x => 1 / (1 + Math.exp(-(fit.b[0] + fit.b[1] * x)));
    const p = Plot.frame({ w: 440, h: 320, x: { min: S.min(xs), max: S.max(xs) }, y: { min: 0, max: 1, pad: false }, xLabel: xn, yLabel: yn, mr: 70 });
    const grid = []; for (let i = 0; i <= 120; i++) grid.push(p.xt.lo + (p.xt.hi - p.xt.lo) * i / 120);
    p.add(Plot.line(grid.map(x => [p.X(x), p.Y(prob(x))]), 'fit', 'stroke:#d9412b'));
    rows.forEach((r, i) => { const pr = prob(xs[i]); const u = hash01(r); const yv = y01[i] ? u * pr : pr + u * (1 - pr); p.add(Plot.pt(t, r, p.X(xs[i]), p.Y(yv))); });
    p.over.push(`<text class="tl" x="${p.R + 6}" y="${p.Y(0.15)}">${esc(String(yl[0]))}</text><text class="tl" x="${p.R + 6}" y="${p.Y(0.85)}">${esc(String(yl[1]))}</text>`);
    let html = `<div class="gwrap">${p.svg()}</div>`;
    const k = 2, aicc = -2 * fit.ll + 2 * k + 2 * k * (k + 1) / (n - k - 1);
    html += ctx.outline('Whole Model Test', ctx.table([{ h: 'Model', a: 'l' }, '-LogLikelihood', 'DF', 'ChiSquare', 'Prob&gt;ChiSq'], [['Difference', diff, 1, chi, { p: S.chi2Surv(chi, 1) }], ['Full', -fit.ll, '', '', ''], ['Reduced', -ll0, '', '', '']]) +
      ctx.kv([['RSquare (U)', diff / -ll0], ['AICc', aicc], ['BIC', -2 * fit.ll + k * Math.log(n)], ['Observations (or Sum Wgts)', n]]), { key: K('wmt') });
    html += ctx.outline('Parameter Estimates', ctx.table([{ h: 'Term', a: 'l' }, 'Estimate', 'Std Error', 'ChiSquare', 'Prob&gt;ChiSq'], fit.b.map((b, i) => [i ? xn : 'Intercept', b, fit.se[i], (b / fit.se[i]) ** 2, { p: S.chi2Surv((b / fit.se[i]) ** 2, 1) }])) + `<div class="small mut">For log odds of ${esc(String(yl[0]))}/${esc(String(yl[1]))}</div>`, { key: K('lpe') });
    if (ctx.opt(K('or'))) {
      const b = fit.b[1], se = fit.se[1], rng = S.max(xs) - S.min(xs);
      html += ctx.outline('Odds Ratios', ctx.table([{ h: 'Term', a: 'l' }, 'Per', 'Odds Ratio', 'Lower 95%', 'Upper 95%'], [[xn, 'Unit', Math.exp(b), Math.exp(b - 1.96 * se), Math.exp(b + 1.96 * se)], [xn, 'Range', Math.exp(b * rng), Math.exp((b - 1.96 * se) * rng), Math.exp((b + 1.96 * se) * rng)]]), { key: K('ort') });
    }
    if (ctx.opt(K('roc'))) {
      const sc = rows.map((r, i) => [prob(xs[i]), y01[i]]).sort((a, b) => b[0] - a[0]);
      const P = n1, Nn = n - n1; let tp = 0, fp = 0; const pts = [[0, 0]]; let auc = 0;
      sc.forEach(([_, y]) => { if (y) tp++; else { fp++; auc += tp; } pts.push([fp / Nn, tp / P]); });
      auc /= P * Nn;
      const rp = Plot.frame({ w: 300, h: 280, x: { min: 0, max: 1, pad: false }, y: { min: 0, max: 1, pad: false }, xLabel: '1-Specificity', yLabel: 'Sensitivity' });
      rp.add(`<line class="ref" x1="${rp.X(0)}" y1="${rp.Y(0)}" x2="${rp.X(1)}" y2="${rp.Y(1)}"/>` + Plot.line(pts.map(([a, b]) => [rp.X(a), rp.Y(b)]), 'fit', 'stroke:#2f6bc6'));
      html += ctx.outline(`Receiver Operating Characteristic (${esc(String(yl[0]))})`, `<div class="gwrap flex">${rp.svg()}<div>${ctx.kv([['Area Under Curve', auc]])}</div></div>`, { key: K('rocp') });
    }
    return ctx.outline(title, html, { menu, key: K('lg') });
  },
};
