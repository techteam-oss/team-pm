import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useWorkspace } from '../lib/workspace'
import Avatar from '../components/Avatar'
import ThemeSwitch from '../components/ThemeSwitch'

export default function Profile() {
  const { session } = useAuth()
  const uid = session!.user.id
  const { people, refresh } = useWorkspace()
  const me = people.find(p => p.id === uid)
  const [name, setName] = useState(me?.name ?? '')
  useEffect(() => { if (me) setName(me.name === me.email ? '' : me.name) }, [me?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pw, setPw] = useState('')

  async function saveName(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() || null }).eq('id', uid)
    setMsg(error ? error.message : 'Name saved.'); if (!error) refresh()
  }
  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setMsg('Use a PNG, JPG, WebP or GIF image.'); return }
    if (file.size > 2 * 1024 * 1024) { setMsg('Pictures can be up to 2 MB.'); return }
    setBusy(true)
    const path = `${uid}/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`
    const up = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, cacheControl: '31536000' })
    if (up.error) { setBusy(false); setMsg(up.error.message); return }
    const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
    const old = me?.avatar_url
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid)
    if (!error && old) await supabase.storage.from('avatars').remove([old.split('/avatars/')[1]])
    setBusy(false); setMsg(error ? error.message : 'Picture updated.'); refresh()
  }
  async function removePicture() {
    if (!me?.avatar_url) return
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid)
    if (!error) await supabase.storage.from('avatars').remove([me.avatar_url.split('/avatars/')[1]])
    setBusy(false); setMsg(error ? error.message : 'Picture removed.'); refresh()
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setMsg('Use at least 8 characters.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPw(''); setMsg(error ? error.message : 'Password changed.')
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>Your profile</h1>
      {msg && <div className="banner">{msg}</div>}
      <div className="card stack">
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={me?.name ?? session!.user.email ?? '?'} url={me?.avatar_url} size={72} />
          <div className="stack" style={{ gap: 6 }}>
            <label className="button-like">
              {busy ? 'Uploading…' : 'Upload picture'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
            </label>
            {me?.avatar_url && <button className="link" style={{ alignSelf: 'flex-start' }} onClick={removePicture} disabled={busy}>Remove picture</button>}
            <span className="muted small">PNG, JPG, WebP or GIF, up to 2 MB.</span>
          </div>
        </div>
        <form className="field" onSubmit={saveName}>Name
          <div className="row"><input value={name} maxLength={80} onChange={e => setName(e.target.value)} /><button className="primary">Save</button></div>
        </form>
        <div className="field">Email<div style={{ color: 'var(--text)' }}>{session!.user.email}</div><span className="small">Ask an admin if this needs to change.</span></div>
        <div className="field">Theme<div><ThemeSwitch userId={uid} /></div></div>
      </div>
      <form className="card stack" onSubmit={changePassword}>
        <b>Change password</b>
        <div className="row"><input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={e => setPw(e.target.value)} /><button>Change</button></div>
      </form>
    </div>
  )
}
