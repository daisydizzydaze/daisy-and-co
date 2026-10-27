import { useState } from 'react';
import { DateField } from './DateField';
import { remove, save } from '../lib/data';
import { addMonths, budgetMonthFor, money, monthName, monthOnly, todayISO } from '../lib/format';
import { CURRENCIES, currencyLabel, type Allocation, type Bucket, type Income, type Section, type Tag } from '../lib/types';
import { Sheet } from './Sheet';

interface Common {
  month: string;
  tags: Tag[];
  buckets: Bucket[];
  onClose: () => void;
  onSaved: () => void;
  onTagsChanged: () => void;
}

export function useSubmit(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export const num = (s: string) => Number(s.replace(/,/g, ''));

export function IncomeSheet({ month, row, tags, buckets, onClose, onSaved, onTagsChanged }: Common & { row?: Income }) {
  const incomeTags = tags.filter((t) => t.kind === 'income' && (!t.archived || t.id === row?.tag_id));
  const [tagId, setTagId] = useState(row?.tag_id ?? incomeTags[0]?.id ?? '');
  const [source, setSource] = useState(row?.source ?? '');
  const [receivedOn, setReceivedOn] = useState(row?.received_on ?? defaultReceived(month));
  const [budgetMonth, setBudgetMonth] = useState(row?.budget_month ?? month);
  const [currency, setCurrency] = useState(row?.currency ?? lastCurrency('income', 'SGD'));
  const [gross, setGross] = useState(row ? String(row.gross_amount) : '');
  const [withheld, setWithheld] = useState(row && Number(row.tax_withheld) > 0 ? String(row.tax_withheld) : '');
  const [bucketId, setBucketId] = useState(row?.bucket_id ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const { busy, error, run } = useSubmit(onSaved);

  const isSalary = (id: string) => tags.find((t) => t.id === id)?.name.toLowerCase() === 'salary';

  function onDate(d: string) {
    setReceivedOn(d);
    if (d) setBudgetMonth(budgetMonthFor(d, isSalary(tagId)));
  }
  function onTag(id: string) {
    setTagId(id);
    if (receivedOn) setBudgetMonth(budgetMonthFor(receivedOn, isSalary(id)));
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    rememberCurrency('income', currency);
    run(() =>
      save('income', {
        tag_id: tagId,
        source: source || null,
        received_on: receivedOn,
        budget_month: budgetMonth,
        currency,
        gross_amount: num(gross),
        tax_withheld: withheld ? num(withheld) : 0,
        bucket_id: bucketId || null,
        note: note || null,
      }, row?.id),
    );
  };

  return (
    <Sheet title={row ? 'Edit income' : 'Add income'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TagPicker label="Income type" tags={incomeTags} value={tagId} onChange={onTag} onRenamed={onTagsChanged} />
        <CurrencyField value={currency} onChange={setCurrency} />
        <label className="field">
          <span>Gross amount ({currency})</span>
          <input inputMode="decimal" required value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0" />
        </label>
        <label className="field">
          <span>Tax withheld before it landed, in {currency} <em className="muted">(optional)</em></span>
          <input inputMode="decimal" value={withheld} onChange={(e) => setWithheld(e.target.value)} placeholder="0" />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Landed on</span>
            <DateField required label="Date" value={receivedOn} onChange={onDate} />
          </label>
          <label className="field">
            <span>Counts for</span>
            <select value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)}>
              {[-1, 0, 1, 2].map((n) => {
                const m = addMonths(month, n);
                return <option key={m} value={m}>{monthName(m)}</option>;
              })}
            </select>
          </label>
        </div>
        <label className="field">
          <span>From <em className="muted">(optional)</em></span>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Employer, broker…" />
        </label>
        <BucketField label="Landed in" buckets={buckets} value={bucketId} onChange={setBucketId} />
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} onDelete={row ? () => run(() => remove('income', row.id)) : undefined} />
      </form>
    </Sheet>
  );
}

const SECTION_LABEL: Record<Section, string> = {
  tax: 'Tax reserve',
  opex: 'Card bill',
  reserve: 'Quick Cash',
  growth: 'Growth',
};

