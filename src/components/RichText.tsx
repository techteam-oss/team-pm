import { Fragment, useState, type ReactNode } from 'react'

/** Tiny, safe Markdown subset rendered as React elements (no innerHTML):
 *  # headings, **bold**, *italic*, `code`, ~~strike~~, [links](https://…), bare URLs,
 *  - bullets, 1. numbered, - [ ] / - [x] checkboxes, > quotes, ``` code blocks. */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(~~[^~]+~~)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    const t = m[0]
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k}>{inline(t.slice(2, -2), i)}</strong>)
    else if (m[3]) out.push(<em key={k}>{inline(t.slice(1, -1), i)}</em>)
    else if (m[4]) out.push(<s key={k}>{t.slice(2, -2)}</s>)
    else if (m[5]) out.push(<a key={k} href={m[6]} target="_blank" rel="noopener noreferrer">{t.slice(1, t.indexOf(']'))}</a>)
    else if (m[7]) out.push(<a key={k} href={t} target="_blank" rel="noopener noreferrer">{t}</a>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ source, onToggleCheck }: { source: string; onToggleCheck?: (line: number) => void }) {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const start = ++i
      while (i < lines.length && !lines[i].startsWith('```')) i++
      blocks.push(<pre key={start} className="rt-code">{lines.slice(start, i).join('\n')}</pre>)
      i++; continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) { const T = (`h${h[1].length + 3}`) as 'h4' | 'h5' | 'h6'; blocks.push(<T key={i} className="rt-h">{inline(h[2], i)}</T>); i++; continue }
    if (/^>\s?/.test(line)) {
      const start = i; const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={start}>{q.map((l, j) => <Fragment key={j}>{inline(l, start + j)}{j < q.length - 1 && <br />}</Fragment>)}</blockquote>)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const start = i; const ordered = /^\s*\d+\./.test(line); const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const li = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''); const n = i
        const cb = li.match(/^\[( |x|X)\]\s+(.*)$/)
        items.push(cb
          ? <li key={n} className="rt-check"><input type="checkbox" checked={cb[1] !== ' '} disabled={!onToggleCheck} onChange={() => onToggleCheck?.(n)} /> <span className={cb[1] !== ' ' ? 'done' : ''}>{inline(cb[2], n)}</span></li>
          : <li key={n}>{inline(li, n)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>)
      continue
    }
    if (!line.trim()) { i++; continue }
    const start = i; const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|\s*([-*]|\d+\.)\s+)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={start}>{para.map((l, j) => <Fragment key={j}>{inline(l, start + j)}{j < para.length - 1 && <br />}</Fragment>)}</p>)
  }
  return <div className="rich">{blocks}</div>
}

/** Description field: rendered view, click Edit to change. Keyboard: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic. */
export function RichEditor({ value, canEdit, onSave, placeholder = 'Add details…' }: { value: string | null; canEdit: boolean; onSave: (v: string | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const start = () => { setDraft(value ?? ''); setEditing(true) }
  const done = () => { setEditing(false); const v = draft.trim() ? draft : null; if (v !== value) onSave(v) }
  function wrap(el: HTMLTextAreaElement, mark: string) {
    const { selectionStart: a, selectionEnd: b } = el
    const next = draft.slice(0, a) + mark + draft.slice(a, b) + mark + draft.slice(b)
    setDraft(next)
    requestAnimationFrame(() => { el.selectionStart = a + mark.length; el.selectionEnd = b + mark.length })
  }
  function toggle(line: number) {
    const ls = (value ?? '').split('\n')
    ls[line] = ls[line].replace(/\[( |x|X)\]/, m => (m === '[ ]' ? '[x]' : '[ ]'))
    onSave(ls.join('\n'))
  }
  if (editing) return (
    <div className="stack" style={{ gap: 6 }}>
      <textarea autoFocus rows={Math.max(5, draft.split('\n').length + 1)} value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); wrap(e.currentTarget, '**') }
          if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); wrap(e.currentTarget, '*') }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); done() }
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
        }} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">**bold** *italic* `code` - list - [ ] checkbox # heading [link](https://…)</span>
        <div className="row"><button onClick={() => setEditing(false)}>Cancel</button><button className="primary" onClick={done}>Save</button></div>
      </div>
    </div>
  )
  if (!value) return canEdit ? <button className="rt-empty" onClick={start}>{placeholder}</button> : <p className="muted">No description</p>
  return (
    <div className="rt-view">
      <RichText source={value} onToggleCheck={canEdit ? toggle : undefined} />
      {canEdit && <button className="link rt-edit" onClick={start}>Edit</button>}
    </div>
  )
}
