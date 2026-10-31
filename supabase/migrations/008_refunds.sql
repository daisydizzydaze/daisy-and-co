-- 008: Refunds and card credits.
-- Run after 007. Safe to run more than once. Nothing you've logged changes.
--
-- A refund is an expense with a minus amount, on the card it came back to.
-- It lowers that card's statement (so it matches the bill) and cancels the
-- spending in its category. Zero is still not allowed.

alter table public.expenses drop constraint if exists expenses_amount_check;
alter table public.expenses add constraint expenses_amount_check check (amount <> 0) not valid;  -- not valid: any old zero rows are left alone
