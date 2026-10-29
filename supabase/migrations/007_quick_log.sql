-- 007: Quick log from an iPhone Shortcut, without opening the app.
-- Run after 006. Safe to run more than once.
--
-- How it stays safe:
--   * You make a secret key in Settings › Quick log. Only its fingerprint (SHA-256)
--     is stored here; the key itself lives only in your Shortcut.
--   * With the key, the Shortcut can do exactly two things: list your category and
--     account names, and ADD one expense. It can't read amounts, edit or delete anything.
--   * Revoke the key in Settings and it stops working at once.

create table if not exists public.quick_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label        text not null default 'iPhone Shortcut',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.quick_keys enable row level security;
drop policy if exists "own rows" on public.quick_keys;
create policy "own rows" on public.quick_keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Whose key is this? Null if it doesn't match.
create or replace function public.quick_key_owner(k text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from quick_keys
   where key_hash = encode(sha256(convert_to(coalesce(k, ''), 'UTF8')), 'hex')
$$;
revoke execute on function public.quick_key_owner(text) from public, anon, authenticated;

-- The pick lists for the Shortcut: category names ("Travel › Flights" for sub-categories)
-- and the accounts you pay with, most recently used first.
create or replace function public.quick_options(key text)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := quick_key_owner(key);
begin
  if uid is null then raise exception 'Unknown quick-log key' using errcode = '28000'; end if;
  return json_build_object(
    'categories', coalesce((
      select json_agg(label order by psort, coalesce(csort, -1), label) from (
        select case when c.parent_id is null then c.name else p.name || ' › ' || c.name end as label,
               coalesce(p.sort, c.sort) as psort, case when c.parent_id is null then null else c.sort end as csort
          from tags c left join tags p on p.id = c.parent_id
         where c.user_id = uid and c.kind = 'expense' and not c.archived
      ) x), '[]'::json),
    'accounts', coalesce((
      select json_agg(name order by last_used desc nulls last, sort, name) from (
        select b.name, b.sort, (select max(e.created_at) from expenses e where e.paid_from = b.id) as last_used
          from buckets b
         where b.user_id = uid and b.active and b.type in ('Card','Cash','Bank')
           and not exists (select 1 from tags t where t.user_id = uid and t.kind in ('reserve','growth') and t.default_bucket_id = b.id)
      ) y), '[]'::json)
  );
end $$;

-- Add one expense. Category and account are matched by name (case doesn't matter).
-- Currency: what you last used with that account in the past week (so TWD while
-- you're in Taiwan), else the account's own currency. Cash and bank are settled at once; cards stay charged.
create or replace function public.quick_log(key text, amount numeric, category text, account text,
                                            vendor text default null, currency text default null, note text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := quick_key_owner(key);
  b record;
  t record;
  cur text;
  amt numeric;
begin
  if uid is null then raise exception 'Unknown quick-log key' using errcode = '28000'; end if;
  amt := round(amount, 2);
  if amt is null or amt <= 0 or amt >= 100000000 then raise exception 'Amount must be more than 0'; end if;

  select * into b from buckets
   where user_id = uid and active and type in ('Card','Cash','Bank') and lower(name) = lower(trim(account)) limit 1;
  if b.id is null then raise exception 'No account called "%"', account; end if;

  select c.* into t from tags c left join tags p on p.id = c.parent_id
   where c.user_id = uid and c.kind = 'expense' and not c.archived
     and (lower(c.name) = lower(trim(category))
       or lower(p.name || ' › ' || c.name) = lower(trim(category))
       or lower(p.name || ' > ' || c.name) = lower(trim(category)))
   order by (c.parent_id is null) desc limit 1;
  if t.id is null then raise exception 'No category called "%"', category; end if;

  cur := upper(nullif(trim(coalesce(currency, '')), ''));
  if cur is null then
    select e.currency into cur from expenses e
     where e.paid_from = b.id and e.created_at > now() - interval '7 days'
     order by e.created_at desc limit 1;
  end if;
  cur := coalesce(cur, b.currency);
  if cur !~ '^[A-Z]{3}$' then raise exception 'Currency should be a 3-letter code like HKD'; end if;

  insert into expenses (user_id, spent_on, vendor, currency, amount, tag_id, paid_from, need_want, settled_on, note)
  -- Today in UTC+8 (Hong Kong, Singapore and Taiwan share it).
  values (uid, (now() at time zone 'Asia/Hong_Kong')::date,
          nullif(trim(coalesce(vendor, '')), ''), cur, amt, t.id, b.id,
          coalesce(t.need_want, (select p.need_want from tags p where p.id = t.parent_id), 'need'),
          case when b.type in ('Cash','Bank') then (now() at time zone 'Asia/Hong_Kong')::date end,
          nullif(trim(coalesce(note, '')), ''));

  update quick_keys set last_used_at = now() where user_id = uid and key_hash = encode(sha256(convert_to(key, 'UTF8')), 'hex');
  return format('Logged %s %s · %s · %s', cur, to_char(amt, 'FM999,999,990.00'), t.name, b.name);
end $$;

-- The Shortcut calls these with the public (anon) key plus your secret key.
grant execute on function public.quick_options(text) to anon, authenticated;
grant execute on function public.quick_log(text, numeric, text, text, text, text, text) to anon, authenticated;
