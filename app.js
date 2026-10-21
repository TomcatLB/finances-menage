/* Household finances — web app. Data lives in Supabase; calc.js holds the formulas. */
(() => {
  'use strict';
  const C = window.Calc;
  const { num, FREQS } = C;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const cfg = window.APP_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_KEY &&
    !/YOUR-/.test(cfg.SUPABASE_URL) && !/YOUR-/.test(cfg.SUPABASE_KEY));
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;

  const MARKETS = {
    TSX: { label: 'TSX (Toronto Stock Exchange)', cur: 'CAD', auto: true },
    TSXV: { label: 'TSX Venture', cur: 'CAD', auto: true },
    NEO: { label: 'Cboe Canada (formerly NEO)', cur: 'CAD', auto: true },
    US: { label: 'NYSE / Nasdaq (U.S.)', cur: 'USD', auto: true },
    CRYPTO: { label: 'Cryptocurrency (BTC, ETH… daily price in USD)', cur: 'USD', auto: true },
    MANUAL: { label: 'Private investment or price entered by hand (mutual fund, crypto…)', cur: null, auto: false },
    CASH: { label: 'Cash in the account', cur: null, auto: false },
  };
  const ACCOUNTS = ['CELI', 'REER', 'CELIAPP', 'REEE', 'FERR', 'CRI / FRV', 'Non enregistré', 'Société', 'Autre'];
  const ASSET_KINDS = ['Résidence principale', 'Immeuble locatif', 'Chalet', 'Véhicule', 'Compte bancaire', 'Fonds de pension', 'Entreprise', 'Autre'];
  const DEBT_KINDS = {
    mortgage: 'Mortgage', heloc: 'Home equity line (HELOC)', loc: 'Line of credit', auto: 'Car loan',
    student: 'Student loan', card: 'Credit card', personal: 'Personal loan', other: 'Other',
  };
  const FIXED_GROUPS = ['Logement', 'Électricité et chauffage', 'Internet et téléphone', 'Assurances', 'Transport',
    'Alimentation', 'Abonnements', 'Santé', 'Épargne et placements', 'Dons', 'Autre dépense fixe'];
  const VAR_GROUPS = ['Voyages', 'Shopping', 'Loisirs et sorties', 'Restaurants', 'Cadeaux', 'Maison et entretien', 'Autre dépense variable'];
  const CHILD_GROUPS = ['Garderie / service de garde', 'Activités', 'Jouets', 'Vêtements', 'École', 'Santé des enfants', 'Autre (enfants)'];
  const isChildGroup = (g) => CHILD_GROUPS.includes(g);
  const natureOf = (g) => (VAR_GROUPS.includes(g) ? 'variable' : 'fixed');
  const INC_GROUPS = ['Salaire net', 'Travail autonome', 'Allocations familiales', 'Revenus de placement', 'Autre revenu'];
  const SAVINGS_GROUP = 'Épargne et placements';
  /** Income groups that can be entered gross (before tax), and how each is taxed. */
  const GROSS_KIND = { 'Salaire net': 'employment', 'Travail autonome': 'selfEmployed', 'Revenus de placement': 'other', 'Autre revenu': 'other' };
  const isGross = (b) => b.kind === 'income' && !!b.gross && !!GROSS_KIND[b.grp];
  const DEBT_FREQS = Object.fromEntries(Object.entries(FREQS).filter(([k]) => k !== 'yearly').map(([k, v]) => [k, v.label]));
  const ALL_FREQS = Object.fromEntries(Object.entries(FREQS).map(([k, v]) => [k, v.label]));
  const TABS = [['portfolio', 'Portfolio'], ['actifs', 'Assets'], ['budget', 'Budget'], ['enfants', 'Children'], ['dettes', 'Debts'], ['projets', 'Projects'],
    ['compagnies', 'Companies'], ['projections', 'Projections']];
  // Saved values (accounts, categories, asset types) stay in French: the database, the importers and older rows use them.
  // The page shows them under these English names.
  const LABELS = {
    CELI: 'TFSA', REER: 'RRSP', CELIAPP: 'FHSA', REEE: 'RESP', FERR: 'RRIF', 'CRI / FRV': 'LIRA / LIF', 'Non enregistré': 'Non-registered', 'Société': 'Corporation', Autre: 'Other',
    'Résidence principale': 'Principal residence', 'Immeuble locatif': 'Rental property', Chalet: 'Cottage', 'Véhicule': 'Vehicle', 'Compte bancaire': 'Bank account',
    'Fonds de pension': 'Pension fund', Entreprise: 'Business',
    Logement: 'Housing', 'Électricité et chauffage': 'Electricity and heating', 'Internet et téléphone': 'Internet and phone', Assurances: 'Insurance', Transport: 'Transportation',
    Alimentation: 'Groceries', Abonnements: 'Subscriptions', 'Santé': 'Health', 'Épargne et placements': 'Savings and investments', Dons: 'Donations', 'Autre dépense fixe': 'Other fixed expense',
    Voyages: 'Travel', Shopping: 'Shopping', 'Loisirs et sorties': 'Leisure and outings', Restaurants: 'Restaurants', Cadeaux: 'Gifts', 'Maison et entretien': 'Home and upkeep',
    'Autre dépense variable': 'Other variable expense',
    'Garderie / service de garde': 'Daycare / childcare', 'Activités': 'Activities', Jouets: 'Toys', 'Vêtements': 'Clothing', 'École': 'School', 'Santé des enfants': 'Children’s health',
    'Autre (enfants)': 'Other (children)', Encaisse: 'Cash',
    'Salaire net': 'Salary', 'Travail autonome': 'Self-employment', 'Allocations familiales': 'Family allowances', 'Revenus de placement': 'Investment income', 'Autre revenu': 'Other income',
    'Ventes et honoraires': 'Sales and fees', Subventions: 'Grants', 'Loyer et bureau': 'Rent and office', 'Matériel et équipement': 'Supplies and equipment',
    'Logiciels et abonnements': 'Software and subscriptions', 'Téléphone et Internet': 'Phone and Internet', 'Véhicule et déplacements': 'Vehicle and travel',
    'Repas et représentation': 'Meals and entertainment', 'Publicité et marketing': 'Advertising and marketing', 'Honoraires professionnels': 'Professional fees',
    'Frais bancaires et intérêts': 'Bank fees and interest', Formation: 'Training', 'Sous-traitance': 'Subcontracting', 'Salaires d’employés': 'Employee wages', 'Autre dépense': 'Other expense',
  };
  const L = (v) => LABELS[v] || v;

  const S = {
    session: null,
    settings: { p1_name: 'Person 1', p2_name: 'Person 2', include_debt_payments: true },
    holdings: [], prices: {}, assets: [], debts: [], budget: [], snapshots: [],
    children: [], resp: [], projects: [], log: [],
    month: new Date().toLocaleDateString('en-CA').slice(0, 7),
    who: storeGet('who', 'all'),
    tab: TABS.some(([t]) => t === location.hash.slice(1)) ? location.hash.slice(1) : 'portfolio',
    range: storeGet('range', '1y'),
    companies: [], company_items: [], transactions: [], contributions: [],
    loaded: false, denied: false, loadError: null, outdated: false,
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function storeGet(k, d) { try { const v = localStorage.getItem('fm.' + k); return v === null ? d : v; } catch { return d; } }
  function storeSet(k, v) { try { localStorage.setItem('fm.' + k, v); } catch { /* storage unavailable */ } }
  function $(sel, root = document) { return root.querySelector(sel); }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const fmt0 = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtC = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 });
  const fmtQty = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 6 });
  const fmtPct = new Intl.NumberFormat('en-CA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPctS = new Intl.NumberFormat('en-CA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const fmtRate = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fmtYears = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 });
  const fmtFx = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const money = (v) => fmt0.format(Math.round(v) === 0 ? 0 : v);
  const moneySigned = (v) => (v > 0.5 ? '+' : '') + money(v);
  function native(v, cur) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: cur || 'CAD', minimumFractionDigits: 2, maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 2 }).format(v);
  }
  function fmtDate(iso, opts) {
    if (!iso) return '—';
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return new Intl.DateTimeFormat('en-CA', opts || { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  const cls = (v) => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
  const ownerName = (o) => (o === 'p1' ? S.settings.p1_name : o === 'p2' ? S.settings.p2_name : 'Joint');
  const sh = (owner) => C.share(owner, S.who);

  function parseNum(raw) {
    if (raw === null || raw === undefined) return null;
    let t = String(raw).replace(/[\s  $]/g, '').replace(/[−–]/g, '-');
    if (t === '') return null;
    // 1,234.56 and 1,234 use commas for thousands; a lone comma is a decimal point (4,59).
    if (t.includes('.') || /^-?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
    else t = t.replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  let toastTimer;
  function toast(msg, err, action) {
    const el = $('#toast');
    el.replaceChildren(msg, action ? h('button', { class: 'toast-action', type: 'button', text: action.label,
      onclick: () => { el.hidden = true; action.fn(); } }) : '');
    el.className = 'toast' + (err ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, err || action ? 6000 : 2500);
  }
  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/row-level security|permission denied/i.test(m)) return 'This account does not have access to this data.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Cannot connect. Check your Internet connection.';
    if (/column .* does not exist|Could not find the .* column|holdings_market_check/i.test(m)) return 'The database needs an update: in Supabase, run the supabase/schema.sql file again (SQL Editor → Run).';
    return m;
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  // Tables added after the first version: if the database has not been updated yet (schema.sql not run again),
  // the app still loads and shows a notice instead of failing.
  const OPTIONAL_TABLES = {
    companies: () => sb.from('companies').select('*').order('created_at'),
    company_items: () => sb.from('company_items').select('*').order('created_at'),
    transactions: () => sb.from('transactions').select('*').order('trade_date', { ascending: false }).limit(5000),
    contributions: () => sb.from('contributions').select('*').order('entry_date'),
  };
  const missingTable = (e) => /does not exist|Could not find the table|PGRST205|42P01/i.test((e && (e.message || e.code)) || '');

  async function loadAll() {
    const results = await Promise.all([
      sb.from('settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('holdings').select('*').order('created_at'),
      sb.from('prices').select('*'),
      sb.from('assets').select('*').order('created_at'),
      sb.from('debts').select('*').order('created_at'),
      sb.from('budget_items').select('*').order('created_at'),
      sb.from('snapshots').select('*').order('snap_date').limit(5000),
      sb.from('children').select('*').order('birth_date', { ascending: true, nullsFirst: false }),
      sb.from('resp_entries').select('*').order('entry_date'),
      sb.from('projects').select('*').order('created_at'),
      sb.from('expense_log').select('*').order('spend_date', { ascending: false }).limit(5000),
    ]);
    const extra = await Promise.all(Object.values(OPTIONAL_TABLES).map((q) => q()));
    const err = results.find((r) => r.error) || extra.find((r) => r.error && !missingTable(r.error));
    if (err) { S.loadError = errText(err.error); S.loaded = true; return; }
    const [st, ho, pr, as, de, bu, sn, ch, re, pj, lg] = results.map((r) => r.data);
    S.loadError = null;
    S.denied = !st; // the settings row always exists; not seeing it means this login isn't on the list
    if (st) S.settings = st;
    S.holdings = ho || [];
    S.prices = Object.fromEntries((pr || []).map((p) => [p.symbol_key, p]));
    S.assets = as || [];
    S.debts = de || [];
    S.budget = bu || [];
    S.snapshots = sn || [];
    S.children = ch || [];
    S.resp = re || [];
    S.projects = pj || [];
    S.log = lg || [];
    Object.keys(OPTIONAL_TABLES).forEach((k, i) => { S[k] = extra[i].data || []; });
    // New columns in settings are the other sign of an older database.
    S.outdated = extra.some((r) => r.error) || (st && !('projection' in st));
    S.loaded = true;
  }

  async function refresh() {
    try { await loadAll(); } catch (e) { S.loadError = errText(e); }
    render();
  }

  // ---------------------------------------------------------------------------
  // Saving, with undo
  // ---------------------------------------------------------------------------
  // Every change goes through saveRow / insertRows / deleteRows / saveSettings, which note how to put things back.
  // undoable() groups the changes of one action (a form, an import, a quick delete) into one step of the Undo button.
  // The steps live in this tab only: reloading the page starts a new list.
  const TABLE_KEY = { holdings: 'holdings', assets: 'assets', debts: 'debts', budget_items: 'budget', children: 'children', resp_entries: 'resp',
    projects: 'projects', expense_log: 'log', companies: 'companies', company_items: 'company_items', transactions: 'transactions', contributions: 'contributions' };
  const LINK_FIELDS = ['child_id', 'project_id', 'company_id', 'holding_id'];
  const UNDO_MAX = 30;
  const undoStack = [];
  let undoOps = null;
  const loadedRow = (table, id) => (S[TABLE_KEY[table]] || []).find((r) => r.id === id);
  const pick = (row, keys) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

  function noteUndo(op, label = 'last change') {
    if (undoOps) { undoOps.push(op); return; }
    pushUndo(label, [op]);
  }
  function pushUndo(label, ops) {
    undoStack.push({ label, ops });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  async function undoable(label, fn) {
    if (undoOps) return fn(); // already inside an action
    undoOps = [];
    try { return await fn(); } finally {
      const ops = undoOps;
      undoOps = null;
      if (ops.length) pushUndo(label, ops);
    }
  }

  async function saveRow(table, row) {
    const { id, ...rest } = row;
    if (id) {
      const before = loadedRow(table, id);
      const res = await sb.from(table).update(rest).eq('id', id);
      if (res.error) throw res.error;
      if (before) noteUndo({ t: 'update', table, id, before: pick(before, Object.keys(rest)) });
    } else {
      await insertRows(table, [rest]);
    }
  }
  async function insertRows(table, rows) {
    const res = await sb.from(table).insert(rows).select();
    if (res.error) throw res.error;
    const made = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    if (made.length) noteUndo({ t: 'insert', table, ids: made.map((r) => r.id) });
    return made;
  }
  async function deleteRow(table, id) { return deleteRows(table, [id]); }
  async function deleteRows(table, ids) {
    const rows = ids.map((id) => loadedRow(table, id)).filter(Boolean);
    // Rows that point to these ones (an RESP entry to its child, a holding to its project) lose them in the database;
    // keep a copy so Undo can put them back.
    const gone = new Set(ids);
    const linked = [];
    for (const [t, key] of Object.entries(TABLE_KEY)) {
      for (const r of S[key] || []) if (LINK_FIELDS.some((f) => r[f] && gone.has(r[f]))) linked.push([t, r]);
    }
    const res = await sb.from(table).delete().in('id', ids);
    if (res.error) throw res.error;
    if (rows.length) noteUndo({ t: 'delete', table, rows, linked });
  }
  async function saveSettings(upd) {
    const before = pick(S.settings, Object.keys(upd));
    const res = await sb.from('settings').update(upd).eq('id', 1);
    if (res.error) throw res.error;
    noteUndo({ t: 'settings', before });
  }

  async function reverse(op) {
    const check = (res) => { if (res.error) throw res.error; };
    if (op.t === 'insert') check(await sb.from(op.table).delete().in('id', op.ids));
    else if (op.t === 'update') check(await sb.from(op.table).update(op.before).eq('id', op.id));
    else if (op.t === 'settings') check(await sb.from('settings').update(op.before).eq('id', 1));
    else if (op.t === 'delete') {
      check(await sb.from(op.table).upsert(op.rows));
      const byTable = new Map();
      for (const [t, r] of op.linked) byTable.set(t, [...(byTable.get(t) || []), r]);
      for (const [t, rows] of byTable) check(await sb.from(t).upsert(rows));
    }
  }
  let undoing = false;
  async function undoLast() {
    if (undoing || !undoStack.length) return;
    undoing = true;
    const step = undoStack.pop();
    clearTimeout(projSaveTimer); // a projection edit still waiting to be saved would come back otherwise
    try {
      for (const op of [...step.ops].reverse()) await reverse(op);
      toast(`Undone: ${step.label}`);
    } catch (e) {
      toast(errText(e), true);
    }
    undoing = false;
    refresh();
  }
  /** Deletes a row from a list (the × button), with Undo in the message instead of a confirmation. */
  async function quickDelete(table, row, what) {
    try {
      await undoable(`delete “${what}”`, () => deleteRow(table, row.id));
      toast(`Deleted “${what}”`, false, { label: 'Undo', fn: undoLast });
    } catch (e) {
      toast(errText(e), true);
    }
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Derived numbers
  // ---------------------------------------------------------------------------
  function portfolio() {
    const rows = [];
    for (const hd of S.holdings) {
      const f = sh(hd.owner);
      if (!f) continue;
      rows.push({ h: hd, f, ...C.valueHolding(hd, S.prices) });
    }
    let mv = 0, cost = 0, day = 0, missingFx = 0, atCost = 0;
    for (const r of rows) {
      if (r.mv === null) { missingFx += 1; continue; }
      mv += r.mv * r.f; cost += r.cost * r.f; day += r.day * r.f;
      if (r.src === 'cost') atCost += 1;
    }
    const closeDates = rows.filter((r) => r.src === 'close' && r.date).map((r) => r.date).sort();
    return { rows, mv, cost, day, gain: mv - cost, missingFx, atCost, lastClose: closeDates.at(-1) || null, oldestClose: closeDates[0] || null };
  }

  function debtsView() {
    const rows = S.debts.map((d) => ({ d, f: sh(d.owner), st: C.debtStats(d) })).filter((r) => r.f);
    let total = 0, monthlyPay = 0, monthlyInterest = 0, rateW = 0;
    for (const r of rows) {
      const b = num(r.d.balance) * r.f;
      total += b; monthlyPay += r.st.monthlyPay * r.f; monthlyInterest += r.st.monthlyInterest * r.f;
      rateW += num(r.d.rate) * b;
    }
    return { rows, total, monthlyPay, monthlyInterest, avgRate: total > 0 ? rateW / total : 0 };
  }

  /**
   * Monthly amount of each budget line, after tax. Gross income lines are added up per person
   * (joint lines 50/50) and taxed together; each line keeps that person's average after-tax share.
   */
  function budgetNet() {
    const out = new Map();
    const per = { p1: { employment: 0, selfEmployed: 0, other: 0 }, p2: { employment: 0, selfEmployed: 0, other: 0 } };
    const gross = [];
    for (const b of S.budget) {
      const m = C.monthly(b.amount, b.freq);
      if (!isGross(b)) { out.set(b, m); continue; }
      for (const [p, part] of owners(b)) per[p][GROSS_KIND[b.grp]] += m * 12 * part;
      gross.push([b, m]);
    }
    if (!gross.length) return out;
    const keep = {};
    for (const p of ['p1', 'p2']) keep[p] = 1 - T().netIncome(per[p]).rate;
    for (const [b, m] of gross) out.set(b, owners(b).reduce((a, [p, part]) => a + m * part * keep[p], 0));
    return out;
  }

  function budgetView() {
    const net = budgetNet();
    const items = S.budget.map((b) => ({ b, f: sh(b.owner), m: net.get(b) })).filter((r) => r.f);
    const income = items.filter((r) => r.b.kind === 'income');
    const fixed = items.filter((r) => r.b.kind === 'expense' && r.b.nature !== 'variable');
    const envelopes = items.filter((r) => r.b.kind === 'expense' && r.b.nature === 'variable');
    const dv = debtsView();
    const debtLines = S.settings.include_debt_payments
      ? dv.rows.filter((r) => r.st.monthlyPay > 0).map((r) => ({ name: r.d.name, m: r.st.monthlyPay * r.f, owner: r.d.owner }))
      : [];
    const sum = (rows) => rows.reduce((a, r) => a + r.m * r.f, 0);
    const inc = sum(income);
    const fixedTotal = sum(fixed);
    const varPlanned = sum(envelopes);
    const debtTotal = debtLines.reduce((a, r) => a + r.m, 0);
    const exp = fixedTotal + varPlanned + debtTotal;
    const saved = sum(fixed.filter((r) => r.b.grp === SAVINGS_GROUP));
    const surplus = inc - exp;
    const byGroup = new Map();
    const add = (k, v) => byGroup.set(k, (byGroup.get(k) || 0) + v);
    for (const r of fixed) add(isChildGroup(r.b.grp) ? 'Children' : L(r.b.grp), r.m * r.f);
    for (const r of envelopes) add(L(r.b.grp), r.m * r.f);
    if (debtTotal > 0) add('Debt payments', debtTotal);
    return { income, fixed, envelopes, debtLines, inc, fixedTotal, varPlanned, debtTotal, exp, surplus, saved, rate: inc > 0 ? (surplus + saved) / inc : null, byGroup };
  }

  /** Ad hoc spending in a month and year to date, for the people in view. */
  function logView(month) {
    const year = month.slice(0, 4);
    const rows = S.log.map((e) => ({ e, f: sh(e.owner) })).filter((r) => r.f);
    const inMonth = rows.filter((r) => String(r.e.spend_date).startsWith(month));
    const ytd = rows.filter((r) => String(r.e.spend_date).slice(0, 4) === year && String(r.e.spend_date).slice(0, 7) <= month);
    const byGrp = (list) => { const m = new Map(); for (const r of list) m.set(r.e.grp, (m.get(r.e.grp) || 0) + num(r.e.amount) * r.f); return m; };
    return { inMonth, ytd, monthByGrp: byGrp(inMonth), ytdByGrp: byGrp(ytd), monthIndex: Number(month.slice(5, 7)) };
  }

  /** CAD value of holdings linked to a child (REEE) or a project. */
  function linkedValue(field, id) {
    let v = 0, n = 0;
    for (const hd of S.holdings) {
      if (hd[field] !== id) continue;
      const val = C.valueHolding(hd, S.prices).mv;
      if (val !== null) { v += val; n++; }
    }
    return { value: v, count: n };
  }

  function currentTotals() {
    return C.totals({ holdings: S.holdings, prices: S.prices, assets: S.assets, debts: S.debts }, S.who);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    const app = $('#app');
    if (!configured) return app.replaceChildren(setupScreen());
    if (!sb) return app.replaceChildren(h('div', { class: 'login' }, h('h1', { text: 'Household finances' }), h('p', { text: 'The Supabase library could not be loaded. Reload the page.' })));
    if (!S.session) return app.replaceChildren(loginScreen());
    if (!S.loaded) return app.replaceChildren(h('div', { class: 'boot', text: 'Loading data…' }));
    if (S.loadError) {
      return app.replaceChildren(header(), h('div', { class: 'card empty' },
        h('strong', { text: 'The data does not load' }), h('p', { text: S.loadError }),
        h('button', { class: 'btn', onclick: refresh, text: 'Try again' })));
    }
    if (S.denied) {
      return app.replaceChildren(header(), h('div', { class: 'card empty' },
        h('strong', { text: 'This account has no access' }),
        h('p', { text: `${S.session.user.email} is not on the list of household members. Add this email to the allowed_users table in Supabase.` })));
    }
    const panel = { portfolio: renderPortfolio, actifs: renderActifs, budget: renderBudget, enfants: renderEnfants, dettes: renderDettes, projets: renderProjets,
      compagnies: renderCompagnies, projections: renderProjections }[S.tab]();
    const notice = S.outdated ? h('div', { class: 'banner' },
      'New features to turn on: in Supabase, open SQL Editor, paste the supabase/schema.sql file (with your two emails) and click Run. Your data stays as it is.') : null;
    app.replaceChildren(header(), summary(), notice || '', tabs(), panel);
  }

  function header() {
    const p = S.loaded ? portfolio() : null;
    const fx = S.prices['FX:USDCAD'];
    const parts = [];
    if (p && p.lastClose) parts.push(`Closing prices of ${fmtDate(p.lastClose)}`);
    if (fx) parts.push(`USD/CAD ${fmtFx.format(num(fx.close))} (Bank of Canada, ${fmtDate(fx.price_date, { day: 'numeric', month: 'short' })})`);
    const who = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show for' },
      [['all', 'Household'], ['p1', S.settings.p1_name], ['p2', S.settings.p2_name]].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(S.who === k), onclick: () => { S.who = k; storeSet('who', k); render(); }, text: label })));
    return h('header', { class: 'top' },
      h('div', null, h('h1', { text: 'Household finances' }), h('p', { class: 'sub', text: parts.join(' · ') || 'Prices update every trading evening.' })),
      h('div', { class: 'top-actions' },
        S.loaded && !S.denied && !S.loadError ? who : null,
        S.loaded && !S.denied && !S.loadError ? h('button', {
          class: 'btn ghost', type: 'button', onclick: undoLast, disabled: !undoStack.length,
          title: undoStack.length ? `Undo: ${undoStack.at(-1).label} (Ctrl+Z)` : 'Nothing to undo yet', text: '↶ Undo',
        }) : null,
        S.loaded && !S.denied && !S.loadError ? h('button', { class: 'btn ghost', type: 'button', onclick: exportAll, text: 'Export', title: 'All the data in one Excel file' }) : null,
        S.loaded && !S.denied ? h('button', { class: 'btn ghost', type: 'button', onclick: openSettings, text: 'Settings' }) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => sb.auth.signOut(), text: 'Sign out' })));
  }

  function summary() {
    const t = currentTotals();
    const p = portfolio();
    const b = budgetView();
    const whoNote = S.who === 'all' ? 'Whole household' : `${ownerName(S.who)}, with 50% of joint items`;
    return h('section', { class: 'summary', 'aria-label': 'Summary' },
      stat('Net worth', money(t.net), whoNote, 'lead'),
      stat('Investments', money(t.inv), p.day ? h('span', { class: cls(p.day), text: `${moneySigned(p.day)} today` }) : 'Value at the last price'),
      stat('Debts', money(t.debt), t.debt ? `${money(debtsView().monthlyPay)} in payments / month` : 'No debts entered'),
      stat('Monthly surplus', b.inc || b.exp ? h('span', { class: cls(b.surplus), text: moneySigned(b.surplus) }) : '—',
        b.rate !== null ? `Savings rate ${fmtPct.format(b.rate)}` : 'Budget to fill in'));
  }
  function stat(label, value, note, extra) {
    return h('div', { class: 'stat' + (extra ? ' ' + extra : '') },
      h('div', { class: 'label', text: label }), h('div', { class: 'value' }, value), h('div', { class: 'note' }, note));
  }

  function tabs() {
    return h('nav', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === k), id: 'tab-' + k,
        onclick: () => { S.tab = k; history.replaceState(null, '', '#' + k); render(); }, text: label })));
  }

  function card(title, note, actions, ...body) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', null, h('h2', { text: title }), note ? h('p', null, note) : null),
        actions && actions.length ? h('div', { class: 'actions' }, actions) : null),
      body);
  }
  const addBtn = (label, fn) => h('button', { class: 'btn primary', type: 'button', onclick: fn, text: label });
  /** The small × that deletes a row or a card at once (Undo brings it back). */
  const xBtn = (table, row, what) => h('button', {
    class: 'x-btn', type: 'button', text: '×', title: `Delete “${what}”`, 'aria-label': `Delete ${what}`,
    onclick: (e) => { e.stopPropagation(); e.currentTarget.disabled = true; quickDelete(table, row, what); },
    onkeydown: (e) => e.stopPropagation(), // Enter on the button must not also open the row
  });
  const xCell = (table, row, what) => h('td', { class: 'x' }, xBtn(table, row, what));
  const xHead = () => h('th', { class: 'x' });

  function bars(entries, total, variant) {
    if (!entries.length) return h('p', { class: 'footnote', text: 'Nothing to show yet.' });
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return h('div', { class: 'bars' }, entries.map(([name, v]) =>
      h('div', { class: 'bar-row' },
        h('div', { class: 'name', title: name, text: name }),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (variant ? ' ' + variant : ''), style: `width:${Math.max(0, (v / max) * 100).toFixed(2)}%` })),
        h('div', { class: 'amt' }, money(v), total > 0 ? h('small', { text: fmtPct.format(v / total) }) : null))));
  }

  // --- Portfolio --------------------------------------------------------------
  function renderPortfolio() {
    const p = portfolio();
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-portfolio' });
    if (!S.holdings.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'No investments yet' }),
        h('p', { text: 'Add each security you hold (ETFs, stocks, funds) with its account, or import the whole portfolio at once from an Excel file, a CSV or a Google Sheets link. Prices of public investments update every trading evening.' }),
        h('div', { class: 'card-actions' },
          addBtn('Import a portfolio', () => openHoldingsImport('public')),
          h('button', { class: 'btn', type: 'button', onclick: () => openHolding(), text: 'Add an investment' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openHolding(null, { market: 'MANUAL' }), text: 'Add a private investment' }))));
      return root;
    }
    const due = S.holdings.filter((hd) => isPrivate(hd) && sh(hd.owner) && privateDue(hd));
    const banners = [];
    const staleDays = p.oldestClose ? Math.floor((Date.now() - new Date(p.oldestClose + 'T16:00:00')) / 86400000) : null;
    if (staleDays !== null && staleDays > 4) banners.push(`Some prices are from ${fmtDate(p.oldestClose)}. Check that the daily update (GitHub Actions) is still running.`);
    if (p.atCost) banners.push(`${p.atCost} investment(s) without a price yet: they count at cost until the next update.`);
    if (p.missingFx) banners.push(`${p.missingFx} USD investment(s) left out: the USD/CAD rate is not available yet.`);
    if (due.length) banners.push(`${due.length} private investment(s) to update: ${due.map((hd) => hd.name || hd.symbol).join(', ').replace(/\.$/, '')}.`);
    for (const b of banners) root.append(h('div', { class: 'banner', text: b }));

    root.append(card('Performance', p.lastClose ? `At the closing price of ${fmtDate(p.lastClose)}` : 'Current values', null,
      h('div', { class: 'kpis' },
        kpi('Market value', money(p.mv)),
        kpi('Total cost', money(p.cost)),
        kpi('Unrealized gain', h('span', { class: cls(p.gain), text: moneySigned(p.gain) }), p.cost > 0 ? h('span', { class: cls(p.gain), text: fmtPctS.format(p.gain / p.cost) }) : null),
        kpi('Today’s change', h('span', { class: cls(p.day), text: moneySigned(p.day) }), p.mv - p.day > 0 ? h('span', { class: cls(p.day), text: fmtPctS.format(p.day / (p.mv - p.day)) }) : null))));

    const byAccount = new Map(), byTitle = new Map();
    for (const r of p.rows) {
      if (r.mv === null) continue;
      const v = r.mv * r.f;
      const acct = L(r.h.account || 'Autre');
      byAccount.set(acct, (byAccount.get(acct) || 0) + v);
      const key = r.h.market === 'CASH' ? 'Cash' : r.h.symbol.toUpperCase();
      byTitle.set(key, (byTitle.get(key) || 0) + v);
    }
    const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    const titles = sortDesc(byTitle);
    const top = titles.slice(0, 8);
    if (titles.length > 8) top.push(['Others', titles.slice(8).reduce((a, e) => a + e[1], 0)]);
    root.append(h('div', { class: 'grid' },
      card('By account', null, null, bars(sortDesc(byAccount), p.mv)),
      card('By security', null, null, bars(top, p.mv, 'muted'))));

    const sorted = [...p.rows].sort((a, b) => (b.mv ?? -1) * b.f - (a.mv ?? -1) * a.f);
    const pub = sorted.filter((r) => !isPrivate(r.h));
    const priv = sorted.filter((r) => isPrivate(r.h));
    const sum = (rows) => rows.reduce((a, r) => a + (r.mv === null ? 0 : r.mv * r.f), 0);
    const open = (hd) => ({ class: 'click', tabindex: '0', onclick: () => openHolding(hd), onkeydown: (e) => { if (e.key === 'Enter') openHolding(hd); } });
    const sharePct = (v) => h('span', { class: 'sub', text: v !== null && p.mv > 0 ? fmtPct.format(v / p.mv) : '' });

    // Same columns for public and private holdings: quantity, average cost, last price (in the holding's currency),
    // then book value, market value and gain in CAD.
    // On a phone: name, market value and gain (plus the price for listed titles).
    const holdingHead = (first, priceSm = true) => h('thead', null, h('tr', null, h('th', { text: first }),
      h('th', { class: 'r hide-sm', text: 'Quantity' }), h('th', { class: 'r hide-sm', text: 'Average cost' }), h('th', { class: priceSm ? 'r' : 'r hide-sm', text: 'Price' }),
      h('th', { class: 'r hide-sm', text: 'Book value' }), h('th', { class: 'r', text: 'Market value' }), h('th', { class: 'r', text: 'Capital gain' }), xHead()));
    const holdingCells = (r, priceNote, priceSm = true) => {
      const hd = r.h;
      const cash = hd.market === 'CASH';
      const hasCost = !cash && hd.avg_cost !== null && hd.avg_cost !== undefined && hd.avg_cost !== '';
      const shown = r.mv === null ? null : r.mv * r.f;
      const gain = r.mv === null || !hasCost ? null : (r.mv - r.cost) * r.f;
      return [
        h('td', { class: 'r hide-sm' }, cash ? '—' : fmtQty.format(num(hd.qty))),
        h('td', { class: 'r hide-sm' }, hasCost ? native(num(hd.avg_cost), hd.currency) : '—'),
        h('td', { class: priceSm ? 'r' : 'r hide-sm' }, cash ? '—' : native(r.px, hd.currency), h('span', { class: 'sub' }, cash ? null : priceNote)),
        h('td', { class: 'r hide-sm' }, gain === null ? '—' : money(r.cost * r.f)),
        h('td', { class: 'r' }, shown === null ? '—' : money(shown), sharePct(shown)),
        h('td', { class: 'r ' + cls(gain || 0) }, gain === null ? '—' : moneySigned(gain),
          h('span', { class: 'sub', text: gain !== null && r.cost > 0 ? fmtPctS.format((r.mv - r.cost) / r.cost) : '' })),
      ];
    };

    const pubBody = pub.map((r) => {
      const hd = r.h;
      let priceNote;
      if (r.src === 'close') priceNote = fmtDate(r.date, { day: 'numeric', month: 'short' });
      else if (r.src === 'cost') priceNote = h('span', { class: 'pill warn', text: 'at cost' });
      return h('tr', open(hd),
        h('td', null,
          hd.market === 'CASH' ? h('span', { class: 'ticker', text: 'CASH' }) : h('span', { class: 'ticker', text: hd.symbol.toUpperCase() }),
          ' ', hd.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null,
          hd.market === 'CASH' && num(hd.qty) < 0 ? h('span', { class: 'pill warn', text: 'margin' }) : null,
          h('span', { class: 'sub', text: [L(hd.name), L(hd.account), ownerName(hd.owner) + (r.f < 1 ? ' (50%)' : '')].filter(Boolean).join(' · ') })),
        ...holdingCells(r, priceNote), xCell('holdings', hd, hd.market === 'CASH' ? `cash · ${L(hd.account)}` : hd.symbol.toUpperCase()));
    });
    const pubLink = !!S.settings.public_sheet_url;
    root.append(card('Public investments', pub.length ? `${pub.length} position(s) · ${money(sum(pub))} · closing prices updated every trading evening` : 'Stocks, ETFs and cash: the price updates every trading evening.',
      [h('button', { class: 'btn', type: 'button', onclick: () => openHoldingsImport('public'), text: pubLink ? 'Update (Google Sheets)' : 'Import' }),
        addBtn('Add an investment', () => openHolding())],
      pub.length ? h('div', { class: 'table-wrap' }, h('table', null,
        holdingHead('Security'),
        h('tbody', null, pubBody))) : h('p', { class: 'footnote', text: 'No public investments. Import a statement from your broker (Excel or CSV) or add securities one by one.' }),
      pub.length ? h('p', { class: 'footnote', text: 'Click a row to edit it, or × to delete it (Undo brings it back). Average cost and price in the security’s currency; values and gains in CAD. The cost of USD securities is converted at today’s rate; for tax, the adjusted cost base uses the rate on the purchase date.' }) : null));

    const privBody = priv.map((r) => {
      const hd = r.h;
      const late = privateDue(hd);
      return h('tr', open(hd),
        h('td', null,
          h('strong', { text: hd.name || hd.symbol }), ' ', hd.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null,
          late ? h('span', { class: 'pill warn', text: 'needs update' }) : null,
          h('span', { class: 'sub', text: [L(hd.account), ownerName(hd.owner) + (r.f < 1 ? ' (50%)' : ''), hd.institution, FREQ_LABEL[hd.update_freq]].filter(Boolean).join(' · ') })),
        ...holdingCells(r, r.src === 'manual' ? (r.date ? 'as of ' + fmtDate(r.date) : '') : h('span', { class: 'pill warn', text: 'at cost' }), false),
        xCell('holdings', hd, hd.name || hd.symbol));
    });
    const privLink = !!S.settings.private_sheet_url;
    root.append(card('Private investments', priv.length ? `${priv.length} investment(s) · ${money(sum(priv))} · value entered by hand or imported` : 'Private funds, shares of a company, private loans, real estate units… updated every month or quarter.',
      [h('button', { class: 'btn', type: 'button', onclick: () => openHoldingsImport('private'), text: privLink ? 'Update (Google Sheets)' : 'Import / update' }),
        addBtn('Add a private investment', () => openHolding(null, { market: 'MANUAL' }))],
      priv.length ? h('div', { class: 'table-wrap' }, h('table', null,
        holdingHead('Investment', false),
        h('tbody', null, privBody))) : h('p', { class: 'footnote', text: 'No private investments. Add them one by one, or import a sheet with one row per investment (name, value, amount invested, date).' }),
      priv.length ? h('p', { class: 'footnote', text: 'To update: click a row, or import a new version of the file or link. Rows it recognizes are updated, new ones are added.' }) : null));
    if (!S.outdated) root.append(allocationCard(p), tradesCard(), roomCard());
    return root;
  }
  // --- Asset allocation ---------------------------------------------------------
  const CLASSES = { equity: 'Stocks', bond: 'Bonds', cash: 'Cash', real_estate: 'Real estate', other: 'Other' };
  const CLASS_COLORS = { equity: 'var(--accent)', bond: 'var(--gain)', cash: 'var(--muted)', real_estate: 'var(--warn)', other: 'var(--loss)' };
  // Common Canadian all-in-one and single-class ETFs. Anything else listed on a market counts as stocks.
  const ETF_MIX = (() => {
    const m = {};
    const put = (list, mix) => list.split(' ').forEach((t) => { m[t] = mix; });
    put('XEQT VEQT ZEQT HEQT TEQT', { equity: 1 });
    put('XGRO VGRO ZGRO TGRO', { equity: 0.8, bond: 0.2 });
    put('XBAL VBAL ZBAL TBAL', { equity: 0.6, bond: 0.4 });
    put('XCNS VCNS ZCON', { equity: 0.4, bond: 0.6 });
    put('XINC VCIP ZINC', { equity: 0.2, bond: 0.8 });
    put('ZAG XBB VAB ZDB XSB VSB ZFL XQB ZCPB HBB QBB XSH ZSB VSC ZST', { bond: 1 });
    put('CASH PSA ZMMK HSAV CBIL HISA MNY CSAV UMMF', { cash: 1 });
    put('ZRE XRE VRE CGR', { real_estate: 1 });
    return m;
  })();
  /** How a holding splits across asset classes: the class chosen for it, else the ETF list, else by market. */
  function holdingMix(hd) {
    if (hd.asset_class && CLASSES[hd.asset_class]) return { [hd.asset_class]: 1 };
    if (hd.market === 'CASH') return { cash: 1 };
    if (hd.market === 'MANUAL' || hd.market === 'CRYPTO') return { other: 1 };
    return ETF_MIX[String(hd.symbol || '').toUpperCase()] || { equity: 1 };
  }

  function allocationCard(p) {
    const totals = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
    for (const r of p.rows) {
      if (r.mv === null) continue;
      for (const [k, w] of Object.entries(holdingMix(r.h))) totals[k] += r.mv * r.f * w;
    }
    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    if (!(total > 0)) return '';
    const targets = S.settings.allocation_targets || null;
    // Margin (negative cash) shows as a negative cash line: the other classes then add up to more than 100 %.
    const rows = Object.entries(CLASSES).filter(([k]) => Math.abs(totals[k]) > 0.5 || (targets && num(targets[k]) > 0)).map(([k, label]) => {
      const cur = totals[k] / total;
      const tgt = targets ? num(targets[k]) / 100 : null;
      const diff = tgt === null ? null : tgt * total - totals[k];
      return h('div', { class: 'alloc-row' },
        h('div', { class: 'name', text: label }),
        h('div', { class: 'bar-track' },
          h('div', { class: 'bar-fill', style: `width:${(Math.max(0, cur) * 100).toFixed(2)}%; background:${CLASS_COLORS[k]}` }),
          tgt !== null ? h('div', { class: 'target-mark', style: `left:${(tgt * 100).toFixed(2)}%`, title: `Target ${fmtPct.format(tgt)}` }) : null),
        h('div', { class: 'amt' }, `${fmtPct.format(cur)}`, h('small', { text: money(totals[k]) })),
        diff === null ? null : h('div', { class: 'amt ' + (Math.abs(diff) < total * 0.01 ? '' : diff > 0 ? 'up' : 'down') },
          Math.abs(diff) < total * 0.01 ? 'on target' : `${diff > 0 ? 'buy' : 'sell'} ${money(Math.abs(diff))}`, h('small', { text: `target ${fmtPct.format(tgt)}` })));
    });
    return card('Asset allocation', targets ? 'Current (bar) and target (line), with what to buy or sell to get back to the target' : 'By the type of each investment (all-in-one ETFs are split by what they hold)',
      [h('button', { class: 'btn', type: 'button', onclick: openTargets, text: targets ? 'Edit the target' : 'Set a target' })],
      h('div', { class: 'alloc' }, rows),
      h('p', { class: 'footnote', text: 'Click an investment to change its category. Private investments count as “Other” until you give them a category. To rebalance without tax, favour new deposits and TFSA or RRSP accounts.' }));
  }

  function openTargets() {
    const t = S.settings.allocation_targets || { equity: 80, bond: 20, cash: 0, real_estate: 0, other: 0 };
    openForm({
      title: 'Target allocation (%)',
      values: { ...t },
      fields: Object.entries(CLASSES).map(([k, label]) => ({ k, label, type: 'num' })),
      onSave: async (out) => {
        const clean = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, out[k] || 0]));
        const sum = Object.values(clean).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.5) throw new Error(`The total must be 100% (now ${fmtYears.format(sum)}%).`);
        await saveSettings({ allocation_targets: clean });
      },
    });
  }

  // --- Buys, sells and realized gains ------------------------------------------
  const TAX_SHELTERED = ['CELI', 'REER', 'CELIAPP', 'REEE', 'FERR', 'CRI / FRV'];
  const INCLUSION = 0.5; // capital gains inclusion rate
  const fxNow = () => num((S.prices['FX:USDCAD'] || {}).close) || null;

  function tradesCard() {
    const year = new Date().getFullYear();
    const mine = S.transactions.filter((t) => sh(t.owner));
    const sells = mine.filter((t) => t.kind === 'sell' && t.realized_gain !== null && t.realized_gain !== undefined);
    const byYear = new Map();
    for (const t of sells) {
      const y = Number(String(t.trade_date).slice(0, 4));
      const e = byYear.get(y) || { taxable: 0, sheltered: 0, company: 0 };
      const g = num(t.realized_gain) * sh(t.owner);
      if (TAX_SHELTERED.includes(t.account)) e.sheltered += g; else if (t.account === 'Société') e.company += g; else e.taxable += g;
      byYear.set(y, e);
    }
    const cur = byYear.get(year) || { taxable: 0, sheltered: 0, company: 0 };
    const kindLabel = { buy: 'Buy', sell: 'Sell' };
    const list = mine.slice(0, 15).map((t) => clickRow(() => openTrade(t),
      h('td', null, `${kindLabel[t.kind]} ${t.symbol}`, h('span', { class: 'sub', text: [L(t.account), ownerName(t.owner), fmtDate(t.trade_date)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r' }, `${fmtQty.format(num(t.qty))} × ${native(num(t.price), t.currency)}`, h('span', { class: 'sub', text: num(t.fees) ? `fees ${native(num(t.fees), t.currency)}` : '' })),
      h('td', { class: 'r ' + (t.kind === 'sell' ? cls(num(t.realized_gain)) : '') }, t.kind === 'sell' ? moneySigned(num(t.realized_gain)) : '—',
        h('span', { class: 'sub', text: t.kind === 'sell' ? (TAX_SHELTERED.includes(t.account) ? 'sheltered' : t.account === 'Société' ? 'in the company' : 'taxable') : '' })),
      xCell('transactions', t, `${kindLabel[t.kind]} ${t.symbol}`)));
    return card('Trades and realized gains', 'A buy or a sell updates the quantity and average cost of the investment', [addBtn('Buy or sell', () => openTrade())],
      h('div', { class: 'kpis' },
        kpi(`Taxable gains ${year}`, h('span', { class: cls(cur.taxable), text: moneySigned(cur.taxable) }), cur.taxable > 0 ? `${money(cur.taxable * INCLUSION)} to report (50%)` : 'non-registered accounts'),
        kpi('In sheltered accounts', moneySigned(cur.sheltered), 'TFSA, RRSP…: no tax'),
        cur.company ? kpi('In the company', moneySigned(cur.company), 'taxed in the company') : null,
        [...byYear.keys()].filter((y) => y !== year).length ? kpi('Previous years', moneySigned([...byYear.entries()].filter(([y]) => y !== year).reduce((a, [, e]) => a + e.taxable, 0)), 'taxable gains') : null),
      list.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Trade' }), h('th', { class: 'r', text: 'Quantity × price' }), h('th', { class: 'r', text: 'Realized gain' }), xHead())),
        h('tbody', null, list))) : h('p', { class: 'footnote', text: 'No trades. Sells work out the gain or loss from the average cost (adjusted cost base).' }),
      h('p', { class: 'footnote', text: 'Gain = sale proceeds minus fees, minus average cost × quantity sold. USD securities: converted at the rate on the trade date (approximate: for tax, the cost uses the rate of each purchase). Watch out for superficial losses (buying back within 30 days). Your broker’s slip (T5008) is the official figure.' }));
  }

  /** Records a buy or a sell and updates the holding. Editing an existing one only changes its note and date. */
  function openTrade(t) {
    if (t) {
      return openForm({
        title: `${t.kind === 'buy' ? 'Buy' : 'Sell'} of ${t.symbol}`,
        values: { trade_date: t.trade_date, note: t.note },
        fields: [
          { k: 'trade_date', label: 'Date', type: 'date' },
          { k: 'note', label: 'Note', type: 'text', wide: true, hint: 'Deleting a trade does not change the investment: fix the quantity or cost in the investment itself.' },
        ],
        onSave: (out) => saveRow('transactions', { id: t.id, ...out }),
        onDelete: () => deleteRow('transactions', t.id),
      });
    }
    const choices = { '': 'New security…' };
    for (const hd of S.holdings.filter((x) => x.market !== 'CASH')) choices[hd.id] = `${hd.market === 'MANUAL' ? hd.name || hd.symbol : hd.symbol} · ${L(hd.account)} · ${ownerName(hd.owner)}`;
    const firstId = Object.keys(choices)[1] || '';
    const marketOpts = Object.fromEntries(Object.entries(MARKETS).filter(([k]) => k !== 'CASH').map(([k, m]) => [k, m.label]));
    openForm({
      title: 'Buy or sell',
      values: { holding: firstId, kind: 'buy', trade_date: todayISO(), market: 'TSX', account: 'CELI', owner: S.who === 'all' ? 'p1' : S.who, fx_rate: fxNow() ? String(fxNow()) : '' },
      fields: [
        { k: 'holding', label: 'Investment', type: 'select', options: choices, wide: true },
        { k: 'kind', label: 'Type', type: 'select', options: { buy: 'Buy', sell: 'Sell' }, show: (s) => !!s.holding, clearWhenHidden: false },
        { k: 'symbol', label: 'Symbol', type: 'text', upper: true, req: true, show: (s) => !s.holding, placeholder: 'XEQT' },
        { k: 'market', label: 'Market', type: 'select', options: marketOpts, show: (s) => !s.holding },
        { k: 'account', label: 'Account', type: 'select', options: ACCOUNTS, show: (s) => !s.holding },
        { k: 'owner', label: 'Owner', type: 'owner', show: (s) => !s.holding },
        { k: 'trade_date', label: 'Date', type: 'date' },
        { k: 'qty', label: 'Quantity', type: 'num', req: true },
        { k: 'price', label: 'Price per unit', type: 'num', req: true, hint: 'In the security’s currency' },
        { k: 'fees', label: 'Fees (optional)', type: 'num' },
        { k: 'fx_rate', label: 'USD/CAD rate that day', type: 'num', show: (s) => {
          const hd = S.holdings.find((x) => x.id === s.holding);
          return hd ? hd.currency === 'USD' : s.market === 'US';
        } },
        { k: 'note', label: 'Note (optional)', type: 'text', wide: true },
      ],
      onSave: async (out) => {
        const qty = out.qty, price = out.price, fees = out.fees || 0;
        if (!(qty > 0)) throw new Error('The quantity must be greater than zero.');
        let hd = S.holdings.find((x) => x.id === out.holding) || null;
        const kind = hd ? out.kind : 'buy';
        const currency = hd ? hd.currency : MARKETS[out.market].cur || 'CAD';
        const fx = currency === 'USD' ? (out.fx_rate || fxNow() || 1) : 1;
        const base = { trade_date: out.trade_date || todayISO(), kind, qty, price, fees, currency, fx_rate: currency === 'USD' ? fx : null, note: out.note };
        if (!hd) {
          const row = { market: out.market, symbol: out.symbol, currency, qty, avg_cost: (qty * price + fees) / qty, account: out.account, owner: out.owner };
          if (out.market === 'MANUAL') { row.manual_price = price; row.manual_price_date = base.trade_date; }
          const [created] = await insertRows('holdings', [row]);
          await saveRow('transactions', { ...base, holding_id: created ? created.id : null, symbol: out.symbol, account: out.account, owner: out.owner });
          return;
        }
        const q = num(hd.qty), avg = num(hd.avg_cost);
        const tx = { ...base, holding_id: hd.id, symbol: hd.market === 'MANUAL' ? hd.name || hd.symbol : hd.symbol, account: hd.account, owner: hd.owner };
        if (kind === 'buy') {
          const upd = { qty: q + qty, avg_cost: (q * avg + qty * price + fees) / (q + qty) };
          if (hd.market === 'MANUAL') { upd.manual_price = price; upd.manual_price_date = base.trade_date; }
          await saveRow('holdings', { id: hd.id, ...upd });
          await saveRow('transactions', tx);
          return;
        }
        if (qty > q + 1e-9) throw new Error(`You only hold ${fmtQty.format(q)} units of this investment.`);
        tx.acb_per_unit = avg * fx;
        tx.realized_gain = Math.round(((qty * price - fees) * fx - qty * avg * fx) * 100) / 100;
        await saveRow('transactions', tx);
        if (q - qty < 1e-9) await deleteRow('holdings', hd.id); // all sold
        else await saveRow('holdings', { id: hd.id, qty: q - qty });
      },
    });
  }

  // --- CELI / REER room ---------------------------------------------------------
  const PLAN_LABEL = { CELI: 'TFSA', REER: 'RRSP' };
  /** Room left for one person and plan in a year, from the room entered and the movements of that year. */
  function roomStatus(owner, plan, year) {
    const rows = S.contributions.filter((c) => c.owner === owner && c.plan === plan && Number(c.year) === year);
    const roomRow = rows.filter((c) => c.kind === 'room').at(-1);
    const sum = (k) => rows.filter((c) => c.kind === k).reduce((t, c) => t + num(c.amount), 0);
    const room = roomRow ? num(roomRow.amount) : null;
    const contributed = sum('contribution'), withdrawn = sum('withdrawal');
    const left = room === null ? null : room - contributed;
    const next = plan === 'CELI' && left !== null ? left + withdrawn + T().PARAMS.tfsaLimit : null;
    return { room, contributed, withdrawn, left, next };
  }

  function roomCard() {
    const year = new Date().getFullYear();
    const people = S.who === 'all' ? ['p1', 'p2'] : S.who === 'joint' ? [] : [S.who];
    const block = (owner, plan) => {
      const st = roomStatus(owner, plan, year);
      const over = st.left !== null && st.left < (plan === 'REER' ? -2000 : 0);
      const used = st.room ? Math.min(1, st.contributed / st.room) : 0;
      return h('div', { class: 'room' },
        h('div', { class: 'room-top' }, h('strong', { text: `${PLAN_LABEL[plan]} · ${ownerName(owner)}` }),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openContribution(null, { owner, plan, year }), text: '+ Entry' })),
        st.room === null
          ? h('p', { class: 'footnote' }, 'Room not entered yet. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openContribution(null, { owner, plan, year, kind: 'room' }); },
            text: plan === 'CELI' ? 'Enter your room on January 1' : 'Enter your deduction limit' }),
            plan === 'CELI' ? ' (CRA My Account).' : ' (CRA notice of assessment).')
          : h('div', null,
            h('div', { class: 'big' + (over ? ' down' : ''), text: money(st.left) }),
            h('div', { class: 'muted-caption', text: over ? 'over-contribution: 1% penalty per month' : `still allowed in ${year}` }),
            h('div', { class: 'progress' + (over ? ' over' : ''), role: 'progressbar', 'aria-valuenow': Math.round(used * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(used * 100).toFixed(1)}%` })),
            h('div', { class: 'footnote', style: 'margin-top:4px', text: `${money(st.contributed)} contributed of ${money(st.room)}${st.withdrawn ? ` · ${money(st.withdrawn)} withdrawn` : ''}` }),
            st.next !== null ? h('div', { class: 'footnote', text: `On January 1, ${year + 1}: about ${money(st.next)} (${year} withdrawals + ${money(T().PARAMS.tfsaLimit)} of new room)` }) : null));
    };
    const recent = S.contributions.filter((c) => people.includes(c.owner)).slice().sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))).slice(0, 8);
    const kindLabel = { room: 'Room', contribution: 'Contribution', withdrawal: 'Withdrawal' };
    return card(`Contribution room ${year}`, 'Each person’s TFSA and RRSP, from the CRA amounts and your entries', null,
      people.length ? h('div', { class: 'rooms' }, people.flatMap((p) => [block(p, 'CELI'), block(p, 'REER')])) : h('p', { class: 'footnote', text: 'Pick a person at the top to see their room.' }),
      recent.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, recent.map((c) => clickRow(() => openContribution(c),
        h('td', null, `${PLAN_LABEL[c.plan]} ${kindLabel[c.kind].toLowerCase()}`, h('span', { class: 'sub', text: `${ownerName(c.owner)} · year ${c.year}${c.note ? ' · ' + c.note : ''}` })),
        h('td', { class: 'r' }, (c.kind === 'withdrawal' ? '− ' : '') + money(num(c.amount)), h('span', { class: 'sub', text: fmtDate(c.entry_date) })),
        xCell('contributions', c, `${PLAN_LABEL[c.plan]} ${kindLabel[c.kind].toLowerCase()} ${money(num(c.amount))}`)))))) : null,
      h('p', { class: 'footnote', text: `RRSP: a contribution made in the first 60 days of the year can count for the year before (pick the year in the form); a $2,000 over-contribution is allowed. TFSA: a withdrawal gives the room back only on the next January 1. New TFSA room ${year}: ${money(T().PARAMS.tfsaLimit)}; RRSP limit ${year}: ${money(T().PARAMS.rrspLimit)}.` }));
  }

  function openContribution(c, preset = {}) {
    const year = new Date().getFullYear();
    const v = c ? { ...c, year: String(c.year) } : { owner: 'p1', plan: 'CELI', kind: 'contribution', year: String(year), entry_date: todayISO(), ...preset };
    if (!c && preset.year) v.year = String(preset.year);
    openForm({
      title: c ? 'Edit the entry' : v.kind === 'room' ? 'Enter the room' : 'Add an entry',
      values: v,
      fields: [
        { k: 'owner', label: 'Person', type: 'select', options: { p1: S.settings.p1_name, p2: S.settings.p2_name } },
        { k: 'plan', label: 'Plan', type: 'select', options: PLAN_LABEL },
        { k: 'kind', label: 'Type', type: 'select', options: (s) => (s.plan === 'CELI' ? { contribution: 'Contribution', withdrawal: 'Withdrawal', room: 'Room on January 1' } : { contribution: 'Contribution', room: 'Deduction limit (notice of assessment)' }) },
        { k: 'year', label: 'For year', type: 'select', options: () => [String(year + 1), String(year), String(year - 1)] },
        { k: 'amount', label: 'Amount', type: 'num', req: true },
        { k: 'entry_date', label: 'Date', type: 'date' },
        { k: 'note', label: 'Note (optional)', type: 'text', wide: true, placeholder: 'Wealthsimple, automatic transfer…' },
      ],
      onSave: (out) => saveRow('contributions', { ...out, id: c && c.id, year: Number(out.year), entry_date: out.entry_date || todayISO() }),
      onDelete: c ? () => deleteRow('contributions', c.id) : null,
    });
  }

  const isPrivate = (hd) => hd.market === 'MANUAL';
  const FREQ_LABEL = { monthly: 'every month', quarterly: 'every quarter' };
  const FREQ_DAYS = { monthly: 35, quarterly: 100 }; // a little slack past the month or quarter
  /** A private holding whose value is older than its update rhythm. */
  function privateDue(hd) {
    const limit = FREQ_DAYS[hd.update_freq];
    if (!limit) return false;
    const d = hd.manual_price_date || String(hd.updated_at || '').slice(0, 10);
    return !d || (Date.now() - new Date(d + 'T12:00:00')) / 86400000 > limit;
  }
  function kpi(label, value, note) {
    return h('div', { class: 'kpi' }, h('div', { class: 'label', text: label }), h('div', { class: 'value' }, value), note ? h('div', { class: 'note' }, note) : null);
  }

  // --- Actifs ------------------------------------------------------------------
  function renderActifs() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-actifs' });
    const t = currentTotals();
    const chartBox = h('div', { class: 'chart', id: 'networth-chart' });
    const rangeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' },
      [['3m', '3 months'], ['1y', '1 year'], ['all', 'All']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(S.range === k), onclick: () => { S.range = k; storeSet('range', k); render(); }, text: label })));
    root.append(card('Net worth over time', 'One point per trading evening, saved by the automatic update.',
      [rangeSeg, h('button', { class: 'btn', type: 'button', onclick: saveSnapshotNow, text: 'Save today' })],
      chartBox,
      h('div', { class: 'legend' },
        h('span', { style: '--c: var(--accent)', text: 'Net worth' }),
        h('span', { style: '--c: var(--series-2)', text: 'Assets' }),
        h('span', { style: '--c: var(--loss)', text: 'Debts' }))));
    requestAnimationFrame(() => drawNetWorth(chartBox));

    const otherByKind = new Map();
    for (const a of S.assets) {
      const f = sh(a.owner);
      if (f) otherByKind.set(L(a.kind || 'Autre'), (otherByKind.get(L(a.kind || 'Autre')) || 0) + num(a.value) * f);
    }
    const assetEntries = [['Investments', t.inv], ...[...otherByKind.entries()].sort((a, b) => b[1] - a[1])].filter((e) => e[1] > 0);
    const assetTotal = t.inv + t.oth;
    root.append(h('div', { class: 'grid' },
      card('What you own', `Total ${money(assetTotal)}`, null, bars(assetEntries, assetTotal)),
      card('What you owe', `Total ${money(t.debt)}`, null,
        bars(debtsView().rows.map((r) => [r.d.name, num(r.d.balance) * r.f]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]), t.debt, 'loss'))));

    const rows = S.assets.filter((a) => sh(a.owner)).map((a) =>
      h('tr', { class: 'click', tabindex: '0', onclick: () => openAsset(a), onkeydown: (e) => { if (e.key === 'Enter') openAsset(a); } },
        h('td', null, a.name, h('span', { class: 'sub', text: `${L(a.kind)} · ${ownerName(a.owner)}${sh(a.owner) < 1 ? ' (50%)' : ''}` })),
        h('td', { class: 'r hide-sm', text: fmtDate(a.as_of) }),
        h('td', { class: 'r', text: money(num(a.value) * sh(a.owner)) }),
        xCell('assets', a, a.name)));
    root.append(card('Other assets', 'House, bank accounts, vehicles… Update the value from time to time.', [addBtn('Add an asset', () => openAsset())],
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Asset' }), h('th', { class: 'r hide-sm', text: 'Value as of' }), h('th', { class: 'r', text: 'Value' }), xHead())),
          h('tbody', null, rows)))
        : h('p', { class: 'footnote', text: 'No other assets entered. Investments are already counted in the Portfolio tab.' })));
    return root;
  }

  async function saveSnapshotNow() {
    const data = C.snapshotData({ holdings: S.holdings, prices: S.prices, assets: S.assets, debts: S.debts });
    const res = await sb.from('snapshots').upsert({ snap_date: todayISO(), data, source: 'manuel' }, { onConflict: 'snap_date' });
    if (res.error) return toast(errText(res.error), true);
    toast('Today’s point saved');
    refresh();
  }

  function drawNetWorth(box) {
    const key = S.who;
    let snaps = S.snapshots.filter((x) => x.data && x.data[key]);
    if (S.range !== 'all') {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - (S.range === '3m' ? 3 : 12));
      const c = cutoff.toLocaleDateString('en-CA');
      snaps = snaps.filter((x) => x.snap_date >= c);
    }
    if (snaps.length < 2) {
      box.replaceChildren(h('div', { class: 'empty' },
        h('strong', { text: snaps.length ? 'Only one point so far' : 'The chart fills in by itself' }),
        h('p', { text: 'The automatic update adds a point every trading evening. You can also click “Save today”.' })));
      return;
    }
    const pts = snaps.map((x) => ({ t: new Date(x.snap_date + 'T12:00:00').getTime(), date: x.snap_date, d: x.data[key] }));
    const series = [
      { name: 'Net worth', color: 'var(--accent)', get: (p) => num(p.d.net), area: true, width: 2.5 },
      { name: 'Assets', color: 'var(--series-2)', get: (p) => num(p.d.inv) + num(p.d.oth), width: 1.75 },
      { name: 'Debts', color: 'var(--loss)', get: (p) => num(p.d.debt), width: 1.75 },
    ];
    lineChart(box, pts, series);
  }

  function niceTicks(a, b, n) {
    if (a === b) { b = a + 1; }
    const step0 = (b - a) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const e = step0 / mag;
    const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
    const lo = Math.floor(a / step) * step;
    const hi = Math.ceil(b / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  let measureCtx;
  function textWidth(t) {
    if (measureCtx === undefined) {
      try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
    }
    if (!measureCtx) return t.length * 6.5;
    measureCtx.font = '11px Nunito, system-ui, sans-serif';
    return measureCtx.measureText(t).width;
  }

  /**
   * series: [{ name, color, get, area?, width?, dash? }] and bands: [{ name, color, lo, hi }] (shaded range).
   * opts: { label (aria), dateLabel(p) for the tooltip, years: true for a yearly x axis }.
   */
  function lineChart(box, pts, series, bands = [], opts = {}) {
    const W = Math.max(280, Math.round(box.clientWidth || 600));
    const H = Math.round(Math.min(320, Math.max(220, W * 0.4)));
    const vals = pts.flatMap((p) => [...series.map((sr) => sr.get(p)), ...bands.flatMap((b) => [b.lo(p), b.hi(p)])]);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals), 4);
    const labels = ticks.map((v) => fmtC.format(v));
    const ml = Math.ceil(Math.max(...labels.map(textWidth))) + 12, mr = 14, mt = 10, mb = 28;
    const t0 = pts[0].t, t1 = pts.at(-1).t;
    const x = (t) => ml + ((t - t0) / (t1 - t0)) * (W - ml - mr);
    const y0 = ticks[0], y1 = ticks.at(-1);
    const y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * (H - mt - mb);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label || 'Net worth over time' });
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    svg.append(s('defs', null, s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      [[0, 0.22], [0.5, 0.08], [1, 0]].map(([o, a]) => s('stop', { offset: o, style: `stop-color: var(--accent); stop-opacity: ${a}` })))));
    ticks.forEach((v, i) => {
      svg.append(s('line', { class: 'grid-line', x1: ml, x2: W - mr, y1: y(v), y2: y(v) }));
      svg.append(s('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end' }, labels[i]));
    });
    const spanDays = (t1 - t0) / 86400000;
    const dfmt = opts.years || spanDays > 3 * 365 ? { year: 'numeric' } : spanDays > 200 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
    const nx = Math.max(2, Math.min(5, Math.floor((W - ml - mr) / 90)));
    let lastRight = -Infinity;
    for (let i = 0; i < nx; i++) {
      const t = t0 + ((t1 - t0) * i) / (nx - 1);
      const label = new Intl.DateTimeFormat('en-CA', dfmt).format(new Date(t));
      const w = textWidth(label);
      let cx = x(t);
      const anchor = i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle';
      const left = anchor === 'start' ? cx : anchor === 'end' ? cx - w : cx - w / 2;
      if (left < lastRight + 8) continue;
      lastRight = left + w;
      svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': anchor }, label));
    }
    for (const b of bands) {
      const top = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(b.hi(p)).toFixed(1)}`).join('');
      const bottom = [...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(b.lo(p)).toFixed(1)}`).join('');
      svg.append(s('path', { d: top + bottom + 'Z', style: `fill:${b.color}; opacity: 0.16`, stroke: 'none' }));
    }
    for (const sr of series) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(sr.get(p)).toFixed(1)}`).join('');
      if (sr.area) svg.append(s('path', { d: `${d}L${x(t1).toFixed(1)},${y(Math.max(y0, 0))}L${x(t0).toFixed(1)},${y(Math.max(y0, 0))}Z`, fill: `url(#${gid})`, stroke: 'none' }));
      svg.append(s('path', { d, fill: 'none', style: `stroke:${sr.color}`, 'stroke-width': sr.width, 'stroke-dasharray': sr.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    const last = pts.at(-1);
    svg.append(s('circle', { cx: x(last.t), cy: y(series[0].get(last)), r: 4, style: 'fill: var(--accent); stroke: var(--surface); stroke-width: 2' }));
    const hover = s('g', { visibility: 'hidden' });
    const hl = s('line', { class: 'hover-line', y1: mt, y2: H - mb });
    const dots = series.map((sr) => s('circle', { r: 3.5, style: `fill:${sr.color}; stroke: var(--surface); stroke-width: 1.5` }));
    hover.append(hl, ...dots);
    svg.append(hover);
    const overlay = s('rect', { x: ml, y: mt, width: W - ml - mr, height: H - mt - mb, fill: 'transparent' });
    svg.append(overlay);
    const tip = h('div', { class: 'tip', hidden: true });
    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const dd = Math.abs(x(p.t) - px); if (dd < bd) { bd = dd; best = i; } });
      const p = pts[best];
      const cx = x(p.t);
      hl.setAttribute('x1', cx); hl.setAttribute('x2', cx);
      series.forEach((sr, i) => { dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', y(sr.get(p))); });
      hover.setAttribute('visibility', 'visible');
      tip.replaceChildren(h('div', { class: 'd', text: opts.dateLabel ? opts.dateLabel(p) : fmtDate(p.date) }),
        ...series.map((sr) => h('div', { class: 'row', style: `--c:${sr.color}`, text: `${sr.name} ${money(sr.get(p))}` })),
        ...bands.map((b) => h('div', { class: 'row', style: `--c:${b.color}`, text: `${b.name} ${money(b.lo(p))} to ${money(b.hi(p))}` })));
      tip.hidden = false;
      const scale = rect.width / W;
      const tw = tip.offsetWidth;
      let left = cx * scale + 12;
      if (left + tw > rect.width) left = cx * scale - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = mt * scale + 'px';
    }
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerdown', move);
    overlay.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    box.style.minHeight = H + 'px';
    box.replaceChildren(svg, tip);
  }

  // --- Budget -----------------------------------------------------------------
  const clickRow = (fn, ...cells) => h('tr', { class: 'click', tabindex: '0', onclick: fn, onkeydown: (e) => { if (e.key === 'Enter') fn(); } }, cells);
  const ownerNote = (o, f) => ownerName(o) + (f < 1 ? ' (50%)' : '');
  const childName = (id) => (S.children.find((c) => c.id === id) || {}).name;
  const monthLabel = (m) => new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' }).format(new Date(m + '-15T12:00:00'));
  function shiftMonth(m, delta) {
    const d = new Date(m + '-15T12:00:00');
    d.setMonth(d.getMonth() + delta);
    return d.toLocaleDateString('en-CA').slice(0, 7);
  }

  function renderBudget() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-budget' });
    const b = budgetView();
    const toggle = h('label', { class: 'switch' },
      h('input', { type: 'checkbox', id: 'include-debts', checked: S.settings.include_debt_payments ? true : null,
        onchange: async (e) => {
          try { await saveSettings({ include_debt_payments: e.target.checked }); } catch (err) { return toast(errText(err), true); }
          refresh();
        } }),
      'Include payments from the Debts tab');

    root.append(card('Monthly budget', 'Amounts brought to a month (every 2 weeks × 26 ÷ 12, weekly × 52 ÷ 12, yearly ÷ 12).', [toggle],
      h('div', { class: 'kpis' },
        kpi('Income', money(b.inc)),
        kpi('Fixed expenses', money(b.fixedTotal + b.debtTotal), b.debtTotal ? `including ${money(b.debtTotal)} of debts` : null),
        kpi('Planned variable', money(b.varPlanned)),
        kpi('Surplus', h('span', { class: cls(b.surplus), text: moneySigned(b.surplus) })),
        kpi('Savings rate', b.rate === null ? '—' : fmtPct.format(b.rate), 'Surplus + planned savings, divided by income'))));

    const groups = [...b.byGroup.entries()].sort((x, y) => y[1] - x[1]);
    root.append(card('Where the money goes', 'Fixed expenses, variable envelopes and debt payments, per month.', null, bars(groups, b.exp)));

    const head = (title) => h('thead', null, h('tr', null, h('th', { text: title }), h('th', { class: 'r hide-sm', text: 'Amount' }), h('th', { class: 'r', text: 'Per month' }), xHead()));
    const line = (r) => clickRow(() => openBudget(r.b),
      h('td', null, r.b.name, h('span', { class: 'sub', text: [r.b.child_id ? childName(r.b.child_id) : null, L(r.b.grp), ownerNote(r.b.owner, r.f)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r hide-sm' }, native(num(r.b.amount), 'CAD'), h('span', { class: 'sub', text: (FREQS[r.b.freq] || FREQS.monthly).label + (isGross(r.b) ? ' · gross' : '') })),
      h('td', { class: 'r', text: money(r.m * r.f) }),
      xCell('budget_items', r.b, r.b.name));
    const total = (v) => h('tfoot', null, h('tr', null, h('td', { text: 'Total' }), h('td', { class: 'hide-sm' }), h('td', { class: 'r', text: money(v) }), h('td', { class: 'x' })));
    const importBtn = h('button', { class: 'btn', type: 'button', onclick: openImport, text: 'Import statements' });

    root.append(card('Income', null, [addBtn('Add income', () => openBudget({ kind: 'income' }))],
      b.income.length
        ? [h('div', { class: 'table-wrap' }, h('table', null, head('Source'), h('tbody', null, b.income.map(line)), total(b.inc))),
          b.income.some((r) => isGross(r.b))
            ? h('p', { class: 'footnote', text: 'Gross income: “Per month” is an estimate after tax and contributions (QPP, QPIP, HSF), worked out per person from their gross Budget income only. Not modelled: deductions (RRSP, expenses), credits, other income and the tax actually withheld at source.' })
            : null]
        : h('p', { class: 'footnote', text: 'Add salaries (gross or net), allowances and other income, or import a statement to detect them.' })));

    const fixedRows = [...b.fixed].sort((x, y) => L(x.b.grp).localeCompare(L(y.b.grp), 'en') || y.m - x.m).map(line);
    const debtRows = b.debtLines.map((d) => h('tr', null,
      h('td', null, d.name, h('span', { class: 'sub' }, 'Debt payments · ', h('span', { class: 'pill info', text: 'auto' }))),
      h('td', { class: 'r hide-sm', text: '—' }), h('td', { class: 'r', text: money(d.m) }), h('td', { class: 'x' })));
    root.append(card('Fixed expenses', 'What comes back every month: rent, electricity, Internet, insurance… Children’s expenses go in the Children tab.',
      [importBtn, addBtn('Add', () => openBudget({ kind: 'expense', nature: 'fixed' }))],
      fixedRows.length || debtRows.length
        ? h('div', { class: 'table-wrap' }, h('table', null, head('Expense'), h('tbody', null, fixedRows, debtRows), total(b.fixedTotal + b.debtTotal)))
        : h('p', { class: 'footnote', text: 'No fixed expenses. The quickest way: “Import statements” with 2 or 3 months of RBC transactions.' })));

    root.append(variableCard(b));
    return root;
  }

  function variableCard(b) {
    const lv = logView(S.month);
    const planned = new Map();
    for (const r of b.envelopes) planned.set(r.b.grp, (planned.get(r.b.grp) || 0) + r.m * r.f);
    const grps = new Set([...planned.keys(), ...[...lv.monthByGrp.keys(), ...lv.ytdByGrp.keys()].filter((g) => !isChildGroup(g))]);
    const rows = [...grps].sort((a, c) => (planned.get(c) || 0) - (planned.get(a) || 0) || L(a).localeCompare(L(c), 'en')).map((g) => {
      const p = planned.get(g) || 0;
      const spent = lv.monthByGrp.get(g) || 0;
      const ytdP = p * lv.monthIndex;
      const ytdS = lv.ytdByGrp.get(g) || 0;
      const env = b.envelopes.find((r) => r.b.grp === g);
      const over = p > 0 && spent > p;
      return clickRow(() => (env ? openBudget(env.b) : openBudget({ kind: 'expense', nature: 'variable', grp: g })),
        h('td', null, L(g), p ? null : h('span', { class: 'sub' }, h('span', { class: 'pill warn', text: 'not budgeted' }))),
        h('td', { class: 'r', text: p ? money(p) : '—' }),
        h('td', { class: 'r' + (over ? ' down' : '') }, money(spent), p ? h('span', { class: 'sub', text: fmtPct.format(spent / p) }) : null),
        h('td', { class: 'r hide-sm' }, money(ytdS), h('span', { class: 'sub', text: ytdP ? 'of ' + money(ytdP) : '' })),
        env ? xCell('budget_items', env.b, `${L(g)} envelope`) : h('td', { class: 'x' }));
    });
    const childSpent = [...lv.monthByGrp.entries()].filter(([g]) => isChildGroup(g)).reduce((a, [, v]) => a + v, 0);
    const monthTotal = [...lv.monthByGrp.values()].reduce((a, v) => a + v, 0);
    const entries = lv.inMonth.map(({ e, f }) => clickRow(() => openExpense(e),
      h('td', null, e.label, h('span', { class: 'sub', text: [fmtDate(e.spend_date, { day: 'numeric', month: 'short' }), L(e.grp), e.child_id ? childName(e.child_id) : null, ownerNote(e.owner, f)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r', text: money(num(e.amount) * f) }),
      xCell('expense_log', e, e.label)));
    const nav = h('div', { class: 'seg', role: 'group', 'aria-label': 'Month' },
      h('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => { S.month = shiftMonth(S.month, -1); render(); }, text: '‹' }),
      h('button', { type: 'button', 'aria-pressed': 'true', text: monthLabel(S.month) }),
      h('button', { type: 'button', 'aria-label': 'Next month', onclick: () => { S.month = shiftMonth(S.month, 1); render(); }, text: '›' }));
    return card('Variable expenses', 'A monthly envelope for what varies (travel, shopping, outings), and the expenses noted through the month.',
      [nav, h('button', { class: 'btn', type: 'button', onclick: () => openBudget({ kind: 'expense', nature: 'variable' }), text: 'Add an envelope' }),
        addBtn('Note an expense', () => openExpense())],
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Envelope' }), h('th', { class: 'r', text: 'Planned / month' }), h('th', { class: 'r', text: 'Spent' }), h('th', { class: 'r hide-sm', text: 'Since January' }), xHead())),
          h('tbody', null, rows)))
        : h('p', { class: 'footnote', text: 'Create envelopes (e.g. Travel $300 / month) then note expenses as they happen.' }),
      h('h3', { class: 'subhead', text: `Expenses noted in ${monthLabel(S.month)}` + (monthTotal ? ` · ${money(monthTotal)}` : '') }),
      entries.length
        ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, entries)))
        : h('p', { class: 'footnote', text: 'Nothing noted this month.' }),
      childSpent ? h('p', { class: 'footnote', text: `Includes ${money(childSpent)} of children’s expenses (details in the Children tab).` }) : null);
  }

  // --- Enfants ----------------------------------------------------------------
  function renderEnfants() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-enfants' });
    if (!S.children.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'No children entered' }),
        h('p', { text: 'Add each child to follow their expenses (daycare, activities, toys) and their RESP: contributions, grants received and the amount to contribute this year.' }),
        addBtn('Add a child', () => openChild())));
      return root;
    }
    const year = new Date().getFullYear();
    const yearStr = String(year);
    const today = new Date();
    let totFixed = 0, totYear = 0, totResp = 0, totToContrib = 0;
    const cards = S.children.map((c) => {
      const fixed = S.budget.filter((b) => b.child_id === c.id && b.kind === 'expense').map((b) => ({ b, f: sh(b.owner), m: C.monthly(b.amount, b.freq) })).filter((r) => r.f);
      const logs = S.log.filter((e) => e.child_id === c.id && String(e.spend_date).slice(0, 4) === yearStr).map((e) => ({ e, f: sh(e.owner) })).filter((r) => r.f);
      const fixedM = fixed.reduce((a, r) => a + r.m * r.f, 0);
      const spentY = logs.reduce((a, r) => a + num(r.e.amount) * r.f, 0);
      const entries = S.resp.filter((e) => e.child_id === c.id);
      const rs = C.respStats(c, entries, today);
      const linked = linkedValue('child_id', c.id);
      const respValue = linked.count ? linked.value : num(c.resp_value);
      totFixed += fixedM; totYear += spentY; totResp += respValue; totToContrib += rs.toContribute || 0;

      let advice;
      if (!c.birth_date) advice = h('p', { class: 'footnote', text: 'Add the birth date to work out grant eligibility.' });
      else if (!rs.eligible) advice = h('p', { class: 'footnote', text: `No more grants after ${rs.lastGrantYear} (the year they turn 17). Contributions are still possible until 31, without grants.` });
      else if (rs.toContribute > 0) advice = h('div', { class: 'callout' },
        h('strong', { text: `Contribute ${money(rs.toContribute)} more in ${year}` }),
        ` to get the maximum: ${money(rs.cesgMaxThisYear)} of CESG and ${money(rs.iqeeMaxThisYear)} of QESI (basic amounts).`);
      else advice = h('div', { class: 'callout ok' }, h('strong', { text: `${year} maximum reached` }), `: ${money(rs.contribYear)} contributed this year.`);

      const fixedRows = fixed.map((r) => clickRow(() => openBudget(r.b),
        h('td', null, r.b.name, h('span', { class: 'sub', text: `${L(r.b.grp)} · ${(FREQS[r.b.freq] || FREQS.monthly).label}` })),
        h('td', { class: 'r', text: money(r.m * r.f) }),
        xCell('budget_items', r.b, r.b.name)));
      const logRows = logs.slice(0, 8).map((r) => clickRow(() => openExpense(r.e),
        h('td', null, r.e.label, h('span', { class: 'sub', text: `${fmtDate(r.e.spend_date, { day: 'numeric', month: 'short' })} · ${L(r.e.grp)}` })),
        h('td', { class: 'r', text: money(num(r.e.amount) * r.f) }),
        xCell('expense_log', r.e, r.e.label)));
      const respRows = [...entries].reverse().slice(0, 6).map((e) => clickRow(() => openResp(c, e),
        h('td', null, e.kind === 'opening' ? 'Starting balance' : 'Contribution', h('span', { class: 'sub', text: fmtDate(e.entry_date) + (e.note ? ' · ' + e.note : '') })),
        h('td', { class: 'r' }, money(num(e.amount)), h('span', { class: 'sub', text: num(e.cesg) || num(e.iqee) ? `CESG ${money(num(e.cesg))} · QESI ${money(num(e.iqee))}` : '' })),
        xCell('resp_entries', e, `RESP ${e.kind === 'opening' ? 'starting balance' : 'contribution'} ${money(num(e.amount))}`)));

      return h('article', { class: 'card child' },
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { text: c.name }), h('p', { text: rs.age !== null ? `${rs.age} year${rs.age === 1 ? '' : 's'} old · born ${fmtDate(c.birth_date)}` : 'Birth date to add' })),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => openChild(c), text: 'Edit' }), xBtn('children', c, c.name))),
        h('div', { class: 'kpis' },
          kpi('Recurring expenses', money(fixedM), 'per month'),
          kpi(`One-time expenses ${year}`, money(spentY)),
          kpi('RESP value', respValue ? money(respValue) : '—', linked.count ? `${linked.count} linked investment(s)` : c.resp_value_date ? `as of ${fmtDate(c.resp_value_date)}` : 'to enter')),
        h('h3', { class: 'subhead', text: 'RESP' }),
        h('dl', { class: 'facts four' },
          h('div', null, h('dt', { text: 'Total contributions' }), h('dd', { text: money(rs.contrib) })),
          h('div', null, h('dt', { text: `Contributed in ${year}` }), h('dd', { text: money(rs.contribYear) })),
          h('div', null, h('dt', { text: 'CESG received' }), h('dd', { text: `${money(rs.cesg)} / $7,200` })),
          h('div', null, h('dt', { text: 'QESI received' }), h('dd', { text: `${money(rs.iqee)} / $3,600` }))),
        advice,
        rs.at16or17 ? h('p', { class: 'footnote', text: 'At 16 and 17, the CESG is paid only if at least $2,000 was contributed before the end of the year they turn 15, or at least $100 a year in any 4 years before then.' }) : null,
        respRows.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, respRows))) : h('p', { class: 'footnote', text: 'Enter a starting balance (contributions and grants received to date, from the latest statement), then each contribution.' }),
        h('h3', { class: 'subhead', text: 'Expenses' }),
        fixedRows.length || logRows.length
          ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, fixedRows, logRows)))
          : h('p', { class: 'footnote', text: 'Daycare, activities, toys, clothing…' }),
        h('div', { class: 'card-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => openResp(c), text: 'RESP contribution' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openBudget({ kind: 'expense', nature: 'fixed', child_id: c.id, grp: CHILD_GROUPS[0] }), text: 'Recurring expense' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openExpense(null, { child_id: c.id }), text: 'One-time expense' })));
    });

    const shared = S.budget.filter((b) => !b.child_id && isChildGroup(b.grp) && b.kind === 'expense' && sh(b.owner));
    root.append(card('The children', null, [addBtn('Add a child', () => openChild())],
      h('div', { class: 'kpis' },
        kpi('Recurring expenses', money(totFixed + shared.reduce((a, b) => a + C.monthly(b.amount, b.freq) * sh(b.owner), 0)), 'per month, all children'),
        kpi(`One-time ${year}`, money(totYear)),
        kpi('RESP', money(totResp), 'total value'),
        kpi(`To contribute in ${year}`, money(totToContrib), 'for the maximum grants'))));
    if (shared.length) {
      root.append(card('For all children', 'Children’s expenses not tied to one child (often from an import).', null,
        h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, shared.map((b) => clickRow(() => openBudget(b),
          h('td', null, b.name, h('span', { class: 'sub', text: L(b.grp) })), h('td', { class: 'r', text: money(C.monthly(b.amount, b.freq) * sh(b.owner)) }),
          xCell('budget_items', b, b.name))))))));
    }
    root.append(h('div', { class: 'children' }, cards));
    root.append(h('p', { class: 'footnote', text: 'Basic grants under the 2025 rules: CESG 20% (max $500/year, $1,000 with catch-up, $7,200 lifetime) and QESI 10% (max $250/year, $500 with catch-up, $3,600 lifetime), until the year they turn 17. The additional CESG, the QESI supplement and the Canada Learning Bond, which depend on family income, are not calculated. Lifetime contribution limit: $50,000 per child.' }));
    return root;
  }

  // --- Dettes -----------------------------------------------------------------
  function renderDettes() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-dettes' });
    const dv = debtsView();
    if (!dv.rows.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: S.debts.length ? 'No debts for this person' : 'No debts entered' }),
        h('p', { text: 'Add the mortgage (rate, term, amortization, payment), lines of credit, car loans or cards.' }),
        addBtn('Add a debt', () => openDebt())));
      return root;
    }
    root.append(card('Overview', null, [addBtn('Add a debt', () => openDebt())],
      h('div', { class: 'kpis' },
        kpi('Total debt', money(dv.total)),
        kpi('Payments', money(dv.monthlyPay), 'per month, as a monthly equivalent'),
        kpi('Average rate', `${fmtRate.format(dv.avgRate)}%`, 'weighted by balance'),
        kpi('Interest', money(dv.monthlyInterest), 'estimated this month'))));

    const charts = [];
    const cards = [...dv.rows].sort((a, b) => num(b.d.balance) - num(a.d.balance)).map(({ d, f, st }) => {
      const isMortgage = d.kind === 'mortgage';
      let renewal = null;
      if (st.termEnd) {
        const days = st.daysToRenewal;
        const pill = days < 0 ? h('span', { class: 'pill bad', text: 'past due' }) : days <= 120 ? h('span', { class: 'pill warn', text: `in ${days} d` }) : null;
        renewal = fact('Term end', h('span', null, fmtDate(st.termEnd), ' ', pill));
      }
      let payoff;
      if (!st.payment) payoff = '—';
      else if (!st.covers) payoff = h('span', { class: 'pill bad', text: 'the payment does not cover the interest' });
      else payoff = `${fmtDate(st.payoff.toISOString().slice(0, 10), { month: 'short', year: 'numeric' })} (${st.years.toFixed(1)} years)`;
      const paymentText = st.payment
        ? `${native(st.payment * f, 'CAD')} · ${(FREQS[d.freq] || FREQS.monthly).label.toLowerCase()}${st.paymentComputed ? ' (calculated)' : ''}`
        : '—';
      const chartBox = isMortgage && st.schedule.length > 2 ? h('div', { class: 'chart small' }) : null;
      if (chartBox) charts.push([chartBox, st, f]);
      return h('article', { class: 'debt' + (isMortgage ? ' wide' : '') },
        h('div', { class: 'debt-top' },
          h('div', null, h('h3', { text: d.name }), h('div', { class: 'sub', text: [DEBT_KINDS[d.kind], d.lender, ownerNote(d.owner, f)].filter(Boolean).join(' · ') })),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => openDebt(d), text: 'Edit' }), xBtn('debts', d, d.name))),
        h('div', null, h('div', { class: 'big', text: money(num(d.balance) * f) }),
          h('div', { class: 'muted-caption', text: `Balance${d.balance_date ? ' as of ' + fmtDate(d.balance_date) : ''}` })),
        st.paidShare !== null ? h('div', null, h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(st.paidShare * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(st.paidShare * 100).toFixed(1)}%` })),
          h('div', { class: 'footnote', style: 'margin-top:4px', text: `${fmtPct.format(st.paidShare)} repaid of ${money(num(d.original))}` })) : null,
        h('dl', { class: 'facts' + (isMortgage ? ' four' : '') },
          fact('Rate', `${fmtRate.format(num(d.rate))}%${d.kind === 'mortgage' || d.kind === 'heloc' ? (d.rate_type === 'variable' ? ' variable' : ' fixed') : ''}`),
          fact('Payment', paymentText),
          fact('Interest / month', '≈ ' + money(st.monthlyInterest * f)),
          fact(isMortgage ? 'Remaining amortization' : 'Estimated payoff', payoff),
          isMortgage && num(d.amortization_years) ? fact('Original amortization', `${fmtYears.format(num(d.amortization_years))} years${d.start_date ? ' since ' + fmtDate(d.start_date, { month: 'short', year: 'numeric' }) : ''}`) : null,
          isMortgage && (d.term_start || num(d.term_years)) ? fact('Term', [num(d.term_years) ? `${fmtYears.format(num(d.term_years))} years` : null, d.term_start ? 'since ' + fmtDate(d.term_start, { month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' ')) : null,
          renewal,
          st.termBalance !== null && st.daysToRenewal > 0 ? fact('Balance at renewal', '≈ ' + money(st.termBalance * f)) : null,
          st.termInterest !== null && st.daysToRenewal > 0 ? fact('Interest until then', '≈ ' + money(st.termInterest * f)) : null,
          st.termPrincipal !== null && st.daysToRenewal > 0 ? fact('Principal repaid until then', '≈ ' + money(st.termPrincipal * f)) : null,
          st.prepayAllowance !== null ? fact('Prepayment allowed', `${money(st.prepayAllowance * f)} / year (${fmtYears.format(num(d.prepay_pct))}%)`) : null,
          st.totalInterest !== null && st.totalInterest > 0 ? fact('Remaining interest (total)', '≈ ' + money(st.totalInterest * f)) : null),
        chartBox ? h('div', null, h('div', { class: 'muted-caption', text: 'Projected balance at the same rate' }), chartBox) : null);
    });
    root.append(h('div', { class: 'debts' }, cards));
    requestAnimationFrame(() => {
      for (const [box, st, f] of charts) {
        const pts = st.schedule.map((p) => ({ t: new Date(p.date + 'T12:00:00').getTime(), date: p.date, v: p.balance * f }));
        lineChart(box, pts, [{ name: 'Balance', color: 'var(--accent)', get: (p) => p.v, area: true, width: 2 }]);
      }
    });
    root.append(h('p', { class: 'footnote', text: 'Estimates at a constant rate, without prepayments. Fixed-rate mortgages: interest compounded semi-annually (Interest Act); other debts: compounded monthly. If the payment is left blank, it is calculated from the remaining amortization. The lender’s contract is the official figure.' }));
    return root;
  }
  function fact(label, value) {
    return h('div', null, h('dt', { text: label }), h('dd', null, value));
  }

  // --- Projets ----------------------------------------------------------------
  function renderProjets() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-projets' });
    if (!S.projects.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'No projects' }),
        h('p', { text: 'A cottage, a car, a renovation, a trip: enter the goal and the deadline to see where you stand and how much to set aside each month.' }),
        addBtn('Add a project', () => openProject())));
      return root;
    }
    const STATUS = {
      reached: ['ok', 'Goal reached'], on_track: ['ok', 'On track'], behind: ['warn', 'Behind'],
      open: ['info', 'No deadline'], stalled: ['bad', 'No savings planned'],
    };
    const cards = S.projects.map((p) => {
      const linked = linkedValue('project_id', p.id);
      const current = num(p.saved) + linked.value;
      const st = C.projectStats(p, current);
      const [pc, pl] = STATUS[st.status];
      let line;
      if (st.status === 'reached') line = 'The target amount is saved.';
      else if (st.months !== null && st.months === 0) line = `The deadline has come: ${money(st.remaining)} is missing.`;
      else if (st.months !== null) {
        line = st.status === 'on_track'
          ? `At the current pace, you will have about ${money(st.projected)} in ${fmtDate(p.target_date, { month: 'long', year: 'numeric' })}.`
          : `You need to set aside ${money(st.needed)} a month to reach the goal by ${fmtDate(p.target_date, { month: 'long', year: 'numeric' })} (planned: ${money(num(p.monthly_contribution))}).`;
      } else if (st.monthsToGoal !== null) {
        const d = new Date(); d.setMonth(d.getMonth() + st.monthsToGoal);
        line = `At the current pace, goal reached around ${new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' }).format(d)}.`;
      } else line = 'Add monthly savings or a deadline to see the projection.';
      return h('article', { class: 'card project' },
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { text: p.name }), h('p', null, h('span', { class: 'pill ' + pc, text: pl }))),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => openProject(p), text: 'Edit' }), xBtn('projects', p, p.name))),
        h('div', { class: 'big', text: `${money(current)} / ${money(st.target)}` }),
        st.share !== null ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(st.share * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(st.share * 100).toFixed(1)}%` })) : null,
        h('p', { class: 'project-line', text: line }),
        h('dl', { class: 'facts four' },
          fact('Deadline', p.target_date ? fmtDate(p.target_date, { month: 'long', year: 'numeric' }) : '—'),
          fact('Left to save', money(st.remaining)),
          fact('Planned savings', `${money(num(p.monthly_contribution))} / month`),
          fact('Assumed return', `${fmtRate.format(num(p.expected_return))}% / year`)),
        linked.count ? h('p', { class: 'footnote', text: `Includes ${money(linked.value)} from ${linked.count} investment(s) linked to this project${num(p.saved) ? ` and ${money(num(p.saved))} set aside elsewhere` : ''}.` }) : null,
        p.note ? h('p', { class: 'footnote', text: p.note }) : null);
    });
    const totalTarget = S.projects.reduce((a, p) => a + num(p.target_amount), 0);
    const totalSaved = S.projects.reduce((a, p) => a + num(p.saved) + linkedValue('project_id', p.id).value, 0);
    root.append(card('Projects', null, [addBtn('Add a project', () => openProject())],
      h('div', { class: 'kpis' }, kpi('Goals', money(totalTarget)), kpi('Already saved', money(totalSaved)),
        kpi('Planned savings', money(S.projects.reduce((a, p) => a + num(p.monthly_contribution), 0)), 'per month'))));
    root.append(h('div', { class: 'projects' }, cards));
    root.append(h('p', { class: 'footnote', text: 'To have an account count toward a project automatically, open the investment in the Portfolio tab and pick the project under “Linked to”. The assumed return is an assumption, not a guarantee.' }));
    return root;
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------
  const ownerOptions = () => ({ p1: S.settings.p1_name, p2: S.settings.p2_name, joint: 'Joint (50 / 50)' });

  // --- Projections -------------------------------------------------------------
  const PROJ_FIELDS = [
    ['ret', 'Return %'], ['sd', 'Standard deviation %'], ['infl', 'Inflation %'], ['realEstate', 'Real estate %'],
    ['raise_p1', (st) => `${st.p1_name}’s raise %`], ['raise_p2', (st) => `${st.p2_name}’s raise %`], ['kids', 'Children’s costs %'], ['endYear', 'End year'],
  ];
  const RETIRE_FIELDS = [
    ['birth_p1', (st) => `${st.p1_name}’s birth year`], ['birth_p2', (st) => `${st.p2_name}’s birth year`],
    ['retire_p1', (st) => `${st.p1_name}’s retirement age`], ['retire_p2', (st) => `${st.p2_name}’s retirement age`],
    ['rrq_p1', (st) => `${st.p1_name}’s QPP at 65 ($/month)`], ['rrq_p2', (st) => `${st.p2_name}’s QPP at 65 ($/month)`],
    ['psv', 'OAS per person ($/month)'], ['retireSpend', 'Retirement spending (% of before)'], ['retireTax', 'Average tax in retirement %'],
  ];
  function projAssumptions() {
    const a = { ...window.Projection.DEFAULTS, ...(S.settings.projection || {}) };
    // Until an end year is chosen: to the younger person's 90th birthday, or 25 years.
    if (!a.endYear) a.endYear = a.birth_p1 && a.birth_p2 ? Math.max(a.birth_p1, a.birth_p2) + 90 : new Date().getFullYear() + 25;
    return a;
  }

  /** Today's household numbers in the shape projection.js expects. */
  function projectionStart() {
    const year = new Date().getFullYear();
    const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);
    const kids = S.children.map((c) => ({ c, end: yearOf(c.birth_date) !== null ? yearOf(c.birth_date) + 18 : null }));
    const lastChildYear = kids.length ? Math.max(...kids.map((k) => k.end ?? year)) : null;
    let invested = 0;
    for (const hd of S.holdings) {
      if (hd.child_id) continue;
      const v = C.valueHolding(hd, S.prices).mv;
      if (v !== null) invested += v;
    }
    const resp = kids.map(({ c, end }) => {
      const linked = linkedValue('child_id', c.id);
      return { value: linked.count ? linked.value : num(c.resp_value), endYear: end ?? year + 10 };
    });
    const sumKinds = (kinds) => S.assets.filter((a) => kinds.includes(a.kind)).reduce((t, a) => t + num(a.value), 0);
    const debts = S.debts.map((d) => ({ balance: num(d.balance), payment: C.effectivePayment(d).payment, periods: (FREQS[d.freq] || FREQS.monthly).n, rate: C.periodRate(d) }));
    const incomes = [], expenses = [];
    const net = budgetNet();
    for (const b of S.budget) {
      const annual = net.get(b) * 12;
      if (b.kind === 'income') {
        if (b.grp === 'Revenus de placement') continue; // already in the investment return
        incomes.push({ annual, owner: b.owner, kind: b.grp === 'Allocations familiales' ? 'allowance' : b.grp === 'Autre revenu' ? 'other' : 'work' });
      } else {
        if (b.grp === SAVINGS_GROUP) continue; // savings, not spending
        const child = b.child_id ? kids.find((k) => k.c.id === b.child_id) : null;
        if (child || isChildGroup(b.grp)) expenses.push({ annual, kind: 'child', endYear: child ? child.end : lastChildYear });
        else expenses.push({ annual, kind: 'regular', endYear: null });
      }
    }
    const projects = S.projects.filter((p) => p.target_date && yearOf(p.target_date) >= year).map((p) => ({ year: yearOf(p.target_date), amount: num(p.target_amount) }));
    return {
      year, invested, resp, debts, incomes, expenses, projects, lastChildYear,
      realEstate: sumKinds(['Résidence principale', 'Immeuble locatif', 'Chalet']),
      vehicles: sumKinds(['Véhicule']), pension: sumKinds(['Fonds de pension']), flat: sumKinds(['Compte bancaire', 'Entreprise', 'Autre']),
    };
  }

  let projSaveTimer;
  function renderProjections() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-projections' });
    const a = projAssumptions();
    const real = storeGet('projReal', '1') === '1';
    const start = projectionStart();
    const res = window.Projection.project(start, a);
    const year0 = start.year;
    const defl = (row, v) => (real ? v / Math.pow(1 + a.infl / 100, row.year - year0) : v);
    const retirementOn = !!(a.birth_p1 && a.birth_p2);

    // Assumptions: edits redraw at once and are saved a moment later.
    const input = ([k, label]) => {
      const id = 'proj-' + k;
      return h('div', { class: 'field' }, h('label', { for: id, text: typeof label === 'function' ? label(S.settings) : label }),
        h('input', { id, inputmode: 'decimal', autocomplete: 'off', value: a[k] === null || a[k] === undefined ? '' : String(a[k]),
          onchange: (e) => {
            const v = parseNum(e.target.value);
            const prev = S.settings.projection || {};
            const next = { ...prev };
            if (v === null || Number.isNaN(v)) delete next[k]; else next[k] = v;
            noteUndo({ t: 'settings', before: { projection: prev } }, 'projection assumption');
            S.settings = { ...S.settings, projection: next };
            const y = window.scrollY;
            render();
            window.scrollTo(0, y);
            clearTimeout(projSaveTimer);
            projSaveTimer = setTimeout(async () => {
              const r = await sb.from('settings').update({ projection: next }).eq('id', 1);
              if (r.error) toast(errText(r.error), true);
            }, 500);
          } }));
    };
    root.append(card('Assumptions', 'Change a number: everything recalculates. Returns and raises in % per year.', [
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Show in' },
        [['1', 'Today’s dollars'], ['0', 'Future dollars']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String((real ? '1' : '0') === k),
          onclick: () => { storeSet('projReal', k); render(); }, text: l })))],
    h('div', { class: 'fields proj' }, PROJ_FIELDS.map(input)),
    h('h3', { class: 'subhead', text: 'Retirement' }),
    h('div', { class: 'fields proj' }, RETIRE_FIELDS.map(input)),
    h('p', { class: 'footnote', text: 'QPP: your estimate at 65 is in My Account (Retraite Québec); the 2026 maximum is $1,507.65 a month. It is adjusted for the retirement age (−0.6% per month before 65, +0.7% after, from 60 to 72). OAS from 65 (maximum $762.50 a month at the end of 2026).' })));

    const last = res.central.at(-1);
    const lastBand = res.band.at(-1);
    const retireYear = retirementOn ? Math.max(a.birth_p1 + a.retire_p1, a.birth_p2 + a.retire_p2) : null;
    const atRetire = retireYear ? res.central.find((r) => r.year === retireYear) : null;
    const debtFree = res.central.find((r) => r.debt <= 0);
    const kpis = h('div', { class: 'kpis' },
      kpi(`Net worth in ${last.year}`, money(defl(last, last.netWorth)), `${money(defl(last, lastBand.nwLow))} to ${money(defl(last, lastBand.nwHigh))} (9 times out of 10 above the low end)`),
      atRetire ? kpi(`Investments at retirement (${retireYear})`, money(defl(atRetire, atRetire.invested)), 'Central scenario') : kpi('Investments', money(defl(last, last.invested)), `in ${last.year}, central scenario`),
      retirementOn ? kpi('The money lasts to the end', h('span', { class: res.success >= 0.85 ? 'up' : res.success < 0.6 ? 'down' : '' , text: fmtPct.format(res.success) }), `of ${res.runs} simulations`) : null,
      kpi('Debts paid off', debtFree ? String(debtFree.year) : 'after ' + last.year, start.debts.length ? 'at the current payments' : 'no debts'));
    const chartBox = h('div', { class: 'chart' });
    root.append(card('Investments and net worth', `Central scenario and pessimistic–optimistic range (${res.runs} market simulations)`, null, kpis, chartBox,
      h('div', { class: 'legend' },
        h('span', { style: '--c: var(--accent)', text: 'Net worth (central)' }), h('span', { style: '--c: var(--gain)', text: 'Investments (central)' }),
        h('span', { class: 'band', style: '--c: var(--accent)', text: 'Net worth: 10% pessimistic to 90% optimistic' }))));

    // A row every 5 years, plus retirement and the last year.
    const milestones = res.central.filter((r, i) => i === 0 || r.year % 5 === 0 || r.year === retireYear || i === res.central.length - 1);
    const ages = (r) => [r.age.p1, r.age.p2].filter((x) => x !== null).join(' / ');
    root.append(card('Year by year', real ? 'In today’s dollars' : 'In future dollars', null,
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Year' }), h('th', { class: 'r hide-sm', text: 'Net income' }), h('th', { class: 'r hide-sm', text: 'Spending and debts' }),
          h('th', { class: 'r', text: 'Savings' }), h('th', { class: 'r', text: 'Investments' }), h('th', { class: 'r', text: 'Net worth' }))),
        h('tbody', null, milestones.map((r) => h('tr', null,
          h('td', null, String(r.year), h('span', { class: 'sub', text: (ages(r) ? 'ages ' + ages(r) : '') + (r.retired.p1 || r.retired.p2 ? ' · retired' : '') })),
          h('td', { class: 'r hide-sm' }, money(defl(r, r.work + r.pensions))),
          h('td', { class: 'r hide-sm' }, money(defl(r, r.spend + r.debtPaid))),
          h('td', { class: 'r ' + cls(r.surplus) }, moneySigned(defl(r, r.surplus))),
          h('td', { class: 'r' }, money(defl(r, r.invested))),
          h('td', { class: 'r' }, money(defl(r, r.netWorth))))))))));

    const notes = ['Budget income (after tax) grows with each person’s raise and stops at retirement; spending is indexed to inflation, children’s costs at their own rate and until 18; “Savings and investments” lines count as savings.',
      'Debts repaid at their current payments (renewed at the same rate); project investments spent on their date; RESPs spent when the child turns 18.',
      'Random market returns (log-normal) around the average return; house at the real estate rate; vehicles −15% per year.',
      'Not modelled: tax on non-registered investments, mandatory RRIF withdrawals, inheritances, life changes. It is a ballpark to help decide, not a promise.'];
    if (!retirementOn) root.prepend(h('div', { class: 'banner', text: 'Enter both birth years (Retirement section) to include retirement, the QPP and OAS in the projection.' }));
    if (res.depleted) root.prepend(h('div', { class: 'banner', text: `In the central scenario, the investments run out in ${res.depleted}.` }));
    root.append(h('div', { class: 'footnote' }, notes.map((n) => h('p', { text: n }))));

    requestAnimationFrame(() => {
      const pts = res.central.map((r, i) => ({ t: new Date(r.year, 6, 1).getTime(), year: r.year, nw: defl(r, r.netWorth), inv: defl(r, r.invested),
        lo: defl(r, res.band[i].nwLow), hi: defl(r, res.band[i].nwHigh) }));
      lineChart(chartBox, pts,
        [{ name: 'Net worth', color: 'var(--accent)', get: (p) => p.nw, width: 2.5 }, { name: 'Investments', color: 'var(--gain)', get: (p) => p.inv, width: 2 }],
        [{ name: 'Range', color: 'var(--accent)', lo: (p) => p.lo, hi: (p) => p.hi }],
        { label: 'Net worth projection', years: true, dateLabel: (p) => String(p.year) });
    });
    return root;
  }

  // --- Compagnies ---------------------------------------------------------------
  const CO_INCOME = ['Ventes et honoraires', 'Subventions', 'Autre revenu'];
  const CO_EXPENSE = {
    'Loyer et bureau': 100, 'Matériel et équipement': 100, 'Logiciels et abonnements': 100, 'Téléphone et Internet': 100,
    'Véhicule et déplacements': 100, 'Repas et représentation': 50, 'Publicité et marketing': 100, 'Honoraires professionnels': 100,
    'Assurances': 100, 'Frais bancaires et intérêts': 100, 'Formation': 100, 'Sous-traitance': 100, 'Salaires d’employés': 100, 'Autre dépense': 100,
  };
  const CO_KIND = { inc: 'Incorporated company (inc.)', autonome: 'Self-employed' };
  const T = () => window.Tax;
  const taxSettings = () => ({ p1_job: 0, p2_job: 0, p1_other: 0, p2_other: 0, cnesst: null, ...(S.settings.tax || {}) });
  /** Each person's income outside the companies, as a personalTax input. */
  const personBase = (p) => { const t = taxSettings(); return { employment: num(t[p + '_job']), other: num(t[p + '_other']) }; };
  const coLines = (c) => S.company_items.filter((i) => i.company_id === c.id)
    .map((i) => ({ ...i, annual: C.monthly(i.amount, i.freq) * 12, deductiblePct: num(i.deductible_pct) }));
  const owners = (c) => (c.owner === 'joint' ? [['p1', 0.5], ['p2', 0.5]] : [[c.owner, 1]]);

  /** A company's year, plus the personal tax its payouts cause for each owner (marginal, on top of their other income). */
  function companyView(c) {
    const X = T();
    const opts = { cnesstRate: taxSettings().cnesst != null ? num(taxSettings().cnesst) / 100 : undefined };
    const lines = coLines(c);
    const y = X.companyYear(c, lines, { salary: num(c.salary), dividends: num(c.dividends) }, opts);
    let personal = 0;
    for (const [p, part] of owners(c)) {
      const extra = c.kind === 'autonome' ? { selfEmployed: y.profit * part } : { employment: y.salary * part, nonEligibleDiv: y.dividends * part };
      personal += X.extraTax(personBase(p), extra);
    }
    const pocket = c.kind === 'autonome' ? y.available - personal : y.salary + y.dividends - personal;
    const scenarios = c.kind === 'inc' && y.available > 0
      ? X.payoutScenarios(c, lines, { salary: num(c.salary), dividends: num(c.dividends) }, c.owner === 'joint' ? personBase('p1') : personBase(c.owner), opts) : null;
    return { c, lines, y, personal, pocket, scenarios };
  }

  function renderCompagnies() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-compagnies' });
    if (S.outdated) {
      root.append(h('section', { class: 'card empty' }, h('strong', { text: 'Database needs an update' }),
        h('p', { text: 'To turn on companies, run the supabase/schema.sql file again in Supabase (SQL Editor → Run). Your data stays as it is.' })));
      return root;
    }
    const list = S.companies.filter((c) => sh(c.owner));
    if (!list.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'No companies' }),
        h('p', { text: 'Add your company (incorporated or self-employed), its income and its expenses: the app estimates the company’s tax, the personal tax on what you pay yourselves, and what really ends up in your pockets.' }),
        h('div', { class: 'card-actions' }, addBtn('Add a company', () => openCompany()),
          h('button', { class: 'btn', type: 'button', onclick: openTaxSettings, text: 'Your other income' }))));
      return root;
    }
    const views = list.map(companyView);
    const share = (c) => sh(c.owner);
    const tot = views.reduce((a, v) => {
      const f = share(v.c);
      a.rev += v.y.revenue * f; a.exp += v.y.expenses * f; a.pocket += v.pocket * f;
      a.tax += ((v.y.corpTax ? v.y.corpTax.total : 0) + v.personal + (v.y.employer ? v.y.employer.total : 0)) * f;
      a.kept += (v.y.retained || 0) * f;
      return a;
    }, { rev: 0, exp: 0, pocket: 0, tax: 0, kept: 0 });
    root.append(card('Overview', 'Per year, from the amounts entered', [
      h('button', { class: 'btn', type: 'button', onclick: openTaxSettings, text: 'Your other income' }),
      addBtn('Add a company', () => openCompany())],
    h('div', { class: 'kpis' },
      kpi('Revenue', money(tot.rev), `${money(tot.rev / 12)} / month`),
      kpi('Expenses', money(tot.exp), `${money(tot.exp / 12)} / month`),
      kpi('Taxes and payroll costs', money(tot.tax), tot.rev - tot.exp > 0 ? `${fmtPct.format(tot.tax / (tot.rev - tot.exp))} of profit` : null),
      kpi('In your pockets', h('span', { class: cls(tot.pocket), text: money(tot.pocket) }), `${money(tot.pocket / 12)} / month, after tax`))));

    for (const v of views) root.append(companyCard(v));
    root.append(h('p', { class: 'footnote', text: `${T().PARAMS.year} estimates for Québec, as a guide only: federal and Québec income tax, QPP, QPIP, Health Services Fund and CNESST. Not included: refundable and family credits, capital cost allowance (CCA), minimum tax, the company’s investment income, instalments. Check the numbers with your accountant before deciding.` }));
    return root;
  }

  function companyCard(v) {
    const { c, y, lines, personal, pocket, scenarios } = v;
    const inc = c.kind === 'inc';
    const pct = (a, b) => (b > 0 ? ` (${fmtPct.format(a / b)})` : '');
    const flow = inc ? [
      fact('Revenue', money(y.revenue)),
      fact('Expenses', '− ' + money(y.expenses)),
      fact('Salary paid', '− ' + money(y.salary)),
      fact('Payroll costs on the salary', '− ' + money(y.employer.total)),
      fact('Taxable profit', money(y.taxable)),
      fact('Company tax', '− ' + money(y.corpTax.total) + (y.taxable > 0 ? pct(y.corpTax.total, y.taxable) : '')),
      fact('Dividends paid', '− ' + money(y.dividends)),
      fact('Left in the company', h('span', { class: cls(y.retained), text: money(y.retained) })),
    ] : [
      fact('Revenue', money(y.revenue)),
      fact('Expenses', '− ' + money(y.expenses)),
      fact('Business profit', money(y.profit)),
      fact('Tax and contributions', '− ' + money(personal) + pct(personal, y.profit)),
    ];
    const personalFacts = inc ? [
      fact('Paid to you', money(y.salary + y.dividends)),
      fact('Personal tax and QPP/QPIP', '− ' + money(personal)),
      fact('In your pockets', h('strong', { class: cls(pocket), text: `${money(pocket)} (${money(pocket / 12)} / month)` })),
    ] : [fact('In your pockets', h('strong', { class: cls(pocket), text: `${money(pocket)} (${money(pocket / 12)} / month)` }))];

    const rows = [...lines].sort((a, b) => (a.kind === b.kind ? b.annual - a.annual : a.kind === 'income' ? -1 : 1)).map((l) => clickRow(() => openCompanyItem(c, l),
      h('td', null, l.name, h('span', { class: 'sub', text: L(l.grp) + (l.kind === 'expense' && l.deductiblePct < 100 ? ` · ${fmtYears.format(l.deductiblePct)}% deductible` : '') })),
      h('td', { class: 'r ' + (l.kind === 'income' ? 'up' : '') }, (l.kind === 'income' ? '' : '− ') + money(l.annual / 12), h('span', { class: 'sub', text: '/ month' })),
      h('td', { class: 'r hide-sm' }, money(l.annual), h('span', { class: 'sub', text: '/ year' })),
      xCell('company_items', l, l.name)));

    let compare = null;
    if (scenarios) {
      // Only the two ways that empty the company are comparable; what stays inside is still taxed when it comes out.
      const best = Math.max(scenarios[0].pocket, scenarios[1].pocket);
      compare = h('div', null, h('h3', { class: 'subhead', text: 'Salary or dividends?' }),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'How you pay yourself' }), h('th', { class: 'r', text: 'In your pockets' }), h('th', { class: 'r hide-sm', text: 'Taxes and payroll costs' }), h('th', { class: 'r', text: 'Left in the company' }))),
          h('tbody', null, scenarios.map((s2) => h('tr', null,
            h('td', null, s2.label, h('span', { class: 'sub', text: `salary ${money(s2.salary)} · dividends ${money(s2.dividends)}` })),
            h('td', { class: 'r' }, money(s2.pocket), s2 !== scenarios[2] && Math.abs(s2.pocket - best) < 1 ? h('span', { class: 'sub' }, h('span', { class: 'pill ok', text: 'pays the most' })) : null),
            h('td', { class: 'r hide-sm' }, money(s2.totalTax)),
            h('td', { class: 'r' }, money(s2.retained))))))),
        h('p', { class: 'footnote', text: 'The same money available, paid out three ways. Salary also earns QPP and creates RRSP room; dividends do not. Money left in the company will be taxed when it comes out.' }));
    }

    const budgetName = `Net income – ${c.name}`;
    const inBudget = S.budget.find((b) => b.name === budgetName || b.name === `Revenu net – ${c.name}`); // older lines kept the French name
    const monthlyPocket = Math.round(Math.max(0, pocket) / 12);
    const syncBtn = h('button', { class: 'btn', type: 'button', text: inBudget ? `Update the Budget (${money(monthlyPocket)} / month)` : `Add to the Budget (${money(monthlyPocket)} / month)`,
      onclick: async () => {
        try {
          await saveRow('budget_items', { id: inBudget && inBudget.id, name: budgetName, grp: 'Travail autonome', kind: 'income', nature: 'fixed', amount: monthlyPocket, freq: 'monthly', owner: c.owner, child_id: null });
          toast('Budget updated'); refresh();
        } catch (e) { toast(errText(e), true); }
      } });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', null, h('h2', { text: c.name }), h('p', { text: [CO_KIND[c.kind], ownerName(c.owner), inc ? (c.sbd_hours ? 'reduced Québec rate (5,500 h)' : 'Québec rate without the 5,500 h') : null].filter(Boolean).join(' · ') })),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openCompany(c), text: 'Edit' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openCompanyItem(c, { kind: 'expense' }), text: 'Expense' }),
          addBtn('Income', () => openCompanyItem(c, { kind: 'income' })),
          xBtn('companies', c, c.name))),
      h('div', { class: 'grid tight' },
        h('div', null, h('h3', { class: 'subhead', text: inc ? 'In the company (per year)' : 'Per year' }), h('dl', { class: 'facts' }, flow)),
        h('div', null, h('h3', { class: 'subhead', text: 'For you' }), h('dl', { class: 'facts' }, personalFacts),
          h('div', { class: 'card-actions' }, syncBtn),
          h('p', { class: 'footnote', text: 'The Budget and Projections use this net amount. Update it when the numbers change.' }))),
      lines.length ? h('div', null, h('h3', { class: 'subhead', text: 'Income and expenses' }), h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Line' }), h('th', { class: 'r', text: 'Per month' }), h('th', { class: 'r hide-sm', text: 'Per year' }), xHead())),
        h('tbody', null, rows))))
        : h('p', { class: 'footnote', text: 'Add the company’s income (sales, fees) and expenses (rent, supplies, software…).' }),
      compare);
  }

  function openCompany(c) {
    const v = c ? { ...c, sbd_hours: c.sbd_hours ? 'oui' : 'non' } : { kind: 'inc', owner: S.who === 'all' ? 'p1' : S.who, sbd_hours: 'non', salary: '', dividends: '' };
    openForm({
      title: c ? 'Edit the company' : 'Add a company',
      values: v,
      fields: [
        { k: 'name', label: 'Name', type: 'text', req: true, wide: true, placeholder: 'Studio Photo inc.' },
        { k: 'kind', label: 'Structure', type: 'select', options: CO_KIND },
        { k: 'owner', label: 'Owner', type: 'owner' },
        { k: 'salary', label: 'Salary paid (gross, per year)', type: 'num', show: (s) => s.kind === 'inc', clearWhenHidden: true, hint: 'What the company pays you as salary' },
        { k: 'dividends', label: 'Dividends paid (per year)', type: 'num', show: (s) => s.kind === 'inc', clearWhenHidden: true, hint: 'Ordinary (non-eligible) dividends' },
        { k: 'sbd_hours', label: 'Paid hours in the year', type: 'select', show: (s) => s.kind === 'inc', wide: true,
          options: { non: 'Under 5,500 h (one or two people): Québec rate 11.5%', oui: '5,500 h or more: reduced Québec rate 3.2%' },
          hint: 'Hours paid to employees (40 h/week max per person). The reduced Québec rate drops to 2.2% for years starting after April 29, 2026.' },
        { k: 'note', label: 'Note (optional)', type: 'text', wide: true },
      ],
      onSave: (out) => saveRow('companies', { ...out, id: c && c.id, salary: out.salary || 0, dividends: out.dividends || 0, sbd_hours: out.sbd_hours === 'oui' }),
      onDelete: c ? () => deleteRow('companies', c.id) : null,
    });
  }

  function openCompanyItem(c, item) {
    const existing = item && item.id;
    const kind = item.kind || 'expense';
    const groups = kind === 'income' ? CO_INCOME : Object.keys(CO_EXPENSE);
    const v = existing ? { ...item } : { kind, grp: groups[0], freq: 'monthly', deductible_pct: kind === 'income' ? 100 : CO_EXPENSE[groups[0]] };
    openForm({
      title: existing ? 'Edit the line' : kind === 'income' ? `${c.name} income` : `${c.name} expense`,
      values: v,
      fields: [
        { k: 'grp', label: 'Category', type: 'select', options: groups, onChange: (s) => { if (kind === 'expense') s.deductible_pct = CO_EXPENSE[s.grp]; } },
        { k: 'name', label: 'Description', type: 'text', req: true, wide: true, placeholder: kind === 'income' ? 'Photo contracts' : 'Adobe Creative Cloud' },
        { k: 'amount', label: 'Amount', type: 'num', req: true },
        { k: 'freq', label: 'Frequency', type: 'select', options: ALL_FREQS },
        { k: 'deductible_pct', label: 'Deductible part (%)', type: 'num', show: () => kind === 'expense', hint: 'Meals and entertainment: 50%. Personal use of an item: only the business part.' },
      ],
      onSave: (out) => {
        const pctVal = out.deductible_pct === null || out.deductible_pct === undefined ? 100 : Math.min(100, out.deductible_pct);
        return saveRow('company_items', { ...out, id: existing ? item.id : undefined, company_id: c.id, kind, deductible_pct: pctVal });
      },
      onDelete: existing ? () => deleteRow('company_items', item.id) : null,
    });
  }

  function openTaxSettings() {
    const t = taxSettings();
    openForm({
      title: 'Your income outside the companies',
      values: { ...t, cnesst: t.cnesst ?? T().PARAMS.cnesstDefault * 100 },
      fields: [
        { k: 'p1_job', label: `${S.settings.p1_name}: salary from a job (gross / year)`, type: 'num', hint: 'A job outside your companies' },
        { k: 'p2_job', label: `${S.settings.p2_name}: salary from a job (gross / year)`, type: 'num' },
        { k: 'p1_other', label: `${S.settings.p1_name}: other taxable income (/ year)`, type: 'num', hint: 'Rent, interest, pension…' },
        { k: 'p2_other', label: `${S.settings.p2_name}: other taxable income (/ year)`, type: 'num' },
        { k: 'cnesst', label: 'Company’s CNESST rate (%)', type: 'num', hint: 'On your CNESST notice of assessment; depends on the industry' },
      ],
      onSave: async (out) => {
        await saveSettings({ tax: { ...t, ...out } });
      },
    });
  }

  function openForm({ title, fields, values, onSave, onDelete }) {
    const sheet = $('#sheet');
    const state = { ...values };
    const panel = h('form', { class: 'sheet-panel', novalidate: true, 'aria-label': title });
    const errorBox = h('p', { class: 'form-error', role: 'alert' });
    const fieldsBox = h('div', { class: 'fields' });
    const visible = (f) => !f.show || f.show(state);

    function readInputs() {
      for (const f of fields) {
        if (!visible(f)) continue;
        const el = panel.querySelector('#f-' + f.k);
        if (!el) continue;
        state[f.k] = f.type === 'checkbox' ? el.checked : el.value;
      }
    }
    function drawFields() {
      fieldsBox.replaceChildren(...fields.filter(visible).map((f) => {
        const id = 'f-' + f.k;
        const label = typeof f.label === 'function' ? f.label(state) : f.label;
        let input;
        const val = state[f.k] === null || state[f.k] === undefined ? '' : String(state[f.k]);
        if (f.type === 'select' || f.type === 'owner') {
          const opts = f.type === 'owner' ? ownerOptions() : (typeof f.options === 'function' ? f.options(state) : f.options);
          const entries = Array.isArray(opts) ? opts.map((o) => [o, L(o)]) : Object.entries(opts);
          input = h('select', { id, onchange: () => { readInputs(); if (f.onChange) f.onChange(state); drawFields(); } },
            entries.map(([v, l]) => h('option', { value: v, selected: v === val ? true : null, text: l })));
          if (!entries.some(([v]) => v === val) && entries.length) state[f.k] = entries[0][0];
        } else {
          input = h('input', {
            id, value: val, placeholder: f.placeholder || null, autocomplete: 'off',
            type: f.type === 'date' ? 'date' : 'text',
            inputmode: f.type === 'num' && !f.neg ? 'decimal' : null, // the decimal keypad on phones has no minus sign
            autocapitalize: f.upper ? 'characters' : null,
            spellcheck: 'false',
          });
        }
        return h('div', { class: 'field' + (f.wide ? ' wide' : ''), 'data-k': f.k },
          h('label', { for: id, text: label + (f.req ? '' : '') }), input, f.hint ? h('span', { class: 'hint', text: typeof f.hint === 'function' ? f.hint(state) : f.hint }) : null);
      }));
    }

    function close() { sheet.hidden = true; sheet.replaceChildren(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    const saveBtn = h('button', { class: 'btn primary', type: 'submit', text: 'Save' });
    let delBtn = null;
    if (onDelete) {
      let armed = false;
      delBtn = h('button', {
        class: 'btn danger', type: 'button', text: 'Delete',
        onclick: async () => {
          if (!armed) { armed = true; delBtn.classList.add('armed'); delBtn.textContent = 'Confirm delete'; return; }
          delBtn.disabled = true;
          try {
            await undoable(`delete (${title})`, onDelete);
            close(); toast('Deleted', false, { label: 'Undo', fn: undoLast }); refresh();
          } catch (e) { errorBox.textContent = errText(e); delBtn.disabled = false; refresh(); }
        },
      });
    }
    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      readInputs();
      errorBox.textContent = '';
      panel.querySelectorAll('.field.invalid').forEach((el) => el.classList.remove('invalid'));
      const out = {};
      for (const f of fields) {
        if (!visible(f)) continue;
        let v = state[f.k];
        if (f.type === 'num') {
          v = parseNum(v);
          const neg = typeof f.neg === 'function' ? f.neg(state) : f.neg;
          if (Number.isNaN(v) || (v !== null && v < 0 && !neg)) { return invalid(f, `“${typeof f.label === 'function' ? f.label(state) : f.label}” must be a positive number.`); }
        } else if (typeof v === 'string') {
          v = v.trim();
          if (f.upper) v = v.toUpperCase();
          if (v === '') v = null;
        }
        if (f.req && (v === null || v === undefined)) return invalid(f, `“${typeof f.label === 'function' ? f.label(state) : f.label}” is required.`);
        out[f.k] = v;
      }
      for (const f of fields) if (!visible(f) && f.clearWhenHidden) out[f.k] = null;
      saveBtn.disabled = true;
      try {
        await undoable(title, () => onSave(out));
        close();
        toast('Saved', false, undoStack.length ? { label: 'Undo', fn: undoLast } : null);
        refresh();
      } catch (err) {
        errorBox.textContent = errText(err);
        saveBtn.disabled = false;
      }
    });
    function invalid(f, msg) {
      const el = panel.querySelector(`[data-k="${f.k}"]`);
      if (el) el.classList.add('invalid');
      errorBox.textContent = msg;
      const input = panel.querySelector('#f-' + f.k);
      if (input) input.focus();
    }

    drawFields();
    panel.append(h('h2', { text: title }), fieldsBox, errorBox,
      h('div', { class: 'sheet-actions' }, delBtn,
        h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Cancel' }), saveBtn)));
    sheet.replaceChildren(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    document.addEventListener('keydown', onKey);
    const first = panel.querySelector('input, select');
    if (first) first.focus();
  }

  function linkOptions() {
    const o = { '': 'None' };
    for (const c of S.children) o['child:' + c.id] = `${c.name}’s RESP`;
    for (const p of S.projects) o['project:' + p.id] = `Project: ${p.name}`;
    return o;
  }

  function openHolding(hd, preset) {
    const isNew = !hd;
    const v = hd ? { ...hd } : { market: 'TSX', currency: 'CAD', account: 'CELI', owner: S.who === 'all' ? 'p1' : S.who, ...preset };
    if (isNew && v.market === 'MANUAL') Object.assign(v, { account: 'Non enregistré', qty: '1', manual_price_date: todayISO(), update_freq: 'quarterly', ...preset });
    v.link = v.child_id ? 'child:' + v.child_id : v.project_id ? 'project:' + v.project_id : '';
    const marketOpts = Object.fromEntries(Object.entries(MARKETS).map(([k, m]) => [k, m.label]));
    const hasLinks = S.children.length || S.projects.length;
    openForm({
      title: isNew ? (v.market === 'MANUAL' ? 'Add a private investment' : 'Add an investment') : 'Edit the investment',
      values: v,
      fields: [
        { k: 'market', label: 'Market', type: 'select', options: marketOpts, wide: true, req: true },
        { k: 'symbol', label: 'Symbol', type: 'text', placeholder: 'XEQT', upper: true, req: true, show: (s) => s.market !== 'CASH',
          hint: (s) => (MARKETS[s.market]?.auto ? 'No suffix: XEQT, VFV, AAPL. Class shares: BAM.A' : 'A short name to find it again') },
        { k: 'currency', label: 'Currency', type: 'select', options: { CAD: 'CAD', USD: 'USD' }, show: (s) => !MARKETS[s.market]?.cur },
        { k: 'name', label: 'Name (optional)', type: 'text', placeholder: 'iShares Core Equity ETF', wide: true },
        { k: 'qty', label: (s) => (s.market === 'CASH' ? 'Amount' : 'Number of units'), type: 'num', req: true, neg: (s) => s.market === 'CASH',
          hint: (s) => (s.market === 'MANUAL' ? 'No units (company, loan, building): 1, then the total value as the value per unit'
            : s.market === 'CASH' ? 'Negative for a margin balance (money owed to the broker): −15 000' : '') },
        { k: 'avg_cost', label: (s) => (s.market === 'MANUAL' ? 'Amount invested per unit' : 'Average cost per unit'), type: 'num', show: (s) => s.market !== 'CASH', hint: 'In the security’s currency', clearWhenHidden: true },
        { k: 'manual_price', label: (s) => (s.market === 'MANUAL' ? 'Current value per unit' : 'Current price'), type: 'num', show: (s) => s.market === 'MANUAL', req: true, clearWhenHidden: true },
        { k: 'manual_price_date', label: 'Value as of', type: 'date', show: (s) => s.market === 'MANUAL', clearWhenHidden: true },
        { k: 'update_freq', label: 'Planned update', type: 'select', options: { '': 'No reminder', monthly: 'Every month', quarterly: 'Every quarter' },
          show: (s) => s.market === 'MANUAL', clearWhenHidden: true, hint: 'A reminder shows when the value is more than a month or a quarter old.' },
        { k: 'account', label: 'Account', type: 'select', options: ACCOUNTS },
        { k: 'owner', label: 'Owner', type: 'owner' },
        { k: 'link', label: 'Linked to', type: 'select', options: linkOptions, show: () => hasLinks, wide: true,
          hint: 'An RESP investment counts in the child’s RESP value; an investment linked to a project counts toward that project.' },
        { k: 'institution', label: 'Institution (optional)', type: 'text', placeholder: 'Desjardins, Wealthsimple, Disnat…', wide: true },
        { k: 'asset_class', label: 'Asset class', type: 'select', options: { '': 'Automatic (from the security)', ...CLASSES }, show: (s) => s.market !== 'CASH', clearWhenHidden: true,
          hint: 'For the asset allocation. All-in-one ETFs (XEQT, VBAL…) are recognized.' },
      ],
      onSave: async (out) => {
        const m = MARKETS[out.market];
        const { link, ...rest } = out;
        const row = { ...rest, id: hd && hd.id, child_id: null, project_id: null };
        if (link && link.startsWith('child:')) row.child_id = link.slice(6);
        if (link && link.startsWith('project:')) row.project_id = link.slice(8);
        if (m.cur) row.currency = m.cur;
        if (out.market === 'CASH') { row.symbol = row.currency; row.name = row.name || 'Cash'; row.avg_cost = null; }
        // Older databases may not have this column yet; only send it when it matters.
        if (row.update_freq == null && !(hd && 'update_freq' in hd)) delete row.update_freq;
        if (row.asset_class == null && !(hd && 'asset_class' in hd)) delete row.asset_class;
        await saveRow('holdings', row);
      },
      onDelete: hd ? () => deleteRow('holdings', hd.id) : null,
    });
  }

  function openAsset(a) {
    openForm({
      title: a ? 'Edit the asset' : 'Add an asset',
      values: a ? { ...a } : { kind: 'Résidence principale', owner: 'joint', as_of: todayISO() },
      fields: [
        { k: 'name', label: 'Name', type: 'text', placeholder: 'House', req: true, wide: true },
        { k: 'kind', label: 'Type', type: 'select', options: ASSET_KINDS },
        { k: 'owner', label: 'Owner', type: 'owner' },
        { k: 'value', label: 'Estimated value', type: 'num', req: true },
        { k: 'as_of', label: 'As of', type: 'date' },
      ],
      onSave: (out) => saveRow('assets', { ...out, id: a && a.id }),
      onDelete: a ? () => deleteRow('assets', a.id) : null,
    });
  }

  function openDebt(d) {
    const mortgage = (s) => s.kind === 'mortgage';
    openForm({
      title: d ? 'Edit the debt' : 'Add a debt',
      values: d ? { ...d } : { kind: 'mortgage', rate_type: 'fixed', freq: 'monthly', owner: 'joint', balance_date: todayISO() },
      fields: [
        { k: 'name', label: 'Name', type: 'text', placeholder: 'House mortgage', req: true, wide: true },
        { k: 'kind', label: 'Type', type: 'select', options: DEBT_KINDS },
        { k: 'lender', label: 'Lender', type: 'text', placeholder: 'RBC' },
        { k: 'balance', label: 'Current balance', type: 'num', req: true },
        { k: 'balance_date', label: 'Balance as of', type: 'date' },
        { k: 'rate', label: 'Annual rate (%)', type: 'num', req: true, placeholder: '4.59' },
        { k: 'rate_type', label: 'Rate type', type: 'select', options: { fixed: 'Fixed', variable: 'Variable' }, show: (s) => s.kind === 'mortgage' || s.kind === 'heloc' },
        { k: 'payment', label: 'Payment', type: 'num', hint: (s) => (mortgage(s) ? 'Principal + interest, without taxes. Leave blank to calculate it from the amortization.' : 'Principal + interest') },
        { k: 'freq', label: 'Frequency', type: 'select', options: DEBT_FREQS },
        { k: 'original', label: (s) => (mortgage(s) ? 'Original loan amount' : 'Original amount (optional)'), type: 'num' },
        { k: 'start_date', label: 'Loan start date', type: 'date', show: mortgage, clearWhenHidden: true },
        { k: 'amortization_years', label: 'Original amortization (years)', type: 'num', placeholder: '25', show: mortgage, clearWhenHidden: true },
        { k: 'term_start', label: 'Current term start', type: 'date', show: mortgage, clearWhenHidden: true },
        { k: 'term_years', label: 'Term length (years)', type: 'num', placeholder: '5', show: mortgage, clearWhenHidden: true },
        { k: 'term_end', label: 'Term end', type: 'date', show: mortgage, clearWhenHidden: true, hint: 'Leave blank to calculate it (start + length)' },
        { k: 'prepay_pct', label: 'Prepayment allowed (% / year)', type: 'num', placeholder: '15', show: mortgage, clearWhenHidden: true, hint: 'From the contract, as a % of the original amount' },
        { k: 'owner', label: 'Owner', type: 'owner' },
      ],
      onSave: async (out) => {
        if (out.rate !== null && out.rate >= 100) throw new Error('The rate must be a percentage, for example 4.59.');
        if (out.amortization_years !== undefined && out.amortization_years !== null && out.amortization_years > 40) throw new Error('The amortization must be in years, for example 25.');
        await saveRow('debts', { ...out, rate_type: out.rate_type || 'fixed', id: d && d.id });
      },
      onDelete: d ? () => deleteRow('debts', d.id) : null,
    });
  }

  const childOptions = () => Object.fromEntries(S.children.map((c) => [c.id, c.name]));

  /** Budget line: income, fixed expense, variable envelope, or a child's recurring expense. */
  function openBudget(b) {
    const existing = b && b.id;
    const base = b || {};
    const kind = base.kind || 'expense';
    const forChild = !!base.child_id || isChildGroup(base.grp);
    const v = existing ? { ...base, basis: base.gross ? 'gross' : 'net' } : {
      kind, nature: base.nature || 'fixed', child_id: base.child_id || (forChild && S.children[0] ? S.children[0].id : null),
      grp: base.grp || (kind === 'income' ? INC_GROUPS[0] : forChild ? CHILD_GROUPS[0] : base.nature === 'variable' ? VAR_GROUPS[0] : FIXED_GROUPS[0]),
      freq: 'monthly', owner: 'joint',
    };
    const groupsFor = (s) => (s.kind === 'income' ? INC_GROUPS : forChild ? CHILD_GROUPS : s.nature === 'variable' ? VAR_GROUPS : FIXED_GROUPS);
    const title = existing ? 'Edit the line'
      : kind === 'income' ? 'Add income'
        : forChild ? 'A child’s recurring expense'
          : v.nature === 'variable' ? 'Add an envelope' : 'Add a fixed expense';
    openForm({
      title,
      values: v,
      fields: [
        { k: 'kind', label: 'Type', type: 'select', options: { income: 'Income', expense: 'Expense' }, show: () => !forChild,
          onChange: (s) => { s.grp = groupsFor(s)[0]; } },
        { k: 'nature', label: 'Kind of expense', type: 'select', options: { fixed: 'Fixed (every month)', variable: 'Variable (envelope)' },
          show: (s) => s.kind === 'expense' && !forChild, onChange: (s) => { s.grp = groupsFor(s)[0]; } },
        { k: 'child_id', label: 'Child', type: 'select', options: childOptions, show: () => forChild && S.children.length > 0 },
        { k: 'grp', label: 'Category', type: 'select', options: groupsFor },
        { k: 'name', label: 'Description', type: 'text', req: true, wide: true,
          placeholder: kind === 'income' ? 'Salary' : forChild ? 'Daycare' : v.nature === 'variable' ? 'Travel' : 'Rent' },
        { k: 'basis', label: 'Amount entered', type: 'select', options: { net: 'Net (after tax)', gross: 'Gross (before tax)' },
          show: (s) => s.kind === 'income' && !!GROSS_KIND[s.grp], hint: (s) => (s.basis === 'gross' ? 'The Budget estimates the net with Québec and federal rates.' : null) },
        { k: 'amount', label: (s) => (s.nature === 'variable' && s.kind === 'expense' ? 'Planned amount' : s.kind === 'income' && s.basis === 'gross' && GROSS_KIND[s.grp] ? 'Gross amount' : 'Amount'), type: 'num', req: true },
        { k: 'freq', label: 'Frequency', type: 'select', options: ALL_FREQS },
        { k: 'owner', label: 'For', type: 'owner' },
      ],
      onSave: (out) => {
        const row = { ...out, id: existing ? base.id : undefined };
        row.gross = row.kind === 'income' && row.basis === 'gross' && !!GROSS_KIND[row.grp];
        delete row.basis;
        if (!row.gross && !(existing && 'gross' in base)) delete row.gross; // older database without the column
        if (row.kind === 'income') { row.nature = 'fixed'; row.child_id = null; }
        if (forChild) { row.kind = 'expense'; row.nature = 'fixed'; row.child_id = out.child_id || null; }
        else if (row.kind === 'expense') row.child_id = null;
        return saveRow('budget_items', row);
      },
      onDelete: existing ? () => deleteRow('budget_items', base.id) : null,
    });
  }

  /** One ad hoc expense (trip, shopping, toy…). */
  function openExpense(e, ctx) {
    const forChild = !!((e && e.child_id) || (ctx && ctx.child_id) || (e && isChildGroup(e.grp)));
    const v = e ? { ...e } : { spend_date: S.month === todayISO().slice(0, 7) ? todayISO() : S.month + '-01', grp: forChild ? CHILD_GROUPS[2] : VAR_GROUPS[0], owner: 'joint', child_id: ctx && ctx.child_id };
    openForm({
      title: e ? 'Edit the expense' : forChild ? 'A child’s one-time expense' : 'Note an expense',
      values: v,
      fields: [
        { k: 'label', label: 'Description', type: 'text', req: true, wide: true, placeholder: forChild ? 'Winter boots' : 'Plane tickets' },
        { k: 'amount', label: 'Amount', type: 'num', req: true },
        { k: 'spend_date', label: 'Date', type: 'date', req: true },
        { k: 'grp', label: 'Category', type: 'select', options: forChild ? CHILD_GROUPS : [...VAR_GROUPS, ...FIXED_GROUPS] },
        { k: 'child_id', label: 'Child', type: 'select', options: childOptions, show: () => forChild && S.children.length > 0 },
        { k: 'owner', label: 'Paid by', type: 'owner' },
      ],
      onSave: (out) => saveRow('expense_log', { ...out, child_id: forChild ? out.child_id || null : null, id: e && e.id }),
      onDelete: e ? () => deleteRow('expense_log', e.id) : null,
    });
  }

  function openChild(c) {
    openForm({
      title: c ? `Edit ${c.name}` : 'Add a child',
      values: c ? { ...c } : {},
      fields: [
        { k: 'name', label: 'First name', type: 'text', req: true },
        { k: 'birth_date', label: 'Birth date', type: 'date', hint: 'Used to work out RESP grant eligibility' },
        { k: 'resp_value', label: 'Current RESP value', type: 'num', hint: 'From the latest statement. Not needed if the RESP investments are linked to the child in Portfolio.' },
        { k: 'resp_value_date', label: 'As of', type: 'date' },
      ],
      onSave: (out) => saveRow('children', { ...out, id: c && c.id }),
      onDelete: c ? () => deleteRow('children', c.id) : null,
    });
  }

  function openResp(child, e) {
    const hasOpening = S.resp.some((x) => x.child_id === child.id && x.kind === 'opening' && (!e || x.id !== e.id));
    openForm({
      title: e ? 'Edit the RESP entry' : `${child.name}’s RESP`,
      values: e ? { ...e } : { kind: hasOpening || S.resp.some((x) => x.child_id === child.id) ? 'contribution' : 'opening', entry_date: todayISO() },
      fields: [
        { k: 'kind', label: 'Type', type: 'select', options: { contribution: 'Contribution', opening: 'Starting balance (totals to date)' }, wide: true },
        { k: 'entry_date', label: 'Date', type: 'date', req: true },
        { k: 'amount', label: (s) => (s.kind === 'opening' ? 'Total contributions to date' : 'Amount contributed'), type: 'num', req: true },
        { k: 'cesg', label: (s) => (s.kind === 'opening' ? 'CESG received to date' : 'CESG received (if known)'), type: 'num',
          hint: (s) => (s.kind === 'opening' ? 'See the RESP statement' : 'Often paid a few weeks later; leave blank if needed') },
        { k: 'iqee', label: (s) => (s.kind === 'opening' ? 'QESI received to date' : 'QESI received (if known)'), type: 'num',
          hint: (s) => (s.kind === 'opening' ? '' : 'Paid once a year, the following spring') },
        { k: 'note', label: 'Note (optional)', type: 'text', wide: true },
      ],
      onSave: (out) => saveRow('resp_entries', { ...out, cesg: out.cesg || 0, iqee: out.iqee || 0, child_id: child.id, id: e && e.id }),
      onDelete: e ? () => deleteRow('resp_entries', e.id) : null,
    });
  }

  function openProject(p) {
    openForm({
      title: p ? 'Edit the project' : 'Add a project',
      values: p ? { ...p } : { expected_return: 0 },
      fields: [
        { k: 'name', label: 'Project name', type: 'text', req: true, wide: true, placeholder: 'Cottage' },
        { k: 'target_amount', label: 'Target amount', type: 'num', req: true, hint: 'E.g. the down payment and fees' },
        { k: 'target_date', label: 'Deadline', type: 'date' },
        { k: 'saved', label: 'Already set aside', type: 'num', hint: 'Not counting investments linked to the project in Portfolio' },
        { k: 'monthly_contribution', label: 'Planned savings per month', type: 'num' },
        { k: 'expected_return', label: 'Assumed return (% / year)', type: 'num', hint: '0 for a cautious savings account' },
        { k: 'note', label: 'Note (optional)', type: 'text', wide: true },
      ],
      onSave: (out) => saveRow('projects', { ...out, saved: out.saved || 0, monthly_contribution: out.monthly_contribution || 0, expected_return: out.expected_return || 0, id: p && p.id }),
      onDelete: p ? () => deleteRow('projects', p.id) : null,
    });
  }

  // ---------------------------------------------------------------------------
  // Statement import
  // ---------------------------------------------------------------------------
  const IMPORT_CATEGORY = {
    'Électricité et chauffage': 'Électricité et chauffage', 'Internet et téléphone': 'Internet et téléphone', Abonnements: 'Abonnements',
    Logement: 'Logement', Assurances: 'Assurances', Alimentation: 'Alimentation', Transport: 'Transport', Santé: 'Santé',
    Enfants: 'Garderie / service de garde', 'Loisirs et sorties': 'Loisirs et sorties', Restaurants: 'Restaurants', Voyages: 'Voyages', Shopping: 'Shopping',
  };

  function readText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function openImport() {
    const I = window.Importer;
    const sheet = $('#sheet');
    const panel = h('div', { class: 'sheet-panel wide', role: 'dialog', 'aria-label': 'Import statements' });
    const st = { files: [], owner: S.who === 'all' ? 'joint' : S.who, flip: {}, showOneoff: false, result: null, picks: new Map() };
    const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    function analyzeAll() {
      const seen = new Set();
      const tx = [];
      st.problems = [];
      for (const f of st.files) {
        const cols = f.cols;
        if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) { st.problems.push(f); continue; }
        for (const t of I.toTransactions(f.rows, cols, !!st.flip[f.name])) {
          const key = t.date + '|' + t.description + '|' + t.amount;
          if (seen.has(key)) continue; // same transaction in two overlapping files
          seen.add(key);
          tx.push(t);
        }
      }
      st.result = I.analyze(tx);
      st.picks = new Map();
      const existingNames = new Set(S.budget.map((b) => String(b.name || '').trim().toLowerCase()));
      for (const g of st.result.groups) {
        const dup = existingNames.has(g.name.toLowerCase());
        const income = g.dir === 'in';
        const grp = income ? (g.category === 'Revenu' ? 'Salaire net' : 'Autre revenu') : IMPORT_CATEGORY[g.category] || 'Autre dépense fixe';
        st.picks.set(g.id, {
          on: !dup && !g.isTransfer && (g.kind === 'fixed' || (g.kind === 'recurring' && !income)),
          name: g.name, grp, monthly: Math.round(g.monthly * 100) / 100, dup,
        });
      }
    }

    async function readFiles(fileList) {
      for (const file of fileList) {
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          st.files = st.files.filter((f) => f.name !== file.name);
          try {
            const pdf = await I.readPdfStatement(await file.arrayBuffer());
            st.files.push({ name: file.name, rows: pdf.rows, cols: { date: 0, desc: [1], amount: 2, debit: -1, credit: -1 }, pdf: true,
              note: pdf.count ? null : pdf.hasText ? 'no transactions recognized in this PDF. Try this account’s CSV.' : 'this PDF has no text (a scanned document?). Try this account’s CSV.' });
          } catch (e) {
            st.files.push({ name: file.name, rows: [], cols: { date: 0, desc: [1], amount: 2, debit: -1, credit: -1 }, pdf: true,
              note: e.message === 'pdf-encrypted' ? 'this PDF is password-protected. Try this account’s CSV.' : 'this file cannot be read as a PDF.' });
          }
          continue;
        }
        const text = await readText(file);
        const rows = I.parseCSV(text);
        if (rows.length < 2) { st.files.push({ name: file.name, rows, cols: { date: -1, desc: [], amount: -1, debit: -1, credit: -1 } }); continue; }
        const cols = I.detectColumns(rows[0]);
        if (!cols.desc.length) cols.desc = rows[0].map((_, i) => i).filter((i) => i !== cols.date && i !== cols.amount && i !== cols.debit && i !== cols.credit).slice(0, 1);
        st.files = st.files.filter((f) => f.name !== file.name);
        st.files.push({ name: file.name, rows, cols });
        if (I.guessExpensesPositive(rows, cols)) st.flip[file.name] = true;
      }
      analyzeAll();
      draw();
    }

    function columnPicker(f) {
      const opts = (sel) => [h('option', { value: '-1', text: '—' }), ...f.rows[0].map((c, i) => h('option', { value: String(i), selected: sel === i ? true : null, text: c || `Column ${i + 1}` }))];
      const pick = (label, key) => h('div', { class: 'field' }, h('label', { text: label }),
        h('select', { onchange: (e) => { const v = Number(e.target.value); if (key === 'desc') f.cols.desc = v >= 0 ? [v] : []; else f.cols[key] = v; analyzeAll(); draw(); } },
          opts(key === 'desc' ? f.cols.desc[0] : f.cols[key])));
      return h('div', { class: 'banner col' },
        h('div', { text: `“${f.name}”: I don’t recognize all the columns. Pick which ones to use.` }),
        h('div', { class: 'fields' }, pick('Date', 'date'), pick('Description', 'desc'), pick('Amount', 'amount'), pick('Or: withdrawals', 'debit'), pick('Or: deposits', 'credit')));
    }

    function draw() {
      const fileInput = h('input', { type: 'file', id: 'import-files', accept: '.csv,text/csv,.pdf,application/pdf', multiple: true,
        onchange: (e) => readFiles(e.target.files) });
      const top = [
        h('h2', { text: 'Import statements' }),
        h('p', { class: 'footnote', text: 'In RBC Online Banking: open the account (or card), pick the period, then Download / Export as CSV. PDF statements work too (one file per month), in English or French. Import 2 to 3 months for each account. The file is read in your browser: it is not sent or kept, only the lines you add to the budget are saved.' }),
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('label', { for: 'import-files', text: 'CSV or PDF files' }), fileInput),
          h('div', { class: 'field' }, h('label', { for: 'import-owner', text: 'Whose accounts are these?' }),
            h('select', { id: 'import-owner', onchange: (e) => { st.owner = e.target.value; } },
              Object.entries(ownerOptions()).map(([k, l]) => h('option', { value: k, selected: k === st.owner ? true : null, text: l }))))),
      ];
      const body = [];
      if (st.files.length) {
        body.push(h('p', { class: 'footnote', text: 'Files: ' + st.files.map((f) => f.name).join(', ') }));
        for (const f of st.files) if (f.note) body.push(h('div', { class: 'banner', text: `“${f.name}”: ${f.note}` }));
        for (const f of st.problems || []) body.push(f.rows.length > 1 ? columnPicker(f) : h('div', { class: 'banner', text: `“${f.name}” is empty or is not a readable CSV.` }));
        for (const f of st.files) {
          if (f.cols.amount < 0 || f.pdf) continue;
          body.push(h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.flip[f.name] ? true : null,
            onchange: (e) => { st.flip[f.name] = e.target.checked; analyzeAll(); draw(); } }),
          `In “${f.name}”, purchases are positive amounts (credit cards)`));
        }
      }
      const r = st.result;
      if (r && r.count) {
        body.push(h('p', null, h('strong', { text: `${r.count} transactions` }), ` from ${fmtDate(r.from)} to ${fmtDate(r.to)} (≈ ${r.months.toFixed(1)} months).`));
        if (!r.canDetect) body.push(h('div', { class: 'banner', text: 'Less than 45 days of transactions: no way to tell what comes back every month. Add a 2nd or 3rd month for reliable detection. Meanwhile, here are the main merchants.' }));
        const oneoffCount = r.groups.filter((g) => g.kind === 'oneoff').length;
        const visible = r.groups.filter((g) => !r.canDetect || g.kind !== 'oneoff' || st.showOneoff).slice(0, r.canDetect ? 400 : 40);
        const allGroups = { Income: INC_GROUPS, 'Fixed expenses': FIXED_GROUPS, 'Variable envelopes': VAR_GROUPS, Children: CHILD_GROUPS };
        const rows = visible.map((g) => {
          const p = st.picks.get(g.id);
          const cat = h('select', { 'aria-label': 'Category', onchange: (e) => { p.grp = e.target.value; } },
            Object.entries(allGroups).map(([label, list]) => h('optgroup', { label }, list.map((x) => h('option', { value: x, selected: x === p.grp ? true : null, text: L(x) })))));
          const kindPill = g.kind === 'fixed' ? h('span', { class: 'pill ok', text: g.dir === 'in' ? 'regular income' : 'fixed' })
            : g.kind === 'recurring' ? h('span', { class: 'pill info', text: 'recurring, varying amount' }) : h('span', { class: 'pill', text: 'one-time' });
          return h('tr', null,
            h('td', null, h('input', { type: 'checkbox', 'aria-label': 'Add', checked: p.on ? true : null, onchange: (e) => { p.on = e.target.checked; updateCount(); } })),
            h('td', null,
              h('input', { class: 'inline', value: p.name, 'aria-label': 'Description', oninput: (e) => { p.name = e.target.value; } }),
              h('span', { class: 'sub' }, kindPill, ' ', g.isTransfer ? h('span', { class: 'pill warn', text: 'transfer?' }) : null, p.dup ? h('span', { class: 'pill warn', text: 'already in budget' }) : null,
                ` ${g.count} times · ${native(g.average, 'CAD')} on average`),
              h('span', { class: 'sub', title: g.description, text: g.description })),
            h('td', null, cat),
            h('td', { class: 'r' }, h('input', { class: 'inline num r', value: String(p.monthly), inputmode: 'decimal', 'aria-label': 'Amount per month',
              oninput: (e) => { const n = parseNum(e.target.value); if (Number.isFinite(n)) p.monthly = n; } }), h('span', { class: 'sub', text: '/ month' })));
        });
        body.push(h('div', { class: 'table-wrap import-table' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { text: 'Merchant' }), h('th', { text: 'Category' }), h('th', { class: 'r', text: 'Per month' }))),
          h('tbody', null, rows))));
        if (r.canDetect && oneoffCount) {
          body.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => { st.showOneoff = !st.showOneoff; draw(); },
            text: st.showOneoff ? 'Hide one-time purchases' : `Show one-time purchases (${oneoffCount})` }));
        }
        body.push(h('p', { class: 'footnote', text: 'Transfers (Interac, credit card payments) are unchecked: rent paid by Interac should be checked, a card payment should not (its purchases are already in the card’s statement). Checked lines in “Variable envelopes” become envelopes; those in “Children” go under “For all children”.' }));
      } else if (st.files.length && !(st.problems || []).length) {
        body.push(h('div', { class: 'banner', text: 'No transactions found in these files.' }));
      }
      const err = h('p', { class: 'form-error', role: 'alert' });
      const addBtnEl = h('button', { class: 'btn primary', type: 'button', id: 'import-add', onclick: async () => {
        const list = [];
        for (const g of (st.result ? st.result.groups : [])) {
          const p = st.picks.get(g.id);
          if (!p || !p.on || !(p.monthly > 0) || !p.name.trim()) continue;
          const income = INC_GROUPS.includes(p.grp);
          list.push({ name: p.name.trim(), grp: p.grp, kind: income ? 'income' : 'expense', nature: income ? 'fixed' : natureOf(p.grp),
            amount: Math.round(p.monthly * 100) / 100, freq: 'monthly', owner: st.owner, child_id: null });
        }
        if (!list.length) { err.textContent = 'Check at least one line.'; return; }
        addBtnEl.disabled = true;
        try { await undoable('statement import', () => insertRows('budget_items', list)); } catch (e) { err.textContent = errText(e); addBtnEl.disabled = false; return; }
        close();
        toast(`${list.length} line(s) added to the budget`, false, { label: 'Undo', fn: undoLast });
        refresh();
      } });
      function updateCount() {
        const n = st.result ? [...st.picks.values()].filter((p) => p.on).length : 0;
        addBtnEl.textContent = n ? `Add ${n} line${n > 1 ? 's' : ''} to the budget` : 'Add to the budget';
        addBtnEl.disabled = !n;
      }
      updateCount();
      panel.replaceChildren(...top, ...body, err,
        h('div', { class: 'sheet-actions' }, h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Close' }), addBtnEl)));
    }

    draw();
    sheet.replaceChildren(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    document.addEventListener('keydown', onKey);
  }

  // --- Portfolio import: Excel, CSV or a Google Sheets link -------------------
  const HOLDING_COLS = [
    ['symbol', 'Symbol'], ['name', 'Name'], ['qty', 'Quantity'], ['avg_cost', 'Average cost per unit'], ['book_value', 'Total cost'],
    ['price', 'Price or value per unit'], ['value', 'Total value'], ['account', 'Account'], ['owner', 'Owner'],
    ['currency', 'Currency'], ['market', 'Market'], ['date', 'Value date'], ['institution', 'Institution'],
  ];
  const TEMPLATES = {
    public: 'Account,Symbol,Name,Quantity,Average cost,Currency,Owner\nTFSA,XEQT,iShares Core Equity,100,28.50,CAD,\nRRSP,VFV,Vanguard S&P 500,20,110,CAD,\nNon-registered,AAPL,Apple,5,150,USD,\nTFSA,Cash,,250,,CAD,\n',
    private: 'Investment,Account,Owner,Value,Amount invested,Date\nReal estate fund,Non-registered,,25000,20000,2026-09-30\nShares of my company,Corporation,,120000,50000,2026-06-30\n',
  };

  function readBuffer(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openHoldingsImport(kind) {
    const I = window.Importer;
    const priv = kind === 'private';
    const linkKey = priv ? 'private_sheet_url' : 'public_sheet_url';
    const title = priv ? 'Import or update private investments' : 'Import public investments';
    const sheet = $('#sheet');
    const panel = h('div', { class: 'sheet-panel wide', role: 'dialog', 'aria-label': title });
    const st = {
      source: '', sheets: [], sheetIdx: 0, header: 0, cols: null, error: '', loading: false,
      link: S.settings[linkKey] || '', fromLink: false,
      owner: S.who === 'all' ? (priv ? 'joint' : 'p1') : S.who,
      account: priv ? 'Non enregistré' : 'CELI', market: 'TSX', date: todayISO(), dateSrc: '', savedDate: null, freq: 'quarterly',
      candidates: [], plan: null, picks: new Map(), remove: new Set(),
    };
    const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const rows = () => (st.sheets[st.sheetIdx] ? st.sheets[st.sheetIdx].rows : []);

    function useSheet(i) {
      st.sheetIdx = i;
      st.header = I.findHeaderRow(rows());
      st.cols = I.detectHoldingColumns(rows()[st.header] || []);
      // Value date: an "As of" cell above the table, else the day the .xlsx was saved, else today.
      const asOf = I.asOfDate(rows(), st.header);
      [st.date, st.dateSrc] = asOf ? [asOf, 'asof'] : st.savedDate ? [st.savedDate, 'saved'] : [todayISO(), ''];
      analyze();
    }
    function analyze() {
      if (!rows().length) { st.plan = null; return; }
      st.candidates = I.toHoldings(rows(), st.header, st.cols, {
        kind, owner: st.owner, account: st.account, market: st.market, date: st.date,
        ownerNames: { p1: S.settings.p1_name, p2: S.settings.p2_name },
        publicSymbols: priv ? new Set(S.holdings.filter((hd) => !isPrivate(hd) && hd.market !== 'CASH').map((hd) => String(hd.symbol).toUpperCase())) : null,
      });
      st.plan = I.planSync(st.candidates, S.holdings.filter((hd) => isPrivate(hd) === priv));
      st.picks = new Map(st.plan.items.map((it) => [it.key, it.status !== 'same']));
      st.remove = new Set();
    }

    async function loadFile(file) {
      st.error = '';
      try {
        const name = file.name.toLowerCase();
        st.savedDate = null;
        if (/\.xlsx$|\.xlsm$/.test(name)) {
          const buf = await readBuffer(file);
          st.sheets = await I.readXlsx(buf);
          st.savedDate = await I.xlsxSavedDate(buf).catch(() => null);
        }
        else if (/\.(xls|ods|numbers)$/.test(name)) throw new Error('This format cannot be read directly. In Excel or Numbers: File → Save As (or Export) → Excel Workbook (.xlsx) or CSV, then import that file.');
        else st.sheets = [{ name: file.name, rows: I.parseCSV(await readText(file)) }];
        if (!st.sheets.length || !st.sheets.some((sh2) => sh2.rows.length > 1)) throw new Error('This file has no data rows.');
        st.source = file.name;
        st.fromLink = false;
        useSheet(Math.max(0, st.sheets.findIndex((sh2) => sh2.rows.length > 1)));
      } catch (e) {
        st.sheets = []; st.plan = null;
        st.error = /not-zip|not-xlsx|zip-method/.test(e.message) ? 'This .xlsx file cannot be read. Open it in Excel and save it again, or export it as CSV.' : e.message;
      }
      draw();
    }

    async function loadLink() {
      st.error = '';
      const url = I.sheetsCsvUrl(st.link);
      if (!url) { st.error = 'This is not a Google Sheets link (it must start with https://docs.google.com/spreadsheets/…).'; draw(); return; }
      st.loading = true; draw();
      const notShared = 'Google Sheets refuses access. In the sheet: Share → General access → “Anyone with the link” (Viewer), then try again.';
      try {
        const res = await fetch(url, { credentials: 'omit' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || /html/.test(type)) throw new Error(notShared);
        const parsed = I.parseCSV(await res.text());
        if (parsed.length < 2) throw new Error('The sheet is empty.');
        st.sheets = [{ name: 'Google Sheets', rows: parsed }];
        st.savedDate = null;
        st.source = 'Google Sheets';
        st.fromLink = true;
        useSheet(0);
      } catch (e) {
        st.sheets = []; st.plan = null;
        st.error = e instanceof TypeError ? notShared : e.message;
      }
      st.loading = false;
      draw();
    }

    function sourceBlock() {
      const fileInput = h('input', { type: 'file', id: 'hold-file', accept: '.xlsx,.xlsm,.csv,.txt,.xls,.ods,.numbers,text/csv', onchange: (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); } });
      const linkInput = h('input', { id: 'hold-link', type: 'url', value: st.link, placeholder: 'https://docs.google.com/spreadsheets/d/…', autocomplete: 'off', spellcheck: 'false',
        oninput: (e) => { st.link = e.target.value.trim(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); loadLink(); } } });
      return h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 'hold-file', text: 'Excel file (.xlsx) or CSV' }), fileInput,
          h('span', { class: 'hint' }, st.source && !st.fromLink ? h('strong', { text: `Loaded: ${st.source}. ` }) : null, 'Read in your browser, never sent. ',
            h('a', { href: '#', onclick: (e) => { e.preventDefault(); downloadText(priv ? 'private-investments-template.csv' : 'public-investments-template.csv', TEMPLATES[kind]); }, text: 'Download a template' }))),
        h('div', { class: 'field' }, h('label', { for: 'hold-link', text: 'Or a Google Sheets link' }),
          h('div', { class: 'inline-row' }, linkInput, h('button', { class: 'btn', type: 'button', disabled: st.loading ? true : null, onclick: loadLink, text: st.loading ? 'Loading…' : 'Load' })),
          h('span', { class: 'hint', text: 'Share the sheet with “Anyone with the link” (Viewer). Anyone who has this link can see it: keep it to yourself. More private: File → Download → .xlsx, then import the file.' })));
    }

    function defaultsBlock() {
      const sel = (id, label, value, opts, onChange, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }),
        h('select', { id, onchange: (e) => { onChange(e.target.value); analyze(); draw(); } },
          (Array.isArray(opts) ? opts.map((o) => [o, L(o)]) : Object.entries(opts)).map(([v, l]) => h('option', { value: v, selected: v === value ? true : null, text: l }))),
        hint ? h('span', { class: 'hint', text: hint }) : null);
      const list = [
        sel('hold-owner', 'Owner', st.owner, ownerOptions(), (v) => { st.owner = v; }, st.cols && st.cols.owner >= 0 ? 'When the Owner column is empty' : 'The file has no Owner column'),
        sel('hold-account', 'Account', st.account, ACCOUNTS, (v) => { st.account = v; }, st.cols && st.cols.account >= 0 ? 'When the Account column is empty' : 'The file has no Account column'),
      ];
      if (!priv) {
        list.push(sel('hold-market', 'Default exchange', st.market, { TSX: 'TSX', US: 'NYSE / Nasdaq', NEO: 'Cboe Canada', TSXV: 'TSX Venture' }, (v) => { st.market = v; },
          'For symbols with no suffix (.TO) and no USD currency'));
      } else {
        list.push(h('div', { class: 'field' }, h('label', { for: 'hold-date', text: 'Value as of' }),
          h('input', { id: 'hold-date', type: 'date', value: st.date, onchange: (e) => { st.date = e.target.value || todayISO(); st.dateSrc = 'typed'; analyze(); draw(); } }),
          h('span', { class: 'hint', text: st.dateSrc === 'asof' ? 'Read from the sheet (“As of” / “En date du”). For rows without a date.'
            : st.dateSrc === 'saved' ? 'The date the Excel file was saved. For rows without a date.'
              : 'For rows without a date. Add an “As of” cell with the date above the table so it gets read.' })));
        list.push(sel('hold-freq', 'Planned update', st.freq, { '': 'No reminder', monthly: 'Every month', quarterly: 'Every quarter' }, (v) => { st.freq = v; }, 'For new investments'));
      }
      return h('div', { class: 'fields' }, list);
    }

    function columnsBlock(missingRequired) {
      const r = rows();
      const headerCells = r[st.header] || [];
      const headerSel = h('select', { id: 'hold-header', onchange: (e) => { st.header = Number(e.target.value); st.cols = I.detectHoldingColumns(r[st.header] || []); analyze(); draw(); } },
        r.slice(0, 20).map((row, i) => h('option', { value: String(i), selected: i === st.header ? true : null,
          text: `Row ${i + 1}: ${row.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60) || '(empty)'}` })));
      const keys = HOLDING_COLS.filter(([k]) => !(priv && k === 'market'));
      const pick = ([k, label]) => h('div', { class: 'field' }, h('label', { for: 'hold-col-' + k, text: label }),
        h('select', { id: 'hold-col-' + k, onchange: (e) => { st.cols[k] = Number(e.target.value); analyze(); draw(); } },
          h('option', { value: '-1', text: '—' }),
          headerCells.map((c, i) => h('option', { value: String(i), selected: st.cols[k] === i ? true : null, text: c || `Column ${i + 1}` }))));
      const found = keys.filter(([k]) => st.cols[k] >= 0).map(([, l]) => l);
      return h('details', { class: 'cols', open: missingRequired ? true : null },
        h('summary', null, found.length ? `Columns recognized: ${found.join(', ')}` : 'No columns recognized', h('span', { class: 'muted-caption', text: ' (change)' })),
        h('div', { class: 'fields' }, h('div', { class: 'field wide' }, h('label', { for: 'hold-header', text: 'Row with the column titles' }), headerSel), keys.map(pick)));
    }

    function previewBlock() {
      const out = [];
      const items = st.plan.items;
      const fmtVal = (row) => (row.market === 'MANUAL' ? native(row.qty * row.manual_price, row.currency)
        : row.market === 'CASH' ? native(row.qty, row.currency) : `${fmtQty.format(row.qty)} units`);
      const oldVal = (hd) => (hd.market === 'MANUAL' ? native(num(hd.qty) * num(hd.manual_price), hd.currency)
        : hd.market === 'CASH' ? native(num(hd.qty), hd.currency) : `${fmtQty.format(num(hd.qty))} units`);
      const counts = { new: 0, update: 0, same: 0 };
      for (const it of items) counts[it.status]++;
      out.push(h('p', null, h('strong', { text: `${items.length} investment(s) read` }),
        ` in “${st.source}${st.sheets.length > 1 ? ' › ' + st.sheets[st.sheetIdx].name : ''}”: ${counts.new} new, ${counts.update} to update, ${counts.same} unchanged.`));
      const body = items.map((it) => {
        const row = it.row;
        const pill = it.status === 'new' ? h('span', { class: 'pill info', text: 'new' })
          : it.status === 'update' ? h('span', { class: 'pill ok', text: 'update' }) : h('span', { class: 'pill', text: 'unchanged' });
        const label = row.market === 'MANUAL' ? (row.name || row.symbol) : row.market === 'CASH' ? `Cash ${row.currency}` : row.symbol;
        return h('tr', null,
          h('td', null, h('input', { type: 'checkbox', 'aria-label': 'Import ' + label, checked: st.picks.get(it.key) ? true : null,
            onchange: (e) => { st.picks.set(it.key, e.target.checked); updateCount(); } })),
          h('td', null, h('strong', { text: label }), ' ', row.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null, ' ', pill,
            h('span', { class: 'sub', text: [row.market === 'MANUAL' || row.market === 'CASH' ? null : row.name, L(row.account), ownerName(row.owner)].filter(Boolean).join(' · ') })),
          h('td', { class: 'r' }, fmtVal(row), it.status === 'update' ? h('span', { class: 'sub', text: 'before: ' + oldVal(it.match) }) : null),
          h('td', { class: 'r hide-sm' }, row.market === 'CASH' || row.avg_cost === null ? '—' : native(row.avg_cost, row.currency),
            h('span', { class: 'sub', text: row.market === 'MANUAL' && row.manual_price_date ? fmtDate(row.manual_price_date) : '' })));
      });
      out.push(h('div', { class: 'table-wrap import-table' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { text: priv ? 'Investment' : 'Security' }), h('th', { class: 'r', text: priv ? 'Value' : 'Quantity' }),
          h('th', { class: 'r hide-sm', text: priv ? 'Invested per unit' : 'Average cost' }))),
        h('tbody', null, body))));
      const skipped = st.candidates.filter((c) => !c.ok);
      if (skipped.length) {
        out.push(h('details', { class: 'cols' }, h('summary', null, `${skipped.length} row(s) skipped`),
          h('ul', { class: 'muted-caption' }, skipped.slice(0, 50).map((c) => h('li', { text: `Row ${c.line} (${c.label}): ${c.reason}` })))));
      }
      if (st.plan.missing.length) {
        out.push(h('h3', { class: 'subhead', text: 'Not in the file' }),
          h('p', { class: 'footnote', text: 'These investments are saved in the same accounts but are not in the file (sold?). Check the ones to remove from the app.' }),
          h('div', { class: 'checks' }, st.plan.missing.map((hd) => h('label', { class: 'switch' },
            h('input', { type: 'checkbox', checked: st.remove.has(hd.id) ? true : null, onchange: (e) => { if (e.target.checked) st.remove.add(hd.id); else st.remove.delete(hd.id); updateCount(); } }),
            `Remove ${hd.market === 'MANUAL' ? hd.name || hd.symbol : hd.market === 'CASH' ? 'cash ' + hd.currency : hd.symbol} · ${L(hd.account)} · ${ownerName(hd.owner)}`))));
      }
      return out;
    }

    const err = h('p', { class: 'form-error', role: 'alert' });
    const applyBtn = h('button', { class: 'btn primary', type: 'button', onclick: apply });
    function updateCount() {
      const n = st.plan ? st.plan.items.filter((it) => st.picks.get(it.key)).length : 0;
      const m = st.remove.size;
      applyBtn.textContent = n || m ? `Save${n ? ` ${n} investment${n > 1 ? 's' : ''}` : ''}${m ? `${n ? ' and' : ''} remove ${m}` : ''}` : 'Save';
      applyBtn.disabled = !(n || m);
    }

    async function apply() {
      err.textContent = '';
      const inserts = [], updates = [];
      for (const it of st.plan.items) {
        if (!st.picks.get(it.key)) continue;
        const row = it.row;
        if (!it.match) {
          inserts.push(priv && st.freq ? { ...row, update_freq: st.freq } : row);
          continue;
        }
        const upd = { qty: row.qty };
        if (row.avg_cost !== null) upd.avg_cost = row.avg_cost;
        if (row.market !== it.match.market || row.currency !== it.match.currency) Object.assign(upd, { market: row.market, currency: row.currency }); // e.g. BTC first saved on the TSX
        if (row.market === 'MANUAL') {
          upd.manual_price = row.manual_price;
          upd.manual_price_date = row.manual_price_date;
          if (st.freq && !it.match.update_freq) upd.update_freq = st.freq;
        }
        if (row.name && !it.match.name) upd.name = row.name;
        if (row.institution && !it.match.institution) upd.institution = row.institution;
        updates.push([it.match.id, upd]);
      }
      applyBtn.disabled = true;
      try {
        await undoable('investment import', async () => {
          if (inserts.length) await insertRows('holdings', inserts);
          const results = await Promise.allSettled(updates.map(([id, upd]) => saveRow('holdings', { id, ...upd })));
          const bad = results.find((r) => r.status === 'rejected');
          if (bad) throw bad.reason;
          if (st.remove.size) await deleteRows('holdings', [...st.remove]);
          if (st.fromLink && st.link !== (S.settings[linkKey] || '')) {
            try { await saveSettings({ [linkKey]: st.link }); } catch (e) { console.warn('Link not remembered:', e.message); }
          }
        });
      } catch (e) {
        err.textContent = errText(e);
        applyBtn.disabled = false;
        refresh();
        return;
      }
      close();
      toast([inserts.length ? `${inserts.length} added` : '', updates.length ? `${updates.length} updated` : '', st.remove.size ? `${st.remove.size} removed` : ''].filter(Boolean).join(', '),
        false, { label: 'Undo', fn: undoLast });
      refresh();
    }

    function draw() {
      const parts = [h('h2', { text: title }),
        h('p', { class: 'footnote', text: priv
          ? 'One row per investment: name, current value, and if possible the amount invested, the account, the owner and the value date. Investments already saved (same name, same account) are updated. French or English column titles both work.'
          : 'Export your positions from your broker (Excel or CSV) or use your own sheet: symbol, quantity, and if possible the average cost, the account and the currency. Securities already saved (same symbol, same account) are updated. French or English column titles both work.' }),
        sourceBlock()];
      if (st.error) parts.push(h('div', { class: 'banner', text: st.error }));
      if (st.sheets.length > 1) {
        parts.push(h('div', { class: 'field' }, h('label', { for: 'hold-sheet', text: 'Sheet' }),
          h('select', { id: 'hold-sheet', onchange: (e) => { useSheet(Number(e.target.value)); draw(); } },
            st.sheets.map((sh2, i) => h('option', { value: String(i), selected: i === st.sheetIdx ? true : null, text: `${sh2.name} (${Math.max(0, sh2.rows.length - 1)} rows)` })))));
      }
      if (st.plan) {
        const c = st.cols;
        const missingRequired = priv ? !((c.name >= 0 || c.symbol >= 0) && (c.value >= 0 || c.price >= 0)) : !(c.symbol >= 0 && (c.qty >= 0 || c.value >= 0));
        parts.push(h('h3', { class: 'subhead', text: 'Defaults' }), defaultsBlock(), columnsBlock(missingRequired));
        if (missingRequired) parts.push(h('div', { class: 'banner', text: priv ? 'Pick at least the name column and the value column.' : 'Pick at least the symbol column and the quantity column.' }));
        if (st.plan.items.length || st.plan.missing.length) parts.push(...previewBlock());
        else if (!missingRequired) parts.push(h('div', { class: 'banner', text: 'No investments recognized in this sheet. Check the row with the column titles above.' }));
      }
      updateCount();
      panel.replaceChildren(...parts, err,
        h('div', { class: 'sheet-actions' }, h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Close' }), applyBtn)));
    }

    draw();
    sheet.replaceChildren(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    document.addEventListener('keydown', onKey);
    if (st.link) loadLink();
  }

  /** Every table in one Excel file (a backup the household keeps; Supabase's free plan has no automatic backups). */
  function exportAll() {
    const own = (o) => ownerName(o);
    const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const holdings = S.holdings.map((hd) => {
      const v = C.valueHolding(hd, S.prices);
      return [hd.symbol, hd.name, hd.market, L(hd.account), own(hd.owner), hd.currency, n(hd.qty), n(hd.avg_cost), v.px, v.mv === null ? null : Math.round(v.mv * 100) / 100, v.date, CLASSES[Object.keys(holdingMix(hd))[0]] || ''];
    });
    const sheets = [
      { name: 'Investments', rows: [['Symbol', 'Name', 'Market', 'Account', 'Owner', 'Currency', 'Quantity', 'Average cost', 'Price', 'Value (CAD)', 'Price date', 'Category'], ...holdings] },
      { name: 'Trades', rows: [['Date', 'Type', 'Security', 'Account', 'Owner', 'Quantity', 'Price', 'Fees', 'Currency', 'USD/CAD rate', 'Realized gain (CAD)', 'Note'],
        ...S.transactions.map((t) => [t.trade_date, t.kind === 'buy' ? 'Buy' : 'Sell', t.symbol, L(t.account), own(t.owner), n(t.qty), n(t.price), n(t.fees), t.currency, n(t.fx_rate), n(t.realized_gain), t.note])] },
      { name: 'Assets', rows: [['Name', 'Type', 'Value', 'As of', 'Owner'], ...S.assets.map((a) => [a.name, L(a.kind), n(a.value), a.as_of, own(a.owner)])] },
      { name: 'Debts', rows: [['Name', 'Type', 'Lender', 'Balance', 'Balance as of', 'Rate %', 'Rate', 'Payment', 'Frequency', 'Term end', 'Owner'],
        ...S.debts.map((d) => [d.name, DEBT_KINDS[d.kind], d.lender, n(d.balance), d.balance_date, n(d.rate), d.rate_type === 'variable' ? 'variable' : 'fixed', n(d.payment), (FREQS[d.freq] || {}).label, C.termEnd(d), own(d.owner)])] },
      { name: 'Budget', rows: [['Description', 'Category', 'Type', 'Amount', 'Frequency', 'Per month', 'For'],
        ...(() => { const net = budgetNet(); return S.budget.map((b) => [b.name, L(b.grp), b.kind === 'income' ? (isGross(b) ? 'Income (gross)' : 'Income') : b.nature === 'variable' ? 'Envelope' : 'Fixed expense', n(b.amount), (FREQS[b.freq] || {}).label, Math.round(net.get(b) * 100) / 100, own(b.owner)]); })()] },
      { name: 'One-time expenses', rows: [['Date', 'Description', 'Category', 'Amount', 'For'], ...S.log.map((e) => [e.spend_date, e.label, L(e.grp), n(e.amount), own(e.owner)])] },
      { name: 'Children', rows: [['Name', 'Birth date', 'RESP value entered', 'As of'], ...S.children.map((c) => [c.name, c.birth_date, n(c.resp_value), c.resp_value_date])] },
      { name: 'RESP', rows: [['Child', 'Date', 'Type', 'Contribution', 'CESG', 'QESI', 'Note'],
        ...S.resp.map((r) => [(S.children.find((c) => c.id === r.child_id) || {}).name, r.entry_date, r.kind === 'opening' ? 'Starting balance' : 'Contribution', n(r.amount), n(r.cesg), n(r.iqee), r.note])] },
      { name: 'Projects', rows: [['Name', 'Target', 'Target date', 'Already set aside', 'Per month', 'Return %'], ...S.projects.map((p) => [p.name, n(p.target_amount), p.target_date, n(p.saved), n(p.monthly_contribution), n(p.expected_return)])] },
      { name: 'Companies', rows: [['Name', 'Structure', 'Owner', 'Salary', 'Dividends', '5,500 h', 'Revenue / year', 'Expenses / year', 'Company tax', 'In your pockets'],
        ...S.companies.map((c) => { const v = companyView(c); return [c.name, CO_KIND[c.kind], own(c.owner), n(c.salary), n(c.dividends), c.sbd_hours ? 'yes' : 'no', Math.round(v.y.revenue), Math.round(v.y.expenses), v.y.corpTax ? Math.round(v.y.corpTax.total) : null, Math.round(v.pocket)]; })] },
      { name: 'Company lines', rows: [['Company', 'Description', 'Category', 'Type', 'Amount', 'Frequency', 'Deductible %'],
        ...S.company_items.map((i) => [(S.companies.find((c) => c.id === i.company_id) || {}).name, i.name, L(i.grp), i.kind === 'income' ? 'Income' : 'Expense', n(i.amount), (FREQS[i.freq] || {}).label, n(i.deductible_pct)])] },
      { name: 'TFSA-RRSP room', rows: [['Person', 'Plan', 'Year', 'Type', 'Amount', 'Date', 'Note'],
        ...S.contributions.map((c) => [own(c.owner), PLAN_LABEL[c.plan] || c.plan, n(c.year), { room: 'Room', contribution: 'Contribution', withdrawal: 'Withdrawal' }[c.kind], n(c.amount), c.entry_date, c.note])] },
      { name: 'Net worth history', rows: [['Date', 'Investments', 'Other assets', 'Debts', 'Net worth'],
        ...S.snapshots.filter((x) => x.data && x.data.all).map((x) => [x.snap_date, n(x.data.all.inv), n(x.data.all.oth), n(x.data.all.debt), n(x.data.all.net)])] },
    ];
    const bytes = window.Importer.writeXlsx(sheets);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = h('a', { href: url, download: `household-finances-${todayISO()}.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Excel file created');
  }

  function openSettings() {
    openForm({
      title: 'Settings',
      values: { p1_name: S.settings.p1_name, p2_name: S.settings.p2_name, public_sheet_url: S.settings.public_sheet_url, private_sheet_url: S.settings.private_sheet_url },
      fields: [
        { k: 'p1_name', label: 'Name of person 1', type: 'text', req: true },
        { k: 'p2_name', label: 'Name of person 2', type: 'text', req: true },
        // Only once the database has these columns (schema.sql run again after the update).
        ...('public_sheet_url' in S.settings ? [
          { k: 'public_sheet_url', label: 'Google Sheets link: public investments', type: 'text', wide: true, placeholder: 'None', hint: 'Remembered on the first import by link. Clear it to forget it.' },
          { k: 'private_sheet_url', label: 'Google Sheets link: private investments', type: 'text', wide: true, placeholder: 'None' },
        ] : []),
      ],
      onSave: (out) => saveSettings(out),
    });
  }

  // ---------------------------------------------------------------------------
  // Screens before the app
  // ---------------------------------------------------------------------------
  function loginScreen() {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h('form', { class: 'card login', novalidate: true },
      h('h1', { text: 'Household finances' }),
      h('p', { text: 'Sign in with the account created for you.' }),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 'login-email', text: 'Email' }), h('input', { id: 'login-email', type: 'email', autocomplete: 'username', required: true })),
        h('div', { class: 'field' }, h('label', { for: 'login-password', text: 'Password' }), h('input', { id: 'login-password', type: 'password', autocomplete: 'current-password', required: true }))),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
      btn.disabled = false;
      if (error) err.textContent = /invalid/i.test(error.message) ? 'Wrong email or password.' : errText(error);
    });
    return form;
  }

  function setupScreen() {
    return h('div', { class: 'card login setup' },
      h('h1', { text: 'Almost ready' }),
      h('p', null, 'Open ', h('code', { text: 'config.js' }), ' and replace the two values with the URL and the publishable key of your Supabase project. The full steps are in ', h('code', { text: 'README.md' }), '.'));
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { const box = $('#networth-chart'); if (box) drawNetWorth(box); }, 150);
  });
  window.addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (TABS.some(([k]) => k === t) && t !== S.tab) { S.tab = t; render(); }
  });
  // Pick up the other person's changes when coming back to the tab.
  let lastLoad = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.session && Date.now() - lastLoad > 15000 && $('#sheet').hidden) { lastLoad = Date.now(); refresh(); }
  });

  async function boot() {
    render();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    sb.auth.onAuthStateChange((event, session) => {
      const was = S.session;
      S.session = session;
      if (!session) { S.loaded = false; undoStack.length = 0; render(); }
      else if (!was || (event === 'SIGNED_IN' && was.user.id !== session.user.id)) {
        S.loaded = false; render(); lastLoad = Date.now();
        setTimeout(refresh, 0); // never call Supabase from inside this callback (auth lock)
      }
    });
    if (S.session) { render(); lastLoad = Date.now(); await refresh(); } else render();
    // Ctrl+Z / Cmd+Z undoes the last saved change, except while typing (the field undoes its own typing) or in a form.
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (!$('#sheet').hidden || !undoStack.length || !S.loaded) return;
      e.preventDefault();
      undoLast();
    });
  }
  boot();
})();
