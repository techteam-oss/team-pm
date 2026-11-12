import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { directLink, isEmbedded, storageWorks } from '../lib/embed'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { linkError } = useAuth()
  const [error, setError] = useState<string | null>(linkError ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  // Inside the GHL page some browsers block storage, so the sign-in would not survive a reload.
  const blocked = isEmbedded() && !storageWorks()
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

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
    if (error) setError('Could not request a reset right now. Ask an admin to send you a reset link from the Members page.')
    else { setNotice('If that email has an account, a reset link is on its way. It works for 1 hour.'); setCooldown(60) }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={signIn}>
        <div className="auth-logo"><img src="brand/impact-hub-mark.svg" width={36} height={36} alt="" /><span>Impact <span className="brand-hub">Hub</span></span></div>
        <h1>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>Welcome back. This workspace is invite-only, so ask an admin if you need an account.</p>
        {blocked && (
          <div className="banner warn" role="status">
            This browser blocks sign-in inside this page, so you would be signed out on every reload.
            <a className="btn small" href={directLink()} target="_blank" rel="noopener"><ExternalLink size={13} aria-hidden />Open Impact Hub in its own window</a>
          </div>
        )}
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link" onClick={forgot} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Reset link sent. You can ask again in ${cooldown}s` : 'Forgot password?'}</button>
      </form>
    </div>
  )
}
