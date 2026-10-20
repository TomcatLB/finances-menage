// Broker symbol formats in the portfolio import: Reuters suffixes (.O, .K, .N), _U units, fund codes.
// Run from the repo root: node tests/import_symbols_test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const I = require('../importer.js');

const split = (s) => I.splitSymbol(s);
assert.deepEqual(split('XEQT.TO'), { symbol: 'XEQT', market: 'TSX' });
assert.deepEqual(split('BAM-A.TO'), { symbol: 'BAM.A', market: 'TSX' });
assert.deepEqual(split('BAM.A'), { symbol: 'BAM.A', market: null });
assert.deepEqual(split('AMZN.O'), { symbol: 'AMZN', market: 'US' });
assert.deepEqual(split('GOOGL.OQ'), { symbol: 'GOOGL', market: 'US' });
assert.deepEqual(split('ARKK.K'), { symbol: 'ARKK', market: 'US' });
assert.deepEqual(split('BRK.B.N'), { symbol: 'BRK.B', market: 'US' });
assert.deepEqual(split('QETH_U'), { symbol: 'QETH.U', market: null });
assert.deepEqual(split('QETH-U.TO'), { symbol: 'QETH.U', market: 'TSX' });

const rows = [
  ['Compte', 'Symbole', 'Quantité', 'Coût moyen', 'Marché', 'Valeur marchande'],
  ['CELI', 'AMZN.O', '10', '150', 'TSX', '2500'],
  ['CELI', 'VFV', '20', '110', '', '3850'],
  ['CELI', 'QETH_U', '5', '20', '', '120'],
  ['REER', 'IXF903', '100', '10', '', '1200'],
  ['REER', 'OVB5ACC1', '1', '1000', '', '1050'],
];
const out = I.toHoldings(rows, 0, I.detectHoldingColumns(rows[0]), { kind: 'public', owner: 'p1', account: 'CELI', market: 'TSX' });
const bySym = Object.fromEntries(out.map((c) => [c.label, c]));

// The symbol's own suffix wins over a market column filled with a default.
assert.equal(bySym.AMZN.row.market, 'US');
assert.equal(bySym.AMZN.row.currency, 'USD');
assert.equal(bySym.VFV.row.market, 'TSX');
assert.equal(bySym.VFV.row.currency, 'CAD');
assert.equal(bySym['QETH.U'].row.market, 'TSX');
assert.equal(bySym['QETH.U'].row.currency, 'USD');
// Fund and note codes have no closing price: skipped here, with a pointer to private holdings.
for (const s of ['IXF903', 'OVB5ACC1']) {
  assert.equal(bySym[s].ok, false);
  assert.match(bySym[s].reason, /Placements privés/);
}

// The same sheet in the private import: listed titles already saved as public are skipped, the funds come in at market value.
const priv = I.toHoldings(rows, 0, I.detectHoldingColumns(rows[0]), { kind: 'private', owner: 'p1', account: 'CELI', publicSymbols: new Set(['AMZN', 'VFV', 'QETH.U']) });
assert.deepEqual(priv.filter((c) => c.ok).map((c) => c.row.symbol), ['IXF903', 'OVB5ACC1']);
assert.equal(priv.find((c) => c.label === 'IXF903').row.qty * priv.find((c) => c.label === 'IXF903').row.manual_price, 1200);
assert.ok(priv.filter((c) => !c.ok).every((c) => c.reason === 'Déjà dans Placements publics'));

console.log('Import symbol formats OK');

// A "live portfolio" workbook (made-up numbers): no account or date column, USD values converted to CAD in the sheet,
// funds, crypto and a partnership mixed with listed titles, notes under the total.
{
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(new URL('./fixtures/live_portfolio_sample.xlsx', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const [sheet] = await I.readXlsx(ab);
  // Saved 2026-10-15 15:00 UTC: the same day in Québec.
  process.env.TZ = 'America/Toronto';
  assert.equal(await I.xlsxSavedDate(ab), '2026-10-15');
  const header = I.findHeaderRow(sheet.rows);
  assert.equal(I.asOfDate(sheet.rows, header), null);
  const cols = I.detectHoldingColumns(sheet.rows[header]);
  const pub = I.toHoldings(sheet.rows, header, cols, { kind: 'public', owner: 'p1', account: 'Non enregistré', market: 'TSX' });
  const ok = pub.filter((c) => c.ok).map((c) => `${c.row.symbol}:${c.row.market}:${c.row.currency}`);
  assert.deepEqual(ok, ['XEQT:TSX:CAD', 'AAPL:US:USD', 'QETH.U:TSX:USD']);
  const reasons = Object.fromEntries(pub.filter((c) => !c.ok).map((c) => [c.label, c.reason]));
  assert.match(reasons.CASH, /Dettes/);
  assert.match(reasons.BTC, /Cryptomonnaie/);
  assert.match(reasons.FUNDA1, /Placements privés/);
  assert.equal(Object.keys(reasons).length, 6); // cash, 2 funds, crypto, partnership (no units), note (no symbol); nothing under the total

  const priv = I.toHoldings(sheet.rows, header, cols, { kind: 'private', owner: 'p1', account: 'Non enregistré', date: '2026-10-15',
    publicSymbols: new Set(['XEQT', 'AAPL', 'QETH.U']) });
  const got = Object.fromEntries(priv.filter((c) => c.ok).map((c) => [c.row.name, c.row]));
  assert.deepEqual(Object.keys(got), ['SAMPLE USD FUND LP', 'SAMPLE CAD FUND', 'BITCOIN', 'SAMPLE PARTNERSHIP', 'SAMPLE NOTE']);
  // Value 2100 = 10 × 150 × 1.4: kept as a USD price so the daily rate applies.
  assert.deepEqual([got['SAMPLE USD FUND LP'].currency, got['SAMPLE USD FUND LP'].manual_price, got['SAMPLE USD FUND LP'].avg_cost], ['USD', 150, 100]);
  assert.deepEqual([got.BITCOIN.currency, got.BITCOIN.manual_price], ['USD', 100000]);
  assert.deepEqual([got['SAMPLE CAD FUND'].currency, got['SAMPLE CAD FUND'].manual_price], ['CAD', 12]);
  // A partnership with only a book and a market value: one unit at that value, even if its symbol is a listed title.
  assert.deepEqual([got['SAMPLE PARTNERSHIP'].qty, got['SAMPLE PARTNERSHIP'].manual_price, got['SAMPLE PARTNERSHIP'].avg_cost], [1, 8000, 5000]);
  assert.ok(Object.values(got).every((r) => r.manual_price_date === '2026-10-15'));
}

// "As of" written above the table, in the same cell or the next one.
assert.equal(I.asOfDate([['LIVE PORTFOLIO', '', 'As of', '09-22-2026'], ['Symbol', 'Units']], 1), '2026-09-22');
assert.equal(I.asOfDate([['Date', 'Symbol'], ['2026-10-01', 'XEQT']], 0), null); // a column title, not a date above the table
assert.equal(I.asOfDate([['En date du : 2026-10-20'], ['Symbole', 'Quantité']], 1), '2026-10-20');
assert.equal(I.asOfDate([['As of', '46315'], ['Symbol', 'Units']], 1), '2026-10-20');

console.log('Live portfolio workbook OK');
