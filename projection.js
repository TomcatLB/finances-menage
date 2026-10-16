/*
 * Net-worth projection, one step per year, with a Monte Carlo spread of market returns.
 * Pure functions: the page passes in today's numbers (from calc.js and the data) and the assumptions.
 *
 * Model (kept simple on purpose, every simplification is listed in the page's footnote):
 *  - Work income (Budget, already net of tax) grows with each person's raise and stops at retirement.
 *  - Family allowances stop when the youngest child turns 18; a child's own expenses stop at 18 and grow
 *    at the "kids" rate; other spending grows with inflation. "Épargne et placements" lines are savings, not spending.
 *  - Debts follow their payment schedule; once a debt is paid off its payment becomes savings.
 *  - Each year's surplus is invested; a shortfall is taken from the investments (grossed up for tax in retirement).
 *  - Retirement: RRQ from the retirement age (−0.6 %/month before 65, +0.7 %/month after, ages 60–72),
 *    PSV from 65, both indexed and taxed at an average rate; spending drops to a share of the working-years level.
 *  - Real estate grows at its own rate, vehicles lose 15 % a year, pension funds grow at the market return,
 *    bank accounts and other assets stay flat. RESP holdings grow and are spent when the child turns 18.
 *  - Market returns are lognormal with the given mean and standard deviation, same draw for all investments.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    ret: 6, sd: 12, infl: 2.4, realEstate: 4, raise_p1: 2.5, raise_p2: 2.5, kids: 3, endYear: null,
    birth_p1: null, birth_p2: null, retire_p1: 65, retire_p2: 65, rrq_p1: 900, rrq_p2: 900, psv: 762, // PSV max 65–74, Oct–Dec 2026
    retireSpend: 80, retireTax: 20, runs: 500,
  };

  /** Small seeded generator so the chart does not jump on every redraw. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** RRQ adjustment for starting at `age` instead of 65. */
  function rrqFactor(age) {
    const a = Math.min(72, Math.max(60, age));
    const months = (a - 65) * 12;
    return months < 0 ? 1 + months * 0.006 : 1 + months * 0.007;
  }

  /**
   * start: {
   *   year, invested, resp: [{ value, endYear }], realEstate, vehicles, pension, flat,
   *   debts: [{ balance, payment (per period), periods (per year), rate (per period) }],
   *   incomes: [{ annual, owner: 'p1'|'p2'|'joint', kind: 'work'|'allowance'|'other' }],
   *   expenses: [{ annual, kind: 'regular'|'child', endYear }],
   *   projects: [{ year, amount }],
   *   lastChildYear (year the youngest turns 18) }
   * a: assumptions (DEFAULTS shape, percents as numbers like 6 for 6 %).
   * returns: array of per-year market returns, or null for the expected return every year.
   */
  function simulate(start, a, returns) {
    const out = [];
    const y0 = start.year, y1 = a.endYear;
    let invested = start.invested, realEstate = start.realEstate, vehicles = start.vehicles, pension = start.pension;
    const resp = start.resp.map((r) => ({ ...r }));
    const debts = start.debts.map((d) => ({ ...d }));
    const infl = a.infl / 100;
    let depleted = null;
    for (let y = y0; y <= y1; y++) {
      const t = y - y0;
      const r = returns ? returns[t] : a.ret / 100;
      const age = { p1: a.birth_p1 ? y - a.birth_p1 : null, p2: a.birth_p2 ? y - a.birth_p2 : null };
      const retired = { p1: age.p1 !== null && age.p1 >= a.retire_p1, p2: age.p2 !== null && age.p2 >= a.retire_p2 };
      const anyRetired = retired.p1 || retired.p2;
      const allRetired = retired.p1 && retired.p2;
      const g = (rate) => Math.pow(1 + rate / 100, t);

      // Income (net) and pensions (taxed here)
      let work = 0;
      for (const inc of start.incomes) {
        if (inc.kind === 'allowance') { if (start.lastChildYear === null || y <= start.lastChildYear) work += inc.annual * Math.pow(1 + infl, t); continue; }
        if (inc.kind === 'other') { work += inc.annual * Math.pow(1 + infl, t); continue; }
        const parts = inc.owner === 'joint' ? [['p1', 0.5], ['p2', 0.5]] : [[inc.owner, 1]];
        for (const [p, f] of parts) if (!retired[p]) work += inc.annual * f * g(a['raise_' + p]);
      }
      let pensions = 0;
      for (const p of ['p1', 'p2']) {
        if (age[p] === null) continue;
        const rrqStart = Math.min(72, Math.max(60, a['retire_' + p])); // RRQ can start between 60 and 72
        if (age[p] >= rrqStart) pensions += a['rrq_' + p] * 12 * rrqFactor(rrqStart) * Math.pow(1 + infl, t);
        if (age[p] >= 65) pensions += a.psv * 12 * Math.pow(1 + infl, t);
      }
      const pensionsNet = pensions * (1 - a.retireTax / 100);

      // Spending
      let spend = 0;
      for (const e of start.expenses) {
        if (e.endYear !== null && e.endYear !== undefined && y > e.endYear) continue;
        spend += e.annual * (e.kind === 'child' ? g(a.kids) : Math.pow(1 + infl, t));
      }
      if (allRetired) spend *= a.retireSpend / 100;
      let debtPaid = 0, debtLeft = 0;
      for (const d of debts) {
        if (d.balance <= 0) continue;
        for (let k = 0; k < d.periods; k++) {
          if (d.balance <= 0) break;
          const interest = d.balance * d.rate;
          const pay = Math.min(d.payment, d.balance + interest);
          d.balance = d.balance + interest - pay;
          debtPaid += pay;
          if (d.payment <= interest) break; // payment does not cover interest: stop the loop, balance grows
        }
        if (d.balance < 0.5) d.balance = 0;
        debtLeft += d.balance;
      }
      const projectSpend = start.projects.filter((p) => p.year === y).reduce((s, p) => s + p.amount, 0);

      // Cash flow → investments
      const surplus = work + pensionsNet - spend - debtPaid - projectSpend;
      if (surplus >= 0) invested += surplus;
      else invested -= -surplus / (anyRetired ? 1 - a.retireTax / 100 : 1);
      if (invested < 0) { if (depleted === null) depleted = y; invested = 0; }
      invested *= 1 + r;
      pension *= 1 + r;
      let respTotal = 0;
      for (const rp of resp) { if (y >= rp.endYear) rp.value = 0; else rp.value *= 1 + r; respTotal += rp.value; }
      realEstate *= 1 + a.realEstate / 100;
      vehicles *= 0.85;
      const assets = invested + pension + respTotal + realEstate + vehicles + start.flat;
      out.push({ year: y, age, invested, netWorth: assets - debtLeft, debt: debtLeft, realEstate, work, pensions: pensionsNet, spend, debtPaid, surplus, retired: { ...retired } });
    }
    return { rows: out, depleted };
  }

  const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

  /** Central path (expected return every year) and the spread across many random paths. */
  function project(start, assumptions, seed = 42) {
    const a = { ...DEFAULTS, ...assumptions };
    if (!a.endYear) a.endYear = start.year + 25;
    const central = simulate(start, a, null);
    const years = central.rows.length;
    const m = a.ret / 100, sd = a.sd / 100;
    const s2 = Math.log(1 + (sd * sd) / ((1 + m) * (1 + m)));
    const mu = Math.log(1 + m) - s2 / 2, s = Math.sqrt(s2);
    const rand = rng(seed);
    const runs = Math.max(50, Math.min(2000, a.runs | 0));
    const nw = Array.from({ length: years }, () => []);
    const inv = Array.from({ length: years }, () => []);
    let failures = 0;
    for (let k = 0; k < runs; k++) {
      const returns = Array.from({ length: years }, () => Math.exp(mu + s * normal(rand)) - 1);
      const sim = simulate(start, a, sd > 0 ? returns : null);
      if (sim.depleted !== null) failures++;
      sim.rows.forEach((row, i) => { nw[i].push(row.netWorth); inv[i].push(row.invested); });
    }
    const band = central.rows.map((row, i) => {
      const n = nw[i].sort((x, y) => x - y), v = inv[i].sort((x, y) => x - y);
      return { year: row.year, nwLow: pct(n, 0.1), nwMid: pct(n, 0.5), nwHigh: pct(n, 0.9), invLow: pct(v, 0.1), invMid: pct(v, 0.5), invHigh: pct(v, 0.9) };
    });
    return { a, central: central.rows, depleted: central.depleted, band, success: 1 - failures / runs, runs };
  }

  const api = { DEFAULTS, rrqFactor, simulate, project, rng };
  root.Projection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
