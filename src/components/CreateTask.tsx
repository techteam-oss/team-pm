import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, CircleDot, Clock, Flag, Hash, ShieldCheck, Tag, Timer, UserPlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { useTimer } from '../lib/time'
import { PRIORITIES, type Status } from '../lib/listData'
import Avatar from './Avatar'
import { notify } from './Dialogs'

/** ClickUp-style "Create task" dialog: name, description and every property in one go. */
export default function CreateTask({ listId, listName, spaceId, statuses, initialStatus, onClose, onCreated }: {
  listId: string; listName: string; spaceId: string; statuses: Status[]; initialStatus?: string
  onClose: () => void; onCreated: (taskId: string, open: boolean) => void
}) {
  const { people, level } = useWorkspace()
  const { start } = useTimer()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusId, setStatusId] = useState(initialStatus ?? statuses.find(s => !s.is_done)?.id ?? statuses[0]?.id ?? '')
  const [assignees, setAssignees] = useState<string[]>([])
  const [reviewer, setReviewer] = useState('')
  const [priority, setPriority] = useState('normal')
  const [startDate, setStartDate] = useState('')
  const [due, setDue] = useState('')
  const [estimate, setEstimate] = useState('')
  const [tags, setTags] = useState('')
  const [startTimer, setStartTimer] = useState(false)
  const [another, setAnother] = useState(false)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  // Only people who can open this space can be assigned or review.
  const eligible = people.filter(p => p.role === 'owner' || p.role === 'admin' || level(spaceId) > 0)
  const status = statuses.find(s => s.id === statusId)

  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    const est = estimate.trim() === '' ? null : Math.round(Number(estimate) * 60)
    const { data, error } = await supabase.from('tasks').insert({
      list_id: listId, title: title.trim(), description: description.trim() || null, status_id: statusId || null,
      priority, start_date: startDate || null, due_date: due || null, time_estimate_minutes: Number.isFinite(est) ? est : null,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean), reviewer_id: reviewer || null,
      position: Date.now() / 1000,
    }).select('id').single()
    if (error || !data) { setBusy(false); notify(error?.message ?? 'Could not create the task'); return }
    if (assignees.length) {
      const r = await supabase.from('task_assignees').insert(assignees.map(user_id => ({ task_id: data.id, user_id })))
      if (r.error) notify(r.error.message)
    }
    if (startTimer) await start(data.id)
    setBusy(false)
    notify(`Created "${title.trim()}"`, 'ok')
    if (another) {
      onCreated(data.id, false)
      setTitle(''); setDescription(''); setAssignees([]); setReviewer(''); setDue(''); setStartDate(''); setEstimate(''); setTags(''); setStartTimer(false)
      titleRef.current?.focus()
    } else onCreated(data.id, true)
  }

  const person = (id: string) => people.find(p => p.id === id)

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal create-task" role="dialog" aria-modal="true" aria-label="Create task" onSubmit={submit}>
        <div className="modal-head">
          <div className="crumbs"><Hash size={13} aria-hidden />New task in <b style={{ color: 'var(--text)' }}>{listName}</b></div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <input ref={titleRef} className="ct-title" placeholder="Task name" aria-label="Task name" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} />
        <textarea className="ct-desc" placeholder="Add a description (supports **bold**, lists, - [ ] checkboxes)" aria-label="Description" rows={3} value={description} onChange={e => setDescription(e.target.value)} />

        <div className="ct-props">
          <label className="ct-prop"><span><CircleDot size={14} aria-hidden />Status</span>
            <select value={statusId} onChange={e => setStatusId(e.target.value)} style={{ color: status?.color }}>
              {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="ct-prop"><span><Flag size={14} aria-hidden />Priority</span>
            <select value={priority} onChange={e => setPriority(e.target.value)} className={`prio-${priority}`}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </label>
          <label className="ct-prop"><span><CalendarDays size={14} aria-hidden />Start date</span>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label className="ct-prop"><span><CalendarDays size={14} aria-hidden />Due date</span>
            <input type="date" value={due} min={startDate || undefined} onChange={e => setDue(e.target.value)} />
          </label>
          <label className="ct-prop"><span><Clock size={14} aria-hidden />Estimate (hours)</span>
            <input type="number" min="0" step="0.25" placeholder="e.g. 2.5" value={estimate} onChange={e => setEstimate(e.target.value)} />
          </label>
          <label className="ct-prop"><span><Tag size={14} aria-hidden />Tags</span>
            <input placeholder="design, client" value={tags} onChange={e => setTags(e.target.value)} />
          </label>
        </div>

        <div className="ct-people">
          <div className="ct-prop">
            <span><UserPlus size={14} aria-hidden />Assignees</span>
            <div className="row">
              {assignees.map(id => (
                <span key={id} className="chip"><Avatar id={id} name={person(id)?.name ?? '?'} size={20} />{person(id)?.name}
                  <button type="button" className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`Remove ${person(id)?.name}`} onClick={() => setAssignees(a => a.filter(x => x !== id))}><X size={12} /></button>
                </span>
              ))}
              <select value="" aria-label="Add assignee" onChange={e => e.target.value && setAssignees(a => [...a, e.target.value])}>
                <option value="">+ Add person</option>
                {eligible.filter(p => !assignees.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <label className="ct-prop"><span><ShieldCheck size={14} aria-hidden />QA / reviewer</span>
            <select value={reviewer} onChange={e => setReviewer(e.target.value)}>
              <option value="">No reviewer</option>
              {eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <div className="ct-foot">
          <label className="tb-check"><input type="checkbox" checked={startTimer} onChange={e => setStartTimer(e.target.checked)} /><Timer size={14} aria-hidden />Start my timer on it</label>
          <label className="tb-check"><input type="checkbox" checked={another} onChange={e => setAnother(e.target.checked)} />Create another</label>
          <span className="tb-spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!title.trim() || busy}>{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </form>
    </div>
  )
}
