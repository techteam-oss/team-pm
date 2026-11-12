import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'
import { askConfirm, notify } from '../components/Dialogs'
import { Trash2 } from 'lucide-react'

type Row = { id: string; number: number; title: string; list_id: string; space_id: string; parent_task_id: string | null; created_by: string | null; updated_at: string; deleted_at: string | null; deleted_by: string | null }

export default function Archive() {
  const { workspace, role, lists, spaces, level, people, refresh } = useWorkspace()
  const [oldLists, setOldLists] = useState<{ id: string; name: string; space_id: string }[]>([])
  const [tab, setTab] = useState<'archived' | 'trash'>('archived')
  const [rows, setRows] = useState<Row[] | null>(null)

  const load = useCallback(async () => {
    if (!workspace) return
    let q = supabase.from('tasks').select('id, number, title, list_id, space_id, parent_task_id, created_by, updated_at, deleted_at, deleted_by')
      .eq('workspace_id', workspace.id).eq('archived', true).is('parent_task_id', null).limit(500)
    q = tab === 'trash' ? q.not('deleted_at', 'is', null).order('deleted_at', { ascending: false }) : q.is('deleted_at', null).order('updated_at', { ascending: false })
    const [{ data }, { data: ol }] = await Promise.all([q, supabase.from('lists').select('id, name, space_id').eq('workspace_id', workspace.id).eq('archived', true).order('name')])
    setRows(data ?? []); setOldLists(ol ?? [])
  }, [workspace, tab])
  useEffect(() => { setRows(null); load() }, [load])

  const where = (r: Row) => { const l = lists.find(x => x.id === r.list_id); const s = spaces.find(x => x.id === r.space_id); return `${s?.name ?? ''} / ${l?.name ?? ''}` }
  const who = (id: string | null) => people.find(p => p.id === id)?.name ?? 'someone'
  const canDelete = (r: Row) => level(r.space_id) >= 3          // anyone with edit access can trash a task
  const canPurge = isAdmin(role)                                // only owners/admins delete for good

  async function act(r: Row, kind: 'restore' | 'trash' | 'forever') {
    if (kind === 'forever' && !await askConfirm({ title: `Delete "${r.title}" forever?`, body: "Its subtasks are deleted too. This can't be undone.", confirmLabel: 'Delete forever', danger: true })) return
    const { error } = kind === 'restore' ? await supabase.from('tasks').update({ archived: false }).eq('id', r.id)
      : kind === 'trash' ? await supabase.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)
      : await supabase.from('tasks').delete().eq('id', r.id)
    if (error) notify(error.message); else load()
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Archive</h1><div className="muted small">{tab === 'trash' ? 'Deleted tasks. Restore them, or delete them for good.' : 'Archived tasks are hidden from lists, boards and dashboards but keep all their details.'}</div></div>
        <div className="segmented">
          <button className={tab === 'archived' ? 'on' : ''} onClick={() => setTab('archived')}>Archived</button>
          <button className={tab === 'trash' ? 'on' : ''} onClick={() => setTab('trash')}><Trash2 size={13} aria-hidden />Trash</button>
        </div>
      </div>
      {tab === 'archived' && oldLists.length > 0 && (
        <div className="group">
          <div className="group-head"><b>Archived lists</b><span className="muted small">{oldLists.length}</span></div>
          <table className="grid tasks"><tbody>
            {oldLists.map(l => (
              <tr key={l.id}>
                <td className="title">{l.name}</td>
                <td className="muted small">{spaces.find(x => x.id === l.space_id)?.name}</td>
                <td className="nowrap" style={{ textAlign: 'right' }}>{level(l.space_id) >= 4 && <button onClick={async () => { const { error } = await supabase.from('lists').update({ archived: false }).eq('id', l.id); if (error) notify(error.message); else { load(); refresh() } }}>Restore list</button>}{' '}
                  {canPurge && <button className="danger" onClick={async () => { if (!await askConfirm({ title: `Delete the list "${l.name}" forever?`, body: "All its tasks, comments, files and time entries are deleted. This can't be undone.", confirmLabel: 'Delete forever', danger: true })) return; const { error } = await supabase.from('lists').delete().eq('id', l.id); if (error) notify(error.message); else { load(); refresh() } }}>Delete forever</button>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card"><p className="muted">{tab === 'trash' ? 'The trash is empty.' : 'Nothing archived.'}</p></div> : (
        <div className="group">
          <table className="grid tasks"><tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="muted small num">#{r.number}</td>
                <td className="title">{r.title}<div className="muted small">{tab === 'trash' && r.deleted_at ? `Deleted by ${who(r.deleted_by)} on ${new Date(r.deleted_at).toLocaleDateString()}` : `Archived ${new Date(r.updated_at).toLocaleDateString()}`}</div></td>
                <td className="muted small">{where(r)}</td>
                <td className="nowrap" style={{ textAlign: 'right' }}>
                  {level(r.space_id) >= 3 && <button onClick={() => act(r, 'restore')}>Restore</button>}{' '}
                  {tab === 'archived' && canDelete(r) && <button className="danger" onClick={() => act(r, 'trash')}>Move to trash</button>}
                  {tab === 'trash' && canPurge && <button className="danger" onClick={() => act(r, 'forever')}>Delete forever</button>}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  )
}
