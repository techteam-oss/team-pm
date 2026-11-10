import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/workspace'
import { PRIORITIES, type Status } from '../lib/listData'
import Avatar from './Avatar'
import TimeSection from './TimeSection'

type Full = {
  id: string; number: number; list_id: string; title: string; description: string | null; status_id: string | null
  priority: string; start_date: string | null; due_date: string | null; time_estimate_minutes: number | null
  tags: string[]; parent_task_id: string | null; created_by: string | null; created_at: string
}
type Sub = { id: string; number: number; title: string; status_id: string | null }
type Check = { id: string; title: string; done: boolean; position: number }
type Comment = { id: string; user_id: string; body: string; assigned_to: string | null; resolved: boolean; created_at: string; comment_reactions: { user_id: string; emoji: string }[] }
type Activity = { id: number; user_id: string | null; action: string; details: Record<string, unknown>; created_at: string }
type Attachment = { id: string; storage_path: string; file_name: string; size_bytes: number; uploaded_by: string }

const EMOJIS = ['👍', '❤️', '🎉', '✅']

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function TaskPanel({ taskId, spaceId, statuses, onClose, onChanged, onOpen }: {
  taskId: string; spaceId: string; statuses: Status[]
  onClose: () => void; onChanged: () => void; onOpen: (id: string) => void
}) {
  const { session } = useAuth()
  const me = session!.user.id
  const { people, level } = useWorkspace()
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
  const [assignTo, setAssignTo] = useState('')
  const [uploading, setUploading] = useState(false)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    const { data: t } = await supabase.from('tasks')
      .select('id, number, list_id, title, description, status_id, priority, start_date, due_date, time_estimate_minutes, tags, parent_task_id, created_by, created_at')
      .eq('id', taskId).maybeSingle()
    if (!t) { setMissing(true); return }
    setTask(t)
    const [a, w, s, c, cm, ac, f] = await Promise.all([
      supabase.from('task_assignees').select('user_id').eq('task_id', taskId),
      supabase.from('task_watchers').select('user_id').eq('task_id', taskId),
      supabase.from('tasks').select('id, number, title, status_id').eq('parent_task_id', taskId).order('position').order('created_at'),
      supabase.from('checklist_items').select('id, title, done, position').eq('task_id', taskId).order('position').order('created_at'),
      supabase.from('comments').select('id, user_id, body, assigned_to, resolved, created_at, comment_reactions(user_id, emoji)').eq('task_id', taskId).order('created_at'),
      supabase.from('activity_log').select('id, user_id, action, details, created_at').eq('task_id', taskId).order('created_at'),
      supabase.from('attachments').select('id, storage_path, file_name, size_bytes, uploaded_by').eq('task_id', taskId).order('created_at'),
    ])
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
    if (error) alert(error.message)
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
    await run(supabase.from('comments').insert({ task_id: taskId, body: body.trim(), assigned_to: assignTo || null }))
    setBody(''); setAssignTo('')
  }
  async function react(c: Comment, emoji: string) {
    const mine = c.comment_reactions.some(r => r.user_id === me && r.emoji === emoji)
    await run(mine
      ? supabase.from('comment_reactions').delete().eq('comment_id', c.id).eq('user_id', me).eq('emoji', emoji)
      : supabase.from('comment_reactions').insert({ comment_id: c.id, emoji }))
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) { alert('Files can be up to 10 MB.'); return }
    setUploading(true)
    const path = `${spaceId}/${taskId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type })
    if (error) { alert(error.message); setUploading(false); return }
    await run(supabase.from('attachments').insert({ task_id: taskId, storage_path: path, file_name: file.name, size_bytes: file.size, mime_type: file.type }))
    setUploading(false)
  }
  async function openFile(a: Attachment) {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 300)
    if (error) alert(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function removeFile(a: Attachment) {
    if (!confirm(`Delete ${a.file_name}?`)) return
    await supabase.storage.from('attachments').remove([a.storage_path])
    await run(supabase.from('attachments').delete().eq('id', a.id))
  }
  async function deleteTask() {
    if (!confirm('Delete this task and its subtasks?')) return
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) alert(error.message); else { onChanged(); onClose() }
  }

  const describe = (a: Activity) => {
    const d = a.details as Record<string, string | null>
    switch (a.action) {
      case 'created': return 'created this task'
      case 'status': return `changed status from ${d.from ?? 'none'} to ${d.to ?? 'none'}`
      case 'priority': return `changed priority from ${d.from} to ${d.to}`
      case 'due_date': return d.to ? `set the due date to ${d.to}` : 'removed the due date'
      case 'title': return `renamed the task`
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
        <div className="panel-top">
          <span className="muted small">#{task.number}{task.parent_task_id && <> · <button className="link" onClick={() => onOpen(task.parent_task_id!)}>parent task</button></>}</span>
          <div className="row">
            <button onClick={() => run(watching
              ? supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', me)
              : supabase.from('task_watchers').insert({ task_id: taskId }))}>
              {watching ? '👁 Watching' : '👁 Watch'} · {watchers.length}
            </button>
            {(lvl >= 4 || (canEdit && task.created_by === me)) && <button className="danger-link" onClick={deleteTask}>Delete</button>}
            <button onClick={onClose} aria-label="Close">✕</button>
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
          <label>Tags
            <input disabled={!canEdit} key={`tags-${task.tags.join(',')}`} defaultValue={task.tags.join(', ')} placeholder="design, client"
              onBlur={e => { const tags = e.target.value.split(',').map(x => x.trim()).filter(Boolean); if (tags.join(',') !== task.tags.join(',')) patch({ tags }) }} />
          </label>
        </div>

        <section>
          <h4>Assignees</h4>
          <div className="row">
            {assignees.map(uid => (
              <span key={uid} className="chip"><Avatar name={name(uid)} size={20} /> {name(uid)}
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
          {canEdit
            ? <textarea rows={4} key={`d-${task.description}`} defaultValue={task.description ?? ''} placeholder="Add details…"
                onBlur={e => (e.target.value || null) !== task.description && patch({ description: e.target.value || null })} />
            : <p className="pre">{task.description || <span className="muted">No description</span>}</p>}
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
              <button className="link" onClick={() => openFile(f)}>📎 {f.file_name}</button>
              <span className="muted small">{(f.size_bytes / 1024).toFixed(0)} KB</span>
              {(f.uploaded_by === me || lvl >= 4) && <button className="icon" onClick={() => removeFile(f)}>×</button>}
            </div>
          ))}
          {canEdit && (
            <label className="upload">{uploading ? 'Uploading…' : '+ Attach file (max 10 MB)'}
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
                  <Avatar name={name(item.c.user_id)} size={22} /><b>{name(item.c.user_id)}</b>
                  <span className="muted small">{ago(item.c.created_at)}</span>
                  {item.c.assigned_to && (
                    <span className="pill">{item.c.resolved ? '✓ resolved' : `assigned to ${name(item.c.assigned_to)}`}</span>
                  )}
                </div>
                <div className="pre">{item.c.body}</div>
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
                    <button className="danger-link small" onClick={() => confirm('Delete comment?') && run(supabase.from('comments').delete().eq('id', item.c.id))}>Delete</button>}
                </div>
              </div>
            ))}
          </div>
          {canComment && (
            <form className="comment-box" onSubmit={postComment}>
              <textarea rows={3} placeholder="Write a comment…" value={body} onChange={e => setBody(e.target.value)} />
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
