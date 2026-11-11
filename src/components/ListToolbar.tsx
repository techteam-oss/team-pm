import { activeCount, type Filters } from '../lib/filters'
import { PRIORITIES } from '../lib/listData'

export default function ListToolbar({ f, set, clear, people, showGroup, showSort }: {
  f: Filters; set: (p: Partial<Filters>) => void; clear: () => void
  people: { id: string; name: string }[]; showGroup: boolean; showSort: boolean
}) {
  const n = activeCount(f)
  return (
    <div className="toolbar">
      <input className="tb-search" type="search" placeholder="Search tasks or #id" value={f.q} onChange={e => set({ q: e.target.value })} />
      <select value={f.assignee} onChange={e => set({ assignee: e.target.value })} className={f.assignee ? 'on' : ''} aria-label="Assignee">
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select value={f.priority} onChange={e => set({ priority: e.target.value })} className={f.priority ? 'on' : ''} aria-label="Priority">
        <option value="">Any priority</option>
        {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
      </select>
      <select value={f.due} onChange={e => set({ due: e.target.value as Filters['due'] })} className={f.due ? 'on' : ''} aria-label="Due date">
        <option value="">Any due date</option>
        <option value="overdue">Overdue</option>
        <option value="today">Due today</option>
        <option value="week">Due in next 7 days</option>
        <option value="none">No due date</option>
      </select>
      <label className="tb-check"><input type="checkbox" checked={f.hideDone} onChange={e => set({ hideDone: e.target.checked })} /> Hide done</label>
      {n > 0 && <button className="link" onClick={clear}>Clear {n} filter{n === 1 ? '' : 's'}</button>}
      <span className="tb-spacer" />
      {showSort && (
        <label className="tb-inline">Sort
          <select value={f.sort} onChange={e => set({ sort: e.target.value as Filters['sort'] })}>
            <option value="manual">Manual</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="newest">Newest</option>
            <option value="title">Name</option>
          </select>
        </label>
      )}
      {showGroup && (
        <label className="tb-inline">Group
          <select value={f.group} onChange={e => set({ group: e.target.value as Filters['group'] })}>
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="assignee">Assignee</option>
            <option value="due">Due date</option>
            <option value="none">None</option>
          </select>
        </label>
      )}
    </div>
  )
}
