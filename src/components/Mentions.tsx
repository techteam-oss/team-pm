import { useRef, useState, type ReactNode } from 'react'
import Avatar from './Avatar'

export type MentionPerson = { id: string; name: string; email: string | null }
type Person = MentionPerson
const TOKEN = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/g

/** Turns "@[Name](uuid)" into highlighted names. */
export function renderMentions(body: string, me?: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of body.matchAll(TOKEN)) {
    if (m.index! > last) out.push(body.slice(last, m.index))
    out.push(<span key={m.index} className={`mention ${m[2] === me ? 'me' : ''}`}>@{m[1]}</span>)
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out
}

/** Plain-text preview for lists (My tasks, search). */
export const mentionsToText = (body: string) => body.replace(TOKEN, '@$1')

/** Replaces the "@Name" of each picked person with the stored "@[Name](uuid)" form. */
export function encodeMentions(text: string, picked: Person[]) {
  let out = text
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(^|[^\\w\\[])@${esc}(?![\\w\\]])`, 'g'), `$1@[${p.name}](${p.id})`)
  }
  return out
}

/** Textarea with an @ picker. Shows "@Name"; call encodeMentions(text, picked) before saving. */
export function MentionTextarea({ value, onChange, people, placeholder, rows = 3, onPick }: {
  value: string; onChange: (v: string) => void; people: Person[]; placeholder?: string; rows?: number; onPick: (p: Person) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null)
  const [active, setActive] = useState(0)
  const matches = query ? people.filter(p => (p.name + ' ' + (p.email ?? '')).toLowerCase().includes(query.text.toLowerCase())).slice(0, 6) : []

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret)
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/)
    setQuery(m ? { start: caret - m[2].length - 1, text: m[2] } : null)
    setActive(0)
  }
  function pick(p: Person) {
    if (!query || !ref.current) return
    const caret = ref.current.selectionStart
    const next = value.slice(0, query.start) + `@${p.name} ` + value.slice(caret)
    onChange(next)
    onPick(p)
    setQuery(null)
    requestAnimationFrame(() => { ref.current?.focus() })
  }

  return (
    <div className="mention-wrap">
      <textarea ref={ref} rows={rows} placeholder={placeholder} value={value}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart) }}
        onKeyDown={e => {
          if (!matches.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]) }
          else if (e.key === 'Escape') setQuery(null)
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)} />
      {matches.length > 0 && (
        <ul className="mention-menu" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(p) }}>
              <Avatar name={p.name} id={p.id} size={20} /> {p.name} <span className="muted small">{p.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
