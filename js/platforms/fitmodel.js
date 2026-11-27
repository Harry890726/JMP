'use strict';
/* Fit Model: standard least squares with nominal effects (effect coding), crossed terms,
   effect tests, diagnostic plots and an interactive prediction profiler; nominal logistic for binary Y. */

const Design = {
  /** Build effect list. effects: array of arrays of column indices (main effect = [ci], crossing = [a,b]) */
  build(t, effects, rows) {
    const enc = new Map();
    const allCols = [...new Set(effects.flat())];
    for (const ci of allCols) {
      const col = t.columns[ci];
      if (col.modelingType === 'continuous') { const v = t.vals(ci, rows); enc.set(ci, { type: 'c', mean: S.mean(v), min: S.min(v), max: S.max(v) }); }
      else { const lv = t.levels(ci, rows); enc.set(ci, { type: 'n', levels: lv, idx: new Map(lv.map((l, i) => [String(l), i])) }); }
    }
    const terms = []; // {name, effect: ei}
    const effectInfo = effects.map((ef, ei) => {
      // component names
      let parts = [{ name: '', expr: '', fn: () => 1 }];
      const q = v => typeof v === 'number' ? v : JSON.stringify(String(v));
      const crossed = ef.length > 1;
      for (const ci of ef) {
        const e = enc.get(ci), nm = t.columns[ci].name;
        let comps;
        const ref = `:${JSON.stringify(nm)}`;
        if (e.type === 'c') comps = [{ name: crossed ? `(${nm}-${fmt(e.mean, 5)})` : nm, expr: crossed ? `(${ref} - ${e.mean})` : ref, fn: g => crossed ? g(ci) - e.mean : g(ci) }];
        else comps = e.levels.slice(0, -1).map((l, j) => ({ name: `${nm}[${l}]`, expr: `If(${ref} == ${q(l)}, 1, ${ref} == ${q(e.levels[e.levels.length - 1])}, -1, 0)`, fn: g => { const k = e.idx.get(String(g(ci))); return k === j ? 1 : k === e.levels.length - 1 ? -1 : 0; } }));
        const next = [];
        for (const p of parts) for (const c of comps) next.push({ name: p.name ? p.name + '*' + c.name : c.name, expr: p.expr ? p.expr + ' * ' + c.expr : c.expr, fn: g => p.fn(g) * c.fn(g) });
        parts = next;
      }
      const start = terms.length + 1;
      parts.forEach(p => terms.push({ ...p, effect: ei }));
      return { name: ef.map(ci => t.columns[ci].name).join('*'), cols: ef, idx: parts.map((_, k) => start + k) };
    });
    const row = g => [1, ...terms.map(tm => tm.fn(g))];
    return { enc, terms, effectInfo, row, names: ['Intercept', ...terms.map(t => t.name)] };
  },
};

