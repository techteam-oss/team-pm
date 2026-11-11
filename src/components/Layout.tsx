import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Archive, ChevronRight, CircleUserRound, FolderClosed, FolderPlus, Home, LayoutDashboard, List as ListIcon, ListPlus,
  Lock, LogOut, Menu as MenuIcon, Monitor, Moon, Pencil, Plus, Search, Settings, Square, Sun, Timer, Trash2, Users,
  CheckSquare, FolderInput,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace } from '../lib/workspace'
import Menu from './Menu'
import Avatar from './Avatar'
import SpaceSettings from './SpaceSettings'
import { DialogHost, askChoice, askConfirm, askText, notify } from './Dialogs'
import type { List, Space } from '../lib/workspace'
import { fmtClock, useNow, useTimer } from '../lib/time'
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme'

export function SpaceBadge({ space, size = 20 }: { space: Pick<Space, 'name' | 'color' | 'icon'>; size?: number }) {
  if (space.icon) return <span className="space-badge emoji" style={{ width: size, height: size }} aria-hidden>{space.icon}</span>
  return <span className="space-badge" style={{ background: space.color, width: size, height: size }} aria-hidden>{space.name.trim()[0]?.toUpperCase() ?? '?'}</span>
}

export default function Layout({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const { workspace, role, spaces, lists, folders, people, level, refresh } = useWorkspace()
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [drawer, setDrawer] = useState(false)
  const [theme, setTheme] = useState<Theme>(getStoredTheme())
  const admin = isAdmin(role)
  const { running, stop } = useTimer()
  const navigate = useNavigate()
  const location = useLocation()
  const me = people.find(p => p.id === session!.user.id)
  const myName = me?.name ?? session!.user.email ?? '?'

  useEffect(() => { setDrawer(false) }, [location.pathname])
  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail)
    window.addEventListener('team-pm-theme', on)
    return () => window.removeEventListener('team-pm-theme', on)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const k = e.key === '/' && !e.metaKey && !e.ctrlKey
      const cmdK = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)
      if (!(k || cmdK) || (k && el.closest('input, textarea, select, [contenteditable]'))) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('.top-search input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const now = useNow(!!running)

  async function changeTheme(t: Theme) {
    applyTheme(t)
    await supabase.from('profiles').update({ theme: t }).eq('id', session!.user.id)
  }

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    if (error) notify(error.message); else refresh()
    return !error
  }
  async function addSpace() {
    if (!workspace) return
    const r = await askText({ title: 'Create a space', label: 'Space name', placeholder: 'e.g. Marketing', confirmLabel: 'Create space',
      toggle: { label: 'Private', hint: 'Only people you add can see it.' } })
    if (r) run(supabase.from('spaces').insert({ workspace_id: workspace.id, name: r.value, is_private: r.toggled }))
  }
  async function addList(spaceId: string, folderId: string | null = null) {
    const r = await askText({ title: 'Create a list', label: 'List name', placeholder: 'e.g. Website launch', confirmLabel: 'Create list' })
    if (r && await run(supabase.from('lists').insert({ space_id: spaceId, folder_id: folderId, name: r.value }))) {
      setOpen(o => ({ ...o, [spaceId]: true, ...(folderId ? { [folderId]: true } : {}) }))
    }
  }
  async function addFolder(spaceId: string) {
    const r = await askText({ title: 'Create a folder', label: 'Folder name', confirmLabel: 'Create folder' })
    if (r && await run(supabase.from('folders').insert({ space_id: spaceId, name: r.value }))) setOpen(o => ({ ...o, [spaceId]: true }))
  }
  async function renameList(l: List) {
    const r = await askText({ title: 'Rename list', label: 'List name', initial: l.name })
    if (r && r.value !== l.name) run(supabase.from('lists').update({ name: r.value }).eq('id', l.id))
  }
  async function moveList(l: List) {
    const options = folders.filter(f => f.space_id === l.space_id)
    if (!options.length) { notify('This space has no folders yet. Create one from the space menu.'); return }
    const pick = await askChoice({ title: `Move "${l.name}"`, confirmLabel: 'Move', initial: l.folder_id ?? '',
      options: [{ value: '', label: 'No folder' }, ...options.map(f => ({ value: f.id, label: f.name }))] })
    if (pick !== null && pick !== (l.folder_id ?? '')) run(supabase.from('lists').update({ folder_id: pick || null }).eq('id', l.id))
  }
  async function archiveList(l: List) {
    if (await askConfirm({ title: `Archive "${l.name}"?`, body: 'It disappears from the sidebar. Its tasks are kept and you can restore it from Archive.', confirmLabel: 'Archive list' }))
      run(supabase.from('lists').update({ archived: true }).eq('id', l.id))
  }
  async function deleteFolder(id: string, name: string) {
    if (!await askConfirm({ title: `Delete the folder "${name}"?`, body: 'Its lists move up into the space. Nothing is lost.', confirmLabel: 'Delete folder', danger: true })) return
    const moved = await supabase.from('lists').update({ folder_id: null }).eq('folder_id', id)
    if (moved.error) { notify(moved.error.message); return }
    run(supabase.from('folders').delete().eq('id', id))
  }
  async function renameFolder(id: string, current: string) {
    const r = await askText({ title: 'Rename folder', label: 'Folder name', initial: current })
    if (r && r.value !== current) run(supabase.from('folders').update({ name: r.value }).eq('id', id))
  }

  const listLink = (l: List, full: boolean) => (
    <div key={l.id} className="tree-row">
      <NavLink to={`/list/${l.id}`} className="list-link"><ListIcon size={15} aria-hidden /><span>{l.name}</span></NavLink>
      {full && <div className="row-actions"><Menu title="List options" items={[
        { label: 'Rename', icon: <Pencil size={14} />, onClick: () => renameList(l) },
        { label: 'Move to folder', icon: <FolderInput size={14} />, onClick: () => moveList(l) },
        'sep',
        { label: 'Archive list', icon: <Archive size={14} />, onClick: () => archiveList(l), danger: true },
      ]} /></div>}
    </div>
  )

  return (
    <div className="shell">
      {drawer && <div className="sidebar-scrim" onClick={() => setDrawer(false)} />}
      <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Workspace navigation">
        <div className="ws-switch">
          <span className="ws-logo" aria-hidden>{(workspace?.name ?? 'T')[0].toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="ws-name">{workspace?.name ?? 'Team PM'}</div>
            {role && <div className="ws-sub">{role}</div>}
          </div>
        </div>
        <div className="sidebar-scroll">
          <nav className="nav">
            <NavLink to="/" end className="nav-item"><Home size={17} aria-hidden />Home</NavLink>
            <NavLink to="/my" className="nav-item"><CheckSquare size={17} aria-hidden />My tasks</NavLink>
            <NavLink to="/dashboard" className="nav-item"><LayoutDashboard size={17} aria-hidden />Dashboard</NavLink>
            <NavLink to="/archive" className="nav-item"><Archive size={17} aria-hidden />Archive</NavLink>
            {admin && <NavLink to="/members" className="nav-item"><Users size={17} aria-hidden />Members</NavLink>}
          </nav>
          {workspace && (
            <div className="spaces">
              <div className="section-head">
                <span>Spaces</span>
                {admin && <button className="icon-btn" title="New space" aria-label="New space" onClick={addSpace}><Plus size={15} /></button>}
              </div>
              {spaces.length === 0 && <div className="nav-soon">{admin ? 'Create your first space with +' : 'No spaces shared with you yet'}</div>}
              {spaces.map(sp => {
                const isOpen = open[sp.id] ?? true
                const full = level(sp.id) >= 4
                const spaceLists = lists.filter(l => l.space_id === sp.id)
                return (
                  <div key={sp.id} className="space">
                    <div className="tree-row">
                      <button className="tree-toggle" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [sp.id]: !isOpen }))}>
                        <ChevronRight size={14} className={`chev ${isOpen ? 'open' : ''}`} aria-hidden />
                        <SpaceBadge space={sp} />
                        <span className="space-name">{sp.name}</span>
                        {sp.is_private && <Lock size={12} className="lock" aria-label="Private" />}
                      </button>
                      {full && <div className="row-actions">
                        <Menu title="Space options" items={[
                          { label: 'Space settings', icon: <Settings size={14} />, onClick: () => setSettingsFor(sp.id) },
                        ]} />
                        <Menu title="Add to space" icon={<Plus size={15} />} items={[
                          { label: 'New list', icon: <ListPlus size={14} />, onClick: () => addList(sp.id) },
                          { label: 'New folder', icon: <FolderPlus size={14} />, onClick: () => addFolder(sp.id) },
                        ]} />
                      </div>}
                    </div>
                    {isOpen && (
                      <>
                        {folders.filter(f => f.space_id === sp.id).map(f => {
                          const fOpen = open[f.id] ?? true
                          return (
                            <div key={f.id} className="folder">
                              <div className="tree-row">
                                <button className="tree-toggle folder-toggle" aria-expanded={fOpen} onClick={() => setOpen(o => ({ ...o, [f.id]: !fOpen }))}>
                                  <ChevronRight size={13} className={`chev ${fOpen ? 'open' : ''}`} aria-hidden />
                                  <FolderClosed size={15} className="folder-ic" aria-hidden />
                                  <span className="space-name">{f.name}</span>
                                </button>
                                {full && <div className="row-actions"><Menu title="Folder options" items={[
                                  { label: 'New list in folder', icon: <ListPlus size={14} />, onClick: () => addList(sp.id, f.id) },
                                  { label: 'Rename', icon: <Pencil size={14} />, onClick: () => renameFolder(f.id, f.name) },
                                  'sep',
                                  { label: 'Delete folder', icon: <Trash2 size={14} />, onClick: () => deleteFolder(f.id, f.name), danger: true },
                                ]} /></div>}
                              </div>
                              {fOpen && <div className="folder-lists">{spaceLists.filter(l => l.folder_id === f.id).map(l => listLink(l, full))}</div>}
                            </div>
                          )
                        })}
                        {spaceLists.filter(l => !l.folder_id).map(l => listLink(l, full))}
                        {full && spaceLists.length === 0 && (
                          <button className="list-link btn ghost" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--muted)', border: 0 }} onClick={() => addList(sp.id)}>
                            <Plus size={14} aria-hidden /><span>New list</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
      {settingsFor && spaces.find(x => x.id === settingsFor) && (
        <SpaceSettings space={spaces.find(x => x.id === settingsFor)!} isAdmin={admin} onClose={() => setSettingsFor(null)} onChanged={refresh} />
      )}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-burger" aria-label="Open navigation" onClick={() => setDrawer(true)}><MenuIcon size={18} /></button>
          <form className="top-search" role="search" onSubmit={e => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q')?.toString().trim(); if (q) navigate(`/search?q=${encodeURIComponent(q)}`) }}>
            <Search size={15} aria-hidden />
            <input name="q" type="search" placeholder="Search tasks and comments" aria-label="Search" />
            <kbd>/</kbd>
          </form>
          <div className="top-right">
            {running && (
              <span className="timer-chip">
                <Link to={`/list/${running.task?.list_id}?task=${running.task_id}`} title={running.task?.title}>
                  <Timer size={14} aria-hidden /> <b>{fmtClock(now - new Date(running.started_at).getTime())}</b> <span className="timer-title">{running.task?.title}</span>
                </Link>
                <button className="icon-btn" title="Stop timer" aria-label="Stop timer" onClick={stop}><Square size={12} fill="currentColor" /></button>
              </span>
            )}
            <Menu title="Your account" className="me-btn" icon={<Avatar name={myName} id={session!.user.id} size={30} />}
              head={<div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={myName} id={session!.user.id} size={32} />
                <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{myName}</div><div className="muted small">{session!.user.email}</div></div></div>}
              items={[
                'sep',
                { label: 'Profile', icon: <CircleUserRound size={14} />, onClick: () => navigate('/profile') },
                'sep',
                { label: `Light${theme === 'light' ? ' ✓' : ''}`, icon: <Sun size={14} />, onClick: () => changeTheme('light') },
                { label: `Dark${theme === 'dark' ? ' ✓' : ''}`, icon: <Moon size={14} />, onClick: () => changeTheme('dark') },
                { label: `System${theme === 'system' ? ' ✓' : ''}`, icon: <Monitor size={14} />, onClick: () => changeTheme('system') },
                'sep',
                { label: 'Sign out', icon: <LogOut size={14} />, onClick: () => supabase.auth.signOut(), danger: true },
              ]} />
          </div>
        </header>
        <section className="content" id="main-content">{children}</section>
      </main>
      <DialogHost />
    </div>
  )
}
