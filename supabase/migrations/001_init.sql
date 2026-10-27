-- Daisy & Co. Books: first migration (Monthly Allocation + ready for Expenses)
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run once on a fresh project. Later changes go in 002_..., 003_... files.

-- ─────────────────────────────────────────────────────────────
-- Setup tables
-- ─────────────────────────────────────────────────────────────

-- One row per person. Base currency and FIRE numbers.
create table public.settings (
  user_id            uuid primary key default auth.uid() references auth.users on delete cascade,
  base_currency      text not null default 'HKD',
  fire_monthly_spend numeric not null default 40000,
  withdrawal_rate    numeric not null default 0.035,
  birth_year         int,
  updated_at         timestamptz not null default now()
);

-- Accounts: bank accounts, cards, brokerage, SRS, MPF, cash reserve...
create table public.buckets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null,
  institution  text,
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  type         text not null check (type in ('Cash','Card','Brokerage','Retirement','Property','Insurance','Loan','Other')),
  liquidity    text not null default 'Liquid' check (liquidity in ('Liquid','Locked until age','Illiquid')),
  unlock_age   int,
  is_liability boolean not null default false,
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, name)
);

-- Tags: one list, grouped by the line of the income statement they belong to.
--   income  = Salary, Dividend...        (top line)
--   tax     = Withheld, Tax reserve
--   opex    = SGD card, HKD card, Cash   (operating expenses)
--   reserve = Quick Cash                 (goes to the cash reserve)
--   growth  = Public Equity, Retirement Pension, Funds...   (bottom line)
--   expense = spending categories for the Expense screen (Groceries, Travel...)
create table public.tags (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  kind              text not null check (kind in ('income','tax','opex','reserve','growth','expense')),
  name              text not null,
  parent_id         uuid references public.tags on delete set null,  -- for expense sub-categories
  default_bucket_id uuid references public.buckets on delete set null, -- e.g. "HKD card" tag -> HKD card bucket
  color             text,
  sort              int not null default 0,
  archived          boolean not null default false,  -- hide instead of delete, so old months keep their labels
  created_at        timestamptz not null default now(),
  unique (user_id, kind, name),
  unique (id, kind)                                   -- lets other tables insist on the right kind of tag
);

-- Month-end FX, frozen so past months never shift. HKD is always 1 and needs no row.
create table public.fx_rates (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  month       date not null check (extract(day from month) = 1),  -- first day of the month
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  rate_to_hkd numeric not null check (rate_to_hkd > 0),            -- 1 SGD = 6.0 HKD -> 6.0
  primary key (user_id, month, currency)
);

-- ─────────────────────────────────────────────────────────────
-- Monthly ledger tables
-- ─────────────────────────────────────────────────────────────

-- Top line: gross income, one row per payment.
create table public.income (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  received_on   date not null,
  budget_month  date not null check (extract(day from budget_month) = 1), -- salary on 25 Oct -> 2026-11-01
  tag_id        uuid not null,
  tag_kind      text not null default 'income' check (tag_kind = 'income'),
  source        text,                               -- who paid, e.g. employer name
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount  numeric not null check (gross_amount >= 0),
  tax_withheld  numeric not null default 0 check (tax_withheld >= 0), -- taken before it landed
  bucket_id     uuid references public.buckets on delete set null,     -- where it landed
  note          text,
  created_at    timestamptz not null default now(),
  foreign key (tag_id, tag_kind) references public.tags (id, kind)
);

-- Everything below the top line: tax reserve, operating expenses, Quick Cash, Growth.
-- Each row is one line of the month's plan. Mark done when the money has actually moved.
create table public.allocations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  budget_month   date not null check (extract(day from budget_month) = 1),
  section        text not null check (section in ('tax','opex','reserve','growth')),
  tag_id         uuid not null,
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  amount         numeric not null check (amount >= 0),
  from_bucket_id uuid references public.buckets on delete set null,
  to_bucket_id   uuid references public.buckets on delete set null,  -- card being repaid, cash reserve, brokerage, SRS...
  done           boolean not null default false,
  done_on        date,
  note           text,
  sort           int not null default 0,
  created_at     timestamptz not null default now(),
  foreign key (tag_id, section) references public.tags (id, kind)
);

