import { useMemo, useState, type DragEvent } from 'react'
import type { Status, Task } from '../lib/listData'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function CalendarView({ tasks, statuses, canEdit, onOpen, onMove }: {
  tasks: Task[]; statuses: Status[]; canEdit: boolean
  onOpen: (id: string) => void; onMove: (id: string, due: string | null) => void
}) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [over, setOver] = useState<string | null>(null)
  const today = iso(new Date())

  const days = useMemo(() => {
    const start = new Date(month)
    start.setDate(1 - ((month.getDay() + 6) % 7)) // back to Monday
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [month])

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) if (t.due_date) { const a = m.get(t.due_date) ?? []; a.push(t); m.set(t.due_date, a) }
    return m
  }, [tasks])
  const undated = tasks.filter(t => !t.due_date && !statuses.find(s => s.id === t.status_id)?.is_done)
  const status = (id: string | null) => statuses.find(s => s.id === id)

  function drop(e: DragEvent, day: string | null) {
    e.preventDefault(); setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id && canEdit) onMove(id, day)
  }
  const chip = (t: Task) => {
    const st = status(t.status_id)
    return (
      <div key={t.id} className={`cal-task ${st?.is_done ? 'done' : t.due_date && t.due_date < today ? 'overdue' : ''}`} style={{ borderLeftColor: st?.color }}
        draggable={canEdit} onDragStart={e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
        onClick={() => onOpen(t.id)} title={`${t.title}${st ? ` (${st.name})` : ''}`}>
        {t.title}
      </div>
    )
  }
  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="cal-wrap">
      <div className="cal">
        <div className="cal-head">
          <div className="row">
            <button onClick={() => shift(-1)} title="Previous month">‹</button>
            <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)) }}>Today</button>
            <button onClick={() => shift(1)} title="Next month">›</button>
          </div>
          <b>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        </div>
        <div className="cal-grid">
          {WEEKDAYS.map(w => <div key={w} className="cal-dow">{w}</div>)}
          {days.map(d => {
            const k = iso(d), list = byDay.get(k) ?? []
            return (
              <div key={k} className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${k === today ? 'today' : ''} ${over === k ? 'over' : ''}`}
                onDragOver={e => { if (canEdit) { e.preventDefault(); setOver(k) } }} onDragLeave={() => setOver(o => o === k ? null : o)}
                onDrop={e => drop(e, k)}>
                <div className="cal-date">{d.getDate()}</div>
                {list.slice(0, 4).map(chip)}
                {list.length > 4 && <div className="muted small" title={list.slice(4).map(t => t.title).join('\n')}>+{list.length - 4} more</div>}
              </div>
            )
          })}
        </div>
      </div>
      <aside className={`cal-undated ${over === 'none' ? 'over' : ''}`}
        onDragOver={e => { if (canEdit) { e.preventDefault(); setOver('none') } }} onDragLeave={() => setOver(o => o === 'none' ? null : o)}
        onDrop={e => drop(e, null)}>
        <h4>No due date <span className="muted small">{undated.length}</span></h4>
        {canEdit && <p className="muted small">Drag a task onto a day to schedule it, or back here to clear its date.</p>}
        {undated.map(chip)}
      </aside>
    </div>
  )
}
