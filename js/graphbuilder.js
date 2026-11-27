'use strict';
/* Graph Builder: drag columns onto drop zones (X, Y, Group X, Group Y, Overlay) and pick elements. */

const GB_ELEMENTS = [
  ['points', 'Points', '<circle cx="5" cy="12" r="1.8"/><circle cx="9" cy="7" r="1.8"/><circle cx="13" cy="10" r="1.8"/><circle cx="16" cy="4" r="1.8"/>'],
  ['smoother', 'Smoother', '<path d="M2 14 C6 4, 10 14, 18 4" fill="none" stroke-width="1.8"/>'],
  ['linefit', 'Line of Fit', '<path d="M2 15 L18 4" stroke-width="1.8"/><circle cx="6" cy="10" r="1.4"/><circle cx="13" cy="9" r="1.4"/>'],
  ['line', 'Line', '<path d="M2 13 L7 6 L11 10 L18 3" fill="none" stroke-width="1.8"/>'],
  ['bar', 'Bar', '<rect x="3" y="8" width="4" height="9"/><rect x="8.5" y="4" width="4" height="13"/><rect x="14" y="10" width="4" height="7"/>'],
  ['box', 'Box Plot', '<rect x="6" y="5" width="8" height="8" fill="none" stroke-width="1.5"/><path d="M10 1v4M10 13v5M6 9h8" stroke-width="1.5"/>'],
  ['histogram', 'Histogram', '<rect x="2" y="10" width="4" height="7"/><rect x="6" y="4" width="4" height="13"/><rect x="10" y="7" width="4" height="10"/><rect x="14" y="12" width="4" height="5"/>'],
  ['heatmap', 'Heatmap', '<rect x="2" y="2" width="7" height="7" opacity=".9"/><rect x="11" y="2" width="7" height="7" opacity=".4"/><rect x="2" y="11" width="7" height="7" opacity=".5"/><rect x="11" y="11" width="7" height="7" opacity=".8"/>'],
  ['area', 'Area', '<path d="M2 17 L2 11 L7 6 L12 9 L18 4 L18 17 Z"/>'],
];

