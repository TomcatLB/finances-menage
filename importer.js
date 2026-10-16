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
          if (amount === null) return push({ ok: false, line, label: label || 'Encaisse', reason: 'Montant manquant' });
          if (!currency && /usd/.test(plain(sym || name))) currency = 'USD';
          const cur = currency || 'CAD';
          return push({ ok: true, line, label: 'Encaisse ' + cur, row: { ...base, market: 'CASH', symbol: cur, currency: cur, name: 'Encaisse', qty: r4(Math.max(0, amount)), avg_cost: null } });
        }
        if (!sym) return push({ ok: false, line, label: label || `Ligne ${line}`, reason: 'Symbole manquant' });
        const sp = splitSymbol(sym);
        let market = mapMarket(cell(r, 'market')) || sp.market;
        if (market === 'CSE') return push({ ok: false, line, label: sp.symbol, reason: 'Bourse des valeurs canadiennes (CSE) : ajoute-le comme placement privé' });
        if (!market) market = currency === 'USD' ? 'US' : opts.market || 'TSX';
        let qty = qtyIn;
        if (qty === null && value !== null && price) qty = value / price;
        if (qty === null || !(qty > 0)) return push({ ok: false, line, label: sp.symbol, reason: 'Quantité manquante ou nulle' });
        const avgCost = avg !== null ? avg : book !== null ? book / qty : null;
        return push({ ok: true, line, label: sp.symbol, row: { ...base, market, symbol: sp.symbol, currency: market === 'US' ? 'USD' : 'CAD', name: name && name !== sym ? name : null, qty: r4(qty), avg_cost: avgCost === null ? null : r4(Math.abs(avgCost)) } });
      }
      // Private: valued by hand. A single value is stored as 1 unit at that price.
      if (!label) return push({ ok: false, line, label: `Ligne ${line}`, reason: 'Nom manquant' });
      let qty = qtyIn, px = price;
      if (value !== null && (qty === null || qty <= 0) && px === null) { qty = 1; px = value; }
      else if (value !== null && qty > 0 && px === null) px = value / qty;
      else if (px !== null && (qty === null || qty <= 0)) { qty = value !== null && px ? value / px : 1; }
      if (px === null || qty === null || !(qty > 0)) return push({ ok: false, line, label, reason: 'Valeur manquante' });
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

  const api = {
    parseCSV, detectColumns, parseAmount, dateParserFor, toTransactions, guessExpensesPositive, merchantKey, suggestCategory, analyze,
    unzip, readXlsx, parseSheetXml, writeXlsx, sheetsCsvUrl, detectHoldingColumns, findHeaderRow, mapAccount, mapMarket, splitSymbol, toHoldings, holdingIdentity, holdingKey, planSync,
  };
  root.Importer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
