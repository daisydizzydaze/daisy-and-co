import { useState } from 'react';
import { insertBucket, save } from '../lib/data';
import { supabase } from '../lib/supabase';
import { CURRENCIES, KIND_LABEL, type Bucket, type Tag, type TagKind } from '../lib/types';

const KINDS: TagKind[] = ['income', 'tax', 'opex', 'reserve', 'growth', 'expense'];
const LINKED: TagKind[] = ['opex', 'reserve', 'growth'];
const BUCKET_TYPES = ['Cash', 'Card', 'Brokerage', 'Retirement', 'Property', 'Insurance', 'Loan', 'Other'];
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
        <button className="btn ghost small-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
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
  const [type, setType] = useState('Cash');
  const [liquidity, setLiquidity] = useState('Liquid');

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const n = name.trim();
    run(async () => {
      const id = await insertBucket({ name: n, currency, type, liquidity, is_liability: type === 'Card' || type === 'Loan', sort: buckets.length + 1 });
      // Cards and loans get their own line under Operating expenses.
      if ((type === 'Card' || type === 'Loan') && !tags.some((t) => t.kind === 'opex' && t.default_bucket_id === id)) {
        await save('tags', { kind: 'opex', name: `${n} ${type === 'Card' ? 'bill' : 'repayment'}`, default_bucket_id: id, sort: tags.length + 1 });
      }
    });
    setName('');
  }

  return (
    <section className="card stack">
      <h2>Accounts</h2>
      <p className="muted small">Bank accounts, cards, loans and investment pots. Each card and loan has its own line under Operating expenses.</p>
      <ul className="tag-list accounts">
        {buckets.map((b) => (
          <li key={b.id} className={b.active ? '' : 'archived'}>
            <input
              aria-label={`Rename ${b.name}`}
              defaultValue={b.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== b.name && run(() => save('buckets', { name: e.target.value.trim() }, b.id))}
            />
            <span className="muted small nowrap">{b.currency} · {b.type} · {b.liquidity}</span>
            <button className="btn ghost small-btn" onClick={() => run(() => save('buckets', { active: !b.active }, b.id))}>
              {b.active ? 'Close' : 'Reopen'}
            </button>
            {b.active && (b.type === 'Card' || b.type === 'Loan') && <AccountDates b={b} run={run} />}
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={add}>
        <input placeholder="New account, e.g. DBS Multiplier" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid3">
          <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            {BUCKET_TYPES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Liquidity" value={liquidity} onChange={(e) => setLiquidity(e.target.value)}>
            {LIQUIDITY.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn primary">Add account</button>
      </form>
    </section>
  );
}

/** Card: when the statement closes and when it's due. Loan: monthly repayment and due day. */
function AccountDates({ b, run }: { b: Bucket; run: Run }) {
  const day = (v: string) => (v === '' ? null : Math.min(31, Math.max(1, Math.round(Number(v)))));
  const saveIf = (field: keyof Bucket, v: number | null) => v !== b[field] && run(() => save('buckets', { [field]: v }, b.id));
  return (
    <div className="account-dates">
      {b.type === 'Card' ? (
        <label className="field">
          <span>Statement closes (day)</span>
          <input inputMode="numeric" placeholder="Month end" defaultValue={b.statement_day ?? ''} onBlur={(e) => saveIf('statement_day', day(e.target.value))} />
        </label>
      ) : (
        <label className="field">
          <span>Repayment ({b.currency})</span>
          <input inputMode="decimal" placeholder="0" defaultValue={b.monthly_payment ?? ''} onBlur={(e) => saveIf('monthly_payment', e.target.value === '' ? null : Number(e.target.value.replace(/,/g, '')))} />
        </label>
      )}
      <label className="field">
        <span>Payment due (day)</span>
        <input inputMode="numeric" placeholder="e.g. 5" defaultValue={b.due_day ?? ''} onBlur={(e) => saveIf('due_day', day(e.target.value))} />
      </label>
    </div>
  );
}
