'use strict';
/* Multivariate methods: correlations, scatterplot matrix, principal components, clustering. */

function scatterMatrix(ctx, cis, rows, { ell = false, size } = {}) {
  const t = ctx.t, k = cis.length;
  const cs = size || Math.max(80, Math.min(150, Math.floor(620 / k)));
  const pad = 4, ml = 4, W = k * cs, H = k * cs;
  const data = cis.map(ci => t.vals(ci, rows));
  const rng = data.map(v => { const tk = Plot.ticks(S.min(v), S.max(v), 4); return [tk.lo, tk.hi]; });
  let s = '';
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const x0 = ml + j * cs, y0 = i * cs;
    s += `<rect class="plotbg" x="${x0 + pad}" y="${y0 + pad}" width="${cs - 2 * pad}" height="${cs - 2 * pad}"/>`;
    if (i === j) {
      s += `<text class="smlab" x="${x0 + cs / 2}" y="${y0 + cs / 2}" text-anchor="middle">${esc(t.columns[cis[i]].name)}</text>`;
      s += `<text class="tl" x="${x0 + pad + 2}" y="${y0 + cs - pad - 3}">${fmt(rng[i][0], 4)}</text><text class="tl" x="${x0 + cs - pad - 2}" y="${y0 + pad + 10}" text-anchor="end">${fmt(rng[i][1], 4)}</text>`;
    } else {
      const X = v => x0 + pad + (v - rng[j][0]) / (rng[j][1] - rng[j][0]) * (cs - 2 * pad);
      const Y = v => y0 + cs - pad - (v - rng[i][0]) / (rng[i][1] - rng[i][0]) * (cs - 2 * pad);
      if (ell) {
        const xs = data[j], ys = data[i], mx = S.mean(xs), my = S.mean(ys), sx = S.sd(xs), sy = S.sd(ys), r = S.corr(xs, ys), c2 = Math.sqrt(S.chi2Inv(0.95, 2));
        const pts = []; for (let q = 0; q <= 60; q++) { const th = 2 * Math.PI * q / 60, u = Math.cos(th) * c2, v = Math.sin(th) * c2; pts.push([X(mx + sx * u), Y(my + r * sy * u + sy * Math.sqrt(1 - r * r) * v)]); }
        s += Plot.line(pts, 'fit', 'stroke:#d9412b;stroke-width:1');
      }
      rows.forEach((r, q) => { s += Plot.pt(t, r, X(data[j][q]), Y(data[i][q]), { r: 1.9 }); });
    }
    s += `<rect class="frame" x="${x0 + pad}" y="${y0 + pad}" width="${cs - 2 * pad}" height="${cs - 2 * pad}"/>`;
  }
  return `<svg class="plot" width="${W + ml + 4}" height="${H + 4}" viewBox="0 0 ${W + ml + 4} ${H + 4}">${s}</svg>`;
}

