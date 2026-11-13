import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlarmClock, AtSign, Bell, CalendarClock, CheckCheck, CircleCheck, MessageSquare, MessageSquareReply, MessagesSquare, ShieldCheck, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type N = { id: number; kind: string; message: string; read_at: string | null; created_at: string; task_id: string | null; task: { list_id: string } | null
  data: { path?: string; blocking?: boolean } | null }

export const KIND_ICON: Record<string, typeof Bell> = {
  mention: AtSign, comment: MessageSquare, comment_assigned: MessageSquare, assigned: UserPlus, qa_review: ShieldCheck,
  ready_for_qa: ShieldCheck, completed: CircleCheck, estimate_exceeded: AlarmClock, due_today: CalendarClock, overdue: CalendarClock,
  feedback: MessagesSquare, feedback_update: MessageSquareReply,
}
const URGENT = new Set(['estimate_exceeded', 'overdue'])

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Bell in the top bar: live in-app notifications for the signed-in person. */
export default function NotificationBell() {
  const { session } = useAuth()
  const me = session!.user.id
  const [items, setItems] = useState<N[]>([])
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications')
      .select('id, kind, message, read_at, created_at, task_id, data, task:tasks(list_id)')
      .eq('user_id', me).order('created_at', { ascending: false }).limit(50)
    setItems((data ?? []) as unknown as N[])
  }, [me])

  useEffect(() => {
    load()
    const ch = supabase.channel(`notif-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me, load])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const unread = items.filter(n => !n.read_at).length
  const shown = onlyUnread ? items.filter(n => !n.read_at) : items

  async function markAll() {
    const now = new Date().toISOString()
    setItems(xs => xs.map(x => x.read_at ? x : { ...x, read_at: now }))
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', me).is('read_at', null)
  }
  async function openItem(n: N) {
    setOpen(false)
    if (!n.read_at) {
      const now = new Date().toISOString()
      setItems(xs => xs.map(x => x.id === n.id ? { ...x, read_at: now } : x))
      await supabase.from('notifications').update({ read_at: now }).eq('id', n.id)
    }
    if (n.task?.list_id && n.task_id) navigate(`/list/${n.task.list_id}?task=${n.task_id}`)
    else if (n.data?.path?.startsWith('#/')) navigate(n.data.path.slice(1))
  }

  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn bell-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications"
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}>
        <Bell size={18} />
        {unread > 0 && <span className="bell-count" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <b>Notifications</b>
            <div className="segmented small">
              <button className={!onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(false)}>All</button>
              <button className={onlyUnread ? 'on' : ''} onClick={() => setOnlyUnread(true)}>Unread{unread ? ` ${unread}` : ''}</button>
            </div>
            <span className="tb-spacer" />
            {unread > 0 && <button className="btn ghost small" onClick={markAll}><CheckCheck size={14} aria-hidden />Mark all read</button>}
          </div>
          {shown.length === 0 ? (
            <div className="notif-empty"><Bell size={20} aria-hidden /><div>{onlyUnread ? "You're all caught up." : 'No notifications yet.'}</div>
              <div className="muted small">Mentions, assignments, QA requests, time alerts and feedback replies show up here.</div></div>
          ) : (
            <ul className="notif-list">
              {shown.map(n => {
                const Icon = KIND_ICON[n.kind] ?? Bell
                return (
                  <li key={n.id}>
                    <button className={`notif-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                      <span className={`notif-ic ${URGENT.has(n.kind) || n.data?.blocking ? 'urgent' : ''}`}><Icon size={15} aria-hidden /></span>
                      <span className="notif-body"><span className="notif-msg">{n.message}</span><span className="muted small">{ago(n.created_at)}</span></span>
                      {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
