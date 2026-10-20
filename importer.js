/*
 * Bank statement import (CSV or PDF). Runs entirely in the browser: the file is read
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

  // ===========================================================================
  // Spreadsheets: .xlsx files (read locally) and Google Sheets links
  // ===========================================================================
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  /** Minimal ZIP reader (an .xlsx is a ZIP of XML files). Returns name → async () => text. */
  function unzip(buffer) {
    const b = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not-zip');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const files = {};
    for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
      const method = u16(b, p + 10), size = u32(b, p + 20), local = u32(b, p + 42);
      const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
      files[name] = async () => {
        const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
        const data = b.subarray(start, start + size);
        if (method === 0) return new TextDecoder().decode(data);
        if (method !== 8) throw new Error('zip-method');
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]));
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? unxml(m[1]) : null; };
  /** Concatenated text of every <t> inside a shared string or inline string (rich text has several). */
  const xmlText = (x) => {
    let out = '';
    for (const m of x.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += unxml(m[1]);
    return out;
  };
  const colIndex = (ref) => { let n = 0; for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  /** Reads an .xlsx workbook. Returns [{ name, rows }] for each visible sheet; cells are strings. */
  async function readXlsx(buffer) {
    const zip = unzip(buffer);
    if (!zip['xl/workbook.xml']) throw new Error('not-xlsx');
    const workbook = await zip['xl/workbook.xml']();
    const rels = zip['xl/_rels/workbook.xml.rels'] ? await zip['xl/_rels/workbook.xml.rels']() : '';
    const target = {};
    for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) target[attr(m[1], 'Id')] = attr(m[1], 'Target');
    const strings = [];
    if (zip['xl/sharedStrings.xml']) {
      for (const m of (await zip['xl/sharedStrings.xml']()).matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g)) strings.push(m[1] ? xmlText(m[1]) : '');
    }
    const sheets = [];
    for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
      if (attr(m[1], 'state') === 'hidden' || attr(m[1], 'state') === 'veryHidden') continue;
      const rid = (m[1].match(/\s(?:\w+:)?id="([^"]*)"/) || [])[1];
      let path = target[rid] || '';
      path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
      if (!zip[path]) continue;
      sheets.push({ name: attr(m[1], 'name') || `Feuille ${sheets.length + 1}`, rows: parseSheetXml(await zip[path](), strings) });
    }
    return sheets;
  }

  function parseSheetXml(xml, strings) {
    const rows = [];
    let nextRow = 0;
    for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const r = attr(rm[1], 'r');
      const ri = r ? Number(r) - 1 : nextRow;
      nextRow = ri + 1;
      const cells = [];
      let nextCol = 0;
      for (const cm of (rm[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attr(cm[1], 'r');
        const ci = ref ? colIndex(ref.replace(/\d+$/, '')) : nextCol;
        nextCol = ci + 1;
        const inner = cm[2] || '';
        const t = attr(cm[1], 't');
        const v = (inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
        let val = '';
        if (t === 's') val = strings[Number(v)] ?? '';
        else if (t === 'inlineStr') val = xmlText(inner);
        else if (t === 'b') val = v === '1' ? 'VRAI' : 'FAUX';
        else if (t === 'e') val = '';
        else if (v !== undefined) val = unxml(v);
        cells[ci] = val.trim();
      }
      rows[ri] = Array.from(cells, (c) => c ?? '');
    }
    return Array.from(rows, (r) => r || []);
  }

  /** Google Sheets link → CSV export URL (needs "Anyone with the link" access, or "Publish to the web"). */
  function sheetsCsvUrl(link) {
    const s = String(link || '').trim();
    const gid = (s.match(/[#&?]gid=(\d+)/) || [])[1];
    let m = s.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/);
    if (m) return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv` + (gid ? `&single=true&gid=${gid}` : '');
    m = s.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/);
    if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv` + (gid ? `&gid=${gid}` : '');
    return null;
  }

  // --- Writing .xlsx (data export) ------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** ZIP with stored (uncompressed) entries: small, simple, and every spreadsheet program reads it. */
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const le = (n, size) => { const b = new Uint8Array(size); for (let i = 0; i < size; i++) b[i] = (n >>> (8 * i)) & 0xff; return b; };
    for (const [name, text] of files) {
      const data = enc.encode(text), nameB = enc.encode(name), crc = crc32(data);
      const head = [le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(nameB.length, 2), le(0, 2)];
      parts.push(...head, nameB, data);
      central.push(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4),
        le(nameB.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = [le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cdSize, 4), le(offset, 4), le(0, 2)];
    const all = [...parts, ...central, ...end];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }
  const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  /**
   * sheets: [{ name, rows: [[cell…]…] }], first row = headers (bold). Numbers stay numbers; everything else is text.
   * Returns the .xlsx file as bytes.
   */
  function writeXlsx(sheets) {
    const used = new Set();
    const names = sheets.map((sh) => {
      let n = String(sh.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille';
      let k = 2;
      while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + k++;
      used.add(n.toLowerCase());
      return n;
    });
    const sheetXml = (rows) => {
      const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
        const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
    };
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ...sheets.map((sh, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh.rows)]),
    ];
    return zipStore(files);
  }

  // ===========================================================================
  // Portfolio import: a spreadsheet of holdings → rows the app can save
  // ===========================================================================
  /** Guess which column holds each holding field. Specific names are tried before generic ones. */
  function detectHoldingColumns(header) {
    const h = header.map(plain);
    const used = new Set();
    const find = (...tests) => {
      for (const t of tests) {
        const i = h.findIndex((x, j) => x && !used.has(j) && t(x));
        if (i >= 0) { used.add(i); return i; }
      }
      return -1;
    };
    const has = (...words) => (x) => words.some((w) => x.includes(w));
    const cols = {};
    cols.avg_cost = find(has('coutmoyen', 'prixmoyen', 'averagecost', 'avgcost', 'averageprice', 'avgprice', 'costpershare', 'costperunit', 'coutparpart', 'coutparaction', 'coutunitaire', 'prixdachat', 'purchaseprice', 'acbpershare', 'pbrparpart'));
    cols.book_value = find(has('valeurcomptable', 'bookvalue', 'bookcost', 'couttotal', 'totalcost', 'costbasis', 'prixdebase', 'coutdacquisition', 'montantinvesti', 'investi', 'invested'), (x) => x === 'pbr' || x === 'acb' || x === 'cout' || x === 'cost' || x === 'cout$' || x === 'cost$');
    cols.price = find(has('valeurliquidative', 'valeurunitaire', 'marketprice', 'lastprice', 'unitprice', 'prixdumarche', 'prixactuel', 'coursactuel', 'currentprice'), (x) => /^(cours|prix|price|nav|vl|close|cloture|dernier|last)\$?$/.test(x), has('cours', 'prix', 'price'));
    cols.value = find(has('valeurmarchande', 'marketvalue', 'valeuractuelle', 'currentvalue', 'valeurtotale', 'totalvalue'), (x) => /^(valeur|value|montant|amount|solde|balance|total)(cad|\$|cad\$)?$/.test(x), has('valeur', 'value', 'montant'));
    cols.qty = find(has('quantite', 'quantity', 'nombredeparts', 'nombredunites', 'nbdeparts'), (x) => /^(qty|qte|parts|units|unites|shares|nombre|nbre|nb|actions)$/.test(x));
    cols.symbol = find(has('symbole', 'symbol', 'ticker', 'sigle'), (x) => x === 'code' || x === 'titre');
    cols.name = find(has('description', 'valeurmobiliere', 'security', 'nomdutitre', 'placement', 'produit', 'investment', 'libelle', 'fonds', 'fund'), (x) => x === 'nom' || x === 'name' || x === 'titre');
    cols.account = find(has('typedecompte', 'accounttype', 'regime', 'enveloppe'), (x) => x === 'compte' || x === 'account' || x === 'type',
      (x) => /compte|account/.test(x) && !/numero|number|^no|^num|^#/.test(x));
    cols.currency = find(has('devise', 'currency', 'monnaie'), (x) => x === 'cur' || x === 'ccy');
    cols.market = find((x) => x === 'marche' || x === 'market' || x === 'place', has('bourse', 'exchange'));
    cols.owner = find(has('proprietaire', 'owner', 'detenteur', 'titulaire'), (x) => x === 'personne' || x === 'qui');
    cols.date = find(has('datedevalorisation', 'datedevaluation', 'asof', 'miseajour', 'valuationdate'), (x) => x === 'date',
      (x) => x.includes('date') && !/achat|purchase|acquisition|ouverture|echeance|maturity/.test(x));
    cols.institution = find(has('institution', 'courtier', 'broker', 'banque', 'firme', 'plateforme', 'gestionnaire'));
    return cols;
  }

  /** Broker exports often start with a few lines of account info: find the header row. */
  function findHeaderRow(rows) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const c = detectHoldingColumns(rows[i] || []);
      const score = Object.values(c).filter((x) => x >= 0).length + (c.qty >= 0 || c.value >= 0 ? 1 : 0);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  const ACCOUNT_RULES = [
    [/celiapp|fhsa|premiereproprie/, 'CELIAPP'],
    [/celi|tfsa/, 'CELI'],
    [/reee|resp/, 'REEE'],
    [/ferr|rrif/, 'FERR'],
    [/cri|frv|lira|lif|immobilise/, 'CRI / FRV'],
    [/reer|rrsp|rrs|ricd/, 'REER'],
    [/nonenreg|nonreg|margin|marge|comptant|cashaccount|individuel|individual|personnel|personal|joint/, 'Non enregistré'],
    [/societe|corpo|compagnie|entreprise|inc$|ltee|holding|business/, 'Société'],
  ];
  function mapAccount(raw) {
    const x = plain(raw);
    if (!x) return null;
    for (const [re, name] of ACCOUNT_RULES) if (re.test(x)) return name;
    return 'Autre';
  }

  function mapMarket(raw) {
    const x = plain(raw);
    if (!x) return null;
    if (/^(tsxv|v|cdnx|venture|tsxventure|croissance|tsxcroissance)$/.test(x)) return 'TSXV';
    if (/^(neo|ne|cboe|cboecanada|aequitas|neoexchange)$/.test(x)) return 'NEO';
    if (/^(tsx|tse|to|xtse|tor|toronto|boursedetoronto|torontostockexchange|canada|can|ca)$/.test(x)) return 'TSX';
    if (/^(nyse|nasdaq|us|usa|eu|etatsunis|arca|nysearca|bats|amex|nysemkt|nysemarket|nasdaqgs|nasdaqgm|nasdaqcm|otc)$/.test(x)) return 'US';
    return null;
  }

  /** Splits "XEQT.TO", "TSX:XEQT", "BAM-A.TO" into the app's symbol and market. */
  function splitSymbol(raw) {
    let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    let market = null;
    let m = s.match(/^([A-Z]+):(.+)$/);
    if (m) { market = mapMarket(m[1]); s = m[2]; }
    m = s.match(/^(.+)\.(TO|TSX|V|VN|NE|NEO|US|CN)$/);
    if (m) {
      s = m[1];
      market = { TO: 'TSX', TSX: 'TSX', V: 'TSXV', VN: 'TSXV', NE: 'NEO', NEO: 'NEO', US: 'US', CN: 'CSE' }[m[2]];
    }
    m = s.match(/^(.+)-(T|CT)$/); // some banks write XEQT-T for Toronto
    if (m && !market) { s = m[1]; market = 'TSX'; }
    return { symbol: s.replace(/-/g, '.'), market };
  }

  const CASH_WORDS = /^(cash|encaisse|especes|liquidites|liquidite|argentcomptant|soldecomptant|soldedetresorerie|cad|usd|cad\$|usd\$|cashcad|cashusd|comptant)$/;
  const TOTAL_ROW = /^(total|soustotal|grandtotal|totaux|sommaire|summary)/;
  const r4 = (x) => Math.round(x * 10000) / 10000;

  function excelDate(raw) {
    const n = Number(raw);
    if (!/^\d{5}(\.\d+)?$/.test(String(raw).trim()) || n < 20000 || n > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }

  /**
   * rows: the sheet; header: index of the header row; cols: from detectHoldingColumns.
   * opts: { kind: 'public' | 'private', owner, account, market, date, ownerNames: { p1, p2 } }
   * Returns one candidate per data row: { ok, reason, row: {…holding fields} , line }.
   */
  function toHoldings(rows, header, cols, opts) {
    const out = [];
    const cell = (r, k) => (cols[k] >= 0 ? String(r[cols[k]] ?? '').trim() : '');
    const amt = (r, k) => (cols[k] >= 0 ? parseAmount(r[cols[k]]) : null);
    const body = rows.slice(header + 1);
    const parseDate = dateParserFor(body.map((r) => cell(r, 'date')));
    const names = opts.ownerNames || {};
    const mapOwner = (raw) => {
      const x = plain(raw);
      if (!x) return null;
      if (x === plain(names.p1) || x === 'p1' || x === 'personne1') return 'p1';
      if (x === plain(names.p2) || x === 'p2' || x === 'personne2') return 'p2';
      if (/^(commun|joint|conjoint|lesdeux|both|nous)$/.test(x)) return 'joint';
      return null;
    };
    body.forEach((r, i) => {
      const line = header + i + 2;
      const sym = cell(r, 'symbol'), name = cell(r, 'name');
      if (!r.some((c) => String(c ?? '').trim())) return;
      if (TOTAL_ROW.test(plain(sym || name)) || (!sym && !name && TOTAL_ROW.test(plain(r.find((c) => String(c).trim()) || '')))) return;
      const qtyIn = amt(r, 'qty'), avg = amt(r, 'avg_cost'), book = amt(r, 'book_value'), price = amt(r, 'price'), value = amt(r, 'value');
      const curRaw = plain(cell(r, 'currency'));
      let currency = /usd|^us\$?$|americain/.test(curRaw) ? 'USD' : /cad|^can|canadien/.test(curRaw) ? 'CAD' : null;
      const fileAccount = mapAccount(cell(r, 'account')), fileOwner = mapOwner(cell(r, 'owner'));
      const account = fileAccount || opts.account;
      const owner = fileOwner || opts.owner;
      const institution = cell(r, 'institution') || null;
      const base = { account, owner, institution };
      const push = (c) => out.push(c.ok ? { ...c, given: { account: !!fileAccount, owner: !!fileOwner } } : c);
      const label = name || sym;
      if (opts.kind === 'public') {
        if (CASH_WORDS.test(plain(sym)) || (!sym && CASH_WORDS.test(plain(name)))) {
          const amount = value ?? qtyIn;
          if (amount === null) return push({ ok: false, line, label: label || 'Cash', reason: 'Missing amount' });
          if (!currency && /usd/.test(plain(sym || name))) currency = 'USD';
          const cur = currency || 'CAD';
          return push({ ok: true, line, label: 'Cash ' + cur, row: { ...base, market: 'CASH', symbol: cur, currency: cur, name: 'Encaisse', qty: r4(Math.max(0, amount)), avg_cost: null } });
        }
        if (!sym) return push({ ok: false, line, label: label || `Row ${line}`, reason: 'Missing symbol' });
        const sp = splitSymbol(sym);
        let market = mapMarket(cell(r, 'market')) || sp.market;
        if (market === 'CSE') return push({ ok: false, line, label: sp.symbol, reason: 'Canadian Securities Exchange (CSE): add it as a private investment' });
        if (!market) market = currency === 'USD' ? 'US' : opts.market || 'TSX';
        let qty = qtyIn;
        if (qty === null && value !== null && price) qty = value / price;
        if (qty === null || !(qty > 0)) return push({ ok: false, line, label: sp.symbol, reason: 'Missing or zero quantity' });
        const avgCost = avg !== null ? avg : book !== null ? book / qty : null;
        return push({ ok: true, line, label: sp.symbol, row: { ...base, market, symbol: sp.symbol, currency: market === 'US' ? 'USD' : 'CAD', name: name && name !== sym ? name : null, qty: r4(qty), avg_cost: avgCost === null ? null : r4(Math.abs(avgCost)) } });
      }
      // Private: valued by hand. A single value is stored as 1 unit at that price.
      if (!label) return push({ ok: false, line, label: `Row ${line}`, reason: 'Missing name' });
      let qty = qtyIn, px = price;
      if (value !== null && (qty === null || qty <= 0) && px === null) { qty = 1; px = value; }
      else if (value !== null && qty > 0 && px === null) px = value / qty;
      else if (px !== null && (qty === null || qty <= 0)) { qty = value !== null && px ? value / px : 1; }
      if (px === null || qty === null || !(qty > 0)) return push({ ok: false, line, label, reason: 'Missing value' });
      const avgCost = avg !== null ? avg : book !== null ? book / qty : null;
      const rawDate = cell(r, 'date');
      const date = excelDate(rawDate) || parseDate(rawDate) || opts.date || null;
      return push({ ok: true, line, label, row: { ...base, market: 'MANUAL', symbol: (sym || name).toUpperCase().slice(0, 40), currency: currency || 'CAD', name: name || null, qty: r4(qty), avg_cost: avgCost === null ? null : r4(Math.abs(avgCost)), manual_price: r4(px), manual_price_date: date } });
    });
    return out;
  }

  /** What the holding is, regardless of account and owner. */
  function holdingIdentity(hd) {
    if (hd.market === 'CASH') return `cash:${hd.currency || 'CAD'}`;
    if (hd.market === 'MANUAL') return `priv:${plain(hd.name) || plain(hd.symbol)}`;
    return `pub:${String(hd.symbol || '').toUpperCase()}`;
  }
  /** Identity of a holding inside its account: same title, same account, same owner. */
  const holdingKey = (hd) => `${holdingIdentity(hd)}|${hd.account || ''}|${hd.owner || ''}`;
  const asNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const near = (a, b) => {
    const x = asNum(a), y = asNum(b);
    return x === null || y === null ? x === y : Math.abs(x - y) < 1e-6;
  };

  /**
   * Compares the file with what is saved. Same title in several lines is merged (lots of the same ETF).
   * existing: the saved holdings of this section (public or private).
   * Returns { items: [{ key, row, match, status: 'new' | 'update' | 'same' }], missing: [holding] }.
   * "missing" only covers accounts and owners that appear in the file, so importing one account leaves the others alone.
   */
  function planSync(candidates, existing) {
    const merged = new Map();
    for (const c of candidates) {
      if (!c.ok) continue;
      const k = holdingKey(c.row);
      const prev = merged.get(k);
      if (!prev) { merged.set(k, { row: { ...c.row }, given: c.given || { account: true, owner: true } }); continue; }
      const a = prev.row, q = a.qty + c.row.qty;
      if (a.avg_cost !== null && c.row.avg_cost !== null) a.avg_cost = r4((a.avg_cost * a.qty + c.row.avg_cost * c.row.qty) / q);
      if (a.market === 'MANUAL') a.manual_price = r4((a.manual_price * a.qty + c.row.manual_price * c.row.qty) / q);
      a.qty = r4(q);
    }
    const matched = new Set();
    const free = (hd) => !matched.has(hd.id);
    // Exact match first; then, when the file did not say whose or which account it is,
    // the one saved holding of that title (never a guess between two).
    const findMatch = (row, given) => {
      const id = holdingIdentity(row);
      const same = existing.filter((hd) => free(hd) && holdingIdentity(hd) === id);
      const exact = same.find((hd) => hd.account === row.account && hd.owner === row.owner);
      if (exact) return exact;
      const loose = same.filter((hd) => (given.account ? hd.account === row.account : true) && (given.owner ? hd.owner === row.owner : true));
      return loose.length === 1 ? loose[0] : null;
    };
    const items = [];
    for (const [key, { row, given }] of merged) {
      const match = findMatch(row, given);
      let status = 'new';
      if (match) {
        matched.add(match.id);
        row.account = match.account; // an update never moves a holding to another account or owner
        row.owner = match.owner;
        const same = near(match.qty, row.qty) && (row.avg_cost === null || near(match.avg_cost, row.avg_cost))
          && (row.market !== 'MANUAL' || (near(match.manual_price, row.manual_price) && (!row.manual_price_date || match.manual_price_date === row.manual_price_date)));
        status = same ? 'same' : 'update';
      }
      items.push({ key, row, match, status });
    }
    const scope = new Set(items.map((it) => `${it.row.account}|${it.row.owner}`));
    const missing = existing.filter((hd) => free(hd) && scope.has(`${hd.account}|${hd.owner}`));
    return { items, missing };
  }

  // ===========================================================================
  // PDF statements (read locally). A small PDF text reader, enough for bank
  // statements: Flate streams, object streams, ToUnicode maps, form XObjects.
  // Not handled: encrypted PDFs and scanned images (no text to read).
  // ===========================================================================
  const bin = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; };
  const binBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  async function inflate(bytes) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  function ascii85(bytes) {
    const t = bin(bytes).replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
    const out = [];
    for (let i = 0; i < t.length;) {
      if (t[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
      const chunk = t.slice(i, i + 5); i += 5;
      const padded = chunk.padEnd(5, 'u');
      let v = 0;
      for (const ch of padded) v = v * 85 + (ch.charCodeAt(0) - 33);
      const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      out.push(...b.slice(0, chunk.length - 1));
    }
    return new Uint8Array(out);
  }

  const WS = /[\0\t\n\f\r ]/;
  const DELIM = /[()<>[\]{}/%]/;
  /** Parses one PDF object at s[p]. Names come back as '/Name', strings as { s }, references as { ref }. */
  function pdfValue(s, p) {
    const skip = () => { for (;;) { while (p < s.length && WS.test(s[p])) p++; if (s[p] !== '%') return; while (p < s.length && s[p] !== '\n' && s[p] !== '\r') p++; } };
    function val() {
      skip();
      const c = s[p];
      if (c === '<' && s[p + 1] === '<') {
        p += 2; const d = {};
        for (;;) { skip(); if (s[p] === '>' && s[p + 1] === '>') { p += 2; return d; } if (p >= s.length) return d; const k = val(); const v = val(); if (typeof k === 'string') d[k.slice(1)] = v; }
      }
      if (c === '[') { p++; const a = []; for (;;) { skip(); if (s[p] === ']') { p++; return a; } if (p >= s.length) return a; a.push(val()); } }
      if (c === '(') { const r = pdfString(s, p); p = r.end; return { s: r.str }; }
      if (c === '<') { const e = s.indexOf('>', p); const hex = s.slice(p + 1, e).replace(/[^0-9a-f]/gi, ''); p = e + 1; return { s: hexStr(hex) }; }
      if (c === '/') { let e = p + 1; while (e < s.length && !WS.test(s[e]) && !DELIM.test(s[e])) e++; const n = s.slice(p, e); p = e; return n; }
      let e = p; while (e < s.length && !WS.test(s[e]) && !DELIM.test(s[e])) e++;
      const tok = s.slice(p, e); p = e > p ? e : p + 1;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
        const m = /^\s*(\d+)\s+R(?![^\0\t\n\f\r ()<>[\]{}/%])/.exec(s.slice(p, p + 24));
        if (/^\d+$/.test(tok) && m) { p += m[0].length; return { ref: Number(tok) }; }
        return Number(tok);
      }
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      return null;
    }
    const v = val();
    return { v, end: p };
  }
  const hexStr = (hex) => { if (hex.length % 2) hex += '0'; let o = ''; for (let i = 0; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.substr(i, 2), 16)); return o; };
  /** Literal string starting at s[p] === '('; returns its bytes as a binary string. */
  function pdfString(s, p) {
    let depth = 0, out = '';
    for (let i = p; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        const n = s[++i];
        const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n];
        if (esc) out += esc;
        else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; out += String.fromCharCode(parseInt(o, 8) & 255); }
        else if (n === '\r') { if (s[i + 1] === '\n') i++; }
        else if (n !== '\n') out += n;
      } else if (c === '(') { if (depth++) out += c; }
      else if (c === ')') { if (--depth === 0) return { str: out, end: i + 1 }; out += c; }
      else out += c;
    }
    return { str: out, end: s.length };
  }

  // Statements are often "protected" with an empty open password (they open without asking,
  // but printing or copying is restricted): the content is encrypted with a key anyone can derive.
  // Standard security handler, revisions 2 to 6 (RC4, AES-128, AES-256), empty password only.
  function md5(bytes) {
    const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
    const n = bytes.length, total = ((n + 8) >> 6) + 1, w = new Uint32Array(total * 16);
    for (let i = 0; i < n; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
    w[n >> 2] |= 0x80 << ((n % 4) * 8);
    w[total * 16 - 2] = (n * 8) >>> 0; w[total * 16 - 1] = Math.floor(n / 0x20000000);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let blk = 0; blk < total * 16; blk += 16) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const tmp = d; d = c; c = b;
        const x = (a + f + K[i] + w[blk + g]) >>> 0, sh = S[(i >> 4) * 4 + (i % 4)];
        b = (b + ((x << sh) | (x >>> (32 - sh)))) >>> 0; a = tmp;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((v, i) => { for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (8 * k)) & 255; });
    return out;
  }
  function rc4(key, data) {
    const s = new Uint8Array(256), out = new Uint8Array(data.length);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return out;
  }
  const cat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
  async function aesDecrypt(key, iv, data, padded = true) {
    const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
    if (!padded) { // no padding in the data: add the block that PKCS#7 would expect
      const last = data.length >= 16 ? data.subarray(data.length - 16) : iv;
      data = cat(data, new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, k, new Uint8Array(0))));
    }
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, data));
  }
  async function aesEncryptRaw(key, iv, data) {
    const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
    return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data)).subarray(0, data.length);
  }
  const PAD = binBytes('\x28\xbf\x4e\x5e\x4e\x75\x8a\x41\x64\x00\x4e\x56\xff\xfa\x01\x08\x2e\x2e\x00\xb6\xd0\x68\x3e\x80\x2f\x0c\xa9\xfe\x64\x53\x69\x7a');
  /** Hash of revision 6 (ISO 32000-2, algorithm 2.B) for the empty user password. */
  async function hash6(salt) {
    let K = new Uint8Array(await subtle().digest('SHA-256', salt));
    for (let i = 0; ; i++) {
      const K1 = new Uint8Array(K.length * 64);
      for (let r = 0; r < 64; r++) K1.set(K, r * K.length);
      const E = await aesEncryptRaw(K.subarray(0, 16), K.subarray(16, 32), K1);
      let sum = 0; for (let j = 0; j < 16; j++) sum += E[j];
      K = new Uint8Array(await subtle().digest(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], E));
      if (i >= 63 && E[E.length - 1] <= i + 1 - 32) return K.subarray(0, 32);
    }
  }
  /** Returns a stream decryptor for the file, or throws 'pdf-encrypted' when a real password is needed. */
  async function pdfDecryptor(enc, id0) {
    if (!enc || enc.Filter !== '/Standard') throw new Error('pdf-encrypted');
    const R = enc.R || 2, V = enc.V || 0;
    const O = binBytes((enc.O || {}).s || ''), U = binBytes((enc.U || {}).s || '');
    const cf = enc.CF && enc.StmF && enc.CF[String(enc.StmF).slice(1)];
    const method = enc.StmF === '/Identity' ? 'none' : cf ? cf.CFM : V >= 4 ? '/V2' : '/V2';
    if (method === 'none') return async (data) => data;
    if (R >= 5) {
      if (!subtle()) throw new Error('pdf-encrypted');
      const vs = U.subarray(32, 40), ks = U.subarray(40, 48);
      const check = R === 5 ? new Uint8Array(await subtle().digest('SHA-256', vs)) : await hash6(vs);
      if (check.some((b, i) => b !== U[i])) throw new Error('pdf-encrypted');
      const ik = R === 5 ? new Uint8Array(await subtle().digest('SHA-256', ks)) : await hash6(ks);
      const key = await aesDecrypt(ik, new Uint8Array(16), binBytes((enc.UE || {}).s || ''), false);
      return async (data) => (data.length < 32 ? new Uint8Array(0) : aesDecrypt(key.subarray(0, 32), data.subarray(0, 16), data.subarray(16)));
    }
    const n = R === 2 ? 5 : (enc.Length || 40) / 8;
    const P = enc.P | 0;
    let key = md5(cat(PAD, O.subarray(0, 32), new Uint8Array([P & 255, (P >> 8) & 255, (P >> 16) & 255, (P >>> 24) & 255]), id0,
      R >= 4 && enc.EncryptMetadata === false ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0))).subarray(0, n);
    if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, n);
    // Check the key against U: a wrong key means the file needs a real password.
    let u;
    if (R === 2) u = rc4(key, PAD);
    else { u = rc4(key, md5(cat(PAD, id0))); for (let i = 1; i <= 19; i++) u = rc4(key.map((b) => b ^ i), u); }
    for (let i = 0; i < (R === 2 ? 32 : 16); i++) if (u[i] !== U[i]) throw new Error('pdf-encrypted');
    const aes = method === '/AESV2';
    if (aes && !subtle()) throw new Error('pdf-encrypted');
    return async (data, num, gen) => {
      const k = md5(cat(key, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]), aes ? binBytes('sAlT') : new Uint8Array(0))).subarray(0, Math.min(n + 5, 16));
      if (!aes) return rc4(k, data);
      return data.length < 32 ? new Uint8Array(0) : aesDecrypt(k, data.subarray(0, 16), data.subarray(16));
    };
  }

  /** Every object of the file: number → { v, data } (data: raw stream bytes, still encoded). */
  async function pdfObjects(bytes) {
    const s = bin(bytes);
    if (!s.startsWith('%PDF')) throw new Error('not-pdf');
    const objs = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const { v, end } = pdfValue(s, m.index + m[0].length);
      const o = { v, num: Number(m[1]), gen: Number(m[2]) };
      const sm = /^\s*stream\r?\n/.exec(s.slice(end, end + 12));
      if (sm && v && typeof v === 'object') {
        const start = end + sm[0].length;
        let stop = typeof v.Length === 'number' ? start + v.Length : -1;
        if (stop < 0 || s.slice(stop, stop + 12).indexOf('endstream') < 0) stop = s.indexOf('endstream', start);
        o.data = bytes.subarray(start, stop);
        re.lastIndex = stop;
      }
      objs.set(Number(m[1]), o);
    }
    // Encryption: the trailer (or the cross-reference stream) points to it.
    const tpos = s.lastIndexOf('trailer');
    const trailer = tpos >= 0 ? pdfValue(s, tpos + 7).v : null;
    const xref = [...objs.values()].map((o) => o.v).filter((v) => v && v.Type === '/XRef' && v.Encrypt).pop();
    const tr = trailer && trailer.Encrypt ? trailer : xref;
    if (tr) {
      const id = Array.isArray(tr.ID) && tr.ID[0] ? binBytes(tr.ID[0].s || '') : new Uint8Array(0);
      objs.decrypt = await pdfDecryptor(deref(tr.Encrypt, objs), id);
      objs.encryptRef = tr.Encrypt && tr.Encrypt.ref;
    }
    // Objects packed inside object streams.
    for (const o of [...objs.values()]) {
      if (!o.data || !o.v || o.v.Type !== '/ObjStm') continue;
      const raw = await pdfStream(o, objs);
      if (!raw) continue;
      const t = bin(raw);
      const nums = t.slice(0, o.v.First).trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) if (!objs.has(nums[i])) objs.set(nums[i], { v: pdfValue(t, o.v.First + nums[i + 1]).v });
    }
    return objs;
  }
  const deref = (v, objs) => { let n = 0; while (v && typeof v === 'object' && 'ref' in v && n++ < 20) v = (objs.get(v.ref) || {}).v; return v; };
  async function pdfStream(o, objs) {
    if (!o || !o.data) return null;
    let f = deref(o.v.Filter, objs);
    f = Array.isArray(f) ? f : f ? [f] : [];
    let data = o.data;
    const len = deref(o.v.Length, objs);
    if (typeof len === 'number' && len <= data.length) data = data.subarray(0, len);
    else { let e = data.length; while (e > 0 && (data[e - 1] === 10 || data[e - 1] === 13)) e--; data = data.subarray(0, e); }
    if (objs.decrypt && o.v.Type !== '/XRef' && o.num !== objs.encryptRef) {
      try { data = await objs.decrypt(data, o.num, o.gen); } catch (e) { return null; }
    }
    for (const name of f) {
      if (name === '/FlateDecode' || name === '/Fl') data = await inflate(data);
      else if (name === '/ASCII85Decode' || name === '/A85') data = ascii85(data);
      else return null; // images and other encodings: not needed for text
      if (!data) return null;
    }
    return data;
  }

  /** ToUnicode CMap → { map: code → text, bytes: code length }. */
  function parseCMap(t) {
    const map = new Map();
    let bytes = 1;
    const cs = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(t);
    if (cs) bytes = Math.max(1, cs[1].length / 2);
    const utf16 = (hex) => { let o = ''; for (let i = 0; i + 3 < hex.length; i += 4) o += String.fromCharCode(parseInt(hex.substr(i, 4), 16)); return hex.length === 2 ? String.fromCharCode(parseInt(hex, 16)) : o; };
    for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) map.set(parseInt(m[1], 16), utf16(m[2]));
    }
    for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
        const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
        if (hi - lo > 65535) continue;
        if (m[3][0] === '[') {
          const list = [...m[3].matchAll(/<([0-9a-f]*)>/gi)].map((x) => utf16(x[1]));
          for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
        } else {
          const hex = m[3].slice(1, -1);
          const base = parseInt(hex.slice(-4), 16), prefix = utf16(hex.slice(0, -4));
          for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(base + c - lo));
        }
      }
    }
    return { map, bytes };
  }
  const WIN = { 128: '€', 130: '‚', 132: '„', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—', 153: '™', 156: 'œ' };
  const MAC = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
  const ACCENTS = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', dieresis: '\u0308', tilde: '\u0303', cedilla: '\u0327', ring: '\u030a', caron: '\u030c' };
  const GLYPHS = { space: ' ', quoteright: '’', quoteleft: '‘', quotesingle: "'", quotedbl: '"', quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—', hyphen: '-', minus: '-',
    bullet: '•', ellipsis: '…', Euro: '€', registered: '®', copyright: '©', trademark: '™', degree: '°', section: '§', guillemotleft: '«', guillemotright: '»', germandbls: 'ß',
    oe: 'œ', OE: 'Œ', ae: 'æ', AE: 'Æ', dollar: '$', percent: '%', ampersand: '&', parenleft: '(', parenright: ')', comma: ',', period: '.', colon: ':', semicolon: ';', slash: '/', at: '@',
    numbersign: '#', asterisk: '*', plus: '+', equal: '=', underscore: '_', nbspace: ' ', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  /** Unicode text of a glyph name (/eacute → é, /uni00E9 → é). */
  function glyphText(name) {
    const n = String(name).replace(/^\//, '');
    if (GLYPHS[n]) return GLYPHS[n];
    if (/^[A-Za-z]$/.test(n)) return n;
    let m = /^uni([0-9A-F]{4})$/i.exec(n);
    if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|cedilla|ring|caron)$/.exec(n);
    if (m) return (m[1] + ACCENTS[m[2]]).normalize('NFC');
    return '';
  }

  /** A font's text decoder and glyph widths: { dec(bytes) → text, width(bytes) → width at size 1, exact }. */
  async function fontDecoder(fontRef, objs, cache) {
    const key = fontRef && fontRef.ref;
    if (key && cache.has(key)) return cache.get(key);
    const f = deref(fontRef, objs) || {};
    const type0 = f.Subtype === '/Type0';
    const tu = f.ToUnicode && f.ToUnicode.ref ? objs.get(f.ToUnicode.ref) : null;
    const raw = tu ? await pdfStream(tu, objs) : null;
    const cm = raw ? parseCMap(bin(raw)) : null;
    const step = cm ? cm.bytes : type0 ? 2 : 1;
    const codes = (str) => { const out = []; for (let i = 0; i + step <= str.length; i += step) { let c = 0; for (let k = 0; k < step; k++) c = c * 256 + str.charCodeAt(i + k); out.push(c); } return out; };
    // Codes the ToUnicode map leaves out (often the accented letters): the font's encoding, else Windows-1252.
    const enc = deref(f.Encoding, objs);
    const base = typeof enc === 'string' ? enc : enc && enc.BaseEncoding;
    const diff = new Map();
    if (enc && Array.isArray(enc.Differences)) { let c = 0; for (const d of enc.Differences) { if (typeof d === 'number') c = d; else diff.set(c++, glyphText(d)); } }
    const fallback = (c) => {
      if (type0 || step > 1) return c >= 32 && c < 0xd800 ? String.fromCharCode(c) : '';
      if (diff.has(c)) return diff.get(c);
      if (base === '/MacRomanEncoding' && c >= 128) return MAC[c - 128];
      return WIN[c] || (c >= 32 ? String.fromCharCode(c) : '');
    };
    const dec = (str) => codes(str).map((c) => (cm && cm.map.has(c) ? cm.map.get(c) : fallback(c))).join('');
    // Widths (thousandths of the font size), for where each piece of text ends.
    const widths = new Map();
    let dw = 500, exact = false;
    if (Array.isArray(deref(f.Widths, objs))) {
      const first = deref(f.FirstChar, objs) || 0;
      deref(f.Widths, objs).forEach((w, i) => { if (typeof w === 'number' && w > 0) widths.set(first + i, w); });
      exact = widths.size > 0;
    } else if (type0) {
      const d = deref((deref(f.DescendantFonts, objs) || [])[0], objs) || {};
      if (typeof d.DW === 'number') dw = d.DW;
      const W = deref(d.W, objs);
      if (Array.isArray(W)) {
        for (let i = 0; i < W.length;) {
          const c = W[i];
          const next = deref(W[i + 1], objs);
          if (Array.isArray(next)) { next.forEach((w, k) => widths.set(c + k, w)); i += 2; }
          else { for (let k = c; k <= next && k - c < 65536; k++) widths.set(k, W[i + 2]); i += 3; }
        }
      }
      exact = true;
    }
    const width = (str) => codes(str).reduce((a, c) => a + (widths.get(c) ?? dw), 0) / 1000;
    const font = { dec, width, exact };
    if (key) cache.set(key, font);
    return font;
  }

  /** Splits a content stream into operands and operators. */
  function* contentTokens(s) {
    let p = 0;
    const n = s.length;
    while (p < n) {
      const c = s[p];
      if (WS.test(c)) { p++; continue; }
      if (c === '%') { while (p < n && s[p] !== '\n' && s[p] !== '\r') p++; continue; }
      if (c === '(' ) { const r = pdfString(s, p); p = r.end; yield { t: 'str', v: r.str }; continue; }
      if (c === '<' && s[p + 1] !== '<') { const e = s.indexOf('>', p); yield { t: 'str', v: hexStr(s.slice(p + 1, e).replace(/[^0-9a-f]/gi, '')) }; p = e + 1; continue; }
      if (c === '<' || c === '>') { p += 2; yield { t: c === '<' ? 'dict(' : 'dict)' }; continue; }
      if (c === '[' || c === ']') { p++; yield { t: c }; continue; }
      if (c === '{' || c === '}' || c === ')') { p++; continue; }
      if (c === '/') { let e = p + 1; while (e < n && !WS.test(s[e]) && !DELIM.test(s[e])) e++; yield { t: 'name', v: s.slice(p, e) }; p = e; continue; }
      let e = p; while (e < n && !WS.test(s[e]) && !DELIM.test(s[e])) e++;
      const tok = s.slice(p, e); p = e;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) yield { t: 'num', v: Number(tok) };
      else if (tok === 'BI') { const ei = s.indexOf('EI', s.indexOf('ID', p)); p = ei < 0 ? n : ei + 2; }
      else yield { t: 'op', v: tok };
    }
  }
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

  /** Text pieces of one content stream: { x, y, size, str } in page coordinates. */
  async function runContent(data, resources, objs, ctx, ctm0, depth) {
    const out = [];
    const res = deref(resources, objs) || {};
    const fonts = deref(res.Font, objs) || {};
    const xobjs = deref(res.XObject, objs) || {};
    const s = bin(data);
    let ctm = ctm0, stack = [], tm = [1, 0, 0, 1, 0, 0], tlm = tm, lead = 0, size = 12, ops = [];
    let font = { dec: (x) => x, width: (x) => x.length * 0.5, exact: false };
    const show = (str) => {
      const text = font.dec(str);
      const adv = font.width(str) * size;
      const m = mul(tm, ctm);
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adv * tm[0], tm[5] + adv * tm[1]];
      if (!text || Math.abs(m[1]) > Math.abs(m[0])) return; // nothing to show, or vertical text (margin codes)
      const scale = Math.hypot(m[0], m[1]) || 1;
      out.push({ x: m[4], y: m[5], end: m[4] + adv * scale, size: size * (Math.hypot(m[2], m[3]) || 1), str: text, exact: font.exact });
    };
    let arr = null;
    for (const tk of contentTokens(s)) {
      if (tk.t === '[') { arr = []; continue; }
      if (tk.t === ']') { ops.push({ t: 'arr', v: arr || [] }); arr = null; continue; }
      if (arr) { arr.push(tk); continue; }
      if (tk.t !== 'op') { ops.push(tk); continue; }
      const num = (i) => (ops[ops.length - i] || {}).v || 0;
      switch (tk.v) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() || ctm0; break;
        case 'cm': ctm = mul([num(6), num(5), num(4), num(3), num(2), num(1)], ctm); break;
        case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': size = num(1); font = await fontDecoder(fonts[String((ops[ops.length - 2] || {}).v).slice(1)], objs, ctx.fonts); break;
        case 'TL': lead = num(1); break;
        case 'Td': tm = tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); break;
        case 'TD': lead = -num(1); tm = tlm = mul([1, 0, 0, 1, num(2), num(1)], tlm); break;
        case 'Tm': tm = tlm = [num(6), num(5), num(4), num(3), num(2), num(1)]; break;
        case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); break;
        case 'Tj': if (ops.length && ops[ops.length - 1].t === 'str') show(ops[ops.length - 1].v); break;
        case "'": tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); if (ops.length) show(ops[ops.length - 1].v || ''); break;
        case '"': tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); if (ops.length) show(ops[ops.length - 1].v || ''); break;
        case 'TJ': {
          const a = (ops[ops.length - 1] || {}).v || [];
          let buf = '';
          for (const el of a) {
            if (el.t === 'str') buf += el.v;
            else if (el.t === 'num' && el.v < -180 && buf) { show(buf); buf = ''; tm = [tm[0], tm[1], tm[2], tm[3], tm[4] - el.v / 1000 * size * tm[0], tm[5]]; }
          }
          if (buf) show(buf);
          break;
        }
        case 'Do': {
          const xo = xobjs[String((ops[ops.length - 1] || {}).v).slice(1)];
          const o = xo && xo.ref ? objs.get(xo.ref) : null;
          if (o && o.v && o.v.Subtype === '/Form' && depth < 5) {
            const d = await pdfStream(o, objs);
            const fm = Array.isArray(o.v.Matrix) ? o.v.Matrix : [1, 0, 0, 1, 0, 0];
            if (d) out.push(...await runContent(d, o.v.Resources || res, objs, ctx, mul(fm, ctm), depth + 1));
          }
          break;
        }
        default: break;
      }
      ops = [];
    }
    return out;
  }

  /** Reads a PDF. Returns its pages, each a list of text lines { y, text, items: [{ x, end, str }] }, top to bottom. */
  async function readPdfText(buffer) {
    const bytes = new Uint8Array(buffer);
    const objs = await pdfObjects(bytes);
    const ctx = { fonts: new Map() };
    const pages = [];
    const inherited = (page, key) => { let n = page, k = 0; while (n && k++ < 30) { if (n[key]) return n[key]; n = deref(n.Parent, objs); } return null; };
    const pageObjs = [];
    const root = [...objs.values()].map((o) => o.v).find((v) => v && v.Type === '/Catalog');
    const walk = (node, k = 0) => {
      node = deref(node, objs);
      if (!node || k > 50) return;
      if (node.Type === '/Page' || (!node.Kids && node.Contents)) pageObjs.push(node);
      else for (const kid of node.Kids || []) walk(kid, k + 1);
    };
    if (root) walk(root.Pages);
    if (!pageObjs.length) for (const o of objs.values()) if (o.v && o.v.Type === '/Page') pageObjs.push(o.v);
    for (const page of pageObjs) {
      let contents = deref(page.Contents, objs);
      const refs = Array.isArray(contents) ? contents : [page.Contents];
      const parts = [];
      for (const r of refs) { const d = await pdfStream(r && r.ref ? objs.get(r.ref) : null, objs); if (d) parts.push(bin(d)); }
      const items = await runContent(binBytes(parts.join('\n')), inherited(page, 'Resources'), objs, ctx, [1, 0, 0, 1, 0, 0], 0);
      pages.push(toLines(items));
    }
    return pages;
  }

  /** Groups text pieces into lines (same baseline), left to right. */
  function toLines(items) {
    const sorted = items.filter((it) => it.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const tol = Math.max(2, it.size * 0.35);
      let line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push({ x: it.x, end: it.end, str: it.str, exact: it.exact, size: it.size });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      // Join pieces of one word (an accent in another font, a kerned letter) when their widths are known.
      const merged = [];
      for (const it of l.items) {
        const last = merged[merged.length - 1];
        const gap = last ? it.x - last.end : Infinity;
        if (last && last.exact && it.exact && gap > -0.5 && gap < it.size * 0.12) { last.str += it.str; last.end = it.end; }
        else if (last && last.exact && it.exact && gap >= it.size * 0.12 && gap < it.size * 0.6 && !/\s$/.test(last.str) && !/^\s/.test(it.str)) { last.str += ' ' + it.str; last.end = it.end; }
        else merged.push({ ...it });
      }
      l.items = merged.map((i) => ({ x: i.x, end: i.end, str: i.str.trim() })).filter((i) => i.str);
      l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    }
    return lines;
  }

  // --- Statement lines → transactions ----------------------------------------
  const MONTHS = { jan: 1, janv: 1, january: 1, janvier: 1, feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, april: 4, avril: 4,
    may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, july: 7, juillet: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, september: 9, septembre: 9,
    oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12 };
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const MONTH_RE = '(janv(?:ier)?|f[ée]vr?(?:ier)?|mars?|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t?|sept?(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?|jan(?:uary)?|feb(?:ruary)?|march|apr(?:il)?|may|june?|july?|aug(?:ust)?|september|october|november|december)\\.?';
  const DATE_START = new RegExp(`^(?:(\\d{1,2})\\s+${MONTH_RE}|${MONTH_RE}\\s+(\\d{1,2})(?![\\d,]))(?:\\s+(20\\d\\d))?(?=[\\s,.)]|$)`, 'i');
  const NUM_DATE = /^(\d{4})-(\d{2})-(\d{2})\b|^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
  const AMOUNT = /^(?:-\s?)?\(?-?\$?\s?\d{1,3}(?:[ ,  ]\d{3})*[.,]\d{2}\s?\$?\)?(?:\s?(?:-|CR))?$/i;
  const SKIP = /opening balance|closing balance|balance forward|solde (?:d.ouverture|de cl[oô]ture|pr[ée]c[ée]dent|report[ée]|de fermeture|final)|previous (?:statement|account) balance|new balance|nouveau solde|minimum payment|paiement minimum|^total|\btotal\b.*\$|sous-total|subtotal/i;
  const monthOf = (word) => { const w = fold(word).replace(/\.$/, ''); return MONTHS[w] || MONTHS[w.slice(0, 4)] || MONTHS[w.slice(0, 3)] || null; };

  /** Latest full date written in the text (statement period end), as { y, m }. */
  function periodEnd(text) {
    let best = null;
    const consider = (y, m, d) => { if (!y || !m) return; const v = y * 10000 + m * 100 + (d || 0); if (!best || v > best.v) best = { y, m, v }; };
    for (const x of text.matchAll(new RegExp(`${MONTH_RE}\\s+(\\d{1,2}),?\\s+(20\\d\\d)`, 'gi'))) consider(Number(x[3]), monthOf(x[1]), Number(x[2]));
    for (const x of text.matchAll(new RegExp(`(\\d{1,2})(?:er)?\\s+${MONTH_RE}\\s+(20\\d\\d)`, 'gi'))) consider(Number(x[3]), monthOf(x[2]), Number(x[1]));
    for (const x of text.matchAll(/\b(20\d\d)-(\d{2})-(\d{2})\b/g)) consider(Number(x[1]), Number(x[2]), Number(x[3]));
    return best;
  }

  /**
   * Turns the lines of a statement into transactions { date, description, amount } (amount < 0: money out).
   * Works with the usual layouts: date, description, then one amount column (cards) or
   * withdrawals / deposits / balance columns (bank accounts), the columns found from their headings.
   */
  function statementTransactions(pages) {
    const all = pages.flat();
    const end = periodEnd(all.slice(0, 80).map((l) => l.text).join('\n')) || periodEnd(all.map((l) => l.text).join('\n'));
    const pad = (n) => String(n).padStart(2, '0');
    const center = (it) => (it.x + it.end) / 2;
    const find = (line, re) => line.items.find((i) => re.test(fold(i.str)));
    // Table headings: a bank account has withdrawals / deposits (/ balance) columns, a card one amount column.
    const OUT_H = /withdrawal|retrait|debit|cheques? (?:&|et) debits/, IN_H = /deposit|depot|credit/, BAL_H = /^balance|^solde/, AMT_H = /^montant|^amount/;
    const heading = (line) => {
      const o = find(line, OUT_H), i = find(line, IN_H), b = find(line, BAL_H), a = find(line, AMT_H);
      if (o && i && o !== i) {
        const right = Math.max(...[o, i, b].filter(Boolean).map((x) => x.end));
        return { bank: true, out: center(o), in: center(i), bal: b ? center(b) : null, right: right + 15 };
      }
      if (a && line.items.some((x) => /description|date/.test(fold(x.str)))) return { bank: false, amt: center(a), right: a.end + 15 };
      return null;
    };
    const tabled = all.some((l) => heading(l));
    const out = [];
    let table = null, lastDate = null, pending = '', prev = null;
    // Items of a line inside the table (leaves out side panels to the right of it).
    const inside = (line) => (table ? line.items.filter((i) => i.x < table.right) : line.items);
    const isAmount = (it) => {
      if (!AMOUNT.test(it.str.trim())) return false;
      if (!table) return true;
      const cs = table.bank ? [table.out, table.in, table.bal] : [table.amt];
      return cs.some((c) => c !== null && Math.abs(center(it) - c) < 45);
    };
    const amountAtEnd = (l) => { if (!l) return false; const its = inside(l); return its.length > 1 && isAmount(its[its.length - 1]); };
    for (let li = 0; li < all.length; li++) {
      const line = all[li];
      const h = heading(line);
      if (h) { table = h; pending = ''; continue; }
      if (tabled && !table) continue; // before the first table: account summary, addresses
      const items = inside(line);
      if (!items.length) continue;
      const t = fold(items.map((i) => i.str).join(' '));
      if (SKIP.test(t)) { pending = ''; prev = null; continue; }
      // Amounts at the end of the line.
      const amounts = [];
      while (items.length && isAmount(items[items.length - 1])) amounts.unshift(items.pop());
      let text = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').replace(/\s\$$/, '').trim();
      // Date at the start (one or two dates: transaction and posting).
      let date = null;
      const dm = DATE_START.exec(text);
      const nm = NUM_DATE.exec(text);
      if (dm) {
        const d = Number(dm[1] || dm[4]), m = monthOf(dm[2] || dm[3]);
        let y = dm[5] ? Number(dm[5]) : end ? end.y : new Date().getFullYear();
        if (!dm[5] && end && m > end.m) y -= 1;
        if (m && d >= 1 && d <= 31) date = `${y}-${pad(m)}-${pad(d)}`;
        text = text.slice(dm[0].length).trim();
        const second = DATE_START.exec(text);
        if (second && !second[5]) text = text.slice(second[0].length).trim();
      } else if (nm) {
        date = nm[1] ? `${nm[1]}-${nm[2]}-${nm[3]}` : `${nm[6].length === 2 ? '20' + nm[6] : nm[6]}-${pad(nm[4])}-${pad(nm[5])}`;
        text = text.slice(nm[0].length).trim();
      }
      if (!amounts.length) {
        if (!lastDate && !date) continue;
        if (text.length > 80 || /^\d{10,}$/.test(text)) continue; // footnotes, card reference numbers
        const next = all[li + 1];
        // A line with only words: the start of the next transaction when that one follows right away
        // without its own date, otherwise the end of the previous description.
        const nextText = next ? inside(next).map((i) => i.str).join(' ') : '';
        if (date) { lastDate = date; pending = text; prev = null; }
        else if (prev && !(amountAtEnd(next) && !DATE_START.test(nextText) && !NUM_DATE.test(nextText))) prev.description = (prev.description + ' ' + text).trim();
        else pending = (pending + ' ' + text).trim();
        continue;
      }
      if (!date && !lastDate) continue;
      if (date) lastDate = date;
      const description = (pending + ' ' + text).replace(/\s+/g, ' ').trim();
      pending = '';
      if (!description) continue;
      let amount = null;
      if (table && table.bank) {
        // Bank account: the amount in the withdrawals or deposits column; the balance is ignored.
        for (const a of amounts) {
          const c = center(a);
          const dist = (x) => (x === null || x === undefined ? Infinity : Math.abs(c - x));
          const v = Math.abs(parseAmount(a.str.replace(/CR$/i, '')) || 0);
          const near = Math.min(dist(table.out), dist(table.in), dist(table.bal));
          if (!v || near === dist(table.bal)) continue;
          amount = near === dist(table.out) ? -v : v;
          break;
        }
      } else {
        // Card: one amount; credits are negative, in parentheses or marked CR.
        const raw = amounts[0].str.trim();
        const v = parseAmount(raw.replace(/CR$/i, ''));
        if (v === null) continue;
        amount = v < 0 || /CR$/i.test(raw) ? Math.abs(v) : -Math.abs(v);
      }
      if (!amount) continue;
      prev = { date: lastDate, description, amount };
      out.push(prev);
    }
    return out;
  }

  /** PDF statement → rows in the same shape as a CSV file: [['Date', 'Description', 'Montant'], ...]. */
  async function readPdfStatement(buffer) {
    const pages = await readPdfText(buffer);
    const tx = statementTransactions(pages);
    return { rows: [['Date', 'Description', 'Montant'], ...tx.map((t) => [t.date, t.description, String(t.amount)])], count: tx.length, hasText: pages.some((p) => p.length > 3) };
  }

  const api = {
    parseCSV, detectColumns, parseAmount, dateParserFor, toTransactions, guessExpensesPositive, merchantKey, suggestCategory, analyze,
    readPdfText, statementTransactions, readPdfStatement, unzip, readXlsx, parseSheetXml, writeXlsx, sheetsCsvUrl, detectHoldingColumns, findHeaderRow, mapAccount, mapMarket, splitSymbol, toHoldings, holdingIdentity, holdingKey, planSync,
  };
  root.Importer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
