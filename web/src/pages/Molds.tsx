import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { wfDims, wfLive, wfRegister } from '../wf'
import MoldLabel from '../components/MoldLabel'
import { loadLabelConfig, type LabelConfig } from '../labelConfig'
import {
  badgeClass, buildCode, DIM_COLS, HAS_GRADE, mergeLive, SHEETS,
  SHEET_TOOLING, SHEET_WORK, suggestNextNo, type Mold,
} from '../moldMeta'

// มิติที่เว้นว่างได้ (ของจริงใน Excel บางแถวไม่มีค่า)
const OPTIONAL_DIMS = new Set(['ความสูงบ่า', 'ความลึก'])

function numSort(a: string, b: string) {
  const na = /^\d+$/.test(a.trim()), nb = /^\d+$/.test(b.trim())
  if (na && nb) return parseInt(a, 10) - parseInt(b, 10)
  return a.localeCompare(b, 'th')
}

export default function Molds() {
  const { user } = useAuth()
  const allowed = user?.role === 'store' || user?.role === 'admin'

  const [molds, setMolds] = useState<Mold[]>([])
  const [loadError, setLoadError] = useState('')

  const [sheet, setSheet] = useState('')
  const [size, setSize] = useState('')
  const [newSizeMode, setNewSizeMode] = useState(false)
  const [newSize, setNewSize] = useState('')
  const [no, setNo] = useState('')
  const [noTouched, setNoTouched] = useState(false)
  const [dims, setDims] = useState<Record<string, string>>({})
  const [grade, setGrade] = useState('')
  const [remark, setRemark] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [result, setResult] = useState<{ doc_no: string; code: string } | null>(null)

  // popup ถามปริ้นใบแปะ + ตัวอย่างใบแปะ
  const [askPrint, setAskPrint] = useState(false)
  const [printView, setPrintView] = useState<'ask' | 'preview'>('ask')
  const [inspector, setInspector] = useState('')
  const [labelCfg, setLabelCfg] = useState<LabelConfig>(() => loadLabelConfig())
  const [savedDetail, setSavedDetail] = useState<{
    code: string; doc_no: string; sheet: string; size: string; no: string
    grade: string; remark: string; dims: Record<string, string | number>; date: string
  } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/data/molds.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
      wfLive().then((d) => d).catch(() => null),
      wfDims().then((d) => d.dims).catch(() => undefined),
    ])
      .then(([m, lv, dm]) => setMolds(lv ? mergeLive(m as Mold[], lv.items, dm) : m))
      .catch(() => setLoadError('โหลดข้อมูลสต็อกไม่สำเร็จ — กรุณารัน tools/import_excel.py ก่อน'))
  }, [])

  const effSize = newSizeMode ? newSize.trim() : size

  const sizes = useMemo(() => {
    const s = new Set<string>()
    molds.forEach((m) => { if (m.sheet === sheet) s.add(m.size) })
    return [...s].sort(numSort)
  }, [molds, sheet])

  const existing = useMemo(() => {
    if (!sheet || !effSize) return []
    return molds
      .filter((m) => m.sheet === sheet && m.size === effSize)
      .sort((a, b) => numSort(a.no, b.no) || a.code.localeCompare(b.code))
  }, [molds, sheet, effSize])

  const suggested = useMemo(() => suggestNextNo(existing), [existing])
  useEffect(() => { if (!noTouched) setNo(suggested) }, [suggested, noTouched])
  useEffect(() => { setSize(''); setNewSizeMode(false); setNewSize(''); setNo(''); setNoTouched(false); setDims({}); setGrade(''); setResult(null); setSaveError('') }, [sheet])
  useEffect(() => { setNo(''); setNoTouched(false); setResult(null); setSaveError('') }, [size, newSizeMode, newSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = sheet && effSize && no.trim() ? buildCode(sheet, effSize, no) : ''
  const duplicate = !!preview && molds.some((m) => m.code === preview)

  const dimCols = sheet ? DIM_COLS[sheet] ?? [] : []
  const showGrade = HAS_GRADE.has(sheet)
  const dimsReady = dimCols.filter((d) => !OPTIONAL_DIMS.has(d.key)).every((d) => (dims[d.key] ?? '').trim() !== '')
  const canSave = !!sheet && !!effSize && !!no.trim() && !duplicate && dimsReady && (!showGrade || grade !== '') && !saving

  function parseVal(v: string): string | number {
    const t = v.trim()
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : t
  }

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setSaveError('')
    try {
      const payload: Record<string, string | number> = {}
      for (const d of dimCols) {
        const v = (dims[d.key] ?? '').trim()
        if (v !== '') payload[d.key] = parseVal(v)
      }
      const r = await wfRegister({
        sheet, size: effSize, no: no.trim(), dims: payload,
        grade: showGrade ? grade : null, remark: remark.trim() || null,
      })
      const code = r.code
      setResult({ doc_no: r.doc_no, code })
      setSavedDetail({
        code, doc_no: r.doc_no, sheet, size: effSize, no: no.trim(),
        grade: showGrade ? grade : '', remark: remark.trim(),
        dims: payload,
        date: new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
      })
      setInspector(user?.username ?? '')
      setPrintView('ask')
      setAskPrint(true)
      // เติมเข้ารายการทันที (รันเลขตัวต่อไปได้เลยไม่ต้องรีเฟรช)
      setMolds((prev) => [...prev, r.entry as unknown as Mold])
      setNo('')
      setNoTouched(false)
      setDims({})
      setGrade('')
      setRemark('')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (!allowed) {
    return (
      <div className="panel placeholder">
        <div className="big">🔒</div>
        <h2>เฉพาะเจ้าหน้าที่ Store / Admin</h2>
        <p>การลงทะเบียนแม่พิมพ์ใหม่ต้องทำโดยเจ้าหน้าที่ Store หรือผู้ดูแลระบบ (คุณอยู่ในสิทธิ์ {user?.role})</p>
      </div>
    )
  }
  if (loadError) return <div className="panel"><p className="form-error">{loadError}</p></div>
  if (!molds.length) return <p className="loading">กำลังโหลดข้อมูลสต็อก…</p>

  return (
    <>
      <section className="greet">
        <div>
          <h1>ลงทะเบียนแม่พิมพ์ใหม่</h1>
          <p>ของสั่งซื้อใหม่ที่ยังไม่มีรหัส — เลือกชนิด + ไซส์ → ดูรหัสที่มี → รันเลขต่อ → กรอกค่าวัด</p>
        </div>
      </section>

      {result && (
        <section className="panel success-box">
          <b>✅ บันทึกแล้ว ใบ {result.doc_no}</b>
          <span>รหัสใหม่ <span className="r-no">{result.code}</span> เข้าสต๊อกสถานะสแปร์ — เห็นในหน้าเช็คสต็อกทันที</span>
          <div className="greet-actions"><button className="btn-secondary" onClick={() => setResult(null)}>ลงทะเบียนตัวต่อไป (ชนิด+ไซส์เดิม)</button></div>
        </section>
      )}

      <section className="panel">
        <div className="steps">
          <span className={sheet ? 'done' : 'active'}>1. ชนิด</span>
          <span className={!sheet ? '' : effSize ? 'done' : 'active'}>2. ไซส์ + รหัส</span>
          <span className={effSize && no.trim() && !duplicate ? 'active' : ''}>3. ค่าวัด</span>
        </div>
        <h3>1. เลือกชนิดแม่พิมพ์</h3>
        <div className="picklist">
          {SHEETS.map((s) => {
            const n = molds.filter((m) => m.sheet === s).length
            return (
              <label key={s} className={`pick${sheet === s ? ' active' : ''}`}>
                <input type="radio" name="sheet" checked={sheet === s} onChange={() => setSheet(s)} />
                <b>{s}</b><span className="muted">{SHEET_WORK[s]} · {SHEET_TOOLING[s]}</span>
                <span className="block-count">{n} ตัวในสต็อก</span>
              </label>
            )
          })}
        </div>
      </section>

      {sheet && (
        <section className="panel">
          <h3>2. เลือกไซส์ + รันรหัสต่อ</h3>
          <div className="toolbar">
            <select value={newSizeMode ? '__new' : size} onChange={(e) => {
              if (e.target.value === '__new') { setNewSizeMode(true); setSize('') } else { setNewSizeMode(false); setSize(e.target.value) }
            }}>
              <option value="">— เลือกไซส์ —</option>
              {sizes.map((s) => <option key={s} value={s}>SIZE {s} ({molds.filter((m) => m.sheet === sheet && m.size === s).length} ตัว)</option>)}
              <option value="__new">＋ SIZE ใหม่ (ของที่ไม่เคยมี)</option>
            </select>
            {newSizeMode && (
              <input placeholder="พิมพ์ SIZE ใหม่ เช่น 160" value={newSize} onChange={(e) => setNewSize(e.target.value)} />
            )}
          </div>

          {effSize && (
            existing.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>No.</th><th>รหัสที่มีอยู่</th><th>สถานะ</th></tr></thead>
                  <tbody>
                    {existing.map((m) => (
                      <tr key={m.code}>
                        <td className="num">{m.no}</td>
                        <td><span className="r-no">{m.code}</span></td>
                        <td><span className={`badge ${badgeClass(m.status)}`}>{m.status_th}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">ยังไม่มีรหัสใน {sheet} ไซส์ {effSize} — ตัวนี้จะเป็นตัวแรก</p>
            )
          )}

          {effSize && (
            <div className="form-grid">
              <label className="field">No. ของตัวใหม่ {suggested && !noTouched && <span className="muted">(แนะนำ {suggested} ต่อจากเลขมากสุด)</span>}
                <input value={no} onChange={(e) => { setNo(e.target.value); setNoTouched(true) }} placeholder={suggested || 'เช่น 6515'} />
              </label>
              <div className="field">รหัสที่จะได้
                <div className="code-preview">{preview || '—'}{duplicate && ' ⚠️ รหัสนี้มีแล้ว'}</div>
              </div>
            </div>
          )}
          {duplicate && <p className="form-error">รหัส {preview} มีอยู่ในระบบแล้ว — เปลี่ยน No. ใหม่</p>}
        </section>
      )}

      {effSize && no.trim() && !duplicate && (
        <section className="panel">
          <h3>3. กรอกตัวเลขค่าวัด (ตามคอลัมน์สต็อก{SHEET_TOOLING[sheet] ? ` ${sheet}` : ''})</h3>
          <div className="form-grid">
            {dimCols.map((d) => (
              <label className="field" key={d.key}>{d.short} {!OPTIONAL_DIMS.has(d.key) && <span className="req">*</span>}
                <input value={dims[d.key] ?? ''} onChange={(e) => setDims((p) => ({ ...p, [d.key]: e.target.value }))} placeholder="ตัวเลขที่วัดได้" inputMode="decimal" />
              </label>
            ))}
            {showGrade && (
              <label className="field">เกรด <span className="req">*</span>
                <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                  <option value="">— เลือก —</option>
                  <option value="พิเศษ">พิเศษ</option>
                  <option value="ธรรมดา">ธรรมดา</option>
                </select>
              </label>
            )}
            <label className="field">หมายเหตุ (ถ้ามี)
              <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="เช่น สั่งซื้อล็อต PO-…" />
            </label>
          </div>
          <div className="kpi-strip">
            <span>รหัส <b>{preview}</b></span>
            <span className="ok">เข้าสต๊อกเป็น <b>สแปร์</b></span>
            <span className="muted">ใบลงทะเบียนออกเลข REG-… อัตโนมัติ</span>
          </div>
          {saveError && <p className="form-error">{saveError}</p>}
          <div className="greet-actions" style={{ marginTop: 12 }}>
            <button className="btn-accent" disabled={!canSave} onClick={submit}>
              {saving ? 'กำลังบันทึก…' : `✅ บันทึก ${preview}`}
            </button>
          </div>
          {!dimsReady && <p className="muted small">กรอกค่าวัดที่มี * ให้ครบก่อนบันทึก (สูงบ่า/ความลึกเว้นได้ถ้าไม่มี)</p>}
        </section>
      )}

      {askPrint && savedDetail && (
        <div className="overlay" onClick={() => setAskPrint(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {printView === 'ask' ? (
              <>
                <div className="panel-head">
                  <h3>✅ บันทึกสำเร็จ {savedDetail.doc_no}</h3>
                  <button className="link" onClick={() => setAskPrint(false)}>ปิด ✕</button>
                </div>
                <p>รหัสใหม่ <span className="r-no">{savedDetail.code}</span> เข้าสต๊อกสถานะสแปร์แล้ว</p>
                <h2 style={{ margin: '8px 0 16px' }}>ต้องการปริ้นใบแปะแม่พิมพ์หรือไม่? 🖨</h2>
                <div className="greet-actions">
                  <button className="btn-accent" onClick={() => { setLabelCfg(loadLabelConfig()); setPrintView('preview') }}>🖨 ปริ้นใบแปะ</button>
                  <button className="btn-secondary" onClick={() => setAskPrint(false)}>ยังไม่ปริ้น</button>
                </div>
              </>
            ) : (
              <>
                <div className="panel-head no-print">
                  <h3>ตัวอย่างใบแปะแม่พิมพ์</h3>
                  <span className="muted small">ตามที่ตั้งค่าไว้ · ปริ้น {Math.min(5, Math.max(1, labelCfg.copies))} สำเนา</span>
                  <button className="link" onClick={() => setPrintView('ask')}>← กลับ</button>
                </div>
                <div className="print-area">
                  {Array.from({ length: Math.min(5, Math.max(1, labelCfg.copies)) }).map((_, i) => (
                    <div className="label-copy" key={i}>
                      <MoldLabel
                        detail={{
                          code: savedDetail.code, sheet: savedDetail.sheet, size: savedDetail.size,
                          no: savedDetail.no, grade: savedDetail.grade ?? '', remark: savedDetail.remark ?? '',
                          dims: savedDetail.dims as Record<string, string | number>, date: savedDetail.date,
                        }}
                        inspector={inspector}
                        config={labelCfg}
                      />
                    </div>
                  ))}
                </div>
                <label className="field no-print" style={{ marginTop: 12 }}>รหัสผู้ตรวจสอบ
                  <input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="เช่น admin" />
                </label>
                <div className="greet-actions no-print" style={{ marginTop: 12 }}>
                  <button className="btn-accent" onClick={() => window.print()}>🖨 สั่งปริ้น</button>
                  <button className="btn-secondary" onClick={() => setAskPrint(false)}>ปิด</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
