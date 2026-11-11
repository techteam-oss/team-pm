import { useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Flag, Inbox, LayoutGrid, List as ListIcon, ListChecks, Network, Plus, Settings2, Eye } from 'lucide-react'
import { SpaceBadge } from '../components/Layout'
import { useParams, useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../lib/workspace'
import { fmtDate, isOverdue, PRIORITIES, useListData, type Task } from '../lib/listData'
import Avatar from '../components/Avatar'
import TaskPanel from '../components/TaskPanel'
import MindMap from '../components/MindMap'
import CalendarView from '../components/CalendarView'
import ListToolbar, { ViewOptions } from '../components/ListToolbar'
import StatusEditor from '../components/StatusEditor'
import CreateTask from '../components/CreateTask'
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
  const [editStatuses, setEditStatuses] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setCollapsed(c => ({ ...c, [k]: !c[k] }))
  const statusOf = (t: Task) => statuses.find(s => s.id === t.status_id)

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

  const row = (t: Task, depth = 0): ReactNode[] => {
    const st = statusOf(t)
    const expanded = !!openSubs[t.id]
    const out: ReactNode[] = [(
      <tr key={t.id} className={`task-row ${depth ? 'sub-row' : ''}`} onClick={() => setParam('task', t.id)}>
        <td className="title">
          <div className="title-cell" style={depth ? { paddingLeft: 28 * depth } : undefined}>
            {t.subs.length > 0 ? (
              <button className="icon-btn sub-toggle" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${t.subs.length} subtasks of ${t.title}`}
                onClick={e => { e.stopPropagation(); setOpenSubs(o => ({ ...o, [t.id]: !expanded })) }}>
                <ChevronRight size={14} className={`chev ${expanded ? 'open' : ''}`} />
              </button>
            ) : <span className="sub-toggle-space" aria-hidden />}
            <span className={`status-dot ${st?.is_done ? 'done' : ''}`} style={{ color: st?.color ?? 'var(--faint)' }} title={st?.name} aria-hidden />
            <span className="t">{t.title}</span>
            {t.subtasks > 0 && (
              <button className="sub-count" title={expanded ? 'Hide subtasks' : 'Show subtasks'} disabled={!t.subs.length}
                onClick={e => { e.stopPropagation(); setOpenSubs(o => ({ ...o, [t.id]: !expanded })) }}>
                <ListChecks size={13} aria-hidden />{t.subtasks_done}/{t.subtasks}
              </button>
            )}
            <span className="tasknum">#{t.number}</span>
          </div>
        </td>
        <td className="avatars-cell"><span className="avatars">{t.assignees.map(a => person(a) && <Avatar key={a} id={a} name={person(a)!.name} size={24} />)}</span>
          {t.assignees.length === 0 && <span className="muted small">—</span>}</td>
        <td onClick={e => e.stopPropagation()}>
          <input type="date" aria-label="Due date" className={`cell-ctl ${t.due_date ? '' : 'empty'} ${isOverdue(t.due_date) && !(t.status_id && doneIds.has(t.status_id)) ? 'overdue' : ''}`} disabled={!canEdit} value={t.due_date ?? ''} onChange={e => update(t.id, { due_date: e.target.value || null })} />
        </td>
        <td onClick={e => e.stopPropagation()}>
          <span className={`prio-cell prio-${t.priority}`}>
            <Flag size={13} fill={t.priority === 'urgent' || t.priority === 'high' ? 'currentColor' : 'none'} aria-hidden />
            <select aria-label="Priority" disabled={!canEdit} value={t.priority} onChange={e => update(t.id, { priority: e.target.value })} className={`cell-ctl prio-${t.priority}`}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </span>
        </td>
      </tr>
    )]
    if (expanded) for (const c of t.subs) out.push(...row(c, depth + 1))
    return out
  }
  const thead = (
    <thead><tr><th>Name</th><th>Assignee</th><th>Due date</th><th>Priority</th></tr></thead>
  )
  const addRow = (statusId: string) => canEdit && (
    <form className="add-row" onSubmit={e => add(e, statusId)}>
      <Plus size={14} aria-hidden />
      <input placeholder="Add task" aria-label="New task name" value={draft[statusId] ?? ''} onChange={e => setDraft(d => ({ ...d, [statusId]: e.target.value }))} />
    </form>
  )

  if (!list) return <p className="muted">List not found, or you don't have access to it.</p>

  const meta = (t: Task) => (
    <>
      {t.priority !== 'normal' && <span className={`meta prio-${t.priority}`}><Flag size={12} fill={t.priority === 'low' ? 'none' : 'currentColor'} aria-hidden />{t.priority[0].toUpperCase() + t.priority.slice(1)}</span>}
      {t.due_date && <span className={`meta ${isOverdue(t.due_date) && !(t.status_id && doneIds.has(t.status_id)) ? 'overdue' : ''}`}><CalendarDays size={12} aria-hidden />{fmtDate(t.due_date)}</span>}
      {t.subtasks > 0 && (
        <button className="sub-count" title={openSubs[t.id] ? 'Hide subtasks' : 'Show subtasks'} aria-expanded={!!openSubs[t.id]}
          onClick={e => { e.stopPropagation(); setOpenSubs(o => ({ ...o, [t.id]: !o[t.id] })) }}>
          <ListChecks size={12} aria-hidden />{t.subtasks_done}/{t.subtasks}
        </button>
      )}
      <span className="avatars">{t.assignees.map(a => person(a) && <Avatar key={a} id={a} name={person(a)!.name} size={22} />)}</span>
    </>
  )
  const views = [
    { key: 'list', label: 'List', icon: <ListIcon size={15} aria-hidden /> },
    { key: 'board', label: 'Board', icon: <LayoutGrid size={15} aria-hidden /> },
    { key: 'calendar', label: 'Calendar', icon: <CalendarDays size={15} aria-hidden /> },
    { key: 'map', label: 'Mind map', icon: <Network size={15} aria-hidden /> },
  ] as const

  return (
    <div className="stack">
      <div className="list-head">
        <div className="crumbs">
          {space && <SpaceBadge space={space} size={16} />}<span>{space?.name}</span>
          <ChevronRight size={13} aria-hidden /><span>{list.name}</span>
        </div>
        <div className="list-title-row">
          <h1>{list.name}</h1>
          {!canEdit && <span className="pill"><Eye size={12} aria-hidden />View only</span>}
          {canEdit && view !== 'map' && statuses[0] && (
            <button className="primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Task</button>
          )}
        </div>
        <div className="view-tabs" role="tablist" aria-label="Views">
          {views.map(vw => (
            <button key={vw.key} role="tab" aria-selected={view === vw.key} className={`view-tab ${view === vw.key ? 'on' : ''}`}
              onClick={() => setParam('view', vw.key === 'list' ? null : vw.key)}>{vw.icon}{vw.label}</button>
          ))}
          <span className="spacer" />
          {view !== 'map' && <ViewOptions f={f} set={setF} showGroup={view === 'list'} showSort={view !== 'calendar'} />}
          {level(list.space_id) >= 4 && <button className="btn ghost small" onClick={() => setEditStatuses(true)}><Settings2 size={14} aria-hidden />Statuses</button>}
        </div>
      </div>

      {view !== 'map' && (
        <ListToolbar f={f} set={setF} clear={clearF} people={people} />
      )}
      {view === 'list' && tasks.length > 0 && shown.length === 0 && <p className="muted">No tasks match these filters.</p>}
      {(view === 'list' || view === 'board') && tasks.length === 0 && !canEdit && (
        <div className="card empty-state"><span className="ic"><Inbox size={20} aria-hidden /></span><h3>No tasks yet</h3><p>Tasks added to this list will show up here.</p></div>
      )}

      {view === 'calendar' ? (
        <CalendarView tasks={shown} statuses={statuses} canEdit={canEdit} onOpen={tid => setParam('task', tid)} onMove={(tid, due) => update(tid, { due_date: due })} />
      ) : view === 'map' ? (
        <MindMap listId={list.id} listName={list.name} statuses={statuses} canEdit={canEdit} onOpen={tid => setParam('task', tid)} />
      ) : view === 'list' && f.group !== 'status' ? groupTasks(shown, f.group, uid => person(uid)?.name ?? 'Former member').map(g => (
        <div key={g.key} className="group">
          <div className="group-head">
            <button className="icon-btn group-toggle" aria-expanded={!collapsed[g.key]} aria-label={`Toggle ${g.label}`} onClick={() => toggle(g.key)}><ChevronRight size={14} className={`chev ${collapsed[g.key] ? '' : 'open'}`} /></button>
            <b>{g.label}</b><span className="count">{g.tasks.length}</span>
          </div>
          {!collapsed[g.key] && <div className="group-body"><table className="tasks">{thead}<tbody>{g.tasks.flatMap(t => row(t))}</tbody></table></div>}
        </div>
      )) : view === 'list' ? statuses.filter(st => !(f.hideDone && st.is_done)).map(st => {
        const rows = shown.filter(t => t.status_id === st.id)
        return (
          <div key={st.id} className="group">
            <div className="group-head">
              <button className="icon-btn group-toggle" aria-expanded={!collapsed[st.id]} aria-label={`Toggle ${st.name}`} onClick={() => toggle(st.id)}><ChevronRight size={14} className={`chev ${collapsed[st.id] ? '' : 'open'}`} /></button>
              <span className="status-chip" style={{ background: st.color }}>{st.name}</span><span className="count">{rows.length}</span>
            </div>
            {!collapsed[st.id] && (
              <div className="group-body" data-add={st.id}>
                <table className="tasks">
                  {rows.length > 0 && thead}
                  <tbody>{rows.flatMap(t => row(t))}</tbody>
                </table>
                {addRow(st.id)}
              </div>
            )}
          </div>
        )
      }) : (
        <div className="board">
          {statuses.filter(st => !(f.hideDone && st.is_done)).map(st => {
            const col = shown.filter(t => t.status_id === st.id)
            return (
              <div key={st.id} className={`column ${overCol === st.id ? 'over' : ''}`} style={{ ['--col' as string]: st.color }} data-add={st.id}
                onDragOver={e => { if (canEdit) { e.preventDefault(); setOverCol(st.id) } }}
                onDragLeave={() => setOverCol(c => c === st.id ? null : c)}
                onDrop={e => drop(e, st.id)}>
                <div className="column-head">
                  <span className="status-chip" style={{ background: st.color }}>{st.name}</span>
                  <span className="count">{col.length}</span>
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
                      <div className="card-meta"><span className="tasknum">#{t.number}</span>{meta(t)}</div>
                      {openSubs[t.id] && t.subs.length > 0 && (
                        <ul className="card-subs">
                          {t.subs.map(c => {
                            const cs = statusOf(c)
                            return (
                              <li key={c.id} onClick={e => { e.stopPropagation(); setParam('task', c.id) }}>
                                <span className={`status-dot ${cs?.is_done ? 'done' : ''}`} style={{ color: cs?.color ?? 'var(--faint)' }} aria-hidden />
                                <span className={cs?.is_done ? 'struck' : ''}>{c.title}</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                {addRow(st.id)}
              </div>
            )
          })}
        </div>
      )}

      {creating && list && (
        <CreateTask listId={list.id} listName={list.name} spaceId={list.space_id} statuses={statuses}
          onClose={() => setCreating(false)}
          onCreated={(tid, open) => { load(); if (open) { setCreating(false); setParam('task', tid) } }} />
      )}
      {editStatuses && list && (
        <StatusEditor listId={list.id} statuses={statuses} tasks={tasks} onClose={() => setEditStatuses(false)} onChanged={load} />
      )}
      {openTask && list && (
        <TaskPanel taskId={openTask} spaceId={list.space_id} statuses={statuses}
          onClose={() => setParam('task', null)} onChanged={load} onOpen={tid => setParam('task', tid)} />
      )}
    </div>
  )
}
