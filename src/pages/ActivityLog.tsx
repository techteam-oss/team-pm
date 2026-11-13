import { useEffect, useState } from 'react'
import { Download, History, RotateCcw, Trash2, UserMinus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import Avatar from '../components/Avatar'

type Row = { id: number; actor_id: string | null; action: string; entity: string; name: string | null; space_name: string | null; details: Record<string, unknown>; created_at: string }
const PAGE = 100

function describe(r: Row) {
  const d = r.details ?? {}
  const bits: string[] = []
  if (r.entity === 'task' && d.number) bits.push(`#${d.number}`)
  if (d.list) bits.push(`in ${d.list}`)
  if (r.entity === 'attachment' && d.task) bits.push(`from "${d.task}"`)
  if (typeof d.lists === 'number') bits.push(`${d.lists} list${d.lists === 1 ? '' : 's'}`)
  if (typeof d.tasks === 'number') bits.push(`${d.tasks} task${d.tasks === 1 ? '' : 's'}`)
  if (d.role) bits.push(`was ${d.role}`)
  return bits.join(' · ')
}

/** Admin-only: who deleted, trashed or restored what. */
export default function ActivityLog() {
  const { role, workspace, people } = useWorkspace()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [what, setWhat] = useState('')
  const [who, setWho] = useState('')
  const [more, setMore] = useState(false)

  async function load(append = false) {
    if (!workspace) return
    let q = supabase.from('audit_log').select('id, actor_id, action, entity, name, space_name, details, created_at')
      .eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(PAGE)
    if (what) q = q.eq('entity', what)
    if (who) q = q.eq('actor_id', who)
    if (append && rows?.length) q = q.lt('id', rows[rows.length - 1].id)
    const { data } = await q
    const got = (data ?? []) as Row[]
    setRows(append ? [...(rows ?? []), ...got] : got); setMore(got.length === PAGE)
  }
  useEffect(() => { load() }, [workspace?.id, what, who]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin(role)) return <p className="muted">Only admins can see the activity log.</p>
  const name = (id: string | null) => people.find(p => p.id === id)?.name ?? (id ? 'Former member' : 'System')

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div className="page-title"><h1>Activity log</h1><p className="muted small">Every delete, move to trash, restore, member removal and backup download, with who did it. Only admins see this.</p></div>
        <div className="row">
          <select aria-label="What" value={what} onChange={e => setWhat(e.target.value)}>
            <option value="">Everything</option>
            <option value="task">Tasks</option><option value="list">Lists</option><option value="folder">Folders</option>
            <option value="space">Spaces</option><option value="attachment">Files</option><option value="member">Members</option><option value="workspace">Backups</option>
          </select>
          <select aria-label="Who" value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Anyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <div className="card"><div className="empty-state"><span className="ic"><History size={20} aria-hidden /></span><h3>Nothing yet</h3><p>Deletes and restores will be listed here.</p></div></div>
      ) : (
        <div className="group">
          <table className="grid tasks log-table">
            <tbody>
              {rows.map(r => {
                const Icon = r.action === 'restored' ? RotateCcw : r.action === 'removed' ? UserMinus : r.action === 'exported' ? Download : Trash2
                return (
                  <tr key={r.id}>
                    <td className="nowrap"><span className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><Avatar id={r.actor_id ?? ''} name={name(r.actor_id)} size={24} /><b>{name(r.actor_id)}</b></span></td>
                    <td>
                      <span className={`log-action ${r.action}`}><Icon size={13} aria-hidden />{r.action === 'deleted' ? 'deleted' : r.action === 'trashed' ? 'moved to trash' : r.action === 'exported' ? 'downloaded a backup of' : r.action}</span>{' '}
                      {r.entity === 'workspace' ? 'the workspace' : r.entity} <b>{r.name ?? 'untitled'}</b>
                      <div className="muted small">{[r.space_name && `Space: ${r.space_name}`, describe(r)].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="muted small nowrap" style={{ textAlign: 'right' }} title={new Date(r.created_at).toLocaleString()}>
                      {new Date(r.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {more && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn ghost" onClick={() => load(true)}>Load more</button></div>}
        </div>
      )}
    </div>
  )
}
