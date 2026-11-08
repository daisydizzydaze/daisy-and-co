-- 011: Freedom date on the Net worth screen. Run after 010. Safe to run more than once.
--
-- One new setting, no new table: the yearly return you expect after inflation.
-- 0.05 = 5%. The app uses 5% until you change it.

alter table public.settings add column if not exists expected_return numeric not null default 0.05
  check (expected_return > -0.5 and expected_return < 0.5);
