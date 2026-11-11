import { Search, X } from 'lucide-react'
import { activeCount, type Filters } from '../lib/filters'
import { PRIORITIES } from '../lib/listData'

export default function ListToolbar({ f, set, clear, people }: {
  f: Filters; set: (p: Partial<Filters>) => void; clear: () => void
  people: { id: string; name: string }[]
}) {
  const n = activeCount(f)
  return (
    <div className="toolbar">
      <div className="tb-search">
        <Search size={14} aria-hidden />
        <input type="search" placeholder="Search tasks or #id" aria-label="Search tasks" value={f.q} onChange={e => set({ q: e.target.value })} />
      </div>
      <select value={f.assignee} onChange={e => set({ assignee: e.target.value })} className={f.assignee ? 'on' : ''} aria-label="Assignee">
        <option value="">Assignee: anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select value={f.priority} onChange={e => set({ priority: e.target.value })} className={f.priority ? 'on' : ''} aria-label="Priority">
        <option value="">Priority: any</option>
        {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
      </select>
      <select value={f.due} onChange={e => set({ due: e.target.value as Filters['due'] })} className={f.due ? 'on' : ''} aria-label="Due date">
        <option value="">Due: any time</option>
        <option value="overdue">Overdue</option>
        <option value="today">Due today</option>
        <option value="week">Due in next 7 days</option>
        <option value="none">No due date</option>
      </select>
      <label className="tb-check"><input type="checkbox" checked={f.hideDone} onChange={e => set({ hideDone: e.target.checked })} /> Hide closed</label>
      {n > 0 && <button className="link" onClick={clear}><X size={13} aria-hidden />Clear {n}</button>}
    </div>
  )
}

/** Sort and group pickers, shown in the view-tab row. */
export function ViewOptions({ f, set, showGroup, showSort }: { f: Filters; set: (p: Partial<Filters>) => void; showGroup: boolean; showSort: boolean }) {
  return (
    <div className="toolbar view-opts">
      {showSort && (
        <label className="tb-inline" title="Sort">
          <select aria-label="Sort" value={f.sort} onChange={e => set({ sort: e.target.value as Filters['sort'] })}>
            <option value="manual">Sort: manual</option>
            <option value="due">Sort: due date</option>
            <option value="priority">Sort: priority</option>
            <option value="newest">Sort: newest</option>
            <option value="title">Sort: name</option>
          </select>
        </label>
      )}
      {showGroup && (
        <label className="tb-inline" title="Group by">
          <select aria-label="Group by" value={f.group} onChange={e => set({ group: e.target.value as Filters['group'] })}>
            <option value="status">Group: status</option>
            <option value="priority">Group: priority</option>
            <option value="assignee">Group: assignee</option>
            <option value="due">Group: due date</option>
            <option value="none">Group: none</option>
          </select>
        </label>
      )}
    </div>
  )
}
