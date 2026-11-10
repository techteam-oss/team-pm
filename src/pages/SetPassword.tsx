import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function SetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    try { sessionStorage.removeItem('team-pm-needs-password') } catch { /* ignore */ }
    window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <div className="center">
      <form className="card auth-card" onSubmit={save}>
        <div className="brand">Team PM</div>
        <h1>Set your password</h1>
        <p className="muted">You'll use this with your email to sign in from now on.</p>
        <label>New password<input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  )
}
