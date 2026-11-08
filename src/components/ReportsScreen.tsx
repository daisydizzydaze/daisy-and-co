import { useCallback, useEffect, useMemo, useState } from 'react';
import { DisplayContext, makeDisplay, savedDisplay, type Display } from '../lib/display';
import { BOOKS_START, monthName, thisMonth } from '../lib/format';
import { ratesAt } from '../lib/networth';
import {
  buildReport, dayMonth, endOf, loadReports, periodAt, periodLabel, periodShort, shift,
  type Line, type Period, type PeriodKind, type Report, type ReportData, type Status,
} from '../lib/reports';
import type { Bucket, Plan, Tag } from '../lib/types';
import { Bud, type Mood } from './Bud';
import { Sheet } from './Sheet';

type Q = 'means' | 'richer' | 'runway' | 'creep' | 'addUp';
type Full = 'income' | 'balance' | 'cash' | null;
const KINDS: { k: PeriodKind; label: string }[] = [{ k: 'month', label: 'Month' }, { k: 'quarter', label: 'Quarter' }, { k: 'year', label: 'Year' }];

const signed = (d: Display, v: number) => `${v > 0 ? '+' : ''}${d.show(v)}`;
const pctOf = (r: number) => `${Math.round(r * 100)}%`;
const signedPct = (r: number) => `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(Math.round(r * 100))}%`;

