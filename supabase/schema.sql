-- ============================================================================
-- Finances du ménage — Supabase schema
--
-- Run once: Supabase dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run again (it skips what already exists).
--
-- FIRST TIME: replace the two example emails just below with the emails
-- the two of you will log in with. Only those emails can see or change data.
-- After that, the example emails can stay: they are never added, and the
-- GitHub Action "Update database schema" reruns this file by itself when it
-- changes (see INSTALLATION.md).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Who is allowed in
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_users (
  email text primary key check (email = lower(email))
);

insert into public.allowed_users (email)
select lower(e) from (values
  ('person1@example.com'),   -- ← replace
  ('person2@example.com')    -- ← replace
) as v(e)
where e not like '%@example.com'
on conflict do nothing;

-- No API access to this table at all; only the function below reads it.
alter table public.allowed_users enable row level security;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- Owner codes: 'p1' = person 1, 'p2' = person 2, 'joint' = shared (counted 50/50)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  p1_name text not null default 'Personne 1',
  p2_name text not null default 'Personne 2',
  include_debt_payments boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text,
  market text not null check (market in ('TSX', 'TSXV', 'NEO', 'US', 'CRYPTO', 'MANUAL', 'CASH')),
  currency text not null default 'CAD' check (currency in ('CAD', 'USD')),
  qty numeric not null check (qty >= 0 or market = 'CASH'),
  avg_cost numeric check (avg_cost >= 0),
  manual_price numeric check (manual_price >= 0),
  manual_price_date date,
  account text not null default 'Non enregistré',
  institution text,
  owner text not null default 'p1' check (owner in ('p1', 'p2', 'joint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Written by the daily GitHub Action. symbol_key = '<market>:<SYMBOL>' or 'FX:USDCAD'
create table if not exists public.prices (
  symbol_key text primary key,
  close numeric not null,
  prev_close numeric,
  currency text,
  price_date date not null,
  source text,
  fetched_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'Autre',
  value numeric not null default 0 check (value >= 0),
  as_of date,
  owner text not null default 'joint' check (owner in ('p1', 'p2', 'joint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other'
    check (kind in ('mortgage', 'heloc', 'loc', 'auto', 'student', 'card', 'personal', 'other')),
  lender text,
  balance numeric not null default 0 check (balance >= 0),
  balance_date date,
  rate numeric not null default 0 check (rate >= 0 and rate < 100),
  rate_type text not null default 'fixed' check (rate_type in ('fixed', 'variable')),
  payment numeric check (payment >= 0),
  freq text not null default 'monthly' check (freq in ('monthly', 'semimonthly', 'biweekly', 'weekly')),
  original numeric check (original >= 0),
  term_end date,
  owner text not null default 'joint' check (owner in ('p1', 'p2', 'joint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grp text not null,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric not null default 0 check (amount >= 0),
  freq text not null default 'monthly'
    check (freq in ('monthly', 'semimonthly', 'biweekly', 'weekly', 'yearly')),
  owner text not null default 'joint' check (owner in ('p1', 'p2', 'joint')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per day: net worth for the household and each person.
create table if not exists public.snapshots (
  snap_date date primary key,
  data jsonb not null,
  source text not null default 'auto',
  created_at timestamptz not null default now()
);

create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  birth_date date,
  resp_value numeric check (resp_value >= 0),       -- REEE value typed by hand (used when no holding is linked)
  resp_value_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- REEE history per child: one 'opening' row (totals to date) and/or one row per contribution.
create table if not exists public.resp_entries (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  entry_date date not null default current_date,
  kind text not null default 'contribution' check (kind in ('contribution', 'opening')),
  amount numeric not null default 0 check (amount >= 0),   -- contributions
  cesg numeric not null default 0 check (cesg >= 0),       -- federal grant received (SCEE)
  iqee numeric not null default 0 check (iqee >= 0),       -- Quebec credit received (IQEE)
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_amount numeric not null default 0 check (target_amount >= 0),
  target_date date,
  saved numeric not null default 0 check (saved >= 0),     -- amount set aside outside linked holdings
  monthly_contribution numeric not null default 0 check (monthly_contribution >= 0),
  expected_return numeric not null default 0 check (expected_return > -100 and expected_return < 100),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ad hoc spending (trips, shopping, toys…), one row per expense.
create table if not exists public.expense_log (
  id uuid primary key default gen_random_uuid(),
  spend_date date not null default current_date,
  label text not null,
  grp text not null,
  amount numeric not null check (amount >= 0),
  owner text not null default 'joint' check (owner in ('p1', 'p2', 'joint')),
  child_id uuid references public.children (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Columns added after the first version (safe on a fresh or existing database).
alter table public.holdings add column if not exists child_id uuid references public.children (id) on delete set null;
alter table public.holdings add column if not exists project_id uuid references public.projects (id) on delete set null;
-- CRYPTO (BTC, ETH…): priced every weekday in USD by the daily job.
alter table public.holdings drop constraint if exists holdings_market_check;
alter table public.holdings add constraint holdings_market_check check (market in ('TSX', 'TSXV', 'NEO', 'US', 'CRYPTO', 'MANUAL', 'CASH'));
-- Cash can be negative: a margin balance owed to the broker.
alter table public.holdings drop constraint if exists holdings_qty_check;
alter table public.holdings add constraint holdings_qty_check check (qty >= 0 or market = 'CASH');
alter table public.budget_items add column if not exists nature text not null default 'fixed';
alter table public.budget_items add column if not exists child_id uuid references public.children (id) on delete set null;
alter table public.budget_items add column if not exists gross boolean not null default false;
alter table public.debts add column if not exists start_date date;
alter table public.debts add column if not exists amortization_years numeric;
alter table public.debts add column if not exists term_start date;
alter table public.debts add column if not exists term_years numeric;
alter table public.debts add column if not exists prepay_pct numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_items_nature_check') then
    alter table public.budget_items add constraint budget_items_nature_check check (nature in ('fixed', 'variable'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings', 'holdings', 'assets', 'debts', 'budget_items', 'children', 'projects'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access: only emails in allowed_users, and only when logged in
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings', 'holdings', 'prices', 'assets', 'debts', 'budget_items', 'snapshots',
                           'children', 'resp_entries', 'projects', 'expense_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "household members" on public.%I', t);
    execute format(
      'create policy "household members" on public.%I
         for all to authenticated
         using (public.is_member())
         with check (public.is_member())', t);
  end loop;
end $$;

revoke all on public.allowed_users from anon, authenticated;