export function AllocationSheet({ month, section, row, tags, buckets, billFor, onClose, onSaved, onTagsChanged }: Common & { section: Section; row?: Allocation; billFor?: (bucketId: string, currency: string) => number | null }) {
  const sectionTags = tags.filter((t) => t.kind === section && (!t.archived || t.id === row?.tag_id));
  const first = sectionTags[0];
  const [tagId, setTagId] = useState(row?.tag_id ?? first?.id ?? '');
  const [amount, setAmount] = useState(row ? String(row.amount) : '');
  const [currency, setCurrency] = useState(row?.currency ?? bucketCurrency(buckets, first?.default_bucket_id) ?? lastCurrency(section, 'HKD'));
  const [toBucket, setToBucket] = useState(row?.to_bucket_id ?? first?.default_bucket_id ?? '');
  const [done, setDone] = useState(row?.done ?? false);
  const [note, setNote] = useState(row?.note ?? '');
  const { busy, error, run } = useSubmit(onSaved);
  const bill = section === 'opex' && toBucket && billFor ? billFor(toBucket, currency) : null;
  const lastMonth = monthOnly(addMonths(month, -1));

  function onTag(id: string) {
    setTagId(id);
    const t = tags.find((x) => x.id === id);
    if (t?.default_bucket_id) {
      setToBucket(t.default_bucket_id);
      if (!row) setCurrency(bucketCurrency(buckets, t.default_bucket_id) ?? currency);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    rememberCurrency(section, currency);
    run(() =>
      save('allocations', {
        budget_month: month,
        section,
        tag_id: tagId,
        currency,
        amount: num(amount),
        to_bucket_id: toBucket || null,
        done,
        done_on: done ? row?.done_on ?? todayISO() : null,
        note: note || null,
      }, row?.id),
    );
  };

  return (
    <Sheet title={`${row ? 'Edit' : 'Add'} ${SECTION_LABEL[section].toLowerCase()}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {sectionTags.length === 0 ? (
          <p className="muted">No {SECTION_LABEL[section]} tags yet. Add one under Tags.</p>
        ) : (
          <TagPicker label="Line" tags={sectionTags} value={tagId} onChange={onTag} onRenamed={onTagsChanged} />
        )}
        <CurrencyField value={currency} onChange={setCurrency} />
        <label className="field">
          <span>{section === 'opex' ? `Set aside for the ${lastMonth} bill` : 'Amount'} ({currency})</span>
          <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </label>
        {section === 'opex' && bill !== null && (
          <p className="hint-row muted small">
            Charged in {lastMonth} so far: <strong className="num">{money(bill, currency, 2)}</strong>
            {Math.abs(bill - num(amount || '0')) >= 0.01 && (
              <button type="button" className="link" onClick={() => setAmount(String(Math.round(bill * 100) / 100))}>Use this</button>
            )}
          </p>
        )}
        <BucketField label={section === 'opex' ? 'Card it pays' : 'Moves to'} buckets={buckets} value={toBucket} onChange={setToBucket} />
        <label className="check">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
          <span>{section === 'opex' ? `Bill paid (marks ${lastMonth}’s charges as settled)` : 'Money has moved'}</span>
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <Actions busy={busy} disabled={!tagId} onDelete={row ? () => run(() => remove('allocations', row.id)) : undefined} />
      </form>
    </Sheet>
  );
}

export function TagPicker({ label, tags, value, onChange, onRenamed }: { label: string; tags: Tag[]; value: string; onChange: (id: string) => void; onRenamed: () => void }) {
  const current = tags.find((t) => t.id === value);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function rename() {
    if (!current || !name.trim() || name.trim() === current.name) return setRenaming(false);
    try {
      await save('tags', { name: name.trim() }, current.id);
      setRenaming(false);
      onRenamed();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <fieldset className="chips">
      <legend>{label}</legend>
      {tags.map((t) => (
        <label key={t.id} className={`chip ${value === t.id ? 'on' : ''}`}>
          <input type="radio" name="tag" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} />
          {t.name}
        </label>
      ))}
      {current && !renaming && (
        <button type="button" className="link rename" onClick={() => { setName(current.name); setRenaming(true); }}>
          Rename “{current.name}”
        </button>
      )}
      {renaming && (
        <div className="rename-row">
          <input aria-label="New name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } }} />
          <button type="button" className="btn primary small-btn" onClick={rename}>Save name</button>
          <button type="button" className="btn ghost small-btn" onClick={() => setRenaming(false)}>Cancel</button>
          <span className="muted small">Renames it in every month.</span>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </fieldset>
  );
}

export function CurrencyField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset className="chips">
      <legend>Currency</legend>
      {CURRENCIES.map((c) => (
        <label key={c} className={`chip ${value === c ? 'on' : ''}`}>
          <input type="radio" name="currency" value={c} checked={value === c} onChange={() => onChange(c)} />
          {currencyLabel(c)}
        </label>
      ))}
    </fieldset>
  );
}

// Remember the last currency per section on this device, so SGD pay stays one tap away.
export function lastCurrency(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(`currency:${key}`);
    return v && CURRENCIES.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function rememberCurrency(key: string, c: string) {
  try {
    localStorage.setItem(`currency:${key}`, c);
  } catch {
    /* private mode */
  }
}

function BucketField({ label, buckets, value, onChange }: { label: string; buckets: Bucket[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {buckets.filter((b) => b.active || b.id === value).map((b) => (
          <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>
        ))}
      </select>
    </label>
  );
}

export function Actions({ busy, disabled, onDelete }: { busy: boolean; disabled?: boolean; onDelete?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="actions">
      {onDelete && (
        <button type="button" className="btn ghost danger" disabled={busy} onClick={() => (confirm ? onDelete() : setConfirm(true))}>
          {confirm ? 'Tap again to delete' : 'Delete'}
        </button>
      )}
      <button className="btn primary" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function bucketCurrency(buckets: Bucket[], id: string | null | undefined) {
  return buckets.find((b) => b.id === id)?.currency;
}

/** Salary for November lands around 25 October. */
function defaultReceived(month: string) {
  const today = todayISO();
  return today.slice(0, 7) === addMonths(month, -1).slice(0, 7) || today.slice(0, 7) === month.slice(0, 7) ? today : `${addMonths(month, -1).slice(0, 8)}25`;
}
