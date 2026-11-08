import { useCallback, useEffect, useMemo, useState } from 'react';
import { DisplayContext, makeDisplay, savedDisplay, saveDisplay, type Display, type DisplayCurrency } from '../lib/display';
import { money, monthName, monthOnly, pct, shortMonth, thisMonth, todayISO } from '../lib/format';
import { useMonthFx } from '../lib/useFx';
import { commas, fmtNum } from '../lib/numInput';
import {
  accountsToday, bridge, closeMonth, fireTarget, flowsSince, hasGain, isDebt, kindOf, loadNetWorth, ratesAt, saveClose, saveFire, totalsByMonth,
  computedValue, type AccountView, type Balance, type FireSettings, type NetWorthData,
} from '../lib/networth';
import { type Bucket, type Tag } from '../lib/types';
import { Bud, type Mood } from './Bud';
import { Sheet } from './Sheet';

const SECTIONS = ['Liquid', 'Locked until age', 'Illiquid', 'Debts'] as const;
const SECTION_TITLE: Record<string, string> = { Liquid: 'Liquid', 'Locked until age': 'Locked until an age', Illiquid: 'Illiquid', Debts: 'Debts' };
const sectionOf = (b: Bucket) => (isDebt(b) ? 'Debts' : SECTIONS.includes(b.liquidity as never) ? b.liquidity : 'Liquid');
const dayMonth = (iso: string) => `${Number(iso.slice(8))} ${shortMonth(iso.slice(0, 7) + '-01')}`;
const toHkd = (v: number, cur: string, rates: Record<string, number>) => (cur === 'HKD' ? v : rates[cur] ? v * rates[cur] : null);
/** What "put in so far" means for each kind of account. */
const PUT_IN_HINT: Record<string, string> = {
  Brokerage: 'Net deposits, e.g. IBKR “Deposits & withdrawals”',
  Equity: 'What you paid for the shares (0 if granted)',
  Retirement: 'Your contributions so far',
  Insurance: 'Premiums paid so far',
};
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

