-- 009: Net Worth. Run after 008. Safe to run more than once.
--
-- Once a month (right after Allocation) you "close the month": the app saves
-- one row per account with its value that day. Investment accounts also keep
-- the money you put in since the last close, so the rest is gain:
--   gain = value now - value at last close - money in

create table if not exists public.balances (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  month      date not null check (extract(day from month) = 1),  -- the month this close belongs to
  closed_on  date not null,                                      -- the day you closed
  bucket_id  uuid not null references public.buckets on delete cascade,
  value      numeric not null,                                   -- in the account's own currency; cards and loans = what you owe
  money_in   numeric not null default 0,                         -- net money put in since the last close (minus = taken out)
  source     text not null default 'typed' check (source in ('typed','cards','loan','shares','surrender')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, month, bucket_id)
);
alter table public.balances enable row level security;
drop policy if exists "own rows" on public.balances;
create policy "own rows" on public.balances for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.balances to authenticated;
create index if not exists balances_bucket on public.balances (user_id, bucket_id, month);

-- Money you put into an investment account before your first close
-- (IBKR calls this "net deposits"). Without it the first gain would be wrong.
alter table public.buckets add column if not exists put_in_before numeric;
