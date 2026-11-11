import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Space } from '../lib/workspace'

const COLORS = ['#7b68ee', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']
const ICONS = ['', '📁', '🚀', '💼', '🎯', '📣', '💡', '🛠️', '💰', '🎨', '📊', '🧪', '🤝', '📅', '⭐']

export default function SpaceSettings({ space, isAdmin, onClose, onChanged }: { space: Space; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(space.name)
  const [color, setColor] = useState(space.color)
  const [icon, setIcon] = useState(space.icon ?? '')
  const [isPrivate, setPrivate] = useState(space.is_private)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const { error } = await supabase.from('spaces').update({ name: name.trim() || space.name, color, icon: icon || null, is_private: isPrivate }).eq('id', space.id)
    setBusy(false)
    if (error) alert(error.message); else { onChanged(); onClose() }
  }
  async function remove() {
    setBusy(true)
    const { error } = await supabase.from('spaces').delete().eq('id', space.id)
    setBusy(false)
    if (error) alert(error.message); else { onChanged(); onClose(); location.hash = '#/' }
  }

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <aside className="panel" style={{ width: 'min(440px, 100%)' }} onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Space settings</h3>
          <button onClick={onClose} title="Close">×</button>
        </div>
        <label className="field">Name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        <div className="field">Colour
          <div className="swatches">{COLORS.map(c => <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />)}</div>
        </div>
        <div className="field">Icon
          <div className="swatches">{ICONS.map(i => <button key={i || 'none'} className={`icon-pick ${i === icon ? 'on' : ''}`} onClick={() => setIcon(i)} title={i ? i : 'Colour dot'}>{i || <span className="dot" style={{ background: color }} />}</button>)}</div>
        </div>
        {isAdmin && (
          <label className="tb-check" style={{ color: 'var(--text)', whiteSpace: 'normal', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={isPrivate} onChange={e => setPrivate(e.target.checked)} />
            Private: only admins and people you add in Members can see it
          </label>
        )}
        <div className="row"><button className="primary" disabled={busy} onClick={save}>Save</button><button onClick={onClose}>Cancel</button></div>
        {isAdmin && (
          <div className="card danger-zone">
            <b>Delete space</b>
            <p className="small muted">Deletes every folder, list, task, comment and file in "{space.name}". This can't be undone. Type the space name to confirm.</p>
            <div className="row">
              <input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={space.name} />
              <button className="danger" disabled={busy || confirmName !== space.name} onClick={remove}>Delete forever</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