Platforms.multivariate = {
  title: () => 'Multivariate',
  w: 820, h: 680,
  launch(t) {
    return UI.launch({ title: 'Multivariate and Correlations', table: t, recallKey: 'mv', roles: [{ key: 'y', label: 'Y, Columns', required: true, types: ['continuous'] }, { key: 'by', label: 'By', max: 1 }] })
      .then(r => r && App.byLaunch(t, 'multivariate', { y: r.roles.y.filter(c => !t.isCat(c)) }, r.roles.by));
  },
  render(ctx) {
    const t = ctx.t, cis = ctx.spec.y; const names = cis.map(c => ctx.cn(c));
    const rows = t.complete(cis, ctx.rows).filter(r => cis.every(c => isNum(t.columns[c].values[r])));
    const n = rows.length;
    const menu = [ctx.check('Correlations Multivariate', 'corr', true), ctx.check('Scatterplot Matrix', 'spm', true), ctx.check('Density Ellipses', 'ell'), ctx.check('Univariate Simple Statistics', 'uss'),
      ctx.check('Pairwise Correlations', 'pw'), ctx.check('Covariance Matrix', 'cov'), ctx.check('Color Maps on Correlations', 'cmap'),
      ctx.check('Nonparametric Correlations: Spearman ρ', 'spear'), ctx.check('Principal Components', 'pca'), ctx.check('Outlier Analysis: Mahalanobis Distances', 'mahal')];
    const by = ctx.spec.by ? ' ' + esc(ctx.spec.by.label) : '';
    if (cis.length < 2 || n < 3) return ctx.outline('Multivariate' + by, ctx.note('Select at least two continuous columns with data.'), { menu });
    const data = cis.map(c => t.vals(c, rows));
    const R = S.corrMatrix(data);
    let html = '';
    const mat = (M, fmtf = v => v) => ctx.table(['', ...names.map(esc)], M.map((r, i) => [names[i], ...r.map(fmtf)]));
    if (ctx.opt('corr', true)) html += ctx.outline('Correlations', mat(R, v => ({ h: `<span style="${ctx.opt('cmap') ? `background:${v >= 0 ? `rgba(217,65,43,${Math.abs(v) * 0.8})` : `rgba(47,107,198,${Math.abs(v) * 0.8})`};padding:0 4px` : ''}">${fmtD(v, 4)}</span>`, c: 'n' })), { key: 'corr' });
    if (ctx.opt('uss')) html += ctx.outline('Univariate Simple Statistics', ctx.table([{ h: 'Column', a: 'l' }, 'N', 'DF', 'Mean', 'Std Dev', 'Sum', 'Minimum', 'Maximum'], data.map((v, i) => [names[i], n, n - 1, S.mean(v), S.sd(v), S.sum(v), S.min(v), S.max(v)])), { key: 'uss' });
    if (ctx.opt('cov')) html += ctx.outline('Covariance Matrix', mat(S.covMatrix(data)), { key: 'cov' });
    if (ctx.opt('spm', true)) html += ctx.outline('Scatterplot Matrix', `<div class="gwrap">${scatterMatrix(ctx, cis, rows, { ell: ctx.opt('ell') })}</div>`, { key: 'spm' });
    if (ctx.opt('pw')) {
      const rowsP = [];
      for (let i = 0; i < cis.length; i++) for (let j = 0; j < i; j++) { const r = R[i][j]; const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3); rowsP.push([names[i], names[j], r, n, Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se), { p: S.corrP(r, n) }, { h: this.corrBar(r) }]); }
      html += ctx.outline('Pairwise Correlations', ctx.table([{ h: 'Variable', a: 'l' }, { h: 'by Variable', a: 'l' }, 'Correlation', 'Count', 'Lower 95%', 'Upper 95%', 'Signif Prob', { h: '-.8 -.6 -.4 -.2 0 .2 .4 .6 .8' }], rowsP), { key: 'pw' });
    }
    if (ctx.opt('spear')) {
      const rk = data.map(v => S.ranks(v)); const rowsS = [];
      for (let i = 0; i < cis.length; i++) for (let j = 0; j < i; j++) { const r = S.corr(rk[i], rk[j]); rowsS.push([names[i], names[j], r, { p: S.corrP(r, n) }, { h: this.corrBar(r) }]); }
      html += ctx.outline("Nonparametric: Spearman's ρ", ctx.table([{ h: 'Variable', a: 'l' }, { h: 'by Variable', a: 'l' }, "Spearman ρ", 'Prob&gt;|ρ|', { h: '' }], rowsS), { key: 'sp' });
    }
    if (ctx.opt('mahal')) {
      const C = S.covMatrix(data), inv = S.matInv(C), mu = data.map(S.mean);
      if (inv) {
        const d = rows.map((_, q) => Math.sqrt(S.quad(inv, data.map((v, i) => v[q] - mu[i]))));
        const ucl = Math.sqrt(S.chi2Inv(0.95, cis.length));
        const p = Plot.frame({ w: 520, h: 220, x: { min: 1, max: n }, y: { min: 0, max: Math.max(S.max(d), ucl) * 1.05, pad: false }, xLabel: 'Row Number', yLabel: 'Mahalanobis Distance' });
        p.add(Plot.hline(p, ucl, 'ref', 'stroke:#d9412b;stroke-dasharray:4 3'));
        rows.forEach((r, q) => p.add(`<line x1="${p.X(q + 1)}" x2="${p.X(q + 1)}" y1="${p.Y(0)}" y2="${p.Y(d[q])}" stroke="#bbb"/>` + Plot.pt(t, r, p.X(q + 1), p.Y(d[q]))));
        html += ctx.outline('Mahalanobis Distances', `<div class="gwrap">${p.svg()}</div><div class="small">Upper Control Limit (χ² 0.95, df=${cis.length}) = ${fmt(ucl, 5)}</div>`, { key: 'mh' });
      }
    }
    if (ctx.opt('pca')) html += PCA.report(ctx, cis, rows, data, R);
    return ctx.outline('Multivariate' + by, html, { menu, key: 'mv' });
  },
  corrBar(r) { return `<svg width="120" height="12"><line x1="60" x2="60" y1="0" y2="12" stroke="#999"/><rect x="${r < 0 ? 60 + r * 60 : 60}" y="2" width="${Math.abs(r) * 60}" height="8" fill="${r < 0 ? '#2f6bc6' : '#d9412b'}" opacity=".75"/></svg>`; },
};

