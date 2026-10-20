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
