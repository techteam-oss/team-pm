import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; icon?: ReactNode } | 'sep' | null

/** Small dropdown menu (defaults to a "⋯" trigger). */
export default function Menu({ items, title = 'More', icon, className = 'icon-btn', head }: {
  items: MenuItem[]; title?: string; icon?: ReactNode; className?: string; head?: ReactNode
}) {
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
  if (!shown.length && !head) return null
  return (
    <div className="menu" ref={ref}>
      <button className={className} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}>{icon ?? <MoreHorizontal size={16} />}</button>
      {open && (
        <ul className="menu-list" role="menu">
          {head && <li className="menu-head" role="presentation">{head}</li>}
          {shown.map((i, n) => i === 'sep' ? <li key={`sep${n}`} className="sep" role="separator" /> : (
            <li key={i.label} role="menuitem" tabIndex={0} className={i.danger ? 'danger' : ''}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(false); i.onClick() } }}
              onClick={e => { e.stopPropagation(); setOpen(false); i.onClick() }}>{i.icon}{i.label}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
