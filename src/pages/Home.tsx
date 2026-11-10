import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { applyTheme, type Theme } from '../lib/theme'
import ThemeSwitch from '../components/ThemeSwitch'

type Workspace = { id: string; name: string }
type Member = { user_id: string; role: string; full_name: string | null; email: string | null }

export default function Home() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data: profile } = await supabase.from('profiles').select('theme').eq('id', userId).single()
    if (profile?.theme) applyTheme(profile.theme as Theme)

    const { data, error } = await supabase.from('workspaces').select('id, name').order('created_at')
    if (error) { setError(error.message); return }
    setWorkspaces(data)
    if (data.length) {
      const { data: rows } = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', data[0].id)
      const ids = (rows ?? []).map(r => r.user_id)
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
      setMembers((rows ?? []).map(r => {
        const p = profiles?.find(x => x.id === r.user_id)
        return { ...r, full_name: p?.full_name ?? null, email: p?.email ?? null }
      }))
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase.rpc('create_workspace', { ws_name: name.trim() })
    if (error) setError(error.message)
    else { setName(''); load() }
  }

  const ws = workspaces?.[0]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="ws-name">{ws?.name ?? 'Team PM'}</div>
        <nav>
          <a className="active" href="#/">Home</a>
          <span className="nav-soon">Spaces, lists and tasks arrive in Phase 1–2</span>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="muted">Signed in as {session!.user.email}</div>
          <div className="row">
            <ThemeSwitch userId={userId} />
            <button onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </header>

        <section className="content">
          {error && <div className="error">{error}</div>}
          {workspaces === null ? (
            <p className="muted">Loading…</p>
          ) : !ws ? (
            <form className="card" onSubmit={create}>
              <h2>Create your workspace</h2>
              <p className="muted">You'll be its owner. Usually one workspace for the whole team.</p>
              <div className="row">
                <input placeholder="e.g. Impact Network" required maxLength={80} value={name} onChange={e => setName(e.target.value)} />
                <button className="primary">Create</button>
              </div>
            </form>
          ) : (
            <div className="card">
              <h2>{ws.name}</h2>
              <p className="muted">Phase 0 is working: you're signed in, your theme is saved, and the database only shows you your own workspace.</p>
              <h3>Members</h3>
              <ul className="members">
                {members.map(m => (
                  <li key={m.user_id}>
                    <span className="avatar">{(m.full_name ?? m.email ?? '?')[0].toUpperCase()}</span>
                    <span>{m.full_name ?? m.email}</span>
                    <span className="pill">{m.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
