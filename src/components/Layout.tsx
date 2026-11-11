import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace } from '../lib/workspace'
import ThemeSwitch from './ThemeSwitch'
import Menu from './Menu'
import SpaceSettings from './SpaceSettings'
import type { List } from '../lib/workspace'
import { fmtClock, useNow, useTimer } from '../lib/time'

export default function Layout({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const { workspace, role, spaces, lists, folders, level, refresh } = useWorkspace()
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const admin = isAdmin(role)
  const { running, stop } = useTimer()
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key !== '/' || e.metaKey || e.ctrlKey || el.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('.top-search input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const now = useNow(!!running)

  async function addSpace() {
    const name = prompt('Space name')?.trim()
    if (!name || !workspace) return
    const isPrivate = confirm('Make this space private? (OK = private, only people you add can see it)')
    const { error } = await supabase.from('spaces').insert({ workspace_id: workspace.id, name, is_private: isPrivate })
    if (error) alert(error.message); else refresh()
  }

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    if (error) alert(error.message); else refresh()
    return !error
  }
  async function addList(spaceId: string, folderId: string | null = null) {
    const name = prompt('List name')?.trim()
    if (!name) return
    if (await run(supabase.from('lists').insert({ space_id: spaceId, folder_id: folderId, name }))) {
      setOpen(o => ({ ...o, [spaceId]: true, ...(folderId ? { [folderId]: true } : {}) }))
    }
  }
  async function addFolder(spaceId: string) {
    const name = prompt('Folder name')?.trim()
    if (name && await run(supabase.from('folders').insert({ space_id: spaceId, name }))) setOpen(o => ({ ...o, [spaceId]: true }))
  }
  function renameList(l: List) {
    const name = prompt('Rename list', l.name)?.trim()
    if (name && name !== l.name) run(supabase.from('lists').update({ name }).eq('id', l.id))
  }
  function moveList(l: List) {
    const options = folders.filter(f => f.space_id === l.space_id)
    if (!options.length) { alert('This space has no folders yet. Create one from the space menu.'); return }
    const pick = prompt(`Move "${l.name}" to which folder? Type a number:\n0. No folder\n${options.map((f, i) => `${i + 1}. ${f.name}`).join('\n')}`)
    if (pick === null) return
    const n = Number(pick)
    if (!Number.isInteger(n) || n < 0 || n > options.length) return
    run(supabase.from('lists').update({ folder_id: n === 0 ? null : options[n - 1].id }).eq('id', l.id))
  }
  function archiveList(l: List) {
    if (confirm(`Archive the list "${l.name}"? It disappears from the sidebar; its tasks are kept.`)) run(supabase.from('lists').update({ archived: true }).eq('id', l.id))
  }
  async function deleteFolder(id: string, name: string) {
    if (!confirm(`Delete the folder "${name}"? Its lists move up into the space, nothing is lost.`)) return
    const moved = await supabase.from('lists').update({ folder_id: null }).eq('folder_id', id)
    if (moved.error) { alert(moved.error.message); return }
    run(supabase.from('folders').delete().eq('id', id))
  }
  function renameFolder(id: string, current: string) {
    const name = prompt('Rename folder', current)?.trim()
    if (name && name !== current) run(supabase.from('folders').update({ name }).eq('id', id))
  }

  const listLink = (l: List, full: boolean) => (
    <div key={l.id} className="list-row">
      <NavLink to={`/list/${l.id}`} className="list-link">{l.name}</NavLink>
      {full && <Menu title="List options" items={[
        { label: 'Rename', onClick: () => renameList(l) },
        { label: 'Move to folder…', onClick: () => moveList(l) },
        { label: 'Archive list', onClick: () => archiveList(l), danger: true },
      ]} />}
    </div>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="ws-name">{workspace?.name ?? 'Team PM'}</div>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/my">My tasks</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/archive">Archive</NavLink>
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
              const full = level(sp.id) >= 4
              const spaceLists = lists.filter(l => l.space_id === sp.id)
              return (
                <div key={sp.id} className="space">
                  <div className="space-row">
                    <button className="space-toggle" onClick={() => setOpen(o => ({ ...o, [sp.id]: !isOpen }))}>
                      {sp.icon ? <span className="space-icon">{sp.icon}</span> : <span className="dot" style={{ background: sp.color }} />}
                      <span className="space-name">{sp.name}</span>
                      {sp.is_private && <span className="lock" title="Private">🔒</span>}
                    </button>
                    {full && <Menu title="Space options" icon="+" items={[
                      { label: 'New list', onClick: () => addList(sp.id) },
                      { label: 'New folder', onClick: () => addFolder(sp.id) },
                      { label: 'Space settings', onClick: () => setSettingsFor(sp.id) },
                    ]} />}
                  </div>
                  {isOpen && (
                    <>
                      {folders.filter(f => f.space_id === sp.id).map(f => {
                        const fOpen = open[f.id] ?? true
                        return (
                          <div key={f.id} className="folder">
                            <div className="list-row">
                              <button className="folder-toggle" onClick={() => setOpen(o => ({ ...o, [f.id]: !fOpen }))}>
                                <span className="caret">{fOpen ? '▾' : '▸'}</span> 📁 {f.name}
                              </button>
                              {full && <Menu title="Folder options" items={[
                                { label: 'New list in folder', onClick: () => addList(sp.id, f.id) },
                                { label: 'Rename', onClick: () => renameFolder(f.id, f.name) },
                                { label: 'Delete folder', onClick: () => deleteFolder(f.id, f.name), danger: true },
                              ]} />}
                            </div>
                            {fOpen && <div className="folder-lists">{spaceLists.filter(l => l.folder_id === f.id).map(l => listLink(l, full))}</div>}
                          </div>
                        )
                      })}
                      {spaceLists.filter(l => !l.folder_id).map(l => listLink(l, full))}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </aside>
      {settingsFor && spaces.find(x => x.id === settingsFor) && (
        <SpaceSettings space={spaces.find(x => x.id === settingsFor)!} isAdmin={admin} onClose={() => setSettingsFor(null)} onChanged={refresh} />
      )}
      <main className="main">
        <header className="topbar">
          <form className="top-search" onSubmit={e => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q')?.toString().trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`) }}>
            <input name="q" type="search" placeholder="Search…  (press /)" aria-label="Search" />
          </form>
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
