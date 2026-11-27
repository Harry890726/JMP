'use strict';
/* Quality and process: control charts (IR, XBar-R, XBar-S, P), process capability, Pareto plot. */

const SPC = {
  // constants for subgroup size n = 2..10
  A2: [0, 0, 1.880, 1.023, 0.729, 0.577, 0.483, 0.419, 0.373, 0.337, 0.308],
  D3: [0, 0, 0, 0, 0, 0, 0, 0.076, 0.136, 0.184, 0.223],
  D4: [0, 0, 3.267, 2.574, 2.282, 2.114, 2.004, 1.924, 1.864, 1.816, 1.777],
  d2: [0, 0, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078],
  c4: n => Math.exp(S.lgamma(n / 2) - S.lgamma((n - 1) / 2)) * Math.sqrt(2 / (n - 1)),
};

Platforms.control = {
  title: s => `Control Chart (${s.chart})`, w: 820, h: 680,
  launch(t, chart) {
    return UI.launch({
      title: 'Control Chart', table: t, recallKey: 'cc',
      roles: [{ key: 'y', label: 'Process', required: true }, { key: 'sub', label: 'Sample Label / Subgroup', max: 1 }, { key: 'phase', label: 'Phase', max: 1 }],
      params: [{ key: 'chart', label: 'Chart Type', type: 'select', options: ['IR', 'XBar & R', 'XBar & S', 'P'], value: chart || 'IR' }, { key: 'n', label: 'Subgroup size (when no subgroup column)', type: 'number', value: 5 }],
    }).then(r => r && r.roles.y.forEach(y => new Report(t, 'control', { y, sub: r.roles.sub[0], phase: r.roles.phase[0], chart: r.params.chart, n: Math.max(2, Math.round(r.params.n || 5)) })));
  },
  chart(ctx, title, labels, values, center, ucl, lcl, rowsPer, yLabel, key) {
    const t = ctx.t, n = values.length;
    const lim = [...values.filter(isNum), ...[ucl, lcl, center].flat().filter(isNum)];
    const p = Plot.frame({ w: 640, h: 250, x: { min: 0.5, max: n + 0.5, pad: false, ticks: (() => { const tk = Plot.ticks(1, n, 8, false); return { ...tk, lo: 0.5, hi: n + 0.5, ticks: tk.ticks.filter(v => v >= 1 && v <= n && Number.isInteger(v)) }; })() }, y: { min: S.min(lim), max: S.max(lim) }, xLabel: 'Sample', yLabel, mr: 70 });
    const arr = v => Array.isArray(v) ? v : values.map(() => v);
    const U = arr(ucl), Lw = arr(lcl), C = arr(center);
    const step = a => { const pts = []; a.forEach((v, i) => { if (isNum(v)) { pts.push([p.X(i + 0.5), p.Y(v)], [p.X(i + 1.5), p.Y(v)]); } }); return pts; };
    p.add(Plot.line(step(C), 'fit', 'stroke:#2e9a3a;stroke-width:1.3'));
    p.add(Plot.line(step(U), 'fit', 'stroke:#d9412b;stroke-width:1.2'));
    p.add(Plot.line(step(Lw), 'fit', 'stroke:#d9412b;stroke-width:1.2'));
    p.add(Plot.line(values.map((v, i) => [p.X(i + 1), p.Y(v)]), 'fit', 'stroke:#555;stroke-width:1'));
    let alarms = 0;
    values.forEach((v, i) => {
      if (!isNum(v)) return;
      const out = (isNum(U[i]) && v > U[i]) || (isNum(Lw[i]) && v < Lw[i]);
      if (out) alarms++;
      const rs = rowsPer[i];
      const sel = rs.some(r => t.rows[r].sel);
      p.add(`<circle class="pt${sel ? ' sel' : ''}" cx="${p.X(i + 1)}" cy="${p.Y(v)}" r="${out ? 4 : 3}" fill="${out ? '#d9412b' : '#222'}" data-rows="${rs.join(',')}"/>`);
      if (out) p.add(`<text class="tl" x="${p.X(i + 1) + 5}" y="${p.Y(v) - 5}" fill="#d9412b">1</text>`);
    });
    const last = n - 1;
    p.over.push(`<text class="tl" x="${p.R + 4}" y="${p.Y(U[last]) + 4}" fill="#d9412b">UCL=${fmt(U[last], 5)}</text><text class="tl" x="${p.R + 4}" y="${p.Y(C[last]) + 4}" fill="#2e9a3a">Avg=${fmt(C[last], 5)}</text><text class="tl" x="${p.R + 4}" y="${p.Y(Lw[last]) + 4}" fill="#d9412b">LCL=${fmt(Lw[last], 5)}</text>`);
    return ctx.outline(title, `<div class="gwrap">${p.svg()}</div><div class="small">${alarms ? `<span class="psig">${alarms} point(s) beyond limits (Test 1)</span>` : 'No points beyond limits.'}</div>`, { key });
  },
  render(ctx) {
    const t = ctx.t, sp = ctx.spec, yn = ctx.cn(sp.y);
    const rows = ctx.rows.filter(r => !DataTable.isMissing(t.columns[sp.y].values[r]));
    // build subgroups
    let groups = [];
    if (sp.chart === 'IR') groups = rows.map(r => ({ label: sp.sub !== undefined ? t.columns[sp.sub].values[r] : r + 1, rows: [r] }));
    else if (sp.sub !== undefined) {
      const m = new Map(); rows.forEach(r => { const k = String(t.columns[sp.sub].values[r]); if (!m.has(k)) m.set(k, { label: t.columns[sp.sub].values[r], rows: [] }); m.get(k).rows.push(r); }); groups = [...m.values()];
    } else for (let i = 0; i < rows.length; i += sp.n) groups.push({ label: i / sp.n + 1, rows: rows.slice(i, i + sp.n) });
    const vals = g => g.rows.map(r => t.columns[sp.y].values[r]);
    let html = '', sigmaW = NaN, center = NaN;
    const menu = [ctx.check('Show Limits Summary', 'lim', true), ctx.act('Process Capability Analysis...', () => {
      const cap = ctx.opt('cap', {});
      UI.prompt('Spec Limits', [{ key: 'lsl', label: 'LSL', type: 'number', value: cap.lsl ?? '' }, { key: 'target', label: 'Target', type: 'number', value: cap.target ?? '' }, { key: 'usl', label: 'USL', type: 'number', value: cap.usl ?? '' }]).then(v => { if (v) { ctx.rep.opts.cap = v; ctx.rep.render(); } });
      return false;
    })];
    if (sp.chart === 'P') {
      // proportion of the first level (alphabetical) per subgroup
      const lv = t.levels(sp.y, rows);
      const bad = ctx.opt('plev', lv[lv.length - 1]);
      const pr = groups.map(g => vals(g).filter(v => String(v) === String(bad)).length / g.rows.length);
      const pbar = S.sum(groups.map((g, i) => pr[i] * g.rows.length)) / S.sum(groups.map(g => g.rows.length));
      const ucl = groups.map(g => Math.min(1, pbar + 3 * Math.sqrt(pbar * (1 - pbar) / g.rows.length))), lcl = groups.map(g => Math.max(0, pbar - 3 * Math.sqrt(pbar * (1 - pbar) / g.rows.length)));
      html += this.chart(ctx, `P chart of ${esc(yn)} = ${esc(String(bad))}`, groups.map(g => g.label), pr, pbar, ucl, lcl, groups.map(g => g.rows), 'Proportion', 'p');
      menu.push({ label: 'Nonconforming level', submenu: lv.map(l => ({ label: String(l), checked: String(l) === String(bad), action: () => { ctx.rep.opts.plev = l; ctx.rep.render(); } })) });
      return ctx.outline(`Control Chart: P of ${esc(yn)}`, html, { menu, key: 'ccp' });
    }
    const nums = rows.filter(r => isNum(t.columns[sp.y].values[r]));
    if (nums.length < 2) return ctx.note('Process column must be numeric with at least two values.');
    if (sp.chart === 'IR') {
      const v = groups.map(g => vals(g)[0]);
      const mr = v.map((x, i) => i ? Math.abs(x - v[i - 1]) : NaN);
      const mrbar = S.mean(mr.filter(isNum)); center = S.mean(v); sigmaW = mrbar / 1.128;
      html += this.chart(ctx, `Individual Measurement of ${esc(yn)}`, groups.map(g => g.label), v, center, center + 3 * sigmaW, center - 3 * sigmaW, groups.map(g => g.rows), yn, 'ind');
      html += this.chart(ctx, `Moving Range of ${esc(yn)}`, groups.map(g => g.label), mr, mrbar, 3.267 * mrbar, 0, groups.map((g, i) => i ? [...groups[i - 1].rows, ...g.rows] : g.rows), 'Moving Range', 'mr');
      if (ctx.opt('lim', true)) html += ctx.outline('Limits Summaries', ctx.table([{ h: 'Chart', a: 'l' }, 'LCL', 'Avg', 'UCL', 'Sigma', 'N'], [['Individual', center - 3 * sigmaW, center, center + 3 * sigmaW, sigmaW, v.length], ['Moving Range', 0, mrbar, 3.267 * mrbar, sigmaW, v.length - 1]]), { key: 'ls' });
    } else {
      const ns = groups.map(g => g.rows.length);
      const means = groups.map(g => S.mean(vals(g)));
      const gbar = S.sum(groups.map((g, i) => means[i] * ns[i])) / S.sum(ns); center = gbar;
      const nb = Math.min(10, Math.max(2, Math.round(S.mean(ns))));
      if (sp.chart === 'XBar & R') {
        const R = groups.map(g => { const v = vals(g); return S.max(v) - S.min(v); }); const rbar = S.mean(R);
        sigmaW = rbar / SPC.d2[nb];
        const ucl = ns.map(k => gbar + 3 * sigmaW / Math.sqrt(k)), lcl = ns.map(k => gbar - 3 * sigmaW / Math.sqrt(k));
        html += this.chart(ctx, `XBar of ${esc(yn)}`, groups.map(g => g.label), means, gbar, ucl, lcl, groups.map(g => g.rows), `Mean of ${yn}`, 'xb');
        html += this.chart(ctx, `Range of ${esc(yn)}`, groups.map(g => g.label), R, rbar, ns.map(k => SPC.D4[Math.min(10, Math.max(2, k))] * rbar), ns.map(k => SPC.D3[Math.min(10, Math.max(2, k))] * rbar), groups.map(g => g.rows), `Range of ${yn}`, 'rg');
        if (ctx.opt('lim', true)) html += ctx.outline('Limits Summaries', ctx.table([{ h: 'Chart', a: 'l' }, 'LCL', 'Avg', 'UCL', 'Sigma', 'Subgroup Size'], [['XBar', lcl[0], gbar, ucl[0], sigmaW, nb], ['Range', SPC.D3[nb] * rbar, rbar, SPC.D4[nb] * rbar, sigmaW, nb]]), { key: 'ls' });
      } else {
        const Sd = groups.map(g => S.sd(vals(g))); const sbar = S.mean(Sd.filter(isNum)); const c4 = SPC.c4(nb);
        sigmaW = sbar / c4;
        const ucl = ns.map(k => gbar + 3 * sigmaW / Math.sqrt(k)), lcl = ns.map(k => gbar - 3 * sigmaW / Math.sqrt(k));
        const B = 3 * Math.sqrt(1 - c4 * c4) / c4;
        html += this.chart(ctx, `XBar of ${esc(yn)}`, groups.map(g => g.label), means, gbar, ucl, lcl, groups.map(g => g.rows), `Mean of ${yn}`, 'xb');
        html += this.chart(ctx, `Standard Deviation of ${esc(yn)}`, groups.map(g => g.label), Sd, sbar, sbar * (1 + B), Math.max(0, sbar * (1 - B)), groups.map(g => g.rows), `Std Dev of ${yn}`, 'sd');
        if (ctx.opt('lim', true)) html += ctx.outline('Limits Summaries', ctx.table([{ h: 'Chart', a: 'l' }, 'LCL', 'Avg', 'UCL', 'Sigma', 'Subgroup Size'], [['XBar', lcl[0], gbar, ucl[0], sigmaW, nb], ['Std Dev', Math.max(0, sbar * (1 - B)), sbar, sbar * (1 + B), sigmaW, nb]]), { key: 'ls' });
      }
    }
    const cap = ctx.opt('cap');
    if (cap && (isNum(cap.lsl) || isNum(cap.usl))) html += Capability.report(ctx, t.vals(sp.y, nums), cap, sigmaW, yn);
    return ctx.outline(`Control Chart: ${esc(sp.chart)} of ${esc(yn)}`, html, { menu, key: 'cc' });
  },
};

