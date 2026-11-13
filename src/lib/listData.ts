import { useCallback, useEffect, useState } from 'react'
import { notify } from '../components/Dialogs'
import { supabase } from './supabase'

export type Status = { id: string; name: string; color: string; position: number; is_done: boolean }
export type QaState = 'pending' | 'approved' | 'changes' | null
export type Task = {
  id: string; number: number; title: string; status_id: string | null; priority: string
  due_date: string | null; start_date: string | null; position: number; parent_task_id: string | null
  list_id: string; reviewer_id: string | null; qa_state: QaState
  /** Waits on at least one task that is not done yet. */
  blocked: boolean
  assignees: string[]; subtasks: number; subtasks_done: number
  /** Direct subtasks, in position order (only filled on top-level tasks). */
  subs: Task[]
}
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const

/** What a page shows: one list, every list in a folder, or every list in a space. */
export type Scope = { kind: 'list' | 'folder' | 'space'; id: string }

type RawStatus = Status & { list_id: string }
const statusKey = (name: string) => `name:${name.trim().toLowerCase()}`

/**
 * Tasks and statuses for a scope. In a folder or space the lists' statuses are merged by name
 * ("In progress" in every list is one column), so tasks there carry the merged status id; update()
 * turns it back into the real status of the task's own list.
 */
