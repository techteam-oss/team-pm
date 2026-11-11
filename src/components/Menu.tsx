import { useEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean } | null

/** Small "⋯" dropdown menu. */
export default function Menu({ items, title = 'More', icon = '⋯' }: { items: MenuItem[]; title?: string; icon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const shown = items.filter(Boolean) as Exclude<MenuItem, null>[]
  if (!shown.length) return null
  return (
    <div className="menu" ref={ref}>
      <button className="icon" title={title} aria-haspopup="menu" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>{icon}</button>
      {open && (
        <ul className="menu-list" role="menu">
          {shown.map(i => (
            <li key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={e => { e.stopPropagation(); setOpen(false); i.onClick() }}>{i.label}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
