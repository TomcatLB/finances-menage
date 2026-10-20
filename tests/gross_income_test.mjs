// Checks the after-tax estimate used for gross income in the Budget.
// Run from the repo root: node tests/gross_income_test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const Tax = require('../tax.js');

const zero = Tax.netIncome({});
assert.equal(zero.net, 0);
assert.equal(zero.rate, 0);

const salary = Tax.netIncome({ employment: 100000 });
assert.equal(salary.gross, 100000);
assert.ok(Math.abs(salary.net + salary.tax - 100000) < 1e-6);
assert.ok(salary.rate > 0.25 && salary.rate < 0.40, `rate ${salary.rate}`);
assert.equal(salary.tax, Tax.personalTax({ employment: 100000 }).total);

// Progressive: a higher income keeps a smaller share.
assert.ok(Tax.netIncome({ employment: 300000 }).rate > salary.rate);
// Self-employed pay both halves of QPP, so more contributions than an employee at the same income.
assert.ok(Tax.netIncome({ selfEmployed: 100000 }).tax > salary.tax);

console.log('gross income: OK');
