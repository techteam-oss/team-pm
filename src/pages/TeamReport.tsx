import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, ChevronRight, Clock, Download, ListChecks, Timer, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import { fmtMinutes, useNow } from '../lib/time'
import Avatar from '../components/Avatar'

type Entry = {
  id: string; user_id: string; task_id: string; started_at: string; ended_at: string | null; note: string | null
  task: { number: number; title: string; list_id: string; time_estimate_minutes: number | null; status: { name: string; color: string; is_done: boolean } | null } | null
}
type Done = { id: string; number: number; title: string; list_id: string; completed_at: string; task_assignees: { user_id: string }[] }
type Range = 'today' | 'yesterday' | 'week' | 'day'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function bounds(r: Range, day: string): [Date, Date, string] {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  if (r === 'yesterday') start.setDate(start.getDate() - 1)
  if (r === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (r === 'day') { const [y, m, d] = day.split('-').map(Number); start.setFullYear(y, m - 1, d) }
  const end = new Date(start); end.setDate(end.getDate() + (r === 'week' ? 7 : 1))
  const label = r === 'week' ? `Week of ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return [start, end, label]
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Admin report: who worked on what, and for how long, in a day or week. */
export default function TeamReport() {
  const { role, spaces, people, lists } = useWorkspace()
  const [range, setRange] = useState<Range>('today')
  const [day, setDay] = useState(iso(new Date()))
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [done, setDone] = useState<Done[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [start, end, label] = bounds(range, day)
  const now = useNow(true)

  useEffect(() => {
    if (!spaces.length) { setEntries([]); return }
    setEntries(null)
    const ids = spaces.map(s => s.id)
    Promise.all([
      supabase.from('time_entries')
        .select('id, user_id, task_id, started_at, ended_at, note, task:tasks(number, title, list_id, time_estimate_minutes, status:statuses(name, color, is_done))')
        .in('space_id', ids).lt('started_at', end.toISOString())
        .or(`ended_at.is.null,ended_at.gt.${start.toISOString()}`).order('started_at').limit(5000),
      supabase.from('tasks').select('id, number, title, list_id, completed_at, task_assignees(user_id)')
        .in('space_id', ids).gte('completed_at', start.toISOString()).lt('completed_at', end.toISOString()).limit(1000),
    ]).then(async ([e, d]) => {
      const rows = (e.data ?? []) as unknown as Entry[]
      setEntries(rows); setDone((d.data ?? []) as unknown as Done[])
      // all-time spent per task, to compare against the estimate
      const taskIds = [...new Set(rows.map(r => r.task_id))]
      if (!taskIds.length) { setTotals({}); return }
      const { data: all } = await supabase.from('time_entries').select('task_id, started_at, ended_at').in('task_id', taskIds).limit(20000)
      const t: Record<string, number> = {}
      for (const r of all ?? []) t[r.task_id] = (t[r.task_id] ?? 0) + ((r.ended_at ? new Date(r.ended_at).getTime() : Date.now()) - new Date(r.started_at).getTime()) / 60000
      setTotals(t)
    })
  }, [range, day, spaces]) // eslint-disable-line react-hooks/exhaustive-deps

  const report = useMemo(() => {
    const s = start.getTime(), e = end.getTime()
    const byUser = new Map<string, { minutes: number; running: boolean; tasks: Map<string, { minutes: number; entries: Entry[] }> }>()
    for (const r of entries ?? []) {
      const a = Math.max(s, new Date(r.started_at).getTime())
      const b = Math.min(e, r.ended_at ? new Date(r.ended_at).getTime() : now)
      const min = Math.max(0, (b - a) / 60000)
      const u = byUser.get(r.user_id) ?? { minutes: 0, running: false, tasks: new Map() }
      u.minutes += min; if (!r.ended_at) u.running = true
      const t = u.tasks.get(r.task_id) ?? { minutes: 0, entries: [] }
      t.minutes += min; t.entries.push(r); u.tasks.set(r.task_id, t)
      byUser.set(r.user_id, u)
    }
    return byUser
  }, [entries, now]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin(role)) return <p className="muted">Only admins can see the team report.</p>

  const name = (id: string) => people.find(p => p.id === id)?.name ?? 'Former member'
  const listName = (id: string) => lists.find(l => l.id === id)?.name ?? ''
  const teamMinutes = [...report.values()].reduce((a, u) => a + u.minutes, 0)
  const idle = people.filter(p => !report.has(p.id))
  const overTasks = new Set<string>()
  for (const u of report.values()) for (const [tid, t] of u.tasks) {
    const est = t.entries[0].task?.time_estimate_minutes
    if (est && (totals[tid] ?? 0) > est) overTasks.add(tid)
  }
  const ordered = [...report.entries()].sort((a, b) => b[1].minutes - a[1].minutes)

  function exportCsv() {
    const rows = [['Person', 'Task #', 'Task', 'List', 'Started', 'Ended', 'Minutes in range', 'Note']]
    for (const [uid, u] of ordered) for (const t of u.tasks.values()) for (const r of t.entries) {
      const a = Math.max(start.getTime(), new Date(r.started_at).getTime())
      const b = Math.min(end.getTime(), r.ended_at ? new Date(r.ended_at).getTime() : Date.now())
      rows.push([name(uid), String(r.task?.number ?? ''), r.task?.title ?? '', listName(r.task?.list_id ?? ''), new Date(r.started_at).toLocaleString(),
        r.ended_at ? new Date(r.ended_at).toLocaleString() : 'running', String(Math.round((b - a) / 60000)), r.note ?? ''])
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `team-report-${iso(start)}${range === 'week' ? '-week' : ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div className="page-title"><h1>Team report</h1><p className="muted small">{label}. Time each person tracked, and on which tasks.</p></div>
        <div className="row">
          <div className="segmented">
            {(['today', 'yesterday', 'week'] as Range[]).map(r => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 'week' ? 'This week' : r[0].toUpperCase() + r.slice(1)}</button>)}
          </div>
          <input type="date" aria-label="Pick a day" value={range === 'day' ? day : ''} max={iso(new Date())} onChange={e => { if (e.target.value) { setDay(e.target.value); setRange('day') } }} />
          <button className="btn ghost" onClick={exportCsv} disabled={!ordered.length}><Download size={15} aria-hidden />CSV</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="tile"><div className="tile-label"><Clock size={13} aria-hidden />Team time</div><div className="tile-value">{fmtMinutes(Math.round(teamMinutes))}</div></div>
        <div className="tile"><div className="tile-label"><Users size={13} aria-hidden />People who tracked time</div><div className="tile-value">{report.size}<span className="muted" style={{ fontSize: 16 }}> / {people.length}</span></div></div>
        <div className="tile"><div className="tile-label"><ListChecks size={13} aria-hidden />Tasks completed</div><div className="tile-value">{done.length}</div></div>
        <div className="tile"><div className="tile-label"><AlarmClock size={13} aria-hidden />Over estimate</div><div className={`tile-value ${overTasks.size ? 'overdue' : ''}`}>{overTasks.size}</div></div>
      </div>

      {entries === null ? <p className="muted">Loading…</p> : ordered.length === 0 ? (
        <div className="card"><div className="empty-state"><span className="ic"><Timer size={20} aria-hidden /></span><h3>No time tracked</h3><p>Nobody started a timer or logged time for this period.</p></div></div>
      ) : (
        <div className="stack">
          {ordered.map(([uid, u]) => {
            const isOpen = open[uid] ?? ordered.length <= 4
            const finished = done.filter(d => d.task_assignees.some(a => a.user_id === uid)).length
            const tasks = [...u.tasks.entries()].sort((a, b) => b[1].minutes - a[1].minutes)
            return (
              <section key={uid} className="card report-person">
                <button className="report-head" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [uid]: !isOpen }))}>
                  <ChevronRight size={15} className={`chev ${isOpen ? 'open' : ''}`} aria-hidden />
                  <Avatar id={uid} name={name(uid)} size={32} />
                  <span className="grow"><b>{name(uid)}</b>
                    <span className="muted small"> {tasks.length} task{tasks.length === 1 ? '' : 's'}{finished ? ` · ${finished} completed` : ''}</span></span>
                  {u.running && <span className="pill live"><Timer size={12} aria-hidden />Timer running</span>}
                  <span className="report-total">{fmtMinutes(Math.round(u.minutes))}</span>
                </button>
                {isOpen && (
                  <table className="grid report-table">
                    <thead><tr><th>Task</th><th>Sessions</th><th className="num">Time in period</th><th className="num">Total / estimate</th></tr></thead>
                    <tbody>
                      {tasks.map(([tid, t]) => {
                        const task = t.entries[0].task
                        const est = task?.time_estimate_minutes
                        const total = totals[tid] ?? t.minutes
                        return (
                          <tr key={tid}>
                            <td>
                              <span className="status-dot" style={{ color: task?.status?.color ?? 'var(--faint)' }} aria-hidden />
                              {task ? <Link to={`/list/${task.list_id}?task=${tid}`}>{task.title}</Link> : 'Deleted task'}
                              <div className="muted small">#{task?.number} · {listName(task?.list_id ?? '')}{task?.status ? ` · ${task.status.name}` : ''}</div>
                            </td>
                            <td className="small">{t.entries.map(r => `${clock(r.started_at)}–${r.ended_at ? clock(r.ended_at) : 'now'}`).join(', ')}
                              {t.entries.some(r => r.note) && <div className="muted small">{t.entries.filter(r => r.note).map(r => r.note).join(' · ')}</div>}</td>
                            <td className="num"><b>{fmtMinutes(Math.round(t.minutes))}</b></td>
                            <td className={`num ${est && total > est ? 'overdue' : 'muted'}`}>{fmtMinutes(Math.round(total))}{est ? ` / ${fmtMinutes(est)}` : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            )
          })}
        </div>
      )}

      {entries !== null && idle.length > 0 && (
        <div className="card">
          <h2 className="small muted" style={{ margin: '0 0 10px' }}>No time tracked in this period</h2>
          <div className="row">{idle.map(p => <span key={p.id} className="chip"><Avatar id={p.id} name={p.name} size={20} />{p.name}</span>)}</div>
        </div>
      )}
    </div>
  )
}
