import { useEffect, useMemo, useState } from 'react'
import { wfDims, wfLive } from '../wf'
import {
  badgeClass, DIM_COLS, download, fmt, HAS_GRADE, mergeLive, SHEETS, toCSV,
  type Mold,
} from '../moldMeta'

const STATUS_TABS = [
  { key: 'all', label: 'ทุกสถานะ' },
  { key: 'spare', label: 'สแปร์' },
  { key: 'installed', label: 'บนเครื่อง' },
  { key: 'repair', label: 'ส่งซ่อม' },
  { key: 'retired', label: 'ยกเลิกใช้' },
] as const

interface Block {
  block: number
  size: string
  rows: Mold[]
}

export default function Stock() {
  const [molds, setMolds] = useState<Mold[]>([])
  const [meta, setMeta] = useState<{ imported_at?: string } | null>(null)
  const [error, setError] = useState('')

  const [sheet, setSheet] = useState<string>('DIEP1')
  const [status, setStatus] = useState<string>('all')
  const [q, setQ] = useState('')
  const [machine, setMachine] = useState('all')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Mold | null>(null)
  const [liveAt, setLiveAt] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/data/molds.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
      fetch('/data/meta.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }).catch(() => null),
      wfLive().then((d) => d).catch(() => null),
      wfDims().then((d) => d.dims).catch(() => undefined),
    ])
      .then(([m, mt, lv, dm]) => {
        setMolds(lv ? mergeLive(m as Mold[], lv.items, dm) : m)
        if (lv) setLiveAt(lv.at)
        setMeta(mt)
      })
      .catch(() => setError('โหลดข้อมูลสต็อกไม่สำเร็จ — กรุณารัน tools/import_excel.py ก่อน'))
  }, [])

  useEffect(() => { setCollapsed(new Set()); setMachine('all') }, [sheet])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sheetMolds = useMemo(() => molds.filter((m) => m.sheet === sheet), [molds, sheet])

  const machines = useMemo(() => {
    const s = new Set<string>()
    sheetMolds.forEach((m) => { if (m.machine) s.add(m.machine) })
    return [...s].sort()
  }, [sheetMolds])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sheetMolds.filter((m) => {
      if (status !== 'all' && m.status !== status) return false
      if (machine !== 'all' && m.machine !== machine) return false
      if (!needle) return true
      return [m.no, m.size, m.machine ?? '', m.remark ?? '', m.grade ?? '', m.work_name]
        .join(' ').toLowerCase().includes(needle)
    })
  }, [sheetMolds, status, q, machine])

  const blocks: Block[] = useMemo(() => {
    const out: Block[] = []
    let cur: Block | null = null
    for (const m of filtered) {
      if (!cur || cur.block !== m.block) {
        cur = { block: m.block, size: m.size, rows: [] }
        out.push(cur)
      }
      cur.rows.push(m)
    }
    return out
  }, [filtered])

  const kpi = useMemo(() => {
    const c = { total: filtered.length, spare: 0, installed: 0, repair: 0, retired: 0 }
    filtered.forEach((m) => { c[m.status] += 1 })
    return c
  }, [filtered])

  const filtering = status !== 'all' || machine !== 'all' || q.trim() !== ''

  const toggle = (b: number) =>
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(b)) n.delete(b); else n.add(b)
      return n
    })

  const dims = DIM_COLS[sheet] ?? []
  const showGrade = HAS_GRADE.has(sheet)

  const exportCSV = () => {
    const head = ['ลำดับ', 'ชื่องาน', 'SIZE', 'No.', ...dims.map((d) => d.short)]
    if (showGrade) head.push('เกรด')
    head.push('สถานะ', 'เครื่องที่ใช้', 'หมายเหตุ')
    download(`stock-${sheet}.csv`, toCSV([
      head,
      ...filtered.map((m) => {
        const row = [String(m.seq), m.work_name, m.size, m.no, ...dims.map((d) => fmt(m.dims[d.key]))]
        if (showGrade) row.push(fmt(m.grade))
        row.push(m.status_th, m.machine ?? '', m.remark ?? '')
        return row
      }),
    ]))
  }

  if (error) return <div className="panel"><p className="form-error">{error}</p></div>
  if (!molds.length) return <p className="loading">กำลังโหลดข้อมูลสต็อกแม่พิมพ์…</p>

  return (
    <>
      <section className="greet">
        <div>
          <h1>เช็คสต๊อกแม่พิมพ์</h1>
          <p>
            แสดงแบบเดียวกับไฟล์ Excel · อัปเดตเมื่อ{' '}
            {meta?.imported_at ? new Date(meta.imported_at).toLocaleString('th-TH') : '-'}
            {liveAt ? <> · <span className="badge spare">● LIVE {new Date(liveAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></> : ' · (สถานะจากไฟล์)'}
            {' '}· กดที่แถวเพื่อดูรายละเอียด
          </p>
        </div>
        <div className="greet-actions">
          <button className="btn-secondary" onClick={() => setCollapsed(new Set(blocks.map((b) => b.block)))}>พับทั้งหมด</button>
          <button className="btn-secondary" onClick={() => setCollapsed(new Set())}>กางทั้งหมด</button>
          <button className="btn-accent" onClick={exportCSV}>⬇ Export CSV</button>
        </div>
      </section>

      <section className="panel">
        <div className="tabs sheet-tabs">
          {SHEETS.map((s) => (
            <button key={s} className={`tab${sheet === s ? ' active' : ''}`} onClick={() => setSheet(s)}>
              {s} ({molds.filter((m) => m.sheet === s).length})
            </button>
          ))}
        </div>
        <div className="chips">
          {STATUS_TABS.map((t) => (
            <button key={t.key} className={`chip${status === t.key ? ' active' : ''}`} onClick={() => setStatus(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <label className="search inline">🔍<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา No. / SIZE / เครื่อง / หมายเหตุ…" /></label>
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="all">ทุกเครื่อง ({machines.length})</option>
            {machines.map((mc) => <option key={mc} value={mc}>{mc}</option>)}
          </select>
        </div>
        <div className="kpi-strip">
          <span>รวม <b>{kpi.total}</b> ตัว</span>
          <span className="ok">สแปร์ <b>{kpi.spare}</b></span>
          <span className="info">บนเครื่อง <b>{kpi.installed}</b></span>
          <span className="warn">ส่งซ่อม <b>{kpi.repair}</b></span>
          {kpi.retired > 0 && <span className="bad">ยกเลิกใช้ <b>{kpi.retired}</b></span>}
        </div>
      </section>

      {filtered.length === 0 && (
        <div className="panel"><p className="empty">ไม่พบข้อมูลตามเงื่อนไข ลองล้างคำค้นหรือตัวกรอง</p></div>
      )}

      {blocks.map((b) => {
        const isClosed = collapsed.has(b.block)
        const c = { spare: 0, installed: 0, repair: 0, retired: 0 }
        b.rows.forEach((m) => { c[m.status] += 1 })
        return (
          <section className="panel sheet-block" key={`${sheet}-${b.block}`}>
            <button className="block-head" onClick={() => toggle(b.block)}>
              <span className="block-toggle">{isClosed ? '▶' : '▼'}</span>
              <span className="block-title">SIZE {b.size}</span>
              <span className="block-count">{b.rows.length} ตัว</span>
              <span className="block-break">
                สแปร์ {c.spare} · บนเครื่อง {c.installed} · ส่งซ่อม {c.repair}{c.retired > 0 && ` · ยกเลิก ${c.retired}`}
              </span>
            </button>
            {!isClosed && (
              <div className="table-wrap">
                <table className="excel">
                  <thead>
                    <tr>
                      <th>ลำดับ</th><th>ชื่อชิ้นงาน</th><th>SIZE</th><th>No.</th>
                      {dims.map((d) => <th key={d.key}>{d.short}</th>)}
                      {showGrade && <th>เกรด</th>}
                      <th>สถานะ</th><th>เครื่องที่ใช้</th><th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((m) => (
                      <tr key={m.code} onClick={() => setSelected(m)} className="clickable">
                        <td className="c">{m.seq}</td>
                        <td>{m.work_name}</td>
                        <td><b>{m.size}</b></td>
                        <td className="num">{m.no}</td>
                        {dims.map((d) => <td key={d.key} className="num">{fmt(m.dims[d.key])}</td>)}
                        {showGrade && <td>{fmt(m.grade)}</td>}
                        <td><span className={`badge ${badgeClass(m.status)}`}>{m.status_th}</span></td>
                        <td>{m.machine ?? <span className="muted">—</span>}</td>
                        <td className="muted">{m.remark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="block-foot">
                  รวม {b.rows.length} ตัว
                  {filtering ? ' (ตามเงื่อนไขที่กรอง)' : ''}
                  {' '}— สแปร์ {c.spare} · บนเครื่อง {c.installed} · ส่งซ่อม {c.repair}{c.retired > 0 && ` · ยกเลิกใช้ ${c.retired}`}
                </div>
              </div>
            )}
          </section>
        )
      })}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>รายละเอียดแม่พิมพ์</h3>
              <button className="link" onClick={() => setSelected(null)}>ปิด ✕</button>
            </div>
            <div className="detail-grid">
              <div><span>รหัส</span><b>{selected.code}</b></div>
              <div><span>ประเภท</span><b>{selected.sheet} · {selected.tooling_type}</b></div>
              <div><span>SIZE / No.</span><b>{selected.size} / {selected.no}</b></div>
              <div><span>สถานะ</span><span className={`badge ${badgeClass(selected.status)}`}>{selected.status_th}</span></div>
              <div><span>เครื่องที่ใช้</span><b>{selected.machine ?? '—'}</b></div>
              <div><span>หมายเหตุ</span><b>{selected.remark ?? '—'}</b></div>
              {showGrade && <div><span>เกรด</span><b>{fmt(selected.grade)}</b></div>}
              {dims.map((d) => (
                <div key={d.key}><span>{d.short}</span><b>{fmt(selected.dims[d.key])}</b></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
