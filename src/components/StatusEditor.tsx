import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Status, Task } from '../lib/listData'
import { notify } from './Dialogs'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'

const COLORS = ['#9aa1ad', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#f97316', '#14b8a6', '#22c55e', '#ef4444', '#64748b']

export default function StatusEditor({ listId, statuses, tasks, onClose, onChanged }: {
  listId: string; statuses: Status[]; tasks: Task[]; onClose: () => void; onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Status | null>(null)
  const [moveTo, setMoveTo] = useState('')

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    const { error } = await p
    setBusy(false)
    if (error) notify(error.message)
    onChanged()
  }
  const patch = (id: string, fields: Partial<Status>) => run(supabase.from('statuses').update(fields).eq('id', id))

  async function move(i: number, dir: -1 | 1) {
    const a = statuses[i], b = statuses[i + dir]
    if (!a || !b) return
    setBusy(true)
    const r1 = await supabase.from('statuses').update({ position: b.position }).eq('id', a.id)
    const r2 = await supabase.from('statuses').update({ position: a.position }).eq('id', b.id)
    setBusy(false)
    if (r1.error || r2.error) notify((r1.error ?? r2.error)!.message)
    onChanged()
  }

  async function add() {
    const n = name.trim()
    if (!n) return
    setName('')
    // Insert before the first "done" status so new columns land in the working area.
    const i = statuses.findIndex(s => s.is_done)
    const position = i < 0 ? (statuses.at(-1)?.position ?? 0) + 1
      : ((statuses[i - 1]?.position ?? statuses[i].position - 1) + statuses[i].position) / 2
    await run(supabase.from('statuses').insert({ list_id: listId, name: n, color: COLORS[statuses.length % COLORS.length], position, is_done: false }))
  }

  async function confirmRemove() {
    if (!removing) return
    setBusy(true)
    // Move every task (and subtask) off this status first, so nothing ends up without a status.
    const moved = await supabase.from('tasks').update({ status_id: moveTo }).eq('list_id', listId).eq('status_id', removing.id)
    if (moved.error) { setBusy(false); notify(moved.error.message); return }
    const { error } = await supabase.from('statuses').delete().eq('id', removing.id)
    setBusy(false)
    if (error) notify(error.message)
    setRemoving(null); onChanged()
  }

  const usage = (id: string) => tasks.filter(t => t.status_id === id).length

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <aside className="panel" style={{ width: 'min(460px, 100%)' }} onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Statuses for this list</h3>
          <button onClick={onClose} title="Close">×</button>
        </div>
        <p className="muted small">Rename, recolour and reorder the columns. Tick "Done" for statuses that count as finished (they're struck through and count on the dashboard).</p>
        <ul className="status-edit">
          {statuses.map((s, i) => (
            <li key={s.id}>
              <input type="color" value={s.color} onChange={e => patch(s.id, { color: e.target.value })} aria-label="Colour" />
              <input key={s.name} defaultValue={s.name} maxLength={40} aria-label="Status name"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.name) patch(s.id, { name: v }); else e.target.value = s.name }} />
              <label className="tb-check"><input type="checkbox" checked={s.is_done} onChange={e => patch(s.id, { is_done: e.target.checked })} /> Done</label>
              <button className="icon" disabled={busy || i === 0} title="Move up" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
              <button className="icon" disabled={busy || i === statuses.length - 1} title="Move down" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              <button className="icon danger" disabled={busy || statuses.length <= 1} title="Delete" aria-label="Delete status" onClick={() => { setRemoving(s); setMoveTo(statuses.find(x => x.id !== s.id)!.id) }}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={e => { e.preventDefault(); add() }}>
          <input placeholder="New status, e.g. Blocked" value={name} maxLength={40} onChange={e => setName(e.target.value)} />
          <button className="primary" disabled={busy || !name.trim()}>Add</button>
        </form>
        {removing && (
          <div className="card" style={{ padding: 14 }}>
            <b>Delete "{removing.name}"?</b>
            {usage(removing.id) > 0 ? (
              <p className="small">{usage(removing.id)} task{usage(removing.id) === 1 ? ' uses' : 's use'} it. Move them to{' '}
                <select value={moveTo} onChange={e => setMoveTo(e.target.value)}>
                  {statuses.filter(x => x.id !== removing.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </p>
            ) : <p className="small muted">No tasks use it.</p>}
            <div className="row">
              <button className="danger" disabled={busy} onClick={confirmRemove}>Delete status</button>
              <button onClick={() => setRemoving(null)}>Cancel</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