const PCA = {
  report(ctx, cis, rows, data, R) {
    const t = ctx.t, names = cis.map(c => ctx.cn(c));
    const ev = S.eigSym(R), tot = S.sum(ev.values);
    const k = cis.length;
    const means = data.map(S.mean), sds = data.map(S.sd);
    const scores = rows.map((_, q) => ev.vectors.map(vec => S.sum(vec.map((w, i) => w * (data[i][q] - means[i]) / sds[i]))));
    let html = ctx.table(['Number', 'Eigenvalue', 'Percent', { h: '20 40 60 80' }, 'Cum Percent'], ev.values.map((v, i) => [i + 1, v, 100 * v / tot, { h: `<svg width="100" height="12"><rect x="0" y="2" width="${v / tot * 100}" height="8" fill="#7ea3d4"/></svg>` }, 100 * S.sum(ev.values.slice(0, i + 1)) / tot]), { title: 'Eigenvalues' });
    const sp = Plot.frame({ w: 360, h: 320, x: { min: S.min(scores.map(s => s[0])), max: S.max(scores.map(s => s[0])) }, y: { min: S.min(scores.map(s => s[1])), max: S.max(scores.map(s => s[1])) }, xLabel: `Component 1 (${fmtD(100 * ev.values[0] / tot, 1)} %)`, yLabel: `Component 2 (${fmtD(100 * ev.values[1] / tot, 1)} %)` });
    sp.add(Plot.hline(sp, 0) + Plot.vline(sp, 0));
    rows.forEach((r, q) => sp.add(Plot.pt(t, r, sp.X(scores[q][0]), sp.Y(scores[q][1]))));
    const lp = Plot.frame({ w: 320, h: 320, x: { min: -1, max: 1, pad: false }, y: { min: -1, max: 1, pad: false }, xLabel: 'Component 1', yLabel: 'Component 2' });
    lp.add(`<circle cx="${lp.X(0)}" cy="${lp.Y(0)}" r="${lp.X(1) - lp.X(0)}" fill="none" stroke="#bbb"/>` + Plot.hline(lp, 0) + Plot.vline(lp, 0));
    names.forEach((nm, i) => { const a = ev.vectors[0][i] * Math.sqrt(ev.values[0]), b = ev.vectors[1][i] * Math.sqrt(ev.values[1]); lp.add(`<line x1="${lp.X(0)}" y1="${lp.Y(0)}" x2="${lp.X(a)}" y2="${lp.Y(b)}" stroke="#2f6bc6" stroke-width="1.4"/><circle cx="${lp.X(a)}" cy="${lp.Y(b)}" r="3" fill="#2f6bc6"/><text class="ptlab" x="${lp.X(a) + 4}" y="${lp.Y(b) - 4}">${esc(nm)}</text>`); });
    html += `<div class="gwrap flex"><div><div class="small b">Score Plot</div>${sp.svg()}</div><div><div class="small b">Loading Plot</div>${lp.svg()}</div></div>`;
    html += ctx.outline('Eigenvectors', ctx.table(['', ...ev.values.map((_, i) => 'Prin' + (i + 1))], names.map((nm, i) => [nm, ...ev.vectors.map(v => v[i])])), { key: 'pcaev', closed: true });
    html += ctx.outline('Loading Matrix', ctx.table(['', ...ev.values.map((_, i) => 'Prin' + (i + 1))], names.map((nm, i) => [nm, ...ev.vectors.map((v, j) => v[i] * Math.sqrt(ev.values[j]))])), { key: 'pcalm', closed: true });
    return ctx.outline('Principal Components: on Correlations', html, {
      key: 'pca', menu: [{
        label: 'Save Principal Components...', action: () => UI.prompt('Save Principal Components', [{ key: 'k', label: 'Number of components to save', type: 'number', value: Math.min(2, k) }]).then(v => {
          if (!v) return; for (let c = 0; c < Math.min(k, v.k || 1); c++) { const out = t.columns[0].values.map(() => NaN); rows.forEach((r, q) => out[r] = scores[q][c]); t.addColumn({ name: 'Prin' + (c + 1), values: out }); }
          t.emit('structure');
        }),
      }],
    });
  },
};