-- Spending, logged on the Expense screen. paid_from = the card or cash it was charged to.
create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  spent_on         date not null,
  budget_month     date generated always as (date_trunc('month', spent_on::timestamp)::date) stored,
  vendor           text,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),   -- what you paid in, e.g. TWD
  amount           numeric not null check (amount >= 0),
  tag_id           uuid,
  tag_kind         text not null default 'expense' check (tag_kind = 'expense'),
  paid_from        uuid not null references public.buckets on delete restrict,
  charged_amount   numeric,                                          -- what the card billed, if known
  charged_currency text check (charged_currency ~ '^[A-Z]{3}$'),
  reimbursable     boolean not null default false,
  note             text,
  created_at       timestamptz not null default now(),
  foreign key (tag_id, tag_kind) references public.tags (id, kind)
);

create index on public.income (user_id, budget_month);
create index on public.allocations (user_id, budget_month);
create index on public.expenses (user_id, budget_month, paid_from);

-- ─────────────────────────────────────────────────────────────
-- Privacy: every row is visible only to the person who owns it
-- ─────────────────────────────────────────────────────────────
alter table public.settings enable row level security;
alter table public.buckets enable row level security;
alter table public.tags enable row level security;
alter table public.fx_rates enable row level security;
alter table public.income enable row level security;
alter table public.allocations enable row level security;
alter table public.expenses enable row level security;

create policy "own rows" on public.settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.buckets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.tags for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.fx_rates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.income for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.allocations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.expenses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Maths: convert to HKD and build the monthly income statement
-- ─────────────────────────────────────────────────────────────

-- Uses that month's rate, or the latest earlier one if the month isn't closed yet.
create function public.to_hkd(amt numeric, cur text, mon date)
returns numeric language sql stable security invoker set search_path = public as $$
  select case when cur = 'HKD' then amt
              else amt * (select r.rate_to_hkd from public.fx_rates r
                          where r.currency = cur and r.month <= mon
                          order by r.month desc limit 1)
         end
$$;

-- Every line of every month, in HKD, with actual card/cash spend next to the plan.
create view public.month_lines with (security_invoker = true) as
select i.budget_month, 'income'::text as section, i.tag_id, t.name as tag_name,
       i.id as line_id, i.currency, i.gross_amount as amount,
       public.to_hkd(i.gross_amount, i.currency, i.budget_month) as amount_hkd,
       null::numeric as actual_hkd, true as done
from public.income i join public.tags t on t.id = i.tag_id
union all
select i.budget_month, 'tax', null, 'Withheld at source', i.id, i.currency, i.tax_withheld,
       public.to_hkd(i.tax_withheld, i.currency, i.budget_month), null, true
from public.income i where i.tax_withheld > 0
union all
select a.budget_month, a.section, a.tag_id, t.name, a.id, a.currency, a.amount,
       public.to_hkd(a.amount, a.currency, a.budget_month),
       case when a.section = 'opex' then (
         select coalesce(sum(public.to_hkd(coalesce(e.charged_amount, e.amount),
                                           coalesce(e.charged_currency, e.currency),
                                           e.budget_month)), 0)
         from public.expenses e
         where e.budget_month = a.budget_month
           and e.paid_from = coalesce(a.to_bucket_id, t.default_bucket_id)
           and not e.reimbursable)
       end,
       a.done
from public.allocations a join public.tags t on t.id = a.tag_id;

