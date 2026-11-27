'use strict';
/* JSL (scripting language) interpreter: a practical subset covering data-table messages
   (Stack, Sort, Subset, Summary, Split, Transpose, Join, Concatenate, New Column, Select Where …),
   control flow, functions, and launching analysis platforms with their options. */

const JSL = (() => {
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');
  const colKey = s => String(s).toLowerCase().replace(/\s+/g, '');

  // ======================= tokenizer =======================
  function tokenize(src) {
    const toks = []; let i = 0, line = 1; const n = src.length;
    const isNameStart = c => /[A-Za-z_\u0080-￿]/.test(c) && !/[“”　]/.test(c);
    const isNameChar = c => /[\w.'\u0080-￿]/.test(c) && !/[“”　]/.test(c);
    const OPS = ['<<', '::', '==', '!=', '<=', '>=', '||', '++', '--', '+=', '-=', '*=', '/=', '<', '>', '=', '+', '-', '*', '/', '^', '!', '&', '|', ':', ',', ';', '(', ')', '{', '}', '[', ']'];
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c) || c === '　') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; line += (src.slice(i, e).match(/\n/g) || []).length; i = e; continue; }
      if (c === '"' || c === '“') {
        if (src.startsWith('"\\[', i)) { const j = src.indexOf(']\\"', i + 3); const e = j < 0 ? n : j; toks.push({ t: 'str', v: src.slice(i + 3, e), line }); line += (src.slice(i, e).match(/\n/g) || []).length; i = e + 3; continue; }
        const close = c === '"' ? '"' : '”';
        let j = i + 1, s = '';
        while (j < n && src[j] !== close && !(close === '”' && src[j] === '"')) {
          if (src[j] === '\\' && src[j + 1] === '!') { const e = src[j + 2]; s += ({ '"': '"', n: '\n', N: '\n', t: '\t', r: '\r', '\\': '\\', 0: '', b: ' ' })[e] ?? e; j += 3; }
          else { if (src[j] === '\n') line++; s += src[j++]; }
        }
        if (j >= n) throw new Error(`Unterminated string starting at line ${line}`);
        toks.push({ t: 'str', v: s, line }); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i, i + 40));
        toks.push({ t: 'num', v: Number(m[0]), line }); i += m[0].length; continue;
      }
      if (isNameStart(c)) {
        let j = i, name = '';
        for (;;) {
          let k = j; while (k < n && isNameChar(src[k])) k++;
          name += (name ? ' ' : '') + src.slice(j, k); j = k;
          let k2 = j; while (k2 < n && (src[k2] === ' ' || src[k2] === '\t')) k2++;
          if (k2 > j && k2 < n && isNameStart(src[k2])) { j = k2; continue; }
          break;
        }
        toks.push({ t: 'name', v: name, line }); i = j; continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (!op) throw new Error(`Unexpected character "${c}" at line ${line}`);
      toks.push({ t: 'op', v: op, line }); i += op.length;
    }
    toks.push({ t: 'eof', line });
    return toks;
  }

  // ======================= parser =======================
  class Parser {
    constructor(toks) { this.t = toks; this.i = 0; }
    peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
    is(v) { const k = this.peek(); return k.t === 'op' && k.v === v; }
    eat(v) { if (!this.is(v)) this.err(`Expected "${v}"`); return this.t[this.i++]; }
    err(m) { const k = this.peek(); throw new Error(`${m} at line ${k.line}${k.t !== 'eof' ? ` near "${k.v}"` : ' (end of script)'}`); }
    program() { const g = this.glue(); if (this.peek().t !== 'eof') this.err('Unexpected token'); return g; }
    glue() {
      const list = [];
      for (;;) {
        if (this.peek().t === 'eof' || this.is(')') || this.is(',') || this.is('}') || this.is(']')) break;
        if (this.is(';')) { this.i++; continue; }
        list.push(this.expr());
      }
      return list.length === 1 ? list[0] : { k: 'glue', list };
    }
    expr() {
      const left = this.or();
      const k = this.peek();
      if (k.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(k.v)) { this.i++; return { k: 'assign', op: k.v, target: left, value: this.expr(), line: k.line }; }
      return left;
    }
    binLoop(next, ops) { let a = next(); while (ops.some(o => this.is(o))) { const op = this.t[this.i++].v; a = { k: 'bin', op, a, b: next() }; } return a; }
    or() { return this.binLoop(() => this.and(), ['|']); }
    and() { return this.binLoop(() => this.cmp(), ['&']); }
    cmp() { return this.binLoop(() => this.cat(), ['==', '!=', '<=', '>=', '<', '>']); }
    cat() { return this.binLoop(() => this.add(), ['||']); }
    add() { return this.binLoop(() => this.mul(), ['+', '-']); }
    mul() { return this.binLoop(() => this.pow(), ['*', '/']); }
    pow() { const a = this.unary(); if (this.is('^')) { this.i++; return { k: 'bin', op: '^', a, b: this.pow() }; } return a; }
    unary() {
      if (this.is('-')) { this.i++; return { k: 'un', op: '-', a: this.unary() }; }
      if (this.is('!')) { this.i++; return { k: 'un', op: '!', a: this.unary() }; }
      if (this.is('+')) { this.i++; return this.unary(); }
      return this.send();
    }
    send() { let a = this.postfix(); while (this.is('<<')) { const line = this.t[this.i++].line; a = { k: 'send', obj: a, msg: this.postfix(), line }; } return a; }
    postfix() {
      let a = this.primary();
      for (;;) {
        if (this.is('[')) { this.i++; const idx = this.args(']'); a = { k: 'index', obj: a, idx }; }
        else if (this.is('++') || this.is('--')) { const op = this.t[this.i++].v; a = { k: 'assign', op: op === '++' ? '+=' : '-=', target: a, value: { k: 'num', v: 1 } }; }
        else if (this.is(':') && a.k === 'name' && (this.peek(1).t === 'name' || this.peek(1).t === 'str')) { this.i++; const nm = this.t[this.i++]; a = { k: 'col', name: nm.v, scope: a, line: nm.line }; }
        else break;
      }
      return a;
    }
    primary() {
      const k = this.t[this.i++];
      if (k.t === 'num') return { k: 'num', v: k.v };
      if (k.t === 'str') return { k: 'str', v: k.v };
      if (k.t === 'name') {
        if (this.is('(')) { this.i++; return { k: 'call', name: k.v, args: this.args(')'), line: k.line }; }
        return { k: 'name', name: k.v, line: k.line };
      }
      if (k.t === 'op') {
        if (k.v === '(') { const g = this.glue(); this.eat(')'); return g; }
        if (k.v === '{') return { k: 'list', items: this.args('}') };
        if (k.v === '[') {
          const items = [];
          while (!this.is(']')) { if (this.peek().t === 'eof') this.err('Missing "]"'); if (this.is(',') || this.is(';')) { this.i++; continue; } items.push(this.unary()); }
          this.i++; return { k: 'matrix', items };
        }
        if (k.v === ':') {
          const nm = this.t[this.i++];
          if (nm.t === 'name' && norm(nm.v) === 'name' && this.is('(')) { this.i++; const a = this.args(')'); return { k: 'col', nameExpr: a[0], line: nm.line }; }
          if (nm.t !== 'name' && nm.t !== 'str') { this.i--; this.err('Expected a column name after ":"'); }
          return { k: 'col', name: nm.v, line: nm.line };
        }
        if (k.v === '::') { const nm = this.t[this.i++]; return { k: 'name', name: nm.v, line: nm.line }; }
      }
      this.i--; this.err('Unexpected token');
    }
    args(close) {
      const a = [];
      while (!this.is(close)) {
        if (this.peek().t === 'eof') this.err(`Missing "${close}"`);
        if (this.is(',')) { this.i++; continue; }
        a.push(this.glue());
      }
      this.i++;
      return a;
    }
  }
  const parse = src => new Parser(tokenize(src)).program();

  // ======================= values =======================
  class ColRef { constructor(dt, name) { this.dt = dt; this.name = name; } get ci() { return this.dt.colIndex(this.name); } }
  const isMissing = v => v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  function resolveCol(dt, name) {
    let ci = dt.columns.findIndex(c => c.name === name);
    if (ci < 0) ci = dt.columns.findIndex(c => colKey(c.name) === colKey(name));
    return ci;
  }
  function repr(v) {
    if (v === undefined || v === null) return '.';
    if (typeof v === 'number') return isNaN(v) ? '.' : fmt(v, 10);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '{' + v.map(repr).join(', ') + '}';
    if (v instanceof DataTable) return `DataTable("${v.name}")`;
    if (v instanceof ColRef) return `Column("${v.name}")`;
    if (v instanceof Report) return `${v.platform.title(v.spec, v.t)}[]`;
    if (v && v.sym) return v.sym;
    return String(v);
  }
  /** Name of an option node, e.g. Fit Line, Means/Anova(1), Normal Quantile Plot(1) */
  function optName(n) {
    if (!n) return '';
    if (n.k === 'call' || n.k === 'name') return n.name;
    if (n.k === 'bin' && n.op === '/') return optName(n.a) + '/' + optName(n.b);
    if (n.k === 'str') return n.v;
    return '';
  }
  function optArgs(n) { if (n.k === 'call') return n.args; if (n.k === 'bin' && n.op === '/') return optArgs(n.b); return []; }
  /** recursively find call nodes by normalized name */
  function findCalls(n, key, out = []) {
    if (!n || typeof n !== 'object') return out;
    if (n.k === 'call' && norm(n.name) === key) out.push(n);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(x => findCalls(x, key, out));
      else if (v && typeof v === 'object' && v.k) findCalls(v, key, out);
    }
    return out;
  }

  // ======================= interpreter =======================
  class Interp {
    constructor(log) { this.vars = new Map(); this.log = log || (() => {}); this.row = -1; this.dt = null; this.reports = []; this.tables = []; }
    cur() {
      const t = App.active;
      if (!t) throw new Error('No data table is open. Open your data first (File ▸ Open a CSV, or File ▸ Sample Data), then run the script again.');
      return t;
    }
    run(src) { return this.ev(parse(src)); }
    // ---- helpers ----
    deref(v) {
      if (v instanceof ColRef) {
        if (this.row < 0) return v;
        const ci = v.ci; if (ci < 0) throw new Error(`Column "${v.name}" no longer exists`);
        const x = v.dt.columns[ci].values[this.row];
        return x === '' && v.dt.columns[ci].dataType === 'numeric' ? NaN : x;
      }
      return v;
    }
    num(v) { v = this.deref(v); if (v instanceof ColRef) return NaN; if (typeof v === 'number') return v; if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v); return NaN; }
    str(v) { v = this.deref(v); if (v instanceof ColRef) return v.name; if (typeof v === 'number') return isNaN(v) ? '' : fmt(v, 12); if (v && v.sym) return v.sym; if (Array.isArray(v)) return repr(v); return v === undefined || v === null ? '' : String(v); }
    truthy(v) { v = this.deref(v); if (typeof v === 'number') return !isNaN(v) && v !== 0; if (typeof v === 'string') return v !== ''; return !!v; }
    evArg(args, i) { return args[i] === undefined ? undefined : this.ev(args[i]); }
    table(v) {
      v = this.deref(v);
      if (v instanceof DataTable) return v;
      if (typeof v === 'string') { const t = App.tables.find(x => x.name === v) || App.tables.find(x => colKey(x.name) === colKey(v)); if (!t) throw new Error(`Data table "${v}" is not open`); return t; }
      throw new Error('Expected a data table');
    }
    // ---- eval ----
    ev(n) {
      switch (n.k) {
        case 'num': case 'str': return n.v;
        case 'glue': { let v; for (const x of n.list) v = this.ev(x); return v; }
        case 'list': return n.items.map(x => this.ev(x));
        case 'matrix': return n.items.map(x => this.num(this.ev(x)));
        case 'name': {
          const key = norm(n.name);
          if (this.vars.has(key)) return this.vars.get(key);
          if (BUILTINS[key]) return BUILTINS[key].call(this, [], n);
          if (PLATFORMS[key]) return this.platform(key, [], null);
          return { sym: n.name };
        }
        case 'col': {
          const name = n.nameExpr ? this.str(this.ev(n.nameExpr)) : n.name;
          const dt = n.scope ? this.table(this.ev(n.scope)) : (this.dt || this.cur());
          const ci = resolveCol(dt, name);
          if (ci < 0) throw new Error(`Column "${name}" not found in data table "${dt.name}"${n.line ? ` (line ${n.line})` : ''}`);
          return new ColRef(dt, dt.columns[ci].name);
        }
        case 'call': {
          const key = norm(n.name);
          if (BUILTINS[key]) return BUILTINS[key].call(this, n.args, n);
          if (PLATFORMS[key]) return this.platform(key, n.args, null);
          throw new Error(`Unknown function "${n.name}" (line ${n.line})`);
        }
        case 'assign': return this.assign(n);
        case 'send': {
          const obj = this.deref(this.ev(n.obj));
          try { return Array.isArray(obj) ? obj.map(o => this.send(o, n.msg)) : this.send(obj, n.msg); }
          catch (e) { if (n.line && !/line \d+/.test(e.message)) e.message += ` (line ${n.line})`; throw e; }
        }
        case 'index': {
          const o = this.ev(n.obj); const idx = n.idx.map(x => this.ev(x));
          if (o instanceof ColRef) { const r = this.num(idx[0]) - 1; const x = o.dt.columns[o.ci].values[r]; return x === undefined ? NaN : x; }
          if (o instanceof DataTable) { const r = this.num(idx[0]) - 1; const c = idx[1] instanceof ColRef ? idx[1].ci : typeof idx[1] === 'string' ? resolveCol(o, idx[1]) : this.num(idx[1]) - 1; return o.columns[c].values[r]; }
          const d = this.deref(o);
          if (Array.isArray(d) || typeof d === 'string') { const i = idx[0]; if (Array.isArray(i)) return i.map(j => d[this.num(j) - 1]); return d[this.num(i) - 1]; }
          throw new Error('Cannot subscript this value');
        }
        case 'un': { const v = this.ev(n.a); if (n.op === '-') { const d = this.deref(v); return Array.isArray(d) ? d.map(x => -this.num(x)) : -this.num(v); } return this.truthy(v) ? 0 : 1; }
        case 'bin': return this.bin(n);
      }
      throw new Error('Cannot evaluate expression');
    }
    bin(n) {
      if (n.op === '&') return this.truthy(this.ev(n.a)) && this.truthy(this.ev(n.b)) ? 1 : 0;
      if (n.op === '|') return this.truthy(this.ev(n.a)) || this.truthy(this.ev(n.b)) ? 1 : 0;
      const a = this.deref(this.ev(n.a)), b = this.deref(this.ev(n.b));
      if (n.op === '||') { if (Array.isArray(a) || Array.isArray(b)) return [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])]; return this.str(a) + this.str(b); }
      const f = (x, y) => {
        switch (n.op) {
          case '+': return this.num(x) + this.num(y);
          case '-': return this.num(x) - this.num(y);
          case '*': return this.num(x) * this.num(y);
          case '/': return this.num(x) / this.num(y);
          case '^': return Math.pow(this.num(x), this.num(y));
        }
        const xs = typeof x === 'string' || typeof y === 'string';
        const X = xs ? this.str(x) : this.num(x), Y = xs ? this.str(y) : this.num(y);
        if (!xs && (isNaN(X) || isNaN(Y)) && n.op !== '==' && n.op !== '!=') return NaN;
        switch (n.op) {
          case '==': return X === Y ? 1 : 0; case '!=': return X !== Y ? 1 : 0;
          case '<': return X < Y ? 1 : 0; case '>': return X > Y ? 1 : 0; case '<=': return X <= Y ? 1 : 0; case '>=': return X >= Y ? 1 : 0;
        }
      };
      if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => f(x, b[i]));
      if (Array.isArray(a)) return a.map(x => f(x, b));
      if (Array.isArray(b)) return b.map(y => f(a, y));
      return f(a, b);
    }
    assign(n) {
      let v = this.ev(n.value);
      const t = n.target;
      const combine = old => {
        if (n.op === '=') return v;
        const o = this.deref(old), x = this.deref(v);
        if (n.op === '+=') return typeof o === 'string' ? o + this.str(x) : this.num(o) + this.num(x);
        if (n.op === '-=') return this.num(o) - this.num(x); if (n.op === '*=') return this.num(o) * this.num(x); return this.num(o) / this.num(x);
      };
      if (t.k === 'name') { const key = norm(t.name); v = combine(this.vars.get(key)); this.vars.set(key, v); return v; }
      if (t.k === 'col' || (t.k === 'index')) {
        let ref, r;
        if (t.k === 'col') { ref = this.ev(t); r = this.row; if (r < 0) throw new Error('Assigning to a column needs a row, e.g. :col[3] = value, or use For Each Row'); }
        else {
          const o = this.ev(t.obj);
          if (!(o instanceof ColRef)) {
            if (t.obj.k === 'name') { const key = norm(t.obj.name); const arr = this.vars.get(key); if (!Array.isArray(arr)) throw new Error('Subscript assignment needs a list or column'); const i = this.num(this.ev(t.idx[0])) - 1; arr[i] = combine(arr[i]); return arr[i]; }
            throw new Error('Cannot assign to this subscript');
          }
          ref = o; r = this.num(this.ev(t.idx[0])) - 1;
        }
        const ci = ref.ci; const val = combine(ref.dt.columns[ci].values[r]);
        ref.dt.setCell(r, ci, this.deref(val));
        ref.dt._jslDirty = true;
        return val;
      }
      throw new Error('Invalid assignment target');
    }
    // ---- platform & message helpers ----
    isColNode(a) { return !(a.k === 'call' && !['column', 'ascolumn', 'name', 'datatable'].includes(norm(a.name))); }
    toCols(dt, node) {
      const saved = this.dt; this.dt = dt;
      try {
        const v = this.ev(node); const arr = Array.isArray(v) ? v.flat(Infinity) : [v];
        return arr.map(x => {
          if (x instanceof ColRef) { const ci = resolveCol(dt, x.name); if (ci < 0) throw new Error(`Column "${x.name}" not found in "${dt.name}"`); return ci; }
          if (typeof x === 'string') { const ci = resolveCol(dt, x); if (ci < 0) throw new Error(`Column "${x}" not found in "${dt.name}"`); return ci; }
          if (typeof x === 'number' && Number.isInteger(x)) return x - 1;
          if (x && x.sym) { const ci = resolveCol(dt, x.sym); if (ci >= 0) return ci; }
          throw new Error('Expected a column reference');
        });
      } finally { this.dt = saved; }
    }
    roleCols(dt, args, keys) {
      const out = [];
      for (const a of args) if (a.k === 'call' && keys.includes(norm(a.name))) for (const x of a.args) if (this.isColNode(x)) out.push(...this.toCols(dt, x));
      return out;
    }
    argOf(args, keys) { return args.find(a => (a.k === 'call' || a.k === 'name') && keys.includes(norm(a.name))); }
    strArg(args, keys, def) { const a = this.argOf(args, keys); if (!a || a.k !== 'call' || !a.args.length) return def; return this.str(this.ev(a.args[0])); }
    onArg(args, keys) { const a = this.argOf(args, keys); if (!a) return false; return this.optOn(a); }
    optOn(n) { const a = optArgs(n); if (!a.length) return true; const v = this.deref(this.ev(a[0])); return typeof v === 'number' ? v !== 0 : true; }
    platform(key, args, dt) {
      dt = dt || this.dt || this.cur();
      const saved = this.dt; this.dt = dt;
      try { const r = PLATFORMS[key].call(this, dt, args); return r; } finally { this.dt = saved; }
    }
    mkReports(dt, platform, spec, by, opts) {
      const out = [];
      if (by && by.length) { const ci = by[0]; for (const l of dt.levels(ci, dt.analysisRows())) out.push(new Report(dt, platform, { ...spec, by: { ci, level: String(l), label: `${dt.columns[ci].name}=${l}` } }, opts)); }
      else out.push(new Report(dt, platform, spec, opts));
      this.reports.push(...out);
      return out;
    }
    applyOpts(reps, args, fn) {
      for (const r of reps) {
        for (const a of args) { const name = optName(a); if (!name) continue; if (!fn.call(this, r, norm(name), a)) this.ignored(name); }
        r.render();
      }
      return reps.length === 1 ? reps[0] : reps;
    }
    ignored(name) { this.log('warn', `Option "${name}" is not supported here and was skipped.`); }
    newTable(t) { App.openTable(t); this.tables.push(t); return t; }
    send(obj, msg) {
      const name = optName(msg), key = norm(name), args = optArgs(msg);
      if (obj instanceof DataTable) {
        if (PLATFORMS[key]) return this.platform(key, args, obj);
        const f = TABLE_MSGS[key]; if (!f) throw new Error(`Data table message "${name}" is not supported`);
        const saved = this.dt; this.dt = obj;
        try { return f.call(this, obj, args, msg); } finally { this.dt = saved; }
      }
      if (obj instanceof ColRef) { const f = COL_MSGS[key]; if (!f) throw new Error(`Column message "${name}" is not supported`); return f.call(this, obj, args); }
      if (obj instanceof Report) {
        if (key === 'closewindow') { obj.win.close(); return; }
        if (key === 'report' || key === 'bringwindowtofront') { obj.win.focus(); return obj; }
        if (obj.jslOpt) { if (!obj.jslOpt.call(this, obj, key, msg)) this.ignored(name); obj.render(); return obj; }
      }
      if (obj && obj.sym) throw new Error(`"${obj.sym}" has no value (is it assigned earlier in the script?), so "${name}" cannot be sent to it`);
      throw new Error(`Cannot send "${name}" to ${repr(obj)}`);
    }
    /** Convert a JSL expression to the table formula language */
    toFormula(n, dt) {
      const F = x => this.toFormula(x, dt);
      switch (n.k) {
        case 'num': return String(n.v);
        case 'str': return JSON.stringify(n.v);
        case 'col': { const name = n.nameExpr ? this.str(this.ev(n.nameExpr)) : n.name; const ci = resolveCol(dt, name); if (ci < 0) throw new Error(`Column "${name}" not found`); return `:${JSON.stringify(dt.columns[ci].name)}`; }
        case 'name': { const key = norm(n.name); if (this.vars.has(key)) { const v = this.deref(this.vars.get(key)); return typeof v === 'number' ? String(v) : JSON.stringify(this.str(v)); } if (FORMULA_FN[key]) return FORMULA_FN[key] + '()'; throw new Error(`Unknown name "${n.name}" in formula`); }
        case 'glue': return F(n.list[n.list.length - 1]);
        case 'un': return n.op === '-' ? `(-${F(n.a)})` : `(!${F(n.a)})`;
        case 'bin': return n.op === '||' ? `Concat(${F(n.a)}, ${F(n.b)})` : `(${F(n.a)} ${n.op} ${F(n.b)})`;
        case 'call': {
          const key = norm(n.name); const fn = FORMULA_FN[key];
          if (!fn) throw new Error(`Function "${n.name}" is not supported in formulas`);
          return `${fn}(${n.args.map(F).join(', ')})`;
        }
      }
      throw new Error('Unsupported formula expression');
    }
    /** evaluate expression for each row of dt (used by Select Where etc.) */
    eachRow(dt, node, fn) {
      const saved = [this.dt, this.row]; this.dt = dt;
      try { for (let r = 0; r < dt.nrows; r++) { this.row = r; fn(r, this.ev(node)); } } finally { [this.dt, this.row] = saved; }
    }
  }

  const FORMULA_FN = {
    if: 'If', log: 'Log', ln: 'Log', log10: 'Log10', exp: 'Exp', sqrt: 'Sqrt', abs: 'Abs', round: 'Round', floor: 'Floor', ceiling: 'Ceiling', modulo: 'Modulo', mod: 'Modulo',
    power: 'Power', sine: 'Sin', cosine: 'Cos', tangent: 'Tan', row: 'Row', nrow: 'NRow', nrows: 'NRow', mean: 'Mean', sum: 'Sum', min: 'Min', max: 'Max', ismissing: 'IsMissing',
    randomnormal: 'RandomNormal', randomuniform: 'RandomUniform', randominteger: 'RandomInteger', colmean: 'ColMean', colstddev: 'ColStdDev', colsum: 'ColSum', colmin: 'ColMin',
    colmaximum: 'ColMax', colmax: 'ColMax', colminimum: 'ColMin', colnumber: 'ColNumber', colmedian: 'ColMedian', lag: 'Lag', concat: 'Concat', char: 'Char', num: 'Num',
    uppercase: 'Uppercase', lowercase: 'Lowercase', length: 'Length', substr: 'Substr', substring: 'Substr', contains: 'Contains', pi: 'Pi',
  };

  // ======================= builtin functions =======================
  const mathFn = f => function (args) { const v = this.deref(this.evArg(args, 0)); return Array.isArray(v) ? v.map(x => f(this.num(x))) : f(this.num(v)); };
  const listOrArgs = (it, args) => { const vals = args.map(a => it.deref(it.ev(a))); return vals.length === 1 && Array.isArray(vals[0]) ? vals[0] : vals.flat(); };
  const colVals = (it, args) => { const v = it.ev(args[0]); if (v instanceof ColRef) return v.dt.columns[v.ci].values.filter((x, r) => isNum(x) && !v.dt.rows[r].exc); return null; };
  const statFn = (f, colF) => function (args) { const cv = args.length === 1 ? colVals(this, args) : null; if (cv && colF) return colF(cv); const v = listOrArgs(this, args).map(x => this.num(x)).filter(isNum); return v.length ? f(v) : NaN; };
  const BUILTINS = {
    print(args) { const vals = args.map(a => this.ev(a)); vals.forEach(v => this.log('out', typeof this.deref(v) === 'string' ? JSON.stringify(this.deref(v)) : repr(this.deref(v)))); },
    write(args) { this.log('out', args.map(a => this.str(this.ev(a))).join('')); },
    writeline(args) { this.log('out', args.map(a => this.str(this.ev(a))).join('')); },
    show(args) { for (const a of args) { const lab = a.k === 'name' ? a.name : a.k === 'col' ? ':' + (a.name || '') : a.k === 'str' ? '' : a.k === 'call' ? a.name + '(…)' : 'value'; const v = this.deref(this.ev(a)); this.log('out', lab ? `${lab} = ${repr(v)}` : repr(v)); } },
    clearlog() { this.log('clear'); },
    namesdefaulttohere() {}, wait() {}, beep() {}, deletesymbols() {}, caption(args) { if (args[0]) status(this.str(this.ev(args[0]))); },
    currentdatatable(args) { if (args.length) { const t = this.table(this.ev(args[0])); App.setActive(t); const w = WM.wins.find(w => w.kind === 'table' && w.table === t); if (w) w.focus(); return t; } return this.cur(); },
    datatable(args) { const v = this.deref(this.ev(args[0])); if (typeof v === 'number') { const t = App.tables[v - 1]; if (!t) throw new Error(`No data table number ${v}`); return t; } return this.table(v); },
    open(args) {
      const p = this.str(this.ev(args[0])); const base = p.split(/[\\/]/).pop().replace(/\.(jmp|csv|txt|tsv|json|xlsx|xlsm|xls|xlsb|ods)$/i, '');
      const t = App.tables.find(x => colKey(x.name) === colKey(base)) || App.tables.find(x => x.sourceFile && colKey(x.sourceFile) === colKey(base));
      if (t) { App.setActive(t); return t; }
      throw new Error(`Open("${p}"): the browser cannot read files from your disk by path. Open the file with File ▸ Open first (export .jmp files from JMP as CSV), then run the script — Open() will use the already-open table named "${base}".`);
    },
    close(args) { const t = args.length ? this.table(this.ev(args[0])) : this.cur(); const w = WM.wins.find(w => w.kind === 'table' && w.table === t); if (w) w.close(); else App.closeTable(t); },
    newtable(args) {
      const name = args.length && args[0].k !== 'call' ? this.str(this.ev(args[0])) : 'Untitled';
      const t = new DataTable(name);
      const ar = args.find(a => a.k === 'call' && norm(a.name) === 'addrows'); if (ar) t.addRows(this.num(this.ev(ar.args[0])));
      const saved = this.dt; this.dt = t;
      try { for (const a of args) if (a.k === 'call' && norm(a.name) === 'newcolumn') TABLE_MSGS.newcolumn.call(this, t, a.args); } finally { this.dt = saved; }
      t.recalc();
      return this.newTable(t);
    },
    column(args) {
      let dt = this.dt || null, i = 0;
      if (args.length > 1) { dt = this.table(this.ev(args[0])); i = 1; }
      dt = dt || this.cur();
      const v = this.deref(this.ev(args[i]));
      if (typeof v === 'number') { const c = dt.columns[v - 1]; if (!c) throw new Error(`Column number ${v} does not exist`); return new ColRef(dt, c.name); }
      if (v instanceof ColRef) return v;
      const ci = resolveCol(dt, this.str(v)); if (ci < 0) throw new Error(`Column "${this.str(v)}" not found in "${dt.name}"`);
      return new ColRef(dt, dt.columns[ci].name);
    },
    ascolumn(args) { return BUILTINS.column.call(this, args); },
    nrows(args) { const v = args.length ? this.deref(this.ev(args[0])) : this.cur(); if (v instanceof DataTable) return v.nrows; if (Array.isArray(v)) return v.length; return this.table(v).nrows; },
    nrow(args) { return BUILTINS.nrows.call(this, args); },
    ncols(args) { const v = args.length ? this.deref(this.ev(args[0])) : this.cur(); return v instanceof DataTable ? v.columns.length : 1; },
    ncol(args) { return BUILTINS.ncols.call(this, args); },
    nitems(args) { const v = this.deref(this.ev(args[0])); return Array.isArray(v) || typeof v === 'string' ? v.length : 0; },
    list(args) { return args.map(a => this.ev(a)); },
    eval(args) { return this.ev(args[0]); },
    if(args) { for (let i = 0; i + 1 < args.length; i += 2) if (this.truthy(this.ev(args[i]))) return this.ev(args[i + 1]); return args.length % 2 ? this.ev(args[args.length - 1]) : undefined; },
    for(args) { let v, guard = 0; for (this.ev(args[0]); this.truthy(this.ev(args[1])); this.ev(args[2])) { if (++guard > 1e6) throw new Error('For loop exceeded 1,000,000 iterations'); if (args[3]) v = this.ev(args[3]); } return v; },
    while(args) { let v, guard = 0; while (this.truthy(this.ev(args[0]))) { if (++guard > 1e6) throw new Error('While loop exceeded 1,000,000 iterations'); if (args[1]) v = this.ev(args[1]); } return v; },
    foreachrow(args) { let dt = this.dt || this.cur(), body = args[0]; if (args.length > 1) { dt = this.table(this.ev(args[0])); body = args[1]; } this.eachRow(dt, body, () => {}); dt.emit('data'); },
    try(args) { try { return this.ev(args[0]); } catch (e) { this.vars.set('exception_msg', e.message); return args[1] ? this.ev(args[1]) : undefined; } },
    throw(args) { throw new Error(args.length ? this.str(this.ev(args[0])) : 'Throw'); },
    stop() { throw new Error('Script stopped'); },
    row() { return this.row + 1; },
    ismissing(args) { const v = this.deref(this.ev(args[0])); return isMissing(v) ? 1 : 0; },
    isempty(args) { const v = this.deref(this.ev(args[0])); return v === undefined || (v && v.sym) ? 1 : 0; },
    empty() { return undefined; },
    abs: mathFn(Math.abs), sqrt: mathFn(Math.sqrt), log: mathFn(Math.log), ln: mathFn(Math.log), log10: mathFn(Math.log10), exp: mathFn(Math.exp), floor: mathFn(Math.floor), ceiling: mathFn(Math.ceil),
    round(args) { const d = args[1] ? this.num(this.ev(args[1])) : 0; const f = 10 ** d; return Math.round(this.num(this.ev(args[0])) * f) / f; },
    modulo(args) { return this.num(this.ev(args[0])) % this.num(this.ev(args[1])); }, mod(args) { return BUILTINS.modulo.call(this, args); },
    sum: statFn(S.sum, S.sum), mean: statFn(S.mean, S.mean), min: statFn(S.min, S.min), max: statFn(S.max, S.max), stddev: statFn(S.sd, S.sd), median: statFn(S.median, S.median),
    colmean: statFn(S.mean, S.mean), colsum: statFn(S.sum, S.sum), colstddev: statFn(S.sd, S.sd), colmin: statFn(S.min, S.min), colminimum: statFn(S.min, S.min), colmax: statFn(S.max, S.max), colmaximum: statFn(S.max, S.max), colmedian: statFn(S.median, S.median), colnumber: statFn(v => v.length, v => v.length),
    char(args) { return this.str(this.ev(args[0])); }, num(args) { return this.num(this.ev(args[0])); },
    concat(args) { return args.map(a => this.str(this.ev(a))).join(''); },
    uppercase(args) { return this.str(this.ev(args[0])).toUpperCase(); }, lowercase(args) { return this.str(this.ev(args[0])).toLowerCase(); },
    length(args) { const v = this.deref(this.ev(args[0])); return Array.isArray(v) ? v.length : this.str(v).length; },
    substr(args) { const s = this.str(this.ev(args[0])); const i = this.num(this.ev(args[1])); const n = args[2] ? this.num(this.ev(args[2])) : undefined; return s.substr(i - 1, n); },
    substring(args) { return BUILTINS.substr.call(this, args); },
    contains(args) { const h = this.deref(this.ev(args[0])), x = this.deref(this.ev(args[1])); if (Array.isArray(h)) { const i = h.findIndex(v => repr(v) === repr(x)); return i + 1; } const i = this.str(h).indexOf(this.str(x)); return i + 1; },
    word(args) { const k = this.num(this.ev(args[0])); const s = this.str(this.ev(args[1])); const sep = args[2] ? this.str(this.ev(args[2])) : ' '; const w = s.split(new RegExp('[' + sep.replace(/[\]\\^-]/g, '\\$&') + ']+')).filter(Boolean); return w[k > 0 ? k - 1 : w.length + k] ?? ''; },
    insertinto(args) { if (args[0].k !== 'name') throw new Error('Insert Into needs a list variable'); const key = norm(args[0].name); const arr = this.vars.get(key) || []; const v = this.ev(args[1]); if (Array.isArray(v)) arr.push(...v); else arr.push(v); this.vars.set(key, arr); return arr; },
    randomnormal(args) { const m = args[0] ? this.num(this.ev(args[0])) : 0, s = args[1] ? this.num(this.ev(args[1])) : 1; return m + s * Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random()); },
    randomuniform(args) { const a = args[0] ? this.num(this.ev(args[0])) : 0, b = args[1] ? this.num(this.ev(args[1])) : 1; return a + (b - a) * Math.random(); },
    randominteger(args) { const a = this.num(this.ev(args[0])), b = args[1] ? this.num(this.ev(args[1])) : a; return args[1] ? a + Math.floor(Math.random() * (b - a + 1)) : 1 + Math.floor(Math.random() * a); },
    pi() { return Math.PI; }, today() { return Date.now() / 1000; },
    format(args) { return this.str(this.ev(args[0])); },
  };

  // ======================= data table messages =======================
  const colNameOf = (it, a) => { const v = it.deref(it.ev(a)); return v instanceof ColRef ? v.name : it.str(v); };
  const TABLE_MSGS = {
    stack(dt, args) {
      const cols = this.roleCols(dt, args, ['columns', 'stackcolumns']);
      if (!cols.length) throw new Error('Stack: specify Columns( ... )');
      const label = this.strArg(args, ['sourcelabelcolumn'], 'Label'), data = this.strArg(args, ['stackeddatacolumn'], 'Data');
      const name = this.strArg(args, ['outputtable', 'outputtablename'], `${dt.name} Stacked`);
      const drop = this.onArg(args, ['dropallothercolumns']);
      const keep = drop ? [] : dt.columns.map((_, i) => i).filter(i => !cols.includes(i));
      const nt = new DataTable(name); const n = dt.nrows * cols.length; nt.addRows(n);
      const numeric = cols.every(ci => dt.columns[ci].dataType === 'numeric');
      for (const ci of keep) { const c = dt.columns[ci]; nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: Array.from({ length: n }, (_, k) => c.values[Math.floor(k / cols.length)]) }); }
      nt.addColumn({ name: label, dataType: 'character', values: Array.from({ length: n }, (_, k) => dt.columns[cols[k % cols.length]].name) });
      nt.addColumn({ name: data, dataType: numeric ? 'numeric' : 'character', values: Array.from({ length: n }, (_, k) => { const v = dt.columns[cols[k % cols.length]].values[Math.floor(k / cols.length)]; return numeric ? v : (isMissing(v) ? '' : String(v)); }) });
      this.log('info', `Stack: ${dt.nrows} rows × ${cols.length} columns → "${nt.name}" (${nt.nrows} rows)`);
      return this.newTable(nt);
    },
    sort(dt, args) {
      const by = this.roleCols(dt, args, ['by']);
      if (!by.length) throw new Error('Sort: specify By( ... )');
      const ordA = this.argOf(args, ['order']); const ord = ordA ? ordA.args.map(a => /desc/i.test(optName(a) || this.str(this.ev(a))) ? -1 : 1) : [];
      const order = [...dt.rows.keys()].sort((a, b) => {
        for (let k = 0; k < by.length; k++) {
          const c = dt.columns[by[k]], x = c.values[a], y = c.values[b];
          if (isMissing(x) || isMissing(y)) { if (isMissing(x) && isMissing(y)) continue; return isMissing(x) ? -1 : 1; }
          const d = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          if (d) return d * (ord[k] || 1);
        }
        return a - b;
      });
      if (this.onArg(args, ['replacetable'])) { dt.rows = order.map(i => dt.rows[i]); for (const c of dt.columns) c.values = order.map(i => c.values[i]); dt.emit('data'); return dt; }
      return this.newTable(dt.clone(this.strArg(args, ['outputtable', 'outputtablename'], `${dt.name} Sorted`), order));
    },
    subset(dt, args) {
      let rows;
      const ra = this.argOf(args, ['rows']);
      if (ra) rows = (this.deref(this.ev(ra.args[0])) || []).flat().map(x => this.num(x) - 1).filter(r => r >= 0 && r < dt.nrows);
      else if (this.onArg(args, ['allrows'])) rows = [...dt.rows.keys()];
      else if (this.argOf(args, ['selectedrows'])) rows = this.onArg(args, ['selectedrows']) ? dt.selectedRows() : [...dt.rows.keys()];
      else rows = dt.selCount ? dt.selectedRows() : [...dt.rows.keys()];
      let cols = this.roleCols(dt, args, ['columns']);
      if (!cols.length && this.onArg(args, ['selectedcolumns', 'selectedcolumnsonly'])) cols = [...dt.selCols];
      return this.newTable(dt.clone(this.strArg(args, ['outputtable', 'outputtablename'], `Subset of ${dt.name}`), rows, cols.length ? cols : null));
    },
    summary(dt, args) {
      const g = this.roleCols(dt, args, ['group']);
      const statMap = { mean: 'Mean', sum: 'Sum', stddev: 'Std Dev', min: 'Min', max: 'Max', median: 'Median', variance: 'Variance', n: 'N', range: 'Range', stderr: 'Std Err', nmissing: 'N Missing' };
      const stats = [];
      for (const a of args) if (a.k === 'call' && statMap[norm(a.name)]) for (const x of a.args) for (const ci of this.toCols(dt, x)) stats.push([statMap[norm(a.name)], ci]);
      const rows = dt.complete(g, dt.analysisRows());
      const m = new Map();
      for (const r of rows) { const k = g.map(ci => String(dt.columns[ci].values[r])).join('\u0001'); if (!m.has(k)) m.set(k, { vals: g.map(ci => dt.columns[ci].values[r]), rows: [] }); m.get(k).rows.push(r); }
      let groups = [...m.values()].sort((a, b) => { for (let i = 0; i < g.length; i++) { const x = a.vals[i], y = b.vals[i]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); if (c) return c; } return 0; });
      if (!g.length) groups = [{ vals: [], rows }];
      const nt = new DataTable(this.strArg(args, ['outputtable', 'outputtablename'], `${dt.name} By (${g.map(c => dt.columns[c].name).join(', ') || 'All'})`));
      nt.addRows(groups.length);
      g.forEach((ci, i) => { const c = dt.columns[ci]; nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: groups.map(x => x.vals[i]) }); });
      nt.addColumn({ name: 'N Rows', values: groups.map(x => x.rows.length) });
      const F = { ...STATS, 'N Missing': null };
      for (const [s, ci] of stats) {
        const c = dt.columns[ci];
        nt.addColumn({ name: `${s}(${c.name})`, values: groups.map(x => { const all = x.rows.map(r => c.values[r]); if (s === 'N Missing') return all.filter(isMissing).length; const v = all.filter(isNum); return v.length ? F[s](v) : NaN; }) });
      }
      return this.newTable(nt);
    },
    split(dt, args) {
      const by = this.roleCols(dt, args, ['splitby'])[0], sc = this.roleCols(dt, args, ['split', 'splitcolumns']), grp = this.roleCols(dt, args, ['group']);
      if (by === undefined || !sc.length) throw new Error('Split: specify Split By( :col ) and Split( :cols )');
      const lv = dt.levels(by); const m = new Map();
      for (let i = 0; i < dt.nrows; i++) { const k = grp.map(c => String(dt.columns[c].values[i])).join('\u0001'); if (!m.has(k)) m.set(k, { vals: grp.map(c => dt.columns[c].values[i]), cells: new Map() }); m.get(k).cells.set(String(dt.columns[by].values[i]), i); }
      const gs = [...m.values()]; const nt = new DataTable(this.strArg(args, ['outputtable', 'outputtablename'], `${dt.name} Split`)); nt.addRows(gs.length);
      grp.forEach((c, i) => nt.addColumn({ name: dt.columns[c].name, dataType: dt.columns[c].dataType, modelingType: dt.columns[c].modelingType, values: gs.map(x => x.vals[i]) }));
      for (const c of sc) for (const l of lv) { const col = dt.columns[c]; nt.addColumn({ name: sc.length > 1 ? `${col.name} ${l}` : String(l), dataType: col.dataType, values: gs.map(x => { const r0 = x.cells.get(String(l)); return r0 === undefined ? DataTable.missing(col.dataType) : col.values[r0]; }) }); }
      return this.newTable(nt);
    },
    transpose(dt, args) {
      const cols = this.roleCols(dt, args, ['columns']); const lab = this.roleCols(dt, args, ['label'])[0];
      const use = cols.length ? cols : dt.columns.map((_, i) => i).filter(i => dt.columns[i].dataType === 'numeric');
      const nt = new DataTable(this.strArg(args, ['outputtable', 'outputtablename'], `Transpose of ${dt.name}`)); nt.addRows(use.length);
      nt.addColumn({ name: 'Label', dataType: 'character', values: use.map(c => dt.columns[c].name) });
      const numeric = use.every(c => dt.columns[c].dataType === 'numeric');
      for (let i = 0; i < dt.nrows; i++) nt.addColumn({ name: lab !== undefined ? String(dt.columns[lab].values[i]) : `Row ${i + 1}`, dataType: numeric ? 'numeric' : 'character', values: use.map(c => numeric ? dt.columns[c].values[i] : String(dt.columns[c].values[i] ?? '')) });
      return this.newTable(nt);
    },
    concatenate(dt, args) {
      const others = [];
      for (const a of args) { if (a.k === 'call' && ['outputtable', 'outputtablename', 'appendtofirsttable', 'keepformulas', 'createsourcecolumn'].includes(norm(a.name))) continue; const v = this.deref(this.ev(a)); (Array.isArray(v) ? v : [v]).forEach(x => others.push(this.table(x))); }
      const append = this.onArg(args, ['appendtofirsttable']);
      const nt = append ? dt : dt.clone(this.strArg(args, ['outputtable', 'outputtablename'], `Concatenate of ${dt.name}`));
      for (const o of others) {
        const base = nt.nrows; nt.addRows(o.nrows);
        for (const c of o.columns) {
          let ci = resolveCol(nt, c.name);
          if (ci < 0) { nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType }); ci = nt.columns.length - 1; }
          const tc = nt.columns[ci]; for (let i = 0; i < o.nrows; i++) tc.values[base + i] = nt.parseValue(tc, c.values[i]);
        }
      }
      if (append) { dt.emit('structure'); return dt; }
      return this.newTable(nt);
    },
    join(dt, args) {
      const w = this.argOf(args, ['with']); if (!w) throw new Error('Join: specify With( Data Table( "..." ) )');
      const o = this.table(this.ev(w.args[0]));
      const mc = this.argOf(args, ['matchcolumns', 'bymatchingcolumns']);
      const pairs = [];
      if (mc) for (const a of mc.args) {
        if (a.k === 'assign' || (a.k === 'bin' && a.op === '==')) { const l = a.k === 'assign' ? a.target : a.a, r = a.k === 'assign' ? a.value : a.b; pairs.push([this.toCols(dt, l)[0], this.toCols(o, r)[0]]); }
        else { const ci = this.toCols(dt, a)[0]; pairs.push([ci, resolveCol(o, dt.columns[ci].name)]); }
      }
      const byRow = !pairs.length;
      const inc = this.argOf(args, ['includenonmatches']); const left = inc ? this.truthy(this.ev(inc.args[0])) : false;
      const key = (t, r, side) => pairs.map(p => String(t.columns[p[side]].values[r])).join('\u0001');
      const idx = new Map(); if (!byRow) for (let i = 0; i < o.nrows; i++) { const k = key(o, i, 1); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(i); }
      const out = [];
      for (let i = 0; i < dt.nrows; i++) {
        if (byRow) { out.push([i, i < o.nrows ? i : -1]); continue; }
        const m = idx.get(key(dt, i, 0)); if (m) m.forEach(j => out.push([i, j])); else if (left) out.push([i, -1]);
      }
      const nt = new DataTable(this.strArg(args, ['outputtable', 'outputtablename'], `${dt.name} + ${o.name}`)); nt.addRows(out.length);
      for (const c of dt.columns) nt.addColumn({ name: c.name, dataType: c.dataType, modelingType: c.modelingType, values: out.map(([i]) => c.values[i]) });
      const skip = new Set(pairs.map(p => p[1]));
      o.columns.forEach((c, ci) => { if (skip.has(ci)) return; nt.addColumn({ name: nt.columns.some(x => x.name === c.name) ? `${c.name} of ${o.name}` : c.name, dataType: c.dataType, modelingType: c.modelingType, values: out.map(([, j]) => j < 0 ? DataTable.missing(c.dataType) : c.values[j]) }); });
      return this.newTable(nt);
    },
    newcolumn(dt, args) {
      const name = args.length && args[0].k !== 'call' ? this.str(this.ev(args[0])) : 'Column';
      let dataType = 'numeric', modelingType = null, formula = null, values = null;
      for (const a of args.slice(1)) {
        const nm = norm(optName(a) || (a.k === 'str' ? a.v : ''));
        if (['numeric', 'character', 'rowstate', 'expression'].includes(nm)) dataType = nm === 'character' ? 'character' : 'numeric';
        else if (['continuous', 'nominal', 'ordinal'].includes(nm)) modelingType = nm;
        else if (nm === 'formula') formula = this.toFormula(a.args[0], dt);
        else if (nm === 'setvalues' || nm === 'values') { const v = this.deref(this.ev(a.args[0])); values = Array.isArray(v) ? v.map(x => this.deref(x)) : [v]; }
        else if (nm === 'seteachvalue') { values = []; this.eachRow(dt, a.args[0], (r, v) => values.push(this.deref(v))); }
      }
      if (values && values.some(v => typeof v === 'string') && dataType === 'numeric' && !args.slice(1).some(a => norm(optName(a) || (a.k === 'str' ? a.v : '')) === 'numeric')) dataType = 'character';
      if (values && values.length > dt.nrows) dt.addRows(values.length - dt.nrows);
      if (values) values = values.map(v => dataType === 'numeric' ? (typeof v === 'number' ? v : Number(v)) : (isMissing(v) ? '' : String(v)));
      const col = dt.addColumn({ name, dataType, modelingType: modelingType || (dataType === 'numeric' ? 'continuous' : 'nominal'), values, formula });
      if (formula && /^".*"$|\bConcat\(|\bChar\(|Uppercase|Lowercase|Substr/.test(formula) && dataType === 'numeric' && !args.slice(1).some(a => norm(optName(a) || '') === 'numeric')) { col.dataType = 'character'; col.modelingType = modelingType || 'nominal'; }
      dt.emit('structure');
      if (col.formulaError) throw new Error(`Formula error in "${col.name}": ${col.formulaError}`);
      return new ColRef(dt, col.name);
    },
    addrows(dt, args) { const n = this.num(this.ev(args[0])); dt.addRows(n); dt.emit('data'); return dt; },
    deleterows(dt, args) { const rows = args.length ? [this.deref(this.ev(args[0]))].flat(2).map(x => this.num(x) - 1) : dt.selectedRows(); dt.deleteRows(rows); dt.emit('data'); return dt; },
    deletecolumns(dt, args) { const cols = args.length ? args.flatMap(a => this.toCols(dt, a)) : [...dt.selCols]; dt.deleteColumns(cols); dt.emit('structure'); return dt; },
    selectwhere(dt, args) { const rows = []; this.eachRow(dt, args[0], (r, v) => { if (this.truthy(v)) rows.push(r); }); const cur = this.argOf(args, ['currentselection']); const mode = cur ? norm(this.str(this.ev(cur.args[0]))) : 'clear'; if (mode === 'restrict') dt.select(rows.filter(r => dt.rows[r].sel)); else dt.select(rows, mode === 'extend' ? 'extend' : 'replace'); return dt; },
    getrowswhere(dt, args) { const rows = []; this.eachRow(dt, args[0], (r, v) => { if (this.truthy(v)) rows.push(r + 1); }); return rows; },
    selectrows(dt, args) { dt.select([this.deref(this.ev(args[0]))].flat(2).map(x => this.num(x) - 1), 'extend'); return dt; },
    selectallrows(dt) { dt.select([...dt.rows.keys()]); return dt; },
    clearselect(dt) { dt.select([], 'replace'); return dt; },
    invertrowselection(dt) { dt.select([...dt.rows.keys()], 'toggle'); return dt; },
    getselectedrows(dt) { return dt.selectedRows().map(r => r + 1); },
    exclude(dt, args) { const on = args.length ? this.truthy(this.ev(args[0])) : true; dt.selectedRows().forEach(r => dt.rows[r].exc = on); dt.emit('rows'); return dt; },
    hide(dt, args) { const on = args.length ? this.truthy(this.ev(args[0])) : true; dt.selectedRows().forEach(r => dt.rows[r].hid = on); dt.emit('rows'); return dt; },
    label(dt, args) { const on = args.length ? this.truthy(this.ev(args[0])) : true; dt.selectedRows().forEach(r => dt.rows[r].lab = on); dt.emit('rows'); return dt; },
    clearrowstates(dt) { dt.rows.forEach(r => Object.assign(r, { sel: false, exc: false, hid: false, lab: false, color: null })); dt.emit('rows'); return dt; },
    colorbycolumn(dt, args) { App.colorBy(dt, this.toCols(dt, args[0])[0]); return dt; },
    getname(dt) { return dt.name; },
    setname(dt, args) { dt.name = this.str(this.ev(args[0])); dt.emit('structure'); WM.refreshList(); return dt; },
    getcolumnnames(dt, args) { const s = args.some(a => /string/i.test(optName(a))); return dt.columns.map(c => s ? c.name : new ColRef(dt, c.name)); },
    getasmatrix(dt) { return dt.columns.filter(c => c.dataType === 'numeric').map(c => c.values); },
    save(dt, args) {
      const p = (args.length ? this.str(this.ev(args[0])) : dt.name + '.xlsx').split(/[\\/]/).pop();
      if (/\.csv$|\.txt$/i.test(p)) download(p, dt.toCSV(), 'text/csv');
      else Excel.save([dt], p.replace(/\.(jmp|xls|xlsm|xlsb)$/i, '') .replace(/(\.xlsx)?$/i, '.xlsx'));
      return dt;
    },
    closewindow(dt) { const w = WM.wins.find(w => w.kind === 'table' && w.table === dt); if (w) w.close(); },
    runformulas(dt) { dt.emit('data'); return dt; }, rerunformulas(dt) { dt.emit('data'); return dt; },
    bringwindowtofront(dt) { const w = WM.wins.find(w => w.kind === 'table' && w.table === dt); if (w) w.focus(); return dt; },
    setcurrent(dt) { App.setActive(dt); return dt; },
  };
  TABLE_MSGS.excluded = TABLE_MSGS.exclude; TABLE_MSGS.hidden = TABLE_MSGS.hide; TABLE_MSGS.labeled = TABLE_MSGS.label;
  TABLE_MSGS.clearrowselection = TABLE_MSGS.clearselect; TABLE_MSGS.selectall = TABLE_MSGS.selectallrows;

  const COL_MSGS = {
    setname(c, a) { const t = c.dt, ci = c.ci; const nn = this.str(this.ev(a[0])); App.renameRefs(t, t.columns[ci].name, nn); t.columns[ci].name = nn; c.name = nn; t.emit('structure'); return c; },
    getname(c) { return c.name; },
    setmodelingtype(c, a) { const mt = norm(this.str(this.ev(a[0]))); if (['continuous', 'nominal', 'ordinal'].includes(mt)) { const col = c.dt.columns[c.ci]; if (mt !== 'continuous' || col.dataType === 'numeric') col.modelingType = mt; c.dt.emit('structure'); } return c; },
    setdatatype(c, a) { const dt = norm(optName(a[0]) || this.str(this.ev(a[0]))); c.dt.setDataType(c.ci, dt === 'character' ? 'character' : 'numeric'); c.dt.emit('structure'); return c; },
    setformula(c, a) { c.dt.columns[c.ci].formula = this.toFormula(a[0], c.dt); c.dt.emit('structure'); return c; },
    deleteformula(c) { c.dt.columns[c.ci].formula = null; c.dt.emit('structure'); return c; },
    getvalues(c) { return [...c.dt.columns[c.ci].values]; },
    getasmatrix(c) { return [...c.dt.columns[c.ci].values]; },
    setvalues(c, a) { const v = this.deref(this.ev(a[0])); const col = c.dt.columns[c.ci]; if (v.length > c.dt.nrows) c.dt.addRows(v.length - c.dt.nrows); v.forEach((x, i) => c.dt.setCell(i, c.ci, this.deref(x))); c.dt.emit('data'); return c; },
    setselected(c, a) { const on = a.length ? this.truthy(this.ev(a[0])) : true; on ? c.dt.selCols.add(c.ci) : c.dt.selCols.delete(c.ci); c.dt.emit('structure'); return c; },
  };

  // ======================= platform option maps =======================
  function distOpt(r, k, n, ci) {
    const K = x => ci + ':' + x, on = this.optOn(n), a = optArgs(n);
    const set = (x, v = on) => { r.opts[K(x)] = v; return true; };
    switch (k) {
      case 'normalquantileplot': return set('nq'); case 'cdfplot': return set('cdf'); case 'quantiles': return set('q');
      case 'summarystatistics': case 'moments': return set('ss'); case 'histogram': return set('hist'); case 'outlierboxplot': case 'boxplot': return set('box');
      case 'customizesummarystatistics': return set('allss', true); case 'confidenceinterval': return set('ci', true);
      case 'fitnormal': case 'normal': return set('fitn', true);
      case 'fitdistribution': case 'continuousfit': return /normal/i.test(a.map(optName).join(' ') || 'normal') ? set('fitn', true) : false;
      case 'smoothcurve': return set('kde', true);
      case 'testmean': return set('mu0', a.length ? this.num(this.ev(a[0])) : 0);
      case 'setbinwidth': return set('bw', this.num(this.ev(a[0])));
      case 'frequencies': return set('freq'); case 'orderbycount': return set('ordc'); case 'countaxis': return set('cax'); case 'mosaicplot': return set('mos');
      case 'stack': r.opts.stack = on; return true; case 'horizontallayout': r.opts.stack = !on; return true;
      case 'uniformscaling': r.opts.uniform = on; return true;
      case 'column': case 'y': case 'by': case 'freq': case 'weight': case 'automaticrecalc': case 'sendtoreport': case 'vertical': return true;
    }
    return false;
  }
  function fitxyOpt(r, k, n, K) {
    const on = this.optOn(n), a = optArgs(n);
    const set = (x, v = on) => { r.opts[K(x)] = v; return true; };
    const addFit = f => { r.opts[K('fits')] = [...(r.opts[K('fits')] || []), f]; return true; };
    switch (k) {
      case 'fitline': case 'fitlinear': return addFit({ deg: 1 });
      case 'fitmean': return addFit({ deg: 0 });
      case 'fitpolynomial': return addFit({ deg: Math.max(1, Math.min(5, a.length ? this.num(this.ev(a[0])) : 2)) });
      case 'fitspline': case 'kernelsmoother': case 'fiteachvalue': return set('spline', true);
      case 'densityellipse': { const p = a.length ? this.num(this.ev(a[0])) : 0.95; r.opts[K('ell')] = [...(r.opts[K('ell')] || []), p]; return true; }
      case 'histogramborders': return set('hb'); case 'showpoints': return set('pts');
      case 'means/anova': case 'means/anova/pooledt': case 'meansanova': case 'anova': r.opts[K('anova')] = on; r.opts[K('diam')] = on; return true;
      case 'meansandstddev': return set('msd'); case 'ttest': case 'means/anova/t test': return set('ttest');
      case 'quantiles': return set('quant'); case 'boxplots': return set('box'); case 'meandiamonds': return set('diam');
      case 'eachpair': case "eachpair,student'st": return set('pairs'); case 'allpairs': case 'allpairs,tukeyhsd': return set('tukey');
      case 'withcontrol': case 'withcontrol,dunnett\'s': return set('dunn');
      case 'comparemeans': { const s = a.map(x => optName(x) || (x.k === 'str' ? x.v : '')).join(' ').toLowerCase(); if (/each/.test(s)) set('pairs', true); if (/tukey|all pairs/.test(s)) set('tukey', true); if (/control|dunnett/.test(s)) set('dunn', true); return true; }
      case 'wilcoxontest': case 'nonparametric': case 'kruskalwallis': return set('np', true);
      case 'unequalvariances': return set('uv'); case 'normalquantileplot': return set('nq'); case 'pointsjittered': return set('jit');
      case 'connectmeans': return set('conn'); case 'meanlines': return set('ml'); case 'meanerrorbars': return set('meb'); case 'stddevlines': return set('sdl'); case 'grandmean': return set('gm');
      case 'mosaicplot': return set('mos'); case 'contingencytable': return set('ct'); case 'tests': return set('tests');
      case "fisher'sexacttest": case 'fishersexacttest': return set('fisher'); case 'correspondenceanalysis': return set('ca');
      case 'analysisofmeansforproportions': return set('anomp');
      case 'roccurve': return set('roc'); case 'oddsratios': return set('or');
      case 'y': case 'x': case 'by': case 'automaticrecalc': case 'sendtoreport': case 'sendtobyreport': case 'freq': case 'weight': return true;
    }
    return false;
  }
  const simpleOpt = map => function (r, k, n) { if (k in map) { if (map[k]) r.opts[map[k]] = this.optOn(n); return true; } return false; };
  const MV_OPT = simpleOpt({ scatterplotmatrix: 'spm', pairwisecorrelations: 'pw', covariancematrix: 'cov', principalcomponents: 'pca', correlationsmultivariate: 'corr', "spearman'sρ": 'spear', "spearman'srho": 'spear', nonparametriccorrelations: 'spear', mahalanobisdistances: 'mahal', outlieranalysis: 'mahal', univariatesimplestatistics: 'uss', colormaponcorrelations: 'cmap', densityellipses: 'ell', y: null, by: null, estimationmethod: null });
  const FM_OPT = simpleOpt({ summaryoffit: 'sof', analysisofvariance: 'aov', parameterestimates: 'pe', effecttests: 'et', sortedestimates: 'spe', showpredictionexpression: 'expr', plotactualbypredicted: 'avp', plotresidualbypredicted: 'rvp', plotresidualbyrow: 'rvr', plotresidualnormalquantiles: 'rnq', durbinwatsontest: 'dw', profiler: 'prof', predictionprofiler: 'prof', y: null, effects: null, personality: null, run: null, runmodel: null, emphasis: null, by: null });

  // ======================= platforms =======================
  const fitxyPlatform = kind => function (dt, args) {
    const y = this.roleCols(dt, args, ['y', 'yresponse']), x = this.roleCols(dt, args, ['x', 'xfactor']), by = this.roleCols(dt, args, ['by']);
    if (!y.length || !x.length) throw new Error(`${kind}: specify Y( ... ) and X( ... )`);
    const reps = this.mkReports(dt, 'fitxy', { y, x, kind }, by);
    const opt = function (r, k, n) { let ok = false; for (const yi of r.spec.y) for (const xi of r.spec.x) ok = fitxyOpt.call(this, r, k, n, z => `${yi}_${xi}:${z}`) || ok; return ok; };
    reps.forEach(r => { r.jslOpt = opt; });
    return this.applyOpts(reps, args, opt);
  };
  const PLATFORMS = {
    distribution(dt, args) {
      const y = [], per = [];
      for (const a of args) if (a.k === 'call' && /distribution$/.test(norm(a.name))) {
        const cn = a.args.find(x => x.k === 'call' && norm(x.name) === 'column'); if (!cn) continue;
        const cs = this.toCols(dt, cn.args[0]); y.push(...cs); per.push([cs[0], a.args.filter(x => x !== cn)]);
      }
      y.push(...this.roleCols(dt, args, ['y', 'column', 'columns']));
      if (!y.length) throw new Error('Distribution: specify Y( ... )');
      const by = this.roleCols(dt, args, ['by']);
      const reps = this.mkReports(dt, 'distribution', { y: [...new Set(y)] }, by);
      const opt = function (r, k, n) { let ok = false; for (const ci of r.spec.y) ok = distOpt.call(this, r, k, n, ci) || ok; return ok; };
      reps.forEach(r => { r.jslOpt = opt; for (const [ci, os] of per) for (const o of os) { const nm = optName(o); if (nm && !distOpt.call(this, r, norm(nm), o, ci)) this.ignored(nm); } });
      return this.applyOpts(reps, args.filter(a => !(a.k === 'call' && /distribution$/.test(norm(a.name)))), opt);
    },
    bivariate: fitxyPlatform('Bivariate'), oneway: fitxyPlatform('Oneway'), contingency: fitxyPlatform('Contingency'), logistic: fitxyPlatform('Logistic'), fitybyx: fitxyPlatform('Fit Y by X'),
    fitmodel(dt, args) {
      const y = this.roleCols(dt, args, ['y']); const ef = this.argOf(args, ['effects']);
      if (!y.length || !ef) throw new Error('Fit Model: specify Y( ... ) and Effects( ... )');
      const effects = ef.args.map(a => {
        const flat = []; const walk = n => { if (n.k === 'bin' && (n.op === '*' || n.op === '&')) { walk(n.a); if (n.op === '*') walk(n.b); } else if (n.k === 'name' && /^rs$/i.test(n.name)) { /* response surface tag */ } else flat.push(...this.toCols(dt, n)); };
        walk(a); return flat;
      }).filter(e => e.length);
      const by = this.roleCols(dt, args, ['by']);
      const reps = y.flatMap(yi => this.mkReports(dt, 'fitmodel', { y: [yi], effects }, by));
      reps.forEach(r => { r.jslOpt = FM_OPT; });
      return this.applyOpts(reps, args, FM_OPT);
    },
    graphbuilder(dt, args) {
      const o = { els: [] };
      const vars = this.argOf(args, ['variables']);
      if (vars) for (const v of vars.args) {
        if (v.k !== 'call') continue; const k = norm(v.name); const z = { x: 'x', y: 'y', overlay: 'ov', color: 'ov', groupx: 'gx', wrap: 'gx', groupy: 'gy', page: 'gy' }[k];
        if (!z) { this.ignored(v.name); continue; }
        const cn = v.args.filter(a => this.isColNode(a)); if (cn.length) o[z] = this.toCols(dt, cn[0])[0];
      }
      const elMap = { points: 'points', smoother: 'smoother', lineoffit: 'linefit', line: 'line', bar: 'bar', boxplot: 'box', histogram: 'histogram', heatmap: 'heatmap', area: 'area' };
      const els = this.argOf(args, ['elements']);
      if (els) for (const e of els.args) { const k = norm(optName(e)); if (elMap[k]) o.els.push(elMap[k]); else if (k) this.ignored(optName(e)); }
      if (this.argOf(args, ['showcontrolpanel']) && !this.onArg(args, ['showcontrolpanel'])) o.done = true;
      if (o.x === undefined && o.y === undefined) throw new Error('Graph Builder: specify Variables( X( ... ), Y( ... ) )');
      const r = new Report(dt, 'graphbuilder', {}, o); this.reports.push(r);
      return r;
    },
    multivariate(dt, args) {
      const y = this.roleCols(dt, args, ['y', 'ycolumns']).filter(c => !dt.isCat(c)); const by = this.roleCols(dt, args, ['by']);
      const reps = this.mkReports(dt, 'multivariate', { y }, by); reps.forEach(r => { r.jslOpt = MV_OPT; });
      return this.applyOpts(reps, args, MV_OPT);
    },
    principalcomponents(dt, args) { const r = new Report(dt, 'pca', { y: this.roleCols(dt, args, ['y']).filter(c => !dt.isCat(c)) }); this.reports.push(r); return r; },
    scatterplotmatrix(dt, args) { const r = new Report(dt, 'spm', { y: this.roleCols(dt, args, ['y']).filter(c => !dt.isCat(c)) }); this.reports.push(r); return r; },
    kmeanscluster(dt, args) {
      const nc = findCalls({ k: 'x', args }, 'numberofclusters')[0];
      const k = nc ? this.num(this.ev(nc.args[0])) : 3;
      const r = new Report(dt, 'kmeans', { y: this.roleCols(dt, args, ['y']).filter(c => !dt.isCat(c)), k: Math.max(2, Math.round(k)), std: true }); this.reports.push(r); return r;
    },
    hierarchicalcluster(dt, args) {
      const nc = findCalls({ k: 'x', args }, 'numberofclusters')[0]; const meth = this.strArg(args, ['method'], 'Ward');
      const r = new Report(dt, 'hclust', { y: this.roleCols(dt, args, ['y']).filter(c => !dt.isCat(c)), lab: this.roleCols(dt, args, ['label'])[0], method: ['Ward', 'Average', 'Complete', 'Single'].find(m => new RegExp(m, 'i').test(meth)) || 'Ward', k: nc ? Math.round(this.num(this.ev(nc.args[0]))) : 3 });
      this.reports.push(r); return r;
    },
    controlchart(dt, args) {
      const sub = this.roleCols(dt, args, ['samplelabel'])[0];
      const ss = this.argOf(args, ['samplesize']);
      let subCol = sub, n = 5;
      if (ss) { const v = this.ev(ss.args[0]); if (v instanceof ColRef) subCol = v.ci; else n = this.num(v); }
      const out = [];
      for (const cc of findCalls({ k: 'x', args }, 'chartcol')) {
        const y = this.toCols(dt, cc.args[0])[0];
        const kinds = cc.args.slice(1).map(a => norm(optName(a)));
        let chart = 'IR';
        if (kinds.includes('xbar')) chart = kinds.includes('s') ? 'XBar & S' : 'XBar & R';
        else if (kinds.includes('p') || kinds.includes('np')) chart = 'P';
        if (chart === 'IR') subCol = sub;
        const r = new Report(dt, 'control', { y, sub: subCol, chart, n }); out.push(r);
      }
      if (!out.length) throw new Error('Control Chart: specify Chart Col( :col, Individual Measurement, Moving Range ) or Chart Col( :col, XBar, R )');
      this.reports.push(...out); return out.length === 1 ? out[0] : out;
    },
    controlchartbuilder(dt, args) {
      const vars = this.argOf(args, ['variables']) || { args };
      const y = this.roleCols(dt, vars.args, ['y'])[0], sub = this.roleCols(dt, vars.args, ['subgroup'])[0];
      if (y === undefined) throw new Error('Control Chart Builder: specify Variables( Y( :col ) )');
      const txt = JSON.stringify(args).toLowerCase();
      const chart = sub === undefined ? 'IR' : /standard deviation|"s"/.test(txt) ? 'XBar & S' : 'XBar & R';
      const r = new Report(dt, 'control', { y, sub, chart, n: 5 }); this.reports.push(r); return r;
    },
    paretoplot(dt, args) {
      const y = this.roleCols(dt, args, ['cause', 'y'])[0]; const f = this.roleCols(dt, args, ['freq'])[0]; const by = this.roleCols(dt, args, ['by']);
      if (y === undefined) throw new Error('Pareto Plot: specify Cause( :col )');
      const reps = this.mkReports(dt, 'pareto', { y, freq: f }, by); return reps.length === 1 ? reps[0] : reps;
    },
    processcapability(dt, args) {
      const pv = this.roleCols(dt, args, ['processvariables', 'y']);
      const lim = k => { const c = findCalls({ k: 'x', args }, k)[0]; return c ? this.num(this.ev(c.args[0])) : NaN; };
      const cap = { lsl: lim('lsl'), target: lim('target'), usl: lim('usl') };
      const out = pv.map(y => new Report(dt, 'capability', { y, cap })); this.reports.push(...out); return out.length === 1 ? out[0] : out;
    },
    tabulate(dt, args) {
      const ac = findCalls({ k: 'x', args }, 'analysiscolumns').flatMap(c => c.args.flatMap(a => this.toCols(dt, a)));
      const rowT = findCalls({ k: 'x', args }, 'rowtable'), colT = findCalls({ k: 'x', args }, 'columntable');
      const grp = list => list.flatMap(t => findCalls(t, 'groupingcolumns')).flatMap(c => c.args.flatMap(a => this.toCols(dt, a)));
      const statNames = findCalls({ k: 'x', args }, 'statistics').flatMap(c => c.args.map(a => optName(a) || (a.k === 'str' ? a.v : '')));
      const map = { n: 'N', mean: 'Mean', stddev: 'Std Dev', min: 'Min', max: 'Max', sum: 'Sum', median: 'Median', variance: 'Variance', range: 'Range' };
      const stats = [...new Set(statNames.map(s => map[norm(s)]).filter(Boolean))];
      const r = new Report(dt, 'tabulate', { rows: grp(rowT), cols: grp(colT).slice(0, 1), y: ac.filter(c => !dt.isCat(c)), stats: stats.length ? stats : ['N'], pct: statNames.some(s => /%/.test(s)), all: true });
      this.reports.push(r); return r;
    },
  };
  PLATFORMS.capability = PLATFORMS.processcapability;
  PLATFORMS.kmeans = PLATFORMS.kmeanscluster;

  function run(src, log) {
    const it = new Interp(log);
    const t0 = performance.now();
    const v = it.run(src);
    for (const t of new Set([...App.tables])) if (t._jslDirty) { t._jslDirty = false; t.emit('data'); }
    return { value: v, ms: performance.now() - t0, interp: it };
  }
  return { run, parse, tokenize, Interp, repr, BUILTINS, TABLE_MSGS, PLATFORMS };
})();

