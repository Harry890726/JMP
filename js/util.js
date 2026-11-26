'use strict';
/* General helpers shared by every module. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const isNum = v => typeof v === 'number' && isFinite(v);

/** Number formatting similar to a "Best" format: up to 7 significant digits. */
function fmt(x, sig = 7) {
  if (x === null || x === undefined) return '•';
  if (typeof x !== 'number') return String(x);
  if (isNaN(x)) return '•';
  if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e10 || ax < 1e-6) return x.toExponential(sig - 3).replace(/\.?0+e/, 'e');
  let s = Number(x.toPrecision(sig)).toString();
  if (s.includes('e')) s = Number(x.toPrecision(sig)).toFixed(Math.min(12, sig + 4)).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Fixed decimals but trimmed */
function fmtD(x, d = 4) {
  if (!isNum(x)) return fmt(x);
  return x.toFixed(d);
}

/** p-value formatting: <.0001*, significant values flagged */
function fmtP(p) {
  if (p === null || p === undefined || isNaN(p)) return '•';
  const sig = p < 0.05;
  const s = p < 0.0001 ? '<.0001' : p.toFixed(4).replace(/^0\./, '.');
  return `<span class="${sig ? 'psig' : ''}">${s}${sig ? '*' : ''}</span>`;
}

/** Seeded random number generator (mulberry32) with normal() */
function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.normal = (m = 0, s = 1) => {
    let u = 0; while (!u) u = f();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f());
  };
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.poisson = lam => { let L = Math.exp(-lam), k = 0, p = 1; do { k++; p *= f(); } while (p > L); return k - 1; };
  return f;
}

const PALETTE = ['#2f6bc6', '#d9412b', '#2e9a3a', '#f39c12', '#8e44ad', '#16a2b8', '#d6487e', '#7a9a01', '#a0522d', '#34495e',
  '#5dade2', '#e74c3c', '#58d68d', '#f5b041', '#af7ac5'];

function download(name, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

let _uid = 0;
const uid = (p = 'u') => p + (++_uid);

/** Deterministic hash of an integer to [0,1) - used for jitter */
function hash01(i) {
  let x = (i + 1) * 2654435761 >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function status(msg) { const s = $('#status'); if (s) s.textContent = msg; }

const MT_LABEL = { continuous: 'Continuous', ordinal: 'Ordinal', nominal: 'Nominal' };

/** Modeling type icon (small inline svg) */
function typeIcon(mt) {
  if (mt === 'continuous') return '<svg class="mti" viewBox="0 0 12 12"><path d="M1 11 L11 11 L11 1 Z" fill="#2f6bc6"/></svg>';
  if (mt === 'ordinal') return '<svg class="mti" viewBox="0 0 12 12"><rect x="1" y="7" width="2.6" height="4" fill="#2e9a3a"/><rect x="4.7" y="4" width="2.6" height="7" fill="#2e9a3a"/><rect x="8.4" y="1" width="2.6" height="10" fill="#2e9a3a"/></svg>';
  return '<svg class="mti" viewBox="0 0 12 12"><rect x="1" y="2" width="2.6" height="9" fill="#d9412b"/><rect x="4.7" y="5" width="2.6" height="6" fill="#d9412b"/><rect x="8.4" y="3" width="2.6" height="8" fill="#d9412b"/></svg>';
}
