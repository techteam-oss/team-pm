import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bug, HelpCircle, Lightbulb, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'
import { isEmbedded, isInstalled } from '../lib/embed'
import { notify } from './Dialogs'

const KINDS = [
  { key: 'bug', label: 'Problem', icon: Bug, hint: 'What did you try, and what happened instead?' },
  { key: 'idea', label: 'Idea', icon: Lightbulb, hint: 'What would make your day easier?' },
  { key: 'question', label: 'Question', icon: HelpCircle, hint: 'What are you not sure about?' },
] as const

/** "Send feedback": goes to the admins (bell + email) and shows on the Feedback page. */
export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { workspace } = useWorkspace()
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('bug')
  const [message, setMessage] = useState('')
  const [blocking, setBlocking] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!workspace || message.trim().length < 3) return
    setBusy(true)
    const where = isInstalled() ? 'home-screen app' : isEmbedded() ? 'inside GHL page' : 'browser'
    const device = `${navigator.userAgent.slice(0, 380)} · ${window.innerWidth}x${window.innerHeight} · ${where}`
    const { error } = await supabase.from('feedback').insert({
      workspace_id: workspace.id, kind, message: message.trim(), blocking: kind === 'bug' && blocking,
      page: window.location.hash.replace(/^#/, '').slice(0, 500) || '/', device,
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(blocking ? 'Sent. The admins have been told you are blocked.' : 'Thanks! Your feedback went to the admins.', 'ok')
    onClose()
  }

  const k = KINDS.find(x => x.key === kind)!
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="fb-title" onSubmit={send}>
        <div className="modal-head">
          <h2 id="fb-title">Send feedback</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="segmented fb-kinds" role="radiogroup" aria-label="Type of feedback">
          {KINDS.map(x => (
            <button key={x.key} type="button" role="radio" aria-checked={kind === x.key} className={kind === x.key ? 'on' : ''} onClick={() => setKind(x.key)}>
              <x.icon size={15} aria-hidden />{x.label}
            </button>
          ))}
        </div>
        <label className="field">Tell us more
          <textarea ref={ref} rows={5} maxLength={4000} required placeholder={k.hint} value={message} onChange={e => setMessage(e.target.value)} />
        </label>
        {kind === 'bug' && (
          <label className="switch-row">
            <input type="checkbox" checked={blocking} onChange={e => setBlocking(e.target.checked)} />
            <span><b>This is stopping me from working</b><span className="muted small"> Admins are alerted straight away.</span></span>
          </label>
        )}
        <p className="muted small" style={{ margin: 0 }}>We add the page you are on and your device type, so we can find the problem. Admins reply on the Feedback page and you get a notification.</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || message.trim().length < 3}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </div>
  )
}
