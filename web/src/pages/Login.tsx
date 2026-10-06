import { useState, type FormEvent } from 'react'
import { apiLogin, type AuthUser } from '../api'
import { wfLogin } from '../wf'
import { useAuth } from '../auth'

export default function Login() {
  const { signin } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wfOnly, setWfOnly] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function doLogin(u: string, p: string) {
    setBusy(true)
    setError('')
    setWfOnly(false)
    try {
      try {
        const data = await apiLogin(u, p)
        try { await wfLogin(u, p) } catch { /* workflow ใช้ได้เมื่อ sidecar รัน */ }
        signin(data.token, data.user)
      } catch {
        // DEV fallback: Go API (port 8080) ไม่รัน — login ผ่าน workflow sidecar แทน
        const wf = await wfLogin(u, p)
        signin(wf.token, wf.user as AuthUser)
        setWfOnly(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    doLogin(username.trim(), password)
  }

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-top">
          <div className="brand-mark">M</div>
          <div>
            <b>MOLD STORE</b>
            <small>STORE MANAGEMENT SYSTEM</small>
          </div>
        </div>

        <div className="brand-hero">
          <span className="pill"><span className="dot" />ระบบพร้อมใช้งาน · P4R1 Mould Control</span>
          <h1>จัดการ<em>แม่พิมพ์</em><br />ง่าย ครบ จบในที่เดียว</h1>
          <p>รับเข้า · เบิก-คืน · ส่งซ่อม · ตรวจวัด · ปลดระวาง พร้อมภาพรวมสต๊อกแบบเรียลไทม์</p>
          <div className="feature-list">
            <div><b>📦 ทะเบียนแม่พิมพ์</b><span>รหัส / ชนิด / โลเคชัน / สถานะ</span></div>
            <div><b>🔄 เบิก-คืน</b><span>สแกนจ่าย-รับคืน รวดเร็ว</span></div>
            <div><b>🛠 ส่งซ่อม</b><span>ติดตามใบซ่อม P4R1 ได้ทุกขั้น</span></div>
            <div><b>📊 รายงาน</b><span>สต๊อกคงเหลือ / ประวัติ / ซ่อมค้าง</span></div>
          </div>
        </div>

        <div className="brand-foot">
          <span>© 2026 Mold Store · ฝ่ายผลิต</span>
          <span>v0.1 โครงสร้าง + Login + Dashboard</span>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <h2>ยินดีต้อนรับ 👋</h2>
          <p>เข้าสู่ระบบเพื่อจัดการคลังแม่พิมพ์ของคุณ</p>

          {error && <p className="form-error">{error}</p>}

          <label className="field">
            ชื่อผู้ใช้
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              placeholder="เช่น admin"
            />
          </label>

          <label className="field">
            รหัสผ่าน
            <span className="password-wrap">
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}>
                {showPw ? 'ซ่อน' : 'แสดง'}
              </button>
            </span>
          </label>

          <div className="form-row">
            <label><input type="checkbox" defaultChecked />จำฉันไว้</label>
            <span>ลืมรหัสผ่าน? ติดต่อ Admin</span>
          </div>

          <button className="btn-primary" disabled={busy}>
            {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ →'}
          </button>

          {wfOnly && (
            <p className="form-hint">⚙️ โหมดพัฒนา: เข้าสู่ระบบผ่าน workflow sidecar (Go API ไม่รัน)</p>
          )}

          <div className="demo-box">
            🧪 <b>บัญชีทดลอง</b> — กดเพื่อกรอกอัตโนมัติ
            <div className="demo-btns">
              <button type="button" onClick={() => { setUsername('admin'); setPassword('admin123') }}>
                Admin / admin123
              </button>
              <button type="button" onClick={() => { setUsername('tech01'); setPassword('tech123') }}>
                ช่าง / tech123
              </button>
            </div>
          </div>
        </form>
      </section>
    </main>
  )
}
