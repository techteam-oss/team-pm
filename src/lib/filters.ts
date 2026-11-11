import { useEffect, useState } from 'react'
import type { Status, Task } from './listData'

export type Filters = {
  q: string
  assignee: '' | 'me' | 'none' | string
  priority: '' | string
  due: '' | 'overdue' | 'today' | 'week' | 'none'
  hideDone: boolean
  sort: 'manual' | 'due' | 'priority' | 'newest' | 'title'
  group: 'status' | 'priority' | 'assignee' | 'due' | 'none'
}
export const DEFAULT_FILTERS: Filters = { q: '', assignee: '', priority: '', due: '', hideDone: false, sort: 'manual', group: 'status' }
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function activeCount(f: Filters) {
  return [f.q.trim(), f.assignee, f.priority, f.due, f.hideDone ? 'x' : ''].filter(Boolean).length
}

export function applyFilters(tasks: Task[], f: Filters, me: string, statuses: Status[]): Task[] {
  const today = localIso(new Date())
  const week = localIso(new Date(Date.now() + 7 * 86400000))
  const done = new Set(statuses.filter(s => s.is_done).map(s => s.id))
  const q = f.q.trim().toLowerCase()
  const out = tasks.filter(t => {
    if (q && !t.title.toLowerCase().includes(q) && !String(t.number).includes(q.replace('#', ''))) return false
    if (f.assignee === 'me' && !t.assignees.includes(me)) return false
    if (f.assignee === 'none' && t.assignees.length) return false
    if (f.assignee && !['me', 'none'].includes(f.assignee) && !t.assignees.includes(f.assignee)) return false
    if (f.priority && t.priority !== f.priority) return false
    if (f.hideDone && t.status_id && done.has(t.status_id)) return false
    if (f.due === 'none' && t.due_date) return false
    if (f.due === 'overdue' && !(t.due_date && t.due_date < today && !(t.status_id && done.has(t.status_id)))) return false
    if (f.due === 'today' && t.due_date !== today) return false
    if (f.due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= week)) return false
    return true
  })
  const cmp: Record<Filters['sort'], (a: Task, b: Task) => number> = {
    manual: (a, b) => a.position - b.position,
    due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.position - b.position,
    priority: (a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.position - b.position,
    newest: (a, b) => b.number - a.number,
    title: (a, b) => a.title.localeCompare(b.title),
  }
  return out.sort(cmp[f.sort])
}

/** Groups for the list view when not grouping by status. */
export function groupTasks(tasks: Task[], by: Filters['group'], nameOf: (id: string) => string): { key: string; label: string; tasks: Task[] }[] {
  if (by === 'none') return [{ key: 'all', label: 'All tasks', tasks }]
  const today = localIso(new Date())
  const week = localIso(new Date(Date.now() + 7 * 86400000))
  const order: string[] = []
  const map = new Map<string, Task[]>()
  const put = (k: string, t: Task) => { if (!map.has(k)) { map.set(k, []); order.push(k) } map.get(k)!.push(t) }
  for (const t of tasks) {
    if (by === 'priority') put(t.priority, t)
    else if (by === 'assignee') { if (!t.assignees.length) put('none', t); else for (const a of t.assignees) put(a, t) }
    else if (by === 'due') put(!t.due_date ? '4' : t.due_date < today ? '0' : t.due_date === today ? '1' : t.due_date <= week ? '2' : '3', t)
  }
  const DUE = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No due date']
  const label = (k: string) => by === 'priority' ? k[0].toUpperCase() + k.slice(1) : by === 'due' ? DUE[Number(k)] : k === 'none' ? 'Unassigned' : nameOf(k)
  const keys = by === 'priority' ? ['urgent', 'high', 'normal', 'low'].filter(k => map.has(k))
    : by === 'due' ? order.sort() : order.sort((a, b) => a === 'none' ? 1 : b === 'none' ? -1 : nameOf(a).localeCompare(nameOf(b)))
  return keys.map(k => ({ key: k, label: label(k), tasks: map.get(k)! }))
}

/** Filters per list, remembered in this browser. */
export function useListFilters(listId: string | undefined) {
  const key = `team-pm-filters-${listId}`
  const read = () => { try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(key) ?? '{}') } as Filters } catch { return DEFAULT_FILTERS } }
  const [f, setF] = useState<Filters>(read)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setF(read()) }, [listId])
  const set = (patch: Partial<Filters>) => setF(prev => {
    const next = { ...prev, ...patch }
    try { localStorage.setItem(key, JSON.stringify({ ...next, q: '' })) } catch { /* private mode */ }
    return next
  })
  return [f, set, () => set({ ...DEFAULT_FILTERS, sort: f.sort, group: f.group })] as const
}
