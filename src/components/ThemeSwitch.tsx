import { useEffect, useState } from 'react'
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme'
import { supabase } from '../lib/supabase'

export default function ThemeSwitch({ userId }: { userId: string }) {
  const [theme, setTheme] = useState<Theme>(getStoredTheme())

  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<Theme>).detail)
    window.addEventListener('team-pm-theme', on)
    return () => window.removeEventListener('team-pm-theme', on)
  }, [])

  async function change(t: Theme) {
    setTheme(t)
    applyTheme(t)
    await supabase.from('profiles').update({ theme: t }).eq('id', userId)
  }

  return (
    <div className="segmented" role="group" aria-label="Theme">
      {(['light', 'dark', 'system'] as Theme[]).map(t => (
        <button key={t} className={theme === t ? 'on' : ''} onClick={() => change(t)}>
          {t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}
