import { useEffect, useState, type ReactNode } from 'react';
import { request } from './api';

export function Session({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request<{ username: string }>('/auth/me').then(data => setUsername(data.username))
      .catch(e => { if (e.status !== 401) setError(e.message); }).finally(() => setLoading(false));
    const expired = () => { setUsername(null); setError('A sessão terminou. Entre novamente.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (loading) return <main><p role="status">Verificando acesso…</p></main>;
  if (username) return <><div className="session-bar"><span>Conectado como {username}</span><button className="link" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await request('/auth/logout', 'POST', {}); setUsername(null); setError(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}>Sair</button>{error && <span role="alert">{error}</span>}</div>{children}</>;
  return <main className="login"><section className="panel"><p className="eyebrow">ENGESOFTWARE GAMING LEAGUE</p><h1>Entre na liga.</h1><p className="hint">Acesse para acompanhar o ranking e organizar as partidas.</p>
    {error && <p role="alert" className="message error">{error}</p>}
    <form onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
      try { const data = await request<{ username: string }>('/auth/login', 'POST', { username: form.get('username'), password: form.get('password') }); setUsername(data.username); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}><fieldset disabled={busy}><label className="field"><span>Usuário</span><input name="username" autoComplete="username" required maxLength={100} /></label>
      <label className="field"><span>Senha</span><input name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>
      <button className="primary">{busy ? 'Entrando…' : 'Entrar'}</button></fieldset></form>
  </section></main>;
}