Platforms.pca = {
  title: () => 'Principal Components', w: 820, h: 640,
  launch(t) {
    return UI.launch({ title: 'Principal Components', table: t, recallKey: 'mv', roles: [{ key: 'y', label: 'Y, Columns', required: true, types: ['continuous'] }] })
      .then(r => r && new Report(t, 'pca', { y: r.roles.y.filter(c => !t.isCat(c)) }));
  },
  render(ctx) {
    const t = ctx.t, cis = ctx.spec.y; const rows = t.complete(cis, ctx.rows);
    if (cis.length < 2 || rows.length < 3) return ctx.note('Need at least two continuous columns.');
    const data = cis.map(c => t.vals(c, rows));
    return PCA.report(ctx, cis, rows, data, S.corrMatrix(data));
  },
};

Platforms.kmeans = {
  title: s => `K Means Cluster (k=${s.k})`, w: 820, h: 640,
  launch(t) {
    return UI.launch({
      title: 'K Means Cluster', table: t, recallKey: 'clus', roles: [{ key: 'y', label: 'Y, Columns', required: true, types: ['continuous'] }],
      params: [{ key: 'k', label: 'Number of Clusters', type: 'number', value: 3 }, { key: 'std', type: 'check', label: 'Columns Scaled Individually', value: true }],
    }).then(r => r && new Report(t, 'kmeans', { y: r.roles.y.filter(c => !t.isCat(c)), k: Math.max(2, Math.round(r.params.k || 3)), std: r.params.std }));
  },
  render(ctx) {
    const t = ctx.t, cis = ctx.spec.y, k = ctx.opt('k', ctx.spec.k);
    const rows = t.complete(cis, ctx.rows);
    if (rows.length < k) return ctx.note('Not enough rows.');
    const data = cis.map(c => t.vals(c, rows)), means = data.map(S.mean), sds = data.map(S.sd);
    const pts = rows.map((_, q) => data.map((v, i) => ctx.spec.std ? (v[q] - means[i]) / sds[i] : v[q]));
    const km = S.kmeans(pts, k, 11);
    ctx.rep._km = { rows, km };
    const unscale = (c, i) => ctx.spec.std ? c * sds[i] + means[i] : c;
    let html = ctx.outline('Cluster Summary', ctx.table(['Cluster', 'Count', 'Within SS'], km.sizes.map((s, c) => [c + 1, s, km.within[c]])) + `<div class="small">CCC-like ratio: between/total SS = ${fmt(1 - S.sum(km.within) / S.sum(pts.map(p => p.reduce((a, v, i) => a + (v - S.mean(pts.map(q => q[i]))) ** 2, 0))), 4)}</div>`, { key: 'cs' });
    html += ctx.outline('Cluster Means', ctx.table(['Cluster', ...cis.map(c => esc(ctx.cn(c)))], km.centers.map((c, ci) => [ci + 1, ...c.map(unscale)])), { key: 'cm' });
    // biplot on first two principal components
    if (cis.length >= 2) {
      const std = data.map((v, i) => v.map(x => (x - means[i]) / sds[i]));
      const ev = S.eigSym(S.corrMatrix(data));
      const sc = rows.map((_, q) => [0, 1].map(d => S.sum(ev.vectors[d].map((w, i) => w * std[i][q]))));
      const p = Plot.frame({ w: 440, h: 360, x: { min: S.min(sc.map(s => s[0])), max: S.max(sc.map(s => s[0])) }, y: { min: S.min(sc.map(s => s[1])), max: S.max(sc.map(s => s[1])) }, xLabel: 'Prin1', yLabel: 'Prin2' });
      rows.forEach((r, q) => p.add(Plot.pt(t, r, p.X(sc[q][0]), p.Y(sc[q][1]), { color: PALETTE[km.assign[q] % PALETTE.length] })));
      km.centers.forEach((c, ci) => {
        const cu = c.map(unscale); const z = cu.map((v, i) => (v - means[i]) / sds[i]);
        const cx = S.sum(ev.vectors[0].map((w, i) => w * z[i])), cy = S.sum(ev.vectors[1].map((w, i) => w * z[i]));
        p.add(`<circle cx="${p.X(cx)}" cy="${p.Y(cy)}" r="${6 + Math.sqrt(km.sizes[ci]) * 1.5}" fill="${PALETTE[ci % PALETTE.length]}" fill-opacity=".15" stroke="${PALETTE[ci % PALETTE.length]}" stroke-width="1.5"/><text class="smlab" x="${p.X(cx)}" y="${p.Y(cy) + 4}" text-anchor="middle">${ci + 1}</text>`);
      });
      html += ctx.outline('Biplot', `<div class="gwrap flex">${p.svg()}${Plot.legend(km.centers.map((_, c) => ['Cluster ' + (c + 1), PALETTE[c % PALETTE.length]]))}</div>`, { key: 'bp' });
    }
    return ctx.outline(`K Means NCluster=${k}`, html, {
      key: 'km', menu: [
        ctx.act('Change Number of Clusters...', () => { UI.prompt('Number of Clusters', [{ key: 'k', label: 'k', type: 'number', value: k }]).then(v => { if (v && v.k >= 2) { ctx.rep.opts.k = Math.round(v.k); ctx.rep.render(); } }); return false; }),
        { label: 'Save Clusters', action: () => { const out = t.columns[0].values.map(() => NaN); rows.forEach((r, q) => out[r] = km.assign[q] + 1); const c = t.addColumn({ name: 'Cluster', values: out, modelingType: 'nominal' }); t.emit('structure'); } },
        { label: 'Color by Cluster', action: () => { rows.forEach((r, q) => t.rows[r].color = PALETTE[km.assign[q] % PALETTE.length]); t.emit('rows'); } },
      ],
    });
  },
};