export function NetWorthScreen({ buckets, tags, onChange }: { buckets: Bucket[]; tags: Tag[]; onChange: () => void }) {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [editFire, setEditFire] = useState(false);
  const [displayCur, setDisplayCur] = useState<DisplayCurrency>(savedDisplay());

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadNetWorth());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const now = thisMonth();
  const rates = useMemo(() => ratesAt(data?.fx ?? [], now), [data, now]);
  const needed = useMemo(() => [...new Set([...buckets.filter((b) => b.active).map((b) => b.currency), 'SGD'])].filter((c) => c !== 'HKD'), [buckets]);
  const missing = data ? needed.filter((c) => !data.fx.some((f) => f.currency === c && f.month === now)) : [];
  useMonthFx(now, missing, reload);

  const d = makeDisplay(displayCur, rates);
  const pick = (c: DisplayCurrency) => { setDisplayCur(c); saveDisplay(c); };

  const accounts = useMemo(() => (data ? accountsToday(buckets, data, tags, rates) : []), [data, buckets, tags, rates]);
  const history = useMemo(() => (data ? totalsByMonth(buckets, data) : []), [data, buckets]);
  const hkdOf = (a: AccountView) => (a.value === null ? null : toHkd(a.value, a.b.currency, rates));

  let assets = 0, debts = 0, liquid = 0;
  for (const a of accounts) {
    const v = hkdOf(a) ?? 0;
    if (isDebt(a.b)) debts += v; else assets += v;
    if (kindOf(a.b) === 'card') liquid -= v;
    else if (!isDebt(a.b) && a.b.liquidity === 'Liquid') liquid += v;
  }
  const net = assets - debts;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const hasClose = !!last;
  const target = data ? fireTarget(data.settings) : null;
  const firePct = target ? Math.max(0, Math.min(1, liquid / target)) : 0;
  const mood: Mood = !hasClose ? 'think' : prev && last.net < prev.net ? 'worried' : prev && last.net > prev.net ? 'cheer' : 'happy';

  if (data?.missingTable) {
    return (
      <div className="screen">
        <Header />
        <p className="card">The database needs one update first. Run <strong>009_net_worth.sql</strong> in the Supabase SQL Editor, then come back.</p>
      </div>
    );
  }

  return (
    <DisplayContext.Provider value={d}>
      <div className="screen">
        <Header />
        {error && <p className="error card" role="alert">{error}</p>}
        <div className="show-in" role="group" aria-label="Show amounts in">
          <span className="muted small">Show in</span>
          {(['SGD', 'HKD'] as DisplayCurrency[]).map((c) => (
            <button key={c} aria-pressed={d.cur === c} disabled={c === 'SGD' && !rates.SGD} onClick={() => pick(c)}>{c}</button>
          ))}
        </div>

        {!data ? (
          <p className="muted center">Opening the books…</p>
        ) : (
          <div className="alloc-layout">
            <aside className="side">
              <section className="card hero">
                <div className="hero-text">
                  <span className="eyebrow">Net worth</span>
                  <span className="big num nw-big">{hasClose ? d.show(net) : '–'}</span>
                  {hasClose && <span className="muted small">{d.alt(net)}</span>}
                  <span className="muted small">
                    {hasClose ? `Estimate for today · last closed ${dayMonth(last.closedOn)}` : 'Close your first month to start tracking'}
                  </span>
                  <button className="btn primary nw-close-btn" onClick={() => setClosing(true)}>
                    {last?.month === closeMonth() ? `Redo ${monthOnly(closeMonth())} close` : `Close ${monthOnly(closeMonth())}`}
                  </button>
                </div>
                <Bud mood={mood} size={88} coin={mood === 'cheer'} />
              </section>

              <section className="card stack fire">
                <div className="block-head">
                  <h2>Freedom number</h2>
                  <span className="num strong">{pct(firePct)}</span>
                </div>
                <div className="fire-bar" aria-hidden="true"><span className="grow" style={{ width: `${firePct * 100}%` }} /></div>
                <div className="fire-row">
                  <span><span className="num strong">{d.show(liquid)}</span> <span className="muted small">liquid</span></span>
                  <span className="muted small">of <span className="num">{d.show(target)}</span></span>
                </div>
                <button className="assumptions" onClick={() => setEditFire(true)}>
                  Assumes {money(data.settings.fire_monthly_spend, 'HKD')} a month, all in (rent included), and a {(data.settings.withdrawal_rate * 100).toFixed(1).replace(/\.0$/, '')}% yearly withdrawal. <span className="link">Change</span>
                </button>
              </section>

              {last && prev && <ChangeCard buckets={buckets} data={data} from={prev.month} to={last.month} total={last.net - prev.net} d={d} />}
              {history.length > 0 && (
                <section className="card stack">
                  <h2 className="card-h">Past closes</h2>
                  <ul className="rows bridge">
                    {[...history].reverse().map((h) => (
                      <li key={h.month} className="bridge-row">
                        <span className="row-main"><span className="tag">{monthName(h.month)}</span><span className="muted small">Closed {dayMonth(h.closedOn)}</span></span>
                        <span className="num">{d.show(h.net)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {history.length >= 2 && <Chart points={history.map((h) => ({ month: h.month, value: h.net }))} d={d} />}
            </aside>

            <section className="card statement" aria-label="Balance sheet">
              {SECTIONS.map((s) => {
                const items = accounts.filter((a) => sectionOf(a.b) === s);
                if (!items.length) return null;
                const total = items.reduce((t, a) => t + (hkdOf(a) ?? 0), 0);
                return (
                  <div key={s} className="block">
                    <div className="block-head">
                      <h2 className={`group-title l-${s.split(' ')[0]}`}>{SECTION_TITLE[s]}</h2>
                      <span className="num strong">{s === 'Debts' && total > 0 ? '−' : ''}{d.show(total)}</span>
                    </div>
                    {s === 'Liquid' && <p className="muted small nw-hint">Counts toward your freedom number</p>}
                    <ul className="rows">
                      {items.map((a) => <AccountRow key={a.b.id} a={a} hkd={hkdOf(a)} d={d} />)}
                    </ul>
                  </div>
                );
              })}
              <div className="subtotal"><span>Assets</span><span className="num">{d.show(assets)}</span></div>
              <div className="subtotal"><span>Less debts</span><span className="num">{debts > 0 ? '−' : ''}{d.show(debts)}</span></div>
              <div className="unallocated"><span>Net worth</span><span className="num">{d.show(net)}</span></div>
            </section>
          </div>
        )}

        {closing && data && (
          <CloseSheet buckets={buckets} tags={tags} data={data} onClose={() => setClosing(false)}
            onSaved={() => { setClosing(false); onChange(); reload(); }} />
        )}
        {editFire && data && (
          <FireSheet s={data.settings} onClose={() => setEditFire(false)} onSaved={() => { setEditFire(false); reload(); }} />
        )}
      </div>
    </DisplayContext.Provider>
  );
}

function Header() {
  return (
    <header className="month-nav">
      <div className="month-title left">
        <span className="eyebrow">Balance sheet</span>
        <h1>Net worth</h1>
      </div>
    </header>
  );
}

function AccountRow({ a, hkd, d }: { a: AccountView; hkd: number | null; d: Display }) {
  const { b } = a;
  const gain = a.putIn !== null && a.value !== null ? a.value - a.putIn : null;
  const sub = gain !== null
    ? <>Put in {money(a.putIn, b.currency)} · <span className={gain >= 0 ? 'credit' : 'bad-text'}>{gain >= 0 ? '+' : '−'}{money(Math.abs(gain), b.currency)}{a.putIn ? ` (${gain >= 0 ? '+' : '−'}${Math.abs((gain / a.putIn) * 100).toFixed(1)}%)` : ''}</span></>
    : a.value === null ? 'Not closed yet'
    : kindOf(b) === 'card' ? 'Charged, not settled yet'
    : kindOf(b) === 'loan' ? 'From the repayment schedule'
    : b.type === 'Insurance' && b.surrender_value != null ? 'Surrender value'
    : b.type === 'Equity' && !a.estimated ? 'Shares × price'
    : a.estimated && a.last ? `Closed ${dayMonth(a.last.closed_on)}${a.moved ? ' + logged since' : ''}`
    : b.institution ?? '';
  return (
    <li className={`nw-row t-${b.type}`}>
      <div className="row">
        <span className="row-main">
          <span className="tag"><span className="acct-dot" aria-hidden="true" />{b.name}</span>
          <span className="muted small">{sub}</span>
        </span>
        <span className="row-amt">
          <span className="num">{a.value === null ? '–' : money(a.value, b.currency)}</span>
          {b.currency !== d.cur && hkd !== null && <span className="muted small num">{d.show(hkd)}</span>}
        </span>
      </div>
    </li>
  );
}

function ChangeCard({ buckets, data, from, to, total, d }: { buckets: Bucket[]; data: NetWorthData; from: string; to: string; total: number; d: Display }) {
  const { gains, currency } = bridge(buckets, data, from, to);
  const saved = total - gains - currency;
  const line = (label: string, hint: string, v: number) => (
    <li className="bridge-row">
      <span className="row-main"><span className="tag">{label}</span><span className="muted small">{hint}</span></span>
      <span className={`num ${v >= 0 ? 'credit' : 'bad-text'}`}>{v >= 0 ? '+' : '−'}{d.show(Math.abs(v))}</span>
    </li>
  );
  return (
    <section className="card stack">
      <div className="block-head">
        <h2>What changed in {monthOnly(to)}</h2>
        <span className={`num strong ${total >= 0 ? 'credit' : 'bad-text'}`}>{total >= 0 ? '+' : '−'}{d.show(Math.abs(total))}</span>
      </div>
      <ul className="rows bridge">
        {line('Saved', 'Income kept, less spending', saved)}
        {line('Investment gains', 'Value change beyond money put in', gains)}
        {line('Currency', 'Exchange rates moving', currency)}
      </ul>
      <span className="muted small">Since {monthName(from)} close</span>
    </section>
  );
}

function Chart({ points, d }: { points: { month: string; value: number }[]; d: Display }) {
  const W = 320, H = 120, P = 8;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  return (
    <section className="card stack">
      <div className="block-head"><h2>Month by month</h2><span className="muted small">{d.show(hi)} high</span></div>
      <svg className="nw-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net worth at each close">
        <path d={path} className="nw-line" pathLength={1} />
        {points.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.value)} r={3.5} className="nw-pt"><title>{`${monthName(p.month)}: ${d.show(p.value)}`}</title></circle>)}
      </svg>
      <div className="nw-axis muted small"><span>{shortMonth(points[0].month)}</span><span>{shortMonth(points[points.length - 1].month)}</span></div>
    </section>
  );
}

function FireSheet({ s, onClose, onSaved }: { s: FireSettings; onClose: () => void; onSaved: () => void }) {
  const [spend, setSpend] = useState(fmtNum(s.fire_monthly_spend));
  const [rate, setRate] = useState(String(Math.round(s.withdrawal_rate * 1000) / 10));
  const [err, setErr] = useState<string | null>(null);
  const sp = num(spend), r = Number(rate) / 100;
  const preview = sp && r > 0 ? fireTarget({ fire_monthly_spend: sp, withdrawal_rate: r }) : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sp || !(r > 0)) return setErr('Fill in both numbers.');
    try { await saveFire({ fire_monthly_spend: sp, withdrawal_rate: r }); onSaved(); } catch (x) { setErr((x as Error).message); }
  }
  return (
    <Sheet title="Freedom number" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">Monthly spending, all in (HKD)<input inputMode="decimal" value={spend} onInput={commas} onChange={(e) => setSpend(e.target.value)} /></label>
        <label className="field">Yearly withdrawal rate (%)<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <p className="muted small">Target = monthly spending × 12 ÷ withdrawal rate{preview ? <> = <strong>{money(preview, 'HKD')}</strong></> : ''}. 3.5% suits a retirement that may last 50+ years.</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Sheet>
  );
}