export function ReportsScreen({ buckets, tags, plans }: { buckets: Bucket[]; tags: Tag[]; plans: Plan[] }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(() => periodAt('month'));
  const [open, setOpen] = useState<Q | null>(null);
  const [full, setFull] = useState<Full>(null);

  const reload = useCallback(async () => {
    try { setError(null); setData(await loadReports()); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const rates = useMemo(() => ratesAt(data?.fx ?? [], thisMonth()), [data]);
  const d = makeDisplay(savedDisplay(), rates);
  const report = useMemo(() => (data ? buildReport(period, data, buckets, tags, plans) : null), [data, period, buckets, tags, plans]);
  const canNext = shift(period, 1).start <= thisMonth();
  const canPrev = endOf(shift(period, -1)) >= BOOKS_START;
  const pick = (k: PeriodKind) => { setPeriod(periodAt(k, period.kind === k ? period.start : thisMonth())); };

  return (
    <DisplayContext.Provider value={d}>
      <div className="screen reports">
        <header className="month-nav">
          <button className="icon-btn" aria-label="Earlier" disabled={!canPrev} onClick={() => setPeriod(shift(period, -1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="month-title">
            <span className="eyebrow">Reports</span>
            <h1>{periodLabel(period)}</h1>
            {report?.inProgress && <span className="funded">So far</span>}
          </div>
          <button className="icon-btn" aria-label="Later" disabled={!canNext} onClick={() => setPeriod(shift(period, 1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </header>

        <div className="segmented three" role="tablist" aria-label="Period">
          {KINDS.map(({ k, label }) => <button key={k} role="tab" aria-selected={period.kind === k} onClick={() => pick(k)}>{label}</button>)}
        </div>

        {error && <p className="error card" role="alert">{error}</p>}
        {!report ? <p className="muted center">Opening the books…</p> : (
          <>
            <Glance r={report} p={period} />
            <section className="card health" aria-label="Health check">
              <Question q="means" open={open} setOpen={setOpen} {...meansRow(report, period, d)}>
                <MeansDetail r={report} d={d} onFull={() => setFull('income')} />
              </Question>
              <Question q="richer" open={open} setOpen={setOpen} {...richerRow(report, d)}>
                <RicherDetail r={report} d={d} onFull={() => setFull('balance')} />
              </Question>
              <Question q="runway" open={open} setOpen={setOpen} {...runwayRow(report)}>
                <RunwayDetail r={report} d={d} />
              </Question>
              <Question q="creep" open={open} setOpen={setOpen} {...creepRow(report, d)}>
                <CreepDetail r={report} d={d} />
              </Question>
              <Question q="addUp" open={open} setOpen={setOpen} {...addUpRow(report, d)}>
                <CashDetail r={report} d={d} onFull={() => setFull('cash')} />
              </Question>
            </section>
            <section className="card stack">
              <h2 className="card-h">Statements</h2>
              <div className="stmt-btns">
                <button onClick={() => setFull('income')}>Income statement</button>
                <button onClick={() => setFull('balance')}>Balance sheet</button>
                <button onClick={() => setFull('cash')}>Cash flow</button>
              </div>
              <span className="muted small">The full company statements for {periodLabel(period)}, every line.</span>
            </section>
            {full && (
              <Sheet title={full === 'income' ? 'Income statement' : full === 'balance' ? 'Balance sheet' : 'Cash flow'} onClose={() => setFull(null)}>
                <p className="muted small" style={{ margin: 0 }}>{periodLabel(period)}{report.inProgress ? ' so far' : ''}</p>
                {full === 'income' && <IncomeStatement r={report} d={d} />}
                {full === 'balance' && <BalanceSheet r={report} d={d} />}
                {full === 'cash' && <CashFlow r={report} d={d} />}
              </Sheet>
            )}
          </>
        )}
      </div>
    </DisplayContext.Provider>
  );
}

// ---------- glance ----------

const WATCH: Record<Q, string> = {
  means: 'you kept less than you planned to pay yourself.',
  richer: 'net worth went down.',
  runway: 'cash & bank covers under 6 months of spending.',
  creep: 'spending is above your usual.',
  addUp: 'some money moved that wasn’t logged.',
};

function Glance({ r, p }: { r: Report; p: Period }) {
  const all: [Q, Status][] = [['means', r.means.status], ['richer', r.richer.status], ['runway', r.runway.status], ['creep', r.creep.status], ['addUp', r.addUp.status]];
  const checked = all.filter(([, s]) => s !== 'none');
  const good = checked.filter(([, s]) => s === 'good').length;
  const worst = checked.find(([, s]) => s === 'bad') ?? checked.find(([, s]) => s === 'watch');
  const mood: Mood = !checked.length ? 'think' : checked.some(([, s]) => s === 'bad') ? 'worried' : good === checked.length ? 'cheer' : 'happy';
  const extra = worst?.[0] === 'creep' && r.creep.cats[0] && r.creep.cats[0].change! > 0 ? ` Biggest jump: ${r.creep.cats[0].label}.` : '';
  return (
    <section className={`card hero glance ${checked.length && good === checked.length ? 'win' : ''}`}>
      <div className="hero-text">
        <span className="eyebrow">{periodShort(p)} at a glance</span>
        <span className="glance-title">{checked.length ? `${good} of ${checked.length} look healthy` : 'Not enough to check yet'}</span>
        <span className="muted small">
          {!checked.length ? 'Fills in as you log pay, spending and month closes.'
            : worst ? `One to watch: ${WATCH[worst[0]]}${extra}`
            : 'Everything checked looks good.'}
          {checked.length > 0 && checked.length < 5 && ` ${5 - checked.length} need more data.`}
          {r.partStart && ' Spending counts from November 2026, when your books start.'}
        </span>
      </div>
      <Bud mood={mood} size={60} coin={mood === 'cheer'} />
    </section>
  );
}

// ---------- rows ----------

interface Row { status: Status; title: string; sub: string; answer: string; answerSub?: string }

function Question({ q, open, setOpen, status, title, sub, answer, answerSub, children }: Row & { q: Q; open: Q | null; setOpen: (q: Q | null) => void; children: React.ReactNode }) {
  const isOpen = open === q;
  const empty = status === 'none';
  return (
    <div className={`hq-wrap ${isOpen ? 'open' : ''}`}>
      <button className="hq" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : q)} disabled={empty}>
        <span className={`sd ${status}`} aria-label={status === 'good' ? 'Healthy' : status === 'watch' ? 'Watch' : status === 'bad' ? 'Needs attention' : 'Not enough data'} />
        <span className="q"><span className="tag">{title}</span><span className="muted small">{sub}</span></span>
        <span className="a"><span className="num">{answer}</span>{answerSub && <span className="muted small">{answerSub}</span>}</span>
        {!empty && <svg className="cv" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>}
      </button>
      {isOpen && !empty && <div className="detail">{children}</div>}
    </div>
  );
}

function meansRow(r: Report, p: Period, d: Display): Row {
  const m = r.means;
  if (m.rate === null) return { status: 'none', title: 'Am I living within my means?', sub: `No pay for ${periodShort(p)} on Allocation yet`, answer: '–' };
  return {
    status: m.status, title: 'Am I living within my means?',
    sub: `Kept ÷ take-home${m.plannedRate !== null ? ` · plan was ${pctOf(m.plannedRate)}` : ''}`,
    answer: pctOf(m.rate), answerSub: `kept ${d.show(m.kept)}`,
  };
}
function richerRow(r: Report, d: Display): Row {
  const x = r.richer;
  const title = 'Am I getting richer?';
  if (!x.end) return { status: 'none', title, sub: 'Close the month on Net worth to see this', answer: '–' };
  if (x.change === null) return { status: 'none', title, sub: 'First close: the change shows from your next one', answer: d.show(x.end.net) };
  return { status: x.status, title, sub: `Net worth change since the ${monthName(x.prev!.month).split(' ')[0]} close`, answer: signed(d, x.change), answerSub: `${d.show(x.end.net)} now` };
}
function runwayRow(r: Report): Row {
  const x = r.runway;
  const title = 'Could I ride out a bad month?';
  if (x.cash === null) return { status: 'none', title, sub: 'Needs a Net worth close', answer: '–' };
  if (x.months === null) return { status: 'none', title, sub: 'Needs a full month of logged spending', answer: '–' };
  return { status: x.status, title, sub: 'Cash & bank ÷ monthly spending · goal 6', answer: `${x.months >= 10 ? Math.round(x.months) : x.months.toFixed(1)} months`, answerSub: 'of runway' };
}
function creepRow(r: Report, d: Display): Row {
  const x = r.creep;
  const title = 'Is spending creeping up?';
  if (x.change === null) return { status: 'none', title, sub: 'Needs a full earlier period of logging to compare', answer: d.show(x.now) };
  if (x.partial) return { status: x.status, title, sub: `Spent so far ${x.basis}`, answer: `${pctOf(x.now / x.usual!)}`, answerSub: 'of a usual ' + (x.basis.includes('quarter') ? 'quarter' : x.basis.includes('year') ? 'year' : 'month') };
  return { status: x.status, title, sub: x.basis, answer: signedPct(x.change), answerSub: d.show(x.now) };
}
function addUpRow(r: Report, d: Display): Row {
  const x = r.addUp;
  const title = 'Does every dollar add up?';
  if (x.gap === null) return { status: 'none', title, sub: 'Needs two Net worth closes', answer: '–' };
  return x.status === 'good'
    ? { status: 'good', title, sub: 'Logged money vs your cash & bank closes', answer: '✓', answerSub: 'all tracked' }
    : { status: 'watch', title, sub: 'Logged money vs your cash & bank closes', answer: d.show(Math.abs(x.gap)), answerSub: 'not logged' };
}

// ---------- short statements ----------

function L({ label, amt, note, minus, strong }: { label: string; amt: string; note?: string; minus?: boolean; strong?: boolean }) {
  return (
    <div className={`rl ${strong ? 'total' : ''}`}>
      <span className="row-main"><span className="tag">{minus && <span className="minus">−</span>}{label}</span>{note && <span className="muted small">{note}</span>}</span>
      <span className="num">{amt}</span>
    </div>
  );
}
const top = (lines: Line[], d: Display, n = 2) =>
  lines.slice(0, n).map((l) => `${l.label} ${d.show(l.hkd)}`).join(' · ') + (lines.length > n ? ` · ${lines.length - n} more` : '');

function MeansDetail({ r, d, onFull }: { r: Report; d: Display; onFull: () => void }) {
  const m = r.means;
  return (
    <>
      <span className="stmt-tag">Income statement</span>
      <L label="Take-home" amt={d.show(m.takeHome)} note={m.tax ? `Pay ${d.show(m.gross)} − tax set aside ${d.show(m.tax)}` : undefined} />
      <L minus label="Needs" amt={d.show(m.needs)} note={top(m.needCats, d) || undefined} />
      <L minus label="Wants" amt={d.show(m.wants)} note={top(m.wantCats, d) || undefined} />
      {m.plans > 0 && <L minus label="Plans" amt={d.show(m.plans)} note={top(m.planLines, d)} />}
      <L strong label="Kept" amt={d.show(m.kept)} />
      <button className="link small" onClick={onFull}>Full income statement</button>
    </>
  );
}

/** "Saved S$4,382 · markets S$3,646", leaving out parts that round to nothing. */
const moved = (x: Report['richer'], d: Display) =>
  ([['Saved', x.saved], ['markets', x.gains], ['currency', x.currency]] as [string, number | null][])
    .filter(([, v], i) => i === 0 || Math.abs(v ?? 0) >= 1)
    .map(([k, v]) => `${k} ${d.show(v)}`).join(' · ');

function RicherDetail({ r, d, onFull }: { r: Report; d: Display; onFull: () => void }) {
  const x = r.richer;
  const owned = x.sections.filter((s) => s.label !== 'Debts');
  const debt = x.sections.find((s) => s.label === 'Debts');
  const short = (l: string) => (l === 'Locked until age' ? 'locked' : l.toLowerCase());
  return (
    <>
      <span className="stmt-tag">Balance sheet</span>
      <L label="What you own" amt={d.show(owned.reduce((s, x) => s + x.hkd, 0))} note={owned.map((s) => `${short(s.label)} ${d.show(s.hkd)}`).join(' · ')} />
      {debt && <L minus label="What you owe" amt={d.show(debt.hkd)} note={debt.accounts.map((a) => `${a.label} ${d.show(a.hkd)}`).join(' · ')} />}
      <L strong label="Net worth" amt={d.show(x.end!.net)} />
      {x.change !== null && (
        <L label="Why it moved" amt={signed(d, x.change)} note={moved(x, d)} />
      )}
      <button className="link small" onClick={onFull}>Full balance sheet</button>
    </>
  );
}

function RunwayDetail({ r, d }: { r: Report; d: Display }) {
  const x = r.runway;
  return (
    <>
      <span className="stmt-tag">From your balance sheet</span>
      <L label="Cash & bank" amt={d.show(x.cash)} note={x.closeMonth ? `At your ${monthName(x.closeMonth).split(' ')[0]} close` : undefined} />
      <L label="÷ Monthly spending" amt={d.show(x.monthly)} note={`Your ${x.avgOver === 1 ? 'last full month' : `${x.avgOver}-month average`}, plan costs left out`} />
      <L strong label="Runway" amt={`${x.months!.toFixed(1)} months`} />
      <span className="muted small">The goal is 6 months. {x.months! > 6 && x.monthly ? `About ${d.show(x.cash! - 6 * x.monthly)} above that could go to Growth.` : ''}</span>
    </>
  );
}

function CreepDetail({ r, d }: { r: Report; d: Display }) {
  const x = r.creep;
  return (
    <>
      <span className="stmt-tag">From your income statement</span>
      <L label={x.partial ? 'Everyday spending so far' : 'Everyday spending'} amt={d.show(x.now)} note={`${x.partial ? 'A usual whole period' : 'Usual'}: ${d.show(x.usual)} · plan costs left out`} />
      {x.cats.slice(0, 4).map((c) => (
        <L key={c.label} label={c.label} amt={signed(d, c.change!)} note={`${d.show(c.hkd)} vs ${d.show(c.base)}`} />
      ))}
    </>
  );
}

function CashDetail({ r, d, onFull }: { r: Report; d: Display; onFull: () => void }) {
  const x = r.addUp;
  return (
    <>
      <span className="stmt-tag">Cash flow</span>
      <CashLines r={r} d={d} />
      <span className="muted small">{x.status === 'good' ? '✓ Matches your cash & bank closes.' : `Your cash & bank changed by ${signed(d, x.actual!)}, but logged money explains ${signed(d, x.logged!)}. Something isn’t logged yet, or a close needs a fix.`}</span>
      <button className="link small" onClick={onFull}>Full cash flow</button>
    </>
  );
}

function CashLines({ r, d }: { r: Report; d: Display }) {
  const x = r.addUp;
  return (
    <>
      <L label="Pay received" amt={signed(d, x.pay)} />
      {x.other > 0 && <L label="Other money in" amt={signed(d, x.other)} note="Moved in from other accounts" />}
      <L minus label="Spending paid" amt={d.show(x.direct + x.cards)} note={`Card bills ${d.show(x.cards)} · cash and bank ${d.show(x.direct)}`} />
      <L minus label="Invested" amt={d.show(x.invested)} note="Your Growth lines" />
      {x.debts > 0 && <L minus label="Debt repayments" amt={d.show(x.debts)} />}
      <L strong label="Cash change" amt={signed(d, x.logged!)} />
    </>
  );
}

// ---------- full statements ----------

function IncomeStatement({ r, d }: { r: Report; d: Display }) {
  const m = r.means;
  if (m.rate === null) return <p className="muted">No pay on the Allocation screen for this period yet.</p>;
  return (
    <div className="full-stmt">
      <L label="Pay" amt={d.show(m.gross)} note={`${m.payMonths} month${m.payMonths === 1 ? '' : 's'} of pay that fund this period`} />
      <L minus label="Tax set aside" amt={d.show(m.tax)} />
      <L strong label="Take-home" amt={d.show(m.takeHome)} />
      <div className="fs-head">Needs <span className="num">{d.show(m.needs)}</span></div>
      {m.needCats.map((c) => <L key={c.label} label={c.label} amt={d.show(c.hkd)} />)}
      <div className="fs-head">Wants <span className="num">{d.show(m.wants)}</span></div>
      {m.wantCats.map((c) => <L key={c.label} label={c.label} amt={d.show(c.hkd)} />)}
      {m.plans > 0 && <><div className="fs-head">Plans <span className="num">{d.show(m.plans)}</span></div>{m.planLines.map((c) => <L key={c.label} label={c.label} amt={d.show(c.hkd)} />)}</>}
      <L strong label="Kept" amt={d.show(m.kept)} note={`${pctOf(m.rate)} of take-home${m.plannedRate !== null ? ` · you planned ${pctOf(m.plannedRate)} to Growth` : ''}`} />
      <p className="muted small">Spending counts on the days you use things, so a trip counts while you’re on it. Refunds and reimbursable costs are left out.</p>
    </div>
  );
}

function BalanceSheet({ r, d }: { r: Report; d: Display }) {
  const x = r.richer;
  if (!x.end) return <p className="muted">Close a month on the Net worth screen to see this.</p>;
  const assets = x.sections.filter((s) => s.label !== 'Debts').reduce((s, a) => s + a.hkd, 0);
  return (
    <div className="full-stmt">
      <p className="muted small">Close of {dayMonth(x.end.closedOn)}{x.prev ? `, change since the ${monthName(x.prev.month).split(' ')[0]} close` : ''}</p>
      {x.sections.map((s) => (
        <div key={s.label}>
          <div className="fs-head">{s.label === 'Debts' ? 'What you owe' : s.label} <span className="num">{d.show(s.hkd)}</span></div>
          {s.accounts.map((a) => (
            <div key={a.label} className="rl">
              <span className="row-main"><span className="tag">{a.label}</span></span>
              <span className="row-amt"><span className="num">{d.show(a.hkd)}</span>{a.change != null && Math.abs(a.change) >= 1 && <span className={`small ${(s.label === 'Debts' ? -a.change : a.change) > 0 ? 'fd-up' : 'fd-down'}`}>{signed(d, a.change)}</span>}</span>
            </div>
          ))}
        </div>
      ))}
      <L strong label="Assets" amt={d.show(assets)} />
      <L strong label="Debts" amt={d.show(x.end.debts)} />
      <L strong label="Net worth" amt={d.show(x.end.net)} note={x.change !== null ? `${signed(d, x.change)}: ${moved(x, d)}` : undefined} />
    </div>
  );
}

function CashFlow({ r, d }: { r: Report; d: Display }) {
  const x = r.addUp;
  if (x.gap === null) return <p className="muted">Needs two Net worth closes: cash flow runs from one close to the next.</p>;
  return (
    <div className="full-stmt">
      <p className="muted small">Money in and out of your cash & bank accounts between the closes of {dayMonth(x.from!)} and {dayMonth(x.to!)}, by the dates it moved.</p>
      <CashLines r={r} d={d} />
      <L label="Change at your closes" amt={signed(d, x.actual!)} />
      <L strong label={x.status === 'good' ? 'All tracked' : 'Not logged'} amt={d.show(x.gap)} />
    </div>
  );
}
