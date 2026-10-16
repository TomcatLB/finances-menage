# Finances du ménage

A private finance dashboard for a couple: **portfolio**, **net worth over time**, **budget** and **debts** (mortgage, lines of credit…), shared between two logins. Investment values update every weekday evening from the market close.

**Guide d'installation en français : [INSTALLATION.md](INSTALLATION.md).**

- **Web app**: plain HTML/JS hosted free on GitHub Pages (the interface is in French).
- **Data**: a free Supabase database. Only the two emails you list can log in and see anything.
- **Daily prices**: a GitHub Action fetches closing prices (Yahoo Finance) and the USD/CAD rate (Bank of Canada) after the market closes, then records that day's net worth for the chart.

No financial data is ever stored in this repository.

---

## Setup (about 20 minutes, once)

You need a free [Supabase](https://supabase.com) account and a GitHub account. Menu names in Supabase change from time to time; if a label below doesn't match exactly, look for the closest one.

### 1. Create the database

1. In Supabase, create a **new project** (any name, region *Canada (Central)* if offered, and save the database password somewhere safe).
2. Open `supabase/schema.sql` from this repo and **replace the two example emails** near the top with the two emails you'll log in with.
3. In Supabase, go to **SQL Editor → New query**, paste the whole file, and click **Run**. You should see "Success". Running it again is harmless, and it is how a new version of the app adds its tables: after pulling an update, run `schema.sql` again (keep your two emails in it).

### 2. Create the two logins

1. **Authentication → Sign In / Providers** (or *Providers → Email*): keep Email enabled, and **turn off "Allow new users to sign up"**. Nobody else can create an account.
2. **Authentication → Users → Add user → Create new user**: enter the first email and a password, and tick **Auto confirm user**. Repeat for the second person.

The emails must match the ones in `schema.sql`. To add or change someone later, run this in the SQL Editor:

```sql
insert into public.allowed_users (email) values (lower('new@example.com'));
```

### 3. Connect the web page to the database

1. In Supabase, open **Project Settings → API Keys** (older projects: **Settings → API**).
2. Copy the **Project URL** and the **publishable** key (older projects: the `anon` `public` key).
3. Edit `config.js` in this repo and paste them in. Commit the change.

Both values are designed to be public; the access rules from step 1 are what protect the data. **Never** put the *secret* / `service_role` key in `config.js`.

### 4. Turn on the website

1. In the GitHub repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch **main**, folder **/ (root)**, **Save**.
2. After a minute or two the site is at `https://<your-github-username>.github.io/<repo-name>/`. Bookmark it on both phones (Share → *Add to Home Screen* works well).

### 5. Turn on the daily price update

1. In Supabase, copy the **secret** key (older projects: `service_role`). This key bypasses the access rules, so it only goes in GitHub's encrypted secrets.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_KEY` = the secret key
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
4. Click **Update closing prices → Run workflow** once to test it. After your first holdings are entered, run it again so they get prices right away.

From then on it runs Monday–Friday at 22:30 UTC (18:30 in Montréal in summer, 17:30 in winter), after the 16:00 close. GitHub sometimes starts scheduled runs late; that's normal.

---

## Using it

| Tab | What goes in |
|---|---|
| **Portfolio** | Each ETF, stock or fund, per account (CELI, REER, CELIAPP, REEE…). Symbols go in **without** a suffix (`XEQT`, `VFV`, `AAPL`; class shares like `BAM.A`); pick the market. Mutual funds or crypto: choose *Prix entré à la main* and update the price yourself. Cash in a brokerage account: *Encaisse*. A holding can be **associated** with a child (its REEE) or a project, so it counts there automatically. |
| **Actifs** | The house, bank accounts, vehicles… with an estimated value. The net-worth chart fills in automatically, one point per trading day. |
| **Budget** | **Fixed expenses** (rent, Hydro, Internet, insurance…), **income**, and **variable envelopes** (travel, shopping, outings) with a monthly amount. Ad hoc spending is noted as it happens and compared to its envelope month by month. **Importer des relevés** reads RBC CSV exports (2–3 months), detects what comes back every month and proposes budget lines. Debt payments come from the Debts tab (toggle at the top). |
| **Enfants** | One card per child: recurring expenses (daycare, activities), one-off expenses (toys, clothes), and the **REEE**: contributions, SCEE and IQEE received, and how much to contribute this year to get the maximum basic grants. |
| **Dettes** | Mortgage (rate, term, amortization, prepayment privilege) plus lines of credit, car loans, cards. Shows interest per month, the balance at renewal, remaining amortization and a projected balance chart. Leave the mortgage payment empty to have it computed from the amortization. |
| **Projets** | A goal (cottage, renovation…) with a target amount and date: progress, whether you're on track, and the monthly amount needed. |

### Importing RBC statements

In RBC Online Banking, open the account or credit card, choose the period, then **Download / Export → CSV**. Import 2–3 months, one file per account. The file is read in the browser and never uploaded; only the lines you tick are saved. Credit-card files usually show purchases as positive amounts: tick the box the import shows for that file (it is pre-ticked when the file looks that way). Other banks' CSV files usually work too; if the columns aren't recognized, the import asks which column is which.

- **Ménage / person 1 / person 2** at the top switches the view. Items marked *Commun* count 50/50 in each person's view. Rename the two people in **Réglages**.
- New holdings show at cost (*au coût*) until the next price update.
- Changes made by one person appear for the other when they reload or come back to the page.

---

## Good to know

- **Price source.** `yfinance` reads Yahoo Finance's unofficial data. It is free and widely used, but Yahoo can change things without notice. If prices stop updating, the Actions run will show the error; usually updating the version in `scripts/requirements.txt` fixes it. The USD/CAD rate comes from the Bank of Canada's official Valet API.
- **GitHub pauses scheduled workflows** in public repos after 60 days without repository activity. GitHub emails a warning; re-enable it from the Actions tab, or make any small commit.
- **Supabase free projects pause** after a period of inactivity. The daily update counts as activity; if the project does get paused, restore it from the Supabase dashboard (the data is kept).
- **REEE grants.** The app uses the basic 2025 rules: SCEE 20 % (up to $500 a year, $1,000 with carry-forward, $7,200 lifetime) and IQEE 10 % (up to $250 a year, $500 with carry-forward, $3,600 lifetime), until the year the child turns 17. The income-tested extras (additional SCEE, IQEE supplement, Canada Learning Bond) aren't computed. Check the amounts each year on canada.ca and revenuquebec.ca.
- **Estimates, not statements.** Debt figures assume a constant rate. Fixed-rate Canadian mortgages are computed with semi-annual compounding, as the Interest Act requires lenders to quote them; variable mortgages and other loans use monthly compounding. The lender's statement is always the authority. USD holdings' cost is converted at today's rate, which is not the adjusted cost base used for taxes.
- **Forgotten password.** Reset it in Supabase: **Authentication → Users → … → Send password recovery**, or set a new one there.
- **Backups.** Supabase's free plan doesn't include downloadable backups. For a copy, go to **Table Editor**, open each table and use **Export → CSV** now and then.

---

## Files

```
index.html, styles.css, app.js   the web app
calc.js                          the formulas (valuation, net worth, debt, REEE, projects)
importer.js                      bank CSV reading and recurring-expense detection
config.js                        your Supabase URL + publishable key
supabase/schema.sql              tables and access rules
scripts/update_prices.py         the daily price job (run by GitHub Actions)
.github/workflows/prices.yml     its schedule
tests/                           checks that the page and the job compute the same numbers
```

To try the page on your computer: `python3 -m http.server` in the repo folder, then open http://localhost:8000.
To run the tests: `node tests/parity_test.mjs` and `python3 -m unittest discover tests` (needs `requests` installed).