Platforms.fitmodel = {
  title: s => 'Fit Least Squares',
  w: 900, h: 700,
  launch(t) {
    return UI.launch({
      title: 'Fit Model', table: t, recallKey: 'fitmodel',
      roles: [{ key: 'y', label: 'Y', required: true }, { key: 'x', label: 'Add (Model Effects)', required: true }, { key: 'by', label: 'By', max: 1 }],
      params: [{ key: 'cross', type: 'check', label: 'Add all two-way interactions (Factorial to degree 2)' }, { key: 'poly', type: 'check', label: 'Add squared terms for continuous effects (Response Surface)' },
        { key: 'pers', label: 'Personality', type: 'select', options: ['Standard Least Squares', 'Nominal Logistic (binary Y)'], value: 'Standard Least Squares' }],
    }).then(r => {
      if (!r) return;
      const x = r.roles.x; const effects = x.map(c => [c]);
      if (r.params.cross) for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) effects.push([x[i], x[j]]);
      if (r.params.poly) x.filter(c => !t.isCat(c)).forEach(c => effects.push([c, c]));
      for (const y of r.roles.y) App.byLaunch(t, 'fitmodel', { y: [y], effects }, r.roles.by);
    });
  },
  render(ctx) {
    const t = ctx.t, yi = ctx.spec.y[0], yn = ctx.cn(yi);
    const cols = [...new Set([yi, ...ctx.spec.effects.flat()])];
    const rows = t.complete(cols, ctx.rows);
    if (t.isCat(yi)) return this.logistic(ctx, yi, rows);
    const D = Design.build(t, ctx.spec.effects, rows);
    const g = r => ci => t.columns[ci].values[r];
    const X = rows.map(r => D.row(g(r)));
    const y = t.vals(yi, rows);
    const m = S.ols(X, y);
    const by = ctx.spec.by ? ' ' + esc(ctx.spec.by.label) : '';
    if (!m) return ctx.outline(`Response ${esc(yn)}${by}`, ctx.note('The model is singular (linear dependency among effects) or there are too few rows.'));
    ctx.rep._model = { D, m, rows };
    const menu = [
      ctx.check('Summary of Fit', 'sof', true), ctx.check('Analysis of Variance', 'aov', true), ctx.check('Parameter Estimates', 'pe', true), ctx.check('Effect Tests', 'et', true),
      ctx.check('Sorted Parameter Estimates', 'spe'), ctx.check('Show Prediction Expression', 'expr'),
      { label: 'Row Diagnostics', submenu: [ctx.check('Plot Actual by Predicted', 'avp', true), ctx.check('Plot Residual by Predicted', 'rvp', true), ctx.check('Plot Residual by Row', 'rvr'), ctx.check('Plot Residual Normal Quantile', 'rnq'), ctx.check('Durbin-Watson Test', 'dw')] },
      { label: 'Factor Profiling', submenu: [ctx.check('Profiler', 'prof', true)] },
      { label: 'Save Columns', submenu: [
        { label: 'Prediction Formula', action: () => saveColumn(t, `Pred Formula ${yn}`, null, this.formula(t, D, m.b)) },
        { label: 'Predicted Values', action: () => { const out = t.columns[yi].values.map(() => NaN); rows.forEach((r, i) => out[r] = m.pred[i]); saveColumn(t, `Predicted ${yn}`, out); } },
        { label: 'Residuals', action: () => { const out = t.columns[yi].values.map(() => NaN); rows.forEach((r, i) => out[r] = m.resid[i]); saveColumn(t, `Residual ${yn}`, out); } },
        { label: 'Studentized Residuals', action: () => { const out = t.columns[yi].values.map(() => NaN); rows.forEach((r, i) => { const h = S.quad(m.inv, X[i]); out[r] = m.resid[i] / (m.rmse * Math.sqrt(1 - h)); }); saveColumn(t, `Studentized Resid ${yn}`, out); } },
        { label: "Cook's D Influence", action: () => { const out = t.columns[yi].values.map(() => NaN); const p = m.b.length; rows.forEach((r, i) => { const h = S.quad(m.inv, X[i]); out[r] = m.resid[i] ** 2 / (p * m.mse) * h / (1 - h) ** 2; }); saveColumn(t, `Cook's D ${yn}`, out); } },
        { label: 'Hats', action: () => { const out = t.columns[yi].values.map(() => NaN); rows.forEach((r, i) => out[r] = S.quad(m.inv, X[i])); saveColumn(t, `h ${yn}`, out); } },
      ] },
    ];
    let html = '';
    if (ctx.opt('avp', true)) {
      const p = Plot.frame({ w: 400, h: 330, x: { min: S.min(m.pred), max: S.max(m.pred) }, y: { min: S.min(y), max: S.max(y) }, xLabel: `${yn} Predicted`, yLabel: `${yn} Actual` });
      const lo = Math.max(p.xt.lo, p.yt.lo), hi = Math.min(p.xt.hi, p.yt.hi);
      p.add(`<line class="fit" style="stroke:#d9412b" x1="${p.X(lo)}" y1="${p.Y(lo)}" x2="${p.X(hi)}" y2="${p.Y(hi)}"/>` + Plot.hline(p, m.ybar, 'ref', 'stroke:#2f6bc6;stroke-dasharray:4 3'));
      rows.forEach((r, i) => p.add(Plot.pt(t, r, p.X(m.pred[i]), p.Y(y[i]))));
      html += ctx.outline('Actual by Predicted Plot', `<div class="gwrap">${p.svg()}</div><div class="small">P${m.pF < 0.0001 ? '&lt;.0001' : '=' + fmtD(m.pF)} RSq=${fmtD(m.r2, 2)} RMSE=${fmt(m.rmse, 5)}</div>`, { key: 'avp' });
    }
    if (ctx.opt('sof', true)) html += ctx.outline('Summary of Fit', ctx.kv([['RSquare', m.r2], ['RSquare Adj', m.adj], ['Root Mean Square Error', m.rmse], ['Mean of Response', m.ybar], ['Observations (or Sum Wgts)', m.n]]), { key: 'sof' });
    if (ctx.opt('aov', true)) html += ctx.outline('Analysis of Variance', ctx.table([{ h: 'Source', a: 'l' }, 'DF', 'Sum of Squares', 'Mean Square', 'F Ratio', 'Prob &gt; F'], [['Model', m.dfm, m.ssm, m.ssm / m.dfm, m.F, { p: m.pF }], ['Error', m.dfe, m.sse, m.mse, '', ''], ['C. Total', m.n - 1, m.sst, '', '', '']]), { key: 'aov' });
    // lack of fit
    if (ctx.opt('pe', true)) html += ctx.outline('Parameter Estimates', ctx.table([{ h: 'Term', a: 'l' }, 'Estimate', 'Std Error', 't Ratio', 'Prob&gt;|t|', { h: '' }], m.b.map((b, i) => [D.names[i], b, m.se[i], m.t[i], { p: m.p[i] }, { h: this.tbar(m.t[i]) }])), { key: 'pe' });
    if (ctx.opt('spe')) {
      const ord = m.b.map((_, i) => i).slice(1).sort((a, b) => Math.abs(m.t[b]) - Math.abs(m.t[a]));
      html += ctx.outline('Sorted Parameter Estimates', ctx.table([{ h: 'Term', a: 'l' }, 'Estimate', 'Std Error', 't Ratio', { h: '' }, 'Prob&gt;|t|'], ord.map(i => [D.names[i], m.b[i], m.se[i], m.t[i], { h: this.tbar(m.t[i], 120) }, { p: m.p[i] }])), { key: 'spe' });
    }
    if (ctx.opt('et', true)) {
      const rowsE = D.effectInfo.map(ef => {
        const keep = m.b.map((_, i) => i).filter(i => !ef.idx.includes(i));
        const mr = S.ols(X.map(r => keep.map(i => r[i])), y);
        const ss = mr ? mr.sse - m.sse : NaN, df = ef.idx.length, F = (ss / df) / m.mse;
        return [ef.name, df, df, ss, F, { p: S.fSurv(F, df, m.dfe) }];
      });
      html += ctx.outline('Effect Tests', ctx.table([{ h: 'Source', a: 'l' }, 'Nparm', 'DF', 'Sum of Squares', 'F Ratio', 'Prob &gt; F'], rowsE), { key: 'et' });
    }
    if (ctx.opt('expr')) html += ctx.outline('Prediction Expression', `<div class="eq">${esc(yn)} = ${m.b.map((b, i) => i === 0 ? fmt(b, 6) : `${b < 0 ? '−' : '+'} ${fmt(Math.abs(b), 6)}·${esc(D.names[i])}`).join(' ')}</div>`, { key: 'expr' });
    if (ctx.opt('rvp', true)) {
      const p = Plot.frame({ w: 400, h: 240, x: { min: S.min(m.pred), max: S.max(m.pred) }, y: { min: S.min(m.resid), max: S.max(m.resid) }, xLabel: `${yn} Predicted`, yLabel: `${yn} Residual` });
      p.add(Plot.hline(p, 0, 'ref', 'stroke:#2f6bc6'));
      rows.forEach((r, i) => p.add(Plot.pt(t, r, p.X(m.pred[i]), p.Y(m.resid[i]))));
      html += ctx.outline('Residual by Predicted Plot', `<div class="gwrap">${p.svg()}</div>`, { key: 'rvp' });
    }
    if (ctx.opt('rvr')) {
      const p = Plot.frame({ w: 420, h: 220, x: { min: 1, max: rows.length }, y: { min: S.min(m.resid), max: S.max(m.resid) }, xLabel: 'Row Number', yLabel: 'Residual' });
      p.add(Plot.hline(p, 0, 'ref') + Plot.line(rows.map((r, i) => [p.X(i + 1), p.Y(m.resid[i])]), 'fit', 'stroke:#999;stroke-width:1'));
      rows.forEach((r, i) => p.add(Plot.pt(t, r, p.X(i + 1), p.Y(m.resid[i]))));
      html += ctx.outline('Residual by Row Plot', `<div class="gwrap">${p.svg()}</div>`, { key: 'rvr' });
    }
    if (ctx.opt('rnq')) {
      const ord = m.resid.map((_, i) => i).sort((a, b) => m.resid[a] - m.resid[b]);
      const p = Plot.frame({ w: 400, h: 260, x: { min: -3, max: 3 }, y: { min: S.min(m.resid), max: S.max(m.resid) }, xLabel: 'Normal Quantile', yLabel: 'Residual' });
      p.add(`<line class="fit" style="stroke:#d9412b" x1="${p.X(-3)}" y1="${p.Y(-3 * m.rmse)}" x2="${p.X(3)}" y2="${p.Y(3 * m.rmse)}"/>`);
      ord.forEach((i, k) => p.add(Plot.pt(t, rows[i], p.X(S.normInv((k + 1) / (ord.length + 1))), p.Y(m.resid[i]))));
      html += ctx.outline('Residual Normal Quantile Plot', `<div class="gwrap">${p.svg()}</div>`, { key: 'rnq' });
    }
    if (ctx.opt('dw')) {
      let num = 0; for (let i = 1; i < m.resid.length; i++) num += (m.resid[i] - m.resid[i - 1]) ** 2;
      const dw = num / m.sse; let ac = 0; for (let i = 1; i < m.resid.length; i++) ac += m.resid[i] * m.resid[i - 1];
      html += ctx.outline('Durbin-Watson', ctx.table(['Durbin-Watson', 'Number of Obs.', 'AutoCorrelation'], [[dw, m.n, ac / m.sse]]), { key: 'dw' });
    }
    if (ctx.opt('prof', true)) html += this.profiler(ctx, D, m, yn);
    return ctx.outline(`Response ${esc(yn)}${by}`, html, { menu, key: 'resp' }) + `<div class="small mut" style="margin:6px 4px">Model: ${esc(yn)} ~ ${D.effectInfo.map(e => esc(e.name)).join(' + ')}</div>`;
  },
  tbar(tv, w = 80) {
    const c = w / 2, sc = Math.min(c, Math.abs(tv) / 10 * c);
    const ref = Math.min(c, 2 / 10 * c);
    return `<svg width="${w}" height="12"><line x1="${c}" x2="${c}" y1="0" y2="12" stroke="#999"/><line x1="${c - ref}" x2="${c - ref}" y1="0" y2="12" stroke="#d9412b" stroke-dasharray="2 1"/><line x1="${c + ref}" x2="${c + ref}" y1="0" y2="12" stroke="#d9412b" stroke-dasharray="2 1"/><rect x="${tv < 0 ? c - sc : c}" y="2" width="${sc}" height="8" fill="#7ea3d4"/></svg>`;
  },
  formula(t, D, b) {
    return [String(b[0]), ...D.terms.map((tm, k) => `${b[k + 1]} * ${tm.expr}`)].join(' + ');
  },
  profiler(ctx, D, m, yn) {
    const t = ctx.t;
    const facs = [...D.enc.keys()];
    const cur = ctx.opt('profSet', null) || {};
    const val = ci => { const e = D.enc.get(ci); return ci in cur ? cur[ci] : e.type === 'c' ? e.mean : e.levels[0]; };
    const predAt = over => { const g = ci => (ci in over ? over[ci] : val(ci)); const x = D.row(g); return { y: S.dot(x, m.b), se: Math.sqrt(S.quad(m.inv, x) * m.mse) }; };
    const tc = S.tInv(0.975, m.dfe);
    const curves = facs.map(ci => {
      const e = D.enc.get(ci);
      if (e.type === 'c') { const pts = []; for (let i = 0; i <= 40; i++) { const x = e.min + (e.max - e.min) * i / 40; pts.push([x, predAt({ [ci]: x })]); } return { ci, e, pts }; }
      return { ci, e, pts: e.levels.map(l => [l, predAt({ [ci]: l })]) };
    });
    let ymin = Infinity, ymax = -Infinity;
    curves.forEach(c => c.pts.forEach(([, p]) => { ymin = Math.min(ymin, p.y - tc * p.se); ymax = Math.max(ymax, p.y + tc * p.se); }));
    const now = predAt({});
    const yt = Plot.ticks(ymin, ymax, 5);
    let cells = '';
    curves.forEach((c, k) => {
      const first = k === 0;
      const p = c.e.type === 'c'
        ? Plot.frame({ w: first ? 230 : 180, h: 220, x: { min: c.e.min, max: c.e.max, n: 4 }, y: { ticks: yt }, ml: first ? 60 : 10, noYAxis: !first, xLabel: t.columns[c.ci].name, yLabel: first ? yn : '' })
        : Plot.frame({ w: first ? 230 : 180, h: 220, x: { levels: c.e.levels }, y: { ticks: yt }, ml: first ? 60 : 10, noYAxis: !first, xLabel: t.columns[c.ci].name, yLabel: first ? yn : '' });
      const xv = val(c.ci);
      if (c.e.type === 'c') {
        p.add(Plot.line(c.pts.map(([x, q]) => [p.X(x), p.Y(q.y)]), 'fit', 'stroke:#222'));
        for (const sg of [-1, 1]) p.add(Plot.line(c.pts.map(([x, q]) => [p.X(x), p.Y(q.y + sg * tc * q.se)]), 'fit', 'stroke:#2f6bc6;stroke-dasharray:3 2;stroke-width:1'));
      } else {
        c.pts.forEach(([l, q]) => { const x = p.X(l); p.add(`<line class="fit" style="stroke:#2f6bc6;stroke-width:1" x1="${x}" x2="${x}" y1="${p.Y(q.y - tc * q.se)}" y2="${p.Y(q.y + tc * q.se)}"/><circle cx="${x}" cy="${p.Y(q.y)}" r="3.5" fill="#222"/>`); });
        p.add(Plot.line(c.pts.map(([l, q]) => [p.X(l), p.Y(q.y)]), 'fit', 'stroke:#222;stroke-width:1'));
      }
      p.add(`<line class="profcur" x1="${p.X(xv)}" x2="${p.X(xv)}" y1="${p.T}" y2="${p.B}"/><line class="profcur" x1="${p.L}" x2="${p.R}" y1="${p.Y(now.y)}" y2="${p.Y(now.y)}"/>`);
      const meta = c.e.type === 'c' ? `data-l="${p.L}" data-r="${p.R}" data-lo="${p.xt.lo}" data-hi="${p.xt.hi}"` : `data-l="${p.L}" data-r="${p.R}" data-levels="${esc(JSON.stringify(c.e.levels))}"`;
      cells += `<div class="profcell"><div class="profval">${esc(typeof xv === 'number' ? fmt(xv, 5) : String(xv))}</div>${p.svg(`data-action="prof" data-ci="${c.ci}" ${meta}`)}</div>`;
    });
    const head = `<div class="profhead"><b>${esc(yn)}</b> <span class="profy">${fmt(now.y, 6)}</span> <span class="mut">±${fmt(tc * now.se, 5)}</span></div>`;
    return ctx.outline('Prediction Profiler', `${head}<div class="profiler">${cells}</div><div class="small mut">Click inside a factor panel to change its current setting.</div>`, {
      key: 'prof', menu: [ctx.act('Reset Factor Settings', () => { ctx.rep.opts.profSet = null; })],
    });
  },
  actions: {
    prof(rep, svg, e) {
      const ctm = svg.getScreenCTM().inverse(); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const x = pt.matrixTransform(ctm).x;
      const L = +svg.dataset.l, R = +svg.dataset.r, ci = +svg.dataset.ci;
      const set = { ...(rep.opts.profSet || {}) };
      if (svg.dataset.levels) { const lv = JSON.parse(svg.dataset.levels); const k = Math.max(0, Math.min(lv.length - 1, Math.floor((x - L) / (R - L) * lv.length))); set[ci] = lv[k]; }
      else { const lo = +svg.dataset.lo, hi = +svg.dataset.hi; const e = rep._model.D.enc.get(ci); set[ci] = Math.max(e.min, Math.min(e.max, lo + (x - L) / (R - L) * (hi - lo))); }
      rep.opts.profSet = set; rep.render();
    },
  },
  logistic(ctx, yi, rows) {
    const t = ctx.t, yn = ctx.cn(yi), yl = t.levels(yi, rows);
    if (yl.length !== 2) return ctx.outline(`Nominal Logistic Fit for ${esc(yn)}`, ctx.note(`Binary response required; ${esc(yn)} has ${yl.length} levels.`));
    const D = Design.build(t, ctx.spec.effects, rows);
    const X = rows.map(r => D.row(ci => t.columns[ci].values[r]));
    const y = rows.map(r => String(t.columns[yi].values[r]) === String(yl[0]) ? 1 : 0);
    const f = S.logistic(X, y), n = y.length, n1 = S.sum(y);
    const ll0 = n1 * Math.log(n1 / n) + (n - n1) * Math.log(1 - n1 / n);
    const diff = f.ll - ll0, k = f.b.length;
    let html = ctx.outline('Whole Model Test', ctx.table([{ h: 'Model', a: 'l' }, '-LogLikelihood', 'DF', 'ChiSquare', 'Prob&gt;ChiSq'], [['Difference', diff, k - 1, 2 * diff, { p: S.chi2Surv(2 * diff, k - 1) }], ['Full', -f.ll, '', '', ''], ['Reduced', -ll0, '', '', '']]) +
      ctx.kv([['RSquare (U)', diff / -ll0], ['AICc', -2 * f.ll + 2 * k + 2 * k * (k + 1) / (n - k - 1)], ['BIC', -2 * f.ll + k * Math.log(n)], ['Observations (or Sum Wgts)', n]]), { key: 'lwmt' });
    html += ctx.outline('Parameter Estimates', ctx.table([{ h: 'Term', a: 'l' }, 'Estimate', 'Std Error', 'ChiSquare', 'Prob&gt;ChiSq'], f.b.map((b, i) => [D.names[i], b, f.se[i], (b / f.se[i]) ** 2, { p: S.chi2Surv((b / f.se[i]) ** 2, 1) }])) + `<div class="small mut">For log odds of ${esc(String(yl[0]))}/${esc(String(yl[1]))}</div>`, { key: 'lpe' });
    const lr = D.effectInfo.map(ef => {
      const keep = f.b.map((_, i) => i).filter(i => !ef.idx.includes(i));
      const fr = S.logistic(X.map(r => keep.map(i => r[i])), y); const c = 2 * (f.ll - fr.ll);
      return [ef.name, ef.idx.length, ef.idx.length, c, { p: S.chi2Surv(c, ef.idx.length) }];
    });
    html += ctx.outline('Effect Likelihood Ratio Tests', ctx.table([{ h: 'Source', a: 'l' }, 'Nparm', 'DF', 'L-R ChiSquare', 'Prob&gt;ChiSq'], lr), { key: 'lelr' });
    // confusion matrix
    let tp = 0, fp = 0, fn = 0, tn = 0;
    X.forEach((x, i) => { const pr = 1 / (1 + Math.exp(-S.dot(x, f.b))); const pred = pr >= 0.5 ? 1 : 0; if (pred && y[i]) tp++; else if (pred) fp++; else if (y[i]) fn++; else tn++; });
    html += ctx.outline('Confusion Matrix', ctx.table([{ h: 'Actual \\ Predicted', a: 'l' }, String(yl[0]), String(yl[1])], [[String(yl[0]), tp, fn], [String(yl[1]), fp, tn]]) + `<div class="small">Misclassification Rate ${fmt((fp + fn) / n, 4)}</div>`, { key: 'lcm' });
    return ctx.outline(`Nominal Logistic Fit for ${esc(yn)}`, html, {
      key: 'nlf', menu: [{ label: 'Save Probability Formula', action: () => saveColumn(t, `Prob[${yl[0]}]`, null, `1 / (1 + Exp(-(${this.formula(t, D, f.b)})))`) }],
    });
  },
};
