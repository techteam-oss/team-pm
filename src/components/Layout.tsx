import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace } from '../lib/workspace'
import ThemeSwitch from './ThemeSwitch'
import { fmtClock, useNow, useTimer } from '../lib/time'

export default function Layout({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const { workspace, role, spaces, lists, level, refresh } = useWorkspace()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const admin = isAdmin(role)
  const { running, stop } = useTimer()
  const now = useNow(!!running)

  async function addSpace() {
    const name = prompt('Space name')?.trim()
    if (!name || !workspace) return
    const isPrivate = confirm('Make this space private? (OK = private, only people you add can see it)')
    const { error } = await supabase.from('spaces').insert({ workspace_id: workspace.id, name, is_private: isPrivate })
    if (error) alert(error.message); else refresh()
  }

  async function addList(spaceId: string) {
    const name = prompt('List name')?.trim()
    if (!name) return
    const { error } = await supabase.from('lists').insert({ space_id: spaceId, name })
    if (error) alert(error.message); else { setOpen(o => ({ ...o, [spaceId]: true })); refresh() }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="ws-name">{workspace?.name ?? 'Team PM'}</div>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/my">My tasks</NavLink>
          {admin && <NavLink to="/members">Members</NavLink>}
        </nav>
        {workspace && (
          <div className="spaces">
            <div className="section-head">
              <span>Spaces</span>
              {admin && <button className="icon" title="New space" onClick={addSpace}>+</button>}
            </div>
            {spaces.length === 0 && <div className="nav-soon">{admin ? 'Create your first space with +' : 'No spaces shared with you yet'}</div>}
            {spaces.map(sp => {
              const isOpen = open[sp.id] ?? true
              return (
                <div key={sp.id} className="space">
                  <div className="space-row">
                    <button className="space-toggle" onClick={() => setOpen(o => ({ ...o, [sp.id]: !isOpen }))}>
                      <span className="dot" style={{ background: sp.color }} />
                      <span className="space-name">{sp.name}</span>
                      {sp.is_private && <span className="lock" title="Private">🔒</span>}
                    </button>
                    {level(sp.id) >= 4 && <button className="icon" title="New list" onClick={() => addList(sp.id)}>+</button>}
                  </div>
                  {isOpen && lists.filter(l => l.space_id === sp.id).map(l => (
                    <NavLink key={l.id} to={`/list/${l.id}`} className="list-link">{l.name}</NavLink>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="muted">{session!.user.email}{role && <span className="pill" style={{ marginLeft: 8 }}>{role}</span>}</div>
          <div className="row">
            {running && (
              <span className="timer-chip">
                <Link to={`/list/${running.task?.list_id}?task=${running.task_id}`} title={running.task?.title}>
                  ⏱ {fmtClock(now - new Date(running.started_at).getTime())} <span className="timer-title">{running.task?.title}</span>
                </Link>
                <button className="icon" title="Stop timer" onClick={stop}>■</button>
              </span>
            )}
            <ThemeSwitch userId={session!.user.id} />
            <button onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </header>
        <section className="content">{children}</section>
      </main>
    </div>
  )
}
