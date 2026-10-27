-- 002: Expense screen
-- Card bills lag a month: the plan for November (funded by October's pay)
-- pays the October statement. So an operating-expense line in month M is
-- matched to the statement for that card that closed in month M-1.
-- Safe to run more than once.

-- Charged -> Settled. Empty means still on the card.
alter table public.expenses add column if not exists settled_on date;

-- Account settings. Cards: the day the statement closes and the day it's due
-- (empty closing day = statement follows the calendar month). Loans: the
-- monthly repayment and its due day.
alter table public.buckets add column if not exists statement_day int check (statement_day between 1 and 31);
alter table public.buckets add column if not exists due_day int check (due_day between 1 and 31);
alter table public.buckets add column if not exists monthly_payment numeric check (monthly_payment >= 0);

-- Which statement a charge lands on, named by the month the statement closes.
-- Closing day 20: a 21 Oct charge goes on the November statement.
create or replace function public.statement_month_for(spent date, closing_day int)
returns date language sql immutable set search_path = public as $$
  select case when closing_day is null or extract(day from spent) <= closing_day
              then date_trunc('month', spent::timestamp)::date
              else (date_trunc('month', spent::timestamp) + interval '1 month')::date end
$$;

alter table public.expenses add column if not exists statement_month date;

create or replace function public.set_statement_month()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.statement_month := public.statement_month_for(
    new.spent_on, (select statement_day from public.buckets where id = new.paid_from));
  return new;
end $$;

drop trigger if exists expenses_statement_month on public.expenses;
create trigger expenses_statement_month before insert or update of spent_on, paid_from
  on public.expenses for each row execute function public.set_statement_month();

-- Changing a card's closing day re-files its charges that aren't settled yet.
create or replace function public.refile_statements()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.expenses
     set statement_month = public.statement_month_for(spent_on, new.statement_day)
   where paid_from = new.id and settled_on is null;
  return new;
end $$;

drop trigger if exists buckets_refile on public.buckets;
create trigger buckets_refile after update of statement_day on public.buckets
  for each row when (old.statement_day is distinct from new.statement_day)
  execute function public.refile_statements();

update public.expenses e
   set statement_month = public.statement_month_for(e.spent_on, b.statement_day)
  from public.buckets b
 where b.id = e.paid_from and e.statement_month is null;

-- Same columns as before; only the opex matching changes (now the month before).
create or replace view public.month_lines with (security_invoker = true) as
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
         where e.statement_month = (a.budget_month - interval '1 month')::date
           and e.paid_from = coalesce(a.to_bucket_id, t.default_bucket_id)
           and not e.reimbursable)
       end,
       a.done
from public.allocations a join public.tags t on t.id = a.tag_id;

create index if not exists expenses_statement on public.expenses (user_id, paid_from, statement_month);
