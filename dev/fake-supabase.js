/*
 * Test mode (dev.html): a stand-in for the Supabase client with made-up data.
 * Rows live in this browser tab (sessionStorage); nothing reaches the real database,
 * and config.js is never loaded. DevDB.reset() puts the sample data back.
 *
 * Supports what app.js uses: from(table).select/insert/update/upsert/delete with
 * eq, in, order, limit, maybeSingle, and a signed-in session.
 */
(function () {
  'use strict';
  const KEY = 'finances-dev-db-v1';
  const today = new Date();
  const iso = (d) => d.toLocaleDateString('en-CA');
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  const monthsAgo = (n, day = 1) => { const d = new Date(today.getFullYear(), today.getMonth() - n, day); return iso(d); };
  let seq = 0;
  const uid = () => 'dev-' + Date.now().toString(36) + '-' + (seq++).toString(36);
  const stamp = (i) => new Date(Date.UTC(2025, 0, 1) + i * 60000).toISOString();

  function sample() {
    let i = 0;
    const row = (r) => ({ id: uid(), created_at: stamp(i++), updated_at: stamp(i), ...r });
    const kid1 = row({ name: 'Léa', birth_date: '2019-04-12', resp_value: null, resp_value_date: null });
    const kid2 = row({ name: 'Félix', birth_date: '2022-09-03', resp_value: 6200, resp_value_date: monthsAgo(1) });
    const trip = row({ name: 'Voyage au Japon', target_amount: 12000, target_date: `${today.getFullYear() + 2}-06-01`, saved: 2500, monthly_contribution: 300, expected_return: 3, note: null });
    const co = row({ name: 'Studio Photo', kind: 'autonome', owner: 'p2', salary: null, dividends: null, sbd_hours: null, note: null });
    const holdings = [
      row({ symbol: 'XEQT', name: 'iShares Core Equity ETF', market: 'TSX', currency: 'CAD', qty: 820, avg_cost: 29.4, account: 'CELI', institution: 'Wealthsimple', owner: 'p1' }),
      row({ symbol: 'VFV', name: 'Vanguard S&P 500', market: 'TSX', currency: 'CAD', qty: 140, avg_cost: 118, account: 'REER', institution: 'Desjardins', owner: 'p2' }),
      row({ symbol: 'AAPL', name: 'Apple', market: 'US', currency: 'USD', qty: 25, avg_cost: 185, account: 'Non enregistré', institution: 'Wealthsimple', owner: 'joint' }),
      row({ symbol: 'FONDS-DESJ', name: 'Fonds Desjardins équilibré', market: 'MANUAL', currency: 'CAD', qty: 900, avg_cost: 10, manual_price: 11.37, manual_price_date: monthsAgo(1), account: 'REER', owner: 'p2', update_freq: 'quarterly' }),
      row({ symbol: 'VGRO', name: 'Vanguard Growth', market: 'TSX', currency: 'CAD', qty: 210, avg_cost: 30.5, account: 'REEE', owner: 'joint', child_id: kid1.id }),
      row({ symbol: 'CAD', name: 'Encaisse', market: 'CASH', currency: 'CAD', qty: 4250, avg_cost: null, account: 'CELI', owner: 'p1', project_id: trip.id }),
    ];
    const px = (key, close, prev, cur) => ({ symbol_key: key, close, prev_close: prev, currency: cur, price_date: daysAgo(1), source: 'test', fetched_at: new Date().toISOString() });
    const prices = [px('TSX:XEQT', 36.8, 36.5, 'CAD'), px('TSX:VFV', 158.2, 157.1, 'CAD'), px('US:AAPL', 238.5, 240.1, 'USD'), px('TSX:VGRO', 37.9, 37.7, 'CAD'), px('FX:USDCAD', 1.39, 1.388, 'CAD')];
    const snapshots = [];
    for (let m = 12; m >= 0; m--) {
      const inv = 98000 + (12 - m) * 1900, oth = 742000, debt = 418000 - (12 - m) * 1100;
      const p = (f) => ({ inv: Math.round(inv * f), oth: Math.round(oth * f), debt: Math.round(debt * f), net: Math.round((inv + oth - debt) * f) });
      snapshots.push({ snap_date: m ? monthsAgo(m, 15) : daysAgo(1), data: { all: p(1), p1: p(0.52), p2: p(0.48) }, source: 'auto', created_at: stamp(i++) });
    }
    const budget = (name, grp, kind, amount, freq, owner, extra = {}) => row({ name, grp, kind, nature: 'fixed', amount, freq, owner, child_id: null, gross: false, ...extra });
    return {
      settings: [{ id: 1, p1_name: 'Alex', p2_name: 'Sam', include_debt_payments: true, allocation_targets: null, projection: {}, tax: {},
        public_sheet_url: null, private_sheet_url: null, created_at: stamp(0), updated_at: stamp(0) }],
      holdings,
      prices,
      assets: [
        row({ name: 'Maison', kind: 'Résidence principale', value: 715000, as_of: monthsAgo(3), owner: 'joint' }),
        row({ name: 'Auto', kind: 'Véhicule', value: 21000, as_of: monthsAgo(3), owner: 'p2' }),
        row({ name: 'Compte chèque', kind: 'Compte bancaire', value: 6000, as_of: daysAgo(7), owner: 'joint' }),
      ],
      debts: [
        row({ name: 'Hypothèque maison', kind: 'mortgage', lender: 'Desjardins', balance: 398500, balance_date: monthsAgo(1), rate: 4.29, rate_type: 'fixed', payment: 1010, freq: 'biweekly',
          original: 430000, start_date: '2023-05-01', amortization_years: 25, term_start: '2023-05-01', term_years: 5, term_end: '2028-05-01', prepay_pct: 15, owner: 'joint' }),
        row({ name: 'Prêt auto', kind: 'auto', lender: 'Banque Nationale', balance: 14200, balance_date: monthsAgo(1), rate: 6.49, rate_type: 'fixed', payment: 410, freq: 'monthly', original: 28000, term_end: null, owner: 'p2' }),
        row({ name: 'Marge de crédit', kind: 'loc', lender: 'RBC', balance: 2400, balance_date: monthsAgo(1), rate: 9.7, rate_type: 'variable', payment: 150, freq: 'monthly', original: null, term_end: null, owner: 'p1' }),
      ],
      budget_items: [
        budget('Salaire – Alex', 'Salaire net', 'income', 95000, 'yearly', 'p1', { gross: true }),
        budget('Travail autonome – Sam', 'Travail autonome', 'income', 2350, 'biweekly', 'p2'),
        budget('Allocation famille', 'Allocations familiales', 'income', 520, 'monthly', 'joint'),
        budget('Taxes municipales', 'Logement', 'expense', 4800, 'yearly', 'joint'),
        budget('Hydro-Québec', 'Électricité et chauffage', 'expense', 140, 'monthly', 'joint'),
        budget('Vidéotron', 'Internet et téléphone', 'expense', 125, 'monthly', 'joint'),
        budget('Assurance auto et habitation', 'Assurances', 'expense', 210, 'monthly', 'joint'),
        budget('Épicerie', 'Alimentation', 'expense', 260, 'weekly', 'joint'),
        budget('Netflix', 'Abonnements', 'expense', 21, 'monthly', 'joint'),
        budget('CELI automatique', 'Épargne et placements', 'expense', 250, 'biweekly', 'p1'),
        budget('Voyages', 'Voyages', 'expense', 300, 'monthly', 'joint', { nature: 'variable' }),
        budget('Restaurants', 'Restaurants', 'expense', 250, 'monthly', 'joint', { nature: 'variable' }),
        budget('Shopping', 'Shopping', 'expense', 200, 'monthly', 'joint', { nature: 'variable' }),
        budget('Garderie', 'Garderie / service de garde', 'expense', 9.35, 'weekly', 'joint', { child_id: kid2.id }),
        budget('Natation', 'Activités', 'expense', 480, 'yearly', 'joint', { child_id: kid1.id }),
      ],
      snapshots,
      children: [kid1, kid2],
      resp_entries: [
        row({ child_id: kid1.id, entry_date: monthsAgo(14), kind: 'opening', amount: 9000, cesg: 1800, iqee: 900, note: 'Totaux à date' }),
        row({ child_id: kid1.id, entry_date: monthsAgo(2), kind: 'contribution', amount: 2500, cesg: 500, iqee: 250, note: null }),
      ],
      projects: [trip],
      expense_log: [
        row({ spend_date: daysAgo(3), label: 'Souper au resto', grp: 'Restaurants', amount: 86.4, owner: 'joint', child_id: null }),
        row({ spend_date: daysAgo(9), label: 'Manteau d’hiver', grp: 'Vêtements', amount: 74.99, owner: 'joint', child_id: kid1.id }),
        row({ spend_date: daysAgo(20), label: 'Billets de train', grp: 'Voyages', amount: 212, owner: 'joint', child_id: null }),
      ],
      companies: [co],
      company_items: [
        row({ company_id: co.id, kind: 'income', name: 'Contrats de photo', grp: 'Ventes et honoraires', amount: 5200, freq: 'monthly', deductible_pct: 100 }),
        row({ company_id: co.id, kind: 'expense', name: 'Adobe Creative Cloud', grp: 'Logiciels et abonnements', amount: 34, freq: 'monthly', deductible_pct: 100 }),
        row({ company_id: co.id, kind: 'expense', name: 'Repas clients', grp: 'Repas et représentation', amount: 120, freq: 'monthly', deductible_pct: 50 }),
      ],
      transactions: [
        row({ holding_id: holdings[0].id, symbol: 'XEQT', market: 'TSX', currency: 'CAD', account: 'CELI', owner: 'p1', kind: 'buy', trade_date: monthsAgo(2), qty: 50, price: 34.1, fees: 0, fx_rate: null, acb_per_unit: null, realized_gain: null, note: null }),
        row({ holding_id: holdings[2].id, symbol: 'AAPL', market: 'US', currency: 'USD', account: 'Non enregistré', owner: 'joint', kind: 'sell', trade_date: monthsAgo(1), qty: 5, price: 230, fees: 4.99, fx_rate: 1.38, acb_per_unit: 255.3, realized_gain: 302.2, note: null }),
      ],
      contributions: [
        row({ owner: 'p1', plan: 'CELI', kind: 'room', year: today.getFullYear(), amount: 21000, entry_date: monthsAgo(9), note: 'Avis de cotisation' }),
        row({ owner: 'p1', plan: 'CELI', kind: 'contribution', year: today.getFullYear(), amount: 6000, entry_date: monthsAgo(3), note: null }),
        row({ owner: 'p2', plan: 'REER', kind: 'room', year: today.getFullYear(), amount: 18500, entry_date: monthsAgo(9), note: null }),
      ],
    };
  }

  function load() {
    try { const raw = sessionStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* storage unavailable */ }
    return sample();
  }
  let db = load();
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable */ } }
  save();

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 30));

  /** Chainable query, resolved when awaited. */
  function query(table) {
    const q = { op: 'select', filters: [], orders: [], lim: null, single: false, payload: null, returning: false, conflict: null };
    const api = {
      select() { if (q.op !== 'select') q.returning = true; return api; },
      insert(rows) { q.op = 'insert'; q.payload = rows; return api; },
      upsert(rows, opts) { q.op = 'upsert'; q.payload = rows; q.conflict = (opts && opts.onConflict) || 'id'; return api; },
      update(values) { q.op = 'update'; q.payload = values; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(col, v) { q.filters.push((r) => String(r[col]) === String(v)); return api; },
      in(col, list) { const s = new Set(list.map(String)); q.filters.push((r) => s.has(String(r[col]))); return api; },
      order(col, opts = {}) { q.orders.push([col, opts.ascending !== false, !!opts.nullsFirst]); return api; },
      limit(n) { q.lim = n; return api; },
      maybeSingle() { q.single = true; return api; },
      single() { q.single = true; return api; },
      then(ok, fail) { return delay(run()).then(ok, fail); },
    };
    function run() {
      if (!(table in db)) return { data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
      const rows = db[table];
      const match = (r) => q.filters.every((f) => f(r));
      const now = new Date().toISOString();
      let out;
      if (q.op === 'select') {
        out = rows.filter(match);
        for (const [col, asc, nullsFirst] of q.orders.slice().reverse()) {
          out = out.slice().sort((a, b) => {
            const x = a[col], y = b[col];
            if (x == null || y == null) return x == null && y == null ? 0 : (x == null) === nullsFirst ? -1 : 1;
            return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
          });
        }
        if (q.lim !== null) out = out.slice(0, q.lim);
      } else if (q.op === 'insert' || q.op === 'upsert') {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload];
        out = list.map((r) => {
          const key = q.conflict;
          const found = q.op === 'upsert' && rows.find((x) => x[key] === r[key]);
          if (found) { Object.assign(found, r, { updated_at: now }); return found; }
          const fresh = { id: uid(), created_at: now, updated_at: now, ...r };
          rows.push(fresh);
          return fresh;
        });
        save();
      } else if (q.op === 'update') {
        out = rows.filter(match);
        out.forEach((r) => Object.assign(r, q.payload, { updated_at: now }));
        save();
      } else {
        out = rows.filter(match);
        db[table] = rows.filter((r) => !match(r));
        if (table === 'children') {
          const gone = new Set(out.map((r) => r.id));
          db.resp_entries = db.resp_entries.filter((r) => !gone.has(r.child_id));
        }
        save();
      }
      if (q.op !== 'select' && !q.returning) return { data: null, error: null };
      const data = clone(out);
      return { data: q.single ? data[0] || null : data, error: null };
    }
    return api;
  }

  // Signed in from the start as a made-up member of the household.
  let session = { access_token: 'dev', user: { id: 'dev-user', email: 'alex@example.com' } };
  const listeners = [];
  const emit = (event) => listeners.forEach((fn) => fn(event, session));
  const client = {
    from: query,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() { listeners.splice(listeners.indexOf(fn), 1); } } } }; },
      async signInWithPassword({ email }) {
        session = { access_token: 'dev', user: { id: 'dev-user', email: email || 'alex@example.com' } };
        setTimeout(() => emit('SIGNED_IN'), 0);
        return { data: { session }, error: null };
      },
      async signOut() { session = null; setTimeout(() => emit('SIGNED_OUT'), 0); return { error: null }; },
    },
  };

  window.APP_CONFIG = { SUPABASE_URL: 'https://test.local', SUPABASE_KEY: 'test-mode' };
  window.supabase = { createClient: () => client };
  window.DevDB = {
    reset() { try { sessionStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } location.reload(); },
    dump: () => clone(db),
  };
})();
