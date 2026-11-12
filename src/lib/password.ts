// Password rules for set/change password. Supabase's own leaked-password check needs the paid plan,
// so we ask the same Have I Been Pwned list here. Only the first 5 characters of the password's
// SHA-1 hash leave the browser (k-anonymity); the password itself is never sent anywhere but Supabase.

const COMMON = ['password', '12345678', '123456789', 'qwertyui', 'iloveyou', 'pakistan', 'teampm', 'welcome', 'admin123', 'abc12345']

async function sha1Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** How many times this password appears in known breaches (0 if none, null if the check could not run). */
export async function breachCount(password: string): Promise<number | null> {
  try {
    const hash = await sha1Hex(password)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: ctrl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const suffix = hash.slice(5)
    for (const line of (await r.text()).split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s === suffix) return Number(n) || 0
    }
    return 0
  } catch {
    return null
  }
}

/** Returns a message explaining what is wrong, or null when the password is fine to use. */
export async function checkPassword(password: string, email?: string | null): Promise<string | null> {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (password.length > 72) return 'Use 72 characters or fewer.'
  const lower = password.toLowerCase()
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating one character.'
  if (COMMON.some(c => lower.includes(c)) && password.length < 12) return 'That password is too easy to guess. Try a short phrase of 3 or 4 words.'
  const local = email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) return "Don't use your email name in your password."
  const seen = await breachCount(password)
  if (seen && seen > 0) return `This password has appeared in ${seen.toLocaleString()} data leaks, so attackers try it first. Please choose a different one.`
  return null
}
