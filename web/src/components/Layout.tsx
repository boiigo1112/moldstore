import type { ReactNode } from 'react'
import { useAuth } from '../auth'
import { MENU_GROUPS, PAGE_META, type PageKey } from '../menu'

interface Props {
  page: PageKey
  onNavigate: (p: PageKey) => void
  navOpen: boolean
  setNavOpen: (v: boolean) => void
  children: ReactNode
}

export default function Layout({ page, onNavigate, navOpen, setNavOpen, children }: Props) {
  const { user, signout } = useAuth()
  const meta = PAGE_META[page]
  const initial = (user?.display_name || user?.username || 'U').slice(0, 1).toUpperCase()

  return (
    <div className={`app-frame${navOpen ? ' nav-open' : ''}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <aside className="sidebar">
        <div className="side-brand">
          <div className="brand-mark">M</div>
          <div>
            <b>MOLD STORE</b>
            <small>STORE MANAGEMENT</small>
          </div>
        </div>

        <div className="side-user">
          <div className="avatar">{initial}</div>
          <div>
            <b>{user?.display_name}</b>
            <span>{user?.username} · {user?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ช่าง'}</span>
          </div>
        </div>

        <nav className="nav">
          {MENU_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items
                .filter((it) => !(it.adminOnly && user?.role !== 'admin'))
                .map((it) => (
                  <button
                    key={it.key}
                    className={`nav-item${page === it.key ? ' active' : ''}`}
                    onClick={() => {
                      onNavigate(it.key)
                      setNavOpen(false)
                    }}
                  >
                    <span className="ico">{it.icon}</span>
                    {it.label}
                    {it.key === 'repairs' && <span className="tag">ค้าง</span>}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <button className="btn-ghost" onClick={signout}>⏻ ออกจากระบบ</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setNavOpen(!navOpen)}>☰</button>
          <div>
            <div className="crumbs">Mold Store / {meta.title}</div>
            <h2>{meta.title}</h2>
            <p>{meta.sub}</p>
          </div>
          <label className="search">🔍<input placeholder="ค้นหารหัสแม่พิมพ์ / ใบซ่อม…" /></label>
          <div className="top-actions">
            <button className="icon-btn" title="การแจ้งเตือน">🔔<i>3</i></button>
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  )
}
