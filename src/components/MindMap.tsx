import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Status } from '../lib/listData'
import { notify } from './Dialogs'

type Node = { id: string; number: number; title: string; status_id: string | null; parent_task_id: string | null; position: number }

export default function MindMap({ listId, listName, statuses, canEdit, onOpen }: {
  listId: string; listName: string; statuses: Status[]; canEdit: boolean; onOpen: (id: string) => void
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [adding, setAdding] = useState<string | null>(null) // parent id, or 'root'
  const [title, setTitle] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('tasks').select('id, number, title, status_id, parent_task_id, position')
      .eq('list_id', listId).eq('archived', false).order('position').order('created_at')
    setNodes(data ?? [])
  }, [listId])

  useEffect(() => {
    load()
    const ch = supabase.channel(`map-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `list_id=eq.${listId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [listId, load])

  const status = (id: string | null) => statuses.find(s => s.id === id)
  const children = (pid: string | null) => nodes.filter(n => n.parent_task_id === pid)

  async function add(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t || !adding) return
    const parent = adding === 'root' ? null : adding
    const last = children(parent).at(-1)
    const { error } = await supabase.from('tasks').insert({
      list_id: listId, title: t, parent_task_id: parent, status_id: statuses[0]?.id, position: (last?.position ?? 0) + 1000,
    })
    if (error) notify(error.message)
    else { setTitle(''); if (parent) setCollapsed(c => ({ ...c, [parent]: false })); load() }
  }

  const addForm = (
    <form className="mm-add" onSubmit={add}>
      <input autoFocus placeholder="Task name, Enter to add" value={title} onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setAdding(null); setTitle('') } }} onBlur={() => { if (!title.trim()) setAdding(null) }} />
    </form>
  )

  function branch(node: Node) {
    const kids = children(node.id)
    const st = status(node.status_id)
    const isCollapsed = collapsed[node.id]
    return (
      <li key={node.id}>
        <div className={`mm-node ${st?.is_done ? 'done' : ''}`} style={{ borderLeftColor: st?.color ?? 'var(--border)' }}>
          <button className="mm-title" onClick={() => onOpen(node.id)} title={st ? `${st.name}: ${node.title}` : node.title}>
            <span className="muted small">#{node.number}</span> {node.title}
          </button>
          {kids.length > 0 && (
            <button className="icon mm-toggle" title={isCollapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed(c => ({ ...c, [node.id]: !isCollapsed }))}>
              {isCollapsed ? `+${kids.length}` : '−'}
            </button>
          )}
          {canEdit && <button className="icon mm-plus" title="Add subtask" onClick={() => { setAdding(node.id); setTitle('') }}>+</button>}
        </div>
        {((kids.length > 0 && !isCollapsed) || adding === node.id) && (
          <ul>
            {!isCollapsed && kids.map(k => branch(k))}
            {adding === node.id && <li>{addForm}</li>}
          </ul>
        )}
      </li>
    )
  }

  const roots = children(null)
  return (
    <div className="mindmap">
      <ul className="mm-tree">
        <li>
          <div className="mm-node mm-root">
            <span className="mm-title">{listName}</span>
            {canEdit && <button className="icon mm-plus" title="Add task" onClick={() => { setAdding('root'); setTitle('') }}>+</button>}
          </div>
          {(roots.length > 0 || adding === 'root') && (
            <ul>
              {roots.map(n => branch(n))}
              {adding === 'root' && <li>{addForm}</li>}
            </ul>
          )}
        </li>
      </ul>
      {roots.length === 0 && adding !== 'root' && <p className="muted small">No tasks yet{canEdit ? '. Use + on the list name to add one.' : '.'}</p>}
    </div>
  )
}
