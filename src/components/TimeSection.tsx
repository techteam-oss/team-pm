import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fmtClock, fmtMinutes, parseDuration, useNow, useTimer } from '../lib/time'
import { askConfirm, notify } from './Dialogs'
import { Play, Square, Timer } from 'lucide-react'

type Entry = { id: string; user_id: string; started_at: string; ended_at: string | null; note: string | null }

export default function TimeSection({ taskId, me, canEdit, canManage, estimate, name }: {
  taskId: string; me: string; canEdit: boolean; canManage: boolean; estimate: number | null; name: (uid: string) => string
}) {
  const { running, start, stop } = useTimer()
  const [entries, setEntries] = useState<Entry[]>([])
  const [dur, setDur] = useState('')
  const [day, setDay] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const mineHere = running?.task_id === taskId
  const now = useNow(entries.some(e => !e.ended_at))

  const load = useCallback(async () => {
    const { data } = await supabase.from('time_entries').select('id, user_id, started_at, ended_at, note')
      .eq('task_id', taskId).order('started_at', { ascending: false })
    setEntries(data ?? [])
  }, [taskId])

  useEffect(() => {
    load()
    const ch = supabase.channel(`time-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `task_id=eq.${taskId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [taskId, load])

  const mins = (e: Entry) => ((e.ended_at ? new Date(e.ended_at).getTime() : now) - new Date(e.started_at).getTime()) / 60000
  const total = entries.reduce((s, e) => s + mins(e), 0)
  const pct = estimate ? Math.min(100, (total / estimate) * 100) : 0

  async function addManual(ev: FormEvent) {
    ev.preventDefault()
    const m = parseDuration(dur)
    if (!m || m <= 0 || m > 24 * 60) { notify('Enter a duration like 1h 30m, 45m or 1:15 (max 24h).'); return }
    const [y, mo, d] = day.split('-').map(Number)
    const startAt = new Date(y, mo - 1, d, 9, 0, 0)
    const { error } = await supabase.from('time_entries').insert({
      task_id: taskId, started_at: startAt.toISOString(), ended_at: new Date(startAt.getTime() + m * 60000).toISOString(), note: note.trim() || null,
    })
    if (error) notify(error.message); else { setDur(''); setNote(''); setOpen(false); load() }
  }
  async function remove(id: string) {
    if (!await askConfirm({ title: 'Delete this time entry?', confirmLabel: 'Delete', danger: true })) return
    const { error } = await supabase.from('time_entries').delete().eq('id', id)
    if (error) notify(error.message); else load()
  }

  return (
    <section>
      <h4>Time tracked <span className="muted small">{fmtMinutes(total)}{estimate ? ` of ${fmtMinutes(estimate)}` : ''}</span></h4>
      {estimate ? <div className="progress"><div style={{ width: `${pct}%` }} className={total > estimate ? 'over' : ''} /></div> : null}
      {canEdit && (
        <div className="row">
          {mineHere
            ? <button className="primary" onClick={stop}><Square size={12} fill="currentColor" aria-hidden />Stop {fmtClock(now - new Date(running!.started_at).getTime())}</button>
            : <button onClick={() => start(taskId)}><Play size={13} fill="currentColor" aria-hidden />Start timer</button>}
          <button onClick={() => setOpen(o => !o)}>+ Add time</button>
        </div>
      )}
      {open && (
        <form className="row wrap" onSubmit={addManual}>
          <input placeholder="1h 30m" value={dur} onChange={e => setDur(e.target.value)} style={{ width: 90 }} autoFocus />
          <input type="date" value={day} onChange={e => setDay(e.target.value)} />
          <input placeholder="Note (optional)" value={note} maxLength={500} onChange={e => setNote(e.target.value)} style={{ flex: 1 }} />
          <button className="primary">Save</button>
        </form>
      )}
      {entries.length > 0 && (
        <ul className="time-list">
          {entries.map(e => (
            <li key={e.id}>
              <span>{name(e.user_id)}</span>
              <span className="muted small">{new Date(e.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span>{e.ended_at ? fmtMinutes(mins(e)) : <b><Timer size={13} aria-hidden /> {fmtClock(now - new Date(e.started_at).getTime())}</b>}</span>
              <span className="muted small grow">{e.note}</span>
              {(e.user_id === me || canManage) && e.ended_at && <button className="icon" title="Delete" onClick={() => remove(e.id)}>×</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
