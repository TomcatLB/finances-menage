/*
 * Québec + federal tax estimates for a household: personal income tax, payroll contributions,
 * and the tax of a small incorporated company (CCPC) or a self-employed business.
 *
 * These are ESTIMATES for planning, not a tax return. Not modelled: refundable credits, family and
 * solidarity credits, AMT, the passive-income grind, the RDTOH, tax instalments, capital cost allowance,
 * the progressive Québec 5,000–5,500 hour phase-in (all or nothing here).
 *
 * Parameters change every year: update PARAMS (sources in the comments) and run node tests/tax_test.mjs.
 */
(function (root) {
  'use strict';

  const PARAMS = {
    year: 2026,
    federal: {
      // canada.ca: CRA indexation of 2026 brackets and amounts (2.0 %); lowest rate 14 % for the full year 2026.
      // Not modelled: the 2026–2030 top-up credit (matters only for large medical or tuition claims).
      brackets: [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]],
      bpaMax: 16452, bpaMin: 14829, // basic personal amount, reduced between the 4th and 5th thresholds
      employmentAmount: 1501,       // Canada employment amount
      quebecAbatement: 0.165,       // refundable Québec abatement on basic federal tax
    },
    quebec: {
      // revenuquebec.ca: indexation 2026 (2.05 %).
      brackets: [[54345, 0.14], [108680, 0.19], [132245, 0.24], [Infinity, 0.2575]],
      bpa: 18952, creditRate: 0.14,
      workerDeduction: { rate: 0.06, max: 1450 }, // deduction for workers (Finances Québec, 2026 parameters)
    },
    dividends: {
      // Gross-up and dividend tax credit as a share of the grossed-up amount (CRA T5 guide; Finances Québec Bulletin 2026-3).
      // Québec's credit on non-eligible dividends drops to 2.69 % for dividends received after 2026-12-31.
      nonEligible: { grossUp: 0.15, federal: 0.090301, quebec: 0.0342 },
      eligible: { grossUp: 0.38, federal: 0.150198, quebec: 0.117 },
    },
    // Retraite Québec, 2026 figures: employee rates; the employer pays the same; self-employed pay both.
    qpp: { exemption: 3500, mga: 74600, msga: 85000, base: 0.053, first: 0.01, second: 0.04 },
    qpip: { employee: 0.0043, employer: 0.00602, selfEmployed: 0.00764, max: 103000 }, // Québec.ca, RQAP 2026
    // Health Services Fund. Employer: 1.65 % of wages when total payroll ≤ $1M (services). Individuals, on income other than
    // employment (business income, dividends actually received, interest, rents): nil to $18,500, then 1 % up to $150,
    // $150 to $64,355, then $150 + 1 % up to $1,000.
    fss: { employer: 0.0165, individual: { start: 18500, firstCap: 150, second: 64355, max: 1000, rate: 0.01 } },
    // Corporate rates (CRA; Bulletin 2026-3). Québec small-business rate: 3.2 % for taxation years that begin before
    // 2026-04-30, 2.2 % after. Without 5,500 paid hours the Québec rate is 11.5 % (linear between 5,000 and 5,500 h; all or nothing here).
    corp: { limit: 500000, federalSmall: 0.09, federalGeneral: 0.15, quebecSmall: 0.032, quebecGeneral: 0.115 },
    cnesstDefault: 0.015, // workplace-safety premium: depends on the industry; editable in the settings
    tfsaLimit: 7000,   // CELI: new room on January 1 (canada.ca)
    rrspLimit: 33810,  // REER: dollar maximum for the year (18 % of last year's earned income, up to this)
  };

  const max0 = (x) => (x > 0 ? x : 0);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function bracketTax(income, brackets) {
    let tax = 0, low = 0;
    for (const [top, rate] of brackets) {
      if (income <= low) break;
      tax += (Math.min(income, top) - low) * rate;
      low = top;
    }
    return tax;
  }
  function marginalRate(income, brackets) {
    for (const [top, rate] of brackets) if (income < top) return rate;
    return brackets.at(-1)[1];
  }

  /**
   * QPP contributions of one person. Employment comes first; self-employment uses the room left and pays
   * both halves. Returns the employee (or self) amounts split into base and enhanced parts.
   */
  function qppContrib(employment, selfEmployed, P) {
    const q = P.qpp;
    const band1 = (earn) => max0(Math.min(earn, q.mga) - q.exemption);
    const band2 = (earn) => max0(Math.min(earn, q.msga) - q.mga);
    const e1 = band1(employment), e2 = band2(employment);
    const t1 = band1(employment + selfEmployed), t2 = band2(employment + selfEmployed);
    const s1 = max0(t1 - e1), s2 = max0(t2 - e2);
    const emp = { base: e1 * q.base, enhanced: e1 * q.first + e2 * q.second };
    const self = { base: 2 * s1 * q.base, enhanced: 2 * (s1 * q.first + s2 * q.second) };
    return { emp, self, employer: { ...emp } };
  }

  /**
   * Personal income tax and contributions of one Québec resident for a year.
   * inc: { employment, selfEmployed, nonEligibleDiv, eligibleDiv, other } (cash dividends, before gross-up).
   */
  function personalTax(inc, P = PARAMS) {
    const emp = max0(inc.employment || 0), se = inc.selfEmployed || 0, other = inc.other || 0;
    const ned = max0(inc.nonEligibleDiv || 0), ed = max0(inc.eligibleDiv || 0);
    const qpp = qppContrib(emp, max0(se), P);
    const qpipEmp = Math.min(emp, P.qpip.max) * P.qpip.employee;
    const qpipSelf = clamp(max0(se), 0, max0(P.qpip.max - emp)) * P.qpip.selfEmployed;
    const qpipSelfEmployeeShare = qpipSelf * (P.qpip.employee / P.qpip.selfEmployed);
    // Deductions: enhanced QPP; for the self-employed, the "employer" half of QPP and QPIP too.
    const selfQppHalf = (qpp.self.base + qpp.self.enhanced) / 2;
    const deductions = qpp.emp.enhanced + qpp.self.enhanced / 2 + selfQppHalf + (qpipSelf - qpipSelfEmployeeShare);
    const grossNed = ned * (1 + P.dividends.nonEligible.grossUp);
    const grossEd = ed * (1 + P.dividends.eligible.grossUp);
    const total = emp + se + other + grossNed + grossEd;
    const fedTI = max0(total - deductions);

    const F = P.federal;
    const lowest = F.brackets[0][1];
    const [t4, t5] = [F.brackets[2][0], F.brackets[3][0]];
    const bpa = F.bpaMax - (F.bpaMax - F.bpaMin) * clamp((fedTI - t4) / (t5 - t4), 0, 1);
    const fedCredits = lowest * (bpa + Math.min(emp, F.employmentAmount) + qpp.emp.base + qpp.self.base / 2 + qpipEmp + qpipSelfEmployeeShare);
    const fedDtc = grossNed * P.dividends.nonEligible.federal + grossEd * P.dividends.eligible.federal;
    const fedBasic = max0(bracketTax(fedTI, F.brackets) - fedCredits - fedDtc);
    const federal = fedBasic * (1 - F.quebecAbatement);

    const Q = P.quebec;
    const work = emp + max0(se);
    const workerDed = Math.min(work * Q.workerDeduction.rate, Q.workerDeduction.max);
    const qcTI = max0(total - deductions - workerDed);
    const qcDtc = grossNed * P.dividends.nonEligible.quebec + grossEd * P.dividends.eligible.quebec;
    const quebec = max0(bracketTax(qcTI, Q.brackets) - Q.creditRate * Q.bpa - qcDtc);

    // Health Services Fund for individuals: on income other than employment, dividends without the gross-up.
    const fssSelf = fssIndividual(max0(se) + max0(other) + ned + ed, P);
    const contributions = qpp.emp.base + qpp.emp.enhanced + qpp.self.base + qpp.self.enhanced + qpipEmp + qpipSelf + fssSelf;
    return {
      federal, quebec, incomeTax: federal + quebec, contributions, total: federal + quebec + contributions,
      fedTI, qcTI, qpp, qpipEmp, qpipSelf, fssSelf,
      marginal: marginalRate(fedTI, F.brackets) * (1 - F.quebecAbatement) + marginalRate(qcTI, Q.brackets),
    };
  }

  /**
   * After-tax income of one person from gross amounts only: { employment, selfEmployed, other } per year.
   * Used by the Budget for income entered before tax; other income and deductions (REER…) are not counted.
   */
  function netIncome(inc, P = PARAMS) {
    const gross = max0(inc.employment || 0) + (inc.selfEmployed || 0) + (inc.other || 0);
    const t = personalTax(inc, P);
    return { gross, tax: t.total, net: gross - t.total, rate: gross > 0 ? t.total / gross : 0 };
  }

  function fssIndividual(base, P) {
    const f = P.fss.individual;
    if (base <= f.start) return 0;
    if (base <= f.second) return Math.min(f.firstCap, (base - f.start) * f.rate);
    return Math.min(f.max, f.firstCap + (base - f.second) * f.rate);
  }

  /** Tax and contributions caused by `extra` on top of `base` (both personalTax inputs). */
  function extraTax(base, extra, P = PARAMS) {
    const sum = { ...base };
    for (const [k, v] of Object.entries(extra)) sum[k] = (sum[k] || 0) + v;
    return personalTax(sum, P).total - personalTax(base, P).total;
  }

  /** What the company pays on top of a salary: QPP, QPIP, Health Services Fund, CNESST. No EI for an owner with > 40 % of the votes. */
  function employerCosts(salary, P = PARAMS, cnesstRate = P.cnesstDefault) {
    const s = max0(salary);
    const qpp = qppContrib(s, 0, P).employer;
    const qpip = Math.min(s, P.qpip.max) * P.qpip.employer;
    const fss = s * P.fss.employer;
    const cnesst = s * cnesstRate;
    return { qpp: qpp.base + qpp.enhanced, qpip, fss, cnesst, total: qpp.base + qpp.enhanced + qpip + fss + cnesst };
  }

  /** Corporate income tax of a CCPC in Québec. sbdHours: the 5,500 paid hours that give the reduced Québec rate. */
  function corpTax(taxable, sbdHours, P = PARAMS) {
    if (!(taxable > 0)) return { federal: 0, quebec: 0, total: 0, rate: 0 };
    const C = P.corp;
    const small = Math.min(taxable, C.limit), rest = taxable - small;
    const federal = small * C.federalSmall + rest * C.federalGeneral;
    const quebec = small * (sbdHours ? C.quebecSmall : C.quebecGeneral) + rest * C.quebecGeneral;
    return { federal, quebec, total: federal + quebec, rate: (federal + quebec) / taxable };
  }

  /**
   * One year of a company. lines: [{ kind: 'income'|'expense', annual, deductiblePct }].
   * pay: { salary, dividends } per year (inc only). Returns the cash flow from revenue to retained cash.
   */
  function companyYear(company, lines, pay, opts = {}) {
    const P = opts.params || PARAMS;
    let revenue = 0, expenses = 0, deductible = 0;
    for (const l of lines) {
      if (l.kind === 'income') revenue += l.annual;
      else { expenses += l.annual; deductible += l.annual * (l.deductiblePct ?? 100) / 100; }
    }
    const available = revenue - expenses; // cash before paying the owners and the tax
    if (company.kind === 'autonome') {
      const profit = revenue - deductible;
      return { kind: 'autonome', revenue, expenses, deductible, available, profit, taxable: profit };
    }
    const salary = max0(pay.salary || 0), dividends = max0(pay.dividends || 0);
    const ec = employerCosts(salary, P, opts.cnesstRate ?? P.cnesstDefault);
    const taxable = revenue - deductible - salary - ec.total;
    const ct = corpTax(taxable, !!company.sbd_hours, P);
    const afterTax = taxable - ct.total;
    const retained = available - salary - ec.total - ct.total - dividends;
    return { kind: 'inc', revenue, expenses, deductible, available, salary, employer: ec, taxable, corpTax: ct, afterTax, dividends, retained };
  }

  /**
   * Salary-or-dividends comparison for an incorporated company: the same cash, paid out three ways.
   * baseIncome: the owner's other income (personalTax input), so the personal tax is marginal.
   */
  function payoutScenarios(company, lines, current, baseIncome, opts = {}) {
    const P = opts.params || PARAMS;
    const yr = (pay) => companyYear(company, lines, pay, opts);
    const personal = (salary, dividends) => extraTax(baseIncome, { employment: salary, nonEligibleDiv: dividends }, P);
    const out = [];
    const make = (label, salary, dividends) => {
      const y = yr({ salary, dividends });
      const tax = personal(salary, dividends);
      out.push({ label, salary, dividends, pocket: salary + dividends - tax, personalTax: tax, corpTax: y.corpTax.total,
        employer: y.employer.total, retained: y.retained, totalTax: tax + y.corpTax.total + y.employer.total });
    };
    // Everything as dividends: pay the corporate tax, distribute the rest.
    const z = yr({ salary: 0, dividends: 0 });
    make('All dividends', 0, max0(z.available - z.corpTax.total));
    // Everything as salary: the largest salary the cash allows.
    let lo = 0, hi = max0(z.available);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (yr({ salary: mid, dividends: 0 }).retained >= 0) lo = mid; else hi = mid;
    }
    make('All salary', lo, 0);
    make('What you entered', current.salary || 0, current.dividends || 0);
    return out;
  }

  const api = { PARAMS, bracketTax, qppContrib, fssIndividual, personalTax, netIncome, extraTax, employerCosts, corpTax, companyYear, payoutScenarios };
  root.Tax = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
