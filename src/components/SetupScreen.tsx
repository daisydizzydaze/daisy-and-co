import { useState } from 'react';
import { save } from '../lib/data';
import { supabase } from '../lib/supabase';
import { CURRENCIES, KIND_LABEL, type Bucket, type Tag, type TagKind } from '../lib/types';

const KINDS: TagKind[] = ['income', 'tax', 'opex', 'reserve', 'growth', 'expense'];
const LINKED: TagKind[] = ['opex', 'reserve', 'growth'];
const BUCKET_TYPES = ['Cash', 'Card', 'Brokerage', 'Retirement', 'Property', 'Insurance', 'Loan', 'Other'];
const LIQUIDITY = ['Liquid', 'Locked until age', 'Illiquid'];

export function SetupScreen({ tags, buckets, onChange }: { tags: Tag[]; buckets: Bucket[]; onChange: () => void }) {
  const [tab, setTab] = useState<'tags' | 'accounts'>('tags');
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
          <span className="eyebrow">Setup</span>
          <h1>Tags &amp; accounts</h1>
        </div>
        <button className="btn ghost small-btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'tags'} onClick={() => setTab('tags')}>Tags</button>
        <button role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>Accounts</button>
      </div>

      {error && <p className="error card" role="alert">{error}</p>}

      {tab === 'tags' ? (
        <div className="tag-groups">
          {KINDS.map((k) => (
            <TagGroup key={k} kind={k} tags={tags.filter((t) => t.kind === k)} buckets={buckets} run={run} />
          ))}
        </div>
      ) : (
        <Accounts buckets={buckets} run={run} />
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

function Accounts({ buckets, run }: { buckets: Bucket[]; run: Run }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [type, setType] = useState('Cash');
  const [liquidity, setLiquidity] = useState('Liquid');

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    run(() => save('buckets', { name: name.trim(), currency, type, liquidity, is_liability: type === 'Card' || type === 'Loan', sort: buckets.length + 1 }));
    setName('');
  }

  return (
    <section className="card stack">
      <h2>Accounts</h2>
      <p className="muted small">Bank accounts, cards and investment pots. Cards are matched to your card-repayment lines.</p>
      <ul className="tag-list">
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
