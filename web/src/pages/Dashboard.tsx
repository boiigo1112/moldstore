import { useEffect, useState } from 'react'
import { apiDashboard, type DashboardData } from '../api'
import { useAuth } from '../auth'
import type { PageKey } from '../menu'

const DEMO: DashboardData = {
  molds_total: 128,
  molds_by_status: { spare: 64, installed: 42, repair: 18, retired: 4 },
  molds_by_type: [
    { tooling_type: 'Blow Mould', spare: 18, installed: 12, repair: 5 },
    { tooling_type: 'Injection', spare: 14, installed: 10, repair: 4 },
    { tooling_type: 'Cap / Lid', spare: 12, installed: 8, repair: 3 },
    { tooling_type: 'Preform', spare: 9, installed: 6, repair: 2 },
    { tooling_type: 'Handle / Extra', spare: 6, installed: 4, repair: 2 },
    { tooling_type: 'Spare Parts', spare: 5, installed: 2, repair: 2 },
  ],
  repairs_open: 7,
  repairs_total: 23,
  recent_repairs: [
    { source_no: 'P4R1-0269', job_name: 'Blow Mould 5L – เปลี่ยน Pin', status: 'repair', ordered_date: '2026-09-28' },
    { source_no: 'P4R1-0268', job_name: 'Cap Mould 38mm – ขัดเงา', status: 'repair', ordered_date: '2026-09-25' },
    { source_no: 'P4R1-0265', job_name: 'Preform 12g – ซ่อม Heater', status: 'installed', ordered_date: '2026-09-20' },
  ],
}

const statusLabel: Record<string, string> = {
  spare: 'สแปร์ในคลัง',
  installed: 'ใช้งานบนเครื่อง',
  repair: 'อยู่ระหว่างซ่อม',
  retired: 'ปลดระวาง',
}

export default function Dashboard({ go }: { go: (p: PageKey) => void }) {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [usingDemo, setUsingDemo] = useState(false)

  useEffect(() => {
    apiDashboard()
      .then(setData)
      .catch(() => {
        setData(DEMO)
        setUsingDemo(true)
      })
  }, [])

  if (!data) return <p className="loading">กำลังโหลดภาพรวม…</p>

  const maxType = Math.max(...data.molds_by_type.map((t) => t.spare + t.installed + t.repair), 1)

  return (
    <>
      <section className="greet">
        <div>
          <h1>สวัสดี, {user?.display_name} 👋</h1>
          <p>
            {user?.role === 'admin' ? 'ภาพรวมการบริหารคลังวันนี้' : 'งานของช่างวันนี้'} ·
            อัปเดตล่าสุด {new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
            {usingDemo && ' · (โหมดตัวอย่าง — ยังไม่ต่อ API)'}
          </p>
        </div>
        <div className="greet-actions">
          <button className="btn-secondary" onClick={() => go('receive')}>📥 รับเข้า</button>
          <button className="btn-secondary" onClick={() => go('repairs')}>🛠 แจ้งซ่อม</button>
        </div>
      </section>

      <section className="kpis">
        <article className="kpi">
          <div className="k-head"><span>แม่พิมพ์ทั้งหมด</span><span className="k-ico">📦</span></div>
          <strong>{data.molds_total}</strong><small>ตัวในระบบ</small>
        </article>
        <article className="kpi green">
          <div className="k-head"><span>สแปร์ในคลัง</span><span className="k-ico">✅</span></div>
          <strong>{data.molds_by_status.spare ?? 0}</strong><small>พร้อมเบิก</small>
        </article>
        <article className="kpi blue">
          <div className="k-head"><span>ใช้งานบนเครื่อง</span><span className="k-ico">⚙️</span></div>
          <strong>{data.molds_by_status.installed ?? 0}</strong><small>ตัว</small>
        </article>
        <article className="kpi amber">
          <div className="k-head"><span>อยู่ระหว่างซ่อม</span><span className="k-ico">🛠</span></div>
          <strong>{data.molds_by_status.repair ?? 0}</strong><small>ตัว</small>
        </article>
        <article className="kpi red">
          <div className="k-head"><span>ใบส่งซ่อมค้าง</span><span className="k-ico">⏰</span></div>
          <strong>{data.repairs_open}</strong><small>จาก {data.repairs_total} ใบ</small>
        </article>
      </section>

      <section className="quick-grid">
        <button className="quick" onClick={() => go('stock')}><span className="q-ico">🔍</span><b>เช็คสต๊อก</b><span>ดูแบบ Excel / ค้นหา / รายละเอียด</span></button>
        <button className="quick" onClick={() => go('repairs')}><span className="q-ico">🛠</span><b>ติดตามใบซ่อม</b><span>{data.repairs_open} ใบค้างดำเนินการ</span></button>
        <button className="quick" onClick={() => go('reports')}><span className="q-ico">📑</span><b>ออกรายงาน</b><span>สต๊อก / เคลื่อนไหว / Excel</span></button>
      </section>

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3>สต๊อกตามชนิด (6 ชนิดหลัก P4R1)</h3>
            <button className="link" onClick={() => go('stock')}>ดูทั้งหมด →</button>
          </div>
          <table>
            <thead><tr><th>ชนิด</th><th>สแปร์</th><th>ประจำเครื่อง</th><th>ส่งซ่อม</th></tr></thead>
            <tbody>
              {data.molds_by_type.map((t) => {
                const total = t.spare + t.installed + t.repair
                return (
                  <tr key={t.tooling_type}>
                    <td>
                      <span className="type-row"><b>{t.tooling_type}</b><small>{total} ตัว · {Math.round((total / maxType) * 100)}% ของชนิดมากสุด</small></span>
                      <div className="bar"><i style={{ width: `${Math.round((total / maxType) * 100)}%` }} /></div>
                    </td>
                    <td className="num">{t.spare}</td>
                    <td className="num">{t.installed}</td>
                    <td><span className="badge repair">{t.repair} ซ่อม</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>ใบส่งซ่อมล่าสุด</h3>
            <button className="link" onClick={() => go('repairs')}>จัดการใบซ่อม →</button>
          </div>
          {data.recent_repairs.length ? (
            <ul className="repairs">
              {data.recent_repairs.map((r) => (
                <li key={r.source_no}>
                  <span className="r-no">{r.source_no}</span>
                  <span>
                    <div className="r-name">{r.job_name}</div>
                    <span className={`badge ${r.status === 'repair' ? 'open' : 'installed'}`}>
                      {statusLabel[r.status] ?? r.status}
                    </span>
                  </span>
                  <small>{r.ordered_date}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">ยังไม่มีใบส่งซ่อม 🎉</p>
          )}
        </div>
      </section>
    </>
  )
}
