import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Home from './pages/Home'

function needsPassword() {
  try { return sessionStorage.getItem('team-pm-needs-password') === '1' } catch { return false }
}

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <div className="center muted">Loading…</div>
  if (!session) return <Login />
  if (needsPassword()) return <SetPassword />

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
