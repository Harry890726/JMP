'use strict';
/* Synthetic, deterministic sample data sets (all values generated here). */

const Samples = (() => {
  const r1 = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
  function build(name, cols, n, gen) {
    const t = new DataTable(name);
    const data = cols.map(() => []);
    for (let i = 0; i < n; i++) { const row = gen(i); cols.forEach((c, j) => data[j].push(row[j])); }
    cols.forEach((c, j) => t.columns.push({ name: c[0], dataType: c[1], modelingType: c[2], values: data[j], formula: null, levelOrder: c[3] }));
    t.rows = Array.from({ length: n }, DataTable.newRow);
    return t;
  }

  const NAMES = ['ALICE', 'BRANDON', 'CHLOE', 'DANIEL', 'EMMA', 'FELIX', 'GRACE', 'HENRY', 'IVY', 'JACK', 'KAREN', 'LEO', 'MIA', 'NOAH', 'OLIVIA',
    'PETER', 'QUINN', 'RYAN', 'SOPHIE', 'THOMAS', 'UMA', 'VICTOR', 'WENDY', 'XAVIER', 'YVONNE', 'ZACK', 'AMY', 'BEN', 'CLARA', 'DAVID',
    'ELLA', 'FRANK', 'GINA', 'HUGO', 'IRIS', 'JOEL', 'KATE', 'LIAM', 'MAYA', 'NATE'];

  const defs = {
    'Class Survey': () => {
      const R = rng(11);
      return build('Class Survey', [['name', 'character', 'nominal'], ['age', 'numeric', 'ordinal'], ['sex', 'character', 'nominal'],
        ['height', 'numeric', 'continuous'], ['weight', 'numeric', 'continuous'], ['score', 'numeric', 'continuous']], 40, i => {
          const sex = i % 2 === 0 ? 'F' : 'M';
          const age = 12 + Math.floor(R() * 6);
          const h = r1(50 + 2.1 * (age - 12) + (sex === 'M' ? 1.8 : 0) + R.normal(0, 2.4));
          const w = r1(-150 + 4.1 * h + R.normal(0, 11));
          const s = r1(Math.min(100, 62 + 2.5 * (age - 12) + R.normal(0, 9)));
          return [NAMES[i], age, sex, h, w, s];
        });
    },
    'Flowers': () => {
      const R = rng(23); const sp = ['setosa', 'versicolor', 'virginica'];
      const mu = [[5.0, 3.4, 1.5, 0.25], [5.9, 2.8, 4.3, 1.3], [6.6, 3.0, 5.6, 2.0]];
      const sd = [[0.35, 0.38, 0.17, 0.1], [0.5, 0.31, 0.47, 0.2], [0.63, 0.32, 0.55, 0.27]];
      return build('Flowers', [['Sepal length', 'numeric', 'continuous'], ['Sepal width', 'numeric', 'continuous'],
        ['Petal length', 'numeric', 'continuous'], ['Petal width', 'numeric', 'continuous'], ['Species', 'character', 'nominal']], 150, i => {
          const g = Math.floor(i / 50); const z = R.normal();
          const v = mu[g].map((m, j) => r1(Math.max(0.1, m + sd[g][j] * (0.6 * z + 0.8 * R.normal())), 1));
          return [...v, sp[g]];
        });
    },
    'Cars': () => {
      const R = rng(5); const origins = ['Asia', 'Europe', 'USA'];
      return build('Cars', [['Model year', 'numeric', 'ordinal'], ['Origin', 'character', 'nominal'], ['Cylinders', 'numeric', 'ordinal'],
        ['Displacement', 'numeric', 'continuous'], ['Horsepower', 'numeric', 'continuous'], ['Weight', 'numeric', 'continuous'],
        ['Acceleration', 'numeric', 'continuous'], ['MPG', 'numeric', 'continuous']], 120, i => {
          const o = origins[i % 3];
          const cyl = o === 'USA' ? R.pick([4, 6, 6, 8, 8]) : R.pick([4, 4, 4, 6]);
          const disp = r1(cyl * 36 + R.normal(0, 18));
          const hp = r1(20 + disp * 0.42 + R.normal(0, 10));
          const wt = r1(1500 + disp * 6.2 + R.normal(0, 180));
          const yr = 2010 + Math.floor(R() * 10);
          const acc = r1(22 - hp * 0.045 + R.normal(0, 1.3), 1);
          const mpg = r1(Math.max(9, 52 - wt * 0.0068 + (yr - 2010) * 0.6 + R.normal(0, 2.6)), 1);
          return [yr, o, cyl, disp, hp, wt, acc, mpg];
        });
    },
    'Process Monitoring': () => {
      const R = rng(9); const types = ['Scratch', 'Dent', 'Crack', 'Stain', 'Misalignment', 'Other'];
      const tw = [0.36, 0.22, 0.12, 0.14, 0.1, 0.06];
      return build('Process Monitoring', [['Sample', 'numeric', 'ordinal'], ['Operator', 'character', 'nominal'], ['Machine', 'character', 'nominal'],
        ['Temperature', 'numeric', 'continuous'], ['Pressure', 'numeric', 'continuous'], ['Thickness', 'numeric', 'continuous'],
        ['Defects', 'numeric', 'continuous'], ['Defect Type', 'character', 'nominal']], 100, i => {
          const sample = Math.floor(i / 4) + 1;
          const temp = r1(180 + R.normal(0, 4), 1); const pres = r1(32 + R.normal(0, 1.5), 2);
          const shift = sample > 20 ? 0.18 : 0;
          const th = r1(10 + shift + 0.012 * (temp - 180) + R.normal(0, 0.09), 3);
          let u = R(), k = 0; while (k < tw.length - 1 && u > tw[k]) { u -= tw[k]; k++; }
          return [sample, ['Lin', 'Chen', 'Wang'][i % 3], ['M1', 'M2'][Math.floor(i / 2) % 2], temp, pres, th, R.poisson(2.2 + (temp - 180) * 0.08), types[k]];
        });
    },
    'Customer Survey': () => {
      const R = rng(31); const regions = ['North', 'South', 'East', 'West'];
      const ages = ['18-29', '30-44', '45-59', '60+'];
      return build('Customer Survey', [['ID', 'numeric', 'continuous'], ['Region', 'character', 'nominal'], ['Age group', 'character', 'ordinal'],
        ['Gender', 'character', 'nominal'], ['Channel', 'character', 'nominal'], ['Satisfaction', 'numeric', 'ordinal'],
        ['Spend', 'numeric', 'continuous'], ['Recommend', 'character', 'nominal']], 300, i => {
          const reg = R.pick(regions); const ag = R.pick(ages); const g = R() < 0.52 ? 'Female' : 'Male';
          const ch = R() < 0.45 + ages.indexOf(ag) * -0.08 ? 'Online' : 'Store';
          const sat = Math.max(1, Math.min(5, Math.round(3.4 + (reg === 'West' ? 0.5 : reg === 'South' ? -0.4 : 0) + R.normal(0, 0.95))));
          const spend = r1(Math.exp(4 + 0.12 * sat + 0.15 * ages.indexOf(ag) + R.normal(0, 0.45)), 2);
          const rec = R() < 1 / (1 + Math.exp(-(sat - 3.2) * 1.5)) ? 'Yes' : 'No';
          return [i + 1, reg, ag, g, ch, sat, spend, rec];
        });
    },
    'Drug Trial': () => {
      const R = rng(77); const tr = ['Placebo', 'Low dose', 'High dose'];
      return build('Drug Trial', [['Patient', 'numeric', 'continuous'], ['Treatment', 'character', 'nominal', tr], ['Sex', 'character', 'nominal'],
        ['Age', 'numeric', 'continuous'], ['Baseline BP', 'numeric', 'continuous'], ['Final BP', 'numeric', 'continuous'], ['Improved', 'character', 'nominal']], 90, i => {
          const t = tr[i % 3]; const age = Math.round(35 + R() * 40);
          const base = r1(140 + 0.35 * (age - 55) + R.normal(0, 9));
          const eff = [0, 6, 13][i % 3];
          const fin = r1(base - eff - 2 + R.normal(0, 7));
          return [i + 1, t, R() < 0.5 ? 'F' : 'M', age, base, fin, base - fin > 8 ? 'Yes' : 'No'];
        });
    },
  };
  return { names: Object.keys(defs), get: n => defs[n]() };
})();
