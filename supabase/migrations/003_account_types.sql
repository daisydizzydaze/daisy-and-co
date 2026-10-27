-- 003: bank accounts with a debit card ("Bank") as their own account type,
-- and a repayment schedule for loans.
-- Paying by debit card takes money straight from the account, so those
-- charges count as settled straight away, like cash. Safe to run twice.
alter table public.buckets drop constraint if exists buckets_type_check;
alter table public.buckets add constraint buckets_type_check
  check (type in ('Cash','Bank','Card','Brokerage','Retirement','Property','Insurance','Loan','Other'));

-- Loan schedule. The balance is worked out from it, ready for Net Worth and
-- ratios like debt to liquid assets.
alter table public.buckets add column if not exists payment_cadence text not null default 'monthly'
  check (payment_cadence in ('monthly','quarterly','yearly'));
alter table public.buckets add column if not exists term_payments int check (term_payments > 0);   -- e.g. 60
alter table public.buckets add column if not exists first_payment_on date;                          -- date of payment 1
alter table public.buckets add column if not exists interest_rate numeric check (interest_rate >= 0); -- yearly %, e.g. 3.5

create or replace view public.loan_status with (security_invoker = true) as
with l as (
  select b.*,
         case b.payment_cadence when 'quarterly' then 3 when 'yearly' then 12 else 1 end as months_per,
         case b.payment_cadence when 'quarterly' then 4 when 'yearly' then 1 else 12 end as per_year
  from public.buckets b
  where b.type = 'Loan' and b.active
), p as (
  select l.*,
         case when first_payment_on is null or term_payments is null then null
              when first_payment_on > current_date then 0
              else least(term_payments,
                     1 + ((extract(year from age(current_date, first_payment_on)) * 12
                         + extract(month from age(current_date, first_payment_on)))::int / months_per))
         end as payments_made
  from l
)
select id as bucket_id, name, currency, monthly_payment as payment, payment_cadence,
       term_payments, payments_made,
       term_payments - payments_made as payments_left,
       (first_payment_on + make_interval(months => (term_payments - 1) * months_per))::date as last_payment_on,
       case when payments_made is null or monthly_payment is null then null
            when coalesce(interest_rate, 0) = 0 then monthly_payment * (term_payments - payments_made)
            else round(monthly_payment * (1 - power(1 + interest_rate / 100 / per_year, -(term_payments - payments_made)))
                       / (interest_rate / 100 / per_year), 2)
       end as balance,
       interest_rate is not null as balance_is_exact
from p;
grant select on public.loan_status to authenticated;
