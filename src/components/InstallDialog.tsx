import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, MoreVertical, Share, SquarePlus, X } from 'lucide-react'
import { APP_URL, canPromptInstall, isEmbedded, openInOwnWindow, platform, promptInstall } from '../lib/embed'
import { notify } from './Dialogs'

/** How to put Team PM on a phone's home screen (opens full screen, no funnel page in between). */
export default function InstallDialog({ onClose }: { onClose: () => void }) {
  const [os, setOs] = useState(platform())
  const embedded = isEmbedded()
  const oneTap = canPromptInstall() && !embedded
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    closeRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(APP_URL); notify('Link copied', 'ok') } catch { notify('Copy failed. Press and hold the link to copy it.') }
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal install" role="dialog" aria-modal="true" aria-labelledby="inst-title">
        <div className="modal-head">
          <h2 id="inst-title">Add Team PM to your phone</h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="modal-body">It gets its own icon and opens full screen, straight to your tasks. Sign in once and it remembers you.</p>
        {oneTap && <button className="btn primary" onClick={async () => { if (await promptInstall()) onClose() }}>Install app</button>}
        {embedded && (
          <div className="banner">
            You are inside the funnel page, where phones can't install apps. Open Team PM on its own first, then follow the steps there.
            <button className="btn small" onClick={openInOwnWindow}><ExternalLink size={13} aria-hidden />Open in its own window</button>
          </div>
        )}
        <div className="segmented" role="tablist" aria-label="Phone type">
          <button role="tab" aria-selected={os === 'ios'} className={os === 'ios' ? 'on' : ''} onClick={() => setOs('ios')}>iPhone</button>
          <button role="tab" aria-selected={os !== 'ios'} className={os !== 'ios' ? 'on' : ''} onClick={() => setOs('android')}>Android</button>
        </div>
        {os === 'ios' ? (
          <ol className="steps">
            <li>Open <b>{APP_URL.replace('https://', '')}</b> in <b>Safari</b>.</li>
            <li>Tap the Share button <Share size={14} aria-label="Share" /> at the bottom of the screen.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b> <SquarePlus size={14} aria-hidden />, then <b>Add</b>.</li>
          </ol>
        ) : (
          <ol className="steps">
            <li>Open <b>{APP_URL.replace('https://', '')}</b> in <b>Chrome</b>.</li>
            <li>Tap the menu <MoreVertical size={14} aria-label="menu" /> at the top right.</li>
            <li>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</li>
          </ol>
        )}
        <div className="row install-link">
          <input readOnly value={APP_URL} aria-label="App link" onFocus={e => e.target.select()} />
          <button className="btn" onClick={copy}><Copy size={14} aria-hidden />Copy link</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Tip: send this link to yourself on WhatsApp and open it on your phone.</p>
      </div>
    </div>
  )
}