Platforms.graphbuilder = {
  title: () => 'Graph Builder', w: 980, h: 640,
  launch(t) { return Promise.resolve(new Report(t, 'graphbuilder', {}, { els: [] })); },
  zones: { x: 'X', y: 'Y', gx: 'Group X', gy: 'Group Y', ov: 'Overlay' },
  defaults: {},
  autoElements(t, o) {
    const xc = o.x !== undefined ? t.isCat(o.x) : null, yc = o.y !== undefined ? t.isCat(o.y) : null;
    if (xc === false && yc === false) return ['points', 'smoother'];
    if (xc === false && yc === null) return ['histogram'];
    if (xc === true && yc === null) return ['bar'];
    if (xc === true && yc === true) return ['heatmap'];
    if (xc === null && yc === true) return ['points'];
    return ['points'];
  },
  render(ctx) {
    const t = ctx.t, o = ctx.opts;
    const els = o.els && o.els.length ? o.els : this.autoElements(t, o);
    const zone = k => {
      const ci = o[k];
      return `<div class="gbz gbz-${k}" data-zone="${k}">${ci !== undefined ? `<span class="gbchip">${esc(t.columns[ci].name)}<b data-action="gbclear" data-zone="${k}" title="Remove">&#10005;</b></span>` : `<span class="gbph">${this.zones[k]}</span>`}</div>`;
    };
    const graph = this.graph(ctx, els);
    const ttl = o.y !== undefined && o.x !== undefined ? `${esc(t.columns[o.y].name)} vs. ${esc(t.columns[o.x].name)}` : o.x !== undefined ? esc(t.columns[o.x].name) : o.y !== undefined ? esc(t.columns[o.y].name) : 'Drag variables into the zones';
    const control = !o.done;
    const body = `<div class="gb ${control ? '' : 'done'}">
      ${control ? `<div class="gb-cols"><div class="gb-h">Variables</div><ul>${t.columns.map((c, i) => `<li draggable="true" data-ci="${i}">${typeIcon(c.modelingType)}<span>${esc(c.name)}</span></li>`).join('')}</ul>
        <div class="gb-btns"><button class="btn" data-action="gbreset">Start Over</button><button class="btn primary" data-action="gbdone">Done</button></div>
        <div class="small mut" style="margin-top:8px">Drag a column onto X, Y, Group X, Group Y or Overlay. Double-click a column to fill X then Y.</div></div>` : ''}
      <div class="gb-main">
        ${control ? `<div class="gb-els">${GB_ELEMENTS.map(([k, lab, icon]) => `<button class="gbel ${els.includes(k) ? 'on' : ''}" data-action="gbel" data-el="${k}" title="${lab}"><svg viewBox="0 0 20 20" width="22" height="22">${icon}</svg></button>`).join('')}</div>` : ''}
        <div class="gb-title">${ttl}</div>
        <div class="gb-area">
          ${control ? zone('gx') + zone('y') : ''}
          <div class="gb-plot">${graph.html}</div>
          ${control ? zone('gy') : ''}
          <div class="gb-side">${control ? zone('ov') : ''}${graph.legend}</div>
          ${control ? zone('x') : ''}
        </div>
      </div></div>`;
    return ctx.outline('Graph Builder', body, {
      key: 'gb', menu: [ctx.check('Show Control Panel', 'done', false, { checked: !o.done }), ctx.check('Show Legend', 'nolegend', false, { checked: !o.nolegend }),
        { label: 'Jitter', checked: o.jit !== false, action: () => { ctx.rep.opts.jit = o.jit === false; ctx.rep.render(); } },
        { label: 'Smoother span...', action: () => UI.prompt('Smoother', [{ key: 'span', label: 'Span (0.1 - 1)', type: 'number', value: o.span || 0.6 }]).then(v => { if (v && v.span > 0) { ctx.rep.opts.span = Math.min(1, Math.max(0.1, v.span)); ctx.rep.render(); } }) },
        '-', { label: 'Save as SVG', action: () => { const svg = ctx.rep.body.querySelector('.gb-plot svg'); if (svg) download('graph.svg', svg.outerHTML, 'image/svg+xml'); } },
        { label: 'Start Over', action: () => { ctx.rep.opts = { els: [] }; ctx.rep.render(); } }],
    });
  },
  graph(ctx, els) {
    const t = ctx.t, o = ctx.opts;
    const used = ['x', 'y', 'gx', 'gy', 'ov'].map(k => o[k]).filter(v => v !== undefined);
    const rows = t.complete(used, ctx.rows).filter(r => !t.rows[r].hid);
    if (o.x === undefined && o.y === undefined) return { html: `<div class="gb-empty">Drop a column on <b>X</b> or <b>Y</b> to start.</div>`, legend: '' };
    const cat = ci => ci !== undefined && t.isCat(ci);
    const xCat = cat(o.x), yCat = cat(o.y);
    const gxL = o.gx !== undefined ? t.levels(o.gx, rows) : [null], gyL = o.gy !== undefined ? t.levels(o.gy, rows) : [null];
    const ovL = o.ov !== undefined ? t.levels(o.ov, rows) : [null];
    const ovColor = l => l === null ? '#2b2b2b' : PALETTE[ovL.map(String).indexOf(String(l)) % PALETTE.length];
    const val = (ci, r) => t.columns[ci].values[r];
    // scales
    const xs = o.x !== undefined ? (xCat ? { levels: t.levels(o.x, rows) } : { min: S.min(rows.map(r => val(o.x, r))), max: S.max(rows.map(r => val(o.x, r))) }) : { levels: [''] };
    let ys, yMode;
    if (o.y !== undefined) { yMode = 'col'; ys = yCat ? { levels: t.levels(o.y, rows) } : { min: S.min(rows.map(r => val(o.y, r))), max: S.max(rows.map(r => val(o.y, r))) }; }
    else if (els.includes('histogram') || els.includes('bar')) yMode = 'count';
    else { yMode = 'none'; ys = { min: 0, max: 1, pad: false }; }
    const panelRows = (gx, gy) => rows.filter(r => (gx === null || String(val(o.gx, r)) === String(gx)) && (gy === null || String(val(o.gy, r)) === String(gy)));
    // count scale (histogram / bar) shared across panels
    let hb;
    if (!xCat && o.x !== undefined) hb = Plot.bins(rows.map(r => val(o.x, r)));
    if (yMode === 'count') {
      let mx = 1;
      for (const gx of gxL) for (const gy of gyL) {
        const pr = panelRows(gx, gy);
        if (els.includes('histogram') && hb) { const c = new Array(hb.edges.length).fill(0); pr.forEach(r => c[Math.floor((val(o.x, r) - hb.edges[0]) / hb.bw + 1e-9)]++); mx = Math.max(mx, ...c); }
        if (els.includes('bar')) { const m = new Map(); pr.forEach(r => { const k = (o.x !== undefined ? String(val(o.x, r)) : '') + '|' + (o.ov !== undefined ? String(val(o.ov, r)) : ''); m.set(k, (m.get(k) || 0) + 1); }); mx = Math.max(mx, ...m.values()); }
      }
      ys = { min: 0, max: mx * 1.08, pad: false };
    }
    if (yMode === 'col' && !yCat && els.includes('bar') && xCat) ys = { min: Math.min(0, ys.min), max: ys.max };
    const ncol = gxL.length, nrow = gyL.length;
    const totalW = Math.max(300, Math.min(760, 640)), totalH = Math.max(260, 440);
    const pw = Math.max(150, Math.floor((totalW - 60) / ncol)), ph = Math.max(130, Math.floor((totalH - 50) / nrow));
    let cells = '';
    gyL.forEach((gy, ri) => {
      gxL.forEach((gx, cj) => {
        const first = cj === 0, last = ri === nrow - 1;
        const p = Plot.frame({ w: pw + (first ? 60 : 0) + (cj === ncol - 1 ? 14 : 0), h: ph + (last ? 44 : 0), x: xs, y: ys, ml: first ? 60 : 4, mb: last ? (xCat && xs.levels.length > 6 ? 64 : 42) : 4, mt: 4, mr: cj === ncol - 1 ? 18 : 4,
          noXAxis: !last, noYAxis: !first || yMode === 'none', xLabel: last && o.x !== undefined ? t.columns[o.x].name : '', yLabel: first ? (yMode === 'col' ? t.columns[o.y].name : yMode === 'count' ? 'Count' : '') : '' });
        const pr = panelRows(gx, gy);
        this.drawElements(ctx, p, pr, els, { xCat, yCat, yMode, ovL, ovColor, hb });
        const head = gx !== null && ri === 0 ? `<div class="gb-fh" style="margin-left:${first ? 60 : 4}px">${esc(String(gx))}</div>` : '';
        cells += `<div class="gb-cell" style="grid-column:${cj + 1};grid-row:${ri + 1}">${head}${p.svg()}</div>`;
      });
      if (gyL[0] !== null) cells += `<div class="gb-fv" style="grid-column:${ncol + 1};grid-row:${ri + 1}">${esc(String(gy))}</div>`;
    });
    const html = `<div class="gb-grid" style="grid-template-columns:repeat(${ncol}, auto)${gyL[0] !== null ? ' 24px' : ''}">${cells}</div>`;
    const legend = o.ov !== undefined && !o.nolegend ? `<div class="gb-leg"><div class="b small">${esc(t.columns[o.ov].name)}</div>${ovL.map(l => `<div class="lgi"><i style="background:${ovColor(l)}"></i>${esc(String(l))}</div>`).join('')}</div>` : '';
    return { html, legend };
  },
  drawElements(ctx, p, rows, els, { xCat, yCat, yMode, ovL, ovColor, hb }) {
    const t = ctx.t, o = ctx.opts, val = (ci, r) => t.columns[ci].values[r];
    const groups = ovL.map(l => ({ l, rows: l === null ? rows : rows.filter(r => String(val(o.ov, r)) === String(l)) }));
    const ng = groups.length;
    const jit = o.jit !== false;
    const xpos = (r, gi = 0, dodge = false) => {
      if (o.x === undefined) return p.L + p.xb * 0.5 + (jit ? (hash01(r) - 0.5) * p.xb * 0.5 : 0);
      if (!xCat) return p.X(val(o.x, r));
      const base = p.X(val(o.x, r));
      return base + (dodge && ng > 1 ? (gi - (ng - 1) / 2) * p.xb * 0.8 / ng : 0) + (jit ? (hash01(r) - 0.5) * p.xb * (dodge ? 0.6 / ng : 0.5) : 0);
    };
    const ypos = r => yMode === 'col' ? (yCat ? p.Y(val(o.y, r)) + (jit ? (hash01(r + 7) - 0.5) * p.yb * 0.5 : 0) : p.Y(val(o.y, r))) : p.T + (p.B - p.T) * (0.15 + 0.7 * hash01(r + 3));
    const yNum = yMode === 'col' && !yCat;
    for (const el of els) {
      groups.forEach(({ l, rows: gr }, gi) => {
        const color = ovColor(l);
        if (el === 'points') gr.forEach(r => p.add(Plot.pt(t, r, xpos(r, gi, xCat && (els.includes('box') || els.includes('bar'))), ypos(r), { color: o.ov !== undefined ? color : undefined })));
        else if ((el === 'smoother' || el === 'linefit') && !xCat && yNum && o.x !== undefined && gr.length > 2) {
          const xs = gr.map(r => val(o.x, r)), ys = gr.map(r => val(o.y, r));
          if (el === 'smoother') p.add(Plot.line(S.loess(xs, ys, o.span || 0.6, 60).map(([x, y]) => [p.X(x), p.Y(y)]), 'fit', `stroke:${o.ov !== undefined ? color : '#2f6bc6'}`));
          else {
            const m = S.ols(xs.map(x => [1, x]), ys); if (!m) return;
            const x0 = S.min(xs), x1 = S.max(xs);
            const pts = []; for (let i = 0; i <= 30; i++) { const x = x0 + (x1 - x0) * i / 30; pts.push([x, m.b[0] + m.b[1] * x, S.tInv(0.975, m.dfe) * Math.sqrt(m.mse * S.quad(m.inv, [1, x]))]); }
            const c = o.ov !== undefined ? color : '#d9412b';
            p.add(`<path d="M${pts.map(q => p.X(q[0]) + ',' + p.Y(q[1] + q[2])).join('L')}L${[...pts].reverse().map(q => p.X(q[0]) + ',' + p.Y(q[1] - q[2])).join('L')}Z" fill="${c}" opacity=".15"/>`);
            p.add(Plot.line(pts.map(q => [p.X(q[0]), p.Y(q[1])]), 'fit', `stroke:${c}`));
            p.over.push(`<text class="tl" x="${p.R - 6}" y="${p.T + 12 + gi * 12}" text-anchor="end" fill="${c}">R² ${fmtD(m.r2, 3)}</text>`);
          }
        }
        else if ((el === 'line' || el === 'area') && yNum) {
          const m = new Map(); gr.forEach(r => { const k = o.x !== undefined ? String(val(o.x, r)) : ''; if (!m.has(k)) m.set(k, { x: o.x !== undefined ? val(o.x, r) : '', v: [] }); m.get(k).v.push(val(o.y, r)); });
          let pts = [...m.values()].map(g => [o.x !== undefined ? p.X(g.x) : p.L + p.xb / 2, p.Y(S.mean(g.v)), g.x]);
          if (!xCat) pts.sort((a, b) => a[2] - b[2]); else pts.sort((a, b) => a[0] - b[0]);
          if (el === 'area' && pts.length) p.add(`<path d="M${pts[0][0]},${p.Y(Math.max(p.yt.lo, 0))}L${pts.map(q => q[0] + ',' + q[1]).join('L')}L${pts[pts.length - 1][0]},${p.Y(Math.max(p.yt.lo, 0))}Z" fill="${o.ov !== undefined ? color : '#7ea3d4'}" opacity=".45"/>`);
          p.add(Plot.line(pts, 'fit', `stroke:${o.ov !== undefined ? color : '#2f6bc6'}`));
        }
        else if (el === 'bar' && (xCat || o.x === undefined)) {
          const lvls = o.x !== undefined ? p.xlev : [''];
          lvls.forEach((lv, li) => {
            const br = o.x !== undefined ? gr.filter(r => String(val(o.x, r)) === lv) : gr;
            if (!br.length) return;
            const h = yMode === 'count' ? br.length : yNum ? S.mean(br.map(r => val(o.y, r))) : NaN;
            if (!isNum(h)) return;
            const bw = p.xb * 0.8 / ng, x0 = p.L + p.xb * li + p.xb * 0.1 + bw * gi;
            p.add(Plot.bar(t, x0, p.Y(Math.max(0, p.yt.lo)), x0 + bw, p.Y(h), br, { fill: o.ov !== undefined ? color : '#7ea3d4' }));
          });
        }
        else if (el === 'bar' && yCat && o.x === undefined) { /* handled via counts above */ }
        else if (el === 'box' && yNum) {
          const lvls = o.x !== undefined && xCat ? p.xlev : [null];
          lvls.forEach((lv, li) => {
            const br = lv === null ? gr : gr.filter(r => String(val(o.x, r)) === lv);
            if (br.length < 2) return;
            const center = lv === null ? (o.x === undefined ? p.L + p.xb / 2 : (p.L + p.R) / 2) : p.L + p.xb * (li + 0.5) + (ng > 1 ? (gi - (ng - 1) / 2) * p.xb * 0.8 / ng : 0);
            p.add(Plot.boxPlot(p, t, br, br.map(r => val(o.y, r)), { vertical: true, center, width: Math.min(36, (p.xb || 60) * 0.5 / ng), color: o.ov !== undefined ? color : '#333', meanDiamond: false, outliers: !els.includes('points') }));
          });
        }
        else if (el === 'histogram' && !xCat && o.x !== undefined && hb && yMode === 'count') {
          const c = hb.edges.map(() => []); gr.forEach(r => c[Math.floor((val(o.x, r) - hb.edges[0]) / hb.bw + 1e-9)].push(r));
          c.forEach((b, k) => { if (b.length && k < hb.edges.length - 1) p.add(Plot.bar(t, p.X(hb.edges[k]), p.Y(0), p.X(hb.edges[k + 1]), p.Y(b.length), b, { fill: o.ov !== undefined ? color : '#7ea3d4' })); });
        }
        else if (el === 'heatmap' && gi === 0 && xCat && yCat) {
          const cnt = new Map(); rows.forEach(r => { const k = String(val(o.x, r)) + '|' + String(val(o.y, r)); if (!cnt.has(k)) cnt.set(k, []); cnt.get(k).push(r); });
          const mx = Math.max(...[...cnt.values()].map(v => v.length));
          p.xlev.forEach((xl, i) => p.ylev.forEach((yl, j) => { const rs = cnt.get(xl + '|' + yl) || []; if (!rs.length) return; const a = rs.length / mx; p.add(`<rect class="bar" x="${p.L + p.xb * i}" y="${p.B - p.yb * (j + 1)}" width="${p.xb}" height="${p.yb}" fill="rgba(217,65,43,${0.12 + a * 0.85})" data-rows="${rs.join(',')}"/><text class="tl" x="${p.L + p.xb * (i + 0.5)}" y="${p.B - p.yb * (j + 0.5) + 4}" text-anchor="middle">${rs.length}</text>`); }));
        }
      });
    }
  },
  after(rep) {
    const b = rep.body;
    $$('.gb-cols li', b).forEach(li => {
      li.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', 'cols:' + li.dataset.ci));
      li.addEventListener('dblclick', () => { const ci = +li.dataset.ci; const k = rep.opts.x === undefined ? 'x' : rep.opts.y === undefined ? 'y' : 'ov'; this.assign(rep, k, ci); });
    });
    $$('.gbz', b).forEach(z => {
      z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', e => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('cols:')) this.assign(rep, z.dataset.zone, +d.slice(5).split(',')[0]); });
    });
    // dropping on the plot itself assigns X (or Y if X is taken)
    const plot = $('.gb-plot', b);
    if (plot) {
      plot.addEventListener('dragover', e => e.preventDefault());
      plot.addEventListener('drop', e => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('cols:')) this.assign(rep, rep.opts.x === undefined ? 'x' : 'y', +d.slice(5).split(',')[0]); });
    }
  },
  assign(rep, k, ci) {
    rep.opts[k] = ci;
    if (k === 'x' || k === 'y') rep.opts.els = [];
    rep.render();
  },
  actions: {
    gbel(rep, btn) {
      const k = btn.dataset.el, o = rep.opts;
      const cur = o.els && o.els.length ? [...o.els] : Platforms.graphbuilder.autoElements(rep.t, o);
      const i = cur.indexOf(k);
      if (i >= 0) cur.splice(i, 1); else cur.push(k);
      o.els = cur.length ? cur : ['points'];
      rep.render();
    },
    gbclear(rep, x) { delete rep.opts[x.dataset.zone]; if (x.dataset.zone === 'x' || x.dataset.zone === 'y') rep.opts.els = []; rep.render(); },
    gbreset(rep) { rep.opts = { els: [] }; rep.render(); },
    gbdone(rep) { rep.opts.done = true; rep.render(); },
  },
};
