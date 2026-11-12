import { useEffect, useState, type FormEvent } from 'react'
import { Mail, Send, Webhook } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import { notify } from '../components/Dialogs'

const DEFAULT_APP = 'https://techteam-oss.github.io/team-pm/'

export const EMAIL_KINDS: { kind: string; label: string; on: boolean }[] = [
  { kind: 'mention', label: 'Someone @mentions me', on: true },
  { kind: 'assigned', label: 'I am assigned a task', on: true },
  { kind: 'comment_assigned', label: 'A comment is assigned to me', on: true },
  { kind: 'qa_review', label: 'I am made QA reviewer', on: true },
  { kind: 'ready_for_qa', label: 'A task I review is done and ready for QA', on: true },
  { kind: 'estimate_exceeded', label: 'A task goes over its time estimate', on: true },
  { kind: 'due_today', label: 'My task is due today (9 AM)', on: true },
  { kind: 'overdue', label: 'My task is overdue (9 AM)', on: true },
  { kind: 'comment', label: 'New comments on tasks I watch', on: false },
  { kind: 'completed', label: 'A task I created is completed', on: false },
]

/** Admin settings: where emails go (the GoHighLevel inbound webhook). */
export default function Settings() {
  const { role, workspace } = useWorkspace()
  const [hook, setHook] = useState('')
  const [app, setApp] = useState(DEFAULT_APP)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!workspace) return
    supabase.from('workspace_settings').select('ghl_webhook_url, app_url').eq('workspace_id', workspace.id).maybeSingle()
      .then(({ data }) => { setHook(data?.ghl_webhook_url ?? ''); setApp(data?.app_url ?? DEFAULT_APP); setSaved(data?.ghl_webhook_url ?? '') })
  }, [workspace])

  if (!isAdmin(role)) return <p className="muted">Only admins can change settings.</p>

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!workspace) return
    const url = hook.trim()
    if (url && !/^https:\/\/\S+$/.test(url)) { notify('The webhook URL must start with https://'); return }
    const appUrl = app.trim().replace(/\/?$/, '/')
    setBusy(true)
    const { error } = await supabase.from('workspace_settings').upsert({ workspace_id: workspace.id, ghl_webhook_url: url || null, app_url: appUrl, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) notify(error.message); else { setSaved(url); notify('Settings saved', 'ok') }
  }
  async function test() {
    if (!workspace) return
    setBusy(true)
    const { data, error } = await supabase.rpc('send_test_email', { ws: workspace.id })
    setBusy(false)
    if (error) notify(error.message); else notify(`Test sent to GoHighLevel for ${data}. Check that inbox in a minute.`, 'ok')
  }

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 760 }}>
      <div className="page-title"><h1>Settings</h1><p className="muted small">Workspace settings. Only owners and admins see this page.</p></div>

      <form className="card stack" onSubmit={save}>
        <h2 className="row" style={{ gap: 8 }}><Webhook size={17} aria-hidden />Email sending (GoHighLevel)</h2>
        <p className="muted small" style={{ margin: 0 }}>
          All emails (invites, password resets and notifications) are sent by a GoHighLevel workflow in sub-account 1.
          Paste the URL of that workflow's <b>Inbound Webhook</b> trigger here. Until it is set, emails are skipped and invite links show on the Members page instead.
        </p>
        <label>GHL inbound webhook URL
          <input type="url" placeholder="https://services.leadconnectorhq.com/hooks/…" value={hook} onChange={e => setHook(e.target.value)} />
        </label>
        <label>Link used in emails
          <input type="url" value={app} onChange={e => setApp(e.target.value)} />
          <span className="muted small">Where the "Open task" button in emails goes. Keep the default unless the app moves.</span>
        </label>
        <div className="row">
          <button className="primary" disabled={busy}>Save</button>
          <button type="button" className="btn ghost" disabled={busy || !saved} onClick={test} title={saved ? '' : 'Save a webhook URL first'}><Send size={15} aria-hidden />Send me a test email</button>
          <span className={`pill ${saved ? 'ok' : ''}`}><Mail size={12} aria-hidden />{saved ? 'Emails on' : 'Emails off'}</span>
        </div>
      </form>

      <div className="card stack">
        <h2>What gets emailed</h2>
        <p className="muted small" style={{ margin: 0 }}>Everything below also shows in the bell in the top bar. Each person can switch individual emails off on their Profile page. These are the defaults:</p>
        <ul className="plain-list">
          {EMAIL_KINDS.map(k => <li key={k.kind}><span className={`pill ${k.on ? 'ok' : ''}`}>{k.on ? 'Email on' : 'In-app only'}</span> {k.label}</li>)}
          <li><span className="pill ok">Always</span> Invites and password resets</li>
        </ul>
      </div>
    </div>
  )
}
