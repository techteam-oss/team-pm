import { Archive, CalendarDays, CircleDot, Flag, FolderInput, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { PRIORITIES, type Status, type Task } from '../lib/listData'
import { askChoice, askConfirm, notify } from './Dialogs'

/** Bar shown while tasks are selected in a list: change many tasks in one go. */
export default function BulkBar({ ids, tasks, statuses, update, onDone, onClear }: {
  ids: string[]; tasks: Task[]; statuses: Status[]
  update: (id: string, patch: Partial<Task>) => Promise<void>
  onDone: () => void; onClear: () => void
}) {
  const { people, lists, spaces, folders, level } = useWorkspace()
  const n = ids.length
  const what = `${n} task${n === 1 ? '' : 's'}`
  const finish = (msg: string) => { notify(msg, 'ok'); onDone() }

  async function setStatus() {
    const pick = await askChoice({ title: `Set status for ${what}`, instant: true, options: statuses.map(s => ({ value: s.id, label: s.name, color: s.color })) })
    if (!pick) return
    for (const id of ids) await update(id, { status_id: pick })
    finish(`Status changed on ${what}`)
  }
  async function setPriority() {
    const pick = await askChoice({ title: `Set priority for ${what}`, instant: true, options: PRIORITIES.map(p => ({ value: p, label: p[0].toUpperCase() + p.slice(1) })) })
    if (!pick) return
    const { error } = await supabase.from('tasks').update({ priority: pick }).in('id', ids)
    if (error) notify(error.message); else finish(`Priority changed on ${what}`)
  }
  async function setDue(value: string) {
    const { error } = await supabase.from('tasks').update({ due_date: value || null }).in('id', ids)
    if (error) notify(error.message); else finish(value ? `Due date set on ${what}` : `Due date removed from ${what}`)
  }
  async function assign() {
    const pick = await askChoice({ title: `Assign ${what} to`, instant: true, options: people.map(p => ({ value: p.id, label: p.name })) })
    if (!pick) return
    const { error } = await supabase.from('task_assignees').upsert(ids.map(task_id => ({ task_id, user_id: pick })), { onConflict: 'task_id,user_id', ignoreDuplicates: true })
    if (error) notify(error.message); else finish(`${people.find(p => p.id === pick)?.name} assigned to ${what}`)
  }
  async function move() {
    const here = new Set(tasks.filter(t => ids.includes(t.id)).map(t => t.list_id))
    const options = lists.filter(l => level(l.space_id) >= 3 && !(here.size === 1 && here.has(l.id)))
    const label = (l: typeof lists[number]) => [spaces.find(x => x.id === l.space_id)?.name, folders.find(x => x.id === l.folder_id)?.name, l.name].filter(Boolean).join(' / ')
    const pick = await askChoice({ title: `Move ${what} to`, confirmLabel: 'Move', initial: options[0]?.id, options: options.map(l => ({ value: l.id, label: label(l) })) })
    if (!pick) return
    let failed = 0
    for (const id of ids) { const { error } = await supabase.rpc('move_task', { p_task: id, p_list: pick }); if (error) failed++ }
    if (failed) notify(`${failed} of ${n} could not be moved`)
    finish(`Moved ${n - failed} to ${label(lists.find(l => l.id === pick)!)}`)
  }
  async function archive() {
    if (!await askConfirm({ title: `Archive ${what}?`, body: 'They are hidden from lists and boards. You can restore them from Archive.', confirmLabel: 'Archive' })) return
    const { error } = await supabase.from('tasks').update({ archived: true }).in('id', ids)
    if (error) notify(error.message); else finish(`Archived ${what}`)
  }

  return (
    <div className="bulk-bar" role="toolbar" aria-label={`${what} selected`}>
      <b>{n} selected</b>
      <button onClick={setStatus}><CircleDot size={15} aria-hidden />Status</button>
      <button onClick={assign}><UserPlus size={15} aria-hidden />Assign</button>
      <button onClick={setPriority}><Flag size={15} aria-hidden />Priority</button>
      <label className="bulk-date"><CalendarDays size={15} aria-hidden /><span>Due</span>
        <input type="date" aria-label="Due date for selected tasks" onChange={e => setDue(e.target.value)} />
      </label>
      <button onClick={move}><FolderInput size={15} aria-hidden />Move</button>
      <button onClick={archive}><Archive size={15} aria-hidden />Archive</button>
      <button className="icon-btn" aria-label="Clear selection" onClick={onClear}><X size={16} /></button>
    </div>
  )
}
