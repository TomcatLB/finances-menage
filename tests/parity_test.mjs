// Checks that the web page (calc.js) and the daily job (update_prices.py)
// compute the same net-worth snapshot, and spot-checks the debt maths.
// Run from the repo root: node tests/parity_test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Calc = require('../calc.js');
const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));

const js = Calc.snapshotData(sample);
const py = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, 'scripts')
from update_prices import snapshot_data
print(json.dumps(snapshot_data(json.load(open('tests/sample.json')))))
`], { encoding: 'utf8' }));

assert.deepEqual(js, py, 'calc.js and update_prices.py disagree');
console.log('Snapshot parity OK:', JSON.stringify(js.all));

// Hand-computed household total.
const fx = 1.4263;
const inv = 120.5 * 45.62 + 40 * 160.1 + 12 * 342 * fx + 30 * 50 /* BAM.A unpriced → cost */
  + 500 * 11.37 + 0.1 * 60000 * fx /* manual, no price → cost */ + 1520.33 + 200 * fx;
const close = (a, b) => Math.abs(a - b) < 0.011;
assert.ok(close(js.all.net, inv + 650000 + 18000 - 412345.67 - 3200), 'household net');
// Joint split: p1 gets XEQT, BAM.A, crypto, half of AAPL / CAD cash / USD cash (owner null = joint), half house & mortgage, the line of credit.
const p1inv = 120.5 * 45.62 + 30 * 50 + 0.1 * 60000 * fx + 0.5 * (12 * 342 * fx + 1520.33 + 200 * fx);
assert.ok(close(js.p1.inv, p1inv), 'p1 investments');
assert.ok(close(js.p1.net + js.p2.net, js.all.net), 'p1 + p2 should equal the household');
console.log('Hand-checked totals OK');

// Margin: negative cash lowers investments the same way on both sides.
{
  const margin = { ...sample, holdings: [...sample.holdings, { symbol: 'CAD', market: 'CASH', currency: 'CAD', qty: -15000, avg_cost: null, owner: 'p1' }] };
  const jsM = Calc.snapshotData(margin);
  const pyM = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, 'scripts')
from update_prices import snapshot_data
print(json.dumps(snapshot_data(json.load(sys.stdin))))
`], { encoding: 'utf8', input: JSON.stringify(margin) }));
  assert.deepEqual(jsM, pyM, 'margin: calc.js and update_prices.py disagree');
  assert.ok(close(jsM.all.inv, js.all.inv - 15000) && close(jsM.p1.inv, js.p1.inv - 15000), 'margin lowers investments');
  console.log('Margin parity OK');
}

// Debt: 400 000 $ at 5 % fixed (semi-annual), monthly payment for 25 years.
// Standard Canadian formula gives about 2 326.42 $/month.
const mort = { kind: 'mortgage', rate_type: 'fixed', rate: 5, freq: 'monthly', balance: 400000, payment: 2326.42 };
const st = Calc.debtStats(mort, new Date('2026-10-15T12:00:00'));
assert.ok(Math.abs(st.periods - 300) < 0.1, `expected ~300 payments, got ${st.periods}`);
const i = Math.pow(1 + 0.05 / 2, 1 / 6) - 1;
const pmt = (400000 * i) / (1 - Math.pow(1 + i, -300));
assert.ok(Math.abs(pmt - 2326.42) < 0.01, `payment formula ${pmt}`);
assert.equal(Calc.debtStats({ ...mort, payment: 1000 }).covers, false);
assert.ok(Math.abs(Calc.monthly(1000, 'biweekly') - 2166.6667) < 0.001);
console.log('Debt maths OK (25-yr payment', pmt.toFixed(2), ')');
