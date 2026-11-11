import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { linkError } = useAuth()
  const [error, setError] = useState<string | null>(linkError ?? null)
  const [notice, setNotice] = useState<string | null>(null)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  async function forgot() {
    if (!email) { setError('Enter your email first.'); return }
    setBusy(true); setError(null)
    // The reset email is sent by GoHighLevel, via the password-reset function.
    const { error } = await supabase.functions.invoke('password-reset', { body: { email } })
    setBusy(false)
    if (error) setError('Could not request a reset right now. Ask an admin to resend your invite.')
    else setNotice('If that email has an account, a reset link is on its way.')
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={signIn}>
        <div className="auth-logo"><span className="ws-logo" aria-hidden>T</span>Team PM</div>
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>Welcome back. This workspace is invite-only, so ask an admin if you need an account.</p>
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link" onClick={forgot} disabled={busy}>Forgot password?</button>
      </form>
    </div>
  )
}
