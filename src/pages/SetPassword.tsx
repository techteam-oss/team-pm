import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { checkPassword } from '../lib/password'

export default function SetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { session } = useAuth()

  async function save(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true); setError(null)
    const problem = await checkPassword(password, session?.user.email)
    if (problem) { setBusy(false); setError(problem); return }
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    try { sessionStorage.removeItem('team-pm-needs-password') } catch { /* ignore */ }
    window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={save}>
        <div className="auth-logo"><span className="ws-logo" aria-hidden>T</span>Team PM</div>
        <h1>Set your password</h1>
        <p className="muted">You'll use this with your email to sign in from now on. Use 8 or more characters; a short phrase of 3 or 4 words works well.</p>
        <label>New password<input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Save password'}</button>
      </form>
    </div>
  )
}
