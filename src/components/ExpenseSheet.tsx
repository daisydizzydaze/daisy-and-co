import { useEffect, useState } from 'react';
import { commas, fmtNum } from '../lib/numInput';
import { DateField } from './DateField';
import { insertPlan, remove, save } from '../lib/data';
import { monthName, shortMonth, statementMonth, todayISO } from '../lib/format';
import { currencyLabel, PAYS_AT_ONCE, type Bucket, type Expense, type NeedWant, type Plan, type Tag } from '../lib/types';
import { rangeLabel } from '../lib/spend';
import { Actions, CurrencyField, lastCurrency, num, rememberCurrency, TagPicker, useSubmit } from './LineSheets';
import { Sheet } from './Sheet';

/** Accounts you can pay with: credit and debit cards and cash, but not savings pots like the cash reserve. */
export function payingAccounts(buckets: Bucket[], tags: Tag[], keep?: string) {
  const pots = new Set(tags.filter((t) => t.kind === 'reserve' || t.kind === 'growth').map((t) => t.default_bucket_id));
  return buckets.filter((b) => (b.active && (b.type === 'Card' || PAYS_AT_ONCE.includes(b.type)) && !pots.has(b.id)) || b.id === keep);
}

function lastPaidWith(): string {
  try {
    return localStorage.getItem('paid-with') ?? '';
  } catch {
    return '';
  }
}
function rememberPaidWith(id: string) {
  try {
    localStorage.setItem('paid-with', id);
  } catch {
    /* private mode */
  }
}

