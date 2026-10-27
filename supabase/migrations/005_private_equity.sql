-- 005: private equity / start-up shares. Run after 004. Safe to run more than once.
-- Record how many shares you hold; the value is optional (blank = value unknown).

alter table public.buckets drop constraint if exists buckets_type_check;
alter table public.buckets add constraint buckets_type_check
  check (type in ('Cash','Bank','Card','Brokerage','Equity','Retirement','Property','Insurance','Loan','Other'));
alter table public.account_groups drop constraint if exists account_groups_base_type_check;
alter table public.account_groups add constraint account_groups_base_type_check
  check (base_type in ('Cash','Bank','Card','Brokerage','Equity','Retirement','Property','Insurance','Loan','Other'));

alter table public.buckets add column if not exists shares numeric check (shares >= 0);
alter table public.buckets add column if not exists share_class text;            -- e.g. Ordinary, Preferred, Options
alter table public.buckets add column if not exists price_per_share numeric check (price_per_share >= 0); -- blank = value unknown
alter table public.buckets add column if not exists price_on date;              -- when that price was set, e.g. last round

-- Starter group for the new type.
create or replace function public.default_group(uid uuid, t text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare gid uuid; label text; pos int;
begin
  label := case t when 'Card' then 'Credit cards' when 'Bank' then 'Bank accounts and debit cards'
                  when 'Cash' then 'Cash' when 'Loan' then 'Loans' when 'Brokerage' then 'Investments'
                  when 'Equity' then 'Private equity'
                  when 'Retirement' then 'Retirement and pension' when 'Property' then 'Property'
                  when 'Insurance' then 'Insurance' else 'Other' end;
  select id into gid from account_groups where user_id = uid and starter and base_type = t;
  if gid is not null then return gid; end if;
  pos := array_position(array['Card','Bank','Cash','Loan','Brokerage','Retirement','Property','Insurance','Other','Equity'], t);
  insert into account_groups (user_id, name, base_type, sort, starter) values (uid, label, t, case when t = 'Equity' then 55 else pos * 10 end, true)
    on conflict (user_id, name) do update set starter = true, base_type = excluded.base_type
    returning id into gid;
  return gid;
end $$;

select public.default_group(s.user_id, 'Equity') from public.settings s;
