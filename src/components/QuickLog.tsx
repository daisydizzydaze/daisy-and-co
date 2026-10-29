import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Key { id: string; label: string; created_at: string; last_used_at: string | null }

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'dq_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings › Quick log: a secret key that lets an iPhone Shortcut add expenses without opening the app. */
export function QuickLog() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function load() {
    const res = await supabase.from('quick_keys').select('id,label,created_at,last_used_at').order('created_at');
    if (res.error) {
      setError(res.error.message.includes('quick_keys') ? 'The database needs the latest update first. Run 007_quick_log.sql in the Supabase SQL Editor.' : res.error.message);
      setKeys([]);
    } else setKeys(res.data as Key[]);
  }
  useEffect(() => { load(); }, []);

  async function make() {
    setError(null);
    const k = newKey();
    const res = await supabase.from('quick_keys').insert({ key_hash: await sha256Hex(k) });
    if (res.error) return setError(res.error.message);
    setFresh(k);
    load();
  }
  async function revoke(id: string) {
    const res = await supabase.from('quick_keys').delete().eq('id', id);
    if (res.error) setError(res.error.message);
    setConfirm(null);
    load();
  }

  const jwt = ANON.startsWith('eyJ');
  const key = fresh ?? 'your key';

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Quick log from your iPhone</h2>
        <p className="muted small">
          An iPhone Shortcut asks how much, which category and which card, then saves the expense. The app doesn’t open.
          Put it on your Action Button, Lock Screen or a home-screen widget.
        </p>
        <p className="muted small">
          The key lets the Shortcut add expenses and read your category and account names. Nothing else. Only a fingerprint of it is stored here, so it’s shown once. Revoke it anytime.
        </p>

        {fresh && (
          <div className="key-box stack">
            <strong>Your new key. Copy it now, it won’t be shown again.</strong>
            <code className="copy">{fresh}</code>
            <button type="button" className="btn primary small-btn" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy key</button>
          </div>
        )}

        {keys && keys.length > 0 && (
          <ul className="rows">
            {keys.map((k) => (
              <li key={k.id}>
                <span className="row">
                  <span className="row-main">
                    <span className="tag">{k.label}</span>
                    <span className="muted small">made {day(k.created_at)} · {k.last_used_at ? `last used ${day(k.last_used_at)}` : 'not used yet'}</span>
                  </span>
                </span>
                <button type="button" className="btn ghost small-btn danger" onClick={() => (confirm === k.id ? revoke(k.id) : setConfirm(k.id))}>
                  {confirm === k.id ? 'Tap again to revoke' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="btn primary" onClick={make}>{keys && keys.length > 0 ? 'Make another key' : 'Make a key'}</button>
      </section>

      <section className="card stack recipe">
        <h2>Build the Shortcut (once, about 5 minutes)</h2>
        <p className="muted small">In the Shortcuts app tap +, then add these actions in order. Tap a grey box to copy it.</p>
        <ol>
          <li>
            <strong>Get Contents of URL</strong>
            <Copy v={`${URL_BASE}/rest/v1/rpc/quick_options`} />
            Tap ›: Method <b>POST</b>. Headers: <b>apikey</b> = <Copy v={ANON} short />{jwt && <> and <b>Authorization</b> = <Copy v={`Bearer ${ANON}`} short /></>}.
            Request Body <b>JSON</b>, one Text field: <b>key</b> = <Copy v={key} short />
          </li>
          <li><strong>Ask for Input</strong>: type <b>Number</b>, prompt “How much?”</li>
          <li><strong>Get Dictionary Value</strong>: <b>categories</b> in <i>Contents of URL</i>, then <strong>Choose from List</strong> (prompt “Category”)</li>
          <li><strong>Get Dictionary Value</strong>: <b>accounts</b> in <i>Contents of URL</i>, then <strong>Choose from List</strong> (prompt “Paid with”). Your most-used account is at the top.</li>
          <li><em>Optional:</em> <strong>Ask for Input</strong>, type <b>Text</b>, prompt “Where?”</li>
          <li>
            <strong>Get Contents of URL</strong>
            <Copy v={`${URL_BASE}/rest/v1/rpc/quick_log`} />
            Same method and headers as step 1. JSON body: <b>key</b> = your key, <b>amount</b> (Number) = <i>Provided Input</i> from step 2,{' '}
            <b>category</b> = <i>Chosen Item</i> from step 3, <b>account</b> = <i>Chosen Item</i> from step 4, and optionally <b>vendor</b> = step 5.
          </li>
          <li><strong>Show Notification</strong> with <i>Contents of URL</i>. It reads like “Logged TWD 45.00 · Coffee &amp; drinks · TWD cash”.</li>
        </ol>
        <p className="muted small">
          Name it “Log expense”. Then Settings › Action Button › Shortcut, or add a Shortcuts widget to your home or Lock Screen.
          The date is today. The currency is whatever you last used on that account this week (TWD while you’re in Taiwan), otherwise the account’s own currency.
          Need or Want follows the category. Cash and bank are settled straight away. Edit anything later in the app.
        </p>
      </section>
    </div>
  );
}

function Copy({ v, short }: { v: string; short?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`copy ${short ? 'short' : ''}`} title="Copy" onClick={() => { navigator.clipboard?.writeText(v); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'Copied' : v}
    </button>
  );
}
