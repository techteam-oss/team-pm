import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bug, HelpCircle, Lightbulb, MessageSquarePlus, OctagonAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import Avatar from '../components/Avatar'
import FeedbackDialog from '../components/FeedbackDialog'
import { ago } from '../components/NotificationBell'
import { notify } from '../components/Dialogs'

type Item = { id: number; user_id: string | null; kind: 'bug' | 'idea' | 'question'; blocking: boolean; message: string; page: string | null
  device: string | null; status: 'new' | 'planned' | 'done' | 'wont_do'; admin_note: string | null; created_at: string; updated_at: string }
const KIND = { bug: { label: 'Problem', icon: Bug }, idea: { label: 'Idea', icon: Lightbulb }, question: { label: 'Question', icon: HelpCircle } }
const STATUS: Record<Item['status'], string> = { new: 'New', planned: 'Planned', done: 'Done', wont_do: "Won't do" }
type Tab = 'open' | 'closed' | 'all'

/** Admins: everything the team reported, with a status and a reply. Everyone else: what they sent and the replies. */
export default function Feedback() {
  const { workspace, role, people } = useWorkspace()
  const admin = isAdmin(role)
  const [params] = useSearchParams()
  const focus = Number(params.get('id')) || null
  const [items, setItems] = useState<Item[] | null>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [writing, setWriting] = useState(false)

  async function load() {
    if (!workspace) return
    const { data, error } = await supabase.from('feedback')
      .select('id, user_id, kind, blocking, message, page, device, status, admin_note, created_at, updated_at')
      .eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(300)
    if (error) notify(error.message)
    setItems((data ?? []) as Item[])
  }
  useEffect(() => { load() }, [workspace?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus || !items) return
    const it = items.find(i => i.id === focus)
    if (it && (it.status === 'done' || it.status === 'wont_do')) setTab('all')
    requestAnimationFrame(() => document.getElementById(`fb-${focus}`)?.scrollIntoView({ block: 'center' }))
  }, [focus, items])

  async function save(it: Item, patch: Partial<Pick<Item, 'status' | 'admin_note'>>) {
    const { error } = await supabase.from('feedback').update(patch).eq('id', it.id)
    if (error) { notify(error.message); return }
    setItems(xs => xs?.map(x => x.id === it.id ? { ...x, ...patch } : x) ?? null)
    if ('admin_note' in patch) { setNotes(n => { const c = { ...n }; delete c[it.id]; return c }); notify('Reply saved. They have been notified.', 'ok') }
  }

  const name = (id: string | null) => people.find(p => p.id === id)?.name ?? (id ? 'Former member' : 'Someone')
  const shown = (items ?? []).filter(i => tab === 'all' || (tab === 'open' ? i.status === 'new' || i.status === 'planned' : i.status === 'done' || i.status === 'wont_do'))
  const count = (t: Tab) => (items ?? []).filter(i => t === 'all' || (t === 'open' ? i.status === 'new' || i.status === 'planned' : i.status === 'done' || i.status === 'wont_do')).length

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 860 }}>
      <div className="page-head">
        <div className="page-title">
          <h1>{admin ? 'Feedback' : 'Your feedback'}</h1>
          <p className="muted small">{admin ? 'Problems, ideas and questions from the team. Set a status or reply, and the person is notified.' : 'What you sent the admins, and their replies.'}</p>
        </div>
        <button className="primary" onClick={() => setWriting(true)}><MessageSquarePlus size={15} aria-hidden />Send feedback</button>
      </div>
      <div className="segmented" role="tablist" aria-label="Show" style={{ alignSelf: 'flex-start' }}>
        {(['open', 'closed', 'all'] as Tab[]).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'open' ? 'Open' : t === 'closed' ? 'Closed' : 'All'} <span className="count">{count(t)}</span>
          </button>
        ))}
      </div>
      {items === null ? <p className="muted">Loading…</p> : shown.length === 0 ? (
        <div className="card"><div className="empty-state"><span className="ic"><MessageSquarePlus size={20} aria-hidden /></span>
          <h3>{tab === 'open' ? 'Nothing open' : 'Nothing here yet'}</h3>
          <p>{admin ? 'Feedback from the team shows up here, and you get a notification for each one.' : 'Found a problem or have an idea? Send it and an admin will reply here.'}</p></div></div>
      ) : shown.map(it => {
        const K = KIND[it.kind]
        const draft = notes[it.id]
        return (
          <article key={it.id} id={`fb-${it.id}`} className={`card fb-item ${focus === it.id ? 'focus' : ''}`}>
            <div className="fb-head">
              <span className={`fb-kind ${it.kind}`}><K.icon size={14} aria-hidden />{K.label}</span>
              {it.blocking && <span className="pill danger"><OctagonAlert size={12} aria-hidden />Blocked</span>}
              <span className={`pill fb-status ${it.status}`}>{STATUS[it.status]}</span>
              <span className="spacer" />
              <span className="muted small" title={new Date(it.created_at).toLocaleString()}>{ago(it.created_at)}</span>
            </div>
            {admin && <div className="row" style={{ gap: 8 }}><Avatar id={it.user_id ?? ''} name={name(it.user_id)} size={22} /><b>{name(it.user_id)}</b></div>}
            <p className="fb-message">{it.message}</p>
            {admin && (it.page || it.device) && (
              <details className="fb-meta muted small">
                <summary>Where it happened</summary>
                {it.page && <div>Page: <a href={`#${it.page}`}>{it.page}</a></div>}
                {it.device && <div>Device: {it.device}</div>}
              </details>
            )}
            {!admin && it.admin_note && <div className="fb-reply"><b>Reply</b><p>{it.admin_note}</p></div>}
            {admin && (
              <div className="fb-admin">
                <label className="fb-status-pick">Status
                  <select value={it.status} onChange={e => save(it, { status: e.target.value as Item['status'] })}>
                    {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="fb-note">Reply to {name(it.user_id).split(' ')[0]}
                  <textarea rows={2} maxLength={2000} placeholder="Optional. They see this in a notification and email."
                    value={draft ?? it.admin_note ?? ''} onChange={e => setNotes(n => ({ ...n, [it.id]: e.target.value }))} />
                </label>
                {draft !== undefined && draft !== (it.admin_note ?? '') && (
                  <div className="row"><button className="btn primary small" onClick={() => save(it, { admin_note: draft.trim() || null })}>Save reply</button>
                    <button className="btn ghost small" onClick={() => setNotes(n => { const c = { ...n }; delete c[it.id]; return c })}>Cancel</button></div>
                )}
              </div>
            )}
          </article>
        )
      })}
      {writing && <FeedbackDialog onClose={() => { setWriting(false); load() }} />}
    </div>
  )
}
