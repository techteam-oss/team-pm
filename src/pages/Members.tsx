import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace, type Access, type Role } from '../lib/workspace'

type Row = { user_id: string; role: Role; full_name: string | null; email: string | null; spaces: Record<string, Access> }
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

  async function load() {
    if (!workspace) return
    const { data: m } = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspace.id)
    const ids = (m ?? []).map(r => r.user_id)
    const [{ data: p }, { data: sm }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').in('id', ids),
      supabase.from('space_members').select('space_id, user_id, access').in('user_id', ids),
    ])
    setRows((m ?? []).map(r => {
      const prof = p?.find(x => x.id === r.user_id)
      const mine = (sm ?? []).filter(x => x.user_id === r.user_id)
      return { user_id: r.user_id, role: r.role as Role, full_name: prof?.full_name ?? null, email: prof?.email ?? null,
        spaces: Object.fromEntries(mine.map(x => [x.space_id, x.access as Access])) }
    }).sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '')))
  }

  useEffect(() => { load() }, [workspace?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin(myRole)) return <p className="muted">Only admins can manage members.</p>

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!workspace) return
    setBusy(true); setMsg(null)
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
    setMsg({ ok: true, text: data.invited ? `Invite email sent to ${email}.` : `${email} already had an account and was added.` })
    setEmail(''); setFullName(''); setGrant({}); load()
  }

  async function changeRole(r: Row, newRole: Role) {
    const { error } = await supabase.from('workspace_members').update({ role: newRole })
      .eq('workspace_id', workspace!.id).eq('user_id', r.user_id)
    if (error) alert(error.message); load()
  }

  async function changeSpace(r: Row, spaceId: string, access: Access | '') {
    const { error } = access
      ? await supabase.from('space_members').upsert({ space_id: spaceId, user_id: r.user_id, access })
      : await supabase.from('space_members').delete().eq('space_id', spaceId).eq('user_id', r.user_id)
    if (error) alert(error.message); load()
  }

  async function remove(r: Row) {
    if (!confirm(`Remove ${r.full_name ?? r.email} from the workspace? They lose access immediately.`)) return
    await supabase.from('space_members').delete().eq('user_id', r.user_id).in('space_id', spaces.map(s => s.id))
    const { error } = await supabase.from('workspace_members').delete().eq('workspace_id', workspace!.id).eq('user_id', r.user_id)
    if (error) alert(error.message); load()
  }

  const roleOptions: Role[] = ['admin', 'member', 'guest']

  return (
    <div className="stack">
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
                    <td>{sp.name}{sp.is_private ? ' 🔒' : ''}</td>
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
                  <td><div>{r.full_name ?? r.email}</div><div className="muted small">{r.email}</div></td>
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
                  <td>{!locked && <button className="danger-link" onClick={() => remove(r)}>Remove</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
