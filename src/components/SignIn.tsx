import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Bud } from './Bud';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message);
    setBusy(false);
  }

  return (
    <main className="signin">
      <Bud mood="happy" size={112} />
      <h1>Daisy &amp; Co.</h1>
      <p className="muted">Sign in to open the books.</p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
