'use strict';
/* Graph Builder: drop zones (X, Y, Group X, Group Y, Wrap, Overlay, Color, Size, Interval, Freq),
   elements with properties (summary statistic, error interval, jitter, …), legend, local data filter. */

const GB_ELEMENTS = [
  ['points', 'Points', '<circle cx="5" cy="12" r="1.8"/><circle cx="9" cy="7" r="1.8"/><circle cx="13" cy="10" r="1.8"/><circle cx="16" cy="4" r="1.8"/>'],
  ['smoother', 'Smoother', '<path d="M2 14 C6 4, 10 14, 18 4" fill="none" stroke-width="1.8"/>'],
  ['linefit', 'Line of Fit', '<path d="M2 15 L18 4" stroke-width="1.8"/><circle cx="6" cy="10" r="1.4"/><circle cx="13" cy="9" r="1.4"/>'],
  ['ellipse', 'Ellipse', '<ellipse cx="10" cy="10" rx="8" ry="4.5" transform="rotate(-30 10 10)" fill="none" stroke-width="1.6"/><circle cx="8" cy="11" r="1.2"/><circle cx="12" cy="9" r="1.2"/>'],
  ['line', 'Line', '<path d="M2 13 L7 6 L11 10 L18 3" fill="none" stroke-width="1.8"/>'],
  ['bar', 'Bar', '<rect x="3" y="8" width="4" height="9"/><rect x="8.5" y="4" width="4" height="13"/><rect x="14" y="10" width="4" height="7"/>'],
  ['area', 'Area', '<path d="M2 17 L2 11 L7 6 L12 9 L18 4 L18 17 Z"/>'],
  ['box', 'Box Plot', '<rect x="6" y="5" width="8" height="8" fill="none" stroke-width="1.5"/><path d="M10 1v4M10 13v5M6 9h8" stroke-width="1.5"/>'],
  ['histogram', 'Histogram', '<rect x="2" y="10" width="4" height="7"/><rect x="6" y="4" width="4" height="13"/><rect x="10" y="7" width="4" height="10"/><rect x="14" y="12" width="4" height="5"/>'],
  ['heatmap', 'Heatmap', '<rect x="2" y="2" width="7" height="7" opacity=".9"/><rect x="11" y="2" width="7" height="7" opacity=".4"/><rect x="2" y="11" width="7" height="7" opacity=".5"/><rect x="11" y="11" width="7" height="7" opacity=".8"/>'],
  ['pie', 'Pie', '<path d="M10 10 L10 2 A8 8 0 0 1 17.6 12.5 Z"/><path d="M10 10 L17.6 12.5 A8 8 0 1 1 10 2 Z" opacity=".45"/>'],
  ['caption', 'Caption Box', '<rect x="9" y="2" width="9" height="6" fill="none" stroke-width="1.3"/><path d="M11 4h5M11 6h3" stroke-width="1"/><circle cx="5" cy="14" r="1.4"/><circle cx="9" cy="12" r="1.4"/>'],
];
const GB_STATS = ['None', 'N', 'Mean', 'Median', 'Mode', 'Geometric Mean', 'Min', 'Max', 'Range', 'Sum', 'Cumulative Sum', 'Cumulative Percent', '% of Total', '% of Factor', '% of Grand Total', 'Std Dev', 'Variance', 'Std Err', 'CV', 'Interquartile Range', 'First Quartile', 'Third Quartile'];
const GB_ERR = ['None', 'Range', 'Interquartile Range', 'Standard Error', 'Standard Deviation', 'Confidence Interval', 'Median Absolute Deviation'];
const GB_ZONES = { x: 'X', y: 'Y', gx: 'Group X', gy: 'Group Y', wrap: 'Wrap', ov: 'Overlay', color: 'Color', size: 'Size', interval: 'Interval', freq: 'Freq' };
const GB_PALETTES = {
  Default: PALETTE,
  'Muted': ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  'Bold': ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
  'Grayscale': ['#111', '#555', '#888', '#aaa', '#333', '#777', '#999', '#bbb'],
};
const GB_GRADIENTS = { 'Blue to Red': ['#2f6bc6', '#f2f2f2', '#d9412b'], 'Viridis': ['#440154', '#21918c', '#fde725'], 'White to Blue': ['#f4f8fd', '#7ea3d4', '#123a7a'], 'Green to Red': ['#2e9a3a', '#f3d03e', '#d9412b'] };

const GBStat = {
  wsum: (v, w) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * (w ? w[i] : 1); return s; },
  compute(name, v, w) {
    if (!v.length) return NaN;
    const s = S.sorted(v), n = w ? S.sum(w) : v.length;
    switch (name) {
      case 'N': return n;
      case 'Mean': case 'None': return w ? GBStat.wsum(v, w) / n : S.mean(v);
      case 'Median': return S.quantile(s, 0.5);
      case 'Mode': { const m = new Map(); let best = s[0], bc = 0; for (const x of s) { const c = (m.get(x) || 0) + 1; m.set(x, c); if (c > bc) { bc = c; best = x; } } return best; }
      case 'Geometric Mean': return s[0] > 0 ? Math.exp(S.mean(v.map(Math.log))) : NaN;
      case 'Min': return s[0]; case 'Max': return s[s.length - 1]; case 'Range': return s[s.length - 1] - s[0];
      case 'Sum': case 'Cumulative Sum': case 'Cumulative Percent': case '% of Total': case '% of Factor': case '% of Grand Total': return GBStat.wsum(v, w);
      case 'Std Dev': return S.sd(v); case 'Variance': return S.variance(v); case 'Std Err': return S.sd(v) / Math.sqrt(v.length);
      case 'CV': return 100 * S.sd(v) / S.mean(v); case 'Interquartile Range': return S.quantile(s, 0.75) - S.quantile(s, 0.25);
      case 'First Quartile': return S.quantile(s, 0.25); case 'Third Quartile': return S.quantile(s, 0.75);
    }
    return S.mean(v);
  },
  interval(name, v, center, alpha) {
    if (!v.length || name === 'None') return null;
    const s = S.sorted(v), n = v.length, sd = S.sd(v), m = S.mean(v);
    const c = isNum(center) ? center : m;
    switch (name) {
      case 'Range': return [s[0], s[n - 1]];
      case 'Interquartile Range': return [S.quantile(s, 0.25), S.quantile(s, 0.75)];
      case 'Standard Error': return n > 1 ? [c - sd / Math.sqrt(n), c + sd / Math.sqrt(n)] : null;
      case 'Standard Deviation': return n > 1 ? [c - sd, c + sd] : null;
      case 'Confidence Interval': { if (n < 2) return null; const h = S.tInv(1 - alpha / 2, n - 1) * sd / Math.sqrt(n); return [m - h, m + h]; }
      case 'Median Absolute Deviation': { const md = S.quantile(s, 0.5); const mad = S.median(v.map(x => Math.abs(x - md))); return [md - mad, md + mad]; }
    }
    return null;
  },
};

function lerpColor(stops, f) {
  f = Math.max(0, Math.min(1, isNum(f) ? f : 0));
  const seg = f * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(seg)), u = seg - i;
  const h = c => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(k => parseInt(c.slice(k, k + 2), 16)); };
  const a = h(stops[i]), b = h(stops[i + 1]);
  return '#' + a.map((x, k) => Math.round(x + (b[k] - x) * u).toString(16).padStart(2, '0')).join('');
}

