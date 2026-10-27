import { useState } from 'react';
import { insertBucket, save } from '../lib/data';
import { money, monthName, todayISO } from '../lib/format';
import { firstPaymentFor, loanStatus } from '../lib/loan';
import { supabase } from '../lib/supabase';
import { ACCOUNT_TYPES, CURRENCIES, KIND_LABEL, type Bucket, type Tag, type TagKind } from '../lib/types';

const KINDS: TagKind[] = ['income', 'tax', 'opex', 'reserve', 'growth', 'expense'];
const LINKED: TagKind[] = ['opex', 'reserve', 'growth'];
const LIQUIDITY = ['Liquid', 'Locked until age', 'Illiquid'];

export function SetupScreen({ tags, buckets, onChange }: { tags: Tag[]; buckets: Bucket[]; onChange: () => void }) {
  const [tab, setTab] = useState<'tags' | 'accounts'>('accounts');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="screen">
      <header className="month-nav">
        <div className="month-title left">
          <span className="eyebrow">Settings</span>
          <h1>Accounts &amp; tags</h1>
        </div>
        <button className="btn ghost small-btn push-right" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts</button>
        <button role="tab" aria-selected={tab === 'tags'} onClick={() => setTab('tags')}>Tags</button>
      </div>

      {error && <p className="error card" role="alert">{error}</p>}

      {tab === 'tags' ? (
        <div className="tag-groups">
          {KINDS.map((k) => (
            <TagGroup key={k} kind={k} tags={tags.filter((t) => t.kind === k)} buckets={buckets} run={run} />
          ))}
        </div>
      ) : (
        <Accounts buckets={buckets} tags={tags} run={run} />
      )}
    </div>
  );
}

type Run = (fn: () => Promise<void>) => void;

function TagGroup({ kind, tags, buckets, run }: { kind: TagKind; tags: Tag[]; buckets: Bucket[]; run: Run }) {
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const live = tags.filter((t) => !t.archived);
  const archived = tags.filter((t) => t.archived);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    run(() => save('tags', { kind, name: name.trim(), sort: tags.length + 1 }));
    setName('');
  }

  return (
    <section className="card stack">
      <h2>{KIND_LABEL[kind]}</h2>
      <ul className="tag-list">
        {(showArchived ? [...live, ...archived] : live).map((t) => (
          <li key={t.id} className={t.archived ? 'archived' : ''}>
            <input
              aria-label={`Rename ${t.name}`}
              defaultValue={t.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && run(() => save('tags', { name: e.target.value.trim() }, t.id))}
            />
            {LINKED.includes(kind) && (
              <select
                aria-label={`Account for ${t.name}`}
                value={t.default_bucket_id ?? ''}
                onChange={(e) => run(() => save('tags', { default_bucket_id: e.target.value || null }, t.id))}
              >
                <option value="">No account</option>
                {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="btn ghost small-btn" onClick={() => run(() => save('tags', { archived: !t.archived }, t.id))}>
              {t.archived ? 'Restore' : 'Archive'}
            </button>
          </li>
        ))}
      </ul>
      <form className="add-row" onSubmit={add}>
        <input placeholder={`New ${KIND_LABEL[kind].toLowerCase()} tag`} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary small-btn">Add</button>
      </form>
      {archived.length > 0 && (
        <button className="link" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : `Show ${archived.length} archived`}
        </button>
      )}
    </section>
  );
}

function Accounts({ buckets, tags, run }: { buckets: Bucket[]; tags: Tag[]; run: Run }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [type, setTypeRaw] = useState('Card');
  const [liquidity, setLiquidity] = useState('Liquid');
  const setType = (t: string) => { setTypeRaw(t); setLiquidity(defaultLiquidity(t)); };

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const n = name.trim();
    run(async () => {
      const id = await insertBucket({ name: n, currency, type, liquidity, is_liability: isLiability(type), sort: buckets.length + 1 });
      await ensureBillLine(id, n, type, tags);
    });
    setName('');
  }

  const [showClosed, setShowClosed] = useState(false);
  const open = buckets.filter((b) => b.active);
  const closed = buckets.filter((b) => !b.active);
  const groups = GROUPS.map((g) => ({ ...g, items: open.filter((b) => g.types.includes(b.type)) })).filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      <p className="muted small">Each card and loan has its own bill line under Operating expenses.</p>
      {groups.map((g) => (
        <section key={g.label} className="stack" aria-label={g.label}>
          <h2 className={`group-title t-${g.types[0]}`}>{g.label}</h2>
          <div className="acct-grid">
            {g.items.map((b) => <AccountCard key={b.id} b={b} tags={tags} run={run} />)}
          </div>
        </section>
      ))}

      <form className="card stack acct-new" onSubmit={add}>
        <h2>Add an account</h2>
        <input placeholder="Name, e.g. DBS Multiplier" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid3">
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select aria-label="Liquidity" value={liquidity} onChange={(e) => setLiquidity(e.target.value)}>
            {LIQUIDITY.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn primary">Add account</button>
      </form>

      {closed.length > 0 && (
        <>
          <button className="link" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide closed accounts' : `Show ${closed.length} closed`}
          </button>
          {showClosed && <div className="acct-grid">{closed.map((b) => <AccountCard key={b.id} b={b} tags={tags} run={run} />)}</div>}
        </>
      )}
    </div>
  );
}