/* ======================= Script window ======================= */
const ScriptWin = {
  open(name = 'Untitled Script', text = '') {
    const w = WM.create({ title: name, kind: 'script', w: 820, h: 560, icon: '<svg class="ic" viewBox="0 0 16 16"><rect x="2.5" y="1.5" width="11" height="13" fill="#fff" stroke="#777"/><path d="M5 5h6M5 8h4M5 11h5" stroke="#2f6bc6" stroke-width="1.2"/></svg>' });
    w.body.innerHTML = `<div class="sw">
      <div class="sw-bar"><button class="btn primary sw-run" title="Run script (Ctrl+R or Ctrl+Enter). If text is selected, only the selection runs.">&#9654; Run Script</button>
        <span class="small mut sw-hint">Ctrl+R runs the script, or only the selected text</span><span class="sw-sp"></span>
        <button class="btn sw-ex">Examples</button><button class="btn sw-save">Save .jsl</button></div>
      <div class="sw-ed"><pre class="sw-gut">1</pre><textarea class="sw-text" spellcheck="false" wrap="off"></textarea></div>
      <div class="sw-logh"><span>Log</span><button class="btn sm sw-clear">Clear</button></div>
      <div class="sw-log"></div></div>`;
    const ta = $('.sw-text', w.body), gut = $('.sw-gut', w.body), logEl = $('.sw-log', w.body);
    ta.value = text;
    const upd = () => { const n = ta.value.split('\n').length; gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gut.scrollTop = ta.scrollTop; };
    ta.addEventListener('input', upd); ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; }); upd();
    const log = (type, msg) => {
      if (type === 'clear') { logEl.innerHTML = ''; return; }
      logEl.insertAdjacentHTML('beforeend', `<div class="sw-l ${type}">${esc(msg)}</div>`);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const runIt = () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const src = sel.trim() ? sel : ta.value;
      log('cmd', `/* Running ${sel.trim() ? 'selection' : name} */`);
      try {
        const r = JSL.run(src, log);
        if (r.value !== undefined) log('out', JSL.repr(r.value));
        log('ok', `Script finished in ${r.ms.toFixed(0)} ms.${r.interp.tables.length ? ` New tables: ${r.interp.tables.map(t => t.name).join(', ')}.` : ''}${r.interp.reports.length ? ` Reports: ${r.interp.reports.length}.` : ''}`);
        status('Script finished');
      } catch (e) { console.error(e); log('err', 'Error: ' + e.message); status('Script error: ' + e.message); }
    };
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); runIt(); }
      else if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('    ', a, ta.selectionEnd, 'end'); upd(); }
    });
    $('.sw-run', w.body).addEventListener('click', runIt);
    $('.sw-clear', w.body).addEventListener('click', () => { logEl.innerHTML = ''; });
    $('.sw-save', w.body).addEventListener('click', () => download(name.endsWith('.jsl') ? name : name + '.jsl', ta.value, 'text/plain'));
    $('.sw-ex', w.body).addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect();
      UI.menu(Object.keys(JSL_EXAMPLES).map(k => ({ label: k, action: () => { ta.value = JSL_EXAMPLES[k]; upd(); } })), r.left, r.bottom);
    });
    w.runScript = runIt; w.textarea = ta;
    setTimeout(() => ta.focus(), 0);
    return w;
  },
};