-- One row per month: the income statement.
create view public.month_statement with (security_invoker = true) as
with s as (
  select budget_month,
    coalesce(sum(amount_hkd) filter (where section = 'income'), 0)  as gross_income,
    coalesce(sum(amount_hkd) filter (where section = 'tax'), 0)     as tax,
    coalesce(sum(amount_hkd) filter (where section = 'opex'), 0)    as opex_planned,
    coalesce(sum(actual_hkd) filter (where section = 'opex'), 0)    as opex_actual,
    coalesce(sum(amount_hkd) filter (where section = 'reserve'), 0) as quick_cash,
    coalesce(sum(amount_hkd) filter (where section = 'growth'), 0)  as growth,
    bool_or(amount_hkd is null)                                     as missing_fx
  from public.month_lines group by budget_month
)
select budget_month, gross_income, tax,
       gross_income - tax                                       as net_income,
       opex_planned, opex_actual, quick_cash, growth,
       gross_income - tax - opex_planned - quick_cash - growth  as unallocated,  -- goal: 0
       case when gross_income - tax > 0
            then round(growth / (gross_income - tax), 4) end    as saving_rate,  -- Growth / Net income
       missing_fx
from s;

-- Start a new month from last month's plan (amounts copied, nothing marked done).
create function public.copy_plan(from_month date, to_month date)
returns int language sql security invoker set search_path = public as $$
  with ins as (
    insert into public.allocations (budget_month, section, tag_id, currency, amount, from_bucket_id, to_bucket_id, note, sort)
    select to_month, section, tag_id, currency, amount, from_bucket_id, to_bucket_id, note, sort
    from public.allocations where budget_month = from_month
    returning 1)
  select count(*)::int from ins
$$;

-- ─────────────────────────────────────────────────────────────
-- Starter tags and buckets, added automatically when you first sign in.
-- Rename or archive any of them in the app.
-- ─────────────────────────────────────────────────────────────
create function public.seed_defaults(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sgd_card uuid; hkd_card uuid; cash uuid; reserve uuid;
begin
  if exists (select 1 from tags where user_id = uid) then return; end if;

  insert into settings (user_id) values (uid) on conflict do nothing;

  insert into buckets (user_id, name, currency, type, is_liability, sort) values
    (uid, 'SGD credit card', 'SGD', 'Card', true, 1) returning id into sgd_card;
  insert into buckets (user_id, name, currency, type, is_liability, sort) values
    (uid, 'HKD credit card', 'HKD', 'Card', true, 2) returning id into hkd_card;
  insert into buckets (user_id, name, currency, type, sort) values
    (uid, 'Cash wallet', 'HKD', 'Cash', 3) returning id into cash;
  insert into buckets (user_id, name, currency, type, sort) values
    (uid, 'Cash reserve', 'HKD', 'Cash', 4) returning id into reserve;

  insert into tags (user_id, kind, name, sort) select uid, 'income', n, o
    from unnest(array['Salary','Bonus','Dividend','Interest','Rental','Side income','Refund','Other'])
         with ordinality as x(n, o);
  insert into tags (user_id, kind, name, sort) values
    (uid, 'tax', 'SG income tax reserve', 1);
  insert into tags (user_id, kind, name, default_bucket_id, sort) values
    (uid, 'opex', 'SGD card repayment', sgd_card, 1),
    (uid, 'opex', 'HKD card repayment', hkd_card, 2),
    (uid, 'opex', 'Cash spending', cash, 3),
    (uid, 'reserve', 'Quick Cash', reserve, 1);
  insert into tags (user_id, kind, name, sort) select uid, 'growth', n, o
    from unnest(array['Public Equity','Retirement Pension','Funds','Other investments'])
         with ordinality as x(n, o);
  insert into tags (user_id, kind, name, sort) select uid, 'expense', n, o
    from unnest(array['Groceries','Eating out','Transport','Rent','Utilities','Shopping',
                      'Travel','Health','Fitness','Family','Subscriptions','Other'])
         with ordinality as x(n, o);
end $$;

revoke execute on function public.seed_defaults(uuid) from public, anon, authenticated;

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_defaults(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