const Capability = {
  report(ctx, v, cap, sigmaW, yn) {
    const n = v.length, m = S.mean(v), sdo = S.sd(v);
    const { lsl, usl, target } = cap;
    const idx = sg => {
      const both = isNum(lsl) && isNum(usl);
      return { cp: both ? (usl - lsl) / (6 * sg) : NaN, cpk: Math.min(isNum(usl) ? (usl - m) / (3 * sg) : Infinity, isNum(lsl) ? (m - lsl) / (3 * sg) : Infinity), cpl: isNum(lsl) ? (m - lsl) / (3 * sg) : NaN, cpu: isNum(usl) ? (usl - m) / (3 * sg) : NaN };
    };
    const w = isNum(sigmaW) ? idx(sigmaW) : null, o = idx(sdo);
    const pts = v.filter(x => (isNum(lsl) && x < lsl) || (isNum(usl) && x > usl)).length;
    const exp = sg => 100 * ((isNum(lsl) ? S.normCdf((lsl - m) / sg) : 0) + (isNum(usl) ? 1 - S.normCdf((usl - m) / sg) : 0));
    // histogram with spec limits
    const lo = Math.min(S.min(v), isNum(lsl) ? lsl : Infinity), hi = Math.max(S.max(v), isNum(usl) ? usl : -Infinity);
    const { edges, bw } = Plot.bins(v);
    const counts = edges.slice(0, -1).map((e, k) => v.filter(x => x >= e && x < edges[k + 1]).length);
    const p = Plot.frame({ w: 460, h: 230, x: { min: Math.min(lo, edges[0]), max: Math.max(hi, edges[edges.length - 1]) }, y: { min: 0, max: Math.max(...counts, n * bw * S.normPdf(m, m, sdo)) * 1.1, pad: false }, xLabel: yn, yLabel: 'Count' });
    counts.forEach((c, k) => c && p.add(`<rect class="bar" x="${p.X(edges[k])}" y="${p.Y(c)}" width="${p.X(edges[k + 1]) - p.X(edges[k])}" height="${p.Y(0) - p.Y(c)}" fill="#7ea3d4"/>`));
    const curve = sg => { const out = []; for (let i = 0; i <= 80; i++) { const x = p.xt.lo + (p.xt.hi - p.xt.lo) * i / 80; out.push([p.X(x), p.Y(n * bw * S.normPdf(x, m, sg))]); } return out; };
    p.add(Plot.line(curve(sdo), 'fit', 'stroke:#2f6bc6'));
    if (isNum(sigmaW)) p.add(Plot.line(curve(sigmaW), 'fit', 'stroke:#d9412b;stroke-dasharray:4 3'));
    for (const [val, lab] of [[lsl, 'LSL'], [target, 'Target'], [usl, 'USL']]) if (isNum(val)) { p.add(Plot.vline(p, val, 'ref', `stroke:${lab === 'Target' ? '#2e9a3a' : '#d9412b'};stroke-width:1.6`)); p.over.push(`<text class="tl" x="${p.X(val)}" y="${p.T + 10}" text-anchor="middle" fill="#d9412b">${lab}</text>`); }
    let c = `<div class="gwrap">${p.svg()}</div><div class="small"><span style="color:#2f6bc6">—</span> Overall &nbsp; <span style="color:#d9412b">- -</span> Within</div>`;
    c += ctx.table([{ h: 'Index', a: 'l' }, 'Within Sigma', 'Overall Sigma'], [['Sigma', sigmaW, sdo], ['Cp / Pp', w ? w.cp : NaN, o.cp], ['Cpk / Ppk', w ? w.cpk : NaN, o.cpk], ['Cpl / Ppl', w ? w.cpl : NaN, o.cpl], ['Cpu / Ppu', w ? w.cpu : NaN, o.cpu], ['Expected % Out of Spec', isNum(sigmaW) ? exp(sigmaW) : NaN, exp(sdo)]]);
    c += ctx.kv([['LSL', isNum(lsl) ? lsl : '•'], ['Target', isNum(target) ? target : '•'], ['USL', isNum(usl) ? usl : '•'], ['Sample Mean', m], ['N', n], ['Observed % Out of Spec', 100 * pts / n]]);
    return ctx.outline(`Process Capability of ${esc(yn)}`, c, { key: 'cap', menu: [ctx.act('Remove', () => { ctx.rep.opts.cap = null; })] });
  },
};

