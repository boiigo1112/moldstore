import { useState } from 'react'
import { AuthProvider, useAuth } from './auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Stock from './pages/Stock'
import Molds from './pages/Molds'
import Repairs from './pages/Repairs'
import LabelSetup from './pages/LabelSetup'
import Reports from './pages/Reports'
import ComingSoon from './pages/ComingSoon'
import Layout from './components/Layout'
import type { PageKey } from './menu'
import './styles.css'

function Shell() {
  const { user, ready } = useAuth()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [navOpen, setNavOpen] = useState(false)

  if (!ready) return <main className="auth-shell-fallback"><p>กำลังโหลด…</p></main>
  if (!user) return <Login />

  return (
    <Layout page={page} onNavigate={setPage} navOpen={navOpen} setNavOpen={setNavOpen}>
      {page === 'dashboard' ? <Dashboard go={setPage} /> : page === 'stock' ? <Stock /> : page === 'molds' ? <Molds /> : page === 'repairs' ? <Repairs /> : page === 'label-setup' ? <LabelSetup /> : page === 'reports' ? <Reports /> : <ComingSoon page={page} go={setPage} />}
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
