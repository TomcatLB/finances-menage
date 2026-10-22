# Household finances (Finances du ménage)

Household finance dashboard for a couple in Québec. Static site (GitHub Pages) + Supabase (Postgres, auth, row-level security) + a weekday GitHub Action for closing prices and reminders.

## Layout
- `index.html`, `styles.css`, `app.js` — the whole UI, no build step, no framework. `app.js` renders with a small `h()` helper; each tab is a `render<Tab>()` function and each form an `open<Thing>()` built on `openForm()`. Tabs: Portfolio (public and private holdings, allocation, buys/sells and realized gains, CELI/REER room), Actifs, Budget, Enfants, Dettes, Projets, Compagnies, Projections.
- `calc.js` — pure formulas (valuation, net worth, debts/mortgage, REEE grant room, project projections). Shared by the page and the tests.
- `tax.js` — Québec + federal estimates: personal tax, QPP/QPIP/FSS, corporate tax, a company's year, salary-vs-dividends scenarios. All rates live in `PARAMS`; sources in `docs/taux-2026.md`.
- `projection.js` — yearly net-worth projection with retirement (RRQ, PSV) and a seeded Monte Carlo spread.
- `importer.js` — bank CSV and PDF statement parsing (RBC first; small built-in PDF text reader) and recurring-expense detection; portfolio import (small built-in .xlsx reader, Google Sheets CSV links, column detection, sync with saved holdings); `.xlsx` writer for the Excel export. No third-party spreadsheet library.
- `supabase/schema.sql` — idempotent: tables, `alter … add column if not exists` for upgrades, RLS limited to `allowed_users`.
- `scripts/update_prices.py` — daily job: Yahoo closes via yfinance, USD/CAD from Bank of Canada Valet, then a net-worth snapshot. `scripts/reminders.py` runs after it and keeps one GitHub issue labelled `rappels` (GitHub emails the owner).
- `.github/workflows/schema.yml` runs `schema.sql` on the database when it changes on main; `backup.yml` saves every table nightly as CSV in a `.7z` protected by the `BACKUP_PASSWORD` secret (Actions artifact, 90 days).
- `dev.html` + `dev/fake-supabase.js` — **test mode**: the real page with made-up data kept in the browser tab; it never loads `config.js`. Use it to try every change.
- `vendor/supabase-2.117.2.js` — the supabase-js UMD build, served from the site itself (not a CDN) so blockers or CDN outages can't stop the page. To upgrade, copy `dist/umd/supabase.js` from the npm package and update the `<script>` in `index.html`.
- `icons/`, `manifest.webmanifest` — home-screen icon (`python3 scripts/make_icons.py` redraws it; needs Pillow).

## Rules
- The snapshot formula exists twice (`calc.js` `snapshotData` and `update_prices.py` `snapshot_data`). Change both; `node tests/parity_test.mjs` must pass.
- A new table needs: the `create table` in `schema.sql`, the RLS loop at the bottom (and the `updated_at` trigger loop if it has that column), an entry in `OPTIONAL_TABLES` in `app.js` (so an older database still loads and shows the "schema à relancer" notice), and sample rows in `dev/fake-supabase.js`.
- A new column the page writes must not break an older database: only send it when it has a value, or when the loaded row already has the key (see `update_freq`, `asset_class` in `openHolding`).
- `index.html` and `dev.html` load the same scripts in the same order; change both.
- Every January: update `PARAMS` in `tax.js`, `tfsaLimit`/`rrspLimit`, PSV in `projection.js` DEFAULTS, and `docs/taux-2026.md` (rename for the year). Run `node tests/plan_test.mjs`.
- UI text is English (Canada). Money is CAD, formatted with `Intl` `en-CA`. Number inputs accept `1,234.56` and the French `4,59` (`parseNum`).
- Saved values stay in French: account names (`CELI`, `Non enregistré`…), budget and company categories, asset types. They are what the database, older rows and the importers use. Show them through `L()` / `LABELS` in `app.js`; a new saved value needs an English entry there. Don't rename them in the data.
- Importers must keep reading French and English input (RBC French statements, French column titles).
- Owners are `p1`, `p2`, `joint`; joint items count 50/50 in a person's view (`Calc.share`).
- Never put the Supabase secret key in the front end; `config.js` holds only the publishable key. Never commit real financial data.
- Fixed-rate mortgages compound semi-annually (Interest Act); other debts monthly.
- Tax and projection numbers are estimates: keep the footnotes that say what is not modelled.

## Checks
```
node --check app.js calc.js importer.js tax.js projection.js
node tests/parity_test.mjs
node tests/import_test.mjs
node tests/import_symbols_test.mjs
node tests/pdf_import_test.mjs
node tests/gross_income_test.mjs
node tests/plan_test.mjs
python3 -m unittest discover tests      # needs `pip install requests`
python3 -m http.server 8000             # then open http://localhost:8000/dev.html (test mode)
```
If the preview server cannot start because macOS blocks the folder (Desktop, Documents, Downloads are protected), keep the project in the home folder (e.g. `~/finances-menage`) or allow the Claude app under System Settings → Privacy & Security → Files and Folders.