export function ExpenseSheet({ row, tags, buckets, plans, defaultDate, defaultPlan, onClose, onSaved, onTagsChanged }: {
  row?: Expense; tags: Tag[]; buckets: Bucket[]; plans: Plan[]; defaultDate?: string; defaultPlan?: string; onClose: () => void; onSaved: () => void; onTagsChanged: () => void;
}) {
  const allCats = tags.filter((t) => t.kind === 'expense' && (!t.archived || t.id === row?.tag_id));
  const cats = allCats.filter((t) => !t.parent_id || !allCats.some((p) => p.id === t.parent_id));
  const subsOf = (id: string) => allCats.filter((t) => t.parent_id === id);
  const accounts = payingAccounts(buckets, tags, row?.paid_from);
  const remembered = accounts.find((b) => b.id === lastPaidWith())?.id;
  const [paidFrom, setPaidFrom] = useState(row?.paid_from ?? remembered ?? accounts[0]?.id ?? '');
  const account = buckets.find((b) => b.id === paidFrom);
  const [amount, setAmount] = useState(row ? fmtNum(row.amount) : '');
  const [currency, setCurrencyRaw] = useState(row?.currency ?? account?.currency ?? lastCurrency('expense', 'HKD'));
  const [currencyTouched, setCurrencyTouched] = useState(!!row);
  const setCurrency = (c: string) => { setCurrencyRaw(c); setCurrencyTouched(true); };
  const startTag = allCats.find((t) => t.id === row?.tag_id);
  const [catId, setCatId] = useState(startTag?.parent_id && cats.some((c) => c.id === startTag.parent_id) ? startTag.parent_id : startTag?.id ?? cats[0]?.id ?? '');
  const [subId, setSubId] = useState(startTag && startTag.id !== catId ? startTag.id : '');
  const tagId = subId || catId;
  const subs = subsOf(catId);

  // Plans: pick one, or make one right here.
  const openPlans = plans.filter((p) => !p.done || p.id === row?.plan_id);
  const [planId, setPlanId] = useState(row?.plan_id ?? defaultPlan ?? '');
  const plan = plans.find((p) => p.id === planId);
  const [newPlan, setNewPlan] = useState<{ name: string; from: string; to: string } | null>(null);

  // Need or Want follows the plan, then the category, until you pick one yourself.
  const tagDefault = (id: string): NeedWant => allCats.find((t) => t.id === id)?.need_want ?? allCats.find((t) => t.id === allCats.find((x) => x.id === id)?.parent_id)?.need_want ?? 'need';
  const [nwTouched, setNwTouched] = useState(!!row);
  const [needWant, setNeedWantRaw] = useState<NeedWant>(row?.need_want ?? (plan?.need_want ?? tagDefault(tagId)));
  const setNeedWant = (v: NeedWant) => { setNeedWantRaw(v); setNwTouched(true); };
  const follow = (cat: string, p?: Plan | null) => { if (!nwTouched) setNeedWantRaw(p?.need_want ?? (newPlan ? 'want' : tagDefault(cat))); };
  const pickCat = (id: string) => { setCatId(id); setSubId(''); follow(id, plan); };
  const pickSub = (id: string) => { const v = subId === id ? '' : id; setSubId(v); follow(v || catId, plan); };
  const pickPlan = (id: string) => { setPlanId(id); setNewPlan(null); follow(tagId, plans.find((p) => p.id === id) ?? null); };

  // Use dates: blank = used the day you paid. A plan lends its dates unless you set your own.
  const planDates = plan?.starts_on ? { from: plan.starts_on, to: plan.ends_on ?? plan.starts_on } : null;
  const ownDates = !!row?.use_from && !(planDates && row.use_from === planDates.from && row.use_to === planDates.to);
  const [overTime, setOverTime] = useState(ownDates);
  const [useFrom, setUseFrom] = useState(ownDates ? row!.use_from! : '');
  const [useTo, setUseTo] = useState(ownDates ? row!.use_to! : '');
  const [spentOn, setSpentOn] = useState(row?.spent_on ?? defaultDate ?? todayISO());
  const [vendor, setVendor] = useState(row?.vendor ?? '');
  const [charged, setCharged] = useState(row?.charged_amount != null ? fmtNum(row.charged_amount) : '');
  const [settled, setSettled] = useState(row ? row.settled_on !== null : PAYS_AT_ONCE.includes(account?.type ?? ''));
  const [reimbursable, setReimbursable] = useState(row?.reimbursable ?? false);
  const [note, setNote] = useState(row?.note ?? '');
  const { busy, error, run } = useSubmit(onSaved);
  const compact = useCompact();
  const [openFold, setOpenFold] = useState<string>(row ? '' : 'category');
  const fold = { compact, open: openFold, onOpen: setOpenFold };
  const catName = allCats.find((c) => c.id === catId)?.name;
  const subName = allCats.find((c) => c.id === subId)?.name;
  const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${shortMonth(iso.slice(0, 8) + '01')}`;

  const isCard = account?.type === 'Card';
  const foreign = isCard && account && currency !== account.currency;

  function pickAccount(id: string) {
    setPaidFrom(id);
    const b = buckets.find((x) => x.id === id);
    if (!row) setSettled(PAYS_AT_ONCE.includes(b?.type ?? ''));
    if (!currencyTouched && b) setCurrencyRaw(b.currency);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    rememberCurrency('expense', currency);
    rememberPaidWith(paidFrom);
    const own = overTime && useFrom && useTo;
    run(async () => {
      let plan_id = planId || null;
      if (newPlan?.name.trim()) {
        plan_id = await insertPlan({ name: newPlan.name.trim(), need_want: needWant, starts_on: newPlan.from || null, ends_on: newPlan.to || newPlan.from || null });
        onTagsChanged();
      }
      await save('expenses', {
        spent_on: spentOn,
        vendor: vendor || null,
        currency,
        amount: num(amount),
        tag_id: tagId || null,
        paid_from: paidFrom,
        charged_amount: foreign && charged ? num(charged) : null,
        charged_currency: foreign && charged ? account!.currency : null,
        reimbursable,
        settled_on: settled ? row?.settled_on ?? todayISO() : null,
        note: note || null,
        need_want: needWant,
        plan_id,
        // Blank lets the database copy the plan's dates (and follow them if the plan moves).
        use_from: own ? (useFrom <= useTo ? useFrom : useTo) : null,
        use_to: own ? (useFrom <= useTo ? useTo : useFrom) : null,
      }, row?.id);
    });
  };

  return (
    <Sheet wide title={row ? 'Edit expense' : 'Log expense'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="sheet-cols"><div className="stack col">
        <label className="field amount">
          <span>Amount ({currency})</span>
          <input inputMode="decimal" required autoFocus={!row} value={amount} onChange={(e) => { commas(e); setAmount(e.target.value); }} placeholder="0" />
        </label>
        <Fold id="currency" title="Currency" summary={currencyLabel(currency)} {...fold}>
          <CurrencyField value={currency} onChange={(c) => { setCurrency(c); if (compact) setOpenFold(''); }} />
        </Fold>
        <Fold id="category" title="Category" summary={[[catName, subName].filter(Boolean).join(' › '), needWant === 'want' ? 'Want' : 'Need'].filter(Boolean).join(' · ')} {...fold}>
        {cats.length > 0 && <TagPicker label="Category" tags={cats} value={catId} onChange={pickCat} onRenamed={onTagsChanged} />}
        {subs.length > 0 && (
          <fieldset className="chips subs">
            <legend>{allCats.find((c) => c.id === catId)?.name}: which part? <em className="muted">(optional)</em></legend>
            {subs.map((t) => (
              <label key={t.id} className={`chip ${subId === t.id ? 'on' : ''}`}>
                <input type="checkbox" checked={subId === t.id} onChange={() => pickSub(t.id)} />
                {t.name}
              </label>
            ))}
          </fieldset>
        )}

        <div className="field">
          <span>Need or want</span>
          <div className="segmented nw" role="radiogroup" aria-label="Need or want">
            <button type="button" role="radio" aria-checked={needWant === 'need'} aria-selected={needWant === 'need'} onClick={() => setNeedWant('need')}>Need</button>
            <button type="button" role="radio" aria-checked={needWant === 'want'} aria-selected={needWant === 'want'} onClick={() => setNeedWant('want')}>Want</button>
          </div>
        </div>
        </Fold>

        <Fold id="paid" title="Paid with" summary={[account?.name, settled ? 'Settled' : 'Charged'].filter(Boolean).join(' · ')} {...fold}>
        <fieldset className="chips">
          <legend>Paid with</legend>
          {accounts.map((b) => (
            <label key={b.id} className={`chip ${paidFrom === b.id ? 'on' : ''}`}>
              <input type="radio" name="paid" value={b.id} checked={paidFrom === b.id} onChange={() => pickAccount(b.id)} />
              {b.name}
            </label>
          ))}
          {accounts.length === 0 && <p className="muted small">Add a card or cash account in Settings first.</p>}
        </fieldset>

        {foreign && (
          <label className="field">
            <span>Card billed, in {account!.currency} <em className="muted">(optional, once you see it)</em></span>
            <input inputMode="decimal" value={charged} onChange={(e) => { commas(e); setCharged(e.target.value); }} placeholder="Converted at the month’s rate if empty" />
          </label>
        )}

        <div className="segmented" role="radiogroup" aria-label="Status">
          <button type="button" role="radio" aria-checked={!settled} aria-selected={!settled} onClick={() => setSettled(false)}>Charged</button>
          <button type="button" role="radio" aria-checked={settled} aria-selected={settled} onClick={() => setSettled(true)}>Settled</button>
        </div>

        </Fold>

        </div><div className="stack col">
        <Fold id="when" title="Date & place" summary={[spentOn ? shortDay(spentOn) : null, vendor || null].filter(Boolean).join(' · ')} {...fold}>
        <div className="grid2">
          <label className="field">
            <span>Date</span>
            <DateField required label="Date" value={spentOn} onChange={setSpentOn} />
          </label>
          <label className="field">
            <span>Where <em className="muted">(optional)</em></span>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Shop, café…" />
          </label>
        </div>

        {isCard && spentOn && (
          <p className="muted small hint-row">
            Lands on the {monthName(statementMonth(spentOn, account!.statement_day))} statement
          </p>
        )}

        </Fold>

        <Fold id="plan" title="Plan & timing" summary={[plan?.name ?? (newPlan ? newPlan.name || 'New plan' : 'None'), overTime && useFrom && useTo ? `used ${rangeLabel(useFrom, useTo)}` : null].filter(Boolean).join(' · ')} {...fold}>
        <fieldset className="chips">
          <legend>Part of a plan <em className="muted">(optional)</em></legend>
          <label className={`chip ${!planId && !newPlan ? 'on' : ''}`}>
            <input type="radio" name="plan" checked={!planId && !newPlan} onChange={() => pickPlan('')} />
            None
          </label>
          {openPlans.map((p) => (
            <label key={p.id} className={`chip ${planId === p.id ? 'on' : ''}`}>
              <input type="radio" name="plan" checked={planId === p.id} onChange={() => pickPlan(p.id)} />
              {p.name}
            </label>
          ))}
          <label className={`chip dashed ${newPlan ? 'on' : ''}`}>
            <input type="radio" name="plan" checked={!!newPlan} onChange={() => { setPlanId(''); setNewPlan({ name: '', from: '', to: '' }); if (!nwTouched) setNeedWantRaw('want'); }} />
            + New plan
          </label>
        </fieldset>
        {newPlan && (
          <div className="stack inset">
            <label className="field">
              <span>Plan name</span>
              <input required autoFocus value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} placeholder="e.g. TMB 2027" />
            </label>
            <div className="grid2">
              <label className="field"><span>From</span><DateField label="From" value={newPlan.from} onChange={(v) => setNewPlan({ ...newPlan, from: v, to: newPlan.to && newPlan.to < v ? '' : newPlan.to })} placeholder="Start" /></label>
              <label className="field"><span>To</span><DateField label="To" value={newPlan.to} openAt={newPlan.from} onChange={(v) => setNewPlan({ ...newPlan, to: v })} placeholder="End" /></label>
            </div>
          </div>
        )}

        {(planDates || (newPlan?.from)) && !overTime ? (
          <p className="muted small hint-row">
            Counts as spending {rangeLabel(planDates?.from ?? newPlan!.from, planDates?.to ?? (newPlan!.to || newPlan!.from))}, the plan’s dates.
            <button type="button" className="link" onClick={() => { setOverTime(true); setUseFrom(planDates?.from ?? newPlan!.from); setUseTo(planDates?.to ?? (newPlan!.to || newPlan!.from)); }}>Use other dates</button>
          </p>
        ) : (
          <label className="check">
            <input type="checkbox" checked={overTime} onChange={(e) => {
              setOverTime(e.target.checked);
              if (e.target.checked && !useFrom) { setUseFrom(spentOn); setUseTo(addDays(spentOn, 70)); }
            }} />
            <span>I’ll use this over time <em className="muted">(voucher, pass, booking)</em></span>
          </label>
        )}
        {overTime && (
          <div className="grid2 inset">
            <label className="field"><span>Use from</span><DateField required label="Use from" value={useFrom} onChange={setUseFrom} /></label>
            <label className="field"><span>Use until</span><DateField required label="Use until" value={useTo} openAt={useFrom} onChange={setUseTo} /></label>
          </div>
        )}

        </Fold>

        <Fold id="more" title="More" summary={[reimbursable ? 'Paid back' : null, note || null].filter(Boolean).join(' · ') || 'Note, paid back'} {...fold}>
        <label className="check">
          <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
          <span>Someone will pay me back <em className="muted">(left out of totals)</em></span>
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        </Fold>
        </div></div>
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} disabled={!paidFrom || (!!newPlan && !newPlan.name.trim())} onDelete={row ? () => run(() => remove('expenses', row.id)) : undefined} />
      </form>
    </Sheet>
  );
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Phones fold the log sheet into sections; wider screens show everything in two columns. */
function useCompact(): boolean {
  const q = '(max-width: 959px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function Fold({ id, title, summary, compact, open, onOpen, children }: {
  id: string; title: string; summary: string; compact: boolean; open: string; onOpen: (id: string) => void; children: React.ReactNode;
}) {
  if (!compact) return <>{children}</>;
  const isOpen = open === id;
  return (
    <div className={`fold ${isOpen ? 'open' : ''}`}>
      <button type="button" className="fold-head" aria-expanded={isOpen} onClick={() => onOpen(isOpen ? '' : id)}>
        <span className="fold-title">{title}</span>
        <span className="fold-sum">{summary}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {isOpen && <div className="fold-body stack">{children}</div>}
    </div>
  );
}
