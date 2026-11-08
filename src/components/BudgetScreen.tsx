import { useCallback, useEffect, useMemo, useState } from 'react';
import { DisplayContext, makeDisplay, savedDisplay, saveDisplay, type Display, type DisplayCurrency } from '../lib/display';
import { defaultYear, emptyYear, loadBudget, saveYear, yearView, type BudgetData, type PlanLine, type YearBudget, type YearView } from '../lib/budget';
import { ratesFrom } from '../lib/fx';
import { makeHkdOf, rangeLabel } from '../lib/spend';
import { thisMonth } from '../lib/format';
import { commas, fmtNum } from '../lib/numInput';
import { currencyLabel, type Bucket, type Plan, type Tag } from '../lib/types';
import { useMonthFx } from '../lib/useFx';
import { Bud, type Mood } from './Bud';
import { PlanSheet } from './PlanSheet';
import { Sheet } from './Sheet';
import { Actions, useSubmit } from './LineSheets';

const PLAN_COLORS = ['var(--sky)', 'var(--peach)', 'var(--lilac)', 'var(--mint)', 'var(--yellow)', 'var(--teal)', 'var(--lime)'];
const M = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const FIRST_YEAR = 2026; // the year the books start

export function BudgetScreen({ buckets, tags, plans, onChange }: { buckets: Bucket[]; tags: Tag[]; plans: Plan[]; onChange: () => void }) {
  const planning = defaultYear();
  const [year, setYear] = useState(planning);
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayCur, setDisplayCur] = useState<DisplayCurrency>(savedDisplay());
  const [editYear, setEditYear] = useState<'plan' | 'tally' | null>(null);
  const [planOpen, setPlanOpen] = useState<{ plan?: Plan } | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadBudget());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const now = thisMonth();
  const rates = useMemo(() => ratesFrom(data?.fx ?? []), [data]);
  const missing = data && !data.fx.some((f) => f.currency === 'SGD' && f.month === now) ? ['SGD'] : [];
  useMonthFx(now, missing, reload);
  const d = makeDisplay(displayCur, rates);
  const pick = (c: DisplayCurrency) => { setDisplayCur(c); saveDisplay(c); };

  const view = useMemo(() => (data ? yearView(year, data, plans, buckets, planning) : null), [data, year, plans, buckets, planning]);
  const years = Array.from({ length: Math.max(planning, new Date().getFullYear()) - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  const hkdOf = useMemo(() => makeHkdOf(data?.fx ?? []), [data]);

  const header = (
    <header className="month-nav">
      <div className="month-title left">
        <span className="eyebrow">Budget</span>
        <h1>{year}</h1>
      </div>
      <div className="years" role="group" aria-label="Year">
        {years.map((y) => <button key={y} aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}
      </div>
    </header>
  );

  if (data?.missingTable) {
    return (
      <div className="screen">
        {header}
        <p className="card">The database needs one update first. Run <strong>010_budget.sql</strong> in the Supabase SQL Editor, then come back.</p>
      </div>
    );
  }

  const v = view;
  const mood: Mood = !v || v.free === null ? 'think' : v.free < 0 ? 'worried' : 'happy';
  const rowFor = (y: number): YearBudget => data?.years.find((r) => r.year === y) ?? emptyYear(y, displayCur);

  return (
    <DisplayContext.Provider value={d}>
      <div className="screen budget">
        {header}
        {error && <p className="error card" role="alert">{error}</p>}
        <div className="show-in" role="group" aria-label="Show amounts in">
          <span className="muted small">Show in</span>
          {(['SGD', 'HKD'] as DisplayCurrency[]).map((c) => (
            <button key={c} aria-pressed={d.cur === c} disabled={c === 'SGD' && !rates.SGD} onClick={() => pick(c)}>{c}</button>
          ))}
        </div>

        {!v ? (
          <p className="muted center">Opening the books…</p>
        ) : (
          <div className="alloc-layout">
            <aside className="side">
              <section className="card hero room">
                <div className="hero-text">
                  <span className="eyebrow">Room for {year} plans</span>
                  <span className={`big num ${v.room !== null && v.room < 0 ? 'neg-big' : ''}`}>{v.room === null ? '–' : d.show(v.room)}</span>
                  {v.room !== null && <span className="muted small">{d.alt(v.room)}</span>}
                  <span className="muted small">
                    {v.room !== null
                      ? 'After living costs and paying yourself first'
                      : v.livingSource === 'none'
                        ? `Shows once living costs are known: from your ${year - 1} tally, or after 3 full months of logging`
                        : 'Shows once your pay and Growth lines are on the Allocation screen'}
                  </span>
                </div>
                <Bud mood={mood} size={84} />
              </section>
              {v.room !== null && v.takeHome !== null && v.takeHome > 0 && <ShareCard v={v} d={d} />}
              {year - 1 >= FIRST_YEAR && <TallyCard v={v} d={d} onEdit={() => setEditYear('tally')} />}
              {v.plans.some((l) => l.months.length) && (
                <section className="card stack later">
                  <div className="block-head"><h2>When they land</h2><span className="muted small">on the plans’ dates</span></div>
                  <div className="months" aria-hidden="true">
                    {M.map((m, i) => {
                      const here = v.plans.map((l, k) => ({ l, k })).filter(({ l }) => l.months.includes(i));
                      return (
                        <div key={i}>
                          {m}
                          <div className="mcell">
                            {here.map(({ k }) => <span key={k} style={{ background: PLAN_COLORS[k % PLAN_COLORS.length] }} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="legend-keys">
                    {v.plans.map((l, k) => l.months.length
                      ? <span key={l.plan.id}><i style={{ background: PLAN_COLORS[k % PLAN_COLORS.length] }} />{l.plan.name}</span>
                      : <span key={l.plan.id} className="muted">{l.plan.name}: no dates</span>)}
                  </div>
                </section>
              )}
            </aside>

            <section className="card statement budget-statement" aria-label={`${year} budget`}>
              <BudgetLine title="Take-home pay" note={v.takeHomeNote + (v.bonus ? `, ${d.show(v.bonus)} bonus included` : '')} amount={v.takeHome} d={d} onEdit={() => setEditYear('plan')} />
              <BudgetLine minus title="Living costs" amount={v.living} d={d} onEdit={() => setEditYear('plan')}
                note={[
                  v.living !== null ? `${d.show(v.living / 12)} a month. ${v.livingNote}` : v.livingNote,
                  v.livingSource !== 'logged' && v.loggedMonths > 0 && v.loggedMonthly !== null ? `Logged so far: ${d.show(v.loggedMonthly)} a month (${v.loggedMonths} ${v.loggedMonths === 1 ? 'month' : 'months'})` : null,
                ].filter(Boolean).join('. ')} />
              <BudgetLine minus title="Pay yourself first" amount={v.growth} d={d} onEdit={() => setEditYear('plan')}
                note={v.growth !== null ? `${d.show(v.growth / 12)} a month to Growth. ${v.growthNote}` : v.growthNote} />
              <div className="subtotal"><span>Room for plans</span><span className="num">{v.room === null ? '–' : d.show(v.room)}</span></div>

              <div className="block plans-block">
                <div className="block-head">
                  <span className="group-title" style={{ '--accent': 'var(--sky)' } as React.CSSProperties}>{year} plans <span className="muted small">{v.plans.length}</span></span>
                  <button className="link small" onClick={() => setPlanOpen({})}>+ New plan</button>
                </div>
                {v.plans.length === 0 ? (
                  <p className="muted small">No plans dated in {year} yet. Add trips and big buys here or on the Expenses screen.</p>
                ) : (
                  <ul className="rows">
                    {v.plans.map((l) => <PlanRow key={l.plan.id} l={l} d={d} onOpen={() => setPlanOpen({ plan: l.plan })} />)}
                  </ul>
                )}
              </div>
              <div className="subtotal"><span>Plans so far</span><span className="num">{d.show(v.plansTotal)}</span></div>
              <div className={`unallocated ${v.free === null ? '' : v.free < 0 ? 'neg' : 'zero'}`}>
                <span>Still free</span><span className="num">{v.free === null ? '–' : d.show(v.free)}</span>
              </div>
              <p className="muted small budget-foot">
                {v.unpriced > 0
                  ? `For the ${v.unpriced === 1 ? 'plan' : `${v.unpriced} plans`} without an estimate. No estimate needed: as you log their costs, this goes down on its own.`
                  : 'Each plan counts its estimate, or what you’ve paid if that’s more.'}
              </p>
            </section>

          </div>
        )}

        {editYear === 'plan' && v && (
          <YearSheet row={rowFor(year)} v={v} d={d} onClose={() => setEditYear(null)} onSaved={() => { setEditYear(null); reload(); }} />
        )}
        {editYear === 'tally' && v && (
          <TallySheet row={rowFor(year - 1)} v={v} d={d} onClose={() => setEditYear(null)} onSaved={() => { setEditYear(null); reload(); }} />
        )}
        {planOpen && (
          <PlanSheet
            plan={planOpen.plan}
            expenses={(data?.expenses ?? []).filter((e) => planOpen.plan && e.plan_id === planOpen.plan.id)}
            tags={tags}
            hkdOf={hkdOf}
            onClose={() => setPlanOpen(null)}
            onSaved={() => { setPlanOpen(null); onChange(); reload(); }}
          />
        )}
      </div>
    </DisplayContext.Provider>
  );
}

function BudgetLine({ title, note, amount, d, minus, onEdit }: { title: string; note: string; amount: number | null; d: Display; minus?: boolean; onEdit: () => void }) {
  return (
    <button className="bline" onClick={onEdit}>
      <span className="row-main">
        <span className="tag">{minus && <span className="minus">−</span>}{title}</span>
        <span className="muted small">{note}</span>
      </span>
      <span className="row-amt"><span className="num">{amount === null ? '–' : d.show(amount)}</span></span>
    </button>
  );
}

function PlanRow({ l, d, onOpen }: { l: PlanLine; d: Display; onOpen: () => void }) {
  const p = l.plan;
  const when = p.starts_on && p.ends_on ? rangeLabel(p.starts_on, p.ends_on) : 'No dates yet';
  const sub = [when, l.paid > 0 ? `${d.show(l.paid)} paid so far` : 'nothing paid yet'].join(' · ');
  return (
    <li>
      <button className="row" onClick={onOpen}>
        <span className="row-main">
          <span className="tag">{p.name}</span>
          <span className="muted small">{sub}</span>
        </span>
        <span className="row-amt">
          {l.estimate !== null ? (
            <>
              <span className="num">{d.show(l.counts)}</span>
              <span className="muted small">{l.paid > l.estimate ? 'paid, over estimate' : 'estimate'}</span>
            </>
          ) : l.paid > 0 ? (
            <>
              <span className="num">{d.show(l.paid)}</span>
              <span className="guess small-guess">Rough guess?</span>
            </>
          ) : (
            <span className="guess">Rough guess?</span>
          )}
        </span>
      </button>
    </li>
  );
}

function ShareCard({ v, d }: { v: YearView; d: Display }) {
  const total = v.takeHome!;
  const parts = [
    { label: 'Living', value: v.living ?? 0, cls: 'living' },
    { label: 'Growth', value: v.growth ?? 0, cls: 'growth' },
    { label: 'Plans', value: Math.min(v.plansTotal, Math.max(0, v.room ?? 0)), cls: 'plans' },
    { label: 'Still free', value: Math.max(0, v.free ?? 0), cls: 'free' },
  ];
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const base = Math.max(total, sum);
  const pc = (x: number) => Math.round((x / total) * 100);
  return (
    <section className="card stack">
      <div className="block-head"><h2>Where {v.year} take-home goes</h2><span className="muted small num">{d.show(total)}</span></div>
      <div className="yb" aria-hidden="true">
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.cls} className={`grow ${p.cls}`} style={{ width: `${(p.value / base) * 100}%` }}>{p.value / base > 0.12 ? `${pc(p.value)}%` : ''}</span>
        ))}
      </div>
      <div className="legend-keys">
        {parts.map((p) => <span key={p.cls}><i className={p.cls} />{p.label} {pc(p.value)}%</span>)}
      </div>
      {v.room !== null && v.room < 0
        ? <p className="small bad-text">Living costs and paying yourself first already add up to {d.show(-v.room)} more than take-home pay.</p>
        : v.free !== null && v.free < 0 && <p className="small bad-text">Plans are {d.show(-v.free)} over the room. Paying yourself first stays as it is; the plans or living costs would need to give.</p>}
    </section>
  );
}

function TallyCard({ v, d, onEdit }: { v: YearView; d: Display; onEdit: () => void }) {
  const t = v.tally;
  return (
    <section className="card stack tally later">
      <div className="block-head">
        <h2>{t.year} tally</h2>
        <button className="link small" onClick={onEdit}>{t.spent === null ? 'Fill in' : 'Change'}</button>
      </div>
      {t.spent === null ? (
        <p className="muted small">
          What {t.year} really cost: take-home pay minus what you saved and invested. Needs only a few rough numbers from your own records.
        </p>
      ) : (
        <>
          <ul className="tally-rows">
            <li><span>Take-home pay</span><span className="num">{d.show(t.takeHome)}</span></li>
            {t.method === 'saved' ? (
              <>
                <li><span>− Saved and invested</span><span className="num">{d.show(t.saved)}</span></li>
                {t.cashChange !== 0 && <li><span>{t.cashChange > 0 ? '− Cash went up' : '+ Cash went down'}</span><span className="num">{d.show(Math.abs(t.cashChange))}</span></li>}
              </>
            ) : (
              <li><span>− Saved (net worth growth, gains taken out)</span><span className="num">{d.show(t.nwEnd! - t.nwStart! - (t.gains ?? 0))}</span></li>
            )}
            <li className="strong"><span>Spent in {t.year}</span><span className="num">{d.show(t.spent)}</span></li>
            {t.oneOffs > 0 && <li><span>− One-offs</span><span className="num">{d.show(t.oneOffs)}</span></li>}
          </ul>
          <p className="muted small">Living costs: <span className="num strong">{d.show(t.living)}</span> a month{v.livingSource === 'tally' ? `, used for ${v.year}` : ''}.</p>
        </>
      )}
    </section>
  );
}

/** A number field that may be left empty (empty = the app works it out). */
function Opt({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => { commas(e); onChange(e.target.value); }} />
      {hint && <span className="muted small hint-row">{hint}</span>}
    </label>
  );
}
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

function CurrencyPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <span>Numbers are in</span>
      <div className="segmented" role="radiogroup" aria-label="Currency">
        {['SGD', 'HKD'].map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} aria-selected={value === c} onClick={() => onChange(c)}>{currencyLabel(c)}</button>)}
      </div>
    </div>
  );
}

