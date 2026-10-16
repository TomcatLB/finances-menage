/*
 * Finances du ménage — pure calculations shared by the web page and the tests.
 * scripts/update_prices.py implements the same snapshot formula in Python;
 * keep the two in step (tests/parity_test.mjs compares them).
 */
(function (root) {
  'use strict';

  const AUTO_MARKETS = ['TSX', 'TSXV', 'NEO', 'US'];

  const FREQS = {
    monthly: { label: 'Mensuel', n: 12 },
    semimonthly: { label: '2 fois par mois', n: 24 },
    biweekly: { label: 'Aux 2 semaines', n: 26 },
    weekly: { label: 'Hebdomadaire', n: 52 },
    yearly: { label: 'Annuel', n: 1 },
  };

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function priceKey(h) {
    return `${h.market}:${String(h.symbol || '').trim().toUpperCase()}`;
  }

  /** Share of an item counted for a view: 'all', 'p1' or 'p2'. Joint items count 50/50. */
  function share(owner, who) {
    if (who === 'all') return 1;
    const o = owner || 'joint';
    if (o === who) return 1;
    if (o === 'joint') return 0.5;
    return 0;
  }

  function usdcad(prices) {
    const fx = prices['FX:USDCAD'];
    return fx && Number.isFinite(Number(fx.close)) && Number(fx.close) > 0 ? Number(fx.close) : null;
  }

  /**
   * Value one holding in CAD.
   * src: 'close' (daily close), 'manual', 'cash', or 'cost' (no price yet: valued at cost).
   * mv is null when the holding is in USD and no USD/CAD rate is available.
   */
  function valueHolding(h, prices) {
    const qty = num(h.qty);
    const cost = num(h.avg_cost);
    let px, prev = null, date = null, src;
    if (h.market === 'CASH') {
      px = 1; prev = 1; src = 'cash';
    } else if (h.market === 'MANUAL') {
      if (h.manual_price !== null && h.manual_price !== undefined && h.manual_price !== '') {
        px = num(h.manual_price); date = h.manual_price_date || null; src = 'manual';
      } else {
        px = cost; src = 'cost';
      }
    } else {
      const p = prices[priceKey(h)];
      if (p && Number.isFinite(Number(p.close))) {
        px = Number(p.close);
        prev = p.prev_close === null || p.prev_close === undefined ? null : Number(p.prev_close);
        date = p.price_date || null;
        src = 'close';
      } else {
        px = cost; src = 'cost';
      }
    }
    const rate = h.currency === 'USD' ? usdcad(prices) : 1;
    if (rate === null) {
      return { mv: null, cost: null, day: null, px, prev, date, src, rate: null, qty };
    }
    const mv = qty * px * rate;
    const book = h.market === 'CASH' ? mv : qty * cost * rate;
    const day = prev !== null && src === 'close' ? qty * (px - prev) * rate : 0;
    return { mv, cost: book, day, px, prev, date, src, rate, qty };
  }

  function totals(data, who) {
    const prices = data.prices || {};
    let inv = 0, oth = 0, debt = 0, missing = 0;
    for (const h of data.holdings || []) {
      const s = share(h.owner, who);
      if (!s) continue;
      const v = valueHolding(h, prices);
      if (v.mv === null) { missing += 1; continue; }
      inv += v.mv * s;
    }
    for (const a of data.assets || []) oth += num(a.value) * share(a.owner, who);
    for (const d of data.debts || []) debt += num(d.balance) * share(d.owner, who);
    return { inv, oth, debt, net: inv + oth - debt, missing };
  }

  // Round half away from zero to the cent; update_prices.py uses the same rule.
  const r2 = (x) => (x < 0 ? -1 : 1) * Math.floor(Math.abs(x) * 100 + 0.5) / 100;

  /** The object stored in snapshots.data. Same shape as update_prices.py writes. */
  function snapshotData(data) {
    const out = {};
    for (const who of ['all', 'p1', 'p2']) {
      const t = totals(data, who);
      out[who] = { inv: r2(t.inv), oth: r2(t.oth), debt: r2(t.debt), net: r2(t.net) };
    }
    return out;
  }

  /*
   * Debts. Canadian fixed-rate mortgages quote rates compounded semi-annually
   * (Interest Act, s. 6); variable mortgages and other loans are treated as
   * compounded monthly. Each lender's contract is the authority.
   */
  function periodRate(d) {
    const n = (FREQS[d.freq] || FREQS.monthly).n;
    const r = num(d.rate) / 100;
    if (d.kind === 'mortgage' && d.rate_type !== 'variable') return Math.pow(1 + r / 2, 2 / n) - 1;
    return Math.pow(1 + r / 12, 12 / n) - 1;
  }

  function addYears(iso, years) {
    const d = new Date(iso + 'T12:00:00');
    const whole = Math.floor(years);
    d.setFullYear(d.getFullYear() + whole);
    const rest = years - whole;
    if (rest) d.setTime(d.getTime() + rest * 365.25 * 86400000);
    return d.toISOString().slice(0, 10);
  }

  /** End of the mortgage term: the date typed, or term start + term length. */
  function termEnd(d) {
    if (d.term_end) return d.term_end;
    if (d.term_start && num(d.term_years) > 0) return addYears(d.term_start, num(d.term_years));
    return null;
  }

  function paymentFor(B, i, periods) {
    if (periods <= 0) return null;
    if (i === 0) return B / periods;
    return (B * i) / (1 - Math.pow(1 + i, -periods));
  }

  function balanceAfter(B, P, i, k) {
    if (k <= 0) return B;
    if (i === 0) return Math.max(0, B - P * k);
    const g = Math.pow(1 + i, k);
    return Math.max(0, B * g - (P * (g - 1)) / i);
  }

  /** Payment typed by the user, or computed from the remaining amortization. */
  function effectivePayment(d, today) {
    if (num(d.payment) > 0) return { payment: num(d.payment), computed: false };
    const n = (FREQS[d.freq] || FREQS.monthly).n;
    if (num(d.amortization_years) > 0 && num(d.balance) > 0) {
      let remainingYears = num(d.amortization_years);
      if (d.start_date) {
        const ref = d.balance_date ? new Date(d.balance_date + 'T12:00:00') : (today || new Date());
        remainingYears -= (ref - new Date(d.start_date + 'T12:00:00')) / (365.25 * 86400000);
      }
      if (remainingYears > 0) {
        const p = paymentFor(num(d.balance), periodRate(d), Math.round(remainingYears * n));
        if (p) return { payment: p, computed: true };
      }
    }
    return { payment: 0, computed: false };
  }

  function debtStats(d, today) {
    const t = today || new Date();
    const n = (FREQS[d.freq] || FREQS.monthly).n;
    const B = num(d.balance);
    const { payment: P, computed } = effectivePayment(d, t);
    const i = periodRate(d);
    const monthlyPay = (P * n) / 12;
    const monthlyInterest = B * (Math.pow(1 + i, n / 12) - 1);
    let periods = null;
    let covers = true;
    if (B <= 0) periods = 0;
    else if (P > 0) {
      if (i === 0) periods = B / P;
      else if (P <= B * i) covers = false;
      else periods = -Math.log(1 - (i * B) / P) / Math.log(1 + i);
    }
    const base = d.balance_date ? new Date(d.balance_date + 'T12:00:00') : t;
    let payoff = null, totalInterest = null, years = null;
    if (periods !== null) {
      const days = (periods * 365.25) / n;
      payoff = new Date(base.getTime() + days * 86400000);
      years = days / 365.25;
      totalInterest = Math.max(0, periods * P - B);
    }
    const end = termEnd(d);
    let daysToRenewal = null, termBalance = null, termInterest = null, termPrincipal = null;
    if (end) {
      const endDate = new Date(end + 'T12:00:00');
      daysToRenewal = Math.round((endDate - t) / 86400000);
      const k = Math.max(0, Math.floor(((endDate - base) / (365.25 * 86400000)) * n));
      if (P > 0 && covers) {
        termBalance = balanceAfter(B, P, i, Math.min(k, Math.ceil(periods || 0)));
        termPrincipal = B - termBalance;
        termInterest = Math.max(0, Math.min(k, periods || 0) * P - termPrincipal);
      }
    }
    // Projected balance once a year until payoff (for the chart).
    const schedule = [];
    if (P > 0 && covers && periods !== null) {
      const maxYears = Math.min(40, Math.ceil(years || 0));
      for (let y = 0; y <= maxYears; y++) {
        schedule.push({ date: new Date(base.getTime() + y * 365.25 * 86400000).toISOString().slice(0, 10), balance: balanceAfter(B, P, i, y * n) });
      }
    }
    const paidShare = num(d.original) > 0 ? Math.min(1, Math.max(0, 1 - B / num(d.original))) : null;
    const prepayAllowance = num(d.prepay_pct) > 0 && num(d.original) > 0 ? (num(d.original) * num(d.prepay_pct)) / 100 : null;
    return {
      payment: P, paymentComputed: computed, monthlyPay, monthlyInterest, periods, covers, payoff, years, totalInterest,
      termEnd: end, daysToRenewal, termBalance, termInterest, termPrincipal, schedule, paidShare, prepayAllowance, periodRate: i,
    };
  }

  /*
   * REEE (RESP) grant room, basic amounts only (2025 rules, verify yearly):
   *  - SCEE / CESG: 20 % of contributions; room accrues $500 per year since 2007 ($400 for 1998–2006)
   *    from the birth year to the year the child turns 17; at most $1,000 in a year with carry-forward;
   *    $7,200 lifetime.
   *  - IQEE: 10 % of contributions; $250 of room per year since 2007; at most $500 in a year;
   *    $3,600 lifetime.
   *  - Lifetime contribution limit: $50,000 per beneficiary.
   * Income-tested extras (additional SCEE, IQEE supplement, Canada Learning Bond) are not modelled.
   */
  const RESP = { cesgRate: 0.2, cesgYearMax: 1000, cesgLifetime: 7200, iqeeRate: 0.1, iqeeYearMax: 500, iqeeLifetime: 3600, contribLifetime: 50000 };

  function respStats(child, entries, today) {
    const t = today || new Date();
    const year = t.getFullYear();
    let contrib = 0, cesg = 0, iqee = 0, contribYear = 0, cesgYear = 0, iqeeYear = 0;
    for (const e of entries) {
      contrib += num(e.amount); cesg += num(e.cesg); iqee += num(e.iqee);
      if (e.kind === 'contribution' && String(e.entry_date).slice(0, 4) === String(year)) {
        contribYear += num(e.amount); cesgYear += num(e.cesg); iqeeYear += num(e.iqee);
      }
    }
    const birthYear = child.birth_date ? Number(String(child.birth_date).slice(0, 4)) : null;
    const age = child.birth_date ? Math.floor((t - new Date(child.birth_date + 'T12:00:00')) / (365.25 * 86400000)) : null;
    const lastGrantYear = birthYear !== null ? birthYear + 17 : null;
    const eligible = birthYear === null || year <= lastGrantYear;
    let cesgAccrued = 0, iqeeAccrued = 0;
    if (birthYear !== null) {
      for (let y = Math.max(birthYear, 1998); y <= Math.min(year, lastGrantYear); y++) {
        cesgAccrued += y < 2007 ? 400 : 500;
        if (y >= 2007) iqeeAccrued += 250;
      }
    }
    // Room at the start of this year = accrued − grants received before this year.
    const cesgRoom = Math.max(0, cesgAccrued - (cesg - cesgYear));
    const iqeeRoom = Math.max(0, iqeeAccrued - (iqee - iqeeYear));
    const cesgMaxThisYear = eligible && birthYear !== null ? Math.max(0, Math.min(RESP.cesgYearMax, cesgRoom, RESP.cesgLifetime - (cesg - cesgYear))) : null;
    const iqeeMaxThisYear = eligible && birthYear !== null ? Math.max(0, Math.min(RESP.iqeeYearMax, iqeeRoom, RESP.iqeeLifetime - (iqee - iqeeYear))) : null;
    const contribForMax = cesgMaxThisYear === null ? null : Math.max(cesgMaxThisYear / RESP.cesgRate, (iqeeMaxThisYear || 0) / RESP.iqeeRate);
    const toContribute = contribForMax === null ? null : Math.max(0, Math.min(contribForMax - contribYear, RESP.contribLifetime - contrib));
    const cesgExpectedYear = cesgMaxThisYear === null ? null : Math.min(contribYear * RESP.cesgRate, cesgMaxThisYear);
    const iqeeExpectedYear = iqeeMaxThisYear === null ? null : Math.min(contribYear * RESP.iqeeRate, iqeeMaxThisYear);
    return {
      contrib, cesg, iqee, contribYear, age, eligible, lastGrantYear,
      cesgMaxThisYear, iqeeMaxThisYear, contribForMax, toContribute, cesgExpectedYear, iqeeExpectedYear,
      cesgLeft: Math.max(0, RESP.cesgLifetime - cesg), iqeeLeft: Math.max(0, RESP.iqeeLifetime - iqee),
      contribLeft: Math.max(0, RESP.contribLifetime - contrib),
      at16or17: age !== null && age >= 15 && eligible,
    };
  }

  /** Savings goal: where it lands by the target date, and the monthly amount needed. */
  function projectStats(p, current, today) {
    const t = today || new Date();
    const target = num(p.target_amount);
    const r = num(p.expected_return) / 100 / 12;
    const pmt = num(p.monthly_contribution);
    let months = null;
    if (p.target_date) {
      const end = new Date(p.target_date + 'T12:00:00');
      months = Math.max(0, (end.getFullYear() - t.getFullYear()) * 12 + (end.getMonth() - t.getMonth()) - (end.getDate() < t.getDate() ? 1 : 0));
    }
    const growth = (m) => (r === 0 ? 1 : Math.pow(1 + r, m));
    const fvAnnuity = (m) => (r === 0 ? m : (Math.pow(1 + r, m) - 1) / r);
    const remaining = Math.max(0, target - current);
    let projected = null, needed = null, status;
    if (months !== null) {
      projected = current * growth(months) + pmt * fvAnnuity(months);
      const gap = target - current * growth(months);
      needed = gap <= 0 ? 0 : months > 0 ? gap / fvAnnuity(months) : gap;
    }
    // Months to reach the target at the current pace.
    let monthsToGoal = null;
    if (current >= target) monthsToGoal = 0;
    else if (pmt > 0 || (r > 0 && current > 0)) {
      let bal = current, m = 0;
      while (bal < target && m < 1200) { bal = bal * (1 + r) + pmt; m++; }
      monthsToGoal = m < 1200 ? m : null;
    }
    if (target > 0 && current >= target) status = 'reached';
    else if (months === null) status = monthsToGoal !== null ? 'open' : 'stalled';
    else if (projected !== null && projected >= target - 0.5) status = 'on_track';
    else status = 'behind';
    return { target, current, remaining, months, projected, needed, monthsToGoal, status, share: target > 0 ? Math.min(1, current / target) : null };
  }

  function monthly(amount, freq) {
    return (num(amount) * (FREQS[freq] || FREQS.monthly).n) / 12;
  }

  const api = { AUTO_MARKETS, FREQS, RESP, num, priceKey, share, usdcad, valueHolding, totals, snapshotData, periodRate, termEnd, paymentFor, balanceAfter, effectivePayment, debtStats, respStats, projectStats, monthly };
  root.Calc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
