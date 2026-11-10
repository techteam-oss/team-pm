export type Theme = 'light' | 'dark' | 'system'

const KEY = 'team-pm-theme'

function safeGet(): Theme | null {
  try { return localStorage.getItem(KEY) as Theme | null } catch { return null }
}

export function getStoredTheme(): Theme {
  return safeGet() ?? 'system'
}

export function applyTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* storage may be blocked in iframes */ }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  window.dispatchEvent(new CustomEvent('team-pm-theme', { detail: theme }))
}
