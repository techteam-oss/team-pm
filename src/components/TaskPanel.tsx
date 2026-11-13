import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/workspace'
import { PRIORITIES, type Status } from '../lib/listData'
import Avatar from './Avatar'
import TimeSection from './TimeSection'
import { RichEditor } from './RichText'
import { encodeMentions, MentionTextarea, renderMentions, type MentionPerson } from './Mentions'
import { askChoice, askConfirm, askText, notify } from './Dialogs'
import { Bell, BellRing, Check, FolderInput, Paperclip, ShieldCheck, Undo2, X } from 'lucide-react'
import { fmtMinutes } from '../lib/time'
import { QA_LABEL } from './QaBadge'
import { shrinkImage } from '../lib/image'
import { useNavigate } from 'react-router-dom'

type Full = {
  id: string; number: number; list_id: string; title: string; description: string | null; status_id: string | null
  priority: string; start_date: string | null; due_date: string | null; time_estimate_minutes: number | null; reviewer_id: string | null
  tags: string[]; parent_task_id: string | null; created_by: string | null; created_at: string
  archived: boolean; deleted_at: string | null; completed_at: string | null; completed_by: string | null
  qa_state: 'pending' | 'approved' | 'changes' | null; qa_by: string | null; qa_at: string | null; qa_note: string | null; rework_count: number
}
type Sub = { id: string; number: number; title: string; status_id: string | null }
type Check = { id: string; title: string; done: boolean; position: number }
type Comment = { id: string; user_id: string; body: string; assigned_to: string | null; resolved: boolean; created_at: string; comment_reactions: { user_id: string; emoji: string }[] }
type Activity = { id: number; user_id: string | null; action: string; details: Record<string, unknown>; created_at: string }
type Dep = { id: string; number: number; title: string; list_id: string; archived: boolean; status: { name: string; color: string; is_done: boolean } | null }
type Attachment = { id: string; storage_path: string; file_name: string; size_bytes: number; uploaded_by: string }