const GROUPS = [
  { label: 'Credit cards', types: ['Card'] },
  { label: 'Bank accounts and debit cards', types: ['Bank'] },
  { label: 'Cash', types: ['Cash'] },
  { label: 'Loans', types: ['Loan'] },
  { label: 'Investments', types: ['Brokerage'] },
  { label: 'Retirement and pension', types: ['Retirement'] },
  { label: 'Other', types: ['Property', 'Insurance', 'Other'] },
];

const isLiability = (type: string) => type === 'Card' || type === 'Loan';
const defaultLiquidity = (type: string) => (type === 'Retirement' ? 'Locked until age' : type === 'Property' ? 'Illiquid' : 'Liquid');

/** Credit cards and loans each get their own bill line under Operating expenses. */
async function ensureBillLine(id: string, name: string, type: string, tags: Tag[]) {
  if (!isLiability(type) || tags.some((t) => t.kind === 'opex' && t.default_bucket_id === id)) return;
  await save('tags', { kind: 'opex', name: `${name} ${type === 'Card' ? 'bill' : 'repayment'}`, default_bucket_id: id, sort: tags.length + 1 });
}

function AccountCard({ b, tags, run }: { b: Bucket; tags: Tag[]; run: Run }) {
  const set = (row: Record<string, unknown>) => run(() => save('buckets', row, b.id));
  return (
    <article className={`card acct t-${b.type} ${b.active ? '' : 'archived'}`}>
      <div className="acct-head">
        <span className="acct-badge">{b.currency}</span>
        <input
          className="acct-name"
          aria-label={`Rename ${b.name}`}
          defaultValue={b.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== b.name && set({ name: e.target.value.trim() })}
        />
      </div>
      <div className="acct-fields">
        <select aria-label={`Type of ${b.name}`} value={b.type} onChange={(e) => {
          const type = e.target.value;
          run(async () => {
            await save('buckets', { type, is_liability: isLiability(type) }, b.id);
            await ensureBillLine(b.id, b.name, type, tags);
          });
        }}>
          {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select aria-label={`Currency of ${b.name}`} value={b.currency} onChange={(e) => set({ currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label={`Liquidity of ${b.name}`} value={b.liquidity} onChange={(e) => set({ liquidity: e.target.value })}>
          {LIQUIDITY.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {b.liquidity === 'Locked until age' && (
        <label className="field inline">
          <span>Unlocks at age</span>
          <input inputMode="numeric" placeholder="e.g. 62" defaultValue={b.unlock_age ?? ''}
            onBlur={(e) => { const v = e.target.value === '' ? null : Math.round(Number(e.target.value)); if (v !== b.unlock_age) set({ unlock_age: v }); }} />
        </label>
      )}
      {b.active && (b.type === 'Card' || b.type === 'Loan') && <AccountDates b={b} run={run} />}
      <div className="acct-meta">
        <span />
        <button className="link small" onClick={() => set({ active: !b.active })}>
          {b.active ? 'Close account' : 'Reopen'}
        </button>
      </div>
    </article>
  );
}

/** Card: when the statement closes and when it's due. Loan: repayment schedule and balance. */
function AccountDates({ b, run }: { b: Bucket; run: Run }) {
  const day = (v: string) => (v === '' ? null : Math.min(31, Math.max(1, Math.round(Number(v)))));
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  const saveIf = (field: keyof Bucket, v: unknown) => v !== b[field] && run(() => save('buckets', { [field]: v }, b.id));

  if (b.type === 'Card') {
    return (
      <div className="account-dates">
        <label className="field">
          <span>Statement closes (day)</span>
          <input inputMode="numeric" placeholder="Month end" defaultValue={b.statement_day ?? ''} onBlur={(e) => saveIf('statement_day', day(e.target.value))} />
        </label>
        <label className="field">
          <span>Payment due (day)</span>
          <input inputMode="numeric" placeholder="e.g. 5" defaultValue={b.due_day ?? ''} onBlur={(e) => saveIf('due_day', day(e.target.value))} />
        </label>
      </div>
    );
  }

  const today = todayISO();
  const st = loanStatus(b, today);
  return (
    <>
      <div className="account-dates">
        <label className="field">
          <span>Repayment ({b.currency})</span>
          <input inputMode="decimal" placeholder="0" defaultValue={b.monthly_payment ?? ''} onBlur={(e) => saveIf('monthly_payment', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>How often</span>
          <select value={b.payment_cadence ?? 'monthly'} onChange={(e) => saveIf('payment_cadence', e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label className="field">
          <span>Payments made</span>
          <input key={`made-${st?.made}`} inputMode="numeric" placeholder="e.g. 25" defaultValue={st?.made ?? ''}
            onBlur={(e) => { if (e.target.value !== '' && Number(e.target.value) !== st?.made) saveIf('first_payment_on', firstPaymentFor(Math.round(Number(e.target.value)), b, today)); }} />
        </label>
        <label className="field">
          <span>Out of (total)</span>
          <input inputMode="numeric" placeholder="e.g. 60" defaultValue={b.term_payments ?? ''} onBlur={(e) => saveIf('term_payments', numOrNull(e.target.value))} />
        </label>
        <label className="field">
          <span>Due (day)</span>
          <input inputMode="numeric" placeholder="e.g. 15" defaultValue={b.due_day ?? ''} onBlur={(e) => saveIf('due_day', day(e.target.value))} />
        </label>
        <label className="field">
          <span>Interest, % a year <em className="muted">(optional)</em></span>
          <input inputMode="decimal" placeholder="e.g. 3.5" defaultValue={b.interest_rate ?? ''} onBlur={(e) => saveIf('interest_rate', numOrNull(e.target.value))} />
        </label>
      </div>
      {st && (
        <div className="loan-summary">
          <div className="meter" aria-hidden="true"><span className="grow" style={{ width: `${(st.made / (st.made + st.left)) * 100}%` }} /></div>
          <span className="small"><strong>{st.made} of {st.made + st.left}</strong> paid · last payment {monthName(st.lastPaymentOn.slice(0, 8) + '01')}</span>
          {st.balance !== null && (
            <span className="small">
              Balance <strong className="num">{money(st.balance, b.currency)}</strong>
              <span className="muted">{st.exact ? '' : ' (repayments left; add the interest rate for the exact figure)'}</span>
            </span>
          )}
        </div>
      )}
    </>
  );
}
