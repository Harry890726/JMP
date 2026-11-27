'use strict';
/* Excel workbook import/export with formula translation in both directions.
   Export: formula columns are written as live Excel formulas (with cached values).
   Import: a column whose cells all hold formulas becomes a formula column when the
   translated formula reproduces Excel's cached values; otherwise the values are kept. */

const Excel = (() => {
  const ready = () => typeof XLSX !== 'undefined';
  const colLetter = c => XLSX.utils.encode_col(c);
  const norm = s => String(s).toLowerCase().replace(/\s+/g, '');

  // ---------------- table formula -> Excel ----------------
  function toExcel(t, text, r, n) {
    let ast;
    try { ast = JSL.parse(text); } catch (e) { return null; }
    const ref = name => { const ci = t.colIndex(name); if (ci < 0) throw new Error('col'); return ci; };
    const cell = (ci, row) => `${colLetter(ci)}${row + 2}`;
    const range = ci => `$${colLetter(ci)}$2:$${colLetter(ci)}$${n + 1}`;
    const colName = node => { if (node.k === 'col') return node.name; if (node.k === 'str') return node.v; throw new Error('colname'); };
    const isBool = node => (node.k === 'bin' && ['==', '!=', '<', '>', '<=', '>=', '&', '|'].includes(node.op)) || (node.k === 'assign' && node.op === '=') || (node.k === 'un' && node.op === '!');
    const E = node => {
      switch (node.k) {
        case 'num': return String(node.v);
        case 'str': return '"' + node.v.replace(/"/g, '""') + '"';
        case 'col': return cell(ref(node.nameExpr ? '' : node.name), r);
        case 'glue': return E(node.list[node.list.length - 1]);
        case 'un': return node.op === '-' ? `-(${E(node.a)})` : `NOT(${E(node.a)})`;
        case 'assign': if (node.op === '=') return `(${E(node.target)}=${E(node.value)})`; throw new Error('assign');
        case 'bin': {
          const a = E(node.a), b = E(node.b);
          switch (node.op) {
            case '==': return `(${a}=${b})`; case '!=': return `(${a}<>${b})`;
            case '&': return `AND(${a},${b})`; case '|': return `OR(${a},${b})`; case '||': return `(${a}&${b})`;
            default: return `(${a}${node.op}${b})`;
          }
        }
        case 'name': { const k = norm(node.name); if (k === 'pi') return 'PI()'; if (k === 'row') return `(ROW()-1)`; if (k === 'nrow' || k === 'nrows') return String(n); throw new Error('name'); }
        case 'call': {
          const k = norm(node.name), A = node.args, a = i => E(A[i]);
          const agg = f => `${f}(${range(ref(colName(A[0])))})`;
          switch (k) {
            case 'if': { let s = A.length % 2 ? a(A.length - 1) : '""'; for (let i = A.length - (A.length % 2 ? 3 : 2); i >= 0; i -= 2) s = `IF(${a(i)},${a(i + 1)},${s})`; return s; }
            case 'log': return `LN(${a(0)})`; case 'log10': return `LOG10(${a(0)})`; case 'exp': return `EXP(${a(0)})`; case 'sqrt': return `SQRT(${a(0)})`; case 'abs': return `ABS(${a(0)})`;
            case 'round': return `ROUND(${a(0)},${A[1] ? a(1) : 0})`; case 'floor': return `INT(${a(0)})`; case 'ceiling': return `-INT(-(${a(0)}))`;
            case 'power': return `POWER(${a(0)},${a(1)})`; case 'modulo': return `MOD(${a(0)},${a(1)})`; case 'sin': return `SIN(${a(0)})`; case 'cos': return `COS(${a(0)})`; case 'tan': return `TAN(${a(0)})`;
            case 'row': return '(ROW()-1)'; case 'nrow': return String(n); case 'pi': return 'PI()';
            case 'mean': return `AVERAGE(${A.map(E).join(',')})`; case 'sum': return `SUM(${A.map(E).join(',')})`; case 'min': return `MIN(${A.map(E).join(',')})`; case 'max': return `MAX(${A.map(E).join(',')})`;
            case 'ismissing': return `IF(LEN(${a(0)}&"")=0,1,0)`;
            case 'randomnormal': return `NORM.INV(RAND(),${A[0] ? a(0) : 0},${A[1] ? a(1) : 1})`;
            case 'randomuniform': return A.length ? `(${a(0)}+(${a(1)}-${a(0)})*RAND())` : 'RAND()';
            case 'randominteger': return `RANDBETWEEN(${a(0)},${a(1)})`;
            case 'colmean': return agg('AVERAGE'); case 'colstddev': return agg('STDEV'); case 'colsum': return agg('SUM'); case 'colmin': return agg('MIN'); case 'colmax': return agg('MAX');
            case 'colmedian': return agg('MEDIAN'); case 'colnumber': return agg('COUNT');
            case 'lag': { const ci = ref(colName(A[0])); const k2 = A[1] ? Number(E(A[1])) : 1; if (r - k2 < 0) throw new Error('lag'); return cell(ci, r - k2); }
            case 'concat': return `(${A.map(E).join('&')})`; case 'char': return `(${a(0)}&"")`; case 'num': return `VALUE(${a(0)})`;
            case 'uppercase': return `UPPER(${a(0)})`; case 'lowercase': return `LOWER(${a(0)})`; case 'length': return `LEN(${a(0)})`;
            case 'substr': return `MID(${a(0)},${a(1)},${A[2] ? a(2) : `LEN(${a(0)})`})`;
            case 'contains': return `IF(ISNUMBER(FIND(${a(1)},${a(0)})),1,0)`;
          }
          throw new Error('fn');
        }
      }
      throw new Error('node');
    };
    try { const s = E(ast); return isBool(ast) ? `IF(${s},1,0)` : s; } catch (e) { return null; }
  }

  // ---------------- Excel -> table formula ----------------
  function tokenize(f) {
    const toks = []; let i = 0;
    while (i < f.length) {
      const c = f[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') { let j = i + 1, s = ''; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } toks.push({ t: 'str', v: s }); i = j + 1; continue; }
      if (c === "'" || /[A-Za-z_]/.test(c) && /^[A-Za-z_][\w.]*!/.test(f.slice(i))) return null; // other-sheet references
      let m;
      if ((m = /^\$?([A-Z]{1,3})\$?(\d+)(:\$?([A-Z]{1,3})\$?(\d+))?/.exec(f.slice(i))) && !/^[A-Z]{1,3}\d*\(/.test(f.slice(i))) {
        const absRow = /^\$?[A-Z]{1,3}\$/.test(m[0]);
        toks.push(m[3] ? { t: 'range', c1: XLSX.utils.decode_col(m[1]), r1: +m[2], c2: XLSX.utils.decode_col(m[4]), r2: +m[5] } : { t: 'ref', c: XLSX.utils.decode_col(m[1]), r: +m[2], abs: absRow });
        i += m[0].length; continue;
      }
      if ((m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(f.slice(i)))) { toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if ((m = /^(_xlfn\.)?([A-Za-z][A-Za-z0-9.]*)/.exec(f.slice(i)))) { toks.push({ t: 'name', v: m[2].toUpperCase() }); i += m[0].length; continue; }
      const op = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', ',', '%'].find(o => f.startsWith(o, i));
      if (!op) return null;
      toks.push({ t: 'op', v: op }); i += op.length;
    }
    return toks;
  }
  function parseExcel(f) {
    const T = tokenize(f); if (!T) return null; let i = 0;
    const is = v => T[i] && T[i].t === 'op' && T[i].v === v;
    const bin = (next, ops) => { let a = next(); while (ops.some(is)) { const op = T[i++].v; a = { k: 'bin', op, a, b: next() }; } return a; };
    const cmp = () => bin(cat, ['=', '<>', '<=', '>=', '<', '>']);
    const cat = () => bin(add, ['&']);
    const add = () => bin(mul, ['+', '-']);
    const mul = () => bin(pow, ['*', '/']);
    const pow = () => bin(un, ['^']);
    const un = () => { if (is('-')) { i++; return { k: 'neg', a: un() }; } if (is('+')) { i++; return un(); } return pct(); };
    const pct = () => { let a = prim(); while (is('%')) { i++; a = { k: 'bin', op: '/', a, b: { k: 'num', v: 100 } }; } return a; };
    const prim = () => {
      const k = T[i++]; if (!k) throw new Error('eof');
      if (k.t === 'num' || k.t === 'str' || k.t === 'ref' || k.t === 'range') return k;
      if (k.t === 'name') {
        if (is('(')) { i++; const args = []; while (!is(')')) { if (is(',')) { i++; continue; } args.push(cmp()); } i++; return { k: 'call', name: k.v, args }; }
        if (k.v === 'TRUE') return { t: 'num', v: 1 }; if (k.v === 'FALSE') return { t: 'num', v: 0 };
        throw new Error('name');
      }
      if (k.t === 'op' && k.v === '(') { const e = cmp(); if (!is(')')) throw new Error(')'); i++; return e; }
      throw new Error('tok');
    };
    try { const e = cmp(); return i === T.length ? e : null; } catch (e) { return null; }
  }
  /** cols: sheet column index -> table column name; row: sheet row (1-based) of this cell; first/last: data row range */
  function fromExcel(f, cols, row, first, last) {
    const ast = parseExcel(f); if (!ast) return null;
    const q = s => `:${JSON.stringify(s)}`;
    const colOf = c => { const nm = cols.get(c); if (nm === undefined) throw new Error('col'); return nm; };
    const fullCol = x => x.t === 'range' && x.c1 === x.c2 && x.r1 === first && x.r2 === last;
    const F = x => {
      if (x.t === 'num' || x.k === 'num') return String(x.v);
      if (x.t === 'str') return JSON.stringify(x.v);
      if (x.t === 'ref') { const nm = colOf(x.c); if (x.r === row) return q(nm); if (x.r < row && !x.abs) return `Lag(${q(nm)}, ${row - x.r})`; throw new Error('ref'); }
      if (x.t === 'range') throw new Error('range');
      if (x.k === 'neg') return `(-${F(x.a)})`;
      if (x.k === 'bin') {
        const a = F(x.a), b = F(x.b);
        if (x.op === '&') return `Concat(${a}, ${b})`; if (x.op === '=') return `(${a} == ${b})`; if (x.op === '<>') return `(${a} != ${b})`;
        return `(${a} ${x.op} ${b})`;
      }
      if (x.k === 'call') {
        const A = x.args, a = j => F(A[j]), all = () => A.map(F).join(', ');
        const agg = name => { if (A.length === 1 && fullCol(A[0])) return `${name}(${q(colOf(A[0].c1))})`; throw new Error('agg'); };
        switch (x.name) {
          case 'IF': return `If(${a(0)}, ${A[1] ? a(1) : 1}, ${A[2] ? a(2) : 0})`;
          case 'LN': return `Log(${a(0)})`; case 'LOG10': return `Log10(${a(0)})`; case 'LOG': if (A.length === 1) return `Log10(${a(0)})`; return `(Log(${a(0)}) / Log(${a(1)}))`;
          case 'EXP': return `Exp(${a(0)})`; case 'SQRT': return `Sqrt(${a(0)})`; case 'ABS': return `Abs(${a(0)})`;
          case 'ROUND': return `Round(${a(0)}, ${A[1] ? a(1) : 0})`; case 'INT': return `Floor(${a(0)})`; case 'POWER': return `Power(${a(0)}, ${a(1)})`; case 'MOD': return `Modulo(${a(0)}, ${a(1)})`;
          case 'SIN': return `Sin(${a(0)})`; case 'COS': return `Cos(${a(0)})`; case 'TAN': return `Tan(${a(0)})`; case 'PI': return 'Pi()';
          case 'ROW': if (!A.length) return `(Row() + ${first - 1})`; throw new Error('row');
          case 'UPPER': return `Uppercase(${a(0)})`; case 'LOWER': return `Lowercase(${a(0)})`; case 'LEN': return `Length(${a(0)})`;
          case 'MID': return `Substr(${a(0)}, ${a(1)}, ${a(2)})`; case 'CONCATENATE': case 'CONCAT': return `Concat(${all()})`; case 'VALUE': return `Num(${a(0)})`;
          case 'AND': return '(' + A.map(F).join(' & ') + ')'; case 'OR': return '(' + A.map(F).join(' | ') + ')'; case 'NOT': return `(!${a(0)})`;
          case 'AVERAGE': if (A.length === 1 && A[0].t === 'range') return agg('ColMean'); return `Mean(${all()})`;
          case 'SUM': if (A.length === 1 && A[0].t === 'range') return agg('ColSum'); return `Sum(${all()})`;
          case 'MIN': if (A.length === 1 && A[0].t === 'range') return agg('ColMin'); return `Min(${all()})`;
          case 'MAX': if (A.length === 1 && A[0].t === 'range') return agg('ColMax'); return `Max(${all()})`;
          case 'STDEV': case 'STDEV.S': return agg('ColStdDev'); case 'MEDIAN': return agg('ColMedian'); case 'COUNT': return agg('ColNumber');
          case 'RAND': return 'RandomUniform()'; case 'RANDBETWEEN': return `RandomInteger(${a(0)}, ${a(1)})`;
          case 'NORM.INV': case 'NORMINV': if (A[0].k === 'call' && A[0].name === 'RAND') return `RandomNormal(${a(1)}, ${a(2)})`; throw new Error('fn');
        }
        throw new Error('fn');
      }
      throw new Error('node');
    };
    try { return F(ast); } catch (e) { return null; }
  }

  // ---------------- import ----------------
  function readWorkbook(buf, fileName) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellFormula: true });
    const base = fileName.replace(/\.[^.]+$/, '');
    const out = [];
    const sheets = wb.SheetNames.filter(sn => !wb.Sheets[sn] || wb.Sheets[sn]['!ref']);
    for (const sn of sheets) {
      const ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) throw new Error(`Sheet "${sn}" could not be read`);
      const rng = XLSX.utils.decode_range(ws['!ref']);
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      const keep = all.map((r, i) => i).filter(i => all[i].some(c => c !== null && c !== undefined && String(c).trim() !== ''));
      if (!keep.length) continue;
      const rows = keep.map(i => all[i]);
      const t = DataTable.fromRows(rows, sheets.length === 1 ? base : `${base} - ${sn}`);
      t.sourceFile = base; t.sheetName = sn;
      // formula columns
      const sheetRow = i => rng.s.r + keep[i + 1] + 1; // 1-based sheet row of body row i
      const cols = new Map(t.columns.map((c, ci) => [rng.s.c + ci, c.name]));
      const first = sheetRow(0), last = sheetRow(t.nrows - 1);
      let nf = 0;
      t.columns.forEach((c, ci) => {
        const sc = rng.s.c + ci;
        const fs = []; for (let i = 0; i < t.nrows; i++) { const cl = ws[XLSX.utils.encode_cell({ r: sheetRow(i) - 1, c: sc })]; fs.push(cl && cl.f ? cl.f : null); }
        if (!fs.length || fs.filter(Boolean).length < Math.max(1, Math.ceil(fs.length / 2))) return;
        // shape of a formula relative to its own row, e.g. C3-C2 at row 3 -> C{0}-C{-1}
        const shape = (f, row) => f.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (m, c, abs, r) => abs ? m : `${c}{${+r - row}}`);
        const shapes = fs.map((f, i) => f ? shape(f, sheetRow(i)) : null);
        const counts = new Map(); shapes.forEach(x => { if (x !== null) counts.set(x, (counts.get(x) || 0) + 1); });
        const main = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
        const k = shapes.indexOf(main);
        const text = fromExcel(fs[k], cols, sheetRow(k), first, last);
        if (!text) { t.notes = (t.notes || '') + `Column "${c.name}": formula kept as values (=${fs[k]}). `; return; }
        // verify the translated formula reproduces Excel's cached values
        try {
          const fn = Formula.compile(t, text);
          const ok = t.columns[ci].values.every((v, r) => {
            let x; try { x = fn(r); } catch (e) { x = NaN; } if (typeof x === 'boolean') x = +x;
            const xMiss = x === '' || (typeof x === 'number' && isNaN(x));
            if (shapes[r] !== main) return xMiss && (v === '' || (typeof v === 'number' && isNaN(v)));
            if (typeof v === 'number' && isNaN(v)) return xMiss;
            if (typeof v === 'number') return typeof x === 'number' && Math.abs(x - v) <= 1e-9 * Math.max(1, Math.abs(v));
            return String(x) === String(v);
          });
          const volatile = /Random/.test(text);
          if (ok || volatile) { c.formula = text; nf++; }
          else t.notes = (t.notes || '') + `Column "${c.name}": formula kept as values (=${fs[k]}). `;
        } catch (e) { /* keep values */ }
      });
      t.recalc();
      t.formulaCount = nf;
      out.push(t);
    }
    return out;
  }

  // ---------------- export ----------------
  function sheetFor(t) {
    const n = t.nrows;
    const aoa = [t.columns.map(c => c.name), ...Array.from({ length: n }, (_, r) => t.columns.map(c => { const v = c.values[r]; return DataTable.isMissing(v) ? null : v; }))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    let nf = 0, skipped = [];
    t.columns.forEach((c, ci) => {
      if (!c.formula) return;
      const fs = Array.from({ length: n }, (_, r) => toExcel(t, c.formula, r, n));
      if (fs.filter(Boolean).length < Math.max(1, Math.ceil(n / 2))) { skipped.push(c.name); return; }
      fs.forEach((f, r) => {
        if (!f) return; // that row keeps its plain value
        const addr = XLSX.utils.encode_cell({ r: r + 1, c: ci });
        const v = c.values[r];
        ws[addr] = DataTable.isMissing(v) ? { t: 's', v: '', f } : { t: typeof v === 'number' ? 'n' : 's', v, f };
      });
      nf++;
    });
    ws['!cols'] = t.columns.map(c => ({ wch: Math.min(40, Math.max(8, c.name.length + 2)) }));
    return { ws, nf, skipped };
  }
  const safeSheet = (s, used) => { let n = String(s).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet'; let k = 2; while (used.has(n)) n = n.slice(0, 28) + ' ' + k++; used.add(n); return n; };
  function workbook(tables) {
    const wb = XLSX.utils.book_new(); const used = new Set(); const info = [];
    for (const t of tables) { const s = sheetFor(t); XLSX.utils.book_append_sheet(wb, s.ws, safeSheet(t.name, used)); info.push({ t, ...s }); }
    return { data: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), info };
  }
  function save(tables, fileName) {
    if (!ready()) return UI.alert('The Excel library could not be loaded (it needs an internet connection the first time). Use Save As CSV instead.', 'Excel unavailable');
    const { data, info } = workbook(tables);
    download(fileName, new Uint8Array(data), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const nf = info.reduce((a, x) => a + x.nf, 0), sk = info.flatMap(x => x.skipped);
    status(`Saved ${fileName}: ${tables.length} sheet(s)${nf ? `, ${nf} formula column(s) kept as Excel formulas` : ''}${sk.length ? `; saved as values only: ${sk.join(', ')}` : ''}`);
    return info;
  }
  return { ready, readWorkbook, save, workbook, toExcel, fromExcel };
})();
