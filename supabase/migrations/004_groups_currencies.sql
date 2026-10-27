-- 004: your own account groups, your own currency list, insurance surrender value.
-- Safe to run more than once.

-- Currencies you use. Add any 3-letter code, e.g. CNY for RMB.
alter table public.settings add column if not exists currencies text[] not null default array['HKD','SGD','USD','TWD','CNY'];

-- Account groups, e.g. "Credit cards" or "Alternative Investment". Each one
-- works like one of the built-in types, which decides how its accounts behave
-- (bills, settling, loan schedule, surrender value).
create table if not exists public.account_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  base_type  text not null check (base_type in ('Cash','Bank','Card','Brokerage','Retirement','Property','Insurance','Loan','Other')),
  sort       int not null default 0,
  starter    boolean not null default false,  -- the built-in group for its type (can be renamed)
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.account_groups enable row level security;
drop policy if exists "own rows" on public.account_groups;
create policy "own rows" on public.account_groups for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.account_groups to authenticated;

alter table public.buckets add column if not exists group_id uuid references public.account_groups on delete set null;
alter table public.buckets add column if not exists surrender_value numeric check (surrender_value >= 0);
alter table public.buckets add column if not exists surrender_value_on date;

-- The starter group for each built-in type.
create or replace function public.default_group(uid uuid, t text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare gid uuid; label text; pos int;
begin
  label := case t when 'Card' then 'Credit cards' when 'Bank' then 'Bank accounts and debit cards'
                  when 'Cash' then 'Cash' when 'Loan' then 'Loans' when 'Brokerage' then 'Investments'
                  when 'Retirement' then 'Retirement and pension' when 'Property' then 'Property'
                  when 'Insurance' then 'Insurance' else 'Other' end;
  select id into gid from account_groups where user_id = uid and starter and base_type = t;
  if gid is not null then return gid; end if;
  pos := array_position(array['Card','Bank','Cash','Loan','Brokerage','Retirement','Property','Insurance','Other'], t);
  insert into account_groups (user_id, name, base_type, sort, starter) values (uid, label, t, pos * 10, true)
    on conflict (user_id, name) do update set starter = true, base_type = excluded.base_type
    returning id into gid;
  return gid;
end $$;

-- New accounts without a group go into the starter group for their type.
create or replace function public.set_default_group()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.group_id is null then new.group_id := public.default_group(new.user_id, new.type); end if;
  return new;
end $$;
drop trigger if exists buckets_default_group on public.buckets;
create trigger buckets_default_group before insert or update of group_id, type on public.buckets
  for each row execute function public.set_default_group();

-- Put existing accounts into their starter groups.
update public.buckets set group_id = public.default_group(user_id, type) where group_id is null;

-- Make sure every built-in type has a starter group, so each shows up in the pickers.
select public.default_group(s.user_id, t)
from public.settings s,
     unnest(array['Card','Bank','Cash','Loan','Brokerage','Retirement','Property','Insurance','Other']) as t;
