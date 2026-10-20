// Checks the PDF statement reader on made-up statements shaped like RBC's
// (tests/fixtures: English chequing on 2 pages, Visa, French chequing with an embedded font,
// and the Visa one encrypted the way banks do, with an empty open password).
// Run from the repo root: node tests/pdf_import_test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const I = require('../importer.js');
const read = async (name) => {
  const pages = await I.readPdfText(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  return I.statementTransactions(pages).map((t) => [t.date, t.description, t.amount]);
};

assert.deepEqual(await read('rbc-cheques-en.pdf'), [
  ['2025-11-24', 'Contactless Interac purchase - 1234 METRO 456', -87.45],
  ['2025-11-24', 'Payroll Deposit ACME INC', 2450],
  ['2025-12-01', 'Misc Payment HYDRO-QUEBEC', -142.1],
  ['2025-12-01', 'Monthly fee', -4],
  ['2025-12-01', 'e-Transfer sent J TREMBLAY Loyer décembre', -1100],
  ['2025-12-15', 'Online Banking payment - 5555 VIDEOTRON', -125],
]);

assert.deepEqual(await read('rbc-visa-en.pdf'), [
  ['2025-11-21', 'NETFLIX.COM 866-579-7172 ON', -20.99],
  ['2025-11-30', 'PAYMENT - THANK YOU / PAIEMENT - MERCI', 812.33],
  ['2025-12-02', 'IGA EXTRA #8123 MONTREAL QC', -156.2],
  ['2025-12-18', 'AMAZON.CA AMAZON.CA ON', -1034.5],
]);

// January statement: December dates belong to the year before.
assert.deepEqual(await read('rbc-cheques-fr.pdf'), [
  ['2025-12-29', 'Achat Interac sans contact - 9876 SAQ', -45.3],
  ['2026-01-05', 'Dépôt de paie EMPLOYEUR', 1980],
  ['2026-01-05', 'Paiement divers BELL CANADA', -98.77],
]);

// Same rows as a CSV file, ready for toTransactions.
const st = await I.readPdfStatement(readFileSync(new URL('./fixtures/rbc-visa-en.pdf', import.meta.url)));
assert.equal(st.count, 4);
assert.equal(I.toTransactions(st.rows, { date: 0, desc: [1], amount: 2, debit: -1, credit: -1 }, false).length, 4);

// Protected with an empty open password (opens without asking): RC4, AES-128 and AES-256 (revision 6).
const visa = await read('rbc-visa-en.pdf');
for (const alg of ['rc4-128', 'aes-128', 'aes-256']) assert.deepEqual(await read(`rbc-visa-${alg}.pdf`), visa, alg);
// A real password: refused with a clear error.
await assert.rejects(read('rbc-visa-real-password.pdf'), /pdf-encrypted/);

// Accented month abbreviations (« AOÛ ») right before a second date, card statement layout. Made-up lines.
const line = (...cells) => ({ text: cells.map((c) => c[1]).join(' '), items: cells.map(([x, str]) => ({ x, end: x + str.length * 5, str, y: 0, size: 9 })) });
assert.deepEqual(I.statementTransactions([[
  line([60, 'Relevé du 05 AOÛT au 04 SEPT 2026']),
  line([60, 'DATE'], [128, 'DESCRIPTION'], [320, 'MONTANT ($)']),
  line([60, '03 AOÛ'], [95, '05 AOÛ'], [128, 'ÉPICERIE DU COIN'], [320, '39,46 $']),
  line([60, '30 AOÛ'], [95, '01 SEPT'], [128, 'PAIEMENT - MERCI'], [320, '-500,00 $']),
]]).map((t) => [t.date, t.description, t.amount]), [
  ['2026-08-03', 'ÉPICERIE DU COIN', -39.46],
  ['2026-08-30', 'PAIEMENT - MERCI', 500],
]);

await assert.rejects(I.readPdfText(new TextEncoder().encode('not a pdf')), /not-pdf/);

console.log('PDF import: OK');