/** Once a month: type the values that move with markets; the rest is worked out. */
function CloseSheet({ buckets, tags, data, onClose, onSaved }: { buckets: Bucket[]; tags: Tag[]; data: NetWorthData; onClose: () => void; onSaved: () => void }) {
  const month = closeMonth();
  const today = todayISO();
  const rates = ratesAt(data.fx, month);
  const redo = data.balances.some((x) => x.month === month);
  const open = buckets.filter((b) => b.active);
  // Pre-fills start from the close before this month's.
  const prior = (b: Bucket) => data.balances.find((x) => x.bucket_id === b.id && x.month < month) ?? null;
  // Redoing a month: start from what you saved for it, so you only override what changed.
  const saved = (b: Bucket) => data.balances.find((x) => x.bucket_id === b.id && x.month === month) ?? null;
  const savedOn = data.balances.find((x) => x.month === month)?.closed_on;
  const init = () => {
    const v: Record<string, { value: string; moneyIn: string; putIn: string }> = {};
    for (const b of open) {
      const p = prior(b);
      const comp = computedValue(b, data, rates);
      const f = p ? flowsSince(b, p.closed_on, data, tags, rates) : { moneyIn: 0, spent: 0 };
      const guess = comp?.value ?? (p ? p.value + (kindOf(b) === 'property' ? 0 : f.moneyIn - f.spent) : null);
      const sv = saved(b);
      v[b.id] = {
        value: sv ? fmtNum(sv.value) : guess === null ? '' : fmtNum(Math.round(guess * 100) / 100),
        moneyIn: !(p && hasGain(b)) ? '' : sv ? fmtNum(sv.money_in) : fmtNum(Math.round(f.moneyIn * 100) / 100),
        putIn: fmtNum(b.put_in_before ?? ''),
      };
    }
    return v;
  };
  const [vals, setVals] = useState(init);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, k: 'value' | 'moneyIn' | 'putIn', s: string) => setVals((v) => ({ ...v, [id]: { ...v[id], [k]: s } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rows: Balance[] = [];
    const putIn: Record<string, number | null> = {};
    for (const b of open) {
      const v = vals[b.id];
      const debt = isDebt(b);
      const comp = debt ? computedValue(b, data, rates) : null;
      const value = debt ? comp?.value ?? num(v.value) : num(v.value);
      if (value === null) continue; // left blank: skipped this month
      rows.push({ month, closed_on: today, bucket_id: b.id, value, money_in: prior(b) && hasGain(b) ? num(v.moneyIn) ?? 0 : 0, source: comp?.source ?? 'typed', note: null });
      if (hasGain(b) && !prior(b)) {
        const p = num(v.putIn);
        if (p !== (b.put_in_before ?? null)) putIn[b.id] = p;
      }
    }
    if (!rows.length) return setErr('Type at least one value.');
    setBusy(true);
    try { await saveClose(rows, putIn); onSaved(); } catch (x) { setErr((x as Error).message); setBusy(false); }
  }

  return (
    <Sheet title={`${redo ? 'Redo' : 'Close'} ${monthName(month)}`} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          {redo && savedOn
            ? <>You closed {monthOnly(month)} on {dayMonth(savedOn)}. Your saved values are filled in: change any box to override it. </>
            : <>Values as of today, {dayMonth(today)}, each in its own currency. Pre-filled from your last close plus what you’ve logged since. </>}
          Leave a box empty to skip an account.
        </p>
        <div className="close-list">
          {SECTIONS.map((s) => {
            const items = open.filter((b) => sectionOf(b) === s);
            if (!items.length) return null;
            return (
              <fieldset key={s} className="close-group">
                <legend className={`group-title l-${s.split(' ')[0]}`}>{SECTION_TITLE[s]}</legend>
                {items.map((b) => {
                  const v = vals[b.id];
                  const debt = isDebt(b);
                  const comp = debt ? computedValue(b, data, rates) : null;
                  const first = !prior(b);
                  const p = prior(b), sv = saved(b);
                  const was = sv && !debt ? `Saved ${money(sv.value, b.currency)}` : p ? `Last close ${money(p.value, b.currency)}` : debt ? '' : 'First close';
                  return (
                    <div key={b.id} className={`close-row t-${b.type}`}>
                      <span className="close-name"><span className="close-title"><span className="acct-dot" aria-hidden="true" />{b.name}</span>{was && <span className="muted small">{was}</span>}</span>
                      {debt && comp ? (
                        <span className="close-auto"><span className="num">{money(comp.value, b.currency)}</span><span className="muted small">{kindOf(b) === 'card' ? 'not settled yet' : 'from schedule'}</span></span>
                      ) : (
                        <label className="close-field">
                          <span className="sr-only">{b.name} value</span>
                          <span className="cur">{b.currency}</span>
                          <input inputMode="decimal" placeholder="Value" value={v.value} onInput={commas} onChange={(e) => set(b.id, 'value', e.target.value)} />
                        </label>
                      )}
                      {hasGain(b) && kindOf(b) !== 'property' && (first ? (
                        <label className="close-sub"><span>Put in so far <em className="muted">{PUT_IN_HINT[b.type] ?? 'Money you put in so far'}</em></span>
                          <input inputMode="decimal" placeholder="Optional" value={v.putIn} onInput={commas} onChange={(e) => set(b.id, 'putIn', e.target.value)} />
                        </label>
                      ) : (
                        <label className="close-sub"><span>Money in since last close <em className="muted">from Allocation; minus if taken out</em></span>
                          <input inputMode="decimal" value={v.moneyIn} onInput={commas} onChange={(e) => set(b.id, 'moneyIn', e.target.value)} />
                        </label>
                      ))}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save close</button></div>
      </form>
    </Sheet>
  );
}