function YearSheet({ row, v, d, onClose, onSaved }: { row: YearBudget; v: YearView; d: Display; onClose: () => void; onSaved: () => void }) {
  const [cur, setCur] = useState(row.currency);
  const [takeHome, setTakeHome] = useState(fmtNum(row.take_home));
  const [bonus, setBonus] = useState(fmtNum(row.bonus));
  const [living, setLiving] = useState(fmtNum(row.living_monthly));
  const [growth, setGrowth] = useState(fmtNum(row.growth_monthly));
  const { busy, error, run } = useSubmit(onSaved);
  const auto = (hkd: number | null) => (hkd === null ? 'Not known yet' : `Leave empty to use ${d.inCur(hkd, cur)}`);
  const autoTakeHome = row.take_home === null && v.takeHome !== null ? v.takeHome - v.bonus : null;
  const autoLiving = row.living_monthly === null && v.living !== null ? v.living / 12 : null;
  const autoGrowth = row.growth_monthly === null && v.growth !== null ? v.growth / 12 : null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => saveYear({ ...row, currency: cur, take_home: numOrNull(takeHome), bonus: numOrNull(bonus), living_monthly: numOrNull(living), growth_monthly: numOrNull(growth) }));
  };
  return (
    <Sheet title={`${row.year} numbers`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">All optional. Anything left empty is worked out from what you log.</p>
        <CurrencyPick value={cur} onChange={setCur} />
        <Opt label="Take-home pay for the year" value={takeHome} onChange={setTakeHome} placeholder="Worked out" hint={row.take_home === null ? auto(autoTakeHome) : undefined} />
        <Opt label="Bonus or other income" value={bonus} onChange={setBonus} placeholder="None" hint="On top of take-home pay" />
        <Opt label="Living costs a month" value={living} onChange={setLiving} placeholder="Worked out" hint={row.living_monthly === null ? auto(autoLiving) : undefined} />
        <Opt label="Pay yourself first, a month" value={growth} onChange={setGrowth} placeholder="Worked out" hint={row.growth_monthly === null ? auto(autoGrowth) : undefined} />
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} />
      </form>
    </Sheet>
  );
}

