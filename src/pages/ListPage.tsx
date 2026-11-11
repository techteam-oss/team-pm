import { useState, type DragEvent, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../lib/workspace'
import { fmtDate, isOverdue, PRIORITIES, useListData, type Task } from '../lib/listData'
import Avatar from '../components/Avatar'
import TaskPanel from '../components/TaskPanel'
import MindMap from '../components/MindMap'
import CalendarView from '../components/CalendarView'
import ListToolbar from '../components/ListToolbar'
import { useAuth } from '../lib/auth'
import { applyFilters, groupTasks, useListFilters } from '../lib/filters'

export default function ListPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { lists, spaces, level, people } = useWorkspace()
  const list = lists.find(l => l.id === id)
  const space = spaces.find(s => s.id === list?.space_id)
  const canEdit = list ? level(list.space_id) >= 3 : false
  const { statuses, tasks, update, create, load } = useListData(id)
  const { session } = useAuth()
  const [f, setF, clearF] = useListFilters(id)
  const shown = applyFilters(tasks, f, session!.user.id, statuses)
  const doneIds = new Set(statuses.filter(s => s.is_done).map(s => s.id))
  const v = params.get('view')
  const view = v === 'board' || v === 'map' || v === 'calendar' ? v : 'list'
  const openTask = params.get('task')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next)
  }

  async function add(e: FormEvent, statusId: string) {
    e.preventDefault()
    const title = draft[statusId]?.trim()
    if (!title) return
    setDraft(d => ({ ...d, [statusId]: '' }))
    await create(title, statusId)
  }

  function drop(e: DragEvent, statusId: string, before?: Task) {
    e.preventDefault(); e.stopPropagation()
    setOverCol(null)
    const taskId = e.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!taskId || !canEdit) return
    const col = tasks.filter(t => t.status_id === statusId && t.id !== taskId)
    let position: number
    if (before) {
      const i = col.findIndex(t => t.id === before.id)
      const prev = col[i - 1]?.position ?? before.position - 2000
      position = (prev + before.position) / 2
    } else position = (col.at(-1)?.position ?? 0) + 1000
    update(taskId, { status_id: statusId, position })
  }

  const person = (uid: string) => people.find(p => p.id === uid)

  const row = (t: Task) => (
    <tr key={t.id} className="task-row" onClick={() => setParam('task', t.id)}>
                    <td className="muted small num">#{t.number}</td>
                    <td className="title">{t.title} <span className="row-meta">{t.subtasks > 0 && <span className="meta">☑ {t.subtasks_done}/{t.subtasks}</span>}</span></td>
                    <td className="avatars-cell"><span className="avatars">{t.assignees.map(a => person(a) && <Avatar key={a} name={person(a)!.name} size={22} />)}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      <select disabled={!canEdit} value={t.priority} onChange={e => update(t.id, { priority: e.target.value })} className={`prio-${t.priority}`}>
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="date" className={isOverdue(t.due_date) && !(t.status_id && doneIds.has(t.status_id)) ? 'overdue' : ''} disabled={!canEdit} value={t.due_date ?? ''} onChange={e => update(t.id, { due_date: e.target.value || null })} />
                    </td>
                  </tr>
  )

  if (!list) return <p className="muted">List not found, or you don't have access to it.</p>

  const meta = (t: Task) => (
    <>
      {t.subtasks > 0 && <span className="meta">☑ {t.subtasks_done}/{t.subtasks}</span>}
      {t.due_date && <span className={`meta ${isOverdue(t.due_date) ? 'overdue' : ''}`}>📅 {fmtDate(t.due_date)}</span>}
      {t.priority !== 'normal' && <span className={`meta prio-${t.priority}`}>⚑ {t.priority}</span>}
      <span className="avatars">{t.assignees.map(a => person(a) && <Avatar key={a} name={person(a)!.name} size={20} />)}</span>
    </>
  )

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="muted small">{space?.name}</div>
          <h1>{list.name}</h1>
        </div>
        <div className="row">
          {!canEdit && <span className="pill">View only</span>}
          <div className="segmented">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setParam('view', null)}>☰ List</button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => setParam('view', 'board')}>▦ Board</button>
            <button className={view === 'calendar' ? 'on' : ''} onClick={() => setParam('view', 'calendar')}>▤ Calendar</button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setParam('view', 'map')}>✳ Mind map</button>
          </div>
        </div>
      </div>

      {view !== 'map' && (
        <ListToolbar f={f} set={setF} clear={clearF} people={people} showGroup={view === 'list'} showSort={view !== 'calendar'} />
      )}
      {view === 'list' && tasks.length > 0 && shown.length === 0 && <p className="muted">No tasks match these filters.</p>}

      {view === 'calendar' ? (
        <CalendarView tasks={shown} statuses={statuses} canEdit={canEdit} onOpen={tid => setParam('task', tid)} onMove={(tid, due) => update(tid, { due_date: due })} />
      ) : view === 'map' ? (
        <MindMap listId={list.id} listName={list.name} statuses={statuses} canEdit={canEdit} onOpen={tid => setParam('task', tid)} />
      ) : view === 'list' && f.group !== 'status' ? groupTasks(shown, f.group, uid => person(uid)?.name ?? 'Former member').map(g => (
        <div key={g.key} className="group">
          <div className="group-head"><b>{g.label}</b><span className="muted small">{g.tasks.length}</span></div>
          <table className="grid tasks"><tbody>{g.tasks.map(row)}</tbody></table>
        </div>
      )) : view === 'list' ? statuses.filter(st => !(f.hideDone && st.is_done)).map(st => {
        const rows = shown.filter(t => t.status_id === st.id)
        return (
          <div key={st.id} className="group">
            <div className="group-head"><span className="status-chip" style={{ background: st.color }}>{st.name}</span><span className="muted small">{rows.length}</span></div>
            <table className="grid tasks">
              <tbody>
                {rows.map(row)}
              </tbody>
            </table>
            {canEdit && (
              <form className="add-task" onSubmit={e => add(e, st.id)}>
                <input placeholder="+ Add task" value={draft[st.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [st.id]: e.target.value }))} />
              </form>
            )}
          </div>
        )
      }) : (
        <div className="board">
          {statuses.filter(st => !(f.hideDone && st.is_done)).map(st => {
            const col = shown.filter(t => t.status_id === st.id)
            return (
              <div key={st.id} className={`column ${overCol === st.id ? 'over' : ''}`}
                onDragOver={e => { if (canEdit) { e.preventDefault(); setOverCol(st.id) } }}
                onDragLeave={() => setOverCol(c => c === st.id ? null : c)}
                onDrop={e => drop(e, st.id)}>
                <div className="column-head">
                  <span className="status-chip" style={{ background: st.color }}>{st.name}</span>
                  <span className="muted small">{col.length}</span>
                </div>
                <div className="cards">
                  {col.map(t => (
                    <div key={t.id} className={`card-task ${dragging === t.id ? 'dragging' : ''}`} draggable={canEdit}
                      onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragging(t.id) }}
                      onDragEnd={() => { setDragging(null); setOverCol(null) }}
                      onDragOver={e => { if (canEdit) e.preventDefault() }}
                      onDrop={e => drop(e, st.id, t)}
                      onClick={() => setParam('task', t.id)}>
                      <div className="card-title">{t.title}</div>
                      <div className="card-meta"><span className="muted small">#{t.number}</span>{meta(t)}</div>
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <form className="add-task" onSubmit={e => add(e, st.id)}>
                    <input placeholder="+ Add task" value={draft[st.id] ?? ''} onChange={e => setDraft(d => ({ ...d, [st.id]: e.target.value }))} />
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}

      {openTask && list && (
        <TaskPanel taskId={openTask} spaceId={list.space_id} statuses={statuses}
          onClose={() => setParam('task', null)} onChanged={load} onOpen={tid => setParam('task', tid)} />
      )}
    </div>
  )
}
