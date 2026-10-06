import { useEffect, useMemo, useState } from 'react'
import { wfDims, wfIntegrity, wfLive, wfRepairs, type IntegrityData, type LiveItem } from '../wf'
import { mergeLive, type Mold } from '../moldMeta'

interface Repair {
  source_no: string
  job_name: string
  priority: string | null
  status: 'open' | 'received'
  ordered_date: string | null
  month: number | null
  machine: string | null
}

function toCSV(rows: string[][]): string {
  return '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - first.getTime()) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const PERIODS = [
  ['day', 'รายวัน (14 วันล่าสุด)'],
  ['week', 'รายสัปดาห์ (12 สัปดาห์ล่าสุด)'],
  ['month', 'รายเดือน'],
  ['year', 'รายปี'],
] as const

export default function Reports() {
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [liveRepairs, setLiveRepairs] = useState<Record<string, string>>({})
  const [molds, setMolds] = useState<Mold[]>([])
  const [integrity, setIntegrity] = useState<IntegrityData | null>(null)
  const [liveOk, setLiveOk] = useState(false)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month')

  useEffect(() => {
    Promise.all([
      fetch('/data/repairs.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
      fetch('/data/molds.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
      wfRepairs('all').then((d) => d.repairs).catch(() => null),
      wfLive().then((d) => d).catch(() => null),
      wfDims().then((d) => d.dims).catch(() => undefined),
      wfIntegrity().then((d) => d).catch(() => null),
    ])
      .then(([rp, mj, lr, lv, dm, integ]) => {
        setRepairs(rp)
        const lvItems: LiveItem[] = lv ? lv.items : []
        setMolds(lv ? mergeLive(mj as Mold[], lvItems, dm) : mj)
        if (lr) {
          const m: Record<string, string> = {}
          for (const r of lr as { source_no: string; status: string }[]) m[r.source_no] = r.status
          setLiveRepairs(m)
          setLiveOk(true)
        }
        if (integ) setIntegrity(integ)
      })
      .catch(() => setError('โหลดข้อมูลรายงานไม่สำเร็จ — กรุณารัน tools/import_excel.py ก่อน'))
  }, [])

  // สถานะ live ทับค่าจากไฟล์ (เบิก/รับในระบบแล้วต้องนับตามจริง ไม่ตาม Excel เก่า)
  const liveStatus = useMemo(() => {
    const m = new Map<string, 'open' | 'received'>()
    for (const [no, st] of Object.entries(liveRepairs)) {
      if (st === 'open' || st === 'received') m.set(no, st)
    }
    return m
  }, [liveRepairs])

  const summary = useMemo(() => {
    const buckets = new Map<string, { open: number; received: number; total: number }>()
    const push = (k: string, st: string) => {
      const b = buckets.get(k) ?? { open: 0, received: 0, total: 0 }
      b.total += 1
      if (st === 'open') b.open += 1; else b.received += 1
      buckets.set(k, b)
    }
    repairs.forEach((r) => {
      if (!r.ordered_date) return
      const d = new Date(r.ordered_date)
      if (isNaN(d.getTime())) return
      const st = liveStatus.get(r.source_no) ?? r.status
      if (period === 'day') push(r.ordered_date.slice(0, 10), st)
      else if (period === 'week') push(weekKey(d), st)
      else if (period === 'month') push(r.ordered_date.slice(0, 7), st)
      else push(r.ordered_date.slice(0, 4), st)
    })
    const list = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const trimmed = period === 'day' ? list.slice(-14) : period === 'week' ? list.slice(-12) : list
    const max = Math.max(1, ...trimmed.map(([, v]) => v.total))
    return { list: trimmed, max }
  }, [repairs, period, liveStatus])

  const byType = useMemo(() => {
    const t: Record<string, { total: number; spare: number; installed: number; repair: number; retired: number }> = {}
    for (const m of molds) {
      const e = t[m.sheet] ?? (t[m.sheet] = { total: 0, spare: 0, installed: 0, repair: 0, retired: 0 })
      e.total += 1
      if (m.status === 'spare' || m.status === 'installed' || m.status === 'repair' || m.status === 'retired') e[m.status] += 1
    }
    return t
  }, [molds])

  if (error) return <div className="panel"><p className="form-error">{error}</p></div>
  if (!repairs.length) return <p className="loading">กำลังโหลดข้อมูลรายงาน…</p>

  const integRows: { label: string; n: number; hard: boolean; hint: string }[] = integrity ? [
    { label: 'รหัสไม่ตรงกัน (app/live)', n: (integrity.checks.codes_json_app_live?.app_not_live.length ?? 0) + (integrity.checks.codes_json_app_live?.live_not_app.length ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'สถานะไม่ตรงกัน', n: Number(integrity.checks.status_mismatch_n ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'เอกสารอ้างรหัสที่หาย', n: Number(integrity.checks.docitems_badref_n ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'โซ่ movement ขาด', n: Number(integrity.checks.chain_break_n ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'ปลายโซ่ไม่ตรง live', n: Number(integrity.checks.lastmv_live_mismatch_n ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'movement อ้างรหัสที่หาย', n: Number(integrity.checks.movements_orphan_n ?? 0), hard: true, hint: 'ต้องเป็น 0' },
    { label: 'ตัวซ่อมไม่มีใบค้าง', n: Number(integrity.checks.repair_no_open_paper_n ?? 0), hard: false, hint: 'ข้อมูลตั้งต้นจาก Excel' },
    { label: 'ใบค้างผูกตัวที่ไม่ได้ซ่อม', n: Number(integrity.checks.open_linked_not_repair_n ?? 0), hard: false, hint: 'ข้อมูลตั้งต้นจาก Excel' },
    { label: 'บนเครื่องแต่ไม่มีเครื่อง', n: Number(integrity.checks.installed_without_machine_n ?? 0), hard: false, hint: 'ข้อมูลตั้งต้นจาก Excel' },
  ] : []

  return (
    <>
      <section className="greet">
        <div>
          <h1>รายงานใบแจ้งซ่อม P4R1</h1>
          <p>สรุปจำนวนใบแจ้งซ่อม แยกค้าง / รับแล้ว · ทั้งหมด {repairs.length} ใบ{liveOk ? ' · สถานะ live ล่าสุด' : ''}</p>
        </div>
        <div className="greet-actions">
          <button
            className="btn-accent"
            onClick={() => download(`repair-summary-${period}.csv`, toCSV([
              [period === 'day' ? 'วันที่' : period === 'week' ? 'สัปดาห์' : period === 'month' ? 'เดือน' : 'ปี', 'ทั้งหมด', 'ค้าง', 'รับแล้ว'],
              ...summary.list.map(([k, v]) => [k, String(v.total), String(v.open), String(v.received)]),
            ]))}
          >
            ⬇ Export สรุป
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="tabs">
          {PERIODS.map(([k, label]) => (
            <button key={k} className={`tab${period === k ? ' active' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
          ))}
        </div>
        {summary.list.length === 0 && <p className="empty">ไม่มีข้อมูลในช่วงนี้</p>}
        <div className="sumlist">
          {summary.list.map(([k, v]) => (
            <div className="sumrow" key={k}>
              <span className="sumkey">{k}</span>
              <div className="bar big"><i style={{ width: `${Math.round((v.total / summary.max) * 100)}%` }} /></div>
              <span className="num">{v.total}</span>
              <span className="muted small">ค้าง {v.open} · รับแล้ว {v.received}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>สรุปสต๊อกแยกประเภท{liveOk ? ' (live)' : ''}</h3></div>
        <table>
          <thead><tr><th>ประเภท</th><th>รวม</th><th>สแปร์</th><th>บนเครื่อง</th><th>ส่งซ่อม</th><th>ยกเลิกใช้</th></tr></thead>
          <tbody>
            {Object.entries(byType).map(([t, v]) => (
              <tr key={t}>
                <td><b>{t}</b></td>
                <td className="num">{v.total}</td>
                <td className="num">{v.spare}</td>
                <td className="num">{v.installed}</td>
                <td><span className="badge repair">{v.repair} ซ่อม</span></td>
                <td className="num">{v.retired}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>ความถูกต้องความสัมพันธ์ข้อมูล {integrity && (integrity.ok ? '✅ ผ่านทั้งหมด' : '⚠️ มีจุดต้องดู')}</h3>
          {!integrity && <span className="muted small">ต้องรัน sidecar (port 8081)</span>}
        </div>
        {integrity ? (
          <table>
            <thead><tr><th>รายการตรวจ</th><th>พบ</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {integRows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{r.n === 0 ? <span className="badge spare">0</span> : <span className={`badge ${r.hard ? 'open' : 'repair'}`}>{r.n}</span>}</td>
                  <td className="muted small">{r.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">เชื่อม sidecar ไม่ได้ — แสดงเฉพาะข้อมูลไฟล์</p>
        )}
      </section>
    </>
  )
}
