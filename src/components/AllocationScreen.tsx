import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyPlan, loadMonth, save, saveFx, type MonthData } from '../lib/data';
import { addMonths, money, monthName, monthOnly, pct, shortMonth } from '../lib/format';
import { fetchRatesToHkd, rateDate } from '../lib/fx';
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
  opex: 'Card repayments and cash, matched to the Expense screen',
  reserve: 'Rolls into your cash reserve',
  growth: 'Rolled over to build wealth',
};

interface Props {
  month: string;
  setMonth: (m: string) => void;
  tags: Tag[];
  buckets: Bucket[];
}

export function AllocationScreen({ month, setMonth, tags, buckets }: Props) {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

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
  const mood: Mood = !hasIncome ? 'think' : Math.abs(unallocated) < 1 ? 'cheer' : unallocated < 0 ? 'worried' : 'happy';

  // Foreign currencies used this month. Each gets one rate per month, pulled once and saved.
  const usedCurrencies = useMemo(() => {
    if (!data) return [];
    const used = new Set<string>([...data.income.map((i) => i.currency), ...data.allocations.map((a) => a.currency)]);
    return [...used].filter((c) => c !== 'HKD').sort();
  }, [data]);
  const thisMonthRate = (c: string) => data?.fx.find((f) => f.currency === c && f.month === month);
  const missingThisMonth = usedCurrencies.filter((c) => !thisMonthRate(c));
  const [fxError, setFxError] = useState<string | null>(null);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    const todo = missingThisMonth.filter((c) => !tried.current.has(`${month}:${c}`));
    if (todo.length === 0) return;
    todo.forEach((c) => tried.current.add(`${month}:${c}`));
    (async () => {
      try {
        const rates = await fetchRatesToHkd(rateDate(month), todo);
        for (const [c, r] of Object.entries(rates)) await saveFx(month, c, r);
        setFxError(null);
        reload();
      } catch (e) {
        setFxError((e as Error).message);
      }
    })();
  }, [missingThisMonth.join(','), month, reload]);

  async function toggleDone(a: Allocation) {
    await save('allocations', { done: !a.done, done_on: a.done ? null : new Date().toISOString().slice(0, 10) }, a.id);
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

  const allocs = (section: Section) => data?.allocations.filter((a) => a.section === section) ?? [];
  const withheld = data?.income.filter((i) => Number(i.tax_withheld) > 0) ?? [];

  return (
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

      {!data ? (
        <p className="muted center">Opening the books…</p>
      ) : (
        <>
          <section className="card hero" key={`hero-${month}`}>
            <div className="hero-text">
              <span className="eyebrow">Saving rate</span>
              <span className="big">{pct(s?.saving_rate)}</span>
              <span className="muted small">Growth {money(s?.growth)} ÷ net income {money(net)}</span>
              <span className={`status ${Math.abs(unallocated) < 1 && hasIncome ? 'good' : unallocated < 0 ? 'bad' : ''}`}>
                {!hasIncome
                  ? 'Add this month’s income to start'
                  : Math.abs(unallocated) < 1
                    ? 'Every dollar has a job'
                    : unallocated > 0
                      ? `${money(unallocated)} still to assign`
                      : `Over-assigned by ${money(-unallocated)}`}
              </span>
            </div>
            <Bud mood={mood} size={92} coin={mood === 'cheer'} />
          </section>

          {net > 0 && <SplitBar net={net} opex={s!.opex_planned} cash={s!.quick_cash} growth={s!.growth} key={`bar-${month}`} />}


          <section className="card statement" aria-label="Income statement">
            <Block title="Gross income" hint={`${monthOnly(addMonths(month, -1))} pay and other income for ${monthOnly(month)}`} total={s?.gross_income ?? 0} onAdd={() => setEditing({ kind: 'income' })} addLabel="Add income">
              {data.income.map((i) => (
                <Row
                  key={i.id}
                  name={tagById.get(i.tag_id)?.name ?? '–'}
                  sub={[i.source, `landed ${i.received_on.slice(8)} ${shortMonth(i.received_on)}`].filter(Boolean).join(' · ')}
                  native={i.currency !== 'HKD' ? money(Number(i.gross_amount), i.currency) : undefined}
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
                  native={i.currency !== 'HKD' ? money(Number(i.tax_withheld), i.currency) : undefined}
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
                hint={SECTION_HINT[sec]}
                total={sec === 'opex' ? s?.opex_planned ?? 0 : sec === 'reserve' ? s?.quick_cash ?? 0 : s?.growth ?? 0}
                minus
                accent={sec === 'growth'}
                onAdd={() => setEditing({ kind: 'alloc', section: sec })}
                addLabel={sec === 'opex' ? 'Add expense line' : sec === 'reserve' ? 'Add Quick Cash' : 'Add growth'}
              >
                {allocs(sec).map((a) => (
                  <AllocRow key={a.id} a={a} tag={tagById.get(a.tag_id)} bucket={bucketById.get(a.to_bucket_id ?? '')} hkd={hkd.get(`${sec}:${a.id}`)} showActual={sec === 'opex'} onEdit={() => setEditing({ kind: 'alloc', section: sec, row: a })} onToggle={() => toggleDone(a)} />
                ))}
              </Block>
            ))}

            <div className={`unallocated ${Math.abs(unallocated) < 1 ? 'zero' : unallocated < 0 ? 'neg' : ''}`}>
              <span>Unallocated</span>
              <span className="num">{money(unallocated)}</span>
            </div>
          </section>

          {usedCurrencies.length > 0 && (
            <RatesCard month={month} currencies={usedCurrencies} rates={data.fx} error={fxError} onSaved={reload} />
          )}

          {data.allocations.length === 0 && (
            <button className="btn" disabled={busy} onClick={copyFromLast}>
              Copy {monthName(addMonths(month, -1))}’s plan
            </button>
          )}
        </>
      )}

      {editing?.kind === 'income' && (
        <IncomeSheet month={month} row={editing.row} tags={tags} buckets={buckets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {editing?.kind === 'alloc' && (
        <AllocationSheet month={month} section={editing.section} row={editing.row} tags={tags} buckets={buckets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function Block(props: { title: string; hint: string; total: number; minus?: boolean; accent?: boolean; onAdd: () => void; addLabel: string; children: React.ReactNode }) {
  return (
    <div className={`block ${props.accent ? 'accent' : ''}`}>
      <div className="block-head">
        <div>
          <h2>{props.minus ? <span className="less">less </span> : null}{props.title}</h2>
          <span className="muted small">{props.hint}</span>
        </div>
        <span className="num strong">{props.minus && props.total > 0 ? `(${money(props.total)})` : money(props.total)}</span>
      </div>
      <ul className="rows">{props.children}</ul>
      <button className="add" onClick={props.onAdd}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {props.addLabel}
      </button>
    </div>
  );
}

function Row({ name, sub, native, amount, onEdit }: { name: string; sub?: string | null; native?: string; amount: number | null; onEdit: () => void }) {
  return (
    <li>
      <button className="row" onClick={onEdit}>
        <span className="row-main">
          <span className="tag">{name}</span>
          {sub && <span className="muted small">{sub}</span>}
        </span>
        <span className="row-amt">
          <span className="num">{money(amount)}</span>
          {native && <span className="muted small">{native}</span>}
        </span>
      </button>
    </li>
  );
}

function AllocRow({ a, tag, bucket, hkd, showActual, onEdit, onToggle }: {
  a: Allocation; tag?: Tag; bucket?: Bucket; hkd?: { amount: number | null; actual: number | null }; showActual?: boolean; onEdit: () => void; onToggle: () => void;
}) {
  const planned = hkd?.amount ?? 0;
  const actual = hkd?.actual ?? 0;
  const ratio = planned > 0 ? Math.min(1, actual / planned) : 0;
  const over = showActual && actual > planned;
  return (
    <li className="alloc">
      <button className={`tick ${a.done ? 'on' : ''}`} aria-pressed={a.done} aria-label={a.done ? 'Marked as moved' : 'Mark as moved'} onClick={onToggle}>
        {a.done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>}
      </button>
      <button className="row" onClick={onEdit}>
        <span className="row-main">
          <span className="tag">{tag?.name ?? '–'}</span>
          <span className="muted small">{[bucket ? `to ${bucket.name}` : null, a.note].filter(Boolean).join(' · ') || (a.done ? 'moved' : 'planned')}</span>
          {showActual && (
            <span className="meter" aria-label={`Spent ${money(actual)} of ${money(planned)}`}>
              <span className={`grow ${over ? 'over' : ''}`} style={{ width: `${(over ? 1 : ratio) * 100}%` }} />
            </span>
          )}
        </span>
        <span className="row-amt">
          <span className="num">{money(hkd?.amount ?? null)}</span>
          {showActual ? (
            <span className={`small ${over ? 'bad-text' : 'muted'}`}>{money(actual)} spent</span>
          ) : (
            a.currency !== 'HKD' && <span className="muted small">{money(Number(a.amount), a.currency)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="subtotal">
      <span>{label}</span>
      <span className="num">{money(value)}</span>
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
    { key: 'rest', label: 'Unassigned', v: rest },
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
