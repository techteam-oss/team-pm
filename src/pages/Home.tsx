import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { isAdmin, useWorkspace } from '../lib/workspace'

export default function Home() {
  const { loading, workspace, role, spaces, lists, refresh } = useWorkspace()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase.rpc('create_workspace', { ws_name: name.trim() })
    if (error) setError(error.message); else refresh()
  }

  if (loading) return <p className="muted">Loading…</p>

  if (!workspace) return (
    <form className="card" onSubmit={create}>
      <h2>Create your workspace</h2>
      <p className="muted">You'll be its owner. Usually one workspace for the whole team.</p>
      <div className="row">
        <input placeholder="e.g. Impact Network" required maxLength={80} value={name} onChange={e => setName(e.target.value)} />
        <button className="primary">Create</button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  )

  return (
    <div className="card">
      <h2>{workspace.name}</h2>
      <p className="muted">
        {spaces.length} space{spaces.length === 1 ? '' : 's'}, {lists.length} list{lists.length === 1 ? '' : 's'} you can see.
      </p>
      {isAdmin(role) ? (
        <ul className="steps">
          <li>Create a space with the <b>+</b> next to "Spaces" in the sidebar.</li>
          <li>Add lists inside it with the <b>+</b> next to the space.</li>
          <li>Invite your team from <b>Members</b>, choosing their role and which spaces they can open.</li>
        </ul>
      ) : (
        <p>Pick a list in the sidebar to see its tasks.</p>
      )}
    </div>
  )
}