Platforms.graphbuilder = {
  title: () => 'Graph Builder', w: 1080, h: 700,
  launch(t) { return Promise.resolve(new Report(t, 'graphbuilder', {}, { els: [] })); },
  defaults: {},
  elDefaults(type, o, t) {
    const yNum = o.y !== undefined && !t.isCat(o.y);
    switch (type) {
      case 'points': return { stat: 'None', err: 'None', style: 'Error Bar', jitter: 'Auto', jlim: 0.5 };
      case 'smoother': return { span: 0.6 };
      case 'linefit': return { deg: 'Linear', conf: true, r2: true, eq: false };
      case 'ellipse': return { cov: 0.95 };
      case 'line': return { stat: yNum ? 'Mean' : 'N', err: 'None', style: 'Error Bar', conn: 'Line', order: false };
      case 'bar': return { stat: yNum ? 'Mean' : 'N', err: 'None', style: 'Side by side', label: false };
      case 'area': return { stat: yNum ? 'Mean' : 'N', stacked: false };
      case 'box': return { outliers: true, width: 0.5, mean: false };
      case 'histogram': return { bins: 0, density: false };
      case 'heatmap': return { labels: true };
      case 'pie': return { labels: true };
      case 'caption': return { stat: 'Mean', loc: 'Top Right', col: 'y' };
    }
    return {};
  },
  autoTypes(t, o) {
    const xc = o.x !== undefined ? t.isCat(o.x) : null, yc = o.y !== undefined ? t.isCat(o.y) : null;
    if (xc === false && yc === false) return ['points', 'smoother'];
    if (xc === false && yc === null) return ['histogram'];
    if (xc === true && yc === null) return ['bar'];
    if (xc === true && yc === true) return ['heatmap'];
    if (xc === null && yc === false) return ['points'];
    if (xc === null && yc === true) return ['points'];
    return ['points'];
  },
  /** normalize element list into objects; empty list = automatic elements */
  elements(t, o) {
    if (!o.els || !o.els.length) return this.autoTypes(t, o).map(type => ({ type, ...this.elDefaults(type, o, t), auto: true }));
    return o.els.map(e => typeof e === 'string' ? { type: e, ...this.elDefaults(e, o, t) } : e);
  },
  materialize(rep) { const o = rep.opts; if (!o.els || !o.els.length || o.els.some(e => typeof e === 'string')) o.els = this.elements(rep.t, o).map(e => { const c = { ...e }; delete c.auto; return c; }); return o.els; },

  render(ctx) {
    const t = ctx.t, o = ctx.opts;
    const els = this.elements(t, o);
    if (o.selEl === undefined || o.selEl >= els.length) o.selEl = 0;
    const zone = k => {
      const ci = o[k];
      return `<div class="gbz gbz-${k}" data-zone="${k}">${ci !== undefined && t.columns[ci] ? `<span class="gbchip" title="${esc(t.columns[ci].name)}">${esc(t.columns[ci].name)}<b data-action="gbclear" data-zone="${k}" title="Remove">&#10005;</b></span>` : `<span class="gbph">${GB_ZONES[k]}</span>`}</div>`;
    };
    const graph = this.graph(ctx, els);
    const show = { legend: true, title: true, footer: false, grid: true, xtitle: true, ytitle: true, ...(o.show || {}) };
    const ttl = o.title || (o.y !== undefined && o.x !== undefined ? `${t.columns[o.y]?.name} vs. ${t.columns[o.x]?.name}` : o.x !== undefined ? t.columns[o.x]?.name : o.y !== undefined ? t.columns[o.y]?.name : 'Drag variables into the zones');
    const control = !o.done;
    const legendBottom = o.legendPos === 'Bottom';
    const legend = show.legend ? graph.legend : '';
    const body = `<div class="gb ${control ? '' : 'done'}">
      ${control ? `<div class="gb-cols"><div class="gb-h">Variables <span class="mut small">(${t.columns.length})</span></div><ul>${t.columns.map((c, i) => `<li draggable="true" data-ci="${i}" title="${esc(c.name)}">${typeIcon(c.modelingType)}<span>${esc(c.name)}</span></li>`).join('')}</ul>
        <div class="gb-btns"><button class="btn" data-action="gbreset">Start Over</button><button class="btn primary" data-action="gbdone">Done</button></div>
        ${this.propsPanel(ctx, els)}</div>` : ''}
      <div class="gb-main">
        ${control ? `<div class="gb-els">${GB_ELEMENTS.map(([k, lab, icon]) => `<button class="gbel ${els.some(e => e.type === k) ? 'on' : ''}" data-action="gbel" data-el="${k}" title="${lab} (click: add/remove, Shift+click: only this)"><svg viewBox="0 0 20 20" width="22" height="22">${icon}</svg></button>`).join('')}</div>` : ''}
        ${show.title ? `<div class="gb-title">${esc(ttl)}</div>` : ''}
        <div class="gb-area ${legendBottom ? 'legbottom' : ''}">
          ${control ? zone('gx') + zone('y') : ''}
          <div class="gb-plot">${graph.html}</div>
          ${control ? zone('gy') : ''}
          <div class="gb-side">${control ? `<div class="gb-zcol">${zone('wrap')}${zone('ov')}${zone('color')}${zone('size')}${zone('interval')}${zone('freq')}</div>` : ''}${legendBottom ? '' : legend}</div>
          ${control ? zone('x') : ''}
          ${legendBottom ? `<div class="gb-legb">${legend}</div>` : ''}
        </div>
        ${show.footer ? `<div class="small mut gb-foot">N = ${graph.n.toLocaleString()}${graph.notes.length ? ' · ' + graph.notes.join(' · ') : ''}</div>` : graph.notes.length ? `<div class="small mut gb-foot">${graph.notes.join(' · ')}</div>` : ''}
      </div></div>`;
    const R = ctx.rep, rr = () => R.render();
    const set = (k, v) => () => { R.opts[k] = v; rr(); };
    const showItem = (k, lab) => ({ label: lab, checked: show[k], action: () => { R.opts.show = { ...show, [k]: !show[k] }; rr(); } });
    return ctx.outline('Graph Builder', body, {
      key: 'gb', menu: [
        { label: 'Show Control Panel', checked: !o.done, action: () => { R.opts.done = !o.done; rr(); } },
        { label: 'Show', submenu: [showItem('legend', 'Show Legend'), showItem('title', 'Show Title'), showItem('footer', 'Show Footer'), showItem('xtitle', 'Show X Axis Title'), showItem('ytitle', 'Show Y Axis Title'), showItem('grid', 'Show Grid Lines')] },
        { label: 'Legend Position', submenu: ['Right', 'Bottom'].map(p => ({ label: p, checked: (o.legendPos || 'Right') === p, action: set('legendPos', p) })) },
        { label: 'Legend Settings...', action: () => UI.prompt('Legend Settings', [{ key: 'title', label: 'Graph title (empty = automatic)', type: 'text', value: o.title || '' }]).then(v => { if (v) { R.opts.title = v.title.trim() || undefined; rr(); } }) },
        { label: 'Color Settings', submenu: [
          ...Object.keys(GB_PALETTES).map(p => ({ label: 'Categorical: ' + p, checked: (o.palette || 'Default') === p, action: set('palette', p) })), '-',
          ...Object.keys(GB_GRADIENTS).map(p => ({ label: 'Continuous: ' + p, checked: (o.gradient || 'Blue to Red') === p, action: set('gradient', p) }))] },
        { label: 'Lock Scales', checked: !!o.lock, action: () => { R.opts.lock = o.lock ? null : R._gbScales; rr(); } },
        { label: 'Error Bar Offset...', action: () => UI.prompt('Error Bar Offset', [{ key: 'v', label: 'Offset (fraction of band, -0.5 to 0.5)', type: 'number', value: o.errOffset || 0 }]).then(v => { if (v) { R.opts.errOffset = Math.max(-0.5, Math.min(0.5, v.v || 0)); rr(); } }) },
        { label: 'Graph Size...', action: () => UI.prompt('Graph Size', [{ key: 'w', label: 'Width (px)', type: 'number', value: o.w || 640 }, { key: 'h', label: 'Height (px)', type: 'number', value: o.h || 440 }]).then(v => { if (v) { R.opts.w = Math.max(240, v.w || 640); R.opts.h = Math.max(180, v.h || 440); rr(); } }) },
        { label: 'Sampling...', action: () => UI.prompt('Sampling', [{ key: 'n', label: 'Maximum points to draw (0 = default)', type: 'number', value: o.sampling || 0 }]).then(v => { if (v) { R.opts.sampling = v.n > 0 ? Math.round(v.n) : undefined; rr(); } }) },
        { label: 'Graph Spacing...', action: () => UI.prompt('Graph Spacing', [{ key: 'g', label: 'Space between panels (px)', type: 'number', value: o.spacing || 0 }]).then(v => { if (v) { R.opts.spacing = Math.max(0, v.g || 0); rr(); } }) },
        { label: 'Include Missing Categories', checked: !!o.missingCats, action: set('missingCats', !o.missingCats) },
        { label: 'Set α Level', submenu: [0.1, 0.05, 0.01, 0.001].map(a => ({ label: String(a), checked: (o.alpha || 0.05) === a, action: set('alpha', a) })) },
        { label: 'Launch Analysis', disabled: o.x === undefined && o.y === undefined, action: () => this.launchAnalysis(R) },
        { label: 'Make into Data Table', disabled: !R._gbSummary || !R._gbSummary.length, action: () => this.makeTable(R) },
        '-',
        { label: 'Save as SVG', action: () => { const svg = R.body.querySelector('.gb-plot svg'); if (svg) download('graph.svg', svg.outerHTML, 'image/svg+xml'); } },
        { label: 'Start Over', action: () => { R.opts = { els: [] }; rr(); } }],
    });
  },

  // ---------- element property panel ----------
  propsPanel(ctx, els) {
    const o = ctx.opts;
    const sel = (i, key, options, val) => `<select data-gbp="${key}" data-i="${i}">${options.map(x => `<option ${String(x) === String(val) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    const chk = (i, key, val) => `<input type="checkbox" data-gbp="${key}" data-i="${i}" ${val ? 'checked' : ''}>`;
    const rng = (i, key, val, min, max, step) => `<input type="range" data-gbp="${key}" data-i="${i}" min="${min}" max="${max}" step="${step}" value="${val}">`;
    const row = (lab, ctl) => `<label class="gbp-r"><span>${lab}</span>${ctl}</label>`;
    return `<div class="gb-props">${els.map((e, i) => {
      const lab = (GB_ELEMENTS.find(x => x[0] === e.type) || [0, e.type])[1];
      let rows = '';
      switch (e.type) {
        case 'points': rows = row('Summary Statistic', sel(i, 'stat', GB_STATS, e.stat)) + row('Error Interval', sel(i, 'err', GB_ERR, e.err)) + row('Interval Style', sel(i, 'style', ['Error Bar', 'Band'], e.style)) + row('Jitter', sel(i, 'jitter', ['Auto', 'None', 'Random Uniform', 'Positive Grid'], e.jitter)) + row('Jitter Limit', rng(i, 'jlim', e.jlim, 0, 1, 0.05)); break;
        case 'smoother': rows = row('Smoothness', rng(i, 'span', e.span, 0.1, 1, 0.05)); break;
        case 'linefit': rows = row('Degree', sel(i, 'deg', ['Linear', 'Quadratic', 'Cubic'], e.deg)) + row('Confidence of Fit', chk(i, 'conf', e.conf)) + row('R²', chk(i, 'r2', e.r2)) + row('Equation', chk(i, 'eq', e.eq)); break;
        case 'ellipse': rows = row('Coverage', sel(i, 'cov', [0.5, 0.9, 0.95, 0.99], e.cov)); break;
        case 'line': rows = row('Summary Statistic', sel(i, 'stat', GB_STATS, e.stat)) + row('Error Interval', sel(i, 'err', GB_ERR, e.err)) + row('Interval Style', sel(i, 'style', ['Error Bar', 'Band'], e.style)) + row('Connection', sel(i, 'conn', ['Line', 'Step', 'Centered Step'], e.conn)) + row('Row order', chk(i, 'order', e.order)); break;
        case 'bar': rows = row('Summary Statistic', sel(i, 'stat', GB_STATS.filter(s => s !== 'None'), e.stat)) + row('Error Interval', sel(i, 'err', GB_ERR, e.err)) + row('Bar Style', sel(i, 'style', ['Side by side', 'Stacked', 'Overlaid'], e.style)) + row('Label by Value', chk(i, 'label', e.label)); break;
        case 'area': rows = row('Summary Statistic', sel(i, 'stat', GB_STATS.filter(s => s !== 'None'), e.stat)) + row('Stacked', chk(i, 'stacked', e.stacked)); break;
        case 'box': rows = row('Outliers', chk(i, 'outliers', e.outliers)) + row('Show Mean', chk(i, 'mean', e.mean)) + row('Box Width', rng(i, 'width', e.width, 0.1, 1, 0.05)); break;
        case 'histogram': rows = row('Number of bins (0 = auto)', `<input type="number" data-gbp="bins" data-i="${i}" min="0" max="500" value="${e.bins}">`) + row('Density (scale to proportion)', chk(i, 'density', e.density)); break;
        case 'heatmap': case 'pie': rows = row('Labels', chk(i, 'labels', e.labels)); break;
        case 'caption': rows = row('Summary Statistic', sel(i, 'stat', GB_STATS.filter(s => s !== 'None'), e.stat)) + row('Variable', sel(i, 'col', ['y', 'x'], e.col)) + row('Location', sel(i, 'loc', ['Top Right', 'Top Left', 'Bottom Right', 'Bottom Left'], e.loc)); break;
      }
      const open = (o.openEls || [0]).includes(i);
      return `<div class="gbp ${open ? '' : 'closed'}"><div class="gbp-h" data-action="gbpopen" data-i="${i}"><span class="tri"></span><b>${esc(lab)}</b>${e.auto ? '<span class="mut small">auto</span>' : `<span class="gbp-x" data-action="gbprm" data-i="${i}" title="Remove element">✕</span>`}</div><div class="gbp-b">${rows || '<span class="small mut">No options</span>'}</div></div>`;
    }).join('')}</div>`;
  },

  // ---------- graph ----------
  graph(ctx, els) {
    const t = ctx.t, o = ctx.opts, R = ctx.rep;
    R._gbSummary = [];
    const notes = [];
    if (o.x === undefined && o.y === undefined) return { html: `<div class="gb-empty">Drop a column on <b>X</b> or <b>Y</b> to start.<br><span class="small">Tip: double-click a column to put it on X, then Y.</span></div>`, legend: '', n: 0, notes };
    const cols = ['x', 'y', 'gx', 'gy', 'wrap', 'ov', 'color', 'size', 'interval', 'freq'].filter(k => o[k] !== undefined && t.columns[o[k]]);
    const val = (ci, r) => t.columns[ci].values[r];
    const isCat = k => o[k] !== undefined && t.isCat(o[k]);
    const MISS = '(missing)';
    const catKey = (ci, r) => { const v = val(ci, r); return DataTable.isMissing(v) ? MISS : String(v); };
    // rows: drop missing in role columns (categorical missing kept when Include Missing Categories)
    let rows = ctx.rows.filter(r => !t.rows[r].hid && cols.every(k => {
      const v = val(o[k], r);
      if (!DataTable.isMissing(v)) return true;
      return !!o.missingCats && t.isCat(o[k]) && ['x', 'y', 'gx', 'gy', 'wrap', 'ov', 'color'].includes(k);
    }));
    const levelsOf = ci => { const lv = t.levels(ci, rows).map(String); if (o.missingCats && rows.some(r => DataTable.isMissing(val(ci, r)))) lv.push(MISS); return lv; };
    const xCat = isCat('x'), yCat = isCat('y');
    const pal = GB_PALETTES[o.palette || 'Default'], grad = GB_GRADIENTS[o.gradient || 'Blue to Red'];
    const ovL = o.ov !== undefined ? levelsOf(o.ov) : [null];
    const ovColor = l => l === null ? null : pal[ovL.indexOf(l) % pal.length];
    // color zone
    let colorOf = () => null, legendHtml = '';
    if (o.color !== undefined) {
      const ci = o.color;
      if (isCat('color')) { const lv = levelsOf(ci); colorOf = r => pal[lv.indexOf(catKey(ci, r)) % pal.length]; legendHtml += this.legendCat(t.columns[ci].name, lv, l => pal[lv.indexOf(l) % pal.length], 'color'); }
      else { let lo = Infinity, hi = -Infinity; for (const r of rows) { const v = val(ci, r); if (v < lo) lo = v; if (v > hi) hi = v; } colorOf = r => lerpColor(grad, (val(ci, r) - lo) / (hi - lo || 1)); legendHtml += `<div class="gb-leg"><div class="b small">${esc(t.columns[ci].name)}</div><div class="gb-grad" style="background:linear-gradient(90deg,${grad.join(',')})"></div><div class="gb-gradl small"><span>${fmt(lo, 4)}</span><span>${fmt(hi, 4)}</span></div></div>`; }
    }
    if (o.ov !== undefined) legendHtml = this.legendCat(t.columns[o.ov].name, ovL, ovColor, 'ov') + legendHtml;
    // size zone
    let sizeOf = () => null;
    if (o.size !== undefined && !isCat('size')) { let lo = Infinity, hi = -Infinity; for (const r of rows) { const v = val(o.size, r); if (v < lo) lo = v; if (v > hi) hi = v; } sizeOf = r => 2 + 9 * Math.sqrt(Math.max(0, (val(o.size, r) - lo) / (hi - lo || 1))); legendHtml += `<div class="gb-leg"><div class="b small">${esc(t.columns[o.size].name)} (size)</div><div class="small">${fmt(lo, 4)} … ${fmt(hi, 4)}</div></div>`; }
    const wOf = o.freq !== undefined ? r => Math.max(0, +val(o.freq, r) || 0) : null;
    // panels
    let panels;
    const gxL = o.gx !== undefined ? levelsOf(o.gx) : [null], gyL = o.gy !== undefined ? levelsOf(o.gy) : [null];
    if (o.wrap !== undefined) {
      const wl = levelsOf(o.wrap); const nc = Math.ceil(Math.sqrt(wl.length));
      panels = wl.map((l, i) => ({ col: i % nc, row: Math.floor(i / nc), label: l, test: r => catKey(o.wrap, r) === l }));
      panels.ncol = nc; panels.nrow = Math.ceil(wl.length / nc);
    } else {
      panels = []; gyL.forEach((gy, ri) => gxL.forEach((gx, cj) => panels.push({ col: cj, row: ri, gx, gy, test: r => (gx === null || catKey(o.gx, r) === gx) && (gy === null || catKey(o.gy, r) === gy) })));
      panels.ncol = gxL.length; panels.nrow = gyL.length;
    }
    panels.forEach(p => { p.rows = rows.filter(p.test); });
    // x/y scales
    const xs = o.x !== undefined ? (xCat ? { levels: levelsOf(o.x) } : { min: S.min(rows.map(r => val(o.x, r))), max: S.max(rows.map(r => val(o.x, r))) }) : { levels: [''] };
    const yNum = o.y !== undefined && !yCat;
    const alpha = o.alpha || 0.05;
    // pre-compute element primitives per panel in data units, gather y extents
    let ymin = Infinity, ymax = -Infinity;
    const ext = (...v) => { for (const x of v) if (isNum(x)) { if (x < ymin) ymin = x; if (x > ymax) ymax = x; } };
    if (yNum) for (const r of rows) ext(val(o.y, r));
    let countMode = false;
    const hb = !xCat && o.x !== undefined ? Plot.bins(rows.map(r => val(o.x, r))) : null;
    const plan = panels.map(p => ({ p, prims: [] }));
    const xKey = r => o.x === undefined ? '' : xCat ? catKey(o.x, r) : val(o.x, r);
    const ng = ovL.length;
    for (const pl of plan) {
      const P = pl.p, prims = pl.prims;
      const groups = ovL.map(l => ({ l, rows: l === null ? P.rows : P.rows.filter(r => catKey(o.ov, r) === l) }));
      els.forEach((e, ei) => {
        const statNeeded = (e.type === 'points' && e.stat !== 'None') || e.type === 'line' || e.type === 'bar' || e.type === 'area';
        if (statNeeded) {
          // summary by x value and overlay group
          const yv = r => yNum ? val(o.y, r) : 1;
          const stat = e.stat === 'None' ? 'Mean' : e.stat;
          const useCount = !yNum;
          if (useCount) countMode = true;
          const perGroup = groups.map(g => {
            const m = new Map();
            for (const r of g.rows) { const k = String(xKey(r)); if (!m.has(k)) m.set(k, { x: xKey(r), rows: [] }); m.get(k).rows.push(r); }
            let cells = [...m.values()];
            if (xCat) cells.sort((a, b) => xs.levels.indexOf(String(a.x)) - xs.levels.indexOf(String(b.x))); else if (o.x !== undefined) cells.sort((a, b) => a.x - b.x);
            cells.forEach(c => {
              const v = c.rows.map(yv), w = wOf ? c.rows.map(wOf) : null;
              c.v = useCount ? (w ? S.sum(w) : c.rows.length) : GBStat.compute(stat, v, w);
              if (useCount && !['N', 'Sum', 'Cumulative Sum', 'Cumulative Percent', '% of Total', '% of Factor', '% of Grand Total'].includes(stat)) c.v = w ? S.sum(w) : c.rows.length;
              c.iv = yNum ? GBStat.interval(e.err, v, c.v, alpha) : null;
            });
            return { g, cells };
          });
          // percent / cumulative transforms
          const tot = g => S.sum(g.cells.map(c => c.v));
          const grand = S.sum(rows.map(r => (yNum ? val(o.y, r) : 1) * (wOf ? wOf(r) : 1)));
          perGroup.forEach(pg => {
            if (stat === '% of Total') { const T = tot(pg); pg.cells.forEach(c => { c.v = 100 * c.v / T; }); }
            if (stat === '% of Grand Total') pg.cells.forEach(c => { c.v = 100 * c.v / grand; });
            if (stat === 'Cumulative Sum' || stat === 'Cumulative Percent') { let acc = 0; const T = tot(pg); pg.cells.forEach(c => { acc += c.v; c.v = stat === 'Cumulative Sum' ? acc : 100 * acc / T; }); }
          });
          if (stat === '% of Factor') {
            const byX = new Map(); perGroup.forEach(pg => pg.cells.forEach(c => byX.set(String(c.x), (byX.get(String(c.x)) || 0) + c.v)));
            perGroup.forEach(pg => pg.cells.forEach(c => { c.v = 100 * c.v / byX.get(String(c.x)); }));
          }
          // stacked bars/areas
          const stacked = (e.type === 'bar' && e.style === 'Stacked') || (e.type === 'area' && e.stacked);
          if (stacked) { const base = new Map(); perGroup.forEach(pg => pg.cells.forEach(c => { const k = String(c.x); c.base = base.get(k) || 0; base.set(k, c.base + c.v); })); }
          perGroup.forEach((pg, gi) => pg.cells.forEach(c => {
            ext(c.v + (c.base || 0), c.base || 0); if (c.iv) ext(...c.iv);
            if (e.type === 'bar' || e.type === 'area') ext(0);
            R._gbSummary.push({ panel: P, x: c.x, group: pg.g.l, stat: useCount ? (wOf ? 'Sum(Freq)' : 'N') : stat, value: c.v, n: c.rows.length, lo: c.iv ? c.iv[0] : NaN, hi: c.iv ? c.iv[1] : NaN });
          }));
          prims.push({ e, kind: 'summary', perGroup, stat: useCount ? 'N' : stat });
        } else prims.push({ e, kind: 'raw', groups });
        if (e.type === 'histogram' && hb) {
          countMode = true;
          const nb = e.bins > 0 ? e.bins : null;
          const H = nb ? Plot.bins(rows.map(r => val(o.x, r)), (S.max(rows.map(r => val(o.x, r))) - S.min(rows.map(r => val(o.x, r)))) / nb || 1) : hb;
          prims[prims.length - 1].H = H;
          groups.forEach(g => { const c = new Array(H.edges.length).fill(0); g.rows.forEach(r => { c[Math.floor((val(o.x, r) - H.edges[0]) / H.bw + 1e-9)] += wOf ? wOf(r) : 1; }); const tot = S.sum(c) || 1; ext(0, ...c.map(v => e.density ? v / tot : v)); });
        }
      });
    }
    // y scale
    let ys;
    if (yCat) ys = { levels: levelsOf(o.y) };
    else if (yNum || countMode || isFinite(ymin)) ys = isFinite(ymin) ? { min: ymin, max: ymax } : { min: 0, max: 1 };
    else ys = { min: 0, max: 1, pad: false };
    if (!ys.levels && isFinite(ymin) && ymin >= 0 && els.some(e => ['bar', 'area', 'histogram'].includes(e.type))) ys = { min: 0, max: ymax * 1.06 || 1, pad: false };
    const yNone = o.y === undefined && !countMode && !els.some(e => ['bar', 'area', 'histogram', 'line'].includes(e.type));
    if (yNone) ys = { min: 0, max: 1, pad: false };
    // lock scales
    if (o.lock) { if (o.lock.xs && !xs.levels && !o.lock.xs.levels) Object.assign(xs, o.lock.xs); if (o.lock.ys && !ys.levels && !o.lock.ys.levels) Object.assign(ys, o.lock.ys); }
    R._gbScales = { xs: xs.levels ? null : { min: xs.min, max: xs.max }, ys: ys.levels ? null : { min: ys.min, max: ys.max } };
    // sampling
    const sampleN = o.sampling || POINT_LIMIT;
    const keep = r => rows.length <= sampleN || t.rows[r].sel || hash01(r) * rows.length <= sampleN;
    if (rows.length > sampleN) notes.push(`showing a sample of ~${sampleN.toLocaleString()} of ${rows.length.toLocaleString()} points`);
    // draw panels
    const bw0 = (R.body.clientWidth || 1000) - (o.done ? 240 : 520) - (R.ldf ? 250 : 0);
    const W = o.w || Math.max(380, Math.min(1100, bw0)), Hh = o.h || Math.max(320, Math.min(720, (R.body.clientHeight || 600) - 190)), gap = o.spacing || 0;
    const ncol = panels.ncol, nrow = panels.nrow;
    const pw = Math.max(140, Math.floor((W - 60) / ncol)), ph = Math.max(110, Math.floor((Hh - 50) / nrow));
    const show = { grid: true, xtitle: true, ytitle: true, ...(o.show || {}) };
    let cells = '';
    plan.forEach(({ p: P, prims }) => {
      const first = P.col === 0, last = P.row === nrow - 1 || (o.wrap !== undefined && P.row * ncol + P.col + ncol >= panels.length);
      const rot = xCat && xs.levels.length > 6;
      const p = Plot.frame({ w: pw + (first ? 60 : 0) + (P.col === ncol - 1 ? 14 : 0), h: ph + (last ? (rot ? 64 : 42) : 0), x: xs, y: ys, ml: first ? 60 : 6, mb: last ? (rot ? 64 : 42) : 6, mt: 6, mr: P.col === ncol - 1 ? 18 : 6,
        noXAxis: !last, noYAxis: !first || yNone, grid: show.grid, xLabel: last && show.xtitle && o.x !== undefined ? t.columns[o.x].name : '', yLabel: first && show.ytitle ? (yNum || yCat ? t.columns[o.y].name : countMode ? (els.some(e => e.stat && e.stat.startsWith('%')) ? 'Percent' : 'Count') : '') : '' });
      const PX = (u, off = 0) => p.xlev ? p.L + p.xb * (xs.levels.indexOf(String(u)) + 0.5 + off) : p.X(u);
      const PY = u => p.ylev ? p.Y(u) : p.Y(u);
      const bandW = p.xlev ? p.xb : (p.R - p.L) / 20;
      for (const pr of prims) this.drawElement(ctx, p, pr, { PX, PY, xCat, yCat, yNum, yNone, xs, ys, ovColor, colorOf, sizeOf, wOf, ng, keep, bandW, val, catKey, o, alpha, panelRows: P.rows });
      const head = (P.label !== undefined ? P.label : P.gx) ;
      const hdr = head !== null && head !== undefined && (P.row === 0 || o.wrap !== undefined) ? `<div class="gb-fh" style="margin-left:${first ? 60 : 6}px">${esc(String(head))}</div>` : '';
      cells += `<div class="gb-cell" style="grid-column:${P.col + 1};grid-row:${P.row + 1}">${hdr}${p.svg()}</div>`;
    });
    if (o.wrap === undefined && gyL[0] !== null) gyL.forEach((gy, ri) => { cells += `<div class="gb-fv" style="grid-column:${ncol + 1};grid-row:${ri + 1}">${esc(String(gy))}</div>`; });
    const html = `<div class="gb-grid" style="gap:${gap}px;grid-template-columns:repeat(${ncol}, auto)${o.wrap === undefined && gyL[0] !== null ? ' 24px' : ''}">${cells}</div>`;
    return { html, legend: legendHtml, n: rows.length, notes };
  },
  legendCat(title, levels, colorFn, zone) {
    return `<div class="gb-leg"><div class="b small">${esc(title)}</div>${levels.map((l, i) => `<div class="lgi gb-lgi" data-action="gbleg" data-zone="${zone}" data-l="${esc(l)}" title="Click to select these rows"><i style="background:${colorFn(l)}"></i>${esc(l)}</div>`).join('')}</div>`;
  },
  drawElement(ctx, p, pr, E) {
    const t = ctx.t, e = pr.e, o = E.o, val = E.val;
    const gColor = (l, def) => E.ovColor(l) || def;
    const ng = E.ng;
    const dodge = gi => ng > 1 ? (gi - (ng - 1) / 2) * 0.8 / ng : 0;
    const jitterOf = (r, gi) => {
      if (e.jitter === 'None') return 0;
      const lim = (e.jlim ?? 0.5) * (ng > 1 ? 0.8 / ng : 0.9);
      if (e.jitter === 'Positive Grid') return (hash01(r) * lim) * 0.5;
      return (hash01(r) - 0.5) * lim;
    };
    const ptColor = (r, l) => E.colorOf(r) || E.ovColor(l) || undefined;
    const errBar = (x, lo, hi, color, band) => `<path class="fit" style="stroke:${color};stroke-width:1.2" d="M${x},${E.PY(lo)}V${E.PY(hi)}M${x - 4},${E.PY(lo)}h8M${x - 4},${E.PY(hi)}h8"/>`;
    const errOff = (o.errOffset || 0);
    if (pr.kind === 'summary') {
      const nb = pr.perGroup.length;
      pr.perGroup.forEach((pg, gi) => {
        const color = gColor(pg.g.l, e.type === 'bar' || e.type === 'area' ? '#7ea3d4' : '#2f6bc6');
        const off = E.xCat && e.type === 'bar' && e.style === 'Side by side' ? dodge(gi) : (E.xCat && e.type === 'points' ? dodge(gi) : 0);
        const pts = pg.cells.map(c => [E.PX(c.x, off), c.v, c]);
        if (e.type === 'bar') {
          pg.cells.forEach(c => {
            const bw = E.xCat ? (e.style === 'Side by side' ? p.xb * 0.8 / nb : p.xb * 0.8) : Math.max(2, E.bandW * 0.6);
            const cx = E.PX(c.x, off);
            const y0 = (c.base || 0), y1 = (c.base || 0) + c.v;
            p.add(Plot.bar(t, cx - bw / 2, E.PY(y0), cx + bw / 2, E.PY(y1), c.rows, { fill: color }));
            if (c.iv) p.add(errBar(cx + errOff * bw, c.iv[0], c.iv[1], '#333'));
            if (e.label) { const inside = E.PY(y0) - E.PY(y1) > 18; p.add(`<text class="tl" x="${cx}" y="${inside ? E.PY(y1) + 13 : E.PY(y1) - 4}" text-anchor="middle" ${inside ? 'fill="#fff" font-weight="600"' : ''}>${fmt(c.v, 4)}</text>`); }
          });
        } else if (e.type === 'area') {
          const base = pg.cells.map(c => [E.PX(c.x), c.base || 0]);
          if (pts.length) p.add(`<path d="M${pts.map(q => q[0] + ',' + E.PY(q[1] + (q[2].base || 0))).join('L')}L${[...base].reverse().map(q => q[0] + ',' + E.PY(q[1])).join('L')}Z" fill="${color}" opacity=".45"/>`);
          p.add(Plot.line(pts.map(q => [q[0], E.PY(q[1] + (q[2].base || 0))]), 'fit', `stroke:${color};stroke-width:1.2`));
        } else if (e.type === 'line') {
          let seq = pts.map(q => [q[0], E.PY(q[1])]);
          if (e.conn === 'Step') { const s = []; seq.forEach((q, i) => { if (i) s.push([q[0], seq[i - 1][1]]); s.push(q); }); seq = s; }
          if (e.conn === 'Centered Step') { const s = []; seq.forEach((q, i) => { const xl = i ? (seq[i - 1][0] + q[0]) / 2 : q[0], xr = i < seq.length - 1 ? (q[0] + seq[i + 1][0]) / 2 : q[0]; s.push([xl, q[1]], [xr, q[1]]); }); seq = s; }
          if (e.err !== 'None' && e.style === 'Band') { const up = pts.filter(q => q[2].iv); if (up.length) p.add(`<path d="M${up.map(q => q[0] + ',' + E.PY(q[2].iv[1])).join('L')}L${[...up].reverse().map(q => q[0] + ',' + E.PY(q[2].iv[0])).join('L')}Z" fill="${color}" opacity=".18"/>`); }
          p.add(Plot.line(seq, 'fit', `stroke:${color}`));
          pts.forEach(q => { p.add(`<circle cx="${q[0]}" cy="${E.PY(q[1])}" r="2.5" fill="${color}" data-rows="${q[2].rows.length < 5000 ? q[2].rows.join(',') : ''}"/>`); if (q[2].iv && e.style !== 'Band') p.add(errBar(q[0] + errOff * 20, q[2].iv[0], q[2].iv[1], color)); });
        } else { // points with summary statistic
          if (e.err !== 'None' && e.style === 'Band' && pts.length > 1) { const up = pts.filter(q => q[2].iv); p.add(`<path d="M${up.map(q => q[0] + ',' + E.PY(q[2].iv[1])).join('L')}L${[...up].reverse().map(q => q[0] + ',' + E.PY(q[2].iv[0])).join('L')}Z" fill="${color}" opacity=".18"/>`); }
          pts.forEach(q => {
            const sel = q[2].rows.some(r => t.rows[r].sel);
            p.add(`<circle class="pt${sel ? ' sel' : ''}" cx="${q[0]}" cy="${E.PY(q[1])}" r="${sel ? 5 : 4}" fill="${color}" data-rows="${q[2].rows.length < 5000 ? q[2].rows.join(',') : ''}"><title>${esc(pr.stat)} = ${fmt(q[1])} (n=${q[2].rows.length})</title></circle>`);
            if (q[2].iv && e.style !== 'Band') p.add(errBar(q[0] + errOff * 20, q[2].iv[0], q[2].iv[1], color));
          });
        }
      });
      return;
    }
    // raw-data elements
    pr.groups.forEach(({ l, rows: gr }, gi) => {
      const color = gColor(l, '#2f6bc6');
      const xNum = !E.xCat && o.x !== undefined, yNum = E.yNum;
      const XS = r => val(o.x, r), YS = r => val(o.y, r);
      switch (e.type) {
        case 'points': {
          for (const r of gr) {
            if (!E.keep(r)) continue;
            let x, y;
            if (o.x === undefined) x = p.L + p.xb * (0.5 + jitterOf(r, gi));
            else if (E.xCat) x = E.PX(E.catKey(o.x, r), dodge(gi) + jitterOf(r, gi));
            else x = p.X(XS(r));
            if (E.yNone) y = p.T + (p.B - p.T) * (0.15 + 0.7 * hash01(r + 3));
            else if (E.yCat) y = p.Y(E.catKey(o.y, r)) + (e.jitter === 'None' ? 0 : (hash01(r + 7) - 0.5) * p.yb * (e.jlim ?? 0.5));
            else y = p.Y(YS(r));
            const c = ptColor(r, l);
            const rad = E.sizeOf(r);
            p.add(Plot.pt(t, r, x, y, { color: c, r: rad || undefined }));
            if (o.interval !== undefined && yNum) { const h = +val(o.interval, r); if (isNum(h)) p.add(`<path class="fit" style="stroke:${c || '#555'};stroke-width:1" d="M${x},${p.Y(YS(r) - h)}V${p.Y(YS(r) + h)}"/>`); }
          }
          break;
        }
        case 'smoother': if (xNum && yNum && gr.length > 3) p.add(Plot.line(S.loess(gr.map(XS), gr.map(YS), e.span || 0.6, 60).map(([x, y]) => [p.X(x), p.Y(y)]), 'fit', `stroke:${E.ovColor(l) || '#2f6bc6'}`)); break;
        case 'linefit': {
          if (!(xNum && yNum) || gr.length < 3) break;
          const deg = { Linear: 1, Quadratic: 2, Cubic: 3 }[e.deg] || 1;
          const xsv = gr.map(XS), ysv = gr.map(YS), xm = S.mean(xsv);
          const des = x => { const d = [1]; for (let k = 1; k <= deg; k++) d.push((x - (k > 1 ? xm : 0)) ** k); return d; };
          const m = S.ols(xsv.map(des), ysv); if (!m) break;
          const x0 = S.min(xsv), x1 = S.max(xsv), tc = S.tInv(1 - E.alpha / 2, m.dfe);
          const pts = []; for (let i = 0; i <= 40; i++) { const x = x0 + (x1 - x0) * i / 40; const d = des(x); pts.push([x, S.dot(d, m.b), tc * Math.sqrt(m.mse * S.quad(m.inv, d))]); }
          const c = E.ovColor(l) || '#d9412b';
          if (e.conf) p.add(`<path d="M${pts.map(q => p.X(q[0]) + ',' + p.Y(q[1] + q[2])).join('L')}L${[...pts].reverse().map(q => p.X(q[0]) + ',' + p.Y(q[1] - q[2])).join('L')}Z" fill="${c}" opacity=".15"/>`);
          p.add(Plot.line(pts.map(q => [p.X(q[0]), p.Y(q[1])]), 'fit', `stroke:${c}`));
          const eqs = `y = ${fmt(m.b[0], 4)}${m.b.slice(1).map((b, k) => ` ${b < 0 ? '−' : '+'} ${fmt(Math.abs(b), 4)}·${k ? '(x−x̄)' : 'x'}${k ? '^' + (k + 1) : ''}`).join('')}`;
          const wide = p.R - p.L > 30 + eqs.length * 5.6;
          const txt = [];
          if (e.r2) txt.push(`R² ${fmtD(m.r2, 3)}`);
          if (e.eq && wide) txt.push(eqs);
          if (txt.length) p.over.push(`<text class="tl" x="${p.R - 6}" y="${p.T + 12 + gi * 12}" text-anchor="end" fill="${c}"><title>${esc(eqs)}</title>${esc(txt.join('   '))}</text>`);
          break;
        }
        case 'ellipse': {
          if (!(xNum && yNum) || gr.length < 3) break;
          const xsv = gr.map(XS), ysv = gr.map(YS), mx = S.mean(xsv), my = S.mean(ysv), sx = S.sd(xsv), sy = S.sd(ysv), rr = S.corr(xsv, ysv), c2 = Math.sqrt(S.chi2Inv(+e.cov || 0.95, 2));
          const pts = []; for (let i = 0; i <= 72; i++) { const th = 2 * Math.PI * i / 72, u = Math.cos(th) * c2, v = Math.sin(th) * c2; pts.push([p.X(mx + sx * u), p.Y(my + rr * sy * u + sy * Math.sqrt(Math.max(0, 1 - rr * rr)) * v)]); }
          const c = E.ovColor(l) || '#8e44ad';
          p.add(Plot.line(pts, 'fit', `stroke:${c};fill:${c}1f`));
          break;
        }
        case 'box': {
          if (!yNum) break;
          const lv = E.xCat ? E.xs.levels : [null];
          lv.forEach(xl => {
            const br = xl === null ? gr : gr.filter(r => E.catKey(o.x, r) === xl);
            if (br.length < 2) return;
            const center = xl === null ? (o.x === undefined ? p.L + p.xb / 2 : (p.L + p.R) / 2) : E.PX(xl, dodge(gi));
            const w = Math.min(60, (p.xb || 80) * (e.width ?? 0.5) / ng);
            p.add(Plot.boxPlot(p, t, br, br.map(YS), { vertical: true, center, width: w, color: E.ovColor(l) || '#333', meanDiamond: false, outliers: e.outliers !== false }));
            if (e.mean) { const m = S.mean(br.map(YS)); p.add(`<path d="M${center - 5},${p.Y(m)}h10M${center},${p.Y(m) - 5}v10" stroke="#d9412b" stroke-width="1.5"/>`); }
          });
          break;
        }
        case 'histogram': {
          const H = pr.H; if (!H || !xNum) break;
          const bins = H.edges.map(() => []); gr.forEach(r => bins[Math.floor((XS(r) - H.edges[0]) / H.bw + 1e-9)].push(r));
          const tot = (E.wOf ? S.sum(gr.map(E.wOf)) : gr.length) || 1;
          bins.forEach((b, k) => { if (!b.length || k >= H.edges.length - 1) return; const h = E.wOf ? S.sum(b.map(E.wOf)) : b.length; p.add(Plot.bar(t, p.X(H.edges[k]), p.Y(0), p.X(H.edges[k + 1]), p.Y(e.density ? h / tot : h), b, { fill: E.ovColor(l) || '#7ea3d4' })); });
          break;
        }
        case 'heatmap': {
          if (gi > 0 || !(E.xCat && E.yCat)) break;
          const cnt = new Map(); pr.groups.flatMap(g => g.rows).forEach(r => { const k = E.catKey(o.x, r) + '\u0001' + E.catKey(o.y, r); if (!cnt.has(k)) cnt.set(k, []); cnt.get(k).push(r); });
          const mx = S.max([...cnt.values()].map(v => v.length));
          p.xlev.forEach((xl, i) => p.ylev.forEach((yl, j) => { const rs = cnt.get(xl + '\u0001' + yl) || []; if (!rs.length) return; const a = rs.length / mx; p.add(`<rect class="bar" x="${p.L + p.xb * i}" y="${p.B - p.yb * (j + 1)}" width="${p.xb}" height="${p.yb}" fill="rgba(217,65,43,${0.12 + a * 0.85})" data-rows="${rs.length < 5000 ? rs.join(',') : ''}"/>${e.labels !== false ? `<text class="tl" x="${p.L + p.xb * (i + 0.5)}" y="${p.B - p.yb * (j + 0.5) + 4}" text-anchor="middle">${rs.length}</text>` : ''}`); }));
          break;
        }
        case 'pie': {
          if (gi > 0) break;
          const cat = E.xCat ? 'x' : o.ov !== undefined ? 'ov' : null; if (!cat) break;
          const all = pr.groups.flatMap(g => g.rows); const lv = cat === 'x' ? E.xs.levels : null;
          const m = new Map(); all.forEach(r => { const k = E.catKey(o[cat], r); m.set(k, (m.get(k) || 0) + (E.wOf ? E.wOf(r) : 1)); });
          const keys = lv || [...m.keys()]; const tot = S.sum([...m.values()]) || 1;
          const cx = (p.L + p.R) / 2, cy = (p.T + p.B) / 2, rad = Math.min(p.R - p.L, p.B - p.T) * 0.4;
          let a0 = -Math.PI / 2; const pal = GB_PALETTES[o.palette || 'Default'];
          keys.forEach((k, i) => { const v = m.get(k) || 0; if (!v) return; const a1 = a0 + 2 * Math.PI * v / tot; const large = a1 - a0 > Math.PI ? 1 : 0;
            p.over.push(`<path d="M${cx},${cy}L${cx + rad * Math.cos(a0)},${cy + rad * Math.sin(a0)}A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)},${cy + rad * Math.sin(a1)}Z" fill="${cat === 'ov' ? E.ovColor(k) : pal[i % pal.length]}" stroke="#fff"/>`);
            if (e.labels !== false) { const am = (a0 + a1) / 2; p.over.push(`<text class="tl" x="${cx + rad * 0.65 * Math.cos(am)}" y="${cy + rad * 0.65 * Math.sin(am)}" text-anchor="middle" fill="#fff">${esc(k)} ${fmtD(100 * v / tot, 1)}%</text>`); }
            a0 = a1; });
          break;
        }
        case 'caption': {
          if (gi > 0) break;
          const ci = e.col === 'x' ? o.x : o.y; if (ci === undefined) break;
          const v = E.panelRows.map(r => val(ci, r)).filter(isNum);
          const s = GBStat.compute(e.stat, v, null);
          const loc = e.loc || 'Top Right', right = /Right/.test(loc), top = /Top/.test(loc);
          const tx = `${e.stat} = ${fmt(s, 5)}`, wbox = tx.length * 6.2 + 10;
          const x = right ? p.R - wbox - 4 : p.L + 4, y = top ? p.T + 4 : p.B - 22;
          p.over.push(`<rect x="${x}" y="${y}" width="${wbox}" height="18" fill="#fff" stroke="#8f9aa8" rx="2"/><text class="tl" x="${x + 5}" y="${y + 13}">${esc(tx)}</text>`);
          break;
        }
      }
    });
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
    const plot = $('.gb-plot', b);
    if (plot) {
      plot.addEventListener('dragover', e => e.preventDefault());
      plot.addEventListener('drop', e => { e.preventDefault(); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('cols:')) this.assign(rep, rep.opts.x === undefined ? 'x' : 'y', +d.slice(5).split(',')[0]); });
    }
    $$('[data-gbp]', b).forEach(inp => inp.addEventListener('change', () => {
      const els = this.materialize(rep); const i = +inp.dataset.i, k = inp.dataset.gbp;
      let v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' || inp.type === 'number' ? Number(inp.value) : inp.value;
      if (k === 'cov') v = Number(v);
      els[i] = { ...els[i], [k]: v }; rep.render();
    }));
  },
  assign(rep, k, ci) {
    rep.opts[k] = ci;
    if (k === 'x' || k === 'y') rep.opts.els = []; // new X/Y: choose suitable elements again
    rep.render();
  },
  launchAnalysis(R) {
    const o = R.opts, t = R.t;
    if (o.x !== undefined && o.y !== undefined) new Report(t, 'fitxy', { y: [o.y], x: [o.x] });
    else new Report(t, 'distribution', { y: [o.x !== undefined ? o.x : o.y] });
  },
  makeTable(R) {
    const t = R.t, o = R.opts, s = R._gbSummary;
    const nt = new DataTable(`${t.name} Graph Builder Summary`); nt.addRows(s.length);
    const add = (name, key, vals) => { if (vals.every(v => v === undefined || v === null)) return; const num = vals.every(v => typeof v === 'number' || v === undefined || v === null); nt.addColumn({ name, dataType: num ? 'numeric' : 'character', values: vals.map(v => v === undefined || v === null ? (num ? NaN : '') : v) }); };
    if (o.wrap !== undefined) add(t.columns[o.wrap].name, 'w', s.map(x => x.panel.label));
    if (o.gx !== undefined) add(t.columns[o.gx].name, 'gx', s.map(x => x.panel.gx));
    if (o.gy !== undefined) add(t.columns[o.gy].name, 'gy', s.map(x => x.panel.gy));
    if (o.x !== undefined) add(t.columns[o.x].name, 'x', s.map(x => x.x));
    if (o.ov !== undefined) add(t.columns[o.ov].name, 'ov', s.map(x => x.group));
    add('Statistic', 's', s.map(x => x.stat));
    add(o.y !== undefined ? t.columns[o.y].name : 'Value', 'v', s.map(x => x.value));
    add('N', 'n', s.map(x => x.n));
    add('Lower', 'lo', s.map(x => isNum(x.lo) ? x.lo : null)); add('Upper', 'hi', s.map(x => isNum(x.hi) ? x.hi : null));
    App.openTable(nt);
  },
  toJSL(R) {
    const t = R.t, o = R.opts; const q = ci => `:${/^[A-Za-z_][\w.]*$/.test(t.columns[ci].name) ? t.columns[ci].name : `Name( "${t.columns[ci].name.replace(/"/g, '\\!"')}" )`}`;
    const map = { x: 'X', y: 'Y', gx: 'Group X', gy: 'Group Y', wrap: 'Wrap', ov: 'Overlay', color: 'Color', size: 'Size', interval: 'Interval', freq: 'Freq' };
    const vars = Object.keys(map).filter(k => o[k] !== undefined).map(k => `${map[k]}( ${q(o[k])} )`).join(', ');
    const nm = { points: 'Points', smoother: 'Smoother', linefit: 'Line Of Fit', ellipse: 'Ellipse', line: 'Line', bar: 'Bar', area: 'Area', box: 'Box Plot', histogram: 'Histogram', heatmap: 'Heatmap', pie: 'Pie', caption: 'Caption Box' };
    const els = this.elements(t, o).map(e => {
      const a = [o.x !== undefined ? 'X' : null, o.y !== undefined ? 'Y' : null].filter(Boolean);
      if (e.stat && e.stat !== 'None' && e.type !== 'caption') a.push(`Summary Statistic( "${e.stat}" )`);
      if (e.err && e.err !== 'None') a.push(`Error Interval( "${e.err}" )`);
      if (e.type === 'linefit' && e.deg !== 'Linear') a.push(`Degree( "${e.deg}" )`);
      if (e.type === 'bar' && e.style !== 'Side by side') a.push(`Bar Style( "${e.style}" )`);
      return `${nm[e.type]}( ${a.join(', ')} )`;
    }).join(', ');
    let s = `Graph Builder(\n    Show Control Panel( ${o.done ? 0 : 1} ),\n    Variables( ${vars} ),\n    Elements( ${els} )`;
    if (R.ldf && R.ldf.conds.length) s += `,\n    Local Data Filter(\n${R.ldf.conds.map(c => `        Add Filter( columns( :${c.name} ), Where( ${c.type === 'range' ? `:${c.name} >= ${c.lo} & :${c.name} <= ${c.hi}` : c.sel.length ? c.sel.map(v => `:${c.name} == "${v}"`).join(' | ') : '1'} ) )`).join(',\n')}\n    )`;
    return s + '\n);';
  },
  actions: {
    gbel(rep, btn, ev) {
      const k = btn.dataset.el, P = Platforms.graphbuilder;
      const els = P.materialize(rep);
      if (ev && ev.shiftKey) rep.opts.els = [{ type: k, ...P.elDefaults(k, rep.opts, rep.t) }];
      else {
        const i = els.findIndex(e => e.type === k);
        if (i >= 0) els.splice(i, 1); else els.push({ type: k, ...P.elDefaults(k, rep.opts, rep.t) });
        if (!els.length) els.push({ type: 'points', ...P.elDefaults('points', rep.opts, rep.t) });
        rep.opts.openEls = [els.length - 1];
      }
      rep.render();
    },
    gbprm(rep, x, ev) { ev.stopPropagation(); const els = Platforms.graphbuilder.materialize(rep); els.splice(+x.dataset.i, 1); if (!els.length) rep.opts.els = []; rep.render(); },
    gbpopen(rep, x, ev) { if (ev.target.closest('.gbp-x')) return Platforms.graphbuilder.actions.gbprm(rep, ev.target.closest('.gbp-x'), ev); const i = +x.dataset.i; const s = new Set(rep.opts.openEls || [0]); s.has(i) ? s.delete(i) : s.add(i); rep.opts.openEls = [...s]; rep.render(); },
    gbclear(rep, x) { const z = x.dataset.zone; delete rep.opts[z]; if (z === 'x' || z === 'y') rep.opts.els = []; rep.render(); },
    gbreset(rep) { rep.opts = { els: [] }; rep.render(); },
    gbdone(rep) { rep.opts.done = true; rep.render(); },
    gbleg(rep, x, ev) {
      const t = rep.t, ci = rep.opts[x.dataset.zone], l = x.dataset.l;
      const rows = []; const v = t.columns[ci].values;
      for (let r = 0; r < t.nrows; r++) { const k = DataTable.isMissing(v[r]) ? '(missing)' : String(v[r]); if (k === l) rows.push(r); }
      t.select(rows, ev.shiftKey ? 'extend' : ev.ctrlKey || ev.metaKey ? 'toggle' : 'replace');
    },
  },
};
