import { useCallback, useEffect, useMemo, useState } from 'react';
import { copyPlan, loadMonth, save, saveFx, settleStatement, type MonthData } from '../lib/data';
import { addMonths, dayIn, money, monthName, monthOnly, pct, shortMonth, todayISO } from '../lib/format';
import { fetchRatesToHkd, inCardCurrency, rateDate, ratesFrom } from '../lib/fx';
import { useMonthFx } from '../lib/useFx';
import { DisplayContext, makeDisplay, savedDisplay, saveDisplay, useDisplay, type Display, type DisplayCurrency } from '../lib/display';
import type { Allocation, Bucket, Income, Section, Tag } from '../lib/types';
import { Bud, type Mood } from './Bud';
import { AllocationSheet, IncomeSheet } from './LineSheets';

type Editing =
  | { kind: 'income'; row?: Income }
  | { kind: 'alloc'; section: Section; row?: Allocation }
  | null;

const SECTION_TITLE: Record<Section, string> = {
  tax: 'Tax',
  opex: 'Operating expenses',
  reserve: 'Quick Cash',
  growth: 'Growth',
};

const SECTION_HINT: Record<Section, string> = {
  tax: 'Reserve for your SG tax bill',
  opex: 'Last month’s card bills, matched to the Expense screen',
  reserve: 'Rolls into your cash reserve',
  growth: 'Rolled over to build wealth',
};

interface Props {
  month: string;
  setMonth: (m: string) => void;
  tags: Tag[];
  buckets: Bucket[];
  onTagsChanged: () => void;
}

