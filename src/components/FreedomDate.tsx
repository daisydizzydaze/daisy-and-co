import { useState } from 'react';
import { useDisplay } from '../lib/display';
import { shortMonth } from '../lib/format';
import { monthsFromNow, monthsTo, saveForecast, type ForecastSettings, type Pace } from '../lib/forecast';
import { Sheet } from './Sheet';

const when = (n: number) => {
  const m = monthsFromNow(n);
  return `${shortMonth(m)} ${m.slice(0, 4)}`;
};
const howLong = (n: number) => {
  if (n < 1) return 'this month';
  if (n < 24) return `about ${n} month${n === 1 ? '' : 's'} from now`;
  return `about ${Math.round(n / 12)} years from now`;
};
const diff = (n: number | null, base: number) => {
  if (n === null) return <span className="fd-down small">not at that pace</span>;
  const g = base - n;
  if (Math.abs(g) < 1) return <span className="muted small">no change</span>;
  const span = Math.abs(g) < 24 ? `${Math.abs(g)} month${Math.abs(g) === 1 ? '' : 's'}` : `${Math.round(Math.abs(g) / 12)} years`;
  return <span className={`${g > 0 ? 'fd-up' : 'fd-down'} small`}>{span} {g > 0 ? 'sooner' : 'later'}</span>;
};
const pctText = (r: number) => `${(Math.round(r * 1000) / 10).toString()}%`;

/** When liquid money reaches the Freedom number, at the pace you pay yourself first. */
export function FreedomDate({ liquid, target, pace, settings, rates, onSaved }: {
  liquid: number; target: number; pace: Pace; settings: ForecastSettings; rates: Record<string, number>; onSaved: () => void;
}) {
  const d = useDisplay();
  const [edit, setEdit] = useState(false);
  const r = settings.expected_return;
  const sheet = edit && <ForecastSheet s={settings} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onSaved(); }} />;
  const assumptions = (text: React.ReactNode) => (
    <button className="assumptions" onClick={() => setEdit(true)}>{text} <span className="link">Change</span></button>
  );

  if (pace.monthly === null || pace.monthly <= 0) {
    return (
      <section className="card stack forecast">
        <h2 className="card-h">Freedom date</h2>
        <p className="muted small">Shows once you have Growth lines into liquid accounts on the Allocation screen. It works out when you reach your Freedom number at that pace.</p>
        {sheet}
      </section>
    );
  }

  const monthly = pace.monthly;
  const n = monthsTo(liquid, monthly, r, target);
  const step = d.cur === 'SGD' && rates.SGD ? 1000 * rates.SGD : 1000; // S$1,000 or HK$1,000
  const stepLabel = d.show(step);
  const age = n !== null && settings.birth_year ? Number(monthsFromNow(n).slice(0, 4)) - settings.birth_year : null;
  const nowPct = Math.max(0, Math.min(1, liquid / target));
  const marks = [0.5, 0.75]
    .filter((f) => f > nowPct + 0.08)
    .map((f) => ({ f, n: monthsTo(liquid, monthly, r, target * f) }))
    .filter((m): m is { f: number; n: number } => m.n !== null);
  const whatIf = [
    { label: `Save ${stepLabel} more a month`, n: monthsTo(liquid, monthly + step, r, target) },
    ...(monthly - step > 0 ? [{ label: `Save ${stepLabel} less a month`, n: monthsTo(liquid, monthly - step, r, target) }] : []),
    { label: `Markets give ${pctText(r - 0.01)} instead of ${pctText(r)}`, n: monthsTo(liquid, monthly, r - 0.01, target) },
    { label: `Markets give ${pctText(r + 0.01)}`, n: monthsTo(liquid, monthly, r + 0.01, target) },
  ];
  const paceNote = `Adds ${d.show(monthly)} a month (your Growth lines into liquid accounts, ${pace.months === 1 ? 'your latest month' : `last ${pace.months} months’ average`}) and grows ${pctText(r)} a year after inflation. The target stays in today’s money. SRS, MPF and other locked money aren’t counted.`;

  return (
    <section className="card stack forecast">
      <div className="block-head">
        <h2>Freedom date</h2>
        <span className="muted small">at your current pace</span>
      </div>
      {n === null ? (
        <p className="strong">Not within 100 years at this pace.</p>
      ) : (
        <div>
          <div className="date-big">{when(n)}</div>
          <div className="muted small">{age !== null ? `You’d be ${age} · ` : ''}{howLong(n)}</div>
        </div>
      )}
      {n !== null && (
        <div className="track" aria-hidden="true">
          <span className="fill" style={{ width: `${nowPct * 100}%` }} />
          <span className="ms" style={{ left: `${Math.max(nowPct, 0.04) * 100}%` }}><i className="on" /><span>{Math.round(nowPct * 100)}%</span></span>
          {marks.map((m) => (
            <span key={m.f} className="ms" style={{ left: `${m.f * 100}%` }}><i /><span>{m.f === 0.5 ? 'Half' : '¾'} · {monthsFromNow(m.n).slice(0, 4)}</span></span>
          ))}
          <span className="ms end"><i /><span>{monthsFromNow(n).slice(0, 4)}</span></span>
        </div>
      )}
      {assumptions(paceNote)}
      {n !== null && (
        <div className="what-if">
          <span className="eyebrow">What if</span>
          <ul>
            {whatIf.map((w) => (
              <li key={w.label}>
                <span>{w.label}</span>
                <span className="wi-amt"><span className="num strong">{w.n === null ? '–' : when(w.n)}</span>{diff(w.n, n)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {sheet}
    </section>
  );
}

function ForecastSheet({ s, onClose, onSaved }: { s: ForecastSettings; onClose: () => void; onSaved: () => void }) {
  const [ret, setRet] = useState(String(Math.round(s.expected_return * 1000) / 10));
  const [birth, setBirth] = useState(s.birth_year ? String(s.birth_year) : '');
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = Number(ret) / 100;
    const by = birth.trim() === '' ? null : Number(birth);
    if (ret.trim() === '' || !Number.isFinite(r) || r <= -0.5 || r >= 0.5) return setErr('Type a yearly return between −50% and 50%.');
    if (by !== null && !(by > 1900 && by < 2100)) return setErr('Birth year looks off.');
    try { await saveForecast(r, by); onSaved(); } catch (x) { setErr((x as Error).message); }
  }
  return (
    <Sheet title="Freedom date" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!s.canSave && <p className="error">Run 011_forecast.sql in the Supabase SQL Editor first, so the app can save these.</p>}
        <label className="field">Yearly return after inflation (%)<input inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} /></label>
        <label className="field">Birth year (to show your age then)<input inputMode="numeric" value={birth} onChange={(e) => setBirth(e.target.value)} placeholder="e.g. 1992" /></label>
        <p className="muted small">After inflation means what your money grows by beyond rising prices. A mostly-shares mix has often done 4–6% over the long run; cash does about 0%. Your monthly saving comes from your Growth lines on the Allocation screen.</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!s.canSave}>Save</button></div>
      </form>
    </Sheet>
  );
}
