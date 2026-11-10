import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'

type Status = { id: string; name: string; color: string; position: number; is_done: boolean }
type Task = { id: string; number: number; title: string; status_id: string | null; priority: string; due_date: string | null; parent_task_id: string | null }
const PRIORITIES = ['urgent', 'high', 'normal', 'low']

export default function ListView() {
  const { id } = useParams()
  const { lists, spaces, level } = useWorkspace()
  const list = lists.find(l => l.id === id)
  const space = spaces.find(s => s.id === list?.space_id)
  const canEdit = list ? level(list.space_id) >= 3 : false
  const [statuses, setStatuses] = useState<Status[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!id) return
    const [{ data: st }, { data: tk }] = await Promise.all([
      supabase.from('statuses').select('id, name, color, position, is_done').eq('list_id', id).order('position'),
      supabase.from('tasks').select('id, number, title, status_id, priority, due_date, parent_task_id')
        .eq('list_id', id).eq('archived', false).is('parent_task_id', null).order('position').order('created_at'),
    ])
    setStatuses(st ?? []); setTasks(tk ?? [])
  }, [id])

  useEffect(() => {
    load()
    if (!id) return
    const ch = supabase.channel(`list-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `list_id=eq.${id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id, load])

  async function add(e: FormEvent, statusId: string) {
    e.preventDefault()
    const title = draft[statusId]?.trim()
    if (!title || !id) return
    const { error } = await supabase.from('tasks').insert({ list_id: id, title, status_id: statusId })
    if (error) alert(error.message); else { setDraft(d => ({ ...d, [statusId]: '' })); load() }
  }

  async function update(t: Task, patch: Partial<Task>) {
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, ...patch } : x))
    const { error } = await supabase.from('tasks').update(patch).eq('id', t.id)
    if (error) { alert(error.message); load() }
  }

  if (!list) return <p className="muted">List not found, or you don't have access to it.</p>

  return (
    <div className="stack">
      <div>
        <div className="muted small">{space?.name}</div>
        <h1>{list.name}</h1>
        {!canEdit && <div className="pill">View only</div>}
      </div>
      {statuses.map(st => {
        const rows = tasks.filter(t => t.status_id === st.id)
        return (
          <div key={st.id} className="group">
            <div className="group-head"><span className="status-chip" style={{ background: st.color }}>{st.name}</span><span className="muted small">{rows.length}</span></div>
            <table className="grid tasks">
              <tbody>
                {rows.map(t => (
                  <tr key={t.id}>
                    <td className="muted small num">#{t.number}</td>
                    <td className="title">{canEdit ? <input className="bare" defaultValue={t.title} onBlur={e => e.target.value.trim() && e.target.value !== t.title && update(t, { title: e.target.value.trim() })} /> : t.title}</td>
                    <td>
                      <select disabled={!canEdit} value={t.status_id ?? ''} onChange={e => update(t, { status_id: e.target.value })}>
                        {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select disabled={!canEdit} value={t.priority} onChange={e => update(t, { priority: e.target.value })} className={`prio-${t.priority}`}>
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td><input type="date" disabled={!canEdit} value={t.due_date ?? ''} onChange={e => update(t, { due_date: e.target.value || null })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && (
              <form className="add-task" onSubmit={e => add(e, st.id)}>
                <input placeholder="+ Add task" value={draft[st.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [st.id]: e.target.value }))} />
              </form>
            )}
          </div>
        )
      })}
      <p className="muted small">Board view, assignees, subtasks and the task detail panel come in Phase 2.</p>
    </div>
  )
}