export function useListData(scope: Scope | string | undefined) {
  const sc: Scope | undefined = typeof scope === 'string' ? { kind: 'list', id: scope } : scope
  const kind = sc?.kind, id = sc?.id
  const [statuses, setStatuses] = useState<Status[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [raw, setRaw] = useState<RawStatus[]>([])

  const load = useCallback(async () => {
    if (!kind || !id) return
    const col = kind === 'list' ? 'list_id' : kind === 'space' ? 'space_id' : null
    let listIds: string[] | null = null
    if (kind === 'folder') {
      const { data } = await supabase.from('lists').select('id').eq('folder_id', id).eq('archived', false)
      listIds = (data ?? []).map(l => l.id)
    }
    const stQ = supabase.from('statuses').select('id, name, color, position, is_done, list_id').order('position')
    const tkQ = supabase.from('tasks').select('id, number, title, status_id, priority, due_date, start_date, position, parent_task_id, list_id, reviewer_id, qa_state, task_assignees(user_id), list:lists!inner(archived)')
      .eq('archived', false).eq('list.archived', false).order('position').order('created_at')
    const [{ data: st }, { data: tk }] = await Promise.all([
      col ? stQ.eq(col, id) : stQ.in('list_id', listIds ?? []),
      col ? tkQ.eq(col, id) : tkQ.in('list_id', listIds ?? []),
    ])
    const rawStatuses = (st ?? []) as RawStatus[]
    let statusList: Status[]
    let mapStatus: (sid: string | null) => string | null
    if (kind === 'list') {
      statusList = rawStatuses.map(({ list_id: _l, ...x }) => x)
      mapStatus = sid => sid
    } else {
      const merged = new Map<string, Status>()
      for (const x of rawStatuses) {
        const k = statusKey(x.name)
        const m = merged.get(k)
        if (!m) merged.set(k, { id: k, name: x.name, color: x.color, position: x.position, is_done: x.is_done })
        else { m.position = Math.min(m.position, x.position); m.is_done = m.is_done && x.is_done }
      }
      // Open statuses first, done ones last, otherwise by their usual position.
      statusList = [...merged.values()].sort((a, b) => Number(a.is_done) - Number(b.is_done) || a.position - b.position)
      const byId = new Map(rawStatuses.map(x => [x.id, statusKey(x.name)]))
      mapStatus = sid => (sid && byId.get(sid)) || null
    }
    const done = new Set(statusList.filter(s => s.is_done).map(s => s.id))
    type Row = Omit<Task, 'assignees' | 'subtasks' | 'subtasks_done' | 'subs' | 'blocked'> & { task_assignees: { user_id: string }[]; list?: unknown }
    const rows = (tk ?? []) as unknown as Row[]
    // Which tasks still wait on an unfinished task.
    const blocked = new Set<string>()
    if (rows.length) {
      const dq = supabase.from('task_dependencies').select('task_id, blocker:tasks!task_dependencies_blocked_by_id_fkey(archived, status:statuses(is_done))')
      const { data: deps } = await (kind === 'space' ? dq.eq('space_id', id) : dq.in('task_id', rows.map(r => r.id)))
      for (const d of (deps ?? []) as unknown as { task_id: string; blocker: { archived: boolean; status: { is_done: boolean } | null } | null }[])
        if (d.blocker && !d.blocker.archived && !d.blocker.status?.is_done) blocked.add(d.task_id)
    }
    const all = rows.map(({ list: _l, ...t }) => ({ ...t, status_id: mapStatus(t.status_id), blocked: blocked.has(t.id) }))
    const shape = ({ task_assignees, ...t }: (typeof all)[number]): Task => {
      const kids = all.filter(s => s.parent_task_id === t.id)
      return { ...t, assignees: task_assignees.map(a => a.user_id), subtasks: kids.length,
        subtasks_done: kids.filter(s => s.status_id && done.has(s.status_id)).length,
        subs: t.parent_task_id ? [] : kids.map(shape) }
    }
    setRaw(rawStatuses)
    setStatuses(statusList)
    // A subtask whose parent is outside this view (another list) shows on its own.
    const ids = new Set(all.map(t => t.id))
    setTasks(all.filter(t => !t.parent_task_id || !ids.has(t.parent_task_id)).map(shape))
  }, [kind, id])

  useEffect(() => {
    load()
    if (!kind || !id) return
    const filter = kind === 'list' ? `list_id=eq.${id}` : kind === 'space' ? `space_id=eq.${id}` : undefined
    const ch = supabase.channel(`${kind}-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', ...(filter ? { filter } : {}) }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_dependencies' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [kind, id, load])

  /** The real status id for a task (merged views use one id per status name). */
  function realStatus(taskListId: string, sid: string | null | undefined): string | null | undefined {
    if (kind === 'list' || !sid || !sid.startsWith('name:')) return sid
    const own = raw.filter(x => x.list_id === taskListId)
    const merged = statuses.find(x => x.id === sid)
    return (own.find(x => statusKey(x.name) === sid) ?? own.find(x => x.is_done === !!merged?.is_done) ?? own[0])?.id ?? null
  }

  function find(id: string): Task | undefined {
    for (const t of tasks) { if (t.id === id) return t; const s = t.subs.find(x => x.id === id); if (s) return s }
  }

  async function update(id: string, patch: Partial<Task>) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch }
      : t.subs.some(s => s.id === id) ? { ...t, subs: t.subs.map(s => s.id === id ? { ...s, ...patch } : s) } : t))
    const t = find(id)
    const dbPatch: Record<string, unknown> = { ...patch }
    if ('status_id' in patch && t) dbPatch.status_id = realStatus(t.list_id, patch.status_id)
    const { error } = await supabase.from('tasks').update(dbPatch).eq('id', id)
    if (error) notify(error.message)
    if (error || 'status_id' in patch) load()
  }

  async function create(title: string, statusId: string, listId?: string) {
    const target = kind === 'list' ? id : listId
    if (!target) return
    const last = tasks.filter(t => t.status_id === statusId).at(-1)
    const { error } = await supabase.from('tasks').insert({ list_id: target, title, status_id: realStatus(target, statusId), position: (last?.position ?? 0) + 1000 })
    if (error) notify(error.message); else load()
  }

  /** Statuses of one list (for the create dialog in a merged view). */
  const statusesOf = (listId: string): Status[] => raw.filter(x => x.list_id === listId).map(({ list_id: _l, ...x }) => x)

  return { statuses, tasks, load, update, create, realStatus, statusesOf }
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
