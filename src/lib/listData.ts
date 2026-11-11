import { useCallback, useEffect, useState } from 'react'
import { notify } from '../components/Dialogs'
import { supabase } from './supabase'

export type Status = { id: string; name: string; color: string; position: number; is_done: boolean }
export type Task = {
  id: string; number: number; title: string; status_id: string | null; priority: string
  due_date: string | null; start_date: string | null; position: number; parent_task_id: string | null
  assignees: string[]; subtasks: number; subtasks_done: number
  /** Direct subtasks, in position order (only filled on top-level tasks). */
  subs: Task[]
}
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const

export function useListData(listId: string | undefined) {
  const [statuses, setStatuses] = useState<Status[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  const load = useCallback(async () => {
    if (!listId) return
    const [{ data: st }, { data: tk }] = await Promise.all([
      supabase.from('statuses').select('id, name, color, position, is_done').eq('list_id', listId).order('position'),
      supabase.from('tasks').select('id, number, title, status_id, priority, due_date, start_date, position, parent_task_id, task_assignees(user_id)')
        .eq('list_id', listId).eq('archived', false).order('position').order('created_at'),
    ])
    const statusList = st ?? []
    const done = new Set(statusList.filter(s => s.is_done).map(s => s.id))
    const all = (tk ?? []) as (Omit<Task, 'assignees' | 'subtasks' | 'subtasks_done' | 'subs'> & { task_assignees: { user_id: string }[] })[]
    const shape = ({ task_assignees, ...t }: (typeof all)[number]): Task => {
      const kids = all.filter(s => s.parent_task_id === t.id)
      return { ...t, assignees: task_assignees.map(a => a.user_id), subtasks: kids.length,
        subtasks_done: kids.filter(s => s.status_id && done.has(s.status_id)).length,
        subs: t.parent_task_id ? [] : kids.map(shape) }
    }
    setStatuses(statusList)
    setTasks(all.filter(t => !t.parent_task_id).map(shape))
  }, [listId])

  useEffect(() => {
    load()
    if (!listId) return
    const ch = supabase.channel(`list-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `list_id=eq.${listId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [listId, load])

  async function update(id: string, patch: Partial<Task>) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch }
      : t.subs.some(s => s.id === id) ? { ...t, subs: t.subs.map(s => s.id === id ? { ...s, ...patch } : s) } : t))
    const { error } = await supabase.from('tasks').update(patch).eq('id', id)
    if (error) { notify(error.message); load() }
  }

  async function create(title: string, statusId: string) {
    const last = tasks.filter(t => t.status_id === statusId).at(-1)
    const { error } = await supabase.from('tasks').insert({ list_id: listId, title, status_id: statusId, position: (last?.position ?? 0) + 1000 })
    if (error) notify(error.message); else load()
  }

  return { statuses, tasks, load, update, create }
}

export function fmtDate(d: string | null) {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(y, m - 1, day)
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function isOverdue(d: string | null) {
  if (!d) return false
  return d < new Date().toISOString().slice(0, 10)
}