Platforms.hclust = {
  title: () => 'Hierarchical Cluster', w: 820, h: 680,
  launch(t) {
    return UI.launch({
      title: 'Hierarchical Clustering', table: t, recallKey: 'clus', roles: [{ key: 'y', label: 'Y, Columns', required: true, types: ['continuous'] }, { key: 'lab', label: 'Label', max: 1 }],
      params: [{ key: 'method', label: 'Method', type: 'select', options: ['Ward', 'Average', 'Complete', 'Single'], value: 'Ward' }, { key: 'k', label: 'Number of clusters (for coloring)', type: 'number', value: 3 }],
    }).then(r => r && new Report(t, 'hclust', { y: r.roles.y.filter(c => !t.isCat(c)), lab: r.roles.lab[0], method: r.params.method, k: Math.max(1, Math.round(r.params.k || 3)) }));
  },
  render(ctx) {
    const t = ctx.t, cis = ctx.spec.y, rows = t.complete(cis, ctx.rows).slice(0, 600), n = rows.length;
    if (n < 3) return ctx.note('Not enough rows.');
    const data = cis.map(c => t.vals(c, rows)); const mu = data.map(S.mean), sdv = data.map(S.sd);
    const P = rows.map((_, q) => data.map((v, i) => (v[q] - mu[i]) / (sdv[i] || 1)));
    const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => { let d = 0; for (let k = 0; k < cis.length; k++) d += (P[i][k] - P[j][k]) ** 2; return ctx.spec.method === 'Ward' ? d : Math.sqrt(d); }));
    const size = new Array(n).fill(1), active = new Set([...Array(n).keys()]);
    const node = Array.from({ length: n }, (_, i) => ({ id: i, leaf: i, h: 0, size: 1 }));
    const merges = [];
    while (active.size > 1) {
      let bi = -1, bj = -1, bd = Infinity;
      const act = [...active];
      for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) { const d = D[act[a]][act[b]]; if (d < bd) { bd = d; bi = act[a]; bj = act[b]; } }
      const ni = size[bi], nj = size[bj];
      for (const k of active) {
        if (k === bi || k === bj) continue;
        const nk = size[k]; let d;
        switch (ctx.spec.method) {
          case 'Single': d = Math.min(D[bi][k], D[bj][k]); break;
          case 'Complete': d = Math.max(D[bi][k], D[bj][k]); break;
          case 'Average': d = (ni * D[bi][k] + nj * D[bj][k]) / (ni + nj); break;
          default: d = ((ni + nk) * D[bi][k] + (nj + nk) * D[bj][k] - nk * bd) / (ni + nj + nk);
        }
        D[bi][k] = D[k][bi] = d;
      }
      merges.push({ a: node[bi], b: node[bj], h: ctx.spec.method === 'Ward' ? Math.sqrt(bd) : bd });
      node[bi] = { a: node[bi], b: node[bj], h: merges[merges.length - 1].h, size: ni + nj };
      size[bi] = ni + nj; active.delete(bj);
    }
    const root = node[[...active][0]];
    // leaf order and cluster assignment for k clusters
    const order = []; const walk = nd => { if (nd.leaf !== undefined) order.push(nd.leaf); else { walk(nd.a); walk(nd.b); } }; walk(root);
    const k = Math.min(ctx.spec.k, n); const cut = merges.length - k >= 0 ? merges[merges.length - k].h : 0;
    const clusterOf = new Array(n); let cc = 0;
    const assign = (nd, c) => { if (nd.leaf !== undefined) clusterOf[nd.leaf] = c; else { assign(nd.a, c); assign(nd.b, c); } };
    const split = nd => { if (nd.leaf !== undefined || nd.h <= cut + 1e-12) assign(nd, cc++); else { split(nd.a); split(nd.b); } };
    if (k <= 1) assign(root, 0); else split(root);
    const rowH = Math.max(4, Math.min(14, 520 / n)), W = 560, L = 10, R = 420, H = n * rowH + 30;
    const pos = new Map(order.map((leaf, i) => [leaf, 10 + (i + 0.5) * rowH]));
    const X = h => R - (h / root.h) * (R - L);
    let s = '';
    const draw = nd => {
      if (nd.leaf !== undefined) return pos.get(nd.leaf);
      const ya = draw(nd.a), yb = draw(nd.b), x = X(nd.h), col = nd.h <= cut ? PALETTE[clusterOf[firstLeaf(nd)] % PALETTE.length] : '#555';
      s += `<path d="M${X(nd.a.h || 0)},${ya}H${x}V${yb}H${X(nd.b.h || 0)}" fill="none" stroke="${col}" stroke-width="1.2"/>`;
      return (ya + yb) / 2;
    };
    const firstLeaf = nd => nd.leaf !== undefined ? nd.leaf : firstLeaf(nd.a);
    draw(root);
    if (k > 1) s += `<line x1="${X(cut)}" x2="${X(cut)}" y1="0" y2="${H - 20}" stroke="#d9412b" stroke-dasharray="3 3"/>`;
    const labCol = ctx.spec.lab;
    order.forEach((leaf, i) => {
      const r = rows[leaf], st = t.rows[r];
      const lab = labCol !== undefined ? String(t.columns[labCol].values[r]) : String(r + 1);
      s += `<text class="tl${st.sel ? ' b' : ''}" x="${R + 6}" y="${pos.get(leaf) + 3}" fill="${PALETTE[clusterOf[leaf] % PALETTE.length]}" data-rows="${r}" style="cursor:pointer">${rowH >= 8 ? esc(lab) : ''}</text>`;
    });
    ctx.rep._hc = { rows, clusterOf };
    const hist = merges.slice(-Math.min(15, merges.length)).reverse().map((mg, i) => [merges.length - i, mg.h]);
    return ctx.outline(`Hierarchical Clustering (${esc(ctx.spec.method)})`, ctx.outline('Dendrogram', `<div class="gwrap"><svg class="plot" width="${W}" height="${H}">${s}</svg></div>`, { key: 'dg' }) +
      ctx.outline('Clustering History (last joins)', ctx.table(['Number of Clusters', 'Distance'], hist.map(([a, b]) => [n - a + 1, b])), { key: 'hist', closed: true }), {
      key: 'hc', menu: [
        ctx.act('Number of Clusters...', () => { UI.prompt('Number of Clusters', [{ key: 'k', label: 'k', type: 'number', value: k }]).then(v => { if (v && v.k >= 1) { ctx.rep.spec.k = Math.round(v.k); ctx.rep.render(); } }); return false; }),
        { label: 'Save Clusters', action: () => { const out = t.columns[0].values.map(() => NaN); rows.forEach((r, q) => out[r] = clusterOf[q] + 1); t.addColumn({ name: 'Cluster', values: out, modelingType: 'nominal' }); t.emit('structure'); } },
        { label: 'Color Clusters', action: () => { rows.forEach((r, q) => t.rows[r].color = PALETTE[clusterOf[q] % PALETTE.length]); t.emit('rows'); } },
      ],
    });
  },
};
