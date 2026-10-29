import { useState } from 'react';
import { commas, fmtNum } from '../lib/numInput';
import { remove, save } from '../lib/data';
import { money, shortMonth } from '../lib/format';
import { useDisplay } from '../lib/display';
import type { Expense, NeedWant, Plan, Tag } from '../lib/types';
import { DateField } from './DateField';
import { Actions, CurrencyField, num, useSubmit } from './LineSheets';
import { Sheet } from './Sheet';

/** Running total (HKD, at each payment's own rate) and count per plan. */
export function planTotals(planned: Expense[], hkdOf: (e: Expense) => number | null) {
  const m = new Map<string, { hkd: number; count: number }>();
  planned.filter((e) => !e.reimbursable).forEach((e) => {
    const t = m.get(e.plan_id!) ?? { hkd: 0, count: 0 };
    m.set(e.plan_id!, { hkd: t.hkd + (hkdOf(e) ?? 0), count: t.count + 1 });
  });
  return m;
}

export function PlanSheet({ plan, expenses, tags, hkdOf, onClose, onSaved, onLog, onEdit }: {
  plan?: Plan; expenses: Expense[]; tags: Tag[]; hkdOf: (e: Expense) => number | null;
  onClose: () => void; onSaved: () => void; onLog: () => void; onEdit: (e: Expense) => void;
}) {
  const d = useDisplay();
  const [name, setName] = useState(plan?.name ?? '');
  const [needWant, setNeedWant] = useState<NeedWant>(plan?.need_want ?? 'want');
  const [from, setFrom] = useState(plan?.starts_on ?? '');
  const [to, setTo] = useState(plan?.ends_on ?? '');
  const [budget, setBudget] = useState(plan?.budget != null ? fmtNum(plan.budget) : '');
  const [budgetCur, setBudgetCur] = useState(plan?.budget_currency ?? 'HKD');
  const [done, setDone] = useState(plan?.done ?? false);
  const [note, setNote] = useState(plan?.note ?? '');
  const { busy, error, run } = useSubmit(onSaved);

  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const rows = [...expenses].sort((a, b) => b.spent_on.localeCompare(a.spent_on));
  const total = rows.filter((e) => !e.reimbursable).reduce((s, e) => s + (hkdOf(e) ?? 0), 0);
  const open = rows.filter((e) => !e.settled_on).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const [a, b] = from && to && to < from ? [to, from] : [from, to];
    run(() => save('plans', {
      name: name.trim(),
      need_want: needWant,
      starts_on: a || null,
      ends_on: b || a || null,
      budget: budget ? num(budget) : null,
      budget_currency: budget ? budgetCur : null,
      done,
      note: note || null,
    }, plan?.id));
  };

  return (
    <Sheet wide={!!plan} title={plan ? plan.name : 'New plan'} onClose={onClose}>
      <div className={plan ? 'sheet-cols' : ''}>
      {plan && (
        <section className="plan-costs stack col">
          <div className="block-head">
            <div>
              <span className="eyebrow">Paid so far</span>
              <div className="big num">{d.show(total)}</div>
              <span className="muted small">{[`${rows.length} ${rows.length === 1 ? 'cost' : 'costs'}`, open ? `${open} still on a card` : null].filter(Boolean).join(' · ')}</span>
            </div>
            <button type="button" className="btn primary small-btn" onClick={onLog}>+ Log a cost</button>
          </div>
          {rows.length > 0 && (
            <ul className="rows">
              {rows.map((e) => {
                const amt = Number(e.amount);
                return (
                  <li key={e.id}>
                    <button type="button" className="row xrow" onClick={() => onEdit(e)}>
                      <span className="row-main">
                        <span className="tag">{e.vendor || tagName.get(e.tag_id ?? '') || 'Uncategorised'}</span>
                        <span className="muted small">{[e.vendor ? tagName.get(e.tag_id ?? '') : null, `paid ${Number(e.spent_on.slice(8))} ${shortMonth(e.spent_on)} ${e.spent_on.slice(0, 4)}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="row-amt">
                        <span className="num">{money(amt, e.currency, amt % 1 ? 2 : 0)}</span>
                        <span className="muted small num">
                          {e.currency !== d.cur ? d.show(hkdOf(e)) : ''}
                          <i className={`sdot ${e.settled_on ? 'settled' : 'charged'}`} title={e.settled_on ? 'Settled' : 'Charged'} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <form className="stack col" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input required autoFocus={!plan} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TMB 2027, Hokkaido, New laptop" />
        </label>
        <div className="grid2">
          <label className="field"><span>From</span><DateField label="From" value={from} onChange={(v) => { setFrom(v); if (to && to < v) setTo(''); }} placeholder="Start" /></label>
          <label className="field"><span>To</span><DateField label="To" value={to} openAt={from} onChange={setTo} placeholder="End" /></label>
        </div>
        <p className="muted small hint-row">Costs on this plan count as spending on these dates, wherever and whenever you paid.</p>
        <div className="field">
          <span>Need or want</span>
          <div className="segmented nw" role="radiogroup" aria-label="Need or want">
            <button type="button" role="radio" aria-checked={needWant === 'need'} aria-selected={needWant === 'need'} onClick={() => setNeedWant('need')}>Need</button>
            <button type="button" role="radio" aria-checked={needWant === 'want'} aria-selected={needWant === 'want'} onClick={() => setNeedWant('want')}>Want</button>
          </div>
        </div>
        <label className="field">
          <span>Budget <em className="muted">(optional)</em></span>
          <input inputMode="decimal" value={budget} onChange={(e) => { commas(e); setBudget(e.target.value); }} placeholder="No budget" />
        </label>
        {budget && <CurrencyField value={budgetCur} onChange={setBudgetCur} />}
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {plan && (
          <label className="check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>It’s over <em className="muted">(hides it from the list and the log sheet)</em></span>
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} disabled={!name.trim()} onDelete={plan ? () => run(() => remove('plans', plan.id)) : undefined} />
        {plan && rows.length > 0 && <p className="muted small">Deleting the plan keeps its {rows.length} costs, just without the plan.</p>}
      </form>
      </div>
    </Sheet>
  );
}
