import { useState } from 'react';
import { DateField } from './DateField';
import { remove, save } from '../lib/data';
import { monthName, statementMonth, todayISO } from '../lib/format';
import { PAYS_AT_ONCE, type Bucket, type Expense, type Tag } from '../lib/types';
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

export function ExpenseSheet({ row, tags, buckets, defaultDate, onClose, onSaved, onTagsChanged }: {
  row?: Expense; tags: Tag[]; buckets: Bucket[]; defaultDate?: string; onClose: () => void; onSaved: () => void; onTagsChanged: () => void;
}) {
  const cats = tags.filter((t) => t.kind === 'expense' && (!t.archived || t.id === row?.tag_id));
  const accounts = payingAccounts(buckets, tags, row?.paid_from);
  const remembered = accounts.find((b) => b.id === lastPaidWith())?.id;
  const [paidFrom, setPaidFrom] = useState(row?.paid_from ?? remembered ?? accounts[0]?.id ?? '');
  const account = buckets.find((b) => b.id === paidFrom);
  const [amount, setAmount] = useState(row ? String(row.amount) : '');
  const [currency, setCurrencyRaw] = useState(row?.currency ?? account?.currency ?? lastCurrency('expense', 'HKD'));
  const [currencyTouched, setCurrencyTouched] = useState(!!row);
  const setCurrency = (c: string) => { setCurrencyRaw(c); setCurrencyTouched(true); };
  const [tagId, setTagId] = useState(row?.tag_id ?? cats[0]?.id ?? '');
  const [spentOn, setSpentOn] = useState(row?.spent_on ?? defaultDate ?? todayISO());
  const [vendor, setVendor] = useState(row?.vendor ?? '');
  const [charged, setCharged] = useState(row?.charged_amount != null ? String(row.charged_amount) : '');
  const [settled, setSettled] = useState(row ? row.settled_on !== null : PAYS_AT_ONCE.includes(account?.type ?? ''));
  const [reimbursable, setReimbursable] = useState(row?.reimbursable ?? false);
  const [note, setNote] = useState(row?.note ?? '');
  const { busy, error, run } = useSubmit(onSaved);

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
    run(() =>
      save('expenses', {
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
      }, row?.id),
    );
  };

  return (
    <Sheet title={row ? 'Edit expense' : 'Log expense'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Amount ({currency})</span>
          <input inputMode="decimal" required autoFocus={!row} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        <CurrencyField value={currency} onChange={setCurrency} />
        {cats.length > 0 && <TagPicker label="Category" tags={cats} value={tagId} onChange={setTagId} onRenamed={onTagsChanged} />}

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
            <input inputMode="decimal" value={charged} onChange={(e) => setCharged(e.target.value)} placeholder="Converted at the month’s rate if empty" />
          </label>
        )}

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

        <div className="segmented" role="radiogroup" aria-label="Status">
          <button type="button" role="radio" aria-checked={!settled} aria-selected={!settled} onClick={() => setSettled(false)}>Charged</button>
          <button type="button" role="radio" aria-checked={settled} aria-selected={settled} onClick={() => setSettled(true)}>Settled</button>
        </div>

        <label className="check">
          <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
          <span>Someone will pay me back <em className="muted">(left out of totals)</em></span>
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} disabled={!paidFrom} onDelete={row ? () => run(() => remove('expenses', row.id)) : undefined} />
      </form>
    </Sheet>
  );
}
