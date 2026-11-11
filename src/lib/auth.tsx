import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AuthState = { session: Session | null; loading: boolean; linkError?: string }

// Checked once per page load (StrictMode runs effects twice in development).
let linkCheck: Promise<string | undefined> | null = null
const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })

  useEffect(() => {
    // Invite and reset links open the app as ?token_hash=...&type=invite|recovery.
    // We verify the token here, so the links don't depend on Supabase's redirect URL settings.
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const type = params.get('type')
    linkCheck ??= tokenHash && (type === 'invite' || type === 'recovery')
      ? (async () => {
          try { sessionStorage.setItem('team-pm-needs-password', '1') } catch { /* ignore */ }
          await supabase.auth.signOut({ scope: 'local' })
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          window.history.replaceState(null, '', window.location.pathname + window.location.hash)
          if (!error) return undefined
          try { sessionStorage.removeItem('team-pm-needs-password') } catch { /* ignore */ }
          return 'This link has expired or was already used. Ask an admin for a new one.'
        })()
      : Promise.resolve(undefined)
    let ready = false
    linkCheck.then(async (linkError) => {
      const { data } = await supabase.auth.getSession()
      ready = true
      setState({ session: data.session, loading: false, linkError })
    })
    // Hold auth events until any link has been checked, so the sign-in page doesn't flash first.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ready) setState((s) => ({ ...s, session, loading: false }))
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
