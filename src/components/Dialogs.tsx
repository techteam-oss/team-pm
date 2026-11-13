import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, X } from 'lucide-react'

// In-app replacements for the browser's prompt(), confirm() and alert().
// Call askText / askConfirm / notify from anywhere; <DialogHost /> (mounted once) renders them.

type TextReq = { kind: 'text'; title: string; label?: string; initial?: string; confirmLabel?: string; placeholder?: string
  toggle?: { label: string; hint?: string }; resolve: (v: { value: string; toggled: boolean } | null) => void }
type ConfirmReq = { kind: 'confirm'; title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
type ChoiceReq = { kind: 'choice'; title: string; options: { value: string; label: string; color?: string }[]; initial?: string; confirmLabel?: string
  /** Picking an option closes the dialog straight away (one tap on phones). */
  instant?: boolean; resolve: (v: string | null) => void }
type Req = TextReq | ConfirmReq | ChoiceReq
type Toast = { id: number; text: string; tone: 'error' | 'ok' }

let push: ((r: Req) => void) | null = null
let toast: ((t: Omit<Toast, 'id'>) => void) | null = null

export function askText(o: Omit<TextReq, 'kind' | 'resolve'>) {
  return new Promise<{ value: string; toggled: boolean } | null>(resolve => push ? push({ ...o, kind: 'text', resolve }) : resolve(null))
}
export function askConfirm(o: Omit<ConfirmReq, 'kind' | 'resolve'>) {
  return new Promise<boolean>(resolve => push ? push({ ...o, kind: 'confirm', resolve }) : resolve(false))
}
export function askChoice(o: Omit<ChoiceReq, 'kind' | 'resolve'>) {
  return new Promise<string | null>(resolve => push ? push({ ...o, kind: 'choice', resolve }) : resolve(null))
}
/** Small toast in the corner. Errors stay a little longer. */
export function notify(text: string, tone: Toast['tone'] = 'error') { toast?.({ text, tone }) }

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [value, setValue] = useState('')
  const [toggled, setToggled] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    push = r => { setReq(r); setValue(r.kind === 'text' ? r.initial ?? '' : r.kind === 'choice' ? r.initial ?? r.options[0]?.value ?? '' : ''); setToggled(false) }
    let n = 0
    toast = t => {
      const id = ++n
      setToasts(ts => [...ts, { ...t, id }])
      setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), t.tone === 'error' ? 6000 : 3500)
    }
    return () => { push = null; toast = null }
  }, [])
  useEffect(() => {
    if (!req) return
    requestAnimationFrame(() => (req.kind === 'text' ? inputRef.current?.select()
      : req.kind === 'choice' && req.instant ? document.querySelector<HTMLButtonElement>('.choice-btn.on, .choice-btn')?.focus() : okRef.current?.focus()))
  }, [req])

  function close(ok: boolean) {
    if (!req) return
    if (req.kind === 'text') req.resolve(ok && value.trim() ? { value: value.trim(), toggled } : null)
    else if (req.kind === 'confirm') req.resolve(ok)
    else req.resolve(ok ? value : null)
    setReq(null)
  }

  return (
    <>
      {req && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(false) }} onKeyDown={e => { if (e.key === 'Escape') close(false) }}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onSubmit={e => { e.preventDefault(); close(true) }}>
            <div className="modal-head">
              <h2 id="dlg-title">{req.title}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => close(false)}><X size={16} /></button>
            </div>
            {req.kind === 'text' && (
              <>
                <label className="field">{req.label ?? 'Name'}
                  <input ref={inputRef} value={value} placeholder={req.placeholder} maxLength={120} onChange={e => setValue(e.target.value)} />
                </label>
                {req.toggle && (
                  <label className="switch-row">
                    <input type="checkbox" checked={toggled} onChange={e => setToggled(e.target.checked)} />
                    <span><b>{req.toggle.label}</b>{req.toggle.hint && <span className="muted small"> {req.toggle.hint}</span>}</span>
                  </label>
                )}
              </>
            )}
            {req.kind === 'confirm' && req.body && <p className="modal-body">{req.body}</p>}
            {req.kind === 'choice' && req.instant && (
              <div className="choice-list">
                {req.options.map(o => (
                  <button key={o.value} type="button" className={`choice choice-btn ${value === o.value ? 'on' : ''}`} aria-pressed={value === o.value}
                    onClick={() => { req.resolve(o.value); setReq(null) }}>
                    {o.color && <span className="status-dot" style={{ color: o.color }} aria-hidden />}
                    <span className="choice-label">{o.label}</span>
                    {value === o.value && <Check size={15} aria-label="Current" />}
                  </button>
                ))}
              </div>
            )}
            {req.kind === 'choice' && !req.instant && (
              <div className="choice-list" role="radiogroup">
                {req.options.map(o => (
                  <label key={o.value} className={`choice ${value === o.value ? 'on' : ''}`}>
                    <input type="radio" name="dlg-choice" checked={value === o.value} onChange={() => setValue(o.value)} />
                    {o.color && <span className="status-dot" style={{ color: o.color }} aria-hidden />}{o.label}
                  </label>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => close(false)}>Cancel</button>
              {!(req.kind === 'choice' && req.instant) && <button ref={okRef} className={`btn ${req.kind === 'confirm' && req.danger ? 'danger-solid' : 'primary'}`}
                disabled={req.kind === 'text' && !value.trim()}>{req.confirmLabel ?? (req.kind === 'confirm' ? 'Confirm' : 'Save')}</button>}
            </div>
          </form>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'error' ? <AlertCircle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}<span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}
