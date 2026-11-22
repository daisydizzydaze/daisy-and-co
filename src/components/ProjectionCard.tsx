import { useState } from 'react';
import { useDisplay } from '../lib/display';
import type { Projection } from '../lib/projection';
import type { Expense } from '../lib/types';

interface Props {
  p: Projection;
  monthShort: string; // 'Nov'
  lastDay: number;
  budget: number | null; // HKD a month, from the Budget tab's living costs
  budgetNote: string;
  bigFrom: number; // HKD
  nameOf: (e: Expense) => string;
}

/** "On track for ~S$3,460 by 30 Nov": a small grey card that opens to show how it's worked out. */
export function ProjectionCard({ p, monthShort, lastDay, budget, budgetNote, bigFrom, nameOf }: Props) {
  const d = useDisplay();
  const [open, setOpen] = useState(false);
  const t = (hkd: number) => `~${d.show(hkd)}`;
  const over = budget !== null && p.total > budget;
  const scale = Math.max(budget ?? 0, p.total, 1);
  const w = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const soShown = budget !== null ? Math.min(p.soFar, budget) : p.soFar;
  const toCome = budget !== null ? Math.min(p.total, budget) - p.soFar : p.total - p.soFar;
  const room = budget !== null && p.daysLeft > 0 ? (budget - p.soFar) / p.daysLeft : null;
  const names = (rows: { e: Expense; v: number }[]) => {
    const shown = rows.slice(0, 3).map((x) => `${nameOf(x.e)} ${d.show(x.v)}`);
    return shown.join(' · ') + (rows.length > 3 ? ` + ${rows.length - 3} more` : '');
  };

  return (
    <section className={`card pj-card ${open ? 'open' : ''}`} aria-label="Projected spending">
      <button type="button" className="pj-top" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pj-l">
          <span className="eyebrow">{p.early ? 'Early guess' : 'On track for'} · {lastDay} {monthShort}</span>
          <span className="pj-num num">{t(p.total)}</span>
        </span>
        {budget !== null && (
          <span className="pj-r">
            <span className={`small ${over ? 'bad-text' : 'good-text'}`}>{over ? `${t(p.total - budget)} over` : `${t(budget - p.total)} to spare`}</span>
            <span className="muted small">of {d.show(budget)}</span>
          </span>
        )}
        <svg className="pj-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d={open ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} /></svg>
      </button>

      <div className="pj-bar" aria-hidden="true">
        <span className="pj-so" style={{ width: w(soShown) }} />
        <span className={`pj-rest ${over ? 'over' : ''}`} style={{ width: w(toCome) }} />
        {over && <span className="pj-spill" style={{ width: w(p.total - budget!) }} />}
        {budget !== null && <i className="pj-mark" style={{ left: w(budget) }} />}
      </div>

      {open && (
        <>
          <div className="pj-scale small muted">
            <span><i className="dot so" />Spent {d.show(p.soFar)}</span>
            <span><i className="dot rest" />To come {d.show(p.total - p.soFar)}</span>
            {budget !== null && <span>Budget {d.show(budget)}</span>}
          </div>
          {room !== null && (
            <p className="muted small pj-room">
              {room <= 0
                ? 'Already past the budget for this month.'
                : over
                  ? `To land on budget, keep to ${t(room)} a day for the last ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'}.`
                  : `You could spend up to ${t(room)} a day for the last ${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} and still land on budget.`}
            </p>
          )}
          {budget === null && <p className="muted small pj-room">{budgetNote}</p>}

          <div className="pj-detail">
            <div className="ln first">
              <span className="l"><span className="tag">Spent so far, 1–{p.day} {monthShort}</span></span>
              <span className="r num">{d.show(p.soFar)}</span>
            </div>
            {p.big.length > 0 && (
              <div className="ln sub">
                <span className="l"><span className="tag">Bigger items, counted once</span><span className="muted small">{names(p.big)}. Anything over {d.show(bigFrom)}.</span></span>
                <span className="r num">{d.show(p.bigTotal)}</span>
              </div>
            )}
            {p.overTime.length > 0 && (
              <div className="ln sub">
                <span className="l"><span className="tag">Used over time</span><span className="muted small">{names(p.overTime)}, this month’s share</span></span>
                <span className="r num">{d.show(p.overTimeTotal)}</span>
              </div>
            )}
            <div className="ln sub">
              <span className="l"><span className="tag">Day-to-day</span><span className="muted small">{d.show(p.perDay)} a day so far</span></span>
              <span className="r num">{d.show(p.daily)}</span>
            </div>
            <div className="ln">
              <span className="l"><span className="tag">{p.daysLeft} {p.daysLeft === 1 ? 'day' : 'days'} left at {d.show(p.perDay)} a day</span><span className="muted small">Your pace so far this month{p.early ? ', still a rough guess in the first week' : ''}</span></span>
              <span className="r num">+ {d.show(p.rest)}</span>
            </div>
            <div className="ln">
              <span className="l">
                <span className="tag">Regular bills not in yet</span>
                <span className="muted small">
                  {p.regularsFrom
                    ? `Starts in ${new Date(p.regularsFrom + 'T00:00:00').toLocaleString('en-GB', { month: 'long', year: 'numeric' })}, once two full months are logged. Bills that came once in each of the last two months and haven’t shown up yet.`
                    : p.regulars.length
                      ? names(p.regulars)
                      : 'None due. Everything that came last month is in.'}
                </span>
              </span>
              <span className={`r num ${p.regulars.length ? '' : 'muted'}`}>{p.regulars.length ? `+ ${d.show(p.regularTotal)}` : '–'}</span>
            </div>
            <div className="ln total">
              <span className="l"><span className="tag">On track for</span></span>
              <span className="r num">{t(p.total)}</span>
            </div>
            <p className="note">
              {Math.round(p.plans) > 0 ? `Plans (${d.show(p.plans)} this month) are left out. They have their own budget. ` : 'Plans are left out. They have their own budget. '}
              {budget !== null ? `Budget: ${budgetNote}.` : ''}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
