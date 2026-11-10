const COLORS = ['#7b68ee', '#e5484d', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6']

export default function Avatar({ name, size = 24, title }: { name: string; size?: number; title?: string }) {
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
