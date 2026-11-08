-- 010: Budget (the yearly plan). Run after 009. Safe to run more than once.
--
-- One row per year. Every number is optional: left empty, the app works it out
-- from what you log (pay, Growth lines, expenses, net worth closes).
--
-- The "tally" columns are filled in once a year has ended, to work out what that
-- year really cost:  spent = take-home - (net worth at the end - at the start - investment gains)

create table if not exists public.year_budgets (
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  year             int  not null check (year between 2000 and 2100),
  currency         text not null default 'SGD',  -- the currency of every number in this row
  -- Planning the year (empty = worked out by the app)
  take_home        numeric,  -- the whole year's take-home pay
  bonus            numeric,  -- bonus or other income on top
  living_monthly   numeric,  -- living costs per month
  growth_monthly   numeric,  -- pay yourself first, per month
  -- Tallying the year once it's over
  tally_take_home  numeric,  -- take-home pay that year (empty = from the app, if every month is in)
  tally_nw_start   numeric,  -- net worth on 1 January (empty = the December close before)
  tally_gains      numeric,  -- investment gains and currency moves that year
  tally_one_offs   numeric,  -- big one-offs that won't repeat (trips etc.)
  updated_at       timestamptz not null default now(),
  primary key (user_id, year)
);
alter table public.year_budgets enable row level security;
drop policy if exists "own rows" on public.year_budgets;
create policy "own rows" on public.year_budgets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.year_budgets to authenticated;
