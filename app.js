/* Finances du ménage — web app. Data lives in Supabase; calc.js holds the formulas. */
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
    TSX: { label: 'TSX (Bourse de Toronto)', cur: 'CAD', auto: true },
    TSXV: { label: 'TSX croissance', cur: 'CAD', auto: true },
    NEO: { label: 'Cboe Canada (ex-NEO)', cur: 'CAD', auto: true },
    US: { label: 'NYSE / Nasdaq (É.-U.)', cur: 'USD', auto: true },
    MANUAL: { label: 'Placement privé ou prix entré à la main (fonds commun, crypto…)', cur: null, auto: false },
    CASH: { label: 'Encaisse dans le compte', cur: null, auto: false },
  };
  const ACCOUNTS = ['CELI', 'REER', 'CELIAPP', 'REEE', 'FERR', 'CRI / FRV', 'Non enregistré', 'Société', 'Autre'];
  const ASSET_KINDS = ['Résidence principale', 'Immeuble locatif', 'Chalet', 'Véhicule', 'Compte bancaire', 'Fonds de pension', 'Entreprise', 'Autre'];
  const DEBT_KINDS = {
    mortgage: 'Hypothèque', heloc: 'Marge hypothécaire', loc: 'Marge de crédit', auto: 'Prêt auto',
    student: 'Prêt étudiant', card: 'Carte de crédit', personal: 'Prêt personnel', other: 'Autre',
  };
  const FIXED_GROUPS = ['Logement', 'Électricité et chauffage', 'Internet et téléphone', 'Assurances', 'Transport',
    'Alimentation', 'Abonnements', 'Santé', 'Épargne et placements', 'Dons', 'Autre dépense fixe'];
  const VAR_GROUPS = ['Voyages', 'Shopping', 'Loisirs et sorties', 'Restaurants', 'Cadeaux', 'Maison et entretien', 'Autre dépense variable'];
  const CHILD_GROUPS = ['Garderie / service de garde', 'Activités', 'Jouets', 'Vêtements', 'École', 'Santé des enfants', 'Autre (enfants)'];
  const isChildGroup = (g) => CHILD_GROUPS.includes(g);
  const natureOf = (g) => (VAR_GROUPS.includes(g) ? 'variable' : 'fixed');
  const INC_GROUPS = ['Salaire net', 'Travail autonome', 'Allocations familiales', 'Revenus de placement', 'Autre revenu'];
  const SAVINGS_GROUP = 'Épargne et placements';
  const DEBT_FREQS = Object.fromEntries(Object.entries(FREQS).filter(([k]) => k !== 'yearly').map(([k, v]) => [k, v.label]));
  const ALL_FREQS = Object.fromEntries(Object.entries(FREQS).map(([k, v]) => [k, v.label]));
  const TABS = [['portfolio', 'Portfolio'], ['actifs', 'Actifs'], ['budget', 'Budget'], ['enfants', 'Enfants'], ['dettes', 'Dettes'], ['projets', 'Projets'],
    ['compagnies', 'Compagnies'], ['projections', 'Projections']];

  const S = {
    session: null,
    settings: { p1_name: 'Personne 1', p2_name: 'Personne 2', include_debt_payments: true },
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

  const fmt0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtC = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 });
  const fmtQty = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 6 });
  const fmtPct = new Intl.NumberFormat('fr-CA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPctS = new Intl.NumberFormat('fr-CA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const fmtRate = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fmtYears = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 });
  const fmtFx = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const money = (v) => fmt0.format(Math.round(v) === 0 ? 0 : v);
  const moneySigned = (v) => (v > 0.5 ? '+' : '') + money(v);
  function native(v, cur) {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: cur || 'CAD', minimumFractionDigits: 2, maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 2 }).format(v);
  }
  function fmtDate(iso, opts) {
    if (!iso) return '—';
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return new Intl.DateTimeFormat('fr-CA', opts || { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }
  const todayISO = () => new Date().toLocaleDateString('en-CA');
  const cls = (v) => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
  const ownerName = (o) => (o === 'p1' ? S.settings.p1_name : o === 'p2' ? S.settings.p2_name : 'Commun');
  const sh = (owner) => C.share(owner, S.who);

  function parseNum(raw) {
    if (raw === null || raw === undefined) return null;
    const t = String(raw).replace(/[\s  $]/g, '').replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  let toastTimer;
  function toast(msg, err) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (err ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, err ? 6000 : 2500);
  }
  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/row-level security|permission denied/i.test(m)) return "Ce compte n'a pas accès à ces données.";
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Connexion impossible. Vérifie ta connexion Internet.';
    if (/column .* does not exist|Could not find the .* column/i.test(m)) return 'La base de données doit être mise à jour : dans Supabase, relance le fichier supabase/schema.sql (SQL Editor → Run).';
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

  async function saveRow(table, row) {
    const { id, ...rest } = row;
    const res = id ? await sb.from(table).update(rest).eq('id', id) : await sb.from(table).insert(rest);
    if (res.error) throw res.error;
  }
  async function deleteRow(table, id) {
    const res = await sb.from(table).delete().eq('id', id);
    if (res.error) throw res.error;
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

  function budgetView() {
    const items = S.budget.map((b) => ({ b, f: sh(b.owner), m: C.monthly(b.amount, b.freq) })).filter((r) => r.f);
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
    for (const r of fixed) add(isChildGroup(r.b.grp) ? 'Enfants' : r.b.grp, r.m * r.f);
    for (const r of envelopes) add(r.b.grp, r.m * r.f);
    if (debtTotal > 0) add('Paiements de dettes', debtTotal);
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
    if (!sb) return app.replaceChildren(h('div', { class: 'login' }, h('h1', { text: 'Finances du ménage' }), h('p', { text: "La bibliothèque Supabase n'a pas pu être chargée. Recharge la page." })));
    if (!S.session) return app.replaceChildren(loginScreen());
    if (!S.loaded) return app.replaceChildren(h('div', { class: 'boot', text: 'Chargement des données…' }));
    if (S.loadError) {
      return app.replaceChildren(header(), h('div', { class: 'card empty' },
        h('strong', { text: 'Les données ne se chargent pas' }), h('p', { text: S.loadError }),
        h('button', { class: 'btn', onclick: refresh, text: 'Réessayer' })));
    }
    if (S.denied) {
      return app.replaceChildren(header(), h('div', { class: 'card empty' },
        h('strong', { text: "Ce compte n'a pas accès" }),
        h('p', { text: `${S.session.user.email} ne fait pas partie de la liste des membres du ménage. Ajoute ce courriel à la table allowed_users dans Supabase.` })));
    }
    const panel = { portfolio: renderPortfolio, actifs: renderActifs, budget: renderBudget, enfants: renderEnfants, dettes: renderDettes, projets: renderProjets,
      compagnies: renderCompagnies, projections: renderProjections }[S.tab]();
    const notice = S.outdated ? h('div', { class: 'banner' },
      'Nouveautés à activer : dans Supabase, ouvre SQL Editor, colle le fichier supabase/schema.sql (avec vos deux courriels) et clique Run. Vos données restent intactes.') : null;
    app.replaceChildren(header(), summary(), notice || '', tabs(), panel);
  }

  function header() {
    const p = S.loaded ? portfolio() : null;
    const fx = S.prices['FX:USDCAD'];
    const parts = [];
    if (p && p.lastClose) parts.push(`Prix de clôture du ${fmtDate(p.lastClose)}`);
    if (fx) parts.push(`USD/CAD ${fmtFx.format(num(fx.close))} (Banque du Canada, ${fmtDate(fx.price_date, { day: 'numeric', month: 'short' })})`);
    const who = h('div', { class: 'seg', role: 'group', 'aria-label': 'Afficher pour' },
      [['all', 'Ménage'], ['p1', S.settings.p1_name], ['p2', S.settings.p2_name]].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(S.who === k), onclick: () => { S.who = k; storeSet('who', k); render(); }, text: label })));
    return h('header', { class: 'top' },
      h('div', null, h('h1', { text: 'Finances du ménage' }), h('p', { class: 'sub', text: parts.join(' · ') || 'Les prix se mettent à jour chaque soir de bourse.' })),
      h('div', { class: 'top-actions' },
        S.loaded && !S.denied && !S.loadError ? who : null,
        S.loaded && !S.denied && !S.loadError ? h('button', { class: 'btn ghost', type: 'button', onclick: exportAll, text: 'Exporter', title: 'Toutes les données dans un fichier Excel' }) : null,
        S.loaded && !S.denied ? h('button', { class: 'btn ghost', type: 'button', onclick: openSettings, text: 'Réglages' }) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => sb.auth.signOut(), text: 'Déconnexion' })));
  }

  function summary() {
    const t = currentTotals();
    const p = portfolio();
    const b = budgetView();
    const whoNote = S.who === 'all' ? 'Ménage au complet' : `${ownerName(S.who)}, avec 50 % des biens communs`;
    return h('section', { class: 'summary', 'aria-label': 'Résumé' },
      stat('Avoir net', money(t.net), whoNote, 'lead'),
      stat('Placements', money(t.inv), p.day ? h('span', { class: cls(p.day), text: `${moneySigned(p.day)} aujourd'hui` }) : 'Valeur au dernier prix'),
      stat('Dettes', money(t.debt), t.debt ? `${money(debtsView().monthlyPay)} de paiements / mois` : 'Aucune dette inscrite'),
      stat('Surplus mensuel', b.inc || b.exp ? h('span', { class: cls(b.surplus), text: moneySigned(b.surplus) }) : '—',
        b.rate !== null ? `Taux d'épargne ${fmtPct.format(b.rate)}` : 'Budget à remplir'));
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

  function bars(entries, total, variant) {
    if (!entries.length) return h('p', { class: 'footnote', text: 'Rien à afficher pour l’instant.' });
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
        h('strong', { text: 'Aucun placement pour l’instant' }),
        h('p', { text: 'Ajoute chaque titre que vous détenez (FNB, actions, fonds) avec son compte, ou importe tout le portefeuille d’un coup depuis un fichier Excel, un CSV ou un lien Google Sheets. Les prix des placements publics se mettent à jour chaque soir de bourse.' }),
        h('div', { class: 'card-actions' },
          addBtn('Importer un portefeuille', () => openHoldingsImport('public')),
          h('button', { class: 'btn', type: 'button', onclick: () => openHolding(), text: 'Ajouter un placement' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openHolding(null, { market: 'MANUAL' }), text: 'Ajouter un placement privé' }))));
      return root;
    }
    const due = S.holdings.filter((hd) => isPrivate(hd) && sh(hd.owner) && privateDue(hd));
    const banners = [];
    const staleDays = p.oldestClose ? Math.floor((Date.now() - new Date(p.oldestClose + 'T16:00:00')) / 86400000) : null;
    if (staleDays !== null && staleDays > 4) banners.push(`Certains prix datent du ${fmtDate(p.oldestClose)}. Vérifie que la mise à jour quotidienne (GitHub Actions) roule toujours.`);
    if (p.atCost) banners.push(`${p.atCost} placement(s) sans prix encore : ils sont comptés au coût jusqu'à la prochaine mise à jour.`);
    if (p.missingFx) banners.push(`${p.missingFx} placement(s) en USD exclus : le taux USD/CAD n'est pas encore disponible.`);
    if (due.length) banners.push(`${due.length} placement(s) privé(s) à mettre à jour : ${due.map((hd) => hd.name || hd.symbol).join(', ').replace(/\.$/, '')}.`);
    for (const b of banners) root.append(h('div', { class: 'banner', text: b }));

    root.append(card('Rendement', p.lastClose ? `Au prix de clôture du ${fmtDate(p.lastClose)}` : 'Valeurs actuelles', null,
      h('div', { class: 'kpis' },
        kpi('Valeur marchande', money(p.mv)),
        kpi('Coût total', money(p.cost)),
        kpi('Gain non réalisé', h('span', { class: cls(p.gain), text: moneySigned(p.gain) }), p.cost > 0 ? h('span', { class: cls(p.gain), text: fmtPctS.format(p.gain / p.cost) }) : null),
        kpi('Variation du jour', h('span', { class: cls(p.day), text: moneySigned(p.day) }), p.mv - p.day > 0 ? h('span', { class: cls(p.day), text: fmtPctS.format(p.day / (p.mv - p.day)) }) : null))));

    const byAccount = new Map(), byTitle = new Map();
    for (const r of p.rows) {
      if (r.mv === null) continue;
      const v = r.mv * r.f;
      byAccount.set(r.h.account || 'Autre', (byAccount.get(r.h.account || 'Autre') || 0) + v);
      const key = r.h.market === 'CASH' ? 'Encaisse' : r.h.symbol.toUpperCase();
      byTitle.set(key, (byTitle.get(key) || 0) + v);
    }
    const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    const titles = sortDesc(byTitle);
    const top = titles.slice(0, 8);
    if (titles.length > 8) top.push(['Autres', titles.slice(8).reduce((a, e) => a + e[1], 0)]);
    root.append(h('div', { class: 'grid' },
      card('Par compte', null, null, bars(sortDesc(byAccount), p.mv)),
      card('Par titre', null, null, bars(top, p.mv, 'muted'))));

    const sorted = [...p.rows].sort((a, b) => (b.mv ?? -1) * b.f - (a.mv ?? -1) * a.f);
    const pub = sorted.filter((r) => !isPrivate(r.h));
    const priv = sorted.filter((r) => isPrivate(r.h));
    const sum = (rows) => rows.reduce((a, r) => a + (r.mv === null ? 0 : r.mv * r.f), 0);
    const open = (hd) => ({ class: 'click', tabindex: '0', onclick: () => openHolding(hd), onkeydown: (e) => { if (e.key === 'Enter') openHolding(hd); } });
    const sharePct = (v) => h('span', { class: 'sub', text: v !== null && p.mv > 0 ? fmtPct.format(v / p.mv) : '' });

    const pubBody = pub.map((r) => {
      const hd = r.h;
      const shown = r.mv === null ? null : r.mv * r.f;
      const gain = r.mv === null ? null : (r.mv - r.cost) * r.f;
      let priceNote;
      if (r.src === 'close') priceNote = fmtDate(r.date, { day: 'numeric', month: 'short' });
      else if (r.src === 'cost') priceNote = h('span', { class: 'pill warn', text: 'au coût' });
      return h('tr', open(hd),
        h('td', null,
          hd.market === 'CASH' ? h('span', { class: 'ticker', text: 'ENCAISSE' }) : h('span', { class: 'ticker', text: hd.symbol.toUpperCase() }),
          ' ', hd.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null,
          h('span', { class: 'sub', text: [hd.name, hd.account, ownerName(hd.owner) + (r.f < 1 ? ' (50 %)' : '')].filter(Boolean).join(' · ') })),
        h('td', { class: 'r hide-sm' }, hd.market === 'CASH' ? '—' : fmtQty.format(num(hd.qty))),
        h('td', { class: 'r hide-sm' }, hd.market === 'CASH' ? '—' : native(num(hd.avg_cost), hd.currency)),
        h('td', { class: 'r' }, hd.market === 'CASH' ? '—' : native(r.px, hd.currency), h('span', { class: 'sub' }, hd.market === 'CASH' ? null : priceNote)),
        h('td', { class: 'r' }, shown === null ? '—' : money(shown), sharePct(shown)),
        h('td', { class: 'r ' + cls(gain || 0) }, gain === null || hd.market === 'CASH' ? '—' : moneySigned(gain),
          h('span', { class: 'sub', text: gain !== null && r.cost > 0 && hd.market !== 'CASH' ? fmtPctS.format((r.mv - r.cost) / r.cost) : '' })));
    });
    const pubLink = !!S.settings.public_sheet_url;
    root.append(card('Placements publics', pub.length ? `${pub.length} position(s) · ${money(sum(pub))} · cours de clôture mis à jour chaque soir de bourse` : 'Actions, FNB et encaisse : le cours se met à jour chaque soir de bourse.',
      [h('button', { class: 'btn', type: 'button', onclick: () => openHoldingsImport('public'), text: pubLink ? 'Mettre à jour (Google Sheets)' : 'Importer' }),
        addBtn('Ajouter un placement', () => openHolding())],
      pub.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Titre' }), h('th', { class: 'r hide-sm', text: 'Quantité' }), h('th', { class: 'r hide-sm', text: 'Coût moyen' }),
          h('th', { class: 'r', text: 'Cours' }), h('th', { class: 'r', text: 'Valeur (CAD)' }), h('th', { class: 'r', text: 'Gain / perte' }))),
        h('tbody', null, pubBody))) : h('p', { class: 'footnote', text: 'Aucun placement public. Importe un relevé de ton courtier (Excel ou CSV) ou ajoute les titres un à un.' }),
      pub.length ? h('p', { class: 'footnote', text: 'Clique sur une ligne pour la modifier. Le coût des titres en USD est converti au taux du jour; pour l’impôt, le prix de base rajusté utilise le taux de la date d’achat.' }) : null));

    const privBody = priv.map((r) => {
      const hd = r.h;
      const shown = r.mv === null ? null : r.mv * r.f;
      const gain = r.mv === null || hd.avg_cost === null || hd.avg_cost === undefined ? null : (r.mv - r.cost) * r.f;
      const late = privateDue(hd);
      return h('tr', open(hd),
        h('td', null,
          h('strong', { text: hd.name || hd.symbol }), ' ', hd.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null,
          late ? h('span', { class: 'pill warn', text: 'à mettre à jour' }) : null,
          h('span', { class: 'sub', text: [hd.account, ownerName(hd.owner) + (r.f < 1 ? ' (50 %)' : ''), hd.institution, FREQ_LABEL[hd.update_freq]].filter(Boolean).join(' · ') })),
        h('td', { class: 'r' }, shown === null ? '—' : money(shown),
          h('span', { class: 'sub' }, r.src === 'manual' ? (r.date ? 'au ' + fmtDate(r.date) : '') : h('span', { class: 'pill warn', text: 'au coût' }))),
        h('td', { class: 'r hide-sm' }, gain === null ? '—' : money(r.cost * r.f)),
        h('td', { class: 'r ' + cls(gain || 0) }, gain === null ? '—' : moneySigned(gain),
          h('span', { class: 'sub', text: gain !== null && r.cost > 0 ? fmtPctS.format((r.mv - r.cost) / r.cost) : '' })));
    });
    const privLink = !!S.settings.private_sheet_url;
    root.append(card('Placements privés', priv.length ? `${priv.length} placement(s) · ${money(sum(priv))} · valeur entrée à la main ou importée` : 'Fonds privés, actions d’une compagnie, prêts privés, immobilier en parts… mis à jour chaque mois ou trimestre.',
      [h('button', { class: 'btn', type: 'button', onclick: () => openHoldingsImport('private'), text: privLink ? 'Mettre à jour (Google Sheets)' : 'Importer / mettre à jour' }),
        addBtn('Ajouter un placement privé', () => openHolding(null, { market: 'MANUAL' }))],
      priv.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Placement' }), h('th', { class: 'r', text: 'Valeur (CAD)' }), h('th', { class: 'r hide-sm', text: 'Investi' }),
          h('th', { class: 'r', text: 'Gain / perte' }))),
        h('tbody', null, privBody))) : h('p', { class: 'footnote', text: 'Aucun placement privé. Ajoute-les un à un, ou importe une feuille avec une ligne par placement (nom, valeur, montant investi, date).' }),
      priv.length ? h('p', { class: 'footnote', text: 'Pour mettre à jour : clique sur une ligne, ou importe une nouvelle version du fichier ou du lien. Les lignes reconnues sont mises à jour, les nouvelles sont ajoutées.' }) : null));
    if (!S.outdated) root.append(allocationCard(p), tradesCard(), roomCard());
    return root;
  }
  // --- Asset allocation ---------------------------------------------------------
  const CLASSES = { equity: 'Actions', bond: 'Obligations', cash: 'Encaisse', real_estate: 'Immobilier', other: 'Autre' };
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
    if (hd.market === 'MANUAL') return { other: 1 };
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
    const rows = Object.entries(CLASSES).filter(([k]) => totals[k] > 0.5 || (targets && num(targets[k]) > 0)).map(([k, label]) => {
      const cur = totals[k] / total;
      const tgt = targets ? num(targets[k]) / 100 : null;
      const diff = tgt === null ? null : tgt * total - totals[k];
      return h('div', { class: 'alloc-row' },
        h('div', { class: 'name', text: label }),
        h('div', { class: 'bar-track' },
          h('div', { class: 'bar-fill', style: `width:${(cur * 100).toFixed(2)}%; background:${CLASS_COLORS[k]}` }),
          tgt !== null ? h('div', { class: 'target-mark', style: `left:${(tgt * 100).toFixed(2)}%`, title: `Cible ${fmtPct.format(tgt)}` }) : null),
        h('div', { class: 'amt' }, `${fmtPct.format(cur)}`, h('small', { text: money(totals[k]) })),
        diff === null ? null : h('div', { class: 'amt ' + (Math.abs(diff) < total * 0.01 ? '' : diff > 0 ? 'up' : 'down') },
          Math.abs(diff) < total * 0.01 ? 'à la cible' : `${diff > 0 ? 'acheter' : 'vendre'} ${money(Math.abs(diff))}`, h('small', { text: `cible ${fmtPct.format(tgt)}` })));
    });
    return card('Répartition des actifs', targets ? 'Actuelle (barre) et cible (trait), avec ce qu’il faut acheter ou vendre pour revenir à la cible' : 'Selon le type de chaque placement (les FNB tout-en-un sont répartis selon leur composition)',
      [h('button', { class: 'btn', type: 'button', onclick: openTargets, text: targets ? 'Modifier la cible' : 'Fixer une cible' })],
      h('div', { class: 'alloc' }, rows),
      h('p', { class: 'footnote', text: 'Clique sur un placement pour changer sa catégorie. Les placements privés comptent dans « Autre » tant qu’on ne leur donne pas de catégorie. Pour rééquilibrer sans impôt, privilégie les nouveaux dépôts et les comptes CELI ou REER.' }));
  }

  function openTargets() {
    const t = S.settings.allocation_targets || { equity: 80, bond: 20, cash: 0, real_estate: 0, other: 0 };
    openForm({
      title: 'Répartition cible (%)',
      values: { ...t },
      fields: Object.entries(CLASSES).map(([k, label]) => ({ k, label, type: 'num' })),
      onSave: async (out) => {
        const clean = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, out[k] || 0]));
        const sum = Object.values(clean).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.5) throw new Error(`Le total doit faire 100 % (présentement ${fmtYears.format(sum)} %).`);
        const res = await sb.from('settings').update({ allocation_targets: clean }).eq('id', 1);
        if (res.error) throw res.error;
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
    const kindLabel = { buy: 'Achat', sell: 'Vente' };
    const list = mine.slice(0, 15).map((t) => clickRow(() => openTrade(t),
      h('td', null, `${kindLabel[t.kind]} ${t.symbol}`, h('span', { class: 'sub', text: [t.account, ownerName(t.owner), fmtDate(t.trade_date)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r' }, `${fmtQty.format(num(t.qty))} × ${native(num(t.price), t.currency)}`, h('span', { class: 'sub', text: num(t.fees) ? `frais ${native(num(t.fees), t.currency)}` : '' })),
      h('td', { class: 'r ' + (t.kind === 'sell' ? cls(num(t.realized_gain)) : '') }, t.kind === 'sell' ? moneySigned(num(t.realized_gain)) : '—',
        h('span', { class: 'sub', text: t.kind === 'sell' ? (TAX_SHELTERED.includes(t.account) ? 'à l’abri' : t.account === 'Société' ? 'dans la compagnie' : 'imposable') : '' }))));
    return card('Transactions et gains réalisés', 'Un achat ou une vente met à jour la quantité et le coût moyen du placement', [addBtn('Acheter ou vendre', () => openTrade())],
      h('div', { class: 'kpis' },
        kpi(`Gains imposables ${year}`, h('span', { class: cls(cur.taxable), text: moneySigned(cur.taxable) }), cur.taxable > 0 ? `${money(cur.taxable * INCLUSION)} à déclarer (50 %)` : 'comptes non enregistrés'),
        kpi('Dans les comptes à l’abri', moneySigned(cur.sheltered), 'CELI, REER… : pas d’impôt'),
        cur.company ? kpi('Dans la compagnie', moneySigned(cur.company), 'imposé dans la compagnie') : null,
        [...byYear.keys()].filter((y) => y !== year).length ? kpi('Années précédentes', moneySigned([...byYear.entries()].filter(([y]) => y !== year).reduce((a, [, e]) => a + e.taxable, 0)), 'gains imposables') : null),
      list.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Transaction' }), h('th', { class: 'r', text: 'Quantité × prix' }), h('th', { class: 'r', text: 'Gain réalisé' }))),
        h('tbody', null, list))) : h('p', { class: 'footnote', text: 'Aucune transaction. Les ventes calculent le gain ou la perte selon le coût moyen (prix de base rajusté).' }),
      h('p', { class: 'footnote', text: 'Gain = produit de la vente moins les frais, moins le coût moyen × la quantité vendue. Titres en USD : converti au taux du jour de la transaction (approximatif : pour l’impôt, le coût se calcule au taux de chaque achat). Attention aux pertes apparentes (rachat dans les 30 jours). Ton relevé de courtier (T5008) fait foi.' }));
  }

  /** Records a buy or a sell and updates the holding. Editing an existing one only changes its note and date. */
  function openTrade(t) {
    if (t) {
      return openForm({
        title: `${t.kind === 'buy' ? 'Achat' : 'Vente'} de ${t.symbol}`,
        values: { trade_date: t.trade_date, note: t.note },
        fields: [
          { k: 'trade_date', label: 'Date', type: 'date' },
          { k: 'note', label: 'Note', type: 'text', wide: true, hint: 'Supprimer une transaction ne change pas le placement : corrige la quantité ou le coût dans le placement lui-même.' },
        ],
        onSave: (out) => saveRow('transactions', { id: t.id, ...out }),
        onDelete: () => deleteRow('transactions', t.id),
      });
    }
    const choices = { '': 'Nouveau titre…' };
    for (const hd of S.holdings.filter((x) => x.market !== 'CASH')) choices[hd.id] = `${hd.market === 'MANUAL' ? hd.name || hd.symbol : hd.symbol} · ${hd.account} · ${ownerName(hd.owner)}`;
    const firstId = Object.keys(choices)[1] || '';
    const marketOpts = Object.fromEntries(Object.entries(MARKETS).filter(([k]) => k !== 'CASH').map(([k, m]) => [k, m.label]));
    openForm({
      title: 'Acheter ou vendre',
      values: { holding: firstId, kind: 'buy', trade_date: todayISO(), market: 'TSX', account: 'CELI', owner: S.who === 'all' ? 'p1' : S.who, fx_rate: fxNow() ? String(fxNow()).replace('.', ',') : '' },
      fields: [
        { k: 'holding', label: 'Placement', type: 'select', options: choices, wide: true },
        { k: 'kind', label: 'Opération', type: 'select', options: { buy: 'Achat', sell: 'Vente' }, show: (s) => !!s.holding, clearWhenHidden: false },
        { k: 'symbol', label: 'Symbole', type: 'text', upper: true, req: true, show: (s) => !s.holding, placeholder: 'XEQT' },
        { k: 'market', label: 'Marché', type: 'select', options: marketOpts, show: (s) => !s.holding },
        { k: 'account', label: 'Compte', type: 'select', options: ACCOUNTS, show: (s) => !s.holding },
        { k: 'owner', label: 'Propriétaire', type: 'owner', show: (s) => !s.holding },
        { k: 'trade_date', label: 'Date', type: 'date' },
        { k: 'qty', label: 'Quantité', type: 'num', req: true },
        { k: 'price', label: 'Prix par part', type: 'num', req: true, hint: 'Dans la devise du titre' },
        { k: 'fees', label: 'Frais (facultatif)', type: 'num' },
        { k: 'fx_rate', label: 'Taux USD/CAD ce jour-là', type: 'num', show: (s) => {
          const hd = S.holdings.find((x) => x.id === s.holding);
          return hd ? hd.currency === 'USD' : s.market === 'US';
        } },
        { k: 'note', label: 'Note (facultatif)', type: 'text', wide: true },
      ],
      onSave: async (out) => {
        const qty = out.qty, price = out.price, fees = out.fees || 0;
        if (!(qty > 0)) throw new Error('La quantité doit être plus grande que zéro.');
        let hd = S.holdings.find((x) => x.id === out.holding) || null;
        const kind = hd ? out.kind : 'buy';
        const currency = hd ? hd.currency : MARKETS[out.market].cur || 'CAD';
        const fx = currency === 'USD' ? (out.fx_rate || fxNow() || 1) : 1;
        const base = { trade_date: out.trade_date || todayISO(), kind, qty, price, fees, currency, fx_rate: currency === 'USD' ? fx : null, note: out.note };
        if (!hd) {
          const row = { market: out.market, symbol: out.symbol, currency, qty, avg_cost: (qty * price + fees) / qty, account: out.account, owner: out.owner };
          if (out.market === 'MANUAL') { row.manual_price = price; row.manual_price_date = base.trade_date; }
          const r = await sb.from('holdings').insert(row).select();
          if (r.error) throw r.error;
          const created = Array.isArray(r.data) ? r.data[0] : r.data;
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
        if (qty > q + 1e-9) throw new Error(`Tu ne détiens que ${fmtQty.format(q)} parts de ce placement.`);
        tx.acb_per_unit = avg * fx;
        tx.realized_gain = Math.round(((qty * price - fees) * fx - qty * avg * fx) * 100) / 100;
        await saveRow('transactions', tx);
        if (q - qty < 1e-9) await deleteRow('holdings', hd.id); // all sold
        else await saveRow('holdings', { id: hd.id, qty: q - qty });
      },
    });
  }

  // --- CELI / REER room ---------------------------------------------------------
  const PLAN_LABEL = { CELI: 'CELI', REER: 'REER' };
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
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openContribution(null, { owner, plan, year }), text: '+ Mouvement' })),
        st.room === null
          ? h('p', { class: 'footnote' }, 'Droits pas encore entrés. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openContribution(null, { owner, plan, year, kind: 'room' }); },
            text: plan === 'CELI' ? 'Entre tes droits au 1er janvier' : 'Entre ton maximum déductible' }),
            plan === 'CELI' ? ' (Mon dossier de l’ARC).' : ' (avis de cotisation de l’ARC).')
          : h('div', null,
            h('div', { class: 'big' + (over ? ' down' : ''), text: money(st.left) }),
            h('div', { class: 'muted-caption', text: over ? 'cotisation excédentaire : pénalité de 1 % par mois' : `encore permis en ${year}` }),
            h('div', { class: 'progress' + (over ? ' over' : ''), role: 'progressbar', 'aria-valuenow': Math.round(used * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(used * 100).toFixed(1)}%` })),
            h('div', { class: 'footnote', style: 'margin-top:4px', text: `${money(st.contributed)} cotisé sur ${money(st.room)}${st.withdrawn ? ` · ${money(st.withdrawn)} retiré` : ''}` }),
            st.next !== null ? h('div', { class: 'footnote', text: `Au 1er janvier ${year + 1} : environ ${money(st.next)} (retraits de ${year} + ${money(T().PARAMS.tfsaLimit)} de nouveaux droits)` }) : null));
    };
    const recent = S.contributions.filter((c) => people.includes(c.owner)).slice().sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))).slice(0, 8);
    const kindLabel = { room: 'Droits', contribution: 'Cotisation', withdrawal: 'Retrait' };
    return card(`Droits de cotisation ${year}`, 'CELI et REER de chacun, d’après les montants de l’ARC et vos mouvements', null,
      people.length ? h('div', { class: 'rooms' }, people.flatMap((p) => [block(p, 'CELI'), block(p, 'REER')])) : h('p', { class: 'footnote', text: 'Choisis une personne en haut pour voir ses droits.' }),
      recent.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, recent.map((c) => clickRow(() => openContribution(c),
        h('td', null, `${kindLabel[c.kind]} ${PLAN_LABEL[c.plan]}`, h('span', { class: 'sub', text: `${ownerName(c.owner)} · année ${c.year}${c.note ? ' · ' + c.note : ''}` })),
        h('td', { class: 'r' }, (c.kind === 'withdrawal' ? '− ' : '') + money(num(c.amount)), h('span', { class: 'sub', text: fmtDate(c.entry_date) }))))))) : null,
      h('p', { class: 'footnote', text: `REER : une cotisation faite dans les 60 premiers jours de l’année peut compter pour l’année d’avant (choisis l’année dans le formulaire); 2 000 $ d’excédent sont tolérés. CELI : un retrait redonne les droits seulement le 1er janvier suivant. Nouveaux droits CELI ${year} : ${money(T().PARAMS.tfsaLimit)}; plafond REER ${year} : ${money(T().PARAMS.rrspLimit)}.` }));
  }

  function openContribution(c, preset = {}) {
    const year = new Date().getFullYear();
    const v = c ? { ...c, year: String(c.year) } : { owner: 'p1', plan: 'CELI', kind: 'contribution', year: String(year), entry_date: todayISO(), ...preset };
    if (!c && preset.year) v.year = String(preset.year);
    openForm({
      title: c ? 'Modifier' : v.kind === 'room' ? 'Entrer les droits' : 'Ajouter un mouvement',
      values: v,
      fields: [
        { k: 'owner', label: 'Personne', type: 'select', options: { p1: S.settings.p1_name, p2: S.settings.p2_name } },
        { k: 'plan', label: 'Régime', type: 'select', options: PLAN_LABEL },
        { k: 'kind', label: 'Type', type: 'select', options: (s) => (s.plan === 'CELI' ? { contribution: 'Cotisation', withdrawal: 'Retrait', room: 'Droits au 1er janvier' } : { contribution: 'Cotisation', room: 'Maximum déductible (avis de cotisation)' }) },
        { k: 'year', label: 'Année visée', type: 'select', options: () => [String(year + 1), String(year), String(year - 1)] },
        { k: 'amount', label: 'Montant', type: 'num', req: true },
        { k: 'entry_date', label: 'Date', type: 'date' },
        { k: 'note', label: 'Note (facultatif)', type: 'text', wide: true, placeholder: 'Wealthsimple, virement automatique…' },
      ],
      onSave: (out) => saveRow('contributions', { ...out, id: c && c.id, year: Number(out.year), entry_date: out.entry_date || todayISO() }),
      onDelete: c ? () => deleteRow('contributions', c.id) : null,
    });
  }

  const isPrivate = (hd) => hd.market === 'MANUAL';
  const FREQ_LABEL = { monthly: 'chaque mois', quarterly: 'chaque trimestre' };
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
    const rangeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Période' },
      [['3m', '3 mois'], ['1y', '1 an'], ['all', 'Tout']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(S.range === k), onclick: () => { S.range = k; storeSet('range', k); render(); }, text: label })));
    root.append(card('Avoir net dans le temps', 'Un point par soir de bourse, enregistré par la mise à jour automatique.',
      [rangeSeg, h('button', { class: 'btn', type: 'button', onclick: saveSnapshotNow, text: 'Enregistrer aujourd’hui' })],
      chartBox,
      h('div', { class: 'legend' },
        h('span', { style: '--c: var(--accent)', text: 'Avoir net' }),
        h('span', { style: '--c: var(--series-2)', text: 'Actifs' }),
        h('span', { style: '--c: var(--loss)', text: 'Dettes' }))));
    requestAnimationFrame(() => drawNetWorth(chartBox));

    const otherByKind = new Map();
    for (const a of S.assets) {
      const f = sh(a.owner);
      if (f) otherByKind.set(a.kind || 'Autre', (otherByKind.get(a.kind || 'Autre') || 0) + num(a.value) * f);
    }
    const assetEntries = [['Placements', t.inv], ...[...otherByKind.entries()].sort((a, b) => b[1] - a[1])].filter((e) => e[1] > 0);
    const assetTotal = t.inv + t.oth;
    root.append(h('div', { class: 'grid' },
      card('Ce que vous possédez', `Total ${money(assetTotal)}`, null, bars(assetEntries, assetTotal)),
      card('Ce que vous devez', `Total ${money(t.debt)}`, null,
        bars(debtsView().rows.map((r) => [r.d.name, num(r.d.balance) * r.f]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]), t.debt, 'loss'))));

    const rows = S.assets.filter((a) => sh(a.owner)).map((a) =>
      h('tr', { class: 'click', tabindex: '0', onclick: () => openAsset(a), onkeydown: (e) => { if (e.key === 'Enter') openAsset(a); } },
        h('td', null, a.name, h('span', { class: 'sub', text: `${a.kind} · ${ownerName(a.owner)}${sh(a.owner) < 1 ? ' (50 %)' : ''}` })),
        h('td', { class: 'r hide-sm', text: fmtDate(a.as_of) }),
        h('td', { class: 'r', text: money(num(a.value) * sh(a.owner)) })));
    root.append(card('Autres actifs', 'Maison, comptes bancaires, véhicules… Mets la valeur à jour de temps en temps.', [addBtn('Ajouter un actif', () => openAsset())],
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Actif' }), h('th', { class: 'r hide-sm', text: 'Valeur en date du' }), h('th', { class: 'r', text: 'Valeur' }))),
          h('tbody', null, rows)))
        : h('p', { class: 'footnote', text: 'Aucun autre actif inscrit. Les placements sont déjà comptés dans l’onglet Portfolio.' })));
    return root;
  }

  async function saveSnapshotNow() {
    const data = C.snapshotData({ holdings: S.holdings, prices: S.prices, assets: S.assets, debts: S.debts });
    const res = await sb.from('snapshots').upsert({ snap_date: todayISO(), data, source: 'manuel' }, { onConflict: 'snap_date' });
    if (res.error) return toast(errText(res.error), true);
    toast('Point d’aujourd’hui enregistré');
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
        h('strong', { text: snaps.length ? 'Un seul point pour l’instant' : 'Le graphique se remplit tout seul' }),
        h('p', { text: 'La mise à jour automatique ajoute un point chaque soir de bourse. Tu peux aussi cliquer « Enregistrer aujourd’hui ».' })));
      return;
    }
    const pts = snaps.map((x) => ({ t: new Date(x.snap_date + 'T12:00:00').getTime(), date: x.snap_date, d: x.data[key] }));
    const series = [
      { name: 'Avoir net', color: 'var(--accent)', get: (p) => num(p.d.net), area: true, width: 2.5 },
      { name: 'Actifs', color: 'var(--series-2)', get: (p) => num(p.d.inv) + num(p.d.oth), width: 1.75 },
      { name: 'Dettes', color: 'var(--loss)', get: (p) => num(p.d.debt), width: 1.75 },
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
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label || 'Évolution de l’avoir net' });
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
      const label = new Intl.DateTimeFormat('fr-CA', dfmt).format(new Date(t));
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
        ...bands.map((b) => h('div', { class: 'row', style: `--c:${b.color}`, text: `${b.name} ${money(b.lo(p))} à ${money(b.hi(p))}` })));
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
  const ownerNote = (o, f) => ownerName(o) + (f < 1 ? ' (50 %)' : '');
  const childName = (id) => (S.children.find((c) => c.id === id) || {}).name;
  const monthLabel = (m) => new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric' }).format(new Date(m + '-15T12:00:00'));
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
          const res = await sb.from('settings').update({ include_debt_payments: e.target.checked }).eq('id', 1);
          if (res.error) return toast(errText(res.error), true);
          refresh();
        } }),
      'Inclure les paiements de l’onglet Dettes');

    root.append(card('Budget mensuel', 'Montants ramenés par mois (aux 2 semaines × 26 ÷ 12, hebdomadaire × 52 ÷ 12, annuel ÷ 12).', [toggle],
      h('div', { class: 'kpis' },
        kpi('Revenus', money(b.inc)),
        kpi('Dépenses fixes', money(b.fixedTotal + b.debtTotal), b.debtTotal ? `dont ${money(b.debtTotal)} de dettes` : null),
        kpi('Variables prévues', money(b.varPlanned)),
        kpi('Surplus', h('span', { class: cls(b.surplus), text: moneySigned(b.surplus) })),
        kpi('Taux d’épargne', b.rate === null ? '—' : fmtPct.format(b.rate), 'Surplus + épargne planifiée, divisé par les revenus'))));

    const groups = [...b.byGroup.entries()].sort((x, y) => y[1] - x[1]);
    root.append(card('Où va l’argent', 'Dépenses fixes, enveloppes variables et paiements de dettes, par mois.', null, bars(groups, b.exp)));

    const head = (title) => h('thead', null, h('tr', null, h('th', { text: title }), h('th', { class: 'r hide-sm', text: 'Montant' }), h('th', { class: 'r', text: 'Par mois' })));
    const line = (r) => clickRow(() => openBudget(r.b),
      h('td', null, r.b.name, h('span', { class: 'sub', text: [r.b.child_id ? childName(r.b.child_id) : null, r.b.grp, ownerNote(r.b.owner, r.f)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r hide-sm' }, native(num(r.b.amount), 'CAD'), h('span', { class: 'sub', text: (FREQS[r.b.freq] || FREQS.monthly).label })),
      h('td', { class: 'r', text: money(r.m * r.f) }));
    const total = (v) => h('tfoot', null, h('tr', null, h('td', { text: 'Total' }), h('td', { class: 'hide-sm' }), h('td', { class: 'r', text: money(v) })));
    const importBtn = h('button', { class: 'btn', type: 'button', onclick: openImport, text: 'Importer des relevés' });

    root.append(card('Revenus', null, [addBtn('Ajouter un revenu', () => openBudget({ kind: 'income' }))],
      b.income.length
        ? h('div', { class: 'table-wrap' }, h('table', null, head('Source'), h('tbody', null, b.income.map(line)), total(b.inc)))
        : h('p', { class: 'footnote', text: 'Ajoute les salaires nets (après impôts), allocations et autres revenus, ou importe un relevé pour les détecter.' })));

    const fixedRows = [...b.fixed].sort((x, y) => x.b.grp.localeCompare(y.b.grp, 'fr') || y.m - x.m).map(line);
    const debtRows = b.debtLines.map((d) => h('tr', null,
      h('td', null, d.name, h('span', { class: 'sub' }, 'Paiements de dettes · ', h('span', { class: 'pill info', text: 'auto' }))),
      h('td', { class: 'r hide-sm', text: '—' }), h('td', { class: 'r', text: money(d.m) })));
    root.append(card('Dépenses fixes', 'Ce qui revient chaque mois : loyer, électricité, Internet, assurances… Les dépenses des enfants s’ajoutent dans l’onglet Enfants.',
      [importBtn, addBtn('Ajouter', () => openBudget({ kind: 'expense', nature: 'fixed' }))],
      fixedRows.length || debtRows.length
        ? h('div', { class: 'table-wrap' }, h('table', null, head('Dépense'), h('tbody', null, fixedRows, debtRows), total(b.fixedTotal + b.debtTotal)))
        : h('p', { class: 'footnote', text: 'Aucune dépense fixe. Le plus rapide : « Importer des relevés » avec 2 ou 3 mois de transactions RBC.' })));

    root.append(variableCard(b));
    return root;
  }

  function variableCard(b) {
    const lv = logView(S.month);
    const planned = new Map();
    for (const r of b.envelopes) planned.set(r.b.grp, (planned.get(r.b.grp) || 0) + r.m * r.f);
    const grps = new Set([...planned.keys(), ...[...lv.monthByGrp.keys(), ...lv.ytdByGrp.keys()].filter((g) => !isChildGroup(g))]);
    const rows = [...grps].sort((a, c) => (planned.get(c) || 0) - (planned.get(a) || 0) || a.localeCompare(c, 'fr')).map((g) => {
      const p = planned.get(g) || 0;
      const spent = lv.monthByGrp.get(g) || 0;
      const ytdP = p * lv.monthIndex;
      const ytdS = lv.ytdByGrp.get(g) || 0;
      const env = b.envelopes.find((r) => r.b.grp === g);
      const over = p > 0 && spent > p;
      return clickRow(() => (env ? openBudget(env.b) : openBudget({ kind: 'expense', nature: 'variable', grp: g })),
        h('td', null, g, p ? null : h('span', { class: 'sub' }, h('span', { class: 'pill warn', text: 'hors budget' }))),
        h('td', { class: 'r', text: p ? money(p) : '—' }),
        h('td', { class: 'r' + (over ? ' down' : '') }, money(spent), p ? h('span', { class: 'sub', text: fmtPct.format(spent / p) }) : null),
        h('td', { class: 'r hide-sm' }, money(ytdS), h('span', { class: 'sub', text: ytdP ? 'sur ' + money(ytdP) : '' })));
    });
    const childSpent = [...lv.monthByGrp.entries()].filter(([g]) => isChildGroup(g)).reduce((a, [, v]) => a + v, 0);
    const monthTotal = [...lv.monthByGrp.values()].reduce((a, v) => a + v, 0);
    const entries = lv.inMonth.map(({ e, f }) => clickRow(() => openExpense(e),
      h('td', null, e.label, h('span', { class: 'sub', text: [fmtDate(e.spend_date, { day: 'numeric', month: 'short' }), e.grp, e.child_id ? childName(e.child_id) : null, ownerNote(e.owner, f)].filter(Boolean).join(' · ') })),
      h('td', { class: 'r', text: money(num(e.amount) * f) })));
    const nav = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mois' },
      h('button', { type: 'button', 'aria-label': 'Mois précédent', onclick: () => { S.month = shiftMonth(S.month, -1); render(); }, text: '‹' }),
      h('button', { type: 'button', 'aria-pressed': 'true', text: monthLabel(S.month) }),
      h('button', { type: 'button', 'aria-label': 'Mois suivant', onclick: () => { S.month = shiftMonth(S.month, 1); render(); }, text: '›' }));
    return card('Dépenses variables', 'Une enveloppe par mois pour ce qui varie (voyages, magasinage, sorties), et les dépenses notées au fil du mois.',
      [nav, h('button', { class: 'btn', type: 'button', onclick: () => openBudget({ kind: 'expense', nature: 'variable' }), text: 'Ajouter une enveloppe' }),
        addBtn('Noter une dépense', () => openExpense())],
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Enveloppe' }), h('th', { class: 'r', text: 'Prévu / mois' }), h('th', { class: 'r', text: 'Dépensé' }), h('th', { class: 'r hide-sm', text: 'Depuis janvier' }))),
          h('tbody', null, rows)))
        : h('p', { class: 'footnote', text: 'Crée des enveloppes (ex. Voyages 300 $ / mois) puis note les dépenses au fur et à mesure.' }),
      h('h3', { class: 'subhead', text: `Dépenses notées en ${monthLabel(S.month)}` + (monthTotal ? ` · ${money(monthTotal)}` : '') }),
      entries.length
        ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, entries)))
        : h('p', { class: 'footnote', text: 'Rien de noté ce mois-ci.' }),
      childSpent ? h('p', { class: 'footnote', text: `Inclut ${money(childSpent)} de dépenses pour les enfants (détail dans l’onglet Enfants).` }) : null);
  }

  // --- Enfants ----------------------------------------------------------------
  function renderEnfants() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-enfants' });
    if (!S.children.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'Aucun enfant inscrit' }),
        h('p', { text: 'Ajoute chaque enfant pour suivre ses dépenses (garderie, activités, jouets) et son REEE : cotisations, subventions reçues et montant à cotiser cette année.' }),
        addBtn('Ajouter un enfant', () => openChild())));
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
      if (!c.birth_date) advice = h('p', { class: 'footnote', text: 'Ajoute la date de naissance pour calculer les droits aux subventions.' });
      else if (!rs.eligible) advice = h('p', { class: 'footnote', text: `Plus de subventions après ${rs.lastGrantYear} (année des 17 ans). Les cotisations restent possibles jusqu’à 31 ans, sans subvention.` });
      else if (rs.toContribute > 0) advice = h('div', { class: 'callout' },
        h('strong', { text: `Cotiser encore ${money(rs.toContribute)} en ${year}` }),
        ` pour aller chercher le maximum : ${money(rs.cesgMaxThisYear)} de SCEE et ${money(rs.iqeeMaxThisYear)} d’IQEE (montants de base).`);
      else advice = h('div', { class: 'callout ok' }, h('strong', { text: `Maximum ${year} atteint` }), ` : ${money(rs.contribYear)} cotisés cette année.`);

      const fixedRows = fixed.map((r) => clickRow(() => openBudget(r.b),
        h('td', null, r.b.name, h('span', { class: 'sub', text: `${r.b.grp} · ${(FREQS[r.b.freq] || FREQS.monthly).label}` })),
        h('td', { class: 'r', text: money(r.m * r.f) })));
      const logRows = logs.slice(0, 8).map((r) => clickRow(() => openExpense(r.e),
        h('td', null, r.e.label, h('span', { class: 'sub', text: `${fmtDate(r.e.spend_date, { day: 'numeric', month: 'short' })} · ${r.e.grp}` })),
        h('td', { class: 'r', text: money(num(r.e.amount) * r.f) })));
      const respRows = [...entries].reverse().slice(0, 6).map((e) => clickRow(() => openResp(c, e),
        h('td', null, e.kind === 'opening' ? 'Solde de départ' : 'Cotisation', h('span', { class: 'sub', text: fmtDate(e.entry_date) + (e.note ? ' · ' + e.note : '') })),
        h('td', { class: 'r' }, money(num(e.amount)), h('span', { class: 'sub', text: num(e.cesg) || num(e.iqee) ? `SCEE ${money(num(e.cesg))} · IQEE ${money(num(e.iqee))}` : '' }))));

      return h('article', { class: 'card child' },
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { text: c.name }), h('p', { text: rs.age !== null ? `${rs.age} an${rs.age > 1 ? 's' : ''} · né(e) le ${fmtDate(c.birth_date)}` : 'Date de naissance à ajouter' })),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => openChild(c), text: 'Modifier' }))),
        h('div', { class: 'kpis' },
          kpi('Dépenses récurrentes', money(fixedM), 'par mois'),
          kpi(`Dépenses ponctuelles ${year}`, money(spentY)),
          kpi('Valeur du REEE', respValue ? money(respValue) : '—', linked.count ? `${linked.count} placement(s) lié(s)` : c.resp_value_date ? `au ${fmtDate(c.resp_value_date)}` : 'à inscrire')),
        h('h3', { class: 'subhead', text: 'REEE' }),
        h('dl', { class: 'facts four' },
          h('div', null, h('dt', { text: 'Cotisations totales' }), h('dd', { text: money(rs.contrib) })),
          h('div', null, h('dt', { text: `Cotisé en ${year}` }), h('dd', { text: money(rs.contribYear) })),
          h('div', null, h('dt', { text: 'SCEE reçue' }), h('dd', { text: `${money(rs.cesg)} / 7 200 $` })),
          h('div', null, h('dt', { text: 'IQEE reçu' }), h('dd', { text: `${money(rs.iqee)} / 3 600 $` }))),
        advice,
        rs.at16or17 ? h('p', { class: 'footnote', text: 'À 16 et 17 ans, la SCEE n’est versée que si au moins 2 000 $ ont été cotisés avant la fin de l’année des 15 ans, ou au moins 100 $ par année pendant 4 ans avant cette date.' }) : null,
        respRows.length ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, respRows))) : h('p', { class: 'footnote', text: 'Inscris un solde de départ (cotisations et subventions reçues à ce jour, selon le dernier relevé), puis chaque cotisation.' }),
        h('h3', { class: 'subhead', text: 'Dépenses' }),
        fixedRows.length || logRows.length
          ? h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, fixedRows, logRows)))
          : h('p', { class: 'footnote', text: 'Garderie, activités, jouets, vêtements…' }),
        h('div', { class: 'card-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => openResp(c), text: 'Cotisation REEE' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openBudget({ kind: 'expense', nature: 'fixed', child_id: c.id, grp: CHILD_GROUPS[0] }), text: 'Dépense récurrente' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openExpense(null, { child_id: c.id }), text: 'Dépense ponctuelle' })));
    });

    const shared = S.budget.filter((b) => !b.child_id && isChildGroup(b.grp) && b.kind === 'expense' && sh(b.owner));
    root.append(card('Les enfants', null, [addBtn('Ajouter un enfant', () => openChild())],
      h('div', { class: 'kpis' },
        kpi('Dépenses récurrentes', money(totFixed + shared.reduce((a, b) => a + C.monthly(b.amount, b.freq) * sh(b.owner), 0)), 'par mois, tous les enfants'),
        kpi(`Ponctuelles ${year}`, money(totYear)),
        kpi('REEE', money(totResp), 'valeur totale'),
        kpi(`À cotiser en ${year}`, money(totToContrib), 'pour le maximum des subventions'))));
    if (shared.length) {
      root.append(card('Pour tous les enfants', 'Dépenses d’enfants non attribuées à un enfant en particulier (souvent venues d’un import).', null,
        h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, shared.map((b) => clickRow(() => openBudget(b),
          h('td', null, b.name, h('span', { class: 'sub', text: b.grp })), h('td', { class: 'r', text: money(C.monthly(b.amount, b.freq) * sh(b.owner)) }))))))));
    }
    root.append(h('div', { class: 'children' }, cards));
    root.append(h('p', { class: 'footnote', text: 'Subventions de base selon les règles 2025 : SCEE 20 % (max 500 $/an, 1 000 $ avec rattrapage, 7 200 $ à vie) et IQEE 10 % (max 250 $/an, 500 $ avec rattrapage, 3 600 $ à vie), jusqu’à l’année des 17 ans. La SCEE supplémentaire, le supplément de l’IQEE et le Bon d’études canadien, liés au revenu familial, ne sont pas calculés. Plafond de cotisation à vie : 50 000 $ par enfant.' }));
    return root;
  }

  // --- Dettes -----------------------------------------------------------------
  function renderDettes() {
    const root = h('div', { role: 'tabpanel', 'aria-labelledby': 'tab-dettes' });
    const dv = debtsView();
    if (!dv.rows.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: S.debts.length ? 'Aucune dette pour cette personne' : 'Aucune dette inscrite' }),
        h('p', { text: 'Ajoute l’hypothèque (taux, terme, amortissement, paiement), les marges de crédit, prêts auto ou cartes.' }),
        addBtn('Ajouter une dette', () => openDebt())));
      return root;
    }
    root.append(card('Vue d’ensemble', null, [addBtn('Ajouter une dette', () => openDebt())],
      h('div', { class: 'kpis' },
        kpi('Dette totale', money(dv.total)),
        kpi('Paiements', money(dv.monthlyPay), 'par mois, en équivalent mensuel'),
        kpi('Taux moyen', `${fmtRate.format(dv.avgRate)} %`, 'pondéré par le solde'),
        kpi('Intérêts', money(dv.monthlyInterest), 'estimés ce mois-ci'))));

    const charts = [];
    const cards = [...dv.rows].sort((a, b) => num(b.d.balance) - num(a.d.balance)).map(({ d, f, st }) => {
      const isMortgage = d.kind === 'mortgage';
      let renewal = null;
      if (st.termEnd) {
        const days = st.daysToRenewal;
        const pill = days < 0 ? h('span', { class: 'pill bad', text: 'échu' }) : days <= 120 ? h('span', { class: 'pill warn', text: `dans ${days} j` }) : null;
        renewal = fact('Fin du terme', h('span', null, fmtDate(st.termEnd), ' ', pill));
      }
      let payoff;
      if (!st.payment) payoff = '—';
      else if (!st.covers) payoff = h('span', { class: 'pill bad', text: 'le paiement ne couvre pas les intérêts' });
      else payoff = `${fmtDate(st.payoff.toISOString().slice(0, 10), { month: 'short', year: 'numeric' })} (${st.years.toFixed(1).replace('.', ',')} ans)`;
      const paymentText = st.payment
        ? `${native(st.payment * f, 'CAD')} · ${(FREQS[d.freq] || FREQS.monthly).label.toLowerCase()}${st.paymentComputed ? ' (calculé)' : ''}`
        : '—';
      const chartBox = isMortgage && st.schedule.length > 2 ? h('div', { class: 'chart small' }) : null;
      if (chartBox) charts.push([chartBox, st, f]);
      return h('article', { class: 'debt' + (isMortgage ? ' wide' : '') },
        h('div', { class: 'debt-top' },
          h('div', null, h('h3', { text: d.name }), h('div', { class: 'sub', text: [DEBT_KINDS[d.kind], d.lender, ownerNote(d.owner, f)].filter(Boolean).join(' · ') })),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openDebt(d), text: 'Modifier' })),
        h('div', null, h('div', { class: 'big', text: money(num(d.balance) * f) }),
          h('div', { class: 'muted-caption', text: `Solde${d.balance_date ? ' au ' + fmtDate(d.balance_date) : ''}` })),
        st.paidShare !== null ? h('div', null, h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(st.paidShare * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(st.paidShare * 100).toFixed(1)}%` })),
          h('div', { class: 'footnote', style: 'margin-top:4px', text: `${fmtPct.format(st.paidShare)} remboursé sur ${money(num(d.original))}` })) : null,
        h('dl', { class: 'facts' + (isMortgage ? ' four' : '') },
          fact('Taux', `${fmtRate.format(num(d.rate))} %${d.kind === 'mortgage' || d.kind === 'heloc' ? (d.rate_type === 'variable' ? ' variable' : ' fixe') : ''}`),
          fact('Paiement', paymentText),
          fact('Intérêts / mois', '≈ ' + money(st.monthlyInterest * f)),
          fact(isMortgage ? 'Amortissement restant' : 'Fin estimée', payoff),
          isMortgage && num(d.amortization_years) ? fact('Amortissement initial', `${fmtYears.format(num(d.amortization_years))} ans${d.start_date ? ' depuis ' + fmtDate(d.start_date, { month: 'short', year: 'numeric' }) : ''}`) : null,
          isMortgage && (d.term_start || num(d.term_years)) ? fact('Terme', [num(d.term_years) ? `${fmtYears.format(num(d.term_years))} ans` : null, d.term_start ? 'depuis ' + fmtDate(d.term_start, { month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' ')) : null,
          renewal,
          st.termBalance !== null && st.daysToRenewal > 0 ? fact('Solde au renouvellement', '≈ ' + money(st.termBalance * f)) : null,
          st.termInterest !== null && st.daysToRenewal > 0 ? fact('Intérêts d’ici là', '≈ ' + money(st.termInterest * f)) : null,
          st.termPrincipal !== null && st.daysToRenewal > 0 ? fact('Capital remboursé d’ici là', '≈ ' + money(st.termPrincipal * f)) : null,
          st.prepayAllowance !== null ? fact('Remboursement anticipé permis', `${money(st.prepayAllowance * f)} / an (${fmtYears.format(num(d.prepay_pct))} %)`) : null,
          st.totalInterest !== null && st.totalInterest > 0 ? fact('Intérêts restants (total)', '≈ ' + money(st.totalInterest * f)) : null),
        chartBox ? h('div', null, h('div', { class: 'muted-caption', text: 'Solde projeté au même taux' }), chartBox) : null);
    });
    root.append(h('div', { class: 'debts' }, cards));
    requestAnimationFrame(() => {
      for (const [box, st, f] of charts) {
        const pts = st.schedule.map((p) => ({ t: new Date(p.date + 'T12:00:00').getTime(), date: p.date, v: p.balance * f }));
        lineChart(box, pts, [{ name: 'Solde', color: 'var(--accent)', get: (p) => p.v, area: true, width: 2 }]);
      }
    });
    root.append(h('p', { class: 'footnote', text: 'Estimations à taux constant, sans remboursements anticipés. Hypothèques à taux fixe : intérêt composé semestriellement (Loi sur l’intérêt); autres dettes : composé mensuellement. Si le paiement est laissé vide, il est calculé à partir de l’amortissement restant. Le contrat du prêteur fait foi.' }));
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
        h('strong', { text: 'Aucun projet' }),
        h('p', { text: 'Un chalet, une auto, une rénovation, un voyage : inscris l’objectif et l’échéance pour voir où vous en êtes et combien mettre de côté chaque mois.' }),
        addBtn('Ajouter un projet', () => openProject())));
      return root;
    }
    const STATUS = {
      reached: ['ok', 'Objectif atteint'], on_track: ['ok', 'En voie'], behind: ['warn', 'En retard'],
      open: ['info', 'Sans échéance'], stalled: ['bad', 'Aucune épargne prévue'],
    };
    const cards = S.projects.map((p) => {
      const linked = linkedValue('project_id', p.id);
      const current = num(p.saved) + linked.value;
      const st = C.projectStats(p, current);
      const [pc, pl] = STATUS[st.status];
      let line;
      if (st.status === 'reached') line = 'Le montant visé est amassé.';
      else if (st.months !== null && st.months === 0) line = `L’échéance est arrivée : il manque ${money(st.remaining)}.`;
      else if (st.months !== null) {
        line = st.status === 'on_track'
          ? `Au rythme actuel, vous aurez environ ${money(st.projected)} en ${fmtDate(p.target_date, { month: 'long', year: 'numeric' })}.`
          : `Il faut mettre ${money(st.needed)} par mois pour atteindre l’objectif en ${fmtDate(p.target_date, { month: 'long', year: 'numeric' })} (prévu : ${money(num(p.monthly_contribution))}).`;
      } else if (st.monthsToGoal !== null) {
        const d = new Date(); d.setMonth(d.getMonth() + st.monthsToGoal);
        line = `Au rythme actuel, objectif atteint vers ${new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric' }).format(d)}.`;
      } else line = 'Ajoute une épargne mensuelle ou une échéance pour voir la projection.';
      return h('article', { class: 'card project' },
        h('div', { class: 'card-head' },
          h('div', null, h('h2', { text: p.name }), h('p', null, h('span', { class: 'pill ' + pc, text: pl }))),
          h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => openProject(p), text: 'Modifier' }))),
        h('div', { class: 'big', text: `${money(current)} / ${money(st.target)}` }),
        st.share !== null ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(st.share * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${(st.share * 100).toFixed(1)}%` })) : null,
        h('p', { class: 'project-line', text: line }),
        h('dl', { class: 'facts four' },
          fact('Échéance', p.target_date ? fmtDate(p.target_date, { month: 'long', year: 'numeric' }) : '—'),
          fact('Reste à amasser', money(st.remaining)),
          fact('Épargne prévue', `${money(num(p.monthly_contribution))} / mois`),
          fact('Rendement supposé', `${fmtRate.format(num(p.expected_return))} % / an`)),
        linked.count ? h('p', { class: 'footnote', text: `Inclut ${money(linked.value)} de ${linked.count} placement(s) lié(s) à ce projet${num(p.saved) ? ` et ${money(num(p.saved))} mis de côté ailleurs` : ''}.` }) : null,
        p.note ? h('p', { class: 'footnote', text: p.note }) : null);
    });
    const totalTarget = S.projects.reduce((a, p) => a + num(p.target_amount), 0);
    const totalSaved = S.projects.reduce((a, p) => a + num(p.saved) + linkedValue('project_id', p.id).value, 0);
    root.append(card('Projets', null, [addBtn('Ajouter un projet', () => openProject())],
      h('div', { class: 'kpis' }, kpi('Objectifs', money(totalTarget)), kpi('Déjà amassé', money(totalSaved)),
        kpi('Épargne prévue', money(S.projects.reduce((a, p) => a + num(p.monthly_contribution), 0)), 'par mois'))));
    root.append(h('div', { class: 'projects' }, cards));
    root.append(h('p', { class: 'footnote', text: 'Pour qu’un compte compte automatiquement dans un projet, ouvre le placement dans l’onglet Portfolio et choisis le projet dans « Associé à ». Le rendement supposé est une hypothèse, pas une garantie.' }));
    return root;
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------
  const ownerOptions = () => ({ p1: S.settings.p1_name, p2: S.settings.p2_name, joint: 'Commun (50 / 50)' });

  // --- Projections -------------------------------------------------------------
  const PROJ_FIELDS = [
    ['ret', 'Rendement %'], ['sd', 'Écart-type %'], ['infl', 'Inflation %'], ['realEstate', 'Immobilier %'],
    ['raise_p1', (st) => `Hausse de ${st.p1_name} %`], ['raise_p2', (st) => `Hausse de ${st.p2_name} %`], ['kids', 'Coûts des enfants %'], ['endYear', 'Année de fin'],
  ];
  const RETIRE_FIELDS = [
    ['birth_p1', (st) => `Naissance de ${st.p1_name} (année)`], ['birth_p2', (st) => `Naissance de ${st.p2_name} (année)`],
    ['retire_p1', (st) => `Retraite de ${st.p1_name} (âge)`], ['retire_p2', (st) => `Retraite de ${st.p2_name} (âge)`],
    ['rrq_p1', (st) => `RRQ de ${st.p1_name} à 65 ans ($/mois)`], ['rrq_p2', (st) => `RRQ de ${st.p2_name} à 65 ans ($/mois)`],
    ['psv', 'PSV par personne ($/mois)'], ['retireSpend', 'Dépenses à la retraite (% d’avant)'], ['retireTax', 'Impôt moyen à la retraite %'],
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
    for (const b of S.budget) {
      const annual = C.monthly(b.amount, b.freq) * 12;
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
        h('input', { id, inputmode: 'decimal', autocomplete: 'off', value: a[k] === null || a[k] === undefined ? '' : String(a[k]).replace('.', ','),
          onchange: (e) => {
            const v = parseNum(e.target.value);
            const next = { ...(S.settings.projection || {}) };
            if (v === null || Number.isNaN(v)) delete next[k]; else next[k] = v;
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
    root.append(card('Hypothèses', 'Change un chiffre : tout se recalcule. Rendements et hausses en % par année.', [
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Afficher en' },
        [['1', 'Dollars d’aujourd’hui'], ['0', 'Dollars de l’époque']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String((real ? '1' : '0') === k),
          onclick: () => { storeSet('projReal', k); render(); }, text: l })))],
    h('div', { class: 'fields proj' }, PROJ_FIELDS.map(input)),
    h('h3', { class: 'subhead', text: 'Retraite' }),
    h('div', { class: 'fields proj' }, RETIRE_FIELDS.map(input)),
    h('p', { class: 'footnote', text: 'RRQ : ton estimation à 65 ans est dans Mon dossier (Retraite Québec); le maximum en 2026 est 1 507,65 $ par mois. Elle est ajustée selon l’âge de retraite (−0,6 % par mois avant 65 ans, +0,7 % après, de 60 à 72 ans). PSV dès 65 ans (maximum 762,50 $ par mois fin 2026).' })));

    const last = res.central.at(-1);
    const lastBand = res.band.at(-1);
    const retireYear = retirementOn ? Math.max(a.birth_p1 + a.retire_p1, a.birth_p2 + a.retire_p2) : null;
    const atRetire = retireYear ? res.central.find((r) => r.year === retireYear) : null;
    const debtFree = res.central.find((r) => r.debt <= 0);
    const kpis = h('div', { class: 'kpis' },
      kpi(`Avoir net en ${last.year}`, money(defl(last, last.netWorth)), `${money(defl(last, lastBand.nwLow))} à ${money(defl(last, lastBand.nwHigh))} (9 fois sur 10 au-dessus de la borne basse)`),
      atRetire ? kpi(`Placements à la retraite (${retireYear})`, money(defl(atRetire, atRetire.invested)), 'Scénario central') : kpi('Placements', money(defl(last, last.invested)), `en ${last.year}, scénario central`),
      retirementOn ? kpi('L’argent dure jusqu’à la fin', h('span', { class: res.success >= 0.85 ? 'up' : res.success < 0.6 ? 'down' : '' , text: fmtPct.format(res.success) }), `des ${res.runs} simulations`) : null,
      kpi('Dettes payées', debtFree ? String(debtFree.year) : 'après ' + last.year, start.debts.length ? 'selon les paiements actuels' : 'aucune dette'));
    const chartBox = h('div', { class: 'chart' });
    root.append(card('Placements et avoir net', `Scénario central et fourchette pessimiste–optimiste (${res.runs} simulations de marché)`, null, kpis, chartBox,
      h('div', { class: 'legend' },
        h('span', { style: '--c: var(--accent)', text: 'Avoir net (central)' }), h('span', { style: '--c: var(--gain)', text: 'Placements (central)' }),
        h('span', { class: 'band', style: '--c: var(--accent)', text: 'Avoir net : 10 % pessimiste à 90 % optimiste' }))));

    // A row every 5 years, plus retirement and the last year.
    const milestones = res.central.filter((r, i) => i === 0 || r.year % 5 === 0 || r.year === retireYear || i === res.central.length - 1);
    const ages = (r) => [r.age.p1, r.age.p2].filter((x) => x !== null).join(' / ');
    root.append(card('Année par année', real ? 'En dollars d’aujourd’hui' : 'En dollars de l’époque', null,
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Année' }), h('th', { class: 'r hide-sm', text: 'Revenus nets' }), h('th', { class: 'r hide-sm', text: 'Dépenses et dettes' }),
          h('th', { class: 'r', text: 'Épargne' }), h('th', { class: 'r', text: 'Placements' }), h('th', { class: 'r', text: 'Avoir net' }))),
        h('tbody', null, milestones.map((r) => h('tr', null,
          h('td', null, String(r.year), h('span', { class: 'sub', text: (ages(r) ? 'âges ' + ages(r) : '') + (r.retired.p1 || r.retired.p2 ? ' · retraite' : '') })),
          h('td', { class: 'r hide-sm' }, money(defl(r, r.work + r.pensions))),
          h('td', { class: 'r hide-sm' }, money(defl(r, r.spend + r.debtPaid))),
          h('td', { class: 'r ' + cls(r.surplus) }, moneySigned(defl(r, r.surplus))),
          h('td', { class: 'r' }, money(defl(r, r.invested))),
          h('td', { class: 'r' }, money(defl(r, r.netWorth))))))))));

    const notes = ['Revenus du Budget (nets d’impôt) qui augmentent selon la hausse de chacun et s’arrêtent à la retraite; dépenses indexées à l’inflation, celles des enfants à leur taux et jusqu’à 18 ans; lignes « Épargne et placements » comptées comme épargne.',
      'Dettes remboursées selon leurs paiements actuels (le renouvellement au même taux); placements des projets dépensés à leur date; REEE dépensés aux 18 ans de l’enfant.',
      'Rendements de marché aléatoires (loi log-normale) autour du rendement moyen; maison selon le taux immobilier; véhicules −15 % par année.',
      'Non modélisé : impôt sur les placements non enregistrés, retraits obligatoires du FERR, héritages, changements de vie. C’est un ordre de grandeur pour décider, pas une promesse.'];
    if (!retirementOn) root.prepend(h('div', { class: 'banner', text: 'Entre vos deux années de naissance (section Retraite) pour inclure la retraite, la RRQ et la PSV dans la projection.' }));
    if (res.depleted) root.prepend(h('div', { class: 'banner', text: `Dans le scénario central, les placements sont épuisés en ${res.depleted}.` }));
    root.append(h('div', { class: 'footnote' }, notes.map((n) => h('p', { text: n }))));

    requestAnimationFrame(() => {
      const pts = res.central.map((r, i) => ({ t: new Date(r.year, 6, 1).getTime(), year: r.year, nw: defl(r, r.netWorth), inv: defl(r, r.invested),
        lo: defl(r, res.band[i].nwLow), hi: defl(r, res.band[i].nwHigh) }));
      lineChart(chartBox, pts,
        [{ name: 'Avoir net', color: 'var(--accent)', get: (p) => p.nw, width: 2.5 }, { name: 'Placements', color: 'var(--gain)', get: (p) => p.inv, width: 2 }],
        [{ name: 'Fourchette', color: 'var(--accent)', lo: (p) => p.lo, hi: (p) => p.hi }],
        { label: 'Projection de l’avoir net', years: true, dateLabel: (p) => String(p.year) });
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
  const CO_KIND = { inc: 'Société incorporée (inc.)', autonome: 'Travailleur autonome' };
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
      root.append(h('section', { class: 'card empty' }, h('strong', { text: 'Base de données à mettre à jour' }),
        h('p', { text: 'Pour activer les compagnies, relance le fichier supabase/schema.sql dans Supabase (SQL Editor → Run). Vos données restent intactes.' })));
      return root;
    }
    const list = S.companies.filter((c) => sh(c.owner));
    if (!list.length) {
      root.append(h('section', { class: 'card empty' },
        h('strong', { text: 'Aucune compagnie' }),
        h('p', { text: 'Ajoute ta compagnie (incorporée ou travailleur autonome), ses revenus et ses dépenses : l’app estime l’impôt de la compagnie, l’impôt personnel sur ce que vous vous versez, et ce qui reste vraiment dans vos poches.' }),
        h('div', { class: 'card-actions' }, addBtn('Ajouter une compagnie', () => openCompany()),
          h('button', { class: 'btn', type: 'button', onclick: openTaxSettings, text: 'Vos autres revenus' }))));
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
    root.append(card('Vue d’ensemble', 'Par année, selon les montants entrés', [
      h('button', { class: 'btn', type: 'button', onclick: openTaxSettings, text: 'Vos autres revenus' }),
      addBtn('Ajouter une compagnie', () => openCompany())],
    h('div', { class: 'kpis' },
      kpi('Revenus', money(tot.rev), `${money(tot.rev / 12)} / mois`),
      kpi('Dépenses', money(tot.exp), `${money(tot.exp / 12)} / mois`),
      kpi('Impôts et charges', money(tot.tax), tot.rev - tot.exp > 0 ? `${fmtPct.format(tot.tax / (tot.rev - tot.exp))} du profit` : null),
      kpi('Dans vos poches', h('span', { class: cls(tot.pocket), text: money(tot.pocket) }), `${money(tot.pocket / 12)} / mois, après impôts`))));

    for (const v of views) root.append(companyCard(v));
    root.append(h('p', { class: 'footnote', text: `Estimations ${T().PARAMS.year} pour le Québec, à titre indicatif : impôt fédéral et québécois, RRQ, RQAP, Fonds des services de santé et CNESST. Non pris en compte : crédits remboursables et familiaux, amortissement fiscal (DPA), impôt minimum, revenus de placement de la compagnie, acomptes. Valide les chiffres avec ton comptable avant de décider.` }));
    return root;
  }

  function companyCard(v) {
    const { c, y, lines, personal, pocket, scenarios } = v;
    const inc = c.kind === 'inc';
    const pct = (a, b) => (b > 0 ? ` (${fmtPct.format(a / b)})` : '');
    const flow = inc ? [
      fact('Revenus', money(y.revenue)),
      fact('Dépenses', '− ' + money(y.expenses)),
      fact('Salaire versé', '− ' + money(y.salary)),
      fact('Charges sur le salaire', '− ' + money(y.employer.total)),
      fact('Profit imposable', money(y.taxable)),
      fact('Impôt de la compagnie', '− ' + money(y.corpTax.total) + (y.taxable > 0 ? pct(y.corpTax.total, y.taxable) : '')),
      fact('Dividendes versés', '− ' + money(y.dividends)),
      fact('Reste dans la compagnie', h('span', { class: cls(y.retained), text: money(y.retained) })),
    ] : [
      fact('Revenus', money(y.revenue)),
      fact('Dépenses', '− ' + money(y.expenses)),
      fact('Profit d’entreprise', money(y.profit)),
      fact('Impôt et cotisations', '− ' + money(personal) + pct(personal, y.profit)),
    ];
    const personalFacts = inc ? [
      fact('Versé à vous', money(y.salary + y.dividends)),
      fact('Impôt personnel et RRQ/RQAP', '− ' + money(personal)),
      fact('Dans vos poches', h('strong', { class: cls(pocket), text: `${money(pocket)} (${money(pocket / 12)} / mois)` })),
    ] : [fact('Dans vos poches', h('strong', { class: cls(pocket), text: `${money(pocket)} (${money(pocket / 12)} / mois)` }))];

    const rows = [...lines].sort((a, b) => (a.kind === b.kind ? b.annual - a.annual : a.kind === 'income' ? -1 : 1)).map((l) => clickRow(() => openCompanyItem(c, l),
      h('td', null, l.name, h('span', { class: 'sub', text: l.grp + (l.kind === 'expense' && l.deductiblePct < 100 ? ` · déductible à ${fmtYears.format(l.deductiblePct)} %` : '') })),
      h('td', { class: 'r ' + (l.kind === 'income' ? 'up' : '') }, (l.kind === 'income' ? '' : '− ') + money(l.annual / 12), h('span', { class: 'sub', text: '/ mois' })),
      h('td', { class: 'r hide-sm' }, money(l.annual), h('span', { class: 'sub', text: '/ an' }))));

    let compare = null;
    if (scenarios) {
      // Only the two ways that empty the company are comparable; what stays inside is still taxed when it comes out.
      const best = Math.max(scenarios[0].pocket, scenarios[1].pocket);
      compare = h('div', null, h('h3', { class: 'subhead', text: 'Salaire ou dividendes?' }),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: 'Façon de se payer' }), h('th', { class: 'r', text: 'Dans vos poches' }), h('th', { class: 'r hide-sm', text: 'Impôts et charges' }), h('th', { class: 'r', text: 'Reste dans la cie' }))),
          h('tbody', null, scenarios.map((s2) => h('tr', null,
            h('td', null, s2.label, h('span', { class: 'sub', text: `salaire ${money(s2.salary)} · dividendes ${money(s2.dividends)}` })),
            h('td', { class: 'r' }, money(s2.pocket), s2 !== scenarios[2] && Math.abs(s2.pocket - best) < 1 ? h('span', { class: 'sub' }, h('span', { class: 'pill ok', text: 'le plus payant' })) : null),
            h('td', { class: 'r hide-sm' }, money(s2.totalTax)),
            h('td', { class: 'r' }, money(s2.retained))))))),
        h('p', { class: 'footnote', text: 'Même argent disponible, versé de trois façons. Le salaire donne aussi droit au RRQ et crée des droits REER; les dividendes n’en donnent pas. L’argent laissé dans la compagnie sera imposé quand il sortira.' }));
    }

    const budgetName = `Revenu net – ${c.name}`;
    const inBudget = S.budget.find((b) => b.name === budgetName);
    const monthlyPocket = Math.round(Math.max(0, pocket) / 12);
    const syncBtn = h('button', { class: 'btn', type: 'button', text: inBudget ? `Mettre à jour le Budget (${money(monthlyPocket)} / mois)` : `Ajouter au Budget (${money(monthlyPocket)} / mois)`,
      onclick: async () => {
        try {
          await saveRow('budget_items', { id: inBudget && inBudget.id, name: budgetName, grp: 'Travail autonome', kind: 'income', nature: 'fixed', amount: monthlyPocket, freq: 'monthly', owner: c.owner, child_id: null });
          toast('Budget mis à jour'); refresh();
        } catch (e) { toast(errText(e), true); }
      } });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', null, h('h2', { text: c.name }), h('p', { text: [CO_KIND[c.kind], ownerName(c.owner), inc ? (c.sbd_hours ? 'taux réduit au Québec (5 500 h)' : 'taux du Québec sans les 5 500 h') : null].filter(Boolean).join(' · ') })),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openCompany(c), text: 'Modifier' }),
          h('button', { class: 'btn', type: 'button', onclick: () => openCompanyItem(c, { kind: 'expense' }), text: 'Dépense' }),
          addBtn('Revenu', () => openCompanyItem(c, { kind: 'income' })))),
      h('div', { class: 'grid tight' },
        h('div', null, h('h3', { class: 'subhead', text: inc ? 'Dans la compagnie (par année)' : 'Par année' }), h('dl', { class: 'facts' }, flow)),
        h('div', null, h('h3', { class: 'subhead', text: 'Pour vous' }), h('dl', { class: 'facts' }, personalFacts),
          h('div', { class: 'card-actions' }, syncBtn),
          h('p', { class: 'footnote', text: 'Le Budget et les Projections utilisent ce montant net. Mets-le à jour quand les chiffres changent.' }))),
      lines.length ? h('div', null, h('h3', { class: 'subhead', text: 'Revenus et dépenses' }), h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: 'Ligne' }), h('th', { class: 'r', text: 'Par mois' }), h('th', { class: 'r hide-sm', text: 'Par année' }))),
        h('tbody', null, rows))))
        : h('p', { class: 'footnote', text: 'Ajoute les revenus (ventes, honoraires) et les dépenses (loyer, matériel, logiciels…) de la compagnie.' }),
      compare);
  }

  function openCompany(c) {
    const v = c ? { ...c, sbd_hours: c.sbd_hours ? 'oui' : 'non' } : { kind: 'inc', owner: S.who === 'all' ? 'p1' : S.who, sbd_hours: 'non', salary: '', dividends: '' };
    openForm({
      title: c ? 'Modifier la compagnie' : 'Ajouter une compagnie',
      values: v,
      fields: [
        { k: 'name', label: 'Nom', type: 'text', req: true, wide: true, placeholder: 'Studio Photo inc.' },
        { k: 'kind', label: 'Forme', type: 'select', options: CO_KIND },
        { k: 'owner', label: 'Propriétaire', type: 'owner' },
        { k: 'salary', label: 'Salaire versé (brut, par année)', type: 'num', show: (s) => s.kind === 'inc', clearWhenHidden: true, hint: 'Ce que la compagnie vous verse en salaire' },
        { k: 'dividends', label: 'Dividendes versés (par année)', type: 'num', show: (s) => s.kind === 'inc', clearWhenHidden: true, hint: 'Dividendes ordinaires (non déterminés)' },
        { k: 'sbd_hours', label: 'Heures rémunérées dans l’année', type: 'select', show: (s) => s.kind === 'inc', wide: true,
          options: { non: 'Moins de 5 500 h (une ou deux personnes) : taux du Québec 11,5 %', oui: '5 500 h ou plus : taux réduit du Québec 3,2 %' },
          hint: 'Heures payées aux employés (40 h/semaine max par personne). Le taux réduit du Québec baisse à 2,2 % pour les années qui commencent après le 29 avril 2026.' },
        { k: 'note', label: 'Note (facultatif)', type: 'text', wide: true },
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
      title: existing ? 'Modifier la ligne' : kind === 'income' ? `Revenu de ${c.name}` : `Dépense de ${c.name}`,
      values: v,
      fields: [
        { k: 'grp', label: 'Catégorie', type: 'select', options: groups, onChange: (s) => { if (kind === 'expense') s.deductible_pct = CO_EXPENSE[s.grp]; } },
        { k: 'name', label: 'Description', type: 'text', req: true, wide: true, placeholder: kind === 'income' ? 'Contrats de photo' : 'Adobe Creative Cloud' },
        { k: 'amount', label: 'Montant', type: 'num', req: true },
        { k: 'freq', label: 'Fréquence', type: 'select', options: ALL_FREQS },
        { k: 'deductible_pct', label: 'Partie déductible (%)', type: 'num', show: () => kind === 'expense', hint: 'Repas et représentation : 50 %. Usage personnel d’un bien : seulement la partie d’affaires.' },
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
      title: 'Vos revenus hors compagnie',
      values: { ...t, cnesst: t.cnesst ?? T().PARAMS.cnesstDefault * 100 },
      fields: [
        { k: 'p1_job', label: `${S.settings.p1_name} : salaire d’un emploi (brut / an)`, type: 'num', hint: 'Un emploi ailleurs que dans vos compagnies' },
        { k: 'p2_job', label: `${S.settings.p2_name} : salaire d’un emploi (brut / an)`, type: 'num' },
        { k: 'p1_other', label: `${S.settings.p1_name} : autres revenus imposables (/ an)`, type: 'num', hint: 'Loyers, intérêts, pension…' },
        { k: 'p2_other', label: `${S.settings.p2_name} : autres revenus imposables (/ an)`, type: 'num' },
        { k: 'cnesst', label: 'Taux CNESST de la compagnie (%)', type: 'num', hint: 'Sur ton avis de cotisation CNESST; dépend du secteur' },
      ],
      onSave: async (out) => {
        const res = await sb.from('settings').update({ tax: { ...t, ...out } }).eq('id', 1);
        if (res.error) throw res.error;
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
          const entries = Array.isArray(opts) ? opts.map((o) => [o, o]) : Object.entries(opts);
          input = h('select', { id, onchange: () => { readInputs(); if (f.onChange) f.onChange(state); drawFields(); } },
            entries.map(([v, l]) => h('option', { value: v, selected: v === val ? true : null, text: l })));
          if (!entries.some(([v]) => v === val) && entries.length) state[f.k] = entries[0][0];
        } else {
          input = h('input', {
            id, value: val, placeholder: f.placeholder || null, autocomplete: 'off',
            type: f.type === 'date' ? 'date' : 'text',
            inputmode: f.type === 'num' ? 'decimal' : null,
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

    const saveBtn = h('button', { class: 'btn primary', type: 'submit', text: 'Enregistrer' });
    let delBtn = null;
    if (onDelete) {
      let armed = false;
      delBtn = h('button', {
        class: 'btn danger', type: 'button', text: 'Supprimer',
        onclick: async () => {
          if (!armed) { armed = true; delBtn.classList.add('armed'); delBtn.textContent = 'Confirmer la suppression'; return; }
          delBtn.disabled = true;
          try { await onDelete(); close(); toast('Supprimé'); refresh(); } catch (e) { errorBox.textContent = errText(e); delBtn.disabled = false; }
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
          if (Number.isNaN(v) || (v !== null && v < 0)) { return invalid(f, `« ${typeof f.label === 'function' ? f.label(state) : f.label} » doit être un nombre positif.`); }
        } else if (typeof v === 'string') {
          v = v.trim();
          if (f.upper) v = v.toUpperCase();
          if (v === '') v = null;
        }
        if (f.req && (v === null || v === undefined)) return invalid(f, `« ${typeof f.label === 'function' ? f.label(state) : f.label} » est requis.`);
        out[f.k] = v;
      }
      for (const f of fields) if (!visible(f) && f.clearWhenHidden) out[f.k] = null;
      saveBtn.disabled = true;
      try {
        await onSave(out);
        close();
        toast('Enregistré');
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
        h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Annuler' }), saveBtn)));
    sheet.replaceChildren(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    document.addEventListener('keydown', onKey);
    const first = panel.querySelector('input, select');
    if (first) first.focus();
  }

  function linkOptions() {
    const o = { '': 'Aucun' };
    for (const c of S.children) o['child:' + c.id] = `REEE de ${c.name}`;
    for (const p of S.projects) o['project:' + p.id] = `Projet : ${p.name}`;
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
      title: isNew ? (v.market === 'MANUAL' ? 'Ajouter un placement privé' : 'Ajouter un placement') : 'Modifier le placement',
      values: v,
      fields: [
        { k: 'market', label: 'Marché', type: 'select', options: marketOpts, wide: true, req: true },
        { k: 'symbol', label: 'Symbole', type: 'text', placeholder: 'XEQT', upper: true, req: true, show: (s) => s.market !== 'CASH',
          hint: (s) => (MARKETS[s.market]?.auto ? 'Sans suffixe : XEQT, VFV, AAPL. Actions de catégorie : BAM.A' : 'Un nom court pour t’y retrouver') },
        { k: 'currency', label: 'Devise', type: 'select', options: { CAD: 'CAD', USD: 'USD' }, show: (s) => !MARKETS[s.market]?.cur },
        { k: 'name', label: 'Nom (facultatif)', type: 'text', placeholder: 'iShares Core Equity ETF', wide: true },
        { k: 'qty', label: (s) => (s.market === 'CASH' ? 'Montant' : 'Nombre de parts'), type: 'num', req: true,
          hint: (s) => (s.market === 'MANUAL' ? 'Sans parts (compagnie, prêt, immeuble) : 1, puis la valeur totale comme valeur par part' : '') },
        { k: 'avg_cost', label: (s) => (s.market === 'MANUAL' ? 'Montant investi par part' : 'Coût moyen par part'), type: 'num', show: (s) => s.market !== 'CASH', hint: 'Dans la devise du titre', clearWhenHidden: true },
        { k: 'manual_price', label: (s) => (s.market === 'MANUAL' ? 'Valeur actuelle par part' : 'Cours actuel'), type: 'num', show: (s) => s.market === 'MANUAL', req: true, clearWhenHidden: true },
        { k: 'manual_price_date', label: 'Valeur en date du', type: 'date', show: (s) => s.market === 'MANUAL', clearWhenHidden: true },
        { k: 'update_freq', label: 'Mise à jour prévue', type: 'select', options: { '': 'Aucun rappel', monthly: 'Chaque mois', quarterly: 'Chaque trimestre' },
          show: (s) => s.market === 'MANUAL', clearWhenHidden: true, hint: 'Un rappel s’affiche quand la valeur date de plus d’un mois ou d’un trimestre.' },
        { k: 'account', label: 'Compte', type: 'select', options: ACCOUNTS },
        { k: 'owner', label: 'Propriétaire', type: 'owner' },
        { k: 'link', label: 'Associé à', type: 'select', options: linkOptions, show: () => hasLinks, wide: true,
          hint: 'Un placement du REEE compte dans la valeur du REEE de l’enfant; un placement associé à un projet compte dans ce projet.' },
        { k: 'institution', label: 'Institution (facultatif)', type: 'text', placeholder: 'Desjardins, Wealthsimple, Disnat…', wide: true },
        { k: 'asset_class', label: 'Catégorie d’actif', type: 'select', options: { '': 'Automatique (selon le titre)', ...CLASSES }, show: (s) => s.market !== 'CASH', clearWhenHidden: true,
          hint: 'Pour la répartition des actifs. Les FNB tout-en-un (XEQT, VBAL…) sont reconnus.' },
      ],
      onSave: async (out) => {
        const m = MARKETS[out.market];
        const { link, ...rest } = out;
        const row = { ...rest, id: hd && hd.id, child_id: null, project_id: null };
        if (link && link.startsWith('child:')) row.child_id = link.slice(6);
        if (link && link.startsWith('project:')) row.project_id = link.slice(8);
        if (m.cur) row.currency = m.cur;
        if (out.market === 'CASH') { row.symbol = row.currency; row.name = row.name || 'Encaisse'; row.avg_cost = null; }
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
      title: a ? 'Modifier l’actif' : 'Ajouter un actif',
      values: a ? { ...a } : { kind: 'Résidence principale', owner: 'joint', as_of: todayISO() },
      fields: [
        { k: 'name', label: 'Nom', type: 'text', placeholder: 'Maison', req: true, wide: true },
        { k: 'kind', label: 'Type', type: 'select', options: ASSET_KINDS },
        { k: 'owner', label: 'Propriétaire', type: 'owner' },
        { k: 'value', label: 'Valeur estimée', type: 'num', req: true },
        { k: 'as_of', label: 'En date du', type: 'date' },
      ],
      onSave: (out) => saveRow('assets', { ...out, id: a && a.id }),
      onDelete: a ? () => deleteRow('assets', a.id) : null,
    });
  }

  function openDebt(d) {
    const mortgage = (s) => s.kind === 'mortgage';
    openForm({
      title: d ? 'Modifier la dette' : 'Ajouter une dette',
      values: d ? { ...d } : { kind: 'mortgage', rate_type: 'fixed', freq: 'monthly', owner: 'joint', balance_date: todayISO() },
      fields: [
        { k: 'name', label: 'Nom', type: 'text', placeholder: 'Hypothèque maison', req: true, wide: true },
        { k: 'kind', label: 'Type', type: 'select', options: DEBT_KINDS },
        { k: 'lender', label: 'Prêteur', type: 'text', placeholder: 'RBC' },
        { k: 'balance', label: 'Solde actuel', type: 'num', req: true },
        { k: 'balance_date', label: 'Solde en date du', type: 'date' },
        { k: 'rate', label: 'Taux annuel (%)', type: 'num', req: true, placeholder: '4,59' },
        { k: 'rate_type', label: 'Type de taux', type: 'select', options: { fixed: 'Fixe', variable: 'Variable' }, show: (s) => s.kind === 'mortgage' || s.kind === 'heloc' },
        { k: 'payment', label: 'Paiement', type: 'num', hint: (s) => (mortgage(s) ? 'Capital + intérêts, sans les taxes. Laisse vide pour le calculer avec l’amortissement.' : 'Capital + intérêts') },
        { k: 'freq', label: 'Fréquence', type: 'select', options: DEBT_FREQS },
        { k: 'original', label: (s) => (mortgage(s) ? 'Montant initial du prêt' : 'Montant initial (facultatif)'), type: 'num' },
        { k: 'start_date', label: 'Date de début du prêt', type: 'date', show: mortgage, clearWhenHidden: true },
        { k: 'amortization_years', label: 'Amortissement initial (années)', type: 'num', placeholder: '25', show: mortgage, clearWhenHidden: true },
        { k: 'term_start', label: 'Début du terme actuel', type: 'date', show: mortgage, clearWhenHidden: true },
        { k: 'term_years', label: 'Durée du terme (années)', type: 'num', placeholder: '5', show: mortgage, clearWhenHidden: true },
        { k: 'term_end', label: 'Fin du terme', type: 'date', show: mortgage, clearWhenHidden: true, hint: 'Laisse vide pour la calculer (début + durée)' },
        { k: 'prepay_pct', label: 'Remboursement anticipé permis (% / an)', type: 'num', placeholder: '15', show: mortgage, clearWhenHidden: true, hint: 'Selon le contrat, en % du montant initial' },
        { k: 'owner', label: 'Propriétaire', type: 'owner' },
      ],
      onSave: async (out) => {
        if (out.rate !== null && out.rate >= 100) throw new Error('Le taux doit être en pourcentage, par exemple 4,59.');
        if (out.amortization_years !== undefined && out.amortization_years !== null && out.amortization_years > 40) throw new Error('L’amortissement doit être en années, par exemple 25.');
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
    const v = existing ? { ...base } : {
      kind, nature: base.nature || 'fixed', child_id: base.child_id || (forChild && S.children[0] ? S.children[0].id : null),
      grp: base.grp || (kind === 'income' ? INC_GROUPS[0] : forChild ? CHILD_GROUPS[0] : base.nature === 'variable' ? VAR_GROUPS[0] : FIXED_GROUPS[0]),
      freq: 'monthly', owner: 'joint',
    };
    const groupsFor = (s) => (s.kind === 'income' ? INC_GROUPS : forChild ? CHILD_GROUPS : s.nature === 'variable' ? VAR_GROUPS : FIXED_GROUPS);
    const title = existing ? 'Modifier la ligne'
      : kind === 'income' ? 'Ajouter un revenu'
        : forChild ? 'Dépense récurrente d’un enfant'
          : v.nature === 'variable' ? 'Ajouter une enveloppe' : 'Ajouter une dépense fixe';
    openForm({
      title,
      values: v,
      fields: [
        { k: 'kind', label: 'Type', type: 'select', options: { income: 'Revenu', expense: 'Dépense' }, show: () => !forChild,
          onChange: (s) => { s.grp = groupsFor(s)[0]; } },
        { k: 'nature', label: 'Sorte de dépense', type: 'select', options: { fixed: 'Fixe (revient chaque mois)', variable: 'Variable (enveloppe)' },
          show: (s) => s.kind === 'expense' && !forChild, onChange: (s) => { s.grp = groupsFor(s)[0]; } },
        { k: 'child_id', label: 'Enfant', type: 'select', options: childOptions, show: () => forChild && S.children.length > 0 },
        { k: 'grp', label: 'Catégorie', type: 'select', options: groupsFor },
        { k: 'name', label: 'Description', type: 'text', req: true, wide: true,
          placeholder: kind === 'income' ? 'Salaire net' : forChild ? 'CPE / garderie' : v.nature === 'variable' ? 'Voyages' : 'Loyer' },
        { k: 'amount', label: (s) => (s.nature === 'variable' && s.kind === 'expense' ? 'Montant prévu' : 'Montant'), type: 'num', req: true },
        { k: 'freq', label: 'Fréquence', type: 'select', options: ALL_FREQS },
        { k: 'owner', label: 'Pour', type: 'owner' },
      ],
      onSave: (out) => {
        const row = { ...out, id: existing ? base.id : undefined };
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
      title: e ? 'Modifier la dépense' : forChild ? 'Dépense ponctuelle d’un enfant' : 'Noter une dépense',
      values: v,
      fields: [
        { k: 'label', label: 'Description', type: 'text', req: true, wide: true, placeholder: forChild ? 'Bottes d’hiver' : 'Billets d’avion' },
        { k: 'amount', label: 'Montant', type: 'num', req: true },
        { k: 'spend_date', label: 'Date', type: 'date', req: true },
        { k: 'grp', label: 'Catégorie', type: 'select', options: forChild ? CHILD_GROUPS : [...VAR_GROUPS, ...FIXED_GROUPS] },
        { k: 'child_id', label: 'Enfant', type: 'select', options: childOptions, show: () => forChild && S.children.length > 0 },
        { k: 'owner', label: 'Payé par', type: 'owner' },
      ],
      onSave: (out) => saveRow('expense_log', { ...out, child_id: forChild ? out.child_id || null : null, id: e && e.id }),
      onDelete: e ? () => deleteRow('expense_log', e.id) : null,
    });
  }

  function openChild(c) {
    openForm({
      title: c ? `Modifier ${c.name}` : 'Ajouter un enfant',
      values: c ? { ...c } : {},
      fields: [
        { k: 'name', label: 'Prénom', type: 'text', req: true },
        { k: 'birth_date', label: 'Date de naissance', type: 'date', hint: 'Sert à calculer les droits aux subventions du REEE' },
        { k: 'resp_value', label: 'Valeur actuelle du REEE', type: 'num', hint: 'Selon le dernier relevé. Inutile si les placements du REEE sont associés à l’enfant dans Portfolio.' },
        { k: 'resp_value_date', label: 'En date du', type: 'date' },
      ],
      onSave: (out) => saveRow('children', { ...out, id: c && c.id }),
      onDelete: c ? () => deleteRow('children', c.id) : null,
    });
  }

  function openResp(child, e) {
    const hasOpening = S.resp.some((x) => x.child_id === child.id && x.kind === 'opening' && (!e || x.id !== e.id));
    openForm({
      title: e ? 'Modifier l’entrée REEE' : `REEE de ${child.name}`,
      values: e ? { ...e } : { kind: hasOpening || S.resp.some((x) => x.child_id === child.id) ? 'contribution' : 'opening', entry_date: todayISO() },
      fields: [
        { k: 'kind', label: 'Type', type: 'select', options: { contribution: 'Cotisation', opening: 'Solde de départ (totaux à ce jour)' }, wide: true },
        { k: 'entry_date', label: 'Date', type: 'date', req: true },
        { k: 'amount', label: (s) => (s.kind === 'opening' ? 'Cotisations totales à ce jour' : 'Montant cotisé'), type: 'num', req: true },
        { k: 'cesg', label: (s) => (s.kind === 'opening' ? 'SCEE reçue à ce jour' : 'SCEE reçue (si connue)'), type: 'num',
          hint: (s) => (s.kind === 'opening' ? 'Voir le relevé du REEE' : 'Souvent versée quelques semaines plus tard; laisse vide au besoin') },
        { k: 'iqee', label: (s) => (s.kind === 'opening' ? 'IQEE reçu à ce jour' : 'IQEE reçu (si connu)'), type: 'num',
          hint: (s) => (s.kind === 'opening' ? '' : 'Versé une fois par année, au printemps suivant') },
        { k: 'note', label: 'Note (facultatif)', type: 'text', wide: true },
      ],
      onSave: (out) => saveRow('resp_entries', { ...out, cesg: out.cesg || 0, iqee: out.iqee || 0, child_id: child.id, id: e && e.id }),
      onDelete: e ? () => deleteRow('resp_entries', e.id) : null,
    });
  }

  function openProject(p) {
    openForm({
      title: p ? 'Modifier le projet' : 'Ajouter un projet',
      values: p ? { ...p } : { expected_return: 0 },
      fields: [
        { k: 'name', label: 'Nom du projet', type: 'text', req: true, wide: true, placeholder: 'Chalet' },
        { k: 'target_amount', label: 'Montant visé', type: 'num', req: true, hint: 'Ex. la mise de fonds et les frais' },
        { k: 'target_date', label: 'Échéance', type: 'date' },
        { k: 'saved', label: 'Déjà mis de côté', type: 'num', hint: 'Hors placements associés au projet dans Portfolio' },
        { k: 'monthly_contribution', label: 'Épargne prévue par mois', type: 'num' },
        { k: 'expected_return', label: 'Rendement supposé (% / an)', type: 'num', hint: '0 pour un compte d’épargne prudent' },
        { k: 'note', label: 'Note (facultatif)', type: 'text', wide: true },
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
    const panel = h('div', { class: 'sheet-panel wide', role: 'dialog', 'aria-label': 'Importer des relevés' });
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
      const opts = (sel) => [h('option', { value: '-1', text: '—' }), ...f.rows[0].map((c, i) => h('option', { value: String(i), selected: sel === i ? true : null, text: c || `Colonne ${i + 1}` }))];
      const pick = (label, key) => h('div', { class: 'field' }, h('label', { text: label }),
        h('select', { onchange: (e) => { const v = Number(e.target.value); if (key === 'desc') f.cols.desc = v >= 0 ? [v] : []; else f.cols[key] = v; analyzeAll(); draw(); } },
          opts(key === 'desc' ? f.cols.desc[0] : f.cols[key])));
      return h('div', { class: 'banner col' },
        h('div', { text: `« ${f.name} » : je ne reconnais pas toutes les colonnes. Indique lesquelles utiliser.` }),
        h('div', { class: 'fields' }, pick('Date', 'date'), pick('Description', 'desc'), pick('Montant', 'amount'), pick('Ou : retraits', 'debit'), pick('Ou : dépôts', 'credit')));
    }

    function draw() {
      const fileInput = h('input', { type: 'file', id: 'import-files', accept: '.csv,text/csv', multiple: true,
        onchange: (e) => readFiles(e.target.files) });
      const top = [
        h('h2', { text: 'Importer des relevés' }),
        h('p', { class: 'footnote', text: 'Dans RBC Banque en direct : ouvre le compte (ou la carte), choisis la période, puis Télécharger / Exporter au format CSV. Importe 2 à 3 mois, un fichier par compte. Le fichier est lu dans ton navigateur : il n’est pas envoyé ni conservé, seules les lignes que tu ajoutes au budget sont enregistrées.' }),
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('label', { for: 'import-files', text: 'Fichiers CSV' }), fileInput),
          h('div', { class: 'field' }, h('label', { for: 'import-owner', text: 'À qui sont ces comptes?' }),
            h('select', { id: 'import-owner', onchange: (e) => { st.owner = e.target.value; } },
              Object.entries(ownerOptions()).map(([k, l]) => h('option', { value: k, selected: k === st.owner ? true : null, text: l }))))),
      ];
      const body = [];
      if (st.files.length) {
        body.push(h('p', { class: 'footnote', text: 'Fichiers : ' + st.files.map((f) => f.name).join(', ') }));
        for (const f of st.problems || []) body.push(f.rows.length > 1 ? columnPicker(f) : h('div', { class: 'banner', text: `« ${f.name} » est vide ou n’est pas un CSV lisible.` }));
        for (const f of st.files) {
          if (f.cols.amount < 0) continue;
          body.push(h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.flip[f.name] ? true : null,
            onchange: (e) => { st.flip[f.name] = e.target.checked; analyzeAll(); draw(); } }),
          `Dans « ${f.name} », les achats sont des montants positifs (cartes de crédit)`));
        }
      }
      const r = st.result;
      if (r && r.count) {
        body.push(h('p', null, h('strong', { text: `${r.count} transactions` }), ` du ${fmtDate(r.from)} au ${fmtDate(r.to)} (≈ ${r.months.toFixed(1).replace('.', ',')} mois).`));
        if (!r.canDetect) body.push(h('div', { class: 'banner', text: 'Moins de 45 jours de transactions : impossible de savoir ce qui revient chaque mois. Ajoute un 2e ou 3e mois pour une détection fiable. En attendant, voici les principaux marchands.' }));
        const oneoffCount = r.groups.filter((g) => g.kind === 'oneoff').length;
        const visible = r.groups.filter((g) => !r.canDetect || g.kind !== 'oneoff' || st.showOneoff).slice(0, r.canDetect ? 400 : 40);
        const allGroups = { Revenus: INC_GROUPS, 'Dépenses fixes': FIXED_GROUPS, 'Enveloppes variables': VAR_GROUPS, Enfants: CHILD_GROUPS };
        const rows = visible.map((g) => {
          const p = st.picks.get(g.id);
          const cat = h('select', { 'aria-label': 'Catégorie', onchange: (e) => { p.grp = e.target.value; } },
            Object.entries(allGroups).map(([label, list]) => h('optgroup', { label }, list.map((x) => h('option', { value: x, selected: x === p.grp ? true : null, text: x })))));
          const kindPill = g.kind === 'fixed' ? h('span', { class: 'pill ok', text: g.dir === 'in' ? 'revenu régulier' : 'fixe' })
            : g.kind === 'recurring' ? h('span', { class: 'pill info', text: 'récurrent, montant variable' }) : h('span', { class: 'pill', text: 'ponctuel' });
          return h('tr', null,
            h('td', null, h('input', { type: 'checkbox', 'aria-label': 'Ajouter', checked: p.on ? true : null, onchange: (e) => { p.on = e.target.checked; updateCount(); } })),
            h('td', null,
              h('input', { class: 'inline', value: p.name, 'aria-label': 'Description', oninput: (e) => { p.name = e.target.value; } }),
              h('span', { class: 'sub' }, kindPill, ' ', g.isTransfer ? h('span', { class: 'pill warn', text: 'virement?' }) : null, p.dup ? h('span', { class: 'pill warn', text: 'déjà au budget' }) : null,
                ` ${g.count} fois · ${native(g.average, 'CAD')} en moyenne`),
              h('span', { class: 'sub', title: g.description, text: g.description })),
            h('td', null, cat),
            h('td', { class: 'r' }, h('input', { class: 'inline num r', value: String(p.monthly).replace('.', ','), inputmode: 'decimal', 'aria-label': 'Montant par mois',
              oninput: (e) => { const n = parseNum(e.target.value); if (Number.isFinite(n)) p.monthly = n; } }), h('span', { class: 'sub', text: '/ mois' })));
        });
        body.push(h('div', { class: 'table-wrap import-table' }, h('table', null,
          h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { text: 'Marchand' }), h('th', { text: 'Catégorie' }), h('th', { class: 'r', text: 'Par mois' }))),
          h('tbody', null, rows))));
        if (r.canDetect && oneoffCount) {
          body.push(h('button', { class: 'btn ghost', type: 'button', onclick: () => { st.showOneoff = !st.showOneoff; draw(); },
            text: st.showOneoff ? 'Masquer les achats ponctuels' : `Afficher les achats ponctuels (${oneoffCount})` }));
        }
        body.push(h('p', { class: 'footnote', text: 'Les virements (Interac, paiements de carte de crédit) sont décochés : un loyer payé par Interac est à cocher, un paiement de carte non (ses achats sont déjà dans le relevé de la carte). Les lignes cochées en « Enveloppes variables » deviennent des enveloppes; celles en « Enfants » s’ajoutent à « Pour tous les enfants ».' }));
      } else if (st.files.length && !(st.problems || []).length) {
        body.push(h('div', { class: 'banner', text: 'Aucune transaction trouvée dans ces fichiers.' }));
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
        if (!list.length) { err.textContent = 'Coche au moins une ligne.'; return; }
        addBtnEl.disabled = true;
        const res = await sb.from('budget_items').insert(list);
        if (res.error) { err.textContent = errText(res.error); addBtnEl.disabled = false; return; }
        close();
        toast(`${list.length} ligne(s) ajoutée(s) au budget`);
        refresh();
      } });
      function updateCount() {
        const n = st.result ? [...st.picks.values()].filter((p) => p.on).length : 0;
        addBtnEl.textContent = n ? `Ajouter ${n} ligne${n > 1 ? 's' : ''} au budget` : 'Ajouter au budget';
        addBtnEl.disabled = !n;
      }
      updateCount();
      panel.replaceChildren(...top, ...body, err,
        h('div', { class: 'sheet-actions' }, h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Fermer' }), addBtnEl)));
    }

    draw();
    sheet.replaceChildren(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    document.addEventListener('keydown', onKey);
  }

  // --- Portfolio import: Excel, CSV or a Google Sheets link -------------------
  const HOLDING_COLS = [
    ['symbol', 'Symbole'], ['name', 'Nom'], ['qty', 'Quantité'], ['avg_cost', 'Coût moyen par part'], ['book_value', 'Coût total'],
    ['price', 'Cours ou valeur par part'], ['value', 'Valeur totale'], ['account', 'Compte'], ['owner', 'Propriétaire'],
    ['currency', 'Devise'], ['market', 'Marché'], ['date', 'Date de la valeur'], ['institution', 'Institution'],
  ];
  const TEMPLATES = {
    public: 'Compte;Symbole;Nom;Quantité;Coût moyen;Devise;Propriétaire\nCELI;XEQT;iShares Core Equity;100;28,50;CAD;\nREER;VFV;Vanguard S&P 500;20;110;CAD;\nNon enregistré;AAPL;Apple;5;150;USD;\nCELI;Encaisse;;250;;CAD;\n',
    private: 'Placement;Compte;Propriétaire;Valeur;Montant investi;Date\nFonds immobilier;Non enregistré;;25000;20000;2026-09-30\nActions de ma compagnie;Société;;120000;50000;2026-06-30\n',
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
    const title = priv ? 'Importer ou mettre à jour les placements privés' : 'Importer des placements publics';
    const sheet = $('#sheet');
    const panel = h('div', { class: 'sheet-panel wide', role: 'dialog', 'aria-label': title });
    const st = {
      source: '', sheets: [], sheetIdx: 0, header: 0, cols: null, error: '', loading: false,
      link: S.settings[linkKey] || '', fromLink: false,
      owner: S.who === 'all' ? (priv ? 'joint' : 'p1') : S.who,
      account: priv ? 'Non enregistré' : 'CELI', market: 'TSX', date: todayISO(), freq: 'quarterly',
      candidates: [], plan: null, picks: new Map(), remove: new Set(),
    };
    const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const rows = () => (st.sheets[st.sheetIdx] ? st.sheets[st.sheetIdx].rows : []);

    function useSheet(i) {
      st.sheetIdx = i;
      st.header = I.findHeaderRow(rows());
      st.cols = I.detectHoldingColumns(rows()[st.header] || []);
      analyze();
    }
    function analyze() {
      if (!rows().length) { st.plan = null; return; }
      st.candidates = I.toHoldings(rows(), st.header, st.cols, {
        kind, owner: st.owner, account: st.account, market: st.market, date: st.date,
        ownerNames: { p1: S.settings.p1_name, p2: S.settings.p2_name },
      });
      st.plan = I.planSync(st.candidates, S.holdings.filter((hd) => isPrivate(hd) === priv));
      st.picks = new Map(st.plan.items.map((it) => [it.key, it.status !== 'same']));
      st.remove = new Set();
    }

    async function loadFile(file) {
      st.error = '';
      try {
        const name = file.name.toLowerCase();
        if (/\.xlsx$|\.xlsm$/.test(name)) st.sheets = await I.readXlsx(await readBuffer(file));
        else if (/\.(xls|ods|numbers)$/.test(name)) throw new Error('Ce format ne se lit pas directement. Dans Excel ou Numbers : Fichier → Enregistrer sous (ou Exporter) → Classeur Excel (.xlsx) ou CSV, puis importe ce fichier.');
        else st.sheets = [{ name: file.name, rows: I.parseCSV(await readText(file)) }];
        if (!st.sheets.length || !st.sheets.some((sh2) => sh2.rows.length > 1)) throw new Error('Ce fichier ne contient aucune ligne de données.');
        st.source = file.name;
        st.fromLink = false;
        useSheet(Math.max(0, st.sheets.findIndex((sh2) => sh2.rows.length > 1)));
      } catch (e) {
        st.sheets = []; st.plan = null;
        st.error = /not-zip|not-xlsx|zip-method/.test(e.message) ? 'Ce fichier .xlsx est illisible. Ouvre-le dans Excel et enregistre-le à nouveau, ou exporte-le en CSV.' : e.message;
      }
      draw();
    }

    async function loadLink() {
      st.error = '';
      const url = I.sheetsCsvUrl(st.link);
      if (!url) { st.error = 'Ce n’est pas un lien Google Sheets (il doit commencer par https://docs.google.com/spreadsheets/…).'; draw(); return; }
      st.loading = true; draw();
      const notShared = 'Google Sheets refuse l’accès. Dans la feuille : Partager → Accès général → « Tous les utilisateurs disposant du lien » (Lecteur), puis réessaie.';
      try {
        const res = await fetch(url, { credentials: 'omit' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || /html/.test(type)) throw new Error(notShared);
        const parsed = I.parseCSV(await res.text());
        if (parsed.length < 2) throw new Error('La feuille est vide.');
        st.sheets = [{ name: 'Google Sheets', rows: parsed }];
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
        h('div', { class: 'field' }, h('label', { for: 'hold-file', text: 'Fichier Excel (.xlsx) ou CSV' }), fileInput,
          h('span', { class: 'hint' }, st.source && !st.fromLink ? h('strong', { text: `Chargé : ${st.source}. ` }) : null, 'Lu dans ton navigateur, jamais envoyé. ',
            h('a', { href: '#', onclick: (e) => { e.preventDefault(); downloadText(priv ? 'modele-placements-prives.csv' : 'modele-placements-publics.csv', TEMPLATES[kind]); }, text: 'Télécharger un modèle' }))),
        h('div', { class: 'field' }, h('label', { for: 'hold-link', text: 'Ou un lien Google Sheets' }),
          h('div', { class: 'inline-row' }, linkInput, h('button', { class: 'btn', type: 'button', disabled: st.loading ? true : null, onclick: loadLink, text: st.loading ? 'Chargement…' : 'Charger' })),
          h('span', { class: 'hint', text: 'Partage la feuille en « Tous les utilisateurs disposant du lien » (Lecteur). Quiconque a ce lien peut la voir : garde-le pour toi. Plus privé : Fichier → Télécharger → .xlsx, puis importe le fichier.' })));
    }

    function defaultsBlock() {
      const sel = (id, label, value, opts, onChange, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }),
        h('select', { id, onchange: (e) => { onChange(e.target.value); analyze(); draw(); } },
          (Array.isArray(opts) ? opts.map((o) => [o, o]) : Object.entries(opts)).map(([v, l]) => h('option', { value: v, selected: v === value ? true : null, text: l }))),
        hint ? h('span', { class: 'hint', text: hint }) : null);
      const list = [
        sel('hold-owner', 'Propriétaire', st.owner, ownerOptions(), (v) => { st.owner = v; }, st.cols && st.cols.owner >= 0 ? 'Quand la colonne Propriétaire est vide' : 'Le fichier n’a pas de colonne Propriétaire'),
        sel('hold-account', 'Compte', st.account, ACCOUNTS, (v) => { st.account = v; }, st.cols && st.cols.account >= 0 ? 'Quand la colonne Compte est vide' : 'Le fichier n’a pas de colonne Compte'),
      ];
      if (!priv) {
        list.push(sel('hold-market', 'Bourse par défaut', st.market, { TSX: 'TSX', US: 'NYSE / Nasdaq', NEO: 'Cboe Canada', TSXV: 'TSX croissance' }, (v) => { st.market = v; },
          'Pour les symboles sans suffixe (.TO) ni devise USD'));
      } else {
        list.push(h('div', { class: 'field' }, h('label', { for: 'hold-date', text: 'Valeur en date du' }),
          h('input', { id: 'hold-date', type: 'date', value: st.date, onchange: (e) => { st.date = e.target.value || todayISO(); analyze(); draw(); } }),
          h('span', { class: 'hint', text: 'Quand le fichier n’a pas de date' })));
        list.push(sel('hold-freq', 'Mise à jour prévue', st.freq, { '': 'Aucun rappel', monthly: 'Chaque mois', quarterly: 'Chaque trimestre' }, (v) => { st.freq = v; }, 'Pour les nouveaux placements'));
      }
      return h('div', { class: 'fields' }, list);
    }

    function columnsBlock(missingRequired) {
      const r = rows();
      const headerCells = r[st.header] || [];
      const headerSel = h('select', { id: 'hold-header', onchange: (e) => { st.header = Number(e.target.value); st.cols = I.detectHoldingColumns(r[st.header] || []); analyze(); draw(); } },
        r.slice(0, 20).map((row, i) => h('option', { value: String(i), selected: i === st.header ? true : null,
          text: `Ligne ${i + 1} : ${row.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60) || '(vide)'}` })));
      const keys = HOLDING_COLS.filter(([k]) => !(priv && k === 'market'));
      const pick = ([k, label]) => h('div', { class: 'field' }, h('label', { for: 'hold-col-' + k, text: label }),
        h('select', { id: 'hold-col-' + k, onchange: (e) => { st.cols[k] = Number(e.target.value); analyze(); draw(); } },
          h('option', { value: '-1', text: '—' }),
          headerCells.map((c, i) => h('option', { value: String(i), selected: st.cols[k] === i ? true : null, text: c || `Colonne ${i + 1}` }))));
      const found = keys.filter(([k]) => st.cols[k] >= 0).map(([, l]) => l);
      return h('details', { class: 'cols', open: missingRequired ? true : null },
        h('summary', null, found.length ? `Colonnes reconnues : ${found.join(', ')}` : 'Aucune colonne reconnue', h('span', { class: 'muted-caption', text: ' (modifier)' })),
        h('div', { class: 'fields' }, h('div', { class: 'field wide' }, h('label', { for: 'hold-header', text: 'Ligne des titres de colonnes' }), headerSel), keys.map(pick)));
    }

    function previewBlock() {
      const out = [];
      const items = st.plan.items;
      const fmtVal = (row) => (row.market === 'MANUAL' ? native(row.qty * row.manual_price, row.currency)
        : row.market === 'CASH' ? native(row.qty, row.currency) : `${fmtQty.format(row.qty)} parts`);
      const oldVal = (hd) => (hd.market === 'MANUAL' ? native(num(hd.qty) * num(hd.manual_price), hd.currency)
        : hd.market === 'CASH' ? native(num(hd.qty), hd.currency) : `${fmtQty.format(num(hd.qty))} parts`);
      const counts = { new: 0, update: 0, same: 0 };
      for (const it of items) counts[it.status]++;
      out.push(h('p', null, h('strong', { text: `${items.length} placement(s) lu(s)` }),
        ` dans « ${st.source}${st.sheets.length > 1 ? ' › ' + st.sheets[st.sheetIdx].name : ''} » : ${counts.new} nouveau(x), ${counts.update} à mettre à jour, ${counts.same} identique(s).`));
      const body = items.map((it) => {
        const row = it.row;
        const pill = it.status === 'new' ? h('span', { class: 'pill info', text: 'nouveau' })
          : it.status === 'update' ? h('span', { class: 'pill ok', text: 'mise à jour' }) : h('span', { class: 'pill', text: 'identique' });
        const label = row.market === 'MANUAL' ? (row.name || row.symbol) : row.market === 'CASH' ? `Encaisse ${row.currency}` : row.symbol;
        return h('tr', null,
          h('td', null, h('input', { type: 'checkbox', 'aria-label': 'Importer ' + label, checked: st.picks.get(it.key) ? true : null,
            onchange: (e) => { st.picks.set(it.key, e.target.checked); updateCount(); } })),
          h('td', null, h('strong', { text: label }), ' ', row.currency === 'USD' ? h('span', { class: 'pill info', text: 'USD' }) : null, ' ', pill,
            h('span', { class: 'sub', text: [row.market === 'MANUAL' || row.market === 'CASH' ? null : row.name, row.account, ownerName(row.owner)].filter(Boolean).join(' · ') })),
          h('td', { class: 'r' }, fmtVal(row), it.status === 'update' ? h('span', { class: 'sub', text: 'avant : ' + oldVal(it.match) }) : null),
          h('td', { class: 'r hide-sm' }, row.market === 'CASH' || row.avg_cost === null ? '—' : native(row.avg_cost, row.currency),
            h('span', { class: 'sub', text: row.market === 'MANUAL' && row.manual_price_date ? fmtDate(row.manual_price_date) : '' })));
      });
      out.push(h('div', { class: 'table-wrap import-table' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { text: '' }), h('th', { text: priv ? 'Placement' : 'Titre' }), h('th', { class: 'r', text: priv ? 'Valeur' : 'Quantité' }),
          h('th', { class: 'r hide-sm', text: priv ? 'Investi par part' : 'Coût moyen' }))),
        h('tbody', null, body))));
      const skipped = st.candidates.filter((c) => !c.ok);
      if (skipped.length) {
        out.push(h('details', { class: 'cols' }, h('summary', null, `${skipped.length} ligne(s) ignorée(s)`),
          h('ul', { class: 'muted-caption' }, skipped.slice(0, 50).map((c) => h('li', { text: `Ligne ${c.line} (${c.label}) : ${c.reason}` })))));
      }
      if (st.plan.missing.length) {
        out.push(h('h3', { class: 'subhead', text: 'Absents du fichier' }),
          h('p', { class: 'footnote', text: 'Ces placements sont enregistrés dans les mêmes comptes, mais ne sont pas dans le fichier (vendus?). Coche ceux à retirer de l’app.' }),
          h('div', { class: 'checks' }, st.plan.missing.map((hd) => h('label', { class: 'switch' },
            h('input', { type: 'checkbox', checked: st.remove.has(hd.id) ? true : null, onchange: (e) => { if (e.target.checked) st.remove.add(hd.id); else st.remove.delete(hd.id); updateCount(); } }),
            `Retirer ${hd.market === 'MANUAL' ? hd.name || hd.symbol : hd.market === 'CASH' ? 'l’encaisse ' + hd.currency : hd.symbol} · ${hd.account} · ${ownerName(hd.owner)}`))));
      }
      return out;
    }

    const err = h('p', { class: 'form-error', role: 'alert' });
    const applyBtn = h('button', { class: 'btn primary', type: 'button', onclick: apply });
    function updateCount() {
      const n = st.plan ? st.plan.items.filter((it) => st.picks.get(it.key)).length : 0;
      const m = st.remove.size;
      applyBtn.textContent = n || m ? `Enregistrer${n ? ` ${n} placement${n > 1 ? 's' : ''}` : ''}${m ? `${n ? ' et' : ''} retirer ${m}` : ''}` : 'Enregistrer';
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
        if (inserts.length) { const r = await sb.from('holdings').insert(inserts); if (r.error) throw r.error; }
        const results = await Promise.all(updates.map(([id, upd]) => sb.from('holdings').update(upd).eq('id', id)));
        const bad = results.find((r) => r.error);
        if (bad) throw bad.error;
        if (st.remove.size) { const r = await sb.from('holdings').delete().in('id', [...st.remove]); if (r.error) throw r.error; }
        if (st.fromLink && st.link !== (S.settings[linkKey] || '')) {
          const r = await sb.from('settings').update({ [linkKey]: st.link }).eq('id', 1);
          if (r.error) console.warn('Lien non mémorisé :', r.error.message);
        }
      } catch (e) {
        err.textContent = errText(e);
        applyBtn.disabled = false;
        return;
      }
      close();
      toast([inserts.length ? `${inserts.length} ajouté(s)` : '', updates.length ? `${updates.length} mis à jour` : '', st.remove.size ? `${st.remove.size} retiré(s)` : ''].filter(Boolean).join(', '));
      refresh();
    }

    function draw() {
      const parts = [h('h2', { text: title }),
        h('p', { class: 'footnote', text: priv
          ? 'Une ligne par placement : nom, valeur actuelle, et si possible le montant investi, le compte, le propriétaire et la date de la valeur. Les placements déjà enregistrés (même nom, même compte) sont mis à jour.'
          : 'Exporte tes positions depuis ton courtier (Excel ou CSV) ou utilise ta propre feuille : symbole, quantité, et si possible le coût moyen, le compte et la devise. Les titres déjà enregistrés (même symbole, même compte) sont mis à jour.' }),
        sourceBlock()];
      if (st.error) parts.push(h('div', { class: 'banner', text: st.error }));
      if (st.sheets.length > 1) {
        parts.push(h('div', { class: 'field' }, h('label', { for: 'hold-sheet', text: 'Onglet' }),
          h('select', { id: 'hold-sheet', onchange: (e) => { useSheet(Number(e.target.value)); draw(); } },
            st.sheets.map((sh2, i) => h('option', { value: String(i), selected: i === st.sheetIdx ? true : null, text: `${sh2.name} (${Math.max(0, sh2.rows.length - 1)} lignes)` })))));
      }
      if (st.plan) {
        const c = st.cols;
        const missingRequired = priv ? !((c.name >= 0 || c.symbol >= 0) && (c.value >= 0 || c.price >= 0)) : !(c.symbol >= 0 && (c.qty >= 0 || c.value >= 0));
        parts.push(h('h3', { class: 'subhead', text: 'Valeurs par défaut' }), defaultsBlock(), columnsBlock(missingRequired));
        if (missingRequired) parts.push(h('div', { class: 'banner', text: priv ? 'Indique au moins la colonne du nom et celle de la valeur.' : 'Indique au moins la colonne du symbole et celle de la quantité.' }));
        if (st.plan.items.length || st.plan.missing.length) parts.push(...previewBlock());
        else if (!missingRequired) parts.push(h('div', { class: 'banner', text: 'Aucun placement reconnu dans cette feuille. Vérifie la ligne des titres de colonnes ci-dessus.' }));
      }
      updateCount();
      panel.replaceChildren(...parts, err,
        h('div', { class: 'sheet-actions' }, h('div', { class: 'right' }, h('button', { class: 'btn ghost', type: 'button', onclick: close, text: 'Fermer' }), applyBtn)));
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
      return [hd.symbol, hd.name, hd.market, hd.account, own(hd.owner), hd.currency, n(hd.qty), n(hd.avg_cost), v.px, v.mv === null ? null : Math.round(v.mv * 100) / 100, v.date, CLASSES[Object.keys(holdingMix(hd))[0]] || ''];
    });
    const sheets = [
      { name: 'Placements', rows: [['Symbole', 'Nom', 'Marché', 'Compte', 'Propriétaire', 'Devise', 'Quantité', 'Coût moyen', 'Cours', 'Valeur (CAD)', 'Date du cours', 'Catégorie'], ...holdings] },
      { name: 'Transactions', rows: [['Date', 'Opération', 'Titre', 'Compte', 'Propriétaire', 'Quantité', 'Prix', 'Frais', 'Devise', 'Taux USD/CAD', 'Gain réalisé (CAD)', 'Note'],
        ...S.transactions.map((t) => [t.trade_date, t.kind === 'buy' ? 'Achat' : 'Vente', t.symbol, t.account, own(t.owner), n(t.qty), n(t.price), n(t.fees), t.currency, n(t.fx_rate), n(t.realized_gain), t.note])] },
      { name: 'Actifs', rows: [['Nom', 'Type', 'Valeur', 'En date du', 'Propriétaire'], ...S.assets.map((a) => [a.name, a.kind, n(a.value), a.as_of, own(a.owner)])] },
      { name: 'Dettes', rows: [['Nom', 'Type', 'Prêteur', 'Solde', 'Solde au', 'Taux %', 'Taux', 'Paiement', 'Fréquence', 'Fin du terme', 'Propriétaire'],
        ...S.debts.map((d) => [d.name, DEBT_KINDS[d.kind], d.lender, n(d.balance), d.balance_date, n(d.rate), d.rate_type === 'variable' ? 'variable' : 'fixe', n(d.payment), (FREQS[d.freq] || {}).label, C.termEnd(d), own(d.owner)])] },
      { name: 'Budget', rows: [['Description', 'Catégorie', 'Type', 'Montant', 'Fréquence', 'Par mois', 'Pour'],
        ...S.budget.map((b) => [b.name, b.grp, b.kind === 'income' ? 'Revenu' : b.nature === 'variable' ? 'Enveloppe' : 'Dépense fixe', n(b.amount), (FREQS[b.freq] || {}).label, Math.round(C.monthly(b.amount, b.freq) * 100) / 100, own(b.owner)])] },
      { name: 'Dépenses ponctuelles', rows: [['Date', 'Description', 'Catégorie', 'Montant', 'Pour'], ...S.log.map((e) => [e.spend_date, e.label, e.grp, n(e.amount), own(e.owner)])] },
      { name: 'Enfants', rows: [['Nom', 'Naissance', 'Valeur REEE entrée', 'En date du'], ...S.children.map((c) => [c.name, c.birth_date, n(c.resp_value), c.resp_value_date])] },
      { name: 'REEE', rows: [['Enfant', 'Date', 'Type', 'Cotisation', 'SCEE', 'IQEE', 'Note'],
        ...S.resp.map((r) => [(S.children.find((c) => c.id === r.child_id) || {}).name, r.entry_date, r.kind === 'opening' ? 'Solde de départ' : 'Cotisation', n(r.amount), n(r.cesg), n(r.iqee), r.note])] },
      { name: 'Projets', rows: [['Nom', 'Cible', 'Date cible', 'Déjà de côté', 'Par mois', 'Rendement %'], ...S.projects.map((p) => [p.name, n(p.target_amount), p.target_date, n(p.saved), n(p.monthly_contribution), n(p.expected_return)])] },
      { name: 'Compagnies', rows: [['Nom', 'Forme', 'Propriétaire', 'Salaire', 'Dividendes', '5 500 h', 'Revenus / an', 'Dépenses / an', 'Impôt de la compagnie', 'Dans vos poches'],
        ...S.companies.map((c) => { const v = companyView(c); return [c.name, CO_KIND[c.kind], own(c.owner), n(c.salary), n(c.dividends), c.sbd_hours ? 'oui' : 'non', Math.round(v.y.revenue), Math.round(v.y.expenses), v.y.corpTax ? Math.round(v.y.corpTax.total) : null, Math.round(v.pocket)]; })] },
      { name: 'Lignes des compagnies', rows: [['Compagnie', 'Description', 'Catégorie', 'Type', 'Montant', 'Fréquence', 'Déductible %'],
        ...S.company_items.map((i) => [(S.companies.find((c) => c.id === i.company_id) || {}).name, i.name, i.grp, i.kind === 'income' ? 'Revenu' : 'Dépense', n(i.amount), (FREQS[i.freq] || {}).label, n(i.deductible_pct)])] },
      { name: 'Droits CELI-REER', rows: [['Personne', 'Régime', 'Année', 'Type', 'Montant', 'Date', 'Note'],
        ...S.contributions.map((c) => [own(c.owner), c.plan, n(c.year), { room: 'Droits', contribution: 'Cotisation', withdrawal: 'Retrait' }[c.kind], n(c.amount), c.entry_date, c.note])] },
      { name: 'Historique avoir net', rows: [['Date', 'Placements', 'Autres actifs', 'Dettes', 'Avoir net'],
        ...S.snapshots.filter((x) => x.data && x.data.all).map((x) => [x.snap_date, n(x.data.all.inv), n(x.data.all.oth), n(x.data.all.debt), n(x.data.all.net)])] },
    ];
    const bytes = window.Importer.writeXlsx(sheets);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = h('a', { href: url, download: `finances-menage-${todayISO()}.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Fichier Excel créé');
  }

  function openSettings() {
    openForm({
      title: 'Réglages',
      values: { p1_name: S.settings.p1_name, p2_name: S.settings.p2_name, public_sheet_url: S.settings.public_sheet_url, private_sheet_url: S.settings.private_sheet_url },
      fields: [
        { k: 'p1_name', label: 'Nom de la personne 1', type: 'text', req: true },
        { k: 'p2_name', label: 'Nom de la personne 2', type: 'text', req: true },
        // Only once the database has these columns (schema.sql run again after the update).
        ...('public_sheet_url' in S.settings ? [
          { k: 'public_sheet_url', label: 'Lien Google Sheets : placements publics', type: 'text', wide: true, placeholder: 'Aucun', hint: 'Mémorisé au premier import par lien. Efface-le pour l’oublier.' },
          { k: 'private_sheet_url', label: 'Lien Google Sheets : placements privés', type: 'text', wide: true, placeholder: 'Aucun' },
        ] : []),
      ],
      onSave: async (out) => {
        const res = await sb.from('settings').update(out).eq('id', 1);
        if (res.error) throw res.error;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Screens before the app
  // ---------------------------------------------------------------------------
  function loginScreen() {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Se connecter' });
    const form = h('form', { class: 'card login', novalidate: true },
      h('h1', { text: 'Finances du ménage' }),
      h('p', { text: 'Connecte-toi avec le compte créé pour toi.' }),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 'login-email', text: 'Courriel' }), h('input', { id: 'login-email', type: 'email', autocomplete: 'username', required: true })),
        h('div', { class: 'field' }, h('label', { for: 'login-password', text: 'Mot de passe' }), h('input', { id: 'login-password', type: 'password', autocomplete: 'current-password', required: true }))),
      err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
      btn.disabled = false;
      if (error) err.textContent = /invalid/i.test(error.message) ? 'Courriel ou mot de passe incorrect.' : errText(error);
    });
    return form;
  }

  function setupScreen() {
    return h('div', { class: 'card login setup' },
      h('h1', { text: 'Presque prêt' }),
      h('p', null, 'Ouvre ', h('code', { text: 'config.js' }), ' et remplace les deux valeurs par l’URL et la clé publique de ton projet Supabase. Les étapes complètes sont dans le ', h('code', { text: 'README.md' }), '.'));
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
      if (!session) { S.loaded = false; render(); }
      else if (!was || (event === 'SIGNED_IN' && was.user.id !== session.user.id)) {
        S.loaded = false; render(); lastLoad = Date.now();
        setTimeout(refresh, 0); // never call Supabase from inside this callback (auth lock)
      }
    });
    if (S.session) { render(); lastLoad = Date.now(); await refresh(); } else render();
  }
  boot();
})();
