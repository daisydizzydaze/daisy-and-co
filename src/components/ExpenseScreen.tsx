import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadExpenses, settleStatement, tickBill, type ExpenseData } from '../lib/data';
import { addMonths, dayIn, money, monthName, monthOnly, shortMonth, thisMonth, todayISO } from '../lib/format';
import { inCardCurrency, ratesFrom } from '../lib/fx';
import { makeHkdOf, rangeLabel, shareIn, spread } from '../lib/spend';
import { useMonthFx } from '../lib/useFx';
import { DisplayContext, makeDisplay, savedDisplay, saveDisplay, useDisplay, type DisplayCurrency } from '../lib/display';
import type { Bucket, Expense, NeedWant, Plan, Tag } from '../lib/types';
import { Bud, type Mood } from './Bud';
import { ExpenseSheet, payingAccounts } from './ExpenseSheet';
import { PlanSheet, planTotals } from './PlanSheet';

type Filter = 'all' | 'charged' | 'settled';

interface Props {
  tags: Tag[];
  buckets: Bucket[];
  plans: Plan[];
  onTagsChanged: () => void;
  /** Open the log sheet as soon as accounts have loaded. */
  quickLog?: boolean;
}

export function ExpenseScreen({ tags, buckets, plans, onTagsChanged, quickLog }: Props) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<ExpenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row?: Expense; plan?: string } | null>(null);
  const [quickDone, setQuickDone] = useState(!quickLog);
  useEffect(() => {
    if (quickDone || buckets.length === 0) return;
    setQuickDone(true);
    setEditing({});
    // Drop ?log from the address so a refresh doesn't open another one.
    window.history.replaceState(null, '', window.location.pathname);
  }, [quickDone, buckets.length]);
  const [planOpen, setPlanOpen] = useState<{ plan?: Plan } | null>(null);
  const [nw, setNw] = useState<NeedWant | ''>('');
  const [filter, setFilter] = useState<Filter>('all');
  const [account, setAccount] = useState<string>('');
  const [displayCur, setDisplayCur] = useState<DisplayCurrency>(savedDisplay());

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadExpenses(month));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const rates = { ...ratesFrom(data?.fx ?? []), ...ratesFrom((data?.fx ?? []).filter((f) => f.month <= month)) };
  const d = makeDisplay(displayCur, rates);

  // Rates for this month's currencies, pulled once and saved.
  const usedCurrencies = useMemo(() => {
    const s = new Set<string>(['SGD', ...(data?.expenses.map((e) => e.currency) ?? []), ...buckets.map((b) => b.currency)]);
    return [...s].filter((c) => c !== 'HKD');
  }, [data, buckets]);
  const missing = data ? usedCurrencies.filter((c) => !data.fx.some((f) => f.currency === c && f.month === month)) : [];
  const fxError = useMonthFx(month, missing, reload);

  // Each expense in HKD at the rate of the month it was paid.
  const hkdOf = useMemo(() => makeHkdOf(data?.fx ?? []), [data]);

  // Paid this month (the list and the cards) vs. used this month (spending: the total, Need/Want and categories).
  const spent = (data?.expenses ?? []).filter((e) => e.budget_month === month);
  const counted = spent.filter((e) => !e.reimbursable);
  const paidTotal = counted.reduce((s, e) => s + (hkdOf(e) ?? 0), 0);
  const toSettle = spent.filter((e) => !e.settled_on).length;
  const used = (data?.expenses ?? [])
    .filter((e) => !e.reimbursable)
    .map((e) => ({ e, v: (hkdOf(e) ?? 0) * shareIn(e, month) }))
    .filter((x) => x.v !== 0);  // refunds count as minus
  const total = used.reduce((s, x) => s + x.v, 0);
  const needs = used.filter((x) => (x.e.need_want ?? 'need') === 'need').reduce((s, x) => s + x.v, 0);
  const wants = total - needs;
  // A refund can push one side below zero; the bar and % only show what's above it.
  const splitBase = Math.max(0, needs) + Math.max(0, wants);
  const share = (v: number) => (splitBase > 0 ? Math.max(0, v) / splitBase : 0);
  const bar = (v: number) => `${share(v) * 100}%`;
  const refunds = counted.filter((e) => Number(e.amount) < 0).length;
  const forLater = counted.filter(spread).reduce((s, e) => s + (hkdOf(e) ?? 0) * (1 - shareIn(e, month)), 0);
  const fromEarlier = used.filter((x) => x.e.budget_month !== month);

  const accounts = payingAccounts(buckets, tags);
  const statements = accounts
    .map((b) => {
      const rows = (data?.expenses ?? []).filter((e) => e.paid_from === b.id && e.statement_month === month && !e.reimbursable);
      const sum = rows.reduce((s, e) => s + (inCardCurrency(e, b.currency, rates) ?? 0), 0);
      return { b, rows, sum, open: rows.filter((e) => !e.settled_on).length };
    })
    .filter((s) => s.rows.length > 0 || s.b.type === 'Card');

  // Sub-categories roll up into their parent (Flights and Accommodation into Travel).
  const topOf = (id: string | null) => { const t = tagById.get(id ?? ''); return t?.parent_id && tagById.has(t.parent_id) ? t.parent_id : id ?? ''; };
  const byCategory = (() => {
    const m = new Map<string, number>();
    used.filter((x) => !nw || (x.e.need_want ?? 'need') === nw).forEach(({ e, v }) => m.set(topOf(e.tag_id), (m.get(topOf(e.tag_id)) ?? 0) + v));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const shown = spent
    .filter((e) => (filter === 'charged' ? !e.settled_on : filter === 'settled' ? !!e.settled_on : true))
    .filter((e) => !account || e.paid_from === account)
    .filter((e) => !nw || (e.need_want ?? 'need') === nw);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const totals = planTotals(data?.planned ?? [], hkdOf);
  const livePlans = plans.filter((p) => !p.done);
  const days = groupByDay(shown);

  async function settle(b: Bucket, settled: boolean) {
    try {
      await settleStatement(b.id, month, settled, todayISO());
      await tickBill(b.id, month, settled, todayISO());
    } catch (e) {
      setError((e as Error).message);
    }
    reload();
  }

  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 960px)').matches;
  const mood: Mood = spent.length === 0 ? 'think' : toSettle === 0 ? 'cheer' : 'happy';
  const pickDisplay = (c: DisplayCurrency) => {
    setDisplayCur(c);
    saveDisplay(c);
  };

  return (
    <DisplayContext.Provider value={d}>
      <div className="screen">
        <header className="month-nav">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="month-title">
            <span className="eyebrow">Expenses</span>
            <h1>{monthName(month)}</h1>
            <span className="funded">Bills paid from {monthOnly(addMonths(month, 1))}’s plan</span>
          </div>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </header>

        {error && <p className="error card" role="alert">{error}</p>}
        {fxError && <p className="error card" role="alert">{fxError}. Amounts in other currencies may show as –.</p>}

        <div className="show-in" role="group" aria-label="Show amounts in">
          <span className="muted small">Show in</span>
          {(['SGD', 'HKD'] as DisplayCurrency[]).map((c) => (
            <button key={c} aria-pressed={d.cur === c} disabled={c === 'SGD' && !rates.SGD} onClick={() => pickDisplay(c)}>{c}</button>
          ))}
        </div>

        {!data ? (
          <p className="muted center">Opening the books…</p>
        ) : (
          <div className="alloc-layout">
            <aside className="side">
              <section className="card hero compact" key={`hero-${month}`}>
                <div className="hero-text">
                  <span className="eyebrow">Spent in {monthOnly(month)}</span>
                  <span className="big num">{d.show(total)}</span>
                  <span className="muted small">{[d.alt(total), `${counted.length - refunds} ${counted.length - refunds === 1 ? 'charge' : 'charges'}`, refunds ? `${refunds} ${refunds === 1 ? 'refund' : 'refunds'}` : null].filter(Boolean).join(' · ')}</span>
                  {Math.round(forLater) > 0 && (
                    <span className="muted small">Paid {d.show(paidTotal)}, of which {d.show(forLater)} is for later</span>
                  )}
                  <span className={`status ${spent.length > 0 && toSettle === 0 ? 'good' : ''}`}>
                    {spent.length === 0 ? 'Nothing logged yet' : toSettle === 0 ? 'All settled' : `${toSettle} still on the card`}
                  </span>
                </div>
                <Bud mood={mood} size={64} coin={mood === 'cheer'} />
                {total > 0 && (
                  <div className="nw-split">
                    <div className="split-bar" aria-hidden="true">
                      <span className="seg need" style={{ width: bar(needs) }} />
                      <span className="seg want" style={{ width: bar(wants) }} />
                    </div>
                    <div className="nw-legend" role="group" aria-label="Show needs or wants">
                      {(['need', 'want'] as NeedWant[]).map((k) => (
                        <button key={k} aria-pressed={nw === k} onClick={() => setNw(nw === k ? '' : k)}>
                          <span className="nw-label"><i className={`dot ${k}`} aria-hidden="true" />{k === 'need' ? 'Needs' : 'Wants'} <span className="muted">{Math.round(share(k === 'need' ? needs : wants) * 100)}%</span></span>
                          <strong className="num">{d.show(k === 'need' ? needs : wants)}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="card stack statements" aria-label="Statements">
                <h2>{monthOnly(month)} statements</h2>
                {statements.length === 0 && <p className="muted small">No cards yet. Add one in Settings.</p>}
                <ul className="rows">
                  {statements.map(({ b, rows, sum, open }) => {
                    const isCard = b.type === 'Card';
                    const due = isCard && b.due_day ? `due ${dayIn(addMonths(month, b.due_day <= (b.statement_day ?? 31) ? 1 : 0), b.due_day)}` : null;
                    return (
                      <li key={b.id} className="statement-row">
                        <button className={`row ${account === b.id ? 'picked' : ''}`} onClick={() => setAccount(account === b.id ? '' : b.id)} aria-pressed={account === b.id}>
                          <span className="row-main">
                            <span className="tag">{b.name}</span>
                            <span className="muted small">
                              {[due ?? (isCard ? null : b.type === 'Bank' ? 'debit' : 'cash'), rows.length === 0 ? 'nothing yet' : isCard ? (open === 0 ? 'all settled' : `${open} open`) : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="row-amt">
                            <span className="num">{money(sum, b.currency)}</span>
                          </span>
                        </button>
                        {isCard && rows.length > 0 && (
                          open > 0 ? (
                            <button className="btn primary small-btn" onClick={() => settle(b, true)}>Settle</button>
                          ) : (
                            <button className="btn ghost small-btn" onClick={() => settle(b, false)} title="Mark these charges as not paid yet">Undo</button>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
                <span className="muted small wide-only">Settling a card ticks its bill on {monthOnly(addMonths(month, 1))}’s Monthly Allocation.</span>
              </section>

              <section className="card stack plans" aria-label="Plans">
                <div className="block-head">
                  <h2>Plans</h2>
                  <button className="link" onClick={() => setPlanOpen({})}>+ New plan</button>
                </div>
                {livePlans.length === 0 && <p className="muted small">Trips and big buys you pay for bit by bit, like TMB 2027. Their costs count as spending on the plan’s dates.</p>}
                <ul className="rows">
                  {livePlans.map((p) => {
                    const t = totals.get(p.id);
                    const budgetHkd = p.budget != null ? (p.budget_currency && p.budget_currency !== 'HKD' ? (rates[p.budget_currency] ? p.budget * rates[p.budget_currency] : null) : p.budget) : null;
                    return (
                      <li key={p.id}>
                        <button className="row" onClick={() => setPlanOpen({ plan: p })}>
                          <span className="row-main">
                            <span className="tag">{p.name}</span>
                            <span className="muted small">{[p.starts_on ? rangeLabel(p.starts_on, p.ends_on ?? p.starts_on) : 'no dates yet', `${t?.count ?? 0} ${t?.count === 1 ? 'cost' : 'costs'}`].join(' · ')}</span>
                            {budgetHkd ? <span className="meter"><span className={(t?.hkd ?? 0) > budgetHkd ? 'over' : 'grow'} style={{ width: `${Math.min(100, ((t?.hkd ?? 0) / budgetHkd) * 100)}%` }} /></span> : null}
                          </span>
                          <span className="row-amt">
                            <span className="num">{d.show(t?.hkd ?? 0)}</span>
                            {budgetHkd ? <span className="muted small num">of {d.show(budgetHkd)}</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {byCategory.length > 0 && total > 0 && (
                <details className="card later cats" open={wide}>
                  <summary>
                    <h2>By category</h2>
                    <span className="muted small">{tagById.get(byCategory[0][0])?.name ?? 'Uncategorised'} {d.show(byCategory[0][1])}{byCategory.length > 1 ? ` + ${byCategory.length - 1} more` : ''}</span>
                  </summary>
                  <ul className="cat-list">
                    {byCategory.map(([id, v]) => (
                      <li key={id}>
                        <span className="cat-name">{tagById.get(id)?.name ?? 'Uncategorised'}</span>
                        <span className="meter"><span className="grow" style={{ width: `${byCategory[0][1] > 0 ? (Math.max(0, v) / byCategory[0][1]) * 100 : 0}%` }} /></span>
                        <span className="num small">{d.show(v)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </aside>

            <section className="card statement expense-list" aria-label="Expenses">
              <div className="list-head">
                <div className="filters" role="group" aria-label="Filter">
                  {(['all', 'charged', 'settled'] as Filter[]).map((f) => (
                    <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f !== 'all' && <i className={`sdot ${f}`} aria-hidden="true" />}
                      {f === 'all' ? 'All' : f === 'charged' ? 'Charged' : 'Settled'}
                    </button>
                  ))}
                  {account && (
                    <button aria-pressed onClick={() => setAccount('')}>{bucketById.get(account)?.name} ✕</button>
                  )}
                  {nw && (
                    <button aria-pressed onClick={() => setNw('')}>{nw === 'need' ? 'Needs' : 'Wants'} ✕</button>
                  )}
                </div>
                <button className="btn primary small-btn fab" onClick={() => setEditing({})} aria-label="Log expense">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  <span>Log expense</span>
                </button>
              </div>

              {days.length === 0 && (
                <p className="muted center empty">{spent.length === 0 ? `Nothing logged for ${monthOnly(month)} yet.` : 'Nothing matches this filter.'}</p>
              )}
              {days.map(([day, rows]) => (
                <div key={day} className="day">
                  <h3 className="day-head">{Number(day.slice(8))} {shortMonth(day)}</h3>
                  <ul className="rows">
                    {rows.map((e) => (
                      <ExpenseRow key={e.id} e={e} tag={tagById.get(e.tag_id ?? '')} account={bucketById.get(e.paid_from)} plan={planById.get(e.plan_id ?? '')} hkd={hkdOf(e)} month={month} onEdit={() => setEditing({ row: e })} />
                    ))}
                  </ul>
                </div>
              ))}

              {fromEarlier.filter((x) => !nw || (x.e.need_want ?? 'need') === nw).length > 0 && (
                <div className="day earlier">
                  <h3 className="day-head">Paid earlier, used in {monthOnly(month)}</h3>
                  <ul className="rows">
                    {fromEarlier.filter((x) => !nw || (x.e.need_want ?? 'need') === nw).map(({ e, v }) => (
                      <li key={e.id}>
                        <button className="row xrow" onClick={() => setEditing({ row: e })}>
                          <span className="row-main">
                            <span className="tag">{e.vendor || tagById.get(e.tag_id ?? '')?.name || 'Uncategorised'}</span>
                            <span className="muted small">{[planById.get(e.plan_id ?? '')?.name, `paid ${Number(e.spent_on.slice(8))} ${shortMonth(e.spent_on)}`, `${Math.round(shareIn(e, month) * 100)}% this month`].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="row-amt"><span className="num">{d.show(v)}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}

        {editing && (
          <ExpenseSheet
            row={editing.row}
            tags={tags}
            buckets={buckets}
            plans={plans}
            defaultPlan={editing.plan}
            defaultDate={month === thisMonth() ? todayISO() : month}
            onTagsChanged={onTagsChanged}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); reload(); }}
          />
        )}
        {planOpen && (
          <PlanSheet
            plan={planOpen.plan}
            expenses={(data?.planned ?? []).filter((e) => e.plan_id === planOpen.plan?.id)}
            tags={tags}
            hkdOf={hkdOf}
            onClose={() => setPlanOpen(null)}
            onSaved={() => { setPlanOpen(null); onTagsChanged(); reload(); }}
            onLog={() => { const id = planOpen.plan?.id; setPlanOpen(null); setEditing({ plan: id }); }}
            onEdit={(e) => { setPlanOpen(null); setEditing({ row: e }); }}
          />
        )}
      </div>
    </DisplayContext.Provider>
  );
}

function ExpenseRow({ e, tag, account, plan, hkd, month, onEdit }: { e: Expense; tag?: Tag; account?: Bucket; plan?: Plan; hkd: number | null; month: string; onEdit: () => void }) {
  const d = useDisplay();
  const cat = tag?.name ?? 'Uncategorised';
  const nextStatement = e.statement_month && e.statement_month !== month;
  const later = spread(e) && shareIn(e, month) < 1 ? `for ${rangeLabel(e.use_from!, e.use_to!)}` : null;
  const sub = [e.vendor ? cat : null, plan?.name, account?.name, nextStatement ? `${shortMonth(e.statement_month!)} bill` : null, later, e.reimbursable ? 'paid back' : null, Number(e.amount) < 0 ? 'refund' : null].filter(Boolean).join(' · ');
  const amt = Number(e.amount);
  const status = e.settled_on ? 'settled' : 'charged';
  return (
    <li>
      <button className="row xrow" onClick={onEdit} aria-label={`${e.vendor ?? cat}, ${money(amt, e.currency, amt % 1 ? 2 : 0)}, ${status}`}>
        <span className="row-main">
          <span className="tag">{e.vendor || cat}</span>
          {sub && <span className="muted small">{sub}</span>}
        </span>
        <span className="row-amt">
          <span className={`num ${e.reimbursable ? 'muted' : ''} ${amt < 0 ? 'credit' : ''}`}>{money(amt, e.currency, amt % 1 ? 2 : 0)}</span>
          <span className="muted small num">
            {e.currency !== d.cur && hkd !== null ? d.show(hkd) : ''}
            <i className={`sdot ${status}`} title={status === 'settled' ? 'Settled' : 'Charged'} />
          </span>
        </span>
      </button>
    </li>
  );
}

function groupByDay(rows: Expense[]): [string, Expense[]][] {
  const m = new Map<string, Expense[]>();
  rows.forEach((e) => m.set(e.spent_on, [...(m.get(e.spent_on) ?? []), e]));
  return [...m.entries()];
}