const EMOJIS = ['👍', '❤️', '🎉', '✅']

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function TaskPanel({ taskId, spaceId, statuses: givenStatuses, onClose, onChanged, onOpen }: {
  taskId: string; spaceId: string; statuses: Status[]
  onClose: () => void; onChanged: () => void; onOpen: (id: string) => void
}) {
  const { session } = useAuth()
  const me = session!.user.id
  const { people, level, lists, folders, spaces } = useWorkspace()
  const navigate = useNavigate()
  const lvl = level(spaceId)
  const canEdit = lvl >= 3, canComment = lvl >= 2
  const [task, setTask] = useState<Full | null>(null)
  const [assignees, setAssignees] = useState<string[]>([])
  const [watchers, setWatchers] = useState<string[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [checks, setChecks] = useState<Check[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [files, setFiles] = useState<Attachment[]>([])
  const [newSub, setNewSub] = useState('')
  const [newCheck, setNewCheck] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<MentionPerson[]>([])
  const [assignTo, setAssignTo] = useState('')
  const [uploading, setUploading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [ownStatuses, setOwnStatuses] = useState<Status[]>([])
  const [logged, setLogged] = useState<{ user_id: string; minutes: number }[]>([])
  const [waitingOn, setWaitingOn] = useState<Dep[]>([])
  const [blocking, setBlocking] = useState<Dep[]>([])
  const [depInput, setDepInput] = useState('')
  const statuses = ownStatuses.length ? ownStatuses : givenStatuses

  const load = useCallback(async () => {
    const { data: t } = await supabase.from('tasks')
      .select('id, number, list_id, title, description, status_id, priority, start_date, due_date, time_estimate_minutes, reviewer_id, tags, parent_task_id, created_by, created_at, archived, deleted_at, completed_at, completed_by, qa_state, qa_by, qa_at, qa_note, rework_count')
      .eq('id', taskId).maybeSingle()
    if (!t) { setMissing(true); return }
    setTask(t)
    const depSel = 'id, number, title, list_id, archived, status:statuses(name, color, is_done)'
    const [a, w, s, c, cm, ac, f, st, te, wo, bl] = await Promise.all([
      supabase.from('task_assignees').select('user_id').eq('task_id', taskId),
      supabase.from('task_watchers').select('user_id').eq('task_id', taskId),
      supabase.from('tasks').select('id, number, title, status_id').eq('parent_task_id', taskId).eq('archived', false).order('position').order('created_at'),
      supabase.from('checklist_items').select('id, title, done, position').eq('task_id', taskId).order('position').order('created_at'),
      supabase.from('comments').select('id, user_id, body, assigned_to, resolved, created_at, comment_reactions(user_id, emoji)').eq('task_id', taskId).order('created_at'),
      supabase.from('activity_log').select('id, user_id, action, details, created_at').eq('task_id', taskId).order('created_at'),
      supabase.from('attachments').select('id, storage_path, file_name, size_bytes, uploaded_by').eq('task_id', taskId).order('created_at'),
      // The task's own list statuses (space and folder views mix lists).
      supabase.from('statuses').select('id, name, color, position, is_done').eq('list_id', t.list_id).order('position'),
      supabase.from('time_entries').select('user_id, started_at, ended_at').eq('task_id', taskId),
      supabase.from('task_dependencies').select(`t:tasks!task_dependencies_blocked_by_id_fkey(${depSel})`).eq('task_id', taskId),
      supabase.from('task_dependencies').select(`t:tasks!task_dependencies_task_id_fkey(${depSel})`).eq('blocked_by_id', taskId),
    ])
    const deps = (rows: unknown) => ((rows ?? []) as { t: Dep | null }[]).map(r => r.t).filter((x): x is Dep => !!x)
    setWaitingOn(deps(wo.data)); setBlocking(deps(bl.data))
    setOwnStatuses(st.data ?? [])
    const per = new Map<string, number>()
    for (const e of te.data ?? []) per.set(e.user_id, (per.get(e.user_id) ?? 0) + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()) / 60000)
    setLogged([...per].map(([user_id, minutes]) => ({ user_id, minutes })).sort((x, y) => y.minutes - x.minutes))
    setAssignees((a.data ?? []).map(x => x.user_id)); setWatchers((w.data ?? []).map(x => x.user_id))
    setSubs(s.data ?? []); setChecks(c.data ?? []); setComments((cm.data ?? []) as Comment[])
    setActivity((ac.data ?? []) as Activity[]); setFiles(f.data ?? [])
  }, [taskId])

  useEffect(() => {
    load()
    const ch = supabase.channel(`task-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `task_id=eq.${taskId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `task_id=eq.${taskId}` }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` }, () => load())
      .subscribe()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => { supabase.removeChannel(ch); window.removeEventListener('keydown', esc) }
  }, [taskId, load, onClose])

  const name = (uid: string | null) => people.find(p => p.id === uid)?.name ?? 'Someone'
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (error) notify(error.message)
    await load(); onChanged()
  }
  const patch = (fields: Partial<Full>) => {
    setTask(t => t ? { ...t, ...fields } : t)
    return run(supabase.from('tasks').update(fields).eq('id', taskId))
  }

  if (missing) return (
    <div className="panel-backdrop" onClick={onClose}><aside className="panel" onClick={e => e.stopPropagation()}>
      <p className="muted">This task was deleted or you no longer have access.</p><button style={{ alignSelf: "flex-start" }} onClick={onClose}>Close</button>
    </aside></div>
  )
  if (!task) return <div className="panel-backdrop"><aside className="panel"><p className="muted">Loading…</p></aside></div>

  const doneStatus = statuses.find(s => s.is_done)
  const firstStatus = statuses[0]
  const isDone = (sid: string | null) => !!statuses.find(s => s.id === sid)?.is_done
  const watching = watchers.includes(me)

  async function addSub(e: FormEvent) {
    e.preventDefault()
    if (!newSub.trim()) return
    await run(supabase.from('tasks').insert({ list_id: task!.list_id, parent_task_id: taskId, title: newSub.trim(), status_id: firstStatus?.id }))
    setNewSub('')
  }
  async function addCheck(e: FormEvent) {
    e.preventDefault()
    if (!newCheck.trim()) return
    await run(supabase.from('checklist_items').insert({ task_id: taskId, title: newCheck.trim(), position: (checks.at(-1)?.position ?? 0) + 1 }))
    setNewCheck('')
  }
  async function postComment(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    await run(supabase.from('comments').insert({ task_id: taskId, body: encodeMentions(body.trim(), picked), assigned_to: assignTo || null }))
    setBody(''); setAssignTo(''); setPicked([])
  }
  async function react(c: Comment, emoji: string) {
    const mine = c.comment_reactions.some(r => r.user_id === me && r.emoji === emoji)
    await run(mine
      ? supabase.from('comment_reactions').delete().eq('comment_id', c.id).eq('user_id', me).eq('emoji', emoji)
      : supabase.from('comment_reactions').insert({ comment_id: c.id, emoji }))
  }
  async function upload(original: File) {
    setUploading(true)
    const file = await shrinkImage(original)
    if (file.size > 10 * 1024 * 1024) { setUploading(false); notify('Files can be up to 10 MB. For bigger files, paste a Google Drive link in a comment.'); return }
    const path = `${spaceId}/${taskId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type })
    if (error) { notify(error.message); setUploading(false); return }
    await run(supabase.from('attachments').insert({ task_id: taskId, storage_path: path, file_name: file.name, size_bytes: file.size, mime_type: file.type }))
    setUploading(false)
  }
  async function openFile(a: Attachment) {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 300)
    if (error) notify(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function removeFile(a: Attachment) {
    if (!await askConfirm({ title: `Delete ${a.file_name}?`, body: 'The file is removed for everyone.', confirmLabel: 'Delete file', danger: true })) return
    await supabase.storage.from('attachments').remove([a.storage_path])
    await run(supabase.from('attachments').delete().eq('id', a.id))
  }
  async function setArchive(fields: Partial<Full>, close: boolean) {
    const { error } = await supabase.from('tasks').update(fields).eq('id', taskId)
    if (error) { notify(error.message); return }
    onChanged()
    if (close) onClose(); else load()
  }
  async function moveTask() {
    if (!task) return
    // Any open list in a space where you can edit, like ClickUp: other spaces, folders and lists.
    const options = lists.filter(l => l.id !== task.list_id && level(l.space_id) >= 3)
      .sort((x, y) => (spaces.findIndex(s => s.id === x.space_id) - spaces.findIndex(s => s.id === y.space_id)) || (x.folder_id ?? '').localeCompare(y.folder_id ?? '') || x.position - y.position)
    if (!options.length) { notify('There is no other list you can move it to.'); return }
    const label = (l: typeof lists[number]) => {
      const f = folders.find(x => x.id === l.folder_id); const sp = spaces.find(x => x.id === l.space_id)
      return [sp?.name, f?.name, l.name].filter(Boolean).join(' / ')
    }
    const pick = await askChoice({ title: `Move "${task.title}" to`, confirmLabel: 'Move task', initial: options[0].id,
      options: options.map(l => ({ value: l.id, label: label(l) })) })
    if (!pick) return
    const { error } = await supabase.rpc('move_task', { p_task: task.id, p_list: pick })
    if (error) { notify(error.message); return }
    notify(`Moved to ${label(options.find(l => l.id === pick)!)}${subs.length ? ' with its subtasks' : ''}`, 'ok')
    onChanged()
    navigate(`/list/${pick}?task=${task.id}`)
  }
  const trashTask = async () => { if (await askConfirm({ title: 'Move this task to the trash?', body: 'Its subtasks go too. You can restore them from Archive.', confirmLabel: 'Move to trash', danger: true })) setArchive({ deleted_at: new Date().toISOString() }, true) }

  // People who worked on it: assignees plus anyone who logged time.
  const workers = [...new Set([...assignees, ...logged.map(l => l.user_id)])]
    .map(id => ({ id, minutes: logged.find(l => l.user_id === id)?.minutes ?? 0 }))
  const finished = isDone(task.status_id) || /review|\bqa\b/i.test(statuses.find(s => s.id === task.status_id)?.name ?? '')
  const canReview = !!task.reviewer_id && !task.archived && (task.reviewer_id === me || lvl >= 4)
    && (task.qa_state === 'pending' || (finished && task.qa_state !== 'approved'))
  async function review(approve: boolean) {
    let note: string | null = null
    if (approve) {
      const r = await askText({ title: `Approve "${task!.title}"?`, label: 'Note for the team (optional)', placeholder: 'e.g. Checked on mobile too', confirmLabel: 'Approve', optional: true })
      if (!r) return
      note = r.value
    } else {
      const r = await askText({ title: 'Send back for changes', label: 'What needs to change?', placeholder: 'e.g. The totals in section 2 are wrong', confirmLabel: 'Send back' })
      if (!r || !r.value.trim()) return
      note = r.value
    }
    const { error } = await supabase.rpc('qa_review', { p_task: taskId, p_approve: approve, p_note: note })
    if (error) { notify(error.message); return }
    notify(approve ? 'Approved' : 'Sent back to the assignees', 'ok')
    await load(); onChanged()
  }

  async function addDependency(e: FormEvent) {
    e.preventDefault()
    const n = Number(depInput.replace(/[^\d]/g, ''))
    if (!n) { notify('Type the number of the task it waits on, for example 42.'); return }
    if (n === task!.number) { notify('A task cannot wait on itself.'); return }
    const { data: other } = await supabase.from('tasks').select('id, title').eq('number', n).maybeSingle()
    if (!other) { notify(`There is no task #${n} that you can see.`); return }
    const { error } = await supabase.from('task_dependencies').insert({ task_id: taskId, blocked_by_id: other.id })
    if (error) { notify(error.code === '23505' ? 'It already waits on that task.' : error.message); return }
    setDepInput(''); await load(); onChanged()
  }
  const depRow = (d: Dep, remove: () => void) => (
    <div key={d.id} className="check-row dep-row">
      <span className={`status-dot ${d.status?.is_done ? 'done' : ''}`} style={{ color: d.status?.color ?? 'var(--faint)' }} title={d.status?.name} aria-hidden />
      <button className={`link sub ${d.status?.is_done ? 'struck' : ''}`} onClick={() => navigate(`/list/${d.list_id}?task=${d.id}`)}>#{d.number} {d.title}</button>
      <span className="muted small">{d.status?.name}</span>
      {canEdit && <button className="icon" aria-label={`Remove link to #${d.number}`} onClick={remove}>×</button>}
    </div>
  )
  const openBlockers = waitingOn.filter(d => !d.status?.is_done && !d.archived)

  const describe = (a: Activity) => {
    const d = a.details as Record<string, string | null>
    switch (a.action) {
      case 'created': return 'created this task'
      case 'archived': return 'archived this task'
      case 'trashed': return 'moved this task to the trash'
      case 'restored': return 'restored this task'
      case 'moved': return `moved this task from ${d.from} to ${d.to}`
      case 'status': return `changed status from ${d.from ?? 'none'} to ${d.to ?? 'none'}`
      case 'priority': return `changed priority from ${d.from} to ${d.to}`
      case 'due_date': return d.to ? `set the due date to ${d.to}` : 'removed the due date'
      case 'title': return `renamed the task`
      case 'blocked_by': return `marked this as waiting on ${d.task}`
      case 'unblocked_by': return `removed the wait on ${d.task}`
      case 'qa_approved': return `approved this task in QA${d.note ? `: "${d.note}"` : ''}`
      case 'qa_changes': return `sent this task back from QA: "${d.note}"`
      case 'assigned': return `assigned ${name(d.user_id)}`
      case 'unassigned': return `unassigned ${name(d.user_id)}`
      default: return a.action
    }
  }
  const timeline = [
    ...activity.map(a => ({ kind: 'a' as const, at: a.created_at, a })),
    ...comments.map(c => ({ kind: 'c' as const, at: c.created_at, c })),
  ].sort((x, y) => x.at.localeCompare(y.at))

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <aside className="panel" onClick={e => e.stopPropagation()} aria-label="Task details">
        {task.archived && <div className="banner">{task.deleted_at ? `In the trash since ${new Date(task.deleted_at).toLocaleDateString()}.` : 'This task is archived.'} It is hidden from lists and boards.</div>}
        <div className="panel-top">
          <span className="muted small">#{task.number}{task.parent_task_id && <> · <button className="link" onClick={() => onOpen(task.parent_task_id!)}>parent task</button></>}</span>
          <div className="row">
            <button onClick={() => run(watching
              ? supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', me)
              : supabase.from('task_watchers').insert({ task_id: taskId }))}>
              {watching ? <><BellRing size={14} aria-hidden />Watching</> : <><Bell size={14} aria-hidden />Watch</>} · {watchers.length}
            </button>
            {canEdit && !task.archived && <button onClick={moveTask} title="Move to another space, folder or list"><FolderInput size={14} aria-hidden />Move</button>}
            {canEdit && !task.archived && <button onClick={() => setArchive({ archived: true }, true)} title="Hide from views, keep everything">Archive</button>}
            {canEdit && task.archived && <button onClick={() => setArchive({ archived: false }, false)}>Restore</button>}
            {!task.deleted_at && canEdit && <button className="danger-link" onClick={trashTask}>Delete</button>}
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        {canEdit
          ? <input className="panel-title" defaultValue={task.title} key={task.title} onBlur={e => e.target.value.trim() && e.target.value.trim() !== task.title && patch({ title: e.target.value.trim() })} />
          : <h2 className="panel-title">{task.title}</h2>}

        <div className="fields">
          <label>Status
            <select disabled={!canEdit} value={task.status_id ?? ''} onChange={e => patch({ status_id: e.target.value })}>
              {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Priority
            <select disabled={!canEdit} value={task.priority} className={`prio-${task.priority}`} onChange={e => patch({ priority: e.target.value })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Start<input type="date" disabled={!canEdit} value={task.start_date ?? ''} onChange={e => patch({ start_date: e.target.value || null })} /></label>
          <label>Due<input type="date" disabled={!canEdit} value={task.due_date ?? ''} onChange={e => patch({ due_date: e.target.value || null })} /></label>
          <label>Estimate (hours)
            <input type="number" min="0" step="0.25" disabled={!canEdit} key={`est-${task.time_estimate_minutes}`}
              defaultValue={task.time_estimate_minutes != null ? task.time_estimate_minutes / 60 : ''}
              onBlur={e => { const v = e.target.value; const m = v === '' ? null : Math.round(Number(v) * 60); if (m !== task.time_estimate_minutes) patch({ time_estimate_minutes: m }) }} />
          </label>
          <label>QA / reviewer
            <select disabled={!canEdit} value={task.reviewer_id ?? ''} onChange={e => patch({ reviewer_id: e.target.value || null })}>
              <option value="">No reviewer</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Tags
            <input disabled={!canEdit} key={`tags-${task.tags.join(',')}`} defaultValue={task.tags.join(', ')} placeholder="design, urgent"
              onBlur={e => { const tags = e.target.value.split(',').map(x => x.trim()).filter(Boolean); if (tags.join(',') !== task.tags.join(',')) patch({ tags }) }} />
          </label>
        </div>

        <section className="work-qa" aria-label="Work and QA">
          <h4><ShieldCheck size={15} aria-hidden />Work &amp; QA</h4>
          <dl>
            <dt>Worked on by</dt>
            <dd>{workers.length ? workers.map(w => (
              <span key={w.id} className="chip"><Avatar id={w.id} name={name(w.id)} size={20} />{name(w.id)}{w.minutes > 0 && <span className="muted small">{fmtMinutes(w.minutes)}</span>}</span>
            )) : <span className="muted">Nobody assigned or tracking time yet</span>}</dd>
            <dt>Finished by</dt>
            <dd>{task.completed_by ? <span className="chip"><Avatar id={task.completed_by} name={name(task.completed_by)} size={20} />{name(task.completed_by)}
              {task.completed_at && <span className="muted small">{new Date(task.completed_at).toLocaleDateString()}</span>}</span>
              : <span className="muted">Not finished yet</span>}</dd>
            <dt>QA</dt>
            <dd>
              {!task.reviewer_id ? <span className="muted">No QA reviewer. Pick one above.</span> : <>
                <span className="chip"><Avatar id={task.reviewer_id} name={name(task.reviewer_id)} size={20} />{name(task.reviewer_id)}</span>
                <span className={`qa-pill ${task.qa_state ?? 'none'}`}>{task.qa_state ? QA_LABEL[task.qa_state] : 'Not ready for QA yet'}</span>
                {task.qa_by && task.qa_at && task.qa_state !== 'pending' && <span className="muted small">by {name(task.qa_by)} · {new Date(task.qa_at).toLocaleDateString()}</span>}
              </>}
              {task.rework_count > 0 && <span className="muted small">Sent back {task.rework_count} {task.rework_count === 1 ? 'time' : 'times'}</span>}
            </dd>
            {task.qa_state === 'changes' && task.qa_note && <><dt>What to fix</dt><dd className="qa-note">{task.qa_note}</dd></>}
          </dl>
          {canReview && (
            <div className="row">
              <button className="primary" onClick={() => review(true)}><Check size={15} aria-hidden />Approve</button>
              <button onClick={() => review(false)}><Undo2 size={15} aria-hidden />Send back</button>
              {task.qa_state !== 'pending' && <span className="muted small">You can review it now, or wait until it is moved to Review.</span>}
            </div>
          )}
        </section>

        <section>
          <h4>Assignees</h4>
          <div className="row">
            {assignees.map(uid => (
              <span key={uid} className="chip"><Avatar name={name(uid)} id={uid} size={20} /> {name(uid)}
                {canEdit && <button className="icon" onClick={() => run(supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', uid))}>×</button>}
              </span>
            ))}
            {canEdit && (
              <select value="" onChange={e => e.target.value && run(supabase.from('task_assignees').insert({ task_id: taskId, user_id: e.target.value }))}>
                <option value="">+ Assign</option>
                {people.filter(p => !assignees.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </section>

        <section>
          <h4>Description</h4>
          <RichEditor value={task.description} canEdit={canEdit} onSave={v => patch({ description: v })} />
        </section>

        {!task.parent_task_id && (
          <section>
            <h4>Subtasks {subs.length > 0 && <span className="muted small">{subs.filter(s => isDone(s.status_id)).length}/{subs.length}</span>}</h4>
            {subs.map(s => (
              <div key={s.id} className="check-row">
                <input type="checkbox" disabled={!canEdit} checked={isDone(s.status_id)}
                  onChange={e => run(supabase.from('tasks').update({ status_id: e.target.checked ? doneStatus?.id : firstStatus?.id }).eq('id', s.id))} />
                <button className={`link sub ${isDone(s.status_id) ? 'struck' : ''}`} onClick={() => onOpen(s.id)}>{s.title}</button>
              </div>
            ))}
            {canEdit && <form onSubmit={addSub}><input className="inline-add" placeholder="+ Add subtask" value={newSub} onChange={e => setNewSub(e.target.value)} /></form>}
          </section>
        )}

        <section>
          <h4>Dependencies {openBlockers.length > 0 && <span className="pill danger-pill">Blocked by {openBlockers.length}</span>}</h4>
          {waitingOn.length > 0 && <div className="muted small">Waiting on</div>}
          {waitingOn.map(d => depRow(d, () => run(supabase.from('task_dependencies').delete().eq('task_id', taskId).eq('blocked_by_id', d.id))))}
          {blocking.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>Blocking</div>}
          {blocking.map(d => depRow(d, () => run(supabase.from('task_dependencies').delete().eq('task_id', d.id).eq('blocked_by_id', taskId))))}
          {canEdit && (
            <form onSubmit={addDependency} className="row dep-add">
              <input className="inline-add" inputMode="numeric" placeholder="+ Waits on task #…" aria-label="Number of the task this one waits on" value={depInput} onChange={e => setDepInput(e.target.value)} />
              {depInput.trim() && <button className="btn small">Add</button>}
            </form>
          )}
          {!canEdit && !waitingOn.length && !blocking.length && <span className="muted small">None</span>}
        </section>

        <section>
          <h4>Checklist {checks.length > 0 && <span className="muted small">{checks.filter(c => c.done).length}/{checks.length}</span>}</h4>
          {checks.map(c => (
            <div key={c.id} className="check-row">
              <input type="checkbox" disabled={!canEdit} checked={c.done} onChange={e => run(supabase.from('checklist_items').update({ done: e.target.checked }).eq('id', c.id))} />
              <span className={c.done ? 'struck' : ''}>{c.title}</span>
              {canEdit && <button className="icon" onClick={() => run(supabase.from('checklist_items').delete().eq('id', c.id))}>×</button>}
            </div>
          ))}
          {canEdit && <form onSubmit={addCheck}><input className="inline-add" placeholder="+ Add item" value={newCheck} onChange={e => setNewCheck(e.target.value)} /></form>}
        </section>

        <TimeSection taskId={taskId} me={me} canEdit={canEdit} canManage={lvl >= 4} estimate={task.time_estimate_minutes} name={uid => name(uid)} />

        <section>
          <h4>Files</h4>
          {files.map(f => (
            <div key={f.id} className="check-row">
              <button className="link" onClick={() => openFile(f)}><Paperclip size={13} aria-hidden />{f.file_name}</button>
              <span className="muted small">{(f.size_bytes / 1024).toFixed(0)} KB</span>
              {(f.uploaded_by === me || lvl >= 4) && <button className="icon" onClick={() => removeFile(f)}>×</button>}
            </div>
          ))}
          {canEdit && (
            <label className="upload">{uploading ? 'Uploading…' : '+ Attach file (max 10 MB, photos are shrunk)'}
              <input type="file" hidden disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
            </label>
          )}
        </section>

        <section>
          <h4>Activity</h4>
          <div className="timeline">
            {timeline.map(item => item.kind === 'a' ? (
              <div key={`a${item.a.id}`} className="activity muted small"><b>{name(item.a.user_id)}</b> {describe(item.a)} · {ago(item.a.created_at)}</div>
            ) : (
              <div key={item.c.id} className={`comment ${item.c.assigned_to && !item.c.resolved ? 'assigned' : ''}`}>
                <div className="comment-head">
                  <Avatar name={name(item.c.user_id)} id={item.c.user_id} size={22} /><b>{name(item.c.user_id)}</b>
                  <span className="muted small">{ago(item.c.created_at)}</span>
                  {item.c.assigned_to && (
                    <span className="pill">{item.c.resolved ? 'Resolved' : `assigned to ${name(item.c.assigned_to)}`}</span>
                  )}
                </div>
                <div className="pre">{renderMentions(item.c.body, me)}</div>
                <div className="row reactions">
                  {EMOJIS.map(em => {
                    const n = item.c.comment_reactions.filter(r => r.emoji === em).length
                    const mine = item.c.comment_reactions.some(r => r.emoji === em && r.user_id === me)
                    return (n > 0 || canComment) && (
                      <button key={em} className={`react ${mine ? 'on' : ''}`} disabled={!canComment} onClick={() => react(item.c, em)}>{em}{n > 0 && ` ${n}`}</button>
                    )
                  })}
                  {item.c.assigned_to && !item.c.resolved && (item.c.assigned_to === me || canEdit) &&
                    <button className="link" onClick={() => run(supabase.from('comments').update({ resolved: true }).eq('id', item.c.id))}>Resolve</button>}
                  {(item.c.user_id === me || lvl >= 4) &&
                    <button className="danger-link small" onClick={async () => { if (await askConfirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) run(supabase.from('comments').delete().eq('id', item.c.id)) }}>Delete</button>}
                </div>
              </div>
            ))}
          </div>
          {canComment && (
            <form className="comment-box" onSubmit={postComment}>
              <MentionTextarea placeholder="Write a comment… type @ to mention someone" value={body} onChange={setBody} people={people} onPick={p => setPicked(x => x.some(y => y.id === p.id) ? x : [...x, p])} />
              <div className="row">
                <select value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                  <option value="">Not assigned</option>
                  {people.map(p => <option key={p.id} value={p.id}>Assign to {p.name}</option>)}
                </select>
                <button className="primary" disabled={!body.trim()}>Comment</button>
              </div>
            </form>
          )}
        </section>
      </aside>
    </div>
  )
}
