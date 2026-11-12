// Helpers for running inside the GoHighLevel funnel page (an iframe) and on phones.

export const APP_URL = 'https://techteam-oss.github.io/team-pm/'

/** True when the app is shown inside another page (the GHL funnel iframe). */
export function isEmbedded() {
  try { return window.self !== window.top } catch { return true }
}

/** True when the app was opened from a phone's home-screen icon. */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

/** Some browsers (Safari, Brave, private windows) block storage inside iframes, so sign-in is lost on reload. */
export function storageWorks() {
  try {
    const k = 'team-pm-storage-test'
    localStorage.setItem(k, '1'); localStorage.removeItem(k)
    return true
  } catch { return false }
}

/** The app's own address for the current screen. Inside the iframe this is still the app's address, not the funnel's. */
export function directLink() {
  return window.location.origin + window.location.pathname + window.location.hash
}

export function openInOwnWindow() {
  window.open(directLink(), '_blank', 'noopener')
}

export type Platform = 'ios' | 'android' | 'desktop'
export function platform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

// Chrome and Edge fire this when the app can be installed with one tap. We keep it for the Install dialog.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallEvent })
window.addEventListener('appinstalled', () => { deferred = null })
export const canPromptInstall = () => !!deferred
export async function promptInstall() {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  return outcome === 'accepted'
}
