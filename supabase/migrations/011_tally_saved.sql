-- 011: a simpler year tally. Run after 010. Safe to run more than once.
--
-- Instead of net worth, a year can be tallied from what you put away:
--   spent = take-home - saved and invested - how much your cash went up

alter table public.year_budgets add column if not exists tally_saved numeric;        -- put into IBKR, SRS and other savings that year
alter table public.year_budgets add column if not exists tally_cash_change numeric;  -- bank and cash balances, end of year minus start (optional)
