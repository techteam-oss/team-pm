import { useWorkspaceMaybe } from '../lib/workspace'

const COLORS = ['#7b68ee', '#e5484d', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6']

/** Profile picture if the person has one (looked up by id), otherwise coloured initials. */
export default function Avatar({ name, id, url, size = 24, title }: { name: string; id?: string; url?: string | null; size?: number; title?: string }) {
  const ws = useWorkspaceMaybe()
  const src = url ?? (id ? ws?.people.find(p => p.id === id)?.avatar_url : null)
  if (src) return <img className="avatar" src={src} alt="" title={title ?? name} width={size} height={size} style={{ width: size, height: size }} loading="lazy" />
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
  return (
    <span className="avatar" title={title ?? name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: COLORS[h % COLORS.length] }}>
      {initials || '?'}
    </span>
  )
}
