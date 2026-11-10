import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/workspace'
import { fmtDate, isOverdue, type Status } from '../lib/listData'
import TaskPanel from '../components/TaskPanel'

type MyTask = {
  id: string; number: number; title: string; priority: string; due_date: string | null
  list_id: string; space_id: string; status: { name: string; color: string; is_done: boolean } | null
}
type MyComment = { id: string; body: string; task_id: string; space_id: string; created_at: string; task: { title: string; number: number; list_id: string } | null }

const BUCKETS = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No due date'] as const
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

function bucket(d: string | null): (typeof BUCKETS)[number] {
  if (!d) return 'No due date'
  const today = new Date(); const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const t = iso(today); const week = iso(new Date(today.getTime() + 7 * 86400000))
  if (d < t) return 'Overdue'
  if (d === t) return 'Today'
  if (d <= week) return 'Next 7 days'
  return 'Later'
}

export default function MyTasks() {
  const { session } = useAuth()
  const uid = session!.user.id
  const { lists, spaces } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<MyTask[]>([])
  const [comments, setComments] = useState<MyComment[]>([])
  const [showDone, setShowDone] = useState(false)
  const [statuses, setStatuses] = useState<Status[]>([])
  const [loaded, setLoaded] = useState(false)
  const openTask = params.get('task')

  const load = useCallback(async () => {
    const [{ data: tk }, { data: cm }] = await Promise.all([
      supabase.from('tasks')
        .select('id, number, title, priority, due_date, list_id, space_id, status:statuses(name, color, is_done), task_assignees!inner(user_id)')
        .eq('task_assignees.user_id', uid).eq('archived', false).order('due_date', { nullsFirst: false }).limit(500),
      supabase.from('comments')
        .select('id, body, task_id, space_id, created_at, task:tasks(title, number, list_id)')
        .eq('assigned_to', uid).eq('resolved', false).order('created_at', { ascending: false }).limit(100),
    ])
    setTasks((tk ?? []) as unknown as MyTask[])
    setComments((cm ?? []) as unknown as MyComment[])
    setLoaded(true)
  }, [uid])

  useEffect(() => {
    load()
    const ch = supabase.channel(`my-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees', filter: `user_id=eq.${uid}` }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, load])

  const open = tasks.find(t => t.id === openTask)
  const openSpace = open?.space_id ?? comments.find(c => c.task_id === openTask)?.space_id
  const openList = open?.list_id ?? comments.find(c => c.task_id === openTask)?.task?.list_id
  useEffect(() => {
    if (!openList) { setStatuses([]); return }
    supabase.from('statuses').select('id, name, color, position, is_done').eq('list_id', openList).order('position')
      .then(({ data }) => setStatuses(data ?? []))
  }, [openList])

  const grouped = useMemo(() => {
    const visible = tasks.filter(t => showDone || !t.status?.is_done)
    const g = new Map<string, MyTask[]>(BUCKETS.map(b => [b, []]))
    for (const t of visible) g.get(bucket(t.due_date))!.push(t)
    for (const rows of g.values()) rows.sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || PRIO_RANK[a.priority] - PRIO_RANK[b.priority])
    return g
  }, [tasks, showDone])

  const setTask = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id); else next.delete('task')
    setParams(next)
  }
  const where = (t: { list_id: string }) => {
    const l = lists.find(x => x.id === t.list_id)
    const s = spaces.find(x => x.id === l?.space_id)
    return l ? `${s?.name ?? ''} / ${l.name}` : ''
  }
  const openCount = tasks.filter(t => !t.status?.is_done).length

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>My tasks</h1>
          <div className="muted small">{openCount} open task{openCount === 1 ? '' : 's'} assigned to you</div>
        </div>
        <label className="row small"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show done</label>
      </div>

      {comments.length > 0 && (
        <div className="group">
          <div className="group-head"><b>Comments assigned to you</b><span className="muted small">{comments.length}</span></div>
          <table className="grid tasks"><tbody>
            {comments.map(c => (
              <tr key={c.id} className="task-row" onClick={() => setTask(c.task_id)}>
                <td className="muted small num">#{c.task?.number}</td>
                <td className="title">{c.body.length > 120 ? c.body.slice(0, 120) + '…' : c.body}<div className="muted small">on {c.task?.title}</div></td>
                <td className="muted small">{c.task ? where(c.task) : ''}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {loaded && openCount === 0 && comments.length === 0 && !showDone && (
        <div className="card"><p className="muted">Nothing assigned to you right now. 🎉</p></div>
      )}

      {BUCKETS.map(b => {
        const rows = grouped.get(b)!
        if (!rows.length) return null
        return (
          <div key={b} className="group">
            <div className="group-head"><b className={b === 'Overdue' ? 'overdue' : ''}>{b}</b><span className="muted small">{rows.length}</span></div>
            <table className="grid tasks"><tbody>
              {rows.map(t => (
                <tr key={t.id} className="task-row" onClick={() => setTask(t.id)}>
                  <td className="muted small num">#{t.number}</td>
                  <td className="title">{t.status?.is_done ? <s>{t.title}</s> : t.title}</td>
                  <td>{t.status && <span className="status-chip" style={{ background: t.status.color }}>{t.status.name}</span>}</td>
                  <td className="muted small"><Link to={`/list/${t.list_id}`} onClick={e => e.stopPropagation()}>{where(t)}</Link></td>
                  <td>{t.priority !== 'normal' && <span className={`meta prio-${t.priority}`}>⚑ {t.priority}</span>}</td>
                  <td className={`small ${isOverdue(t.due_date) && !t.status?.is_done ? 'overdue' : 'muted'}`}>{fmtDate(t.due_date)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )
      })}

      {openTask && openSpace && statuses.length > 0 && (
        <TaskPanel taskId={openTask} spaceId={openSpace} statuses={statuses}
          onClose={() => setTask(null)} onChanged={load} onOpen={id => setTask(id)} />
      )}
    </div>
  )
}