Platforms.capability = {
  title: () => 'Process Capability', w: 640, h: 620,
  launch(t) {
    return UI.launch({ title: 'Process Capability', table: t, roles: [{ key: 'y', label: 'Y, Process', required: true, types: ['continuous'] }], params: [{ key: 'lsl', label: 'LSL', type: 'number' }, { key: 'target', label: 'Target', type: 'number' }, { key: 'usl', label: 'USL', type: 'number' }] })
      .then(r => r && r.roles.y.forEach(y => new Report(t, 'capability', { y, cap: r.params })));
  },
  render(ctx) {
    const t = ctx.t, y = ctx.spec.y, rows = ctx.rows.filter(r => isNum(t.columns[y].values[r]));
    const v = t.vals(y, rows); const mr = v.slice(1).map((x, i) => Math.abs(x - v[i]));
    return Capability.report(ctx, v, ctx.opt('cap', ctx.spec.cap), S.mean(mr) / 1.128, ctx.cn(y));
  },
};

Platforms.pareto = {
  title: () => 'Pareto Plot', w: 640, h: 560,
  launch(t) {
    return UI.launch({ title: 'Pareto Plot', table: t, recallKey: 'pareto', roles: [{ key: 'y', label: 'Y, Cause', required: true, max: 1 }, { key: 'freq', label: 'Freq', max: 1 }, { key: 'by', label: 'By', max: 1 }] })
      .then(r => r && App.byLaunch(t, 'pareto', { y: r.roles.y[0], freq: r.roles.freq[0] }, r.roles.by));
  },
  render(ctx) {
    const t = ctx.t, y = ctx.spec.y, f = ctx.spec.freq;
    const rows = t.complete(f !== undefined ? [y, f] : [y], ctx.rows);
    const m = new Map();
    rows.forEach(r => { const k = String(t.columns[y].values[r]); if (!m.has(k)) m.set(k, { level: k, n: 0, rows: [] }); const g = m.get(k); g.n += f !== undefined ? (+t.columns[f].values[r] || 0) : 1; g.rows.push(r); });
    const g = [...m.values()].sort((a, b) => b.n - a.n), tot = S.sum(g.map(x => x.n));
    const p = Plot.frame({ w: 560, h: 330, x: { levels: g.map(x => x.level) }, y: { min: 0, max: tot, pad: false, n: 6 }, xLabel: ctx.cn(y), yLabel: 'Count', mr: 50 });
    g.forEach((x, i) => p.add(Plot.bar(t, p.L + p.xb * i + 2, p.Y(0), p.L + p.xb * (i + 1) - 2, p.Y(x.n), x.rows, { fill: PALETTE[i % PALETTE.length] })));
    let cum = 0; const pts = g.map((x, i) => { cum += x.n; return [p.L + p.xb * (i + 1), p.Y(cum)]; });
    p.add(Plot.line([[p.L, p.Y(0)], ...pts], 'fit', 'stroke:#222;stroke-width:1.4') + pts.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="2.5" fill="#222"/>`).join(''));
    for (let q = 0; q <= 100; q += 20) p.over.push(`<text class="tl" x="${p.R + 4}" y="${p.Y(tot * q / 100) + 4}">${q}%</text>`);
    cum = 0;
    const tb = ctx.table([{ h: 'Cause', a: 'l' }, 'Count', 'Percent', 'Cum Percent'], g.map(x => { cum += x.n; return [x.level, x.n, 100 * x.n / tot, 100 * cum / tot]; }));
    return ctx.outline(`Pareto Plot of ${esc(ctx.cn(y))}${ctx.spec.by ? ' ' + esc(ctx.spec.by.label) : ''}`, `<div class="gwrap">${p.svg()}</div>` + ctx.outline('Cause Summary', tb, { key: 'cs' }), { key: 'par' });
  },
};
