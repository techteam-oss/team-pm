import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { fmtDate, isOverdue, type Status } from '../lib/listData'
import TaskPanel from '../components/TaskPanel'

type Hit = { id: string; number: number; title: string; list_id: string; space_id: string; due_date: string | null; parent_task_id: string | null; status: { name: string; color: string; is_done: boolean } | null }

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const openTask = params.get('task')
  const { workspace, lists, spaces } = useWorkspace()
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [comments, setComments] = useState<{ task_id: string; body: string; task: Hit | null }[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])

  useEffect(() => {
    const term = q.trim()
    if (!workspace || term.length < 2) { setHits(null); setComments([]); return }
    const t = setTimeout(async () => {
      const like = `%${term.replace(/[%_\\]/g, m => '\\' + m)}%`
      const num = /^#?\d+$/.test(term) ? Number(term.replace('#', '')) : null
      let tq = supabase.from('tasks').select('id, number, title, list_id, space_id, due_date, parent_task_id, status:statuses(name, color, is_done)')
        .eq('workspace_id', workspace.id).eq('archived', false).limit(50)
      tq = num != null ? tq.or(`number.eq.${num},title.ilike.${JSON.stringify(like)}`) : tq.ilike('title', like)
      const [a, b] = await Promise.all([
        tq,
        supabase.from('comments').select('task_id, body, task:tasks(id, number, title, list_id, space_id, due_date, parent_task_id)').ilike('body', like).limit(20),
      ])
      setHits((a.data ?? []) as unknown as Hit[])
      setComments((b.data ?? []) as unknown as typeof comments)
    }, 250)
    return () => clearTimeout(t)
  }, [q, workspace])

  const open = hits?.find(h => h.id === openTask) ?? comments.find(c => c.task_id === openTask)?.task ?? null
  useEffect(() => {
    if (!open) { setStatuses([]); return }
    supabase.from('statuses').select('id, name, color, position, is_done').eq('list_id', open.list_id).order('position').then(({ data }) => setStatuses(data ?? []))
  }, [open?.list_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: k === 'q' }) }
  const where = (listId: string) => { const l = lists.find(x => x.id === listId); const s = spaces.find(x => x.id === l?.space_id); return l ? `${s?.name} / ${l.name}` : '' }

  return (
    <div className="stack">
      <div className="page-head"><h1>Search</h1></div>
      <input type="search" autoFocus placeholder="Search tasks and comments, or #id" value={q} onChange={e => set('q', e.target.value)} style={{ maxWidth: 520 }} />
      {q.trim().length < 2 ? <p className="muted">Type at least 2 characters.</p> : hits === null ? <p className="muted">Searching…</p> : (
        <>
          <div className="group">
            <div className="group-head"><b>Tasks</b><span className="muted small">{hits.length}{hits.length === 50 ? '+' : ''}</span></div>
            {hits.length === 0 ? <p className="muted small">No tasks match.</p> : (
              <table className="grid tasks"><tbody>
                {hits.map(h => (
                  <tr key={h.id} className="task-row" onClick={() => set('task', h.id)}>
                    <td className="muted small num">#{h.number}</td>
                    <td className="title">{h.status?.is_done ? <s>{h.title}</s> : h.title}{h.parent_task_id && <span className="muted small"> · subtask</span>}</td>
                    <td>{h.status && <span className="status-chip" style={{ background: h.status.color }}>{h.status.name}</span>}</td>
                    <td className="muted small"><Link to={`/list/${h.list_id}`} onClick={e => e.stopPropagation()}>{where(h.list_id)}</Link></td>
                    <td className={`small nowrap ${isOverdue(h.due_date) && !h.status?.is_done ? 'overdue' : 'muted'}`}>{fmtDate(h.due_date)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          {comments.length > 0 && (
            <div className="group">
              <div className="group-head"><b>Comments</b><span className="muted small">{comments.length}</span></div>
              <table className="grid tasks"><tbody>
                {comments.map((c, i) => (
                  <tr key={i} className="task-row" onClick={() => set('task', c.task_id)}>
                    <td className="muted small num">#{c.task?.number}</td>
                    <td className="title">{c.body.length > 140 ? c.body.slice(0, 140) + '…' : c.body}<div className="muted small">on {c.task?.title}</div></td>
                    <td className="muted small">{c.task ? where(c.task.list_id) : ''}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </>
      )}
      {openTask && open && statuses.length > 0 && (
        <TaskPanel taskId={openTask} spaceId={open.space_id} statuses={statuses} onClose={() => set('task', null)} onChanged={() => {}} onOpen={id => set('task', id)} />
      )}
    </div>
  )
}
