import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, FolderKanban, List as ListIcon, Plus, Rocket, Sparkles, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isAdmin, useWorkspace } from '../lib/workspace'
import { fmtDate, isOverdue } from '../lib/listData'
import { SpaceBadge } from '../components/Layout'

type Upcoming = { id: string; number: number; title: string; due_date: string | null; list_id: string; status: { color: string; is_done: boolean } | null }

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { loading, workspace, role, spaces, lists, people, refresh } = useWorkspace()
  const { session } = useAuth()
  const uid = session!.user.id
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<Upcoming[] | null>(null)

  useEffect(() => {
    if (!workspace) return
    supabase.from('tasks')
      .select('id, number, title, due_date, list_id, status:statuses(color, is_done), task_assignees!inner(user_id), list:lists!inner(archived)')
      .eq('task_assignees.user_id', uid).eq('archived', false).eq('list.archived', false)
      .order('due_date', { nullsFirst: false }).limit(200)
      .then(({ data }) => setMine(((data ?? []) as unknown as Upcoming[]).filter(t => !t.status?.is_done)))
  }, [workspace, uid])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase.rpc('create_workspace', { ws_name: name.trim() })
    if (error) setError(error.message); else refresh()
  }

  if (loading) return <p className="muted">Loading…</p>

  if (!workspace) return (
    <form className="card" onSubmit={create} style={{ maxWidth: 520, margin: '8vh auto 0' }}>
      <div className="empty-state" style={{ padding: '8px 0 16px' }}>
        <span className="ic"><Rocket size={20} aria-hidden /></span>
        <h3>Create your workspace</h3>
        <p>You'll be its owner. Most teams use one workspace for everyone.</p>
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input style={{ flex: 1 }} aria-label="Workspace name" placeholder="e.g. Impact Network" required maxLength={80} value={name} onChange={e => setName(e.target.value)} />
        <button className="primary">Create</button>
      </div>
      {error && <div className="error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
    </form>
  )

  const me = people.find(p => p.id === uid)
  const first = (me?.name ?? session!.user.email ?? '').split(/[\s@]/)[0]
  const today = localIso(new Date())
  const overdue = (mine ?? []).filter(t => isOverdue(t.due_date)).length
  const dueToday = (mine ?? []).filter(t => t.due_date === today).length
  const upcoming = (mine ?? []).slice(0, 8)
  const admin = isAdmin(role)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="hero">
        <div className="page-title">
          <p className="muted small">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
        </div>
        <Link to="/my" className="btn-a">Open My tasks</Link>
      </div>

      <div className="stat-row">
        <div className="tile"><div className="tile-label"><CircleDot size={13} aria-hidden /> Open tasks assigned to you</div><div className="tile-value">{mine?.length ?? '–'}</div></div>
        <div className="tile"><div className="tile-label"><CalendarClock size={13} aria-hidden /> Due today</div><div className="tile-value">{mine ? dueToday : '–'}</div></div>
        <div className="tile"><div className="tile-label"><AlertTriangle size={13} aria-hidden /> Overdue</div><div className={`tile-value ${overdue ? 'overdue' : ''}`}>{mine ? overdue : '–'}</div></div>
      </div>

      <div className="home-grid">
        <section className="card home-card">
          <header><h2><CheckCircle2 size={16} aria-hidden />My work</h2><Link to="/my" className="small">See all</Link></header>
          {mine === null ? <div className="home-empty">Loading…</div> : upcoming.length === 0 ? (
            <div className="home-empty">Nothing assigned to you right now.</div>
          ) : (
            <ul className="home-list">
              {upcoming.map(t => (
                <li key={t.id}>
                  <Link to={`/list/${t.list_id}?task=${t.id}`}>
                    <span className="status-dot" style={{ color: t.status?.color ?? 'var(--faint)' }} aria-hidden />
                    <span className="grow">{t.title}</span>
                    {t.due_date && <span className={`meta ${isOverdue(t.due_date) ? 'overdue' : ''}`}>{fmtDate(t.due_date)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card home-card">
          <header><h2><FolderKanban size={16} aria-hidden />Spaces</h2>{admin && <span className="muted small">{spaces.length} total</span>}</header>
          {spaces.length === 0 ? (
            <div className="home-empty">{admin ? <>Create your first space with the <Plus size={12} aria-label="plus" /> next to “Spaces” in the sidebar.</> : 'No spaces have been shared with you yet.'}</div>
          ) : (
            <ul className="home-list">
              {spaces.map(sp => {
                const sl = lists.filter(l => l.space_id === sp.id)
                return (
                  <li key={sp.id}>
                    {sl[0] ? (
                      <Link to={`/list/${sl[0].id}`}><SpaceBadge space={sp} /><span className="grow">{sp.name}</span><span className="meta"><ListIcon size={12} aria-hidden />{sl.length}</span></Link>
                    ) : (
                      <div className="li"><SpaceBadge space={sp} /><span className="grow">{sp.name}</span><span className="meta">No lists yet</span></div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {admin && (
          <section className="card home-card">
            <header><h2><Sparkles size={16} aria-hidden />Get your team going</h2></header>
            <ul className="home-list">
              <li><div className="li"><span className="step-n">1</span><span className="grow wrap">Create a space for each team or department</span>{spaces.length > 0 && <CheckCircle2 size={15} className="notice" aria-label="done" />}</div></li>
              <li><div className="li"><span className="step-n">2</span><span className="grow wrap">Add lists inside it for projects</span>{lists.length > 0 && <CheckCircle2 size={15} className="notice" aria-label="done" />}</div></li>
              <li><Link to="/members"><span className="step-n">3</span><span className="grow wrap">Invite people and choose their access</span><Users size={15} aria-hidden /></Link></li>
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