export function AllocationScreen({ month, setMonth, tags, buckets, onTagsChanged }: Props) {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [displayCur, setDisplayCur] = useState<DisplayCurrency>(savedDisplay());

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadMonth(month));
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
  const hkd = useMemo(() => {
    const m = new Map<string, { amount: number | null; actual: number | null }>();
    data?.lines.forEach((l) => m.set(`${l.section}:${l.line_id}`, { amount: l.amount_hkd, actual: l.actual_hkd }));
    return m;
  }, [data]);

  const s = data?.statement;
  const net = s?.net_income ?? 0;
  const unallocated = s?.unallocated ?? 0;
  const hasIncome = (data?.income.length ?? 0) > 0;

  // Foreign currencies used this month. Each gets one rate per month, pulled once and saved.
  const usedCurrencies = useMemo(() => {
    if (!data) return [];
    const used = new Set<string>([
      ...data.income.map((i) => i.currency),
      ...data.allocations.map((a) => a.currency),
      ...data.bills.map((e) => e.currency),
      ...buckets.map((b) => b.currency),
    ]);
    used.add('SGD'); // always needed for the SGD view
    return [...used].filter((c) => c !== 'HKD').sort();
  }, [data, buckets]);
  const thisMonthRate = (c: string) => data?.fx.find((f) => f.currency === c && f.month === month);
  const missingThisMonth = usedCurrencies.filter((c) => !thisMonthRate(c));
  const fxError = useMonthFx(month, missingThisMonth, reload);

  // Ticking a card bill also marks last month's charges on that card as settled.
  async function toggleDone(a: Allocation) {
    try {
      const on = todayISO();
      await save('allocations', { done: !a.done, done_on: a.done ? null : on }, a.id);
      const card = a.to_bucket_id ?? tagById.get(a.tag_id)?.default_bucket_id;
      if (a.section === 'opex' && card) await settleStatement(card, addMonths(month, -1), !a.done, on);
    } catch (e) {
      setError((e as Error).message);
    }
    reload();
  }

  async function copyFromLast() {
    setBusy(true);
    try {
      const n = await copyPlan(addMonths(month, -1), month);
      if (n === 0) setError(`${monthName(addMonths(month, -1))} has no plan to copy yet.`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const rates = ratesFrom(data?.fx ?? []);
  // Money moved in SGD lands a few cents off in HKD, so anything under one display unit counts as fully assigned.
  const balanced = Math.abs(unallocated) < Math.max(1, rates.SGD ?? 1);
  const mood: Mood = !hasIncome ? 'think' : balanced ? 'cheer' : unallocated < 0 ? 'worried' : 'happy';
  /** What's been charged to a card last month, in the given currency. */
  const billFor = (bucketId: string | null | undefined, cur: string): number | null => {
    if (!bucketId || !data) return null;
    let sum = 0;
    for (const e of data.bills) {
      if (e.paid_from !== bucketId || e.reimbursable) continue;
      const v = inCardCurrency(e, cur, rates);
      if (v === null) return null;
      sum += v;
    }
    return sum;
  };
  const sgdRate = rates.SGD;
  const d = makeDisplay(displayCur, rates);
  const pickDisplay = (c: DisplayCurrency) => {
    setDisplayCur(c);
    saveDisplay(c);
  };

  // Cards and loans with no bill line yet this month, offered as one-tap lines.
  const billBucket = (a: Allocation) => a.to_bucket_id ?? tagById.get(a.tag_id)?.default_bucket_id ?? null;
  const covered = new Set((data?.allocations ?? []).filter((a) => a.section === 'opex').map(billBucket));
  const suggestions = buckets
    .filter((b) => b.active && (b.type === 'Card' || b.type === 'Loan') && !covered.has(b.id))
    .map((b) => {
      const tag = tags.find((t) => t.kind === 'opex' && !t.archived && t.default_bucket_id === b.id);
      const amount = b.type === 'Loan' ? Number(b.monthly_payment ?? 0) : billFor(b.id, b.currency) ?? 0;
      return { b, tag, amount };
    })
    .filter((x) => x.tag && (x.amount > 0 || x.b.type === 'Card'));

  async function addSuggested(x: (typeof suggestions)[number]) {
    try {
      await save('allocations', { budget_month: month, section: 'opex', tag_id: x.tag!.id, currency: x.b.currency, amount: Math.round(x.amount * 100) / 100, to_bucket_id: x.b.id });
    } catch (e) {
      setError((e as Error).message);
    }
    reload();
  }
  const dueLabel = (b?: Bucket) => (b?.due_day ? `due ${dayIn(month, b.due_day)}` : null);

  const allocs = (section: Section) => data?.allocations.filter((a) => a.section === section) ?? [];
  const withheld = data?.income.filter((i) => Number(i.tax_withheld) > 0) ?? [];

  return (
    <DisplayContext.Provider value={d}>
    <div className="screen">
      <header className="month-nav">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="month-title">
          <span className="eyebrow">Spending month</span>
          <h1>{monthName(month)}</h1>
          <span className="funded">Funded by {monthOnly(addMonths(month, -1))} pay</span>
        </div>
        <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </header>

      {error && <p className="error card" role="alert">{error}</p>}

      <div className="show-in" role="group" aria-label="Show amounts in">
        <span className="muted small">Show in</span>
        {(['SGD', 'HKD'] as DisplayCurrency[]).map((c) => (
          <button key={c} aria-pressed={d.cur === c} disabled={c === 'SGD' && !sgdRate} onClick={() => pickDisplay(c)}>{c}</button>
        ))}
      </div>

      {!data ? (
        <p className="muted center">Opening the books…</p>
      ) : (
        <div className="alloc-layout">
          <aside className="side">
          <section className={`card hero ${balanced && hasIncome ? 'win' : ''}`} key={`hero-${month}`}>
            <div className="hero-text">
              <span className="eyebrow">Saving rate</span>
              <span className="big">{pct(s?.saving_rate)}</span>
              <span className="muted small">Growth {d.show(s?.growth)} ÷ net income {d.show(net)}</span>
              <span className={`status ${balanced && hasIncome ? 'good' : unallocated < 0 ? 'bad' : ''}`}>
                {!hasIncome
                  ? 'Add this month’s income to start'
                  : balanced
                    ? '🎉 Every dollar has a job'
                    : unallocated > 0
                      ? `${d.show(unallocated)} still to assign`
                      : `Over-assigned by ${d.show(-unallocated)}`}
              </span>
            </div>
            <Bud mood={mood} size={92} coin={mood === 'cheer'} />
          </section>

          {net > 0 && <SplitBar net={net} opex={s!.opex_planned} cash={s!.quick_cash} growth={s!.growth} key={`bar-${month}`} />}

          {/* Rates are pulled and saved quietly; this only appears if a pull failed. */}
          {usedCurrencies.some((c) => !rates[c]) && (
            <div className="later">
              <RatesCard month={month} currencies={usedCurrencies} rates={data.fx} error={fxError} onSaved={reload} />
            </div>
          )}

          {data.allocations.length === 0 && (
            <button className="btn later" disabled={busy} onClick={copyFromLast}>
              Copy {monthName(addMonths(month, -1))}’s plan
            </button>
          )}
          </aside>

          <section className="card statement" aria-label="Income statement">
            <Block title="Gross income" hint={`${monthOnly(addMonths(month, -1))} pay and other income for ${monthOnly(month)}`} total={s?.gross_income ?? 0} onAdd={() => setEditing({ kind: 'income' })} addLabel="Add income">
              {data.income.map((i) => (
                <Row
                  key={i.id}
                  name={tagById.get(i.tag_id)?.name ?? '–'}
                  sub={[i.source, `landed ${i.received_on.slice(8)} ${shortMonth(i.received_on)}`].filter(Boolean).join(' · ')}
                  native={Number(i.gross_amount)}
                  currency={i.currency}
                  amount={hkd.get(`income:${i.id}`)?.amount ?? null}
                  onEdit={() => setEditing({ kind: 'income', row: i })}
                />
              ))}
            </Block>

            <Block title={SECTION_TITLE.tax} hint={SECTION_HINT.tax} total={s?.tax ?? 0} minus onAdd={() => setEditing({ kind: 'alloc', section: 'tax' })} addLabel="Add tax reserve">
              {withheld.map((i) => (
                <Row
                  key={`w-${i.id}`}
                  name="Withheld at source"
                  sub={tagById.get(i.tag_id)?.name}
                  native={Number(i.tax_withheld)}
                  currency={i.currency}
                  amount={hkd.get(`tax:${i.id}`)?.amount ?? null}
                  onEdit={() => setEditing({ kind: 'income', row: i })}
                />
              ))}
              {allocs('tax').map((a) => (
                <AllocRow key={a.id} a={a} tag={tagById.get(a.tag_id)} bucket={bucketById.get(a.to_bucket_id ?? '')} hkd={hkd.get(`tax:${a.id}`)} onEdit={() => setEditing({ kind: 'alloc', section: 'tax', row: a })} onToggle={() => toggleDone(a)} />
              ))}
            </Block>

            <Subtotal label="Net income" value={net} />

            {(['opex', 'reserve', 'growth'] as Section[]).map((sec) => (
              <Block
                key={sec}
                title={SECTION_TITLE[sec]}
                hint={sec === 'opex' ? `${monthOnly(addMonths(month, -1))} card bills, matched to the Expense screen` : SECTION_HINT[sec]}
                total={sec === 'opex' ? s?.opex_planned ?? 0 : sec === 'reserve' ? s?.quick_cash ?? 0 : s?.growth ?? 0}
                minus
                accent={sec === 'growth'}
                onAdd={() => setEditing({ kind: 'alloc', section: sec })}
                addLabel={sec === 'opex' ? 'Add card bill' : sec === 'reserve' ? 'Add Quick Cash' : 'Add growth'}
              >
                {allocs(sec).map((a) => (
                  <AllocRow key={a.id} a={a} tag={tagById.get(a.tag_id)} bucket={bucketById.get(billBucket(a) ?? '')} due={sec === 'opex' ? dueLabel(bucketById.get(billBucket(a) ?? '')) : null} hkd={hkd.get(`${sec}:${a.id}`)} showActual={sec === 'opex' && bucketById.get(billBucket(a) ?? '')?.type !== 'Loan'} billMonth={monthOnly(addMonths(month, -1)).slice(0, 3)} bill={sec === 'opex' ? billFor(a.to_bucket_id ?? tagById.get(a.tag_id)?.default_bucket_id, a.currency) : null} onEdit={() => setEditing({ kind: 'alloc', section: sec, row: a })} onToggle={() => toggleDone(a)} />
                ))}
                {sec === 'opex' && suggestions.map((x) => (
                  <li key={`s-${x.b.id}`} className="suggest">
                    <button className="row" onClick={() => addSuggested(x)}>
                      <span className="row-main">
                        <span className="tag">{x.tag!.name}</span>
                        <span className="muted small">
                          {[x.b.type === 'Loan' ? 'monthly repayment' : `${monthOnly(addMonths(month, -1)).slice(0, 3)} charges so far`, dueLabel(x.b)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="row-amt">
                        <span className="num muted">{money(x.amount, x.b.currency)}</span>
                        <span className="small strong">+ Add</span>
                      </span>
                    </button>
                  </li>
                ))}
              </Block>
            ))}

            <div className={`unallocated ${balanced ? 'zero' : unallocated < 0 ? 'neg' : ''}`}>
              <span>Unallocated</span>
              <span className="num">{balanced ? <>{d.show(0)} <span className="tick" aria-label="all assigned">✓</span></> : d.show(unallocated)}</span>
            </div>
          </section>
        </div>
      )}

      {editing?.kind === 'income' && (
        <IncomeSheet month={month} row={editing.row} tags={tags} buckets={buckets} onTagsChanged={onTagsChanged} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {editing?.kind === 'alloc' && (
        <AllocationSheet month={month} billFor={billFor} section={editing.section} row={editing.row} tags={tags} buckets={buckets} onTagsChanged={onTagsChanged} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
    </DisplayContext.Provider>
  );
}

/** Under a line's own amount: its HKD value, or for HKD lines the value in the chosen view. */
function equivalent(d: Display, currency: string, hkd: number | null | undefined) {
  if (currency !== 'HKD') return d.inCur(hkd, 'HKD');
  return d.cur !== 'HKD' ? d.show(hkd) : '';
}

function Block(props: { title: string; hint: string; total: number; minus?: boolean; accent?: boolean; onAdd: () => void; addLabel: string; children: React.ReactNode }) {
  const d = useDisplay();
  return (
    <div className={`block ${props.accent ? 'accent' : ''}`}>
      <div className="block-head">
        <div>
          <h2>{props.minus ? <span className="less">less </span> : null}{props.title}</h2>
          <span className="muted small">{props.hint}</span>
        </div>
        <span className="totals">
          <span className="num strong">{props.minus && props.total > 0 ? `(${d.show(props.total)})` : d.show(props.total)}</span>
          <span className="muted small num">{d.alt(props.total)}</span>
        </span>
      </div>
      <ul className="rows">{props.children}</ul>
      <button className="add" onClick={props.onAdd}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {props.addLabel}
      </button>
    </div>
  );
}

function Row({ name, sub, native, currency, amount, onEdit }: { name: string; sub?: string | null; native: number; currency: string; amount: number | null; onEdit: () => void }) {
  const d = useDisplay();
  return (
    <li>
      <button className="row" onClick={onEdit}>
        <span className="row-main">
          <span className="tag">{name}</span>
          {sub && <span className="muted small">{sub}</span>}
        </span>
        <span className="row-amt">
          <span className="num">{money(native, currency)}</span>
          <span className="muted small num">{equivalent(d, currency, amount)}</span>
        </span>
      </button>
    </li>
  );
}

function AllocRow({ a, tag, bucket, due, hkd, showActual, bill, billMonth, onEdit, onToggle }: {
  a: Allocation; tag?: Tag; bucket?: Bucket; due?: string | null; hkd?: { amount: number | null; actual: number | null }; showActual?: boolean; bill?: number | null; billMonth?: string; onEdit: () => void; onToggle: () => void;
}) {
  const d = useDisplay();
  const planned = hkd?.amount ?? 0;
  const actual = hkd?.actual ?? 0;
  // Card lines compare what was charged with what's set aside, in the line's own currency.
  const setAside = Number(a.amount);
  const used = bill ?? null;
  const ratio = used !== null ? (setAside > 0 ? Math.min(1, used / setAside) : 1) : planned > 0 ? Math.min(1, actual / planned) : 0;
  const over = showActual && (used !== null ? used > setAside + 0.005 : actual > planned);
  return (
    <li className="alloc">
      <button className={`tick ${a.done ? 'on' : ''}`} aria-pressed={a.done} aria-label={a.section === 'opex' ? (a.done ? 'Bill paid' : 'Mark bill as paid') : a.done ? 'Marked as moved' : 'Mark as moved'} onClick={onToggle}>
        {a.done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>}
      </button>
      <button className="row" onClick={onEdit}>
        <span className="row-main">
          <span className="tag">{tag?.name ?? '–'}</span>
          <span className="muted small">{a.section === 'opex'
            ? [a.done ? 'paid' : due ?? 'set aside', a.note].filter(Boolean).join(' · ')
            : [bucket ? `to ${bucket.name}` : null, a.note].filter(Boolean).join(' · ') || (a.done ? 'moved' : 'planned')}</span>
          {showActual && (
            <span className="meter" aria-label={`Charged ${money(bill ?? null, a.currency)} of ${money(Number(a.amount), a.currency)} set aside`}>
              <span className={`grow ${over ? 'over' : ''}`} style={{ width: `${(over ? 1 : ratio) * 100}%` }} />
            </span>
          )}
        </span>
        <span className="row-amt">
          <span className="num">{money(Number(a.amount), a.currency)}</span>
          {showActual ? (
            <span className={`small ${over ? 'bad-text' : 'muted'}`}>{billMonth} charges {bill != null ? money(bill, a.currency) : d.inCur(actual, a.currency) || money(actual)}</span>
          ) : (
            <span className="muted small num">{equivalent(d, a.currency, hkd?.amount ?? null)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  const d = useDisplay();
  return (
    <div className="subtotal">
      <span>{label}</span>
      <span className="totals">
        <span className="num">{d.show(value)}</span>
        <span className="muted small num alt-total">{d.alt(value)}</span>
      </span>
    </div>
  );
}

/** Net income split into where it goes. Eases in once when the month opens. */
function SplitBar({ net, opex, cash, growth }: { net: number; opex: number; cash: number; growth: number }) {
  const rest = Math.max(0, net - opex - cash - growth);
  const total = Math.max(net, opex + cash + growth);
  const parts = [
    { key: 'opex', label: 'Expenses', v: opex },
    { key: 'cash', label: 'Quick Cash', v: cash },
    { key: 'growth', label: 'Growth', v: growth },
    { key: 'rest', label: 'Unassigned', v: rest > net * 0.005 ? rest : 0 },
  ].filter((p) => p.v > 0);
  return (
    <section className="card split" aria-label="Where net income goes">
      <div className="split-bar">
        {parts.map((p) => (
          <span key={p.key} className={`seg ${p.key} grow`} style={{ width: `${(p.v / total) * 100}%` }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}><i className={`dot ${p.key}`} />{p.label} {Math.round((p.v / net) * 100)}%</span>
        ))}
      </div>
    </section>
  );
}

/** One rate per foreign currency per month: pulled automatically, editable, re-pullable. */
function RatesCard({ month, currencies, rates, error, onSaved }: {
  month: string; currencies: string[]; rates: { month: string; currency: string; rate_to_hkd: number }[]; error: string | null; onSaved: () => void;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rateFor = (c: string) => rates.find((r) => r.currency === c && r.month === month) ?? rates.find((r) => r.currency === c);

  async function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    try {
      for (const [c, v] of Object.entries(editing)) if (Number(v) > 0) await saveFx(month, c, Number(v));
      setEditing({});
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const got = await fetchRatesToHkd(rateDate(month), currencies);
      for (const [c, r] of Object.entries(got)) await saveFx(month, c, r);
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  }

  const missing = currencies.some((c) => !rateFor(c));
  return (
    <form className={`card fx ${missing ? 'warn' : ''}`} onSubmit={saveEdits}>
      <div className="fx-head">
        <strong>Exchange rates for {monthOnly(month)}</strong>
        <button type="button" className="btn ghost small-btn" disabled={busy} onClick={refresh}>{busy ? 'Updating…' : 'Update'}</button>
      </div>
      <ul className="fx-list">
        {currencies.map((c) => {
          const r = rateFor(c);
          const stale = r && r.month !== month;
          return (
            <li key={c}>
              <label className="field inline">
                <span>1 {c} =</span>
                <input
                  inputMode="decimal"
                  placeholder="HKD"
                  value={editing[c] ?? (r ? String(Number(r.rate_to_hkd)) : '')}
                  onChange={(e) => setEditing({ ...editing, [c]: e.target.value })}
                />
                <span>HKD</span>
              </label>
              {stale && <span className="muted small">using {monthOnly(r.month)}’s rate</span>}
            </li>
          );
        })}
      </ul>
      {Object.keys(editing).length > 0 && <button className="btn primary small-btn">Save rates</button>}
      <span className="muted small">Pulled once for the month and saved, so past months never shift. Edit to match your bank’s rate.</span>
      {(err || error) && <p className="error">{err || error}. Type the rate in instead.</p>}
    </form>
  );
}
