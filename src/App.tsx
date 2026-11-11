import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { WorkspaceProvider } from './lib/workspace'
import Layout from './components/Layout'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Home from './pages/Home'
import Members from './pages/Members'
import ListPage from './pages/ListPage'
import MyTasks from './pages/MyTasks'
import Dashboard from './pages/Dashboard'
import Search from './pages/Search'
import Archive from './pages/Archive'
import { TimerProvider } from './lib/time'

function needsPassword() {
  try { return sessionStorage.getItem('team-pm-needs-password') === '1' } catch { return false }
}

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <div className="center muted">Loading…</div>
  if (!session) return <Login />
  if (needsPassword()) return <SetPassword />

  return (
    <WorkspaceProvider>
      <TimerProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/my" element={<MyTasks />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/search" element={<Search />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/members" element={<Members />} />
          <Route path="/list/:id" element={<ListPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      </TimerProvider>
    </WorkspaceProvider>
  )
}
