import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace, type Access, type Role } from '../lib/workspace'
import { askConfirm, notify } from '../components/Dialogs'
import { ago } from '../components/NotificationBell'
import { KeyRound, Lock, Send } from 'lucide-react'

type Row = { user_id: string; role: Role; full_name: string | null; email: string | null; spaces: Record<string, Access>
  /** Never set a password, so they can't sign in yet. */
  pending: boolean; invited_at: string | null; last_sign_in_at: string | null }
type LoginStatus = { member_id: string; has_password: boolean; confirmed: boolean; invited_at: string | null; last_sign_in_at: string | null }
const ACCESS: Access[] = ['view', 'comment', 'edit', 'full']

export default function Members() {
  const { session } = useAuth()
  const { workspace, role: myRole, spaces } = useWorkspace()
  const [rows, setRows] = useState<Row[]>([])
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [grant, setGrant] = useState<Record<string, Access | ''>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)

  async function load() {
    if (!workspace) return
    const { data: m } = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspace.id)
    const ids = (m ?? []).map(r => r.user_id)
    const [{ data: p }, { data: sm }, { data: st }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').in('id', ids),
      supabase.from('space_members').select('space_id, user_id, access').in('user_id', ids),
      supabase.rpc('member_login_status', { ws: workspace.id }),
    ])
    setRows((m ?? []).map(r => {
      const prof = p?.find(x => x.id === r.user_id)
      const mine = (sm ?? []).filter(x => x.user_id === r.user_id)
      const login = ((st ?? []) as LoginStatus[]).find(x => x.member_id === r.user_id)
      return { user_id: r.user_id, role: r.role as Role, full_name: prof?.full_name ?? null, email: prof?.email ?? null,
        spaces: Object.fromEntries(mine.map(x => [x.space_id, x.access as Access])),
        pending: login ? !login.has_password : false, invited_at: login?.invited_at ?? null, last_sign_in_at: login?.last_sign_in_at ?? null }
    }).sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '')))
  }

  useEffect(() => { load() }, [workspace?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin(myRole)) return <p className="muted">Only admins can manage members.</p>

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!workspace) return
    setBusy(true); setMsg(null); setLink(null)
    const spaceList = Object.entries(grant).filter(([, a]) => a).map(([space_id, access]) => ({ space_id, access }))
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { workspace_id: workspace.id, email, full_name: fullName, role, spaces: spaceList,
        redirect_to: window.location.origin + window.location.pathname },
    })
    setBusy(false)
    if (error || data?.error) {
      let text = data?.error ?? error?.message ?? 'Something went wrong'
      try { const j = await (error as { context?: Response })?.context?.json(); if (j?.error) text = j.error } catch { /* ignore */ }
      setMsg({ ok: false, text }); return
    }
    if (!data.invited) setMsg({ ok: true, text: `${email} already had an account and was added.` })
    else if (data.emailed) setMsg({ ok: true, text: `Invite email sent to ${email} through GoHighLevel.` })
    else { setMsg({ ok: true, text: `${email} was added. Email sending isn't set up yet, so send them this invite link yourself:` }); setLink(data.invite_link) }
    setEmail(''); setFullName(''); setGrant({}); load()
  }

  // A fresh invite link for someone who never finished signing up, or a set-password link for anyone else.
  async function resend(r: Row) {
    if (!workspace || !r.email) return
    setResending(r.user_id); setMsg(null); setLink(null)
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { workspace_id: workspace.id, email: r.email, role: r.role === 'owner' ? 'admin' : r.role, resend: true,
        redirect_to: window.location.origin + window.location.pathname },
    })
    setResending(null)
    if (error || data?.error) {
      let text = data?.error ?? error?.message ?? 'Something went wrong'
      try { const j = await (error as { context?: Response })?.context?.json(); if (j?.error) text = j.error } catch { /* ignore */ }
      notify(text); return
    }
    const what = data.kind === 'invite' ? 'A new invite link' : 'A link to set a new password'
    if (data.emailed) { notify(`${what} was emailed to ${r.email}. It works for 1 hour.`, 'ok'); load(); return }
    setMsg({ ok: true, text: `${what} for ${r.email} is ready. Email sending isn't set up yet, so send it to them yourself. It works once, for 1 hour:` })
    setLink(data.invite_link)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    load()
  }

  async function changeRole(r: Row, newRole: Role) {
    const { error } = await supabase.from('workspace_members').update({ role: newRole })
      .eq('workspace_id', workspace!.id).eq('user_id', r.user_id)
    if (error) notify(error.message); load()
  }

  async function changeSpace(r: Row, spaceId: string, access: Access | '') {
    const { error } = access
      ? await supabase.from('space_members').upsert({ space_id: spaceId, user_id: r.user_id, access })
      : await supabase.from('space_members').delete().eq('space_id', spaceId).eq('user_id', r.user_id)
    if (error) notify(error.message); load()
  }

  async function remove(r: Row) {
    if (!await askConfirm({ title: `Remove ${r.full_name ?? r.email}?`, body: 'They lose access to the workspace immediately.', confirmLabel: 'Remove', danger: true })) return
    await supabase.from('space_members').delete().eq('user_id', r.user_id).in('space_id', spaces.map(s => s.id))
    const { error } = await supabase.from('workspace_members').delete().eq('workspace_id', workspace!.id).eq('user_id', r.user_id)
    if (error) notify(error.message); load()
  }

  const roleOptions: Role[] = ['admin', 'member', 'guest']

  return (
    <div className="stack">
      <div className="page-title"><h1>Members</h1><p className="muted small">Invite people, set their role and choose which spaces they can open. Invite links work for 1 hour; use Resend invite if one ran out.</p></div>
      <form className="card stack" onSubmit={invite}>
        <h2>Add a person</h2>
        <div className="grid2">
          <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Name (optional)<input value={fullName} onChange={e => setFullName(e.target.value)} /></label>
        </div>
        <label>Role
          <select value={role} onChange={e => setRole(e.target.value as Role)}>
            <option value="admin">Admin: manages people, spaces and everything else</option>
            <option value="member">Member: works in all public spaces, plus private ones you add</option>
            <option value="guest">Guest: only the spaces you pick below</option>
          </select>
        </label>
        {spaces.length > 0 && role !== 'admin' && (
          <div>
            <div className="label">Spaces and access</div>
            <table className="grid">
              <tbody>
                {spaces.map(sp => (
                  <tr key={sp.id}>
                    <td>{sp.name}{sp.is_private && <Lock size={12} className="lock" aria-label="Private" style={{ marginLeft: 6 }} />}</td>
                    <td>
                      <select value={grant[sp.id] ?? ''} onChange={e => setGrant(g => ({ ...g, [sp.id]: e.target.value as Access | '' }))}>
                        <option value="">{role === 'member' && !sp.is_private ? 'Default (edit)' : 'No access'}</option>
                        {ACCESS.map(a => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
        {link && (
          <div className="row">
            <input readOnly value={link} style={{ flex: 1 }} onFocus={e => e.target.select()} />
            <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
          </div>
        )}
        <div><button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button></div>
      </form>

      <div className="card">
        <h2>Members ({rows.length})</h2>
        <table className="grid members-table">
          <thead><tr><th>Person</th><th>Role</th>{spaces.map(s => <th key={s.id}>{s.name}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map(r => {
              const self = r.user_id === session!.user.id
              const locked = self || r.role === 'owner'
              return (
                <tr key={r.user_id}>
                  <td>
                    <div>{r.full_name ?? r.email}</div><div className="muted small">{r.email}</div>
                    {r.pending
                      ? <span className="pill warn" title="They have not set a password yet, so they can't sign in.">Invite not accepted{r.invited_at ? ` · sent ${ago(r.invited_at)}` : ''}</span>
                      : r.last_sign_in_at && <span className="muted small">Last sign-in {ago(r.last_sign_in_at)}</span>}
                  </td>
                  <td>
                    {locked ? <span className="pill">{r.role}</span> : (
                      <select value={r.role} onChange={e => changeRole(r, e.target.value as Role)}>
                        {roleOptions.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </td>
                  {spaces.map(sp => (
                    <td key={sp.id}>
                      {r.role === 'owner' || r.role === 'admin' ? <span className="muted small">full</span> : (
                        <select value={r.spaces[sp.id] ?? ''} onChange={e => changeSpace(r, sp.id, e.target.value as Access | '')}>
                          <option value="">{r.role === 'member' && !sp.is_private ? 'default' : 'none'}</option>
                          {ACCESS.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="member-actions">
                      {!self && (r.pending
                        ? <button className="btn small" disabled={resending === r.user_id} onClick={() => resend(r)}><Send size={13} aria-hidden />{resending === r.user_id ? 'Sending…' : 'Resend invite'}</button>
                        : <button className="btn ghost small" disabled={resending === r.user_id} onClick={() => resend(r)} title="Send them a link to choose a new password"><KeyRound size={13} aria-hidden />{resending === r.user_id ? 'Sending…' : 'Reset password'}</button>)}
                      {!locked && <button className="danger-link" onClick={() => remove(r)}>Remove</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
