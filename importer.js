/*
 * Bank statement import (CSV). Runs entirely in the browser: the file is read
 * locally and never uploaded. Only the budget lines the person chooses to add
 * are saved.
 *
 * Built for RBC's "Download transactions" CSV, but columns are detected by
 * name, so most Canadian bank exports work; if detection fails the page asks
 * which column is which.
 */
(function (root) {
  'use strict';

  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of firstLine) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    return rows.map((r) => r.map((c) => c.trim()));
  }

  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$]/g, '');

  /** Guess which columns hold the date, the description(s) and the amount(s). */
  function detectColumns(header) {
    const h = header.map(plain);
    const find = (tests) => { for (const t of tests) { const i = h.findIndex((x) => t(x)); if (i >= 0) return i; } return -1; };
    const date = find([(x) => x === 'transactiondate', (x) => x === 'datedetransaction' || x === 'datedeloperation' || x === 'datedelatransaction', (x) => x === 'date', (x) => x.includes('date') && !x.includes('post') && !x.includes('inscription'), (x) => x.includes('date')]);
    const desc = h.map((x, i) => (/description|libelle|details|payee|beneficiaire|marchand|merchant|nom/.test(x) ? i : -1)).filter((i) => i >= 0);
    const amount = find([(x) => x === 'cad$' || x === 'cad', (x) => x === 'amount' || x === 'montant' || x === 'montantcad' || x === 'amountcad', (x) => x.includes('amount') || x.includes('montant')]);
    const debit = find([(x) => /debit|withdrawal|retrait|sortie/.test(x)]);
    const credit = find([(x) => /credit|deposit|depot|entree/.test(x) && !x.includes('carte')]);
    return { date, desc, amount, debit, credit };
  }

  function parseAmount(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).replace(/[\s  $]/g, '').replace(/CAD|USD/gi, '');
    if (s === '') return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }

  /** Returns a function that turns this file's date strings into YYYY-MM-DD. */
  function dateParserFor(values) {
    const slash = values.map((v) => String(v).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)).filter(Boolean);
    let order = 'MDY'; // RBC exports month/day/year
    if (slash.some((m) => Number(m[1]) > 12)) order = 'DMY';
    else if (slash.some((m) => Number(m[2]) > 12)) order = 'MDY';
    const pad = (n) => String(n).padStart(2, '0');
    return (raw) => {
      const v = String(raw || '').trim();
      let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
      m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      if (m) {
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        const [mo, d] = order === 'DMY' ? [m[2], m[1]] : [m[1], m[2]];
        if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
        return `${y}-${pad(mo)}-${pad(d)}`;
      }
      const t = Date.parse(v);
      return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
    };
  }

  /**
   * rows: parsed CSV including the header row. cols: from detectColumns (or chosen by the person).
   * Returns transactions with amount < 0 for money going out.
   * expensesPositive: for files (often credit cards) where purchases are positive numbers.
   */
  function toTransactions(rows, cols, expensesPositive) {
    const body = rows.slice(1);
    const parseDate = dateParserFor(body.map((r) => r[cols.date]));
    const out = [];
    for (const r of body) {
      const date = parseDate(r[cols.date]);
      if (!date) continue;
      let amount = null;
      if (cols.amount >= 0) {
        amount = parseAmount(r[cols.amount]);
        if (amount !== null && expensesPositive) amount = -amount;
      } else {
        const d = cols.debit >= 0 ? parseAmount(r[cols.debit]) : null;
        const c = cols.credit >= 0 ? parseAmount(r[cols.credit]) : null;
        if (d) amount = -Math.abs(d);
        else if (c) amount = Math.abs(c);
      }
      if (amount === null || amount === 0) continue;
      const description = cols.desc.map((i) => r[i]).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      out.push({ date, description, amount });
    }
    return out;
  }

  /** In a single amount column, guess whether purchases are positive (more positives than negatives). */
  function guessExpensesPositive(rows, cols) {
    if (cols.amount < 0) return false;
    let pos = 0, neg = 0;
    for (const r of rows.slice(1)) {
      const a = parseAmount(r[cols.amount]);
      if (a > 0) pos++; else if (a < 0) neg++;
    }
    return pos > neg * 2.5;
  }

  const GENERIC = /\b(POINT OF SALE|POS|INTERAC|RETAIL PURCHASE|PURCHASE|ACHAT|CONTACTLESS|SANS CONTACT|VISA DEBIT|DEBIT VISA|MISC PAYMENT|PAIEMENT DIVERS|BILL PAYMENT|PAIEMENT DE FACTURE|ONLINE BANKING|SERVICES BANCAIRES EN LIGNE|PRE AUTHORIZED|PREAUTHORIZED|PRE-AUTHORIZED|PREAUTORISE|PAYMENT|PAIEMENT|DEBIT|CREDIT|WWW|COM|CA|QC|MONTREAL|LAVAL|LONGUEUIL|INC|LTEE|LTD)\b/g;

  function merchantKey(desc) {
    const s = String(desc || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[#*]/g, ' ').replace(/\b[A-Z]*\d[\dA-Z-]*\b/g, ' ')
      .replace(/[^A-Z&' -]+/g, ' ').replace(/ - /g, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
    const words = s.split(' ').filter((w) => w.length > 1 || w === '&');
    return words.slice(0, 3).join(' ') || String(desc || '').toUpperCase().slice(0, 24);
  }

  const TRANSFER = /VIREMENT|TRANSFER|\bTFR\b|E-TRF|INTERAC E|RBC CREDIT CARD|CARTE DE CREDIT|CREDIT CARD|PAYMENT - THANK|MERCI POUR|AUTODEPOSIT|DEPOT AUTOMATIQUE/;

  const CATEGORY_RULES = [
    [/HYDRO|ENERGIR|GAZ METRO/, 'Électricité et chauffage'],
    [/VIDEOTRON|\bBELL\b|ROGERS|TELUS|FIDO|KOODO|FIZZ|VIRGIN|PUBLIC MOBILE|CHATR|EBOX|OXIO|COGECO|DISTRIBUTEL|FREEDOM/, 'Internet et téléphone'],
    [/NETFLIX|SPOTIFY|DISNEY|CRAVE|APPLE|GOOGLE|YOUTUBE|AMAZON PRIME|PRIME VIDEO|AUDIBLE|PATREON|ICLOUD|MICROSOFT|ADOBE|OPENAI|ANTHROPIC|DROPBOX|PARAMOUNT|TOU TV|ILLICO/, 'Abonnements'],
    [/LOYER|RENT|PROPRIO|LANDLORD|TAXE|TAXES MUNICIPALES|VILLE DE|SYNDICAT|CONDO/, 'Logement'],
    [/ASSURANCE|INSURANCE|INTACT|BELAIR|DESJARDINS ASS|LA CAPITALE|BENEVA|\bSSQ\b|PROMUTUEL|INDUSTRIELLE|SUN LIFE|MANUVIE|MANULIFE|CANADA LIFE|ALLSTATE|TD ASSURANCE/, 'Assurances'],
    [/\bIGA\b|\bMETRO\b|\bMAXI\b|PROVIGO|SUPER C\b|ADONIS|AVRIL|COSTCO|WALMART|LOBLAWS|SAVE ON|FRUITERIE|EPICERIE|MARCHE|PA SUPER|INSTACART/, 'Alimentation'],
    [/\bSTM\b|\bOPUS\b|\bEXO\b|BIXI|COMMUNAUTO|ESSO|SHELL|PETRO|ULTRAMAR|COUCHE|IRVING|CROWN|SAAQ|PARKING|STATIONNEMENT|UBER|LYFT|TAXI|VIA RAIL|PRESTO/, 'Transport'],
    [/GARDERIE|\bCPE\b|DAYCARE|SERVICE DE GARDE|CAMP|ECOLE|SCHOOL|CSSDM|CENTRE DE SERVICES SCOLAIRE/, 'Enfants'],
    [/PHARMA|JEAN COUTU|FAMILIPRIX|UNIPRIX|BRUNET|PROXIM|DENTAI|DENTIS|CLINIQUE|PHYSIO|OPTOM|LUNETTERIE/, 'Santé'],
    [/\bGYM\b|ENERGIE CARDIO|NAUTILUS|YMCA|CROSSFIT|YOGA|CLIMB|CLASSPASS/, 'Loisirs et sorties'],
    [/RESTAURANT|RESTO|CAFE|STARBUCKS|TIM HORTONS|MCDONALD|SUBWAY|PIZZA|DOORDASH|UBER EATS|SKIP|A&W|\bBAR\b/, 'Restaurants'],
    [/AIR CANADA|AIR TRANSAT|WESTJET|PORTER|AIRBNB|EXPEDIA|BOOKING|HOTEL|MARRIOTT|HILTON/, 'Voyages'],
    [/AMAZON|SIMONS|WINNERS|ZARA|UNIQLO|H&M|SPORT EXPERTS|DECATHLON|BEST BUY|CANADIAN TIRE|IKEA|DOLLARAMA|HOME DEPOT|RONA|BMR|RENO DEPOT/, 'Shopping'],
    [/PAYROLL|\bPAIE\b|SALAIRE|SALARY|DEPOT DIRECT|DIRECT DEPOSIT|GOUVERNEMENT|GOVERNMENT|\bGC\b|RETRAITE QUEBEC|ALLOCATION|\bCCB\b|\bACE\b|\bPAY\b/, 'Revenu'],
  ];

  function suggestCategory(key, description) {
    const s = (key + ' ' + String(description || '').toUpperCase()).normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const [re, cat] of CATEGORY_RULES) if (re.test(s)) return cat;
    return null;
  }

  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'&-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  /**
   * Group transactions by merchant and flag what repeats.
   * kind: 'fixed' (same amount most months), 'recurring' (most months, amount varies),
   * 'oneoff' (everything else). monthly: for fixed items, the usual amount × how often it
   * comes back; otherwise total over the period ÷ months covered.
   */
  function analyze(transactions) {
    if (!transactions.length) return { months: 0, from: null, to: null, groups: [], canDetect: false };
    const dates = transactions.map((t) => t.date).sort();
    const from = dates[0], to = dates.at(-1);
    const spanDays = (new Date(to) - new Date(from)) / 86400000 + 1;
    const months = Math.max(1, spanDays / 30.44);
    const canDetect = spanDays >= 45;
    const byKey = new Map();
    for (const t of transactions) {
      const dir = t.amount < 0 ? 'out' : 'in';
      const key = merchantKey(t.description);
      const id = dir + '|' + key;
      if (!byKey.has(id)) byKey.set(id, { id, key, dir, items: [], descriptions: new Map() });
      const g = byKey.get(id);
      g.items.push(t);
      g.descriptions.set(t.description, (g.descriptions.get(t.description) || 0) + 1);
    }
    const groups = [];
    for (const g of byKey.values()) {
      const amounts = g.items.map((t) => Math.abs(t.amount));
      const total = amounts.reduce((a, b) => a + b, 0);
      const mean = total / amounts.length;
      const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
      const cv = mean > 0 ? sd / mean : 0;
      const monthSet = new Set(g.items.map((t) => t.date.slice(0, 7)));
      const count = g.items.length;
      let kind = 'oneoff';
      if (canDetect && monthSet.size >= 2 && count >= Math.max(2, Math.floor(months * 0.6))) kind = cv <= 0.1 ? 'fixed' : 'recurring';
      // How often it comes back: median gap between occurrences.
      const days = g.items.map((t) => new Date(t.date + 'T12:00:00').getTime()).sort((a, b) => a - b);
      const gaps = days.slice(1).map((d, i) => (d - days[i]) / 86400000).sort((a, b) => a - b);
      const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
      let freq = null, perMonth = total / months;
      if (kind === 'fixed' && gap !== null) {
        if (gap >= 25 && gap <= 35) { freq = 'monthly'; perMonth = mean; }
        else if (gap >= 12 && gap <= 16) { freq = 'biweekly'; perMonth = (mean * 26) / 12; }
        else if (gap >= 6 && gap <= 8) { freq = 'weekly'; perMonth = (mean * 52) / 12; }
        else perMonth = total / monthSet.size;
      }
      const commonDesc = [...g.descriptions.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const isTransfer = TRANSFER.test(commonDesc.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
      groups.push({
        id: g.id, dir: g.dir, key: g.key, name: titleCase(g.key), description: commonDesc,
        count, monthsSeen: monthSet.size, total, average: mean, cv, monthly: perMonth, freq,
        kind, isTransfer, category: suggestCategory(g.key, commonDesc),
        lastDate: g.items.map((t) => t.date).sort().at(-1),
      });
    }
    const rank = { fixed: 0, recurring: 1, oneoff: 2 };
    groups.sort((a, b) => rank[a.kind] - rank[b.kind] || b.monthly - a.monthly);
    return { months, from, to, groups, canDetect, count: transactions.length };
  }

  const api = { parseCSV, detectColumns, parseAmount, dateParserFor, toTransactions, guessExpensesPositive, merchantKey, suggestCategory, analyze };
  root.Importer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
