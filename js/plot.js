'use strict';
/* SVG plotting primitives: scales, axes, frames, markers. */

const POINT_LIMIT = 40000;
const Plot = (() => {
  function niceNum(x, round) {
    if (!(x > 0)) return 1;
    const e = Math.floor(Math.log10(x)); const f = x / 10 ** e; let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * 10 ** e;
  }
  function ticks(lo, hi, n = 6, pad = true) {
    if (!(isFinite(lo) && isFinite(hi))) { lo = 0; hi = 1; }
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    if (pad) { const p = (hi - lo) * 0.02; lo -= p; hi += p; }
    const step = niceNum(niceNum(hi - lo, false) / (n - 1), true);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const t = []; for (let v = a; v <= b + step * 0.5; v += step) t.push(+v.toPrecision(12));
    return { lo: a, hi: b, step, ticks: t };
  }
  const tickLabel = v => { const s = fmt(v, 6); return s.length > 9 ? Number(v).toPrecision(3) : s; };

  let clipN = 0;
  /**
   * Create a plot frame.
   * o.x / o.y: {min,max} for continuous or {levels:[...]} for categorical; optional ticks
   */
  function frame(o) {
    const W = o.w ?? 400, H = o.h ?? 280;
    const xcat = !!o.x.levels, ycat = !!o.y.levels;
    const rot = xcat && o.x.levels.length > 6;
    const ml = o.ml ?? (o.noYAxis ? 10 : 58), mr = o.mr ?? 14, mt = o.mt ?? 10, mb = o.mb ?? (o.noXAxis ? 8 : rot ? 64 : 42);
    const L = ml, R = W - mr, T = mt, B = H - mb;
    const p = { W, H, L, R, T, B, parts: [], under: [], over: [], o };
    if (xcat) { p.xlev = o.x.levels.map(String); p.xb = (R - L) / Math.max(1, p.xlev.length); p.X = v => L + p.xb * (p.xlev.indexOf(String(v)) + 0.5); }
    else { const tk = o.x.ticks || ticks(o.x.min, o.x.max, o.x.n || Math.max(3, Math.round((R - L) / 70)), o.x.pad !== false); p.xt = tk; p.X = v => L + (v - tk.lo) / (tk.hi - tk.lo) * (R - L); p.Xinv = px => tk.lo + (px - L) / (R - L) * (tk.hi - tk.lo); }
    if (ycat) { p.ylev = o.y.levels.map(String); p.yb = (B - T) / Math.max(1, p.ylev.length); p.Y = v => B - p.yb * (p.ylev.indexOf(String(v)) + 0.5); }
    else { const tk = o.y.ticks || ticks(o.y.min, o.y.max, o.y.n || Math.max(3, Math.round((B - T) / 45)), o.y.pad !== false); p.yt = tk; p.Y = v => B - (v - tk.lo) / (tk.hi - tk.lo) * (B - T); p.Yinv = py => tk.lo + (B - py) / (B - T) * (tk.hi - tk.lo); }
    p.add = s => { p.parts.push(s); return p; };
    p.clip = 'clp' + (++clipN);
    p.svg = (attrs = '') => {
      let g = '';
      if (o.grid !== false) {
        if (p.xt && o.xgrid !== false) for (const t of p.xt.ticks) { const x = p.X(t); if (x > L + 0.5 && x < R - 0.5) g += `<line class="gline" x1="${x}" x2="${x}" y1="${T}" y2="${B}"/>`; }
        if (p.yt) for (const t of p.yt.ticks) { const y = p.Y(t); if (y > T + 0.5 && y < B - 0.5) g += `<line class="gline" x1="${L}" x2="${R}" y1="${y}" y2="${y}"/>`; }
      }
      let ax = '';
      if (!o.noXAxis) {
        if (p.xt) for (const t of p.xt.ticks) { const x = p.X(t); ax += `<line class="tick" x1="${x}" x2="${x}" y1="${B}" y2="${B + 4}"/><text class="tl" x="${x}" y="${B + 15}" text-anchor="middle">${tickLabel(t)}</text>`; }
        else p.xlev.forEach((lv, i) => {
          const x = L + p.xb * (i + 0.5);
          const lab = esc(lv.length > 14 ? lv.slice(0, 13) + '…' : lv);
          ax += rot ? `<text class="tl" transform="translate(${x + 3},${B + 10}) rotate(-40)" text-anchor="end">${lab}</text>` : `<text class="tl" x="${x}" y="${B + 15}" text-anchor="middle">${lab}</text>`;
          if (i) ax += `<line class="tick" x1="${L + p.xb * i}" x2="${L + p.xb * i}" y1="${B}" y2="${B + 4}"/>`;
        });
        if (o.xLabel) ax += `<text class="axl" x="${(L + R) / 2}" y="${H - 6}" text-anchor="middle">${esc(o.xLabel)}</text>`;
      }
      if (!o.noYAxis) {
        if (p.yt) for (const t of p.yt.ticks) { const y = p.Y(t); ax += `<line class="tick" x1="${L - 4}" x2="${L}" y1="${y}" y2="${y}"/><text class="tl" x="${L - 6}" y="${y + 3.5}" text-anchor="end">${tickLabel(t)}</text>`; }
        else p.ylev.forEach((lv, i) => { const y = B - p.yb * (i + 0.5); ax += `<text class="tl" x="${L - 6}" y="${y + 3.5}" text-anchor="end">${esc(lv.length > 10 ? lv.slice(0, 9) + '…' : lv)}</text>`; });
        if (o.yLabel) ax += `<text class="axl" transform="translate(13,${(T + B) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
      }
      return `<svg class="plot" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${attrs}>
        <defs><clipPath id="${p.clip}"><rect x="${L}" y="${T}" width="${R - L}" height="${B - T}"/></clipPath></defs>
        <rect class="plotbg" x="${L}" y="${T}" width="${R - L}" height="${B - T}"/>${g}${p.under.join('')}
        <g clip-path="url(#${p.clip})">${p.parts.join('')}</g>${p.over.join('')}
        <rect class="frame" x="${L}" y="${T}" width="${R - L}" height="${B - T}"/>${ax}</svg>`;
    };
    return p;
  }

  /** Marker for a data row; honours row states (hidden, selected, color, label) */
  function pt(t, r, x, y, opt = {}) {
    const st = t.rows[r];
    if (st.hid || !isFinite(x) || !isFinite(y)) return '';
    // very large tables: draw a fixed pseudo-random sample of points (statistics still use all rows); selected rows always show
    if (t.nrows > POINT_LIMIT && !st.sel && hash01(r) * t.nrows > POINT_LIMIT) return '';
    const color = opt.color || st.color || '#2b2b2b';
    const rad = (opt.r || 2.7) + (st.sel ? 1.1 : 0);
    const dim = t.selCount && !st.sel ? ' dim' : '';
    let s = `<circle class="pt${st.sel ? ' sel' : ''}${dim}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}" fill="${color}" data-rows="${r}"/>`;
    if (st.lab) s += `<text class="ptlab" x="${(x + 5).toFixed(1)}" y="${(y - 4).toFixed(1)}">${esc(t.labelValue(r))}</text>`;
    return s;
  }
  const line = (pts, cls = 'fit', style = '') => pts.length < 2 ? '' : `<polyline class="${cls}" style="${style}" points="${pts.filter(p => isFinite(p[0]) && isFinite(p[1])).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
  const hline = (p, y, cls = 'ref', style = '') => `<line class="${cls}" style="${style}" x1="${p.L}" x2="${p.R}" y1="${p.Y(y)}" y2="${p.Y(y)}"/>`;
  const vline = (p, x, cls = 'ref', style = '') => `<line class="${cls}" style="${style}" x1="${p.X(x)}" x2="${p.X(x)}" y1="${p.T}" y2="${p.B}"/>`;

  /** Bar with selected-portion shading. rows: rows in this bar. */
  function bar(t, x0, y0, x1, y1, rows, opt = {}) {
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    let s = `<rect class="bar" x="${x}" y="${y}" width="${w}" height="${h}" fill="${opt.fill || '#7ea3d4'}" data-rows="${rows.join(',')}"/>`;
    const nsel = rows.filter(r => t.rows[r].sel).length;
    if (nsel && rows.length) {
      const f = nsel / rows.length;
      if (opt.horizontal) s += `<rect class="barsel" x="${x}" y="${y}" width="${w * f}" height="${h}" data-rows="${rows.join(',')}"/>`;
      else s += `<rect class="barsel" x="${x}" y="${y + h * (1 - f)}" width="${w}" height="${h * f}" data-rows="${rows.join(',')}"/>`;
    }
    return s;
  }

  /** Outlier box plot along x axis (horizontal) or y axis (vertical) */
  function boxStats(vals) {
    const s = S.sorted(vals); const q1 = S.quantile(s, 0.25), q3 = S.quantile(s, 0.75), med = S.quantile(s, 0.5);
    const iqr = q3 - q1; const lo = s.find(v => v >= q1 - 1.5 * iqr), hi = [...s].reverse().find(v => v <= q3 + 1.5 * iqr);
    return { q1, q3, med, lo, hi, iqr, mean: S.mean(s), min: s[0], max: s[s.length - 1], n: s.length, sd: S.sd(s) };
  }
  function boxPlot(p, t, rows, vals, { vertical = false, center, width = 18, color = '#333', outliers = true, meanDiamond = true } = {}) {
    if (!vals.length) return '';
    const b = boxStats(vals); let s = '';
    const hw = width / 2;
    if (!vertical) {
      const X = p.X, c = center;
      s += `<line class="whisk" x1="${X(b.lo)}" x2="${X(b.q1)}" y1="${c}" y2="${c}" stroke="${color}"/><line class="whisk" x1="${X(b.q3)}" x2="${X(b.hi)}" y1="${c}" y2="${c}" stroke="${color}"/>`;
      s += `<rect class="box" x="${X(b.q1)}" y="${c - hw}" width="${Math.max(0.5, X(b.q3) - X(b.q1))}" height="${width}" stroke="${color}" data-rows="${rows.filter((r, i) => vals[i] >= b.q1 && vals[i] <= b.q3).join(',')}"/>`;
      s += `<line x1="${X(b.med)}" x2="${X(b.med)}" y1="${c - hw}" y2="${c + hw}" stroke="${color}" stroke-width="1.6"/>`;
      if (meanDiamond && b.n > 1) {
        const ci = S.tInv(0.975, b.n - 1) * b.sd / Math.sqrt(b.n);
        s += `<polygon class="diamond" points="${X(b.mean - ci)},${c} ${X(b.mean)},${c - hw * 0.7} ${X(b.mean + ci)},${c} ${X(b.mean)},${c + hw * 0.7}"/>`;
      }
      if (outliers) rows.forEach((r, i) => { if (vals[i] < b.lo || vals[i] > b.hi) s += pt(t, r, X(vals[i]), c); });
    } else {
      const Y = p.Y, c = center;
      s += `<line class="whisk" y1="${Y(b.lo)}" y2="${Y(b.q1)}" x1="${c}" x2="${c}" stroke="${color}"/><line class="whisk" y1="${Y(b.q3)}" y2="${Y(b.hi)}" x1="${c}" x2="${c}" stroke="${color}"/>`;
      s += `<line class="whisk" x1="${c - hw * 0.4}" x2="${c + hw * 0.4}" y1="${Y(b.lo)}" y2="${Y(b.lo)}" stroke="${color}"/><line class="whisk" x1="${c - hw * 0.4}" x2="${c + hw * 0.4}" y1="${Y(b.hi)}" y2="${Y(b.hi)}" stroke="${color}"/>`;
      s += `<rect class="box" y="${Y(b.q3)}" x="${c - hw}" height="${Math.max(0.5, Y(b.q1) - Y(b.q3))}" width="${width}" stroke="${color}" data-rows="${rows.filter((r, i) => vals[i] >= b.q1 && vals[i] <= b.q3).join(',')}"/>`;
      s += `<line y1="${Y(b.med)}" y2="${Y(b.med)}" x1="${c - hw}" x2="${c + hw}" stroke="${color}" stroke-width="1.6"/>`;
      if (outliers) rows.forEach((r, i) => { if (vals[i] < b.lo || vals[i] > b.hi) s += pt(t, r, c, Y(vals[i])); });
    }
    return s;
  }

  function legend(items, x = 0, y = 0) {
    return `<div class="legend">${items.map(([lab, col]) => `<span class="lgi"><i style="background:${col}"></i>${esc(lab)}</span>`).join('')}</div>`;
  }

  /** Histogram bin edges */
  function bins(vals, bw) {
    const mn = S.min(vals), mx = S.max(vals);
    if (!bw || !(bw > 0)) bw = niceNum((mx - mn || 1) / Math.max(5, Math.min(30, Math.ceil(Math.log2(vals.length) + 1))), true);
    let start = Math.floor(mn / bw) * bw;
    const edges = []; for (let v = start; v <= mx + bw * 1e-9; v += bw) edges.push(+v.toPrecision(12));
    edges.push(+(edges[edges.length - 1] + bw).toPrecision(12));
    return { edges, bw };
  }

  return { niceNum, ticks, frame, pt, line, hline, vline, bar, boxStats, boxPlot, legend, bins };
})();
