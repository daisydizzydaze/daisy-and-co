-- 006: Needs vs Wants, Plans (trips and big buys), and use dates.
-- Run after 005. Safe to run more than once. Nothing you've logged is lost.
--
-- Every expense now answers four things:
--   need_want  why you spent it (Need / Want). Each category sets a default.
--   paid_from  which account (unchanged)
--   tag_id     the category (unchanged; Travel now has sub-categories)
--   plan_id    optional: a trip or big buy it belongs to, e.g. "TMB 2027"
-- plus optional use dates: when you actually use what you paid for.
-- Empty = used on the day you paid. Card bills and Monthly Allocation still go by
-- the paid date; the Need/Want split and category totals spread a cost over its use dates.

-- ── Categories: a default Need or Want ─────────────────────────
alter table public.tags add column if not exists need_want text check (need_want in ('need','want'));

-- ── Plans ──────────────────────────────────────────────────────
create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null,
  need_want       text not null default 'want' check (need_want in ('need','want')),
  starts_on       date,
  ends_on         date,
  budget          numeric check (budget >= 0),
  budget_currency text check (budget_currency ~ '^[A-Z]{3}$'),
  done            boolean not null default false,  -- hide from pickers once it's over
  note            text,
  created_at      timestamptz not null default now(),
  unique (user_id, name),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

alter table public.plans enable row level security;
drop policy if exists "own rows" on public.plans;
create policy "own rows" on public.plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Expenses: Need/Want, plan, use dates ───────────────────────
-- First run only: remember that need_want is new, so old expenses can follow their category below.
create temp table if not exists _fresh_need_want as
  select not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'expenses' and column_name = 'need_want') as fresh;
alter table public.expenses add column if not exists need_want text not null default 'need' check (need_want in ('need','want'));
alter table public.expenses add column if not exists plan_id uuid references public.plans on delete set null;
alter table public.expenses add column if not exists use_from date;
alter table public.expenses add column if not exists use_to date;
alter table public.expenses drop constraint if exists expenses_use_dates_check;
alter table public.expenses add constraint expenses_use_dates_check
  check ((use_from is null) = (use_to is null) and (use_to is null or use_to >= use_from));
create index if not exists expenses_plan_idx on public.expenses (user_id, plan_id) where plan_id is not null;
create index if not exists expenses_use_idx on public.expenses (user_id, use_from, use_to) where use_from is not null;

-- An expense put on a plan with no use dates of its own takes the plan's dates.
create or replace function public.expense_plan_dates()
returns trigger language plpgsql security invoker set search_path = public as $$
declare p record;
begin
  if new.plan_id is not null and new.use_from is null then
    select starts_on, ends_on into p from plans where id = new.plan_id;
    if p.starts_on is not null then
      new.use_from := p.starts_on;
      new.use_to := coalesce(p.ends_on, p.starts_on);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists expenses_plan_dates on public.expenses;
create trigger expenses_plan_dates before insert or update of plan_id, use_from on public.expenses
  for each row execute function public.expense_plan_dates();

-- Moving a plan's dates moves the expenses that were using the old ones.
create or replace function public.plan_moved()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.starts_on is null then
    update expenses set use_from = null, use_to = null
     where plan_id = new.id and use_from is not distinct from old.starts_on
       and use_to is not distinct from coalesce(old.ends_on, old.starts_on);
  else
    update expenses set use_from = new.starts_on, use_to = coalesce(new.ends_on, new.starts_on)
     where plan_id = new.id
       and ((use_from is null)
         or (use_from is not distinct from old.starts_on and use_to is not distinct from coalesce(old.ends_on, old.starts_on)));
  end if;
  return new;
end $$;

drop trigger if exists plans_moved on public.plans;
create trigger plans_moved after update of starts_on, ends_on on public.plans
  for each row when (old.starts_on is distinct from new.starts_on or old.ends_on is distinct from new.ends_on)
  execute function public.plan_moved();

-- ── Default categories ─────────────────────────────────────────
-- Adds what's missing and sets a Need/Want default where none is set yet.
-- Your own categories and anything you've already changed are left alone.
create or replace function public.seed_needs_wants(uid uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare travel uuid;
begin
  insert into tags (user_id, kind, name, sort) values
    (uid, 'expense', 'Coffee & drinks', 3)
  on conflict (user_id, kind, name) do nothing;

  select id into travel from tags where user_id = uid and kind = 'expense' and name = 'Travel';
  if travel is null then
    insert into tags (user_id, kind, name, sort) values (uid, 'expense', 'Travel', 7) returning id into travel;
  end if;
  insert into tags (user_id, kind, name, parent_id, need_want, sort)
  select uid, 'expense', n, travel, 'want', o
    from unnest(array['Flights','Accommodation','Getting around','Food on the trip','Activities'])
         with ordinality as x(n, o)
  on conflict (user_id, kind, name) do nothing;

  update tags set need_want = case
      when name in ('Eating out','Shopping','Travel','Subscriptions') or parent_id = travel then 'want'
      else 'need' end
   where user_id = uid and kind = 'expense' and need_want is null;
end $$;

revoke execute on function public.seed_needs_wants(uuid) from public, anon, authenticated;

do $$
declare u uuid;
begin
  for u in select distinct user_id from public.tags loop
    perform public.seed_needs_wants(u);
  end loop;
end $$;

-- New sign-ups get the same defaults.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_defaults(new.id);
  perform public.seed_needs_wants(new.id);
  return new;
end $$;

-- Expenses logged before this update follow their category's default (first run only,
-- so a later re-run never undoes a Need/Want you've flipped yourself).
update public.expenses e set need_want = t.need_want
  from public.tags t
 where t.id = e.tag_id and t.need_want is not null
   and (select fresh from _fresh_need_want);

drop table _fresh_need_want;
