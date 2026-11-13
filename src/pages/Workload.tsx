import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Gauge } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import { fmtMinutes } from '../lib/time'
import { fmtDate } from '../lib/listData'
import Avatar from '../components/Avatar'

type T = {
  id: string; number: number; title: string; list_id: string; due_date: string | null; time_estimate_minutes: number | null
  priority: string; qa_state: string | null; reviewer_id: string | null
  status: { name: string; color: string; is_done: boolean } | null; task_assignees: { user_id: string }[]
}
type E = { user_id: string; started_at: string; ended_at: string | null }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const HOURS_PER_WEEK = 40

/** Admin view: who has how much this week, from due dates and estimates, before deadlines slip. */
export default function Workload() {
  const { role, spaces, people, lists } = useWorkspace()
  const [weekOffset, setWeekOffset] = useState(0)
  const [tasks, setTasks] = useState<T[] | null>(null)
  const [entries, setEntries] = useState<E[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const [start, end] = useMemo(() => {
    const s = new Date(); s.setHours(0, 0, 0, 0)
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + weekOffset * 7)
    const e = new Date(s); e.setDate(e.getDate() + 7)
    return [s, e]
  }, [weekOffset])
  const today = iso(new Date()), weekStart = iso(start), weekEnd = iso(new Date(end.getTime() - 86400000))

  useEffect(() => {
    if (!spaces.length) { setTasks([]); return }
    setTasks(null)
    const ids = spaces.map(s => s.id)
    Promise.all([
      supabase.from('tasks')
        .select('id, number, title, list_id, due_date, time_estimate_minutes, priority, qa_state, reviewer_id, status:statuses(name, color, is_done), task_assignees(user_id), list:lists!inner(archived)')
        .in('space_id', ids).eq('archived', false).eq('list.archived', false).limit(5000),
      supabase.from('time_entries').select('user_id, started_at, ended_at')
        .in('space_id', ids).gte('started_at', start.toISOString()).lt('started_at', end.toISOString()).limit(20000),
    ]).then(([t, e]) => { setTasks(((t.data ?? []) as unknown as T[]).filter(x => !x.status?.is_done)); setEntries(e.data ?? []) })
  }, [spaces, start, end])

  const rows = useMemo(() => people.filter(p => p.role !== 'guest').map(p => {
    const mine = (tasks ?? []).filter(t => t.task_assignees.some(a => a.user_id === p.id))
    const thisWeek = mine.filter(t => t.due_date && t.due_date >= weekStart && t.due_date <= weekEnd)
    const overdue = mine.filter(t => t.due_date && t.due_date < today)
    // Estimated work due this week (and anything overdue still open when looking at this week).
    const load = [...thisWeek, ...(weekOffset === 0 ? overdue : [])]
      .reduce((s, t) => s + (t.time_estimate_minutes ?? 0) / Math.max(1, t.task_assignees.length), 0)
    const noEstimate = thisWeek.filter(t => !t.time_estimate_minutes).length
    const logged = entries.filter(e => e.user_id === p.id)
      .reduce((s, e) => s + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()) / 60000, 0)
    const review = (tasks ?? []).filter(t => t.reviewer_id === p.id && t.qa_state === 'pending').length
    return { p, mine, thisWeek, overdue, load, noEstimate, logged, review }
  }).sort((a, b) => b.load - a.load || b.mine.length - a.mine.length), [people, tasks, entries, weekStart, weekEnd, today, weekOffset])

  if (!isAdmin(role)) return <p className="muted">Only admins can see the workload.</p>
  const where = (lid: string) => lists.find(l => l.id === lid)?.name ?? ''
  const cap = HOURS_PER_WEEK * 60

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1 className="row" style={{ gap: 8 }}><Gauge size={22} aria-hidden />Workload</h1>
          <div className="muted small">Open work per person for the week of {start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, from due dates and estimates. A full week is {HOURS_PER_WEEK} hours.</div>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => setWeekOffset(w => w - 1)}>Previous week</button>
          <button className="btn small" disabled={weekOffset === 0} onClick={() => setWeekOffset(0)}>This week</button>
          <button className="btn small" onClick={() => setWeekOffset(w => w + 1)}>Next week</button>
        </div>
      </div>

      {tasks === null ? <p className="muted">Loading…</p> : (
        <div className="card workload">
          <table className="tasks">
            <thead><tr><th>Person</th><th>Planned this week</th><th className="num">Due this week</th><th className="num">Overdue</th><th className="num">Open</th><th className="num">To review</th><th className="num">Tracked</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const pct = (r.load / cap) * 100
                const tone = pct > 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok'
                const isOpen = !!open[r.p.id]
                return [
                  <tr key={r.p.id} className="task-row" onClick={() => setOpen(o => ({ ...o, [r.p.id]: !isOpen }))}>
                    <td><div className="title-cell"><ChevronRight size={14} className={`chev ${isOpen ? 'open' : ''}`} aria-hidden /><Avatar id={r.p.id} name={r.p.name} size={24} /><span className="t">{r.p.name}</span></div></td>
                    <td style={{ minWidth: 200 }}>
                      <div className="meter">
                        <div className={`meter-bar ${tone}`} role="progressbar" aria-label={`${r.p.name} planned hours`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
                        <span className={`small ${tone === 'ok' ? 'muted' : tone}`}>{fmtMinutes(r.load)} of {HOURS_PER_WEEK}h{pct > 100 && <> · <AlertTriangle size={12} aria-hidden /> over capacity</>}{r.noEstimate > 0 && <span className="muted"> · {r.noEstimate} without estimate</span>}</span>
                      </div>
                    </td>
                    <td className="num">{r.thisWeek.length}</td>
                    <td className={`num ${r.overdue.length ? 'overdue' : ''}`}>{r.overdue.length}</td>
                    <td className="num">{r.mine.length}</td>
                    <td className="num">{r.review}</td>
                    <td className="num">{fmtMinutes(r.logged)}</td>
                  </tr>,
                  isOpen && (
                    <tr key={r.p.id + '-x'} className="workload-detail"><td colSpan={7}>
                      {r.mine.length === 0 ? <span className="muted small">No open tasks.</span> : (
                        <ul className="plain-list">
                          {[...r.mine].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).map(t => (
                            <li key={t.id} className="row" style={{ gap: 8 }}>
                              <span className="status-dot" style={{ color: t.status?.color ?? 'var(--faint)' }} aria-hidden />
                              <Link to={`/list/${t.list_id}?task=${t.id}`}>#{t.number} {t.title}</Link>
                              <span className="muted small">{where(t.list_id)}</span>
                              {t.due_date && <span className={`small ${t.due_date < today ? 'overdue' : 'muted'}`}>{fmtDate(t.due_date)}</span>}
                              {t.time_estimate_minutes ? <span className="muted small">{fmtMinutes(t.time_estimate_minutes)}</span> : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td></tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