function TallySheet({ row, v, d, onClose, onSaved }: { row: YearBudget; v: YearView; d: Display; onClose: () => void; onSaved: () => void }) {
  const t = v.tally;
  const [cur, setCur] = useState(row.currency);
  const [takeHome, setTakeHome] = useState(fmtNum(row.tally_take_home));
  const [saved, setSaved] = useState(fmtNum(row.tally_saved ?? null));
  const [cash, setCash] = useState(fmtNum(row.tally_cash_change ?? null));
  const [start, setStart] = useState(fmtNum(row.tally_nw_start));
  const [gains, setGains] = useState(fmtNum(row.tally_gains));
  const [oneOffs, setOneOffs] = useState(fmtNum(row.tally_one_offs));
  const [useNw, setUseNw] = useState(row.tally_saved == null && row.tally_nw_start != null);
  const { busy, error, run } = useSubmit(onSaved);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => saveYear({
      ...row, currency: cur, tally_take_home: numOrNull(takeHome), tally_one_offs: numOrNull(oneOffs),
      tally_saved: useNw ? null : numOrNull(saved), tally_cash_change: useNw ? null : numOrNull(cash),
      tally_nw_start: useNw ? numOrNull(start) : row.tally_nw_start, tally_gains: useNw ? numOrNull(gains) : row.tally_gains,
    }));
  };
  return (
    <Sheet title={`${row.year} tally`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          {useNw
            ? <>Spent = take-home pay − (net worth at the end − at the start − investment gains). Net worth at the end comes from your December close: {t.nwEnd === null ? 'not closed yet' : <span className="num strong">{d.inCur(t.nwEnd, cur)}</span>}.</>
            : 'Spent = take-home pay − what you saved and invested − how much your cash went up. Rough numbers are fine.'}
        </p>
        <CurrencyPick value={cur} onChange={setCur} />
        <Opt label={`Take-home pay in ${row.year}`} value={takeHome} onChange={setTakeHome} placeholder={t.takeHomeFromApp ? d.inCur(t.takeHome, cur) : 'From your records'} hint={t.takeHomeFromApp ? 'Leave empty to use the app’s 12 months' : 'All 12 months, after tax'} />
        {useNw ? (
          <>
            <Opt label={`Net worth on 1 January ${row.year}`} value={start} onChange={setStart} placeholder={t.nwStartFromApp ? 'From your December close' : 'From your records'} hint={t.nwStartFromApp ? 'Leave empty to use the December close before' : undefined} />
            <Opt label="Investment gains, roughly" value={gains} onChange={setGains} placeholder={t.appGains !== null ? 'Worked out' : '0'}
              hint={`Market and currency moves, which aren’t savings.${t.appGains !== null ? ` The app saw ${d.inCur(t.appGains, cur)} since your first close.` : ''}`} />
          </>
        ) : (
          <>
            <Opt label={`Saved and invested in ${row.year}`} value={saved} onChange={setSaved} placeholder="From your records" hint="Everything you put in: IBKR, SRS, other savings. Leave gains out" />
            <Opt label="Cash went up by (optional)" value={cash} onChange={setCash} placeholder="About the same" hint="Bank and cash balances at the end of the year minus the start. Use a minus if they went down" />
          </>
        )}
        <Opt label="Big one-offs that won’t repeat" value={oneOffs} onChange={setOneOffs} placeholder="None" hint="Trips or big buys, taken out of next year’s living costs" />
        <button type="button" className="link small" onClick={() => setUseNw(!useNw)}>{useNw ? 'Use what you saved instead' : 'Use net worth instead'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} />
      </form>
    </Sheet>
  );
}
