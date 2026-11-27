'use strict';
/* Statistics engine: descriptive stats, distributions, linear algebra, models. */

const S = (() => {
  const sum = a => { let s = 0; for (const v of a) s += v; return s; };
  const mean = a => a.length ? sum(a) / a.length : NaN;
  function variance(a) {
    const n = a.length; if (n < 2) return NaN;
    const m = mean(a); let s = 0; for (const v of a) s += (v - m) ** 2; return s / (n - 1);
  }
  const sd = a => Math.sqrt(variance(a));
  const sorted = a => [...a].sort((x, y) => x - y);
  const min = a => { let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
  const max = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };

  /** Quantile with the (n+1)p definition, interpolated. s must be sorted. */
  function quantile(s, p) {
    const n = s.length; if (!n) return NaN;
    const pos = p * (n + 1);
    if (pos <= 1) return s[0];
    if (pos >= n) return s[n - 1];
    const i = Math.floor(pos), f = pos - i;
    return s[i - 1] + f * (s[i] - s[i - 1]);
  }
  const median = a => quantile(sorted(a), 0.5);

  function skewness(a) {
    const n = a.length; if (n < 3) return NaN;
    const m = mean(a), s = sd(a); let t = 0;
    for (const v of a) t += ((v - m) / s) ** 3;
    return n / ((n - 1) * (n - 2)) * t;
  }
  function kurtosis(a) {
    const n = a.length; if (n < 4) return NaN;
    const m = mean(a), s = sd(a); let t = 0;
    for (const v of a) t += ((v - m) / s) ** 4;
    return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
  }

  // ---------- special functions ----------
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const FPMIN = 1e-300; const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= 500; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-15) break;
    }
    return h;
  }
  /** Regularized incomplete beta I_x(a,b) */
  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  /** Regularized lower incomplete gamma P(a,x) and upper Q(a,x) */
  function gammpq(a, x) {
    if (x <= 0) return [0, 1];
    const lg = -x + a * Math.log(x) - lgamma(a);
    if (x < a + 1) {
      let ap = a, s = 1 / a, del = s;
      for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-16) break; }
      const p = s * Math.exp(lg); return [p, 1 - p];
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    const q = Math.exp(lg) * h; return [1 - q, q];
  }
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }

  // ---------- distributions ----------
  const normPdf = (x, m = 0, s = 1) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  const normCdf = x => 0.5 * erfc(-x / Math.SQRT2);
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425; let q, r, x;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    // one Newton refinement step
    const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }
  function tCdf(t, df) {
    if (!isFinite(df)) return normCdf(t);
    const x = df / (df + t * t); const p = 0.5 * betai(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  }
  /** two-sided p-value for t */
  const tP2 = (t, df) => isFinite(t) ? betai(df / 2, 0.5, df / (df + t * t)) : 0;
  function bisect(f, target, lo, hi, it = 200) {
    for (let i = 0; i < it; i++) { const m = (lo + hi) / 2; if (f(m) < target) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  const tInv = (p, df) => bisect(t => tCdf(t, df), p, -1e4, 1e4);
  const fSurv = (f, d1, d2) => f <= 0 ? 1 : (isFinite(f) ? betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * f)) : 0);
  const chi2Surv = (x, k) => gammpq(k / 2, x / 2)[1];
  const chi2Cdf = (x, k) => gammpq(k / 2, x / 2)[0];
  const chi2Inv = (p, k) => bisect(x => chi2Cdf(x, k), p, 0, 1e5);

  // ---------- linear algebra ----------
  function matInv(A) {
    const n = A.length;
    const M = A.map((r, i) => { const row = new Float64Array(2 * n); for (let j = 0; j < n; j++) row[j] = r[j]; row[n + i] = 1; return row; });
    let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    const tol = (scale || 1) * 1e-11;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < tol) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const pv = M[c][c];
      for (let j = 0; j < 2 * n; j++) M[c][j] /= pv;
      for (let r = 0; r < n; r++) if (r !== c) {
        const f = M[r][c];
        if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map(r => Array.from(r.slice(n)));
  }
  const matVec = (A, v) => A.map(r => { let s = 0; for (let j = 0; j < v.length; j++) s += r[j] * v[j]; return s; });
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const quad = (inv, x) => dot(x, matVec(inv, x));

  /** Ordinary least squares. X: rows (array of arrays) including intercept column. */
  function ols(X, y) {
    const n = X.length, p = X[0].length;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      for (let a = 0; a < p; a++) {
        Xty[a] += xi[a] * y[i];
        for (let b = a; b < p; b++) XtX[a][b] += xi[a] * xi[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const inv = matInv(XtX);
    if (!inv) return null;
    const b = matVec(inv, Xty);
    const pred = X.map(r => dot(r, b));
    const resid = y.map((v, i) => v - pred[i]);
    const sse = sum(resid.map(r => r * r));
    const ybar = mean(y);
    const sst = sum(y.map(v => (v - ybar) ** 2));
    const dfm = p - 1, dfe = n - p;
    const mse = dfe > 0 ? sse / dfe : NaN;
    const se = inv.map((r, i) => Math.sqrt(r[i] * mse));
    const t = b.map((v, i) => v / se[i]);
    const pv = t.map(tt => dfe > 0 ? tP2(tt, dfe) : NaN);
    const r2 = sst > 0 ? 1 - sse / sst : NaN;
    const adj = dfe > 0 ? 1 - (1 - r2) * (n - 1) / dfe : NaN;
    const F = dfm > 0 ? ((sst - sse) / dfm) / mse : NaN;
    const pF = dfm > 0 && dfe > 0 ? fSurv(F, dfm, dfe) : NaN;
    return { b, se, t, p: pv, pred, resid, sse, sst, ssm: sst - sse, dfm, dfe, mse, rmse: Math.sqrt(mse), r2, adj, F, pF, n, ybar, inv };
  }

  /** Jacobi eigen decomposition for symmetric matrices. Returns values desc and vectors (columns) */
  function eigSym(A) {
    const n = A.length; const a = A.map(r => [...r]);
    const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    const idx = [...Array(n).keys()].sort((i, j) => a[j][j] - a[i][i]);
    const values = idx.map(i => a[i][i]);
    const vectors = idx.map(i => {
      const col = v.map(r => r[i]);
      // sign convention: largest absolute component positive
      let big = 0; for (let k = 1; k < n; k++) if (Math.abs(col[k]) > Math.abs(col[big])) big = k;
      return col[big] < 0 ? col.map(x => -x) : col;
    });
    return { values, vectors }; // vectors[i] is eigenvector i
  }

  function covMatrix(cols) {
    const k = cols.length, n = cols[0].length, m = cols.map(mean);
    const C = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < k; i++) for (let j = i; j < k; j++) {
      let s = 0; for (let r = 0; r < n; r++) s += (cols[i][r] - m[i]) * (cols[j][r] - m[j]);
      C[i][j] = C[j][i] = s / (n - 1);
    }
    return C;
  }
  function corrMatrix(cols) {
    const C = covMatrix(cols);
    return C.map((r, i) => r.map((v, j) => v / Math.sqrt(C[i][i] * C[j][j])));
  }
  function corr(x, y) {
    const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxy / Math.sqrt(sxx * syy);
  }
  function corrP(r, n) {
    if (n < 3 || Math.abs(r) >= 1) return Math.abs(r) >= 1 ? 0 : NaN;
    const t = r * Math.sqrt((n - 2) / (1 - r * r)); return tP2(t, n - 2);
  }

  /** Average ranks with tie info */
  function ranks(a) {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array(a.length); const ties = [];
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const rr = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = rr;
      if (j > i) ties.push(j - i + 1);
      i = j + 1;
    }
    r.ties = ties; return r;
  }

  /** Shapiro-Wilk W test (Royston 1995 approximation) */
  function shapiroWilk(x) {
    const n = x.length; if (n < 3 || n > 5000) return null;
    const s = sorted(x); const m = mean(s);
    const ss = sum(s.map(v => (v - m) ** 2)); if (ss === 0) return null;
    const mi = []; for (let i = 1; i <= n; i++) mi.push(normInv((i - 0.375) / (n + 0.25)));
    const mm = sum(mi.map(v => v * v)); const u = 1 / Math.sqrt(n);
    const a = new Array(n);
    if (n === 3) { a[0] = -Math.SQRT1_2; a[2] = Math.SQRT1_2; a[1] = 0; }
    else {
      const an = mi[n - 1] / Math.sqrt(mm) + 0.221157 * u - 0.147981 * u ** 2 - 2.071190 * u ** 3 + 4.434685 * u ** 4 - 2.706056 * u ** 5;
      if (n > 5) {
        const an1 = mi[n - 2] / Math.sqrt(mm) + 0.042981 * u - 0.293762 * u ** 2 - 1.752461 * u ** 3 + 5.682633 * u ** 4 - 3.582633 * u ** 5;
        const phi = (mm - 2 * mi[n - 1] ** 2 - 2 * mi[n - 2] ** 2) / (1 - 2 * an ** 2 - 2 * an1 ** 2);
        for (let i = 0; i < n; i++) a[i] = mi[i] / Math.sqrt(phi);
        a[n - 1] = an; a[0] = -an; a[n - 2] = an1; a[1] = -an1;
      } else {
        const phi = (mm - 2 * mi[n - 1] ** 2) / (1 - 2 * an ** 2);
        for (let i = 0; i < n; i++) a[i] = mi[i] / Math.sqrt(phi);
        a[n - 1] = an; a[0] = -an;
      }
    }
    let num = 0; for (let i = 0; i < n; i++) num += a[i] * s[i];
    let W = Math.min(1, num * num / ss);
    let p;
    if (n === 3) p = Math.max(0, Math.min(1, 6 / Math.PI * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)))));
    else if (n <= 11) {
      const g = 0.459 * n - 2.273;
      const mu = 0.5440 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
      const sg = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
      const z = (-Math.log(g - Math.log(1 - W)) - mu) / sg;
      p = 1 - normCdf(z);
    } else {
      const l = Math.log(n);
      const mu = -1.5861 - 0.31082 * l - 0.083751 * l ** 2 + 0.0038915 * l ** 3;
      const sg = Math.exp(-0.4803 - 0.082676 * l + 0.0030302 * l ** 2);
      const z = (Math.log(1 - W) - mu) / sg;
      p = 1 - normCdf(z);
    }
    return { W, p };
  }

  /** Binary logistic regression via Newton-Raphson. y in {0,1}, models P(y=1). */
  function logistic(X, y) {
    const n = X.length, p = X[0].length;
    let b = new Array(p).fill(0);
    let ll = -Infinity, H = null, converged = false;
    for (let it = 0; it < 60; it++) {
      const g = new Array(p).fill(0);
      const Hm = Array.from({ length: p }, () => new Array(p).fill(0));
      let nll = 0;
      for (let i = 0; i < n; i++) {
        const eta = dot(X[i], b);
        let mu = 1 / (1 + Math.exp(-eta));
        mu = Math.min(1 - 1e-12, Math.max(1e-12, mu));
        nll += y[i] ? Math.log(mu) : Math.log(1 - mu);
        const w = mu * (1 - mu);
        for (let a = 0; a < p; a++) {
          g[a] += X[i][a] * (y[i] - mu);
          for (let c = a; c < p; c++) Hm[a][c] += w * X[i][a] * X[i][c];
        }
      }
      for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) Hm[a][c] = Hm[c][a];
      H = Hm;
      const inv = matInv(Hm); if (!inv) break;
      const delta = matVec(inv, g);
      b = b.map((v, i) => v + delta[i]);
      if (Math.abs(nll - ll) < 1e-10) { ll = nll; converged = true; break; }
      ll = nll;
    }
    // final loglik
    let fll = 0;
    for (let i = 0; i < n; i++) { const mu = Math.min(1 - 1e-12, Math.max(1e-12, 1 / (1 + Math.exp(-dot(X[i], b))))); fll += y[i] ? Math.log(mu) : Math.log(1 - mu); }
    const inv = H ? matInv(H) : null;
    const se = inv ? inv.map((r, i) => Math.sqrt(r[i])) : b.map(() => NaN);
    return { b, se, ll: fll, inv, converged };
  }

  /** Fisher's exact test for 2x2 table [[a,b],[c,d]] */
  function fisher2x2(a, b, c, d) {
    const n = a + b + c + d, r1 = a + b, c1 = a + c;
    const lf = k => lgamma(k + 1);
    const base = lf(r1) + lf(n - r1) + lf(c1) + lf(n - c1) - lf(n);
    const pr = x => Math.exp(base - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(n - r1 - c1 + x));
    const lo = Math.max(0, r1 + c1 - n), hi = Math.min(r1, c1);
    const p0 = pr(a); let left = 0, right = 0, two = 0;
    for (let x = lo; x <= hi; x++) {
      const px = pr(x);
      if (x <= a) left += px; if (x >= a) right += px;
      if (px <= p0 * (1 + 1e-7)) two += px;
    }
    return { left: Math.min(1, left), right: Math.min(1, right), two: Math.min(1, two) };
  }

  /** k-means with k-means++ initialisation */
  function kmeans(data, k, seed = 7) {
    const n = data.length, d = data[0].length, R = rng(seed);
    const dist2 = (a, b) => { let s = 0; for (let j = 0; j < d; j++) s += (a[j] - b[j]) ** 2; return s; };
    const centers = [data[Math.floor(R() * n)].slice()];
    while (centers.length < k) {
      const ds = data.map(p => Math.min(...centers.map(c => dist2(p, c))));
      const tot = sum(ds); let r = R() * tot, i = 0;
      while (i < n - 1 && r > ds[i]) { r -= ds[i]; i++; }
      centers.push(data[i].slice());
    }
    let assign = new Array(n).fill(-1);
    for (let it = 0; it < 200; it++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const dd = dist2(data[i], centers[c]); if (dd < bd) { bd = dd; best = c; } }
        if (assign[i] !== best) { assign[i] = best; changed = true; }
      }
      for (let c = 0; c < k; c++) {
        const mem = data.filter((_, i) => assign[i] === c);
        if (mem.length) for (let j = 0; j < d; j++) centers[c][j] = mean(mem.map(p => p[j]));
      }
      if (!changed) break;
    }
    // order clusters by size descending for stable labels
    const sizes = centers.map((_, c) => assign.filter(a => a === c).length);
    const order = [...Array(k).keys()].sort((a, b) => sizes[b] - sizes[a]);
    const remap = new Array(k); order.forEach((c, i) => remap[c] = i);
    assign = assign.map(a => remap[a]);
    const cs = order.map(c => centers[c]);
    const within = cs.map((c, ci) => sum(data.filter((_, i) => assign[i] === ci).map(p => dist2(p, c))));
    return { assign, centers: cs, sizes: order.map(c => sizes[c]), within };
  }

  /** Local linear regression smoother (tricube kernel) evaluated on a grid */
  function loess(xs, ys, span = 0.6, grid = 60) {
    const n = xs.length; if (n < 4) return [];
    const lo = min(xs), hi = max(xs); const q = Math.max(3, Math.ceil(span * n));
    const out = [];
    for (let g = 0; g < grid; g++) {
      const x0 = lo + (hi - lo) * g / (grid - 1);
      const dists = xs.map(x => Math.abs(x - x0));
      const h = sorted(dists)[q - 1] * 1.0001 || 1e-9;
      let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
      for (let i = 0; i < n; i++) {
        const u = dists[i] / h; if (u >= 1) continue;
        const w = (1 - u ** 3) ** 3;
        sw += w; swx += w * xs[i]; swy += w * ys[i]; swxx += w * xs[i] ** 2; swxy += w * xs[i] * ys[i];
      }
      const den = sw * swxx - swx * swx;
      const y0 = Math.abs(den) < 1e-12 ? swy / sw : ((swy * swxx - swx * swxy) + x0 * (sw * swxy - swx * swy)) / den;
      out.push([x0, y0]);
    }
    return out;
  }

  /** One-way ANOVA. groups: array of arrays */
  function anova1(groups) {
    const all = groups.flat(); const N = all.length, k = groups.length, gm = mean(all);
    let ssb = 0, ssw = 0;
    for (const g of groups) { const m = mean(g); ssb += g.length * (m - gm) ** 2; for (const v of g) ssw += (v - m) ** 2; }
    const dfb = k - 1, dfw = N - k;
    const msb = ssb / dfb, msw = ssw / dfw, F = msb / msw;
    return { ssb, ssw, sst: ssb + ssw, dfb, dfw, msb, msw, F, p: fSurv(F, dfb, dfw), N, k, gm, r2: ssb / (ssb + ssw) };
  }

  return {
    sum, mean, variance, sd, sorted, min, max, quantile, median, skewness, kurtosis,
    lgamma, betai, gammpq, normPdf, normCdf, normInv, tCdf, tP2, tInv, fSurv, chi2Surv, chi2Cdf, chi2Inv,
    matInv, matVec, dot, quad, ols, eigSym, covMatrix, corrMatrix, corr, corrP, ranks, shapiroWilk, logistic,
    fisher2x2, kmeans, loess, anova1,
  };
})();
