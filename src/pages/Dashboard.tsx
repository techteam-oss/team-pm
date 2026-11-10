import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { fmtMinutes } from '../lib/time'

type T = { id: string; space_id: string; due_date: string | null; completed_at: string | null; status: { is_done: boolean } | null; task_assignees: { user_id: string }[] }
type E = { user_id: string; space_id: string; started_at: string; ended_at: string | null }

const DAY = 86400000
const localIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }

function Bars({ rows, unit, empty }: { rows: { label: string; value: number; sub?: string }[]; unit: (v: number) => string; empty: string }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  if (!rows.length) return <p className="muted small">{empty}</p>
  return (
    <div className="hbars">
      {rows.map(r => (
        <div key={r.label} className="hbar" title={`${r.label}: ${unit(r.value)}${r.sub ? ` (${r.sub})` : ''}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="hbar-value">{unit(r.value)}{r.sub && <span className="muted"> · {r.sub}</span>}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { spaces, people, workspace } = useWorkspace()
  const [space, setSpace] = useState('')
  const [tasks, setTasks] = useState<T[]>([])
  const [time, setTime] = useState<E[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    if (!workspace) return
    let tq = supabase.from('tasks').select('id, space_id, due_date, completed_at, status:statuses(is_done), task_assignees(user_id)')
      .eq('workspace_id', workspace.id).eq('archived', false).limit(5000)
    let eq = supabase.from('time_entries').select('user_id, space_id, started_at, ended_at').gte('started_at', weekStart().toISOString()).limit(5000)
    if (space) { tq = tq.eq('space_id', space); eq = eq.eq('space_id', space) }
    Promise.all([tq, eq]).then(([a, b]) => {
      setTasks((a.data ?? []) as unknown as T[]); setTime(b.data ?? []); setLoaded(true)
    })
  }, [workspace, space])

  const today = localIso(new Date())
  const stats = useMemo(() => {
    const open = tasks.filter(t => !t.status?.is_done)
    const overdue = open.filter(t => t.due_date && t.due_date < today)
    const weekAgo = Date.now() - 7 * DAY
    const doneWeek = tasks.filter(t => t.completed_at && new Date(t.completed_at).getTime() >= weekAgo)
    const minutes = time.reduce((s, e) => s + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()) / 60000, 0)

    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * DAY); return { iso: localIso(d), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), n: 0 } })
    for (const t of tasks) if (t.completed_at) { const k = localIso(new Date(t.completed_at)); const d = days.find(x => x.iso === k); if (d) d.n++ }

    const name = (id: string) => people.find(p => p.id === id)?.name ?? 'Former member'
    const load = new Map<string, { open: number; overdue: number }>()
    let unassigned = 0
    for (const t of open) {
      if (!t.task_assignees.length) unassigned++
      for (const a of t.task_assignees) {
        const r = load.get(a.user_id) ?? { open: 0, overdue: 0 }
        r.open++; if (t.due_date && t.due_date < today) r.overdue++
        load.set(a.user_id, r)
      }
    }
    const workload = [...load].map(([id, r]) => ({ label: name(id), value: r.open, sub: r.overdue ? `${r.overdue} overdue` : undefined })).sort((a, b) => b.value - a.value)
    const perPerson = new Map<string, number>()
    for (const e of time) perPerson.set(e.user_id, (perPerson.get(e.user_id) ?? 0) + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()) / 60000)
    const hours = [...perPerson].map(([id, m]) => ({ label: name(id), value: m })).sort((a, b) => b.value - a.value)
    return { open: open.length, overdue: overdue.length, doneWeek: doneWeek.length, minutes, days, workload, unassigned, hours }
  }, [tasks, time, people, today])

  const maxDay = Math.max(1, ...stats.days.map(d => d.n))

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Dashboard</h1><div className="muted small">{space ? spaces.find(s => s.id === space)?.name : 'All spaces you can see'}</div></div>
        <select value={space} onChange={e => setSpace(e.target.value)}>
          <option value="">All spaces</option>
          {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="tiles">
        <div className="tile"><div className="tile-label">Open tasks</div><div className="tile-value">{stats.open}</div></div>
        <div className="tile"><div className="tile-label">Overdue</div><div className={`tile-value ${stats.overdue ? 'overdue' : ''}`}>{stats.overdue ? '⚠ ' : ''}{stats.overdue}</div></div>
        <div className="tile"><div className="tile-label">Done in last 7 days</div><div className="tile-value">{stats.doneWeek}</div></div>
        <div className="tile"><div className="tile-label">Time tracked this week</div><div className="tile-value">{fmtMinutes(stats.minutes)}</div></div>
      </div>

      <div className="card chart-card">
        <h3>Tasks completed, last 14 days</h3>
        <div className="cols" onMouseLeave={() => setHover(null)}>
          {stats.days.map((d, i) => (
            <div key={d.iso} className={`col ${hover === i ? 'hot' : ''}`} onMouseEnter={() => setHover(i)} title={`${d.label}: ${d.n} completed`}>
              <div className="col-bar-wrap"><div className="col-bar" style={{ height: `${(d.n / maxDay) * 100}%` }} /></div>
              {(i % 2 === 1 || hover === i) && <div className="col-label">{hover === i ? `${d.n}` : d.label}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="card chart-card">
          <h3>Open tasks per person</h3>
          <Bars rows={stats.workload} unit={v => `${v}`} empty={loaded ? 'No open assigned tasks.' : 'Loading…'} />
          {stats.unassigned > 0 && <p className="muted small">{stats.unassigned} open task{stats.unassigned === 1 ? ' has' : 's have'} no assignee.</p>}
        </div>
        <div className="card chart-card">
          <h3>Time tracked this week</h3>
          <Bars rows={stats.hours} unit={fmtMinutes} empty={loaded ? 'No time logged since Monday.' : 'Loading…'} />
          <p className="muted small">Log time from a task's <b>Start timer</b> button. <Link to="/my">Go to my tasks</Link></p>
        </div>
      </div>
    </div>
  )
}