const JSL_EXAMPLES = {
  'Stack three times (chained)': `// Uses the open "Class Survey" sample table
dt = Data Table( "Class Survey" );
dt_stack1 = dt << Stack(
    Columns( :height, :weight ),
    Source Label Column( "Label 1" ),
    Stacked Data Column( "HW" ),
    Output Table( "Stack 1" )
);
dt_stack2 = dt_stack1 << Stack(
    Columns( :age, :score ),
    Source Label Column( "Label 2" ),
    Stacked Data Column( "AS" ),
    Output Table( "Stack 2" )
);
Show( N Rows( dt_stack2 ) );`,
  'Analyses': `dt = Current Data Table();
Distribution( Continuous Distribution( Column( :height ), Normal Quantile Plot( 1 ), Fit Normal ), Nominal Distribution( Column( :sex ) ) );
Bivariate( Y( :weight ), X( :height ), Fit Line, Density Ellipse( 0.95 ) );
Oneway( Y( :height ), X( :sex ), Means/Anova, Box Plots( 1 ) );
Fit Model( Y( :weight ), Effects( :height, :sex, :height * :sex ), Personality( "Standard Least Squares" ), Run );`,
  'New column, formula, select': `dt = Current Data Table();
dt << New Column( "BMI", Numeric, Continuous, Formula( :weight / (:height ^ 2) * 703 ) );
dt << New Column( "Group", Character, Nominal, Formula( If( :age > 14, "Teen", "Child" ) ) );
dt << Select Where( :BMI > 20 );
Print( N Items( dt << Get Selected Rows ) );
For( i = 1, i <= 3, i++, Write( "Row ", i, ": ", :name[i], "\\!n" ) );`,
  'Summary, sort, graph': `dt = Current Data Table();
sum = dt << Summary( Group( :sex, :age ), Mean( :height ), Std Dev( :height ), Output Table( "Height by Sex and Age" ) );
sorted = dt << Sort( By( :height ), Order( Descending ), Output Table( "Sorted by height" ) );
Graph Builder( Variables( X( :height ), Y( :weight ), Overlay( :sex ) ), Elements( Points( X, Y ), Line Of Fit( X, Y ) ) );`,
};
