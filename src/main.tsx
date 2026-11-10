import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/auth'
import { applyTheme, getStoredTheme } from './lib/theme'

// Invite and password-reset emails land with "#access_token=...&type=invite|recovery".
// Remember that before supabase-js consumes the hash, so we can ask for a new password.
const hash = window.location.hash
if (/type=(invite|recovery)/.test(hash)) sessionStorage.setItem('team-pm-needs-password', '1')

applyTheme(getStoredTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
)
