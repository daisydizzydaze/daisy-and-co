# Daisy & Co.

Daisy's books, run like a company. A web app for phone and laptop, starting with the **Monthly Allocation** screen: an income statement for each month that assigns every dollar of net income to a job.

```
Gross income        (income tags: Salary, Dividend…)
less Tax            (withheld + reserve)
= Net income
less Operating expenses  (SGD card, HKD card, cash; actuals come from the Expense screen)
less Quick Cash          (rolls into the cash reserve)
less Growth              (growth tags: Public Equity, Retirement Pension, Funds…)
= Unallocated       → goal: 0
Saving rate = Growth ÷ Net income
```

## How it fits together

- **App:** React + Vite, hosted on GitHub Pages at `https://daisydizzydaze.github.io/daisy-and-co/`. Add it to your phone's home screen.
- **Data:** Supabase (Postgres) in Singapore. Email + password sign-in, and every row is locked to the signed-in user by row-level security. No money data lives in this repo.
- **Maths:** in the database (`month_lines` and `month_statement` views), so every screen agrees.
- **Database changes:** numbered scripts in `supabase/migrations/`, run once each in the Supabase SQL Editor.

## One-time setup

1. **Database:** Supabase → SQL Editor → New query → paste `supabase/migrations/001_init.sql` → Run.
2. **Your login:** Supabase → Authentication → Users → Add user → Create new user (tick *Auto confirm*). Then Authentication → Sign In / Providers → turn off *Allow new users to sign up*.
3. **Keys for the app:** GitHub → Settings → Secrets and variables → Actions → **Variables** tab → add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (from Supabase → Project Settings → API). Both are public by design.
4. **Hosting:** GitHub → Settings → Pages → Source: **GitHub Actions**. Every push to `main` redeploys.

Starter tags and accounts (SGD card, HKD card, cash wallet, cash reserve) are created automatically the first time your user is added. Rename or archive them under **Tags**.

## Local development

```
cp .env.example .env.local   # fill in the two Supabase values
npm install
npm run dev
```
