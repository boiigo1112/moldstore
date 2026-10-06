import { Fragment, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import {
  wfCreateRepair, wfDeleteRepair, wfDims, wfDocs, wfLive, wfReconcileRepair, wfReceiveRepair, wfRepairs, wfUpdateRepair,
  type WfDoc, type WfRepair,
} from '../wf'
import { badgeClass, buildCode, DIM_COLS, mergeLive, SHEETS, SHEET_TOOLING, type Mold } from '../moldMeta'
import RepairSlip from '../components/RepairSlip'
import SlipFit from '../components/SlipFit'
import MoldLabel from '../components/MoldLabel'
import { loadLabelConfig, type LabelConfig } from '../labelConfig'
import type { InspectionInput } from '../wf'

function todayLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

interface Hist {
  source_no: string; job_name: string; pattern_code: string | null
  priority: string | null; ordered_date: string | null; due_date: string | null
  received_date: string | null; month: number | null; machine: string | null
  requester: string | null; receiver: string | null
  qty: string | null; unit: string | null
  detail: string | null; size_ref: string | null
  link: { sheet: string | null; size: string | null; no_list: string[]; linked_codes: string[]; link_status: string; link_note: string | null; group: string; ambiguous: Record<string, string[]>; groups: { size: string | null; nos: string[]; linked: string[]; unnumbered: number }[] }
}

interface Row {
  source_no: string; job_name: string; status: string; ordered_date: string | null
  priority: string; pattern_code: string | null; machine: string | null
  requester: string | null; receiver: string | null; received_date: string | null
  qty: string | null; unit: string | null; due_date: string | null
  department: string | null; remark: string | null; job_type: string
  detail: string | null; size_ref: string | null; actor: string | null
  linked_codes: string[]; link_note: string | null; isNew: boolean
  link_sheet: string | null; link_size: string | null; link_nos: string[]
  link_groups: { size: string | null; nos: string[]; linked: string[]; unnumbered: number }[]
  group: string
}

interface PatternEntry {
  group: string; sheet: string | null; size_label: string; size_key: string; pattern: string
}

const PRIO_CLASS: Record<string, string> = { 'ปกติ': 'installed', 'ด่วน': 'repair', 'ด่วนมาก': 'open' }
const PAGE_SIZE = 20

function codesFromLines(lines: string | null): string[] {
  if (!lines) return []
  return lines.split(',').map((p) => p.split(':')[0].trim()).filter(Boolean)
}

/** แยก base กับ ID ท้าย SIZE: "129ID92" -> {base:"129", id:"ID92"} ; "211OD115" -> {base:"211OD115", id:null} */
function parseSizeId(size: string): { base: string; id: string | null } {
  const t = (size ?? '').replace(/\s+/g, '')
  const m = t.match(/ID\d+$/i)
  if (m && m.index !== undefined && t.slice(0, m.index)) {
    return { base: t.slice(0, m.index), id: m[0].toUpperCase() }
  }
  return { base: t, id: null }
}

export interface ResolvedSlipNo {
  no: string; code: string | null; status: Mold['status'] | null; fuzzy: boolean
  ambiguous?: string[]
}

/** แกะชนิด/ไซส์/No. จากใบส่งซ่อม แล้วเทียบกับทะเบียนแม่พิมพ์ — คืนผลราย No.
 *  กฎปลอดภัย (ID/OD-aware): ตรงเป๊ะ > ID ตรงกัน > ชีทที่ไม่แยก ID (DIE-style) >
 *  slip ไม่ระบุ ID แต่เหลือตัวเลือกเดียวและไม่มี ID > นอกนั้นกำกวม/ไม่พบ (ห้ามเดา) */
function resolveSlipCodes(
  sheet: string | null, size: string | null, nos: string[],
  byCode: Record<string, Mold>,
): ResolvedSlipNo[] {
  if (!sheet || !size) return []
  interface Ent { size: string; base: string; id: string | null; code: string }
  const baseIdx = new Map<string, Ent[]>()
  const sheetHasId = new Set<string>()
  const sizesBySheet = new Map<string, Set<string>>()
  for (const m of Object.values(byCode)) {
    const sz = (m.size ?? '').replace(/\s+/g, '')
    const p = parseSizeId(sz)
    const k = `${m.sheet}\n${p.base}\n${(m.no ?? '').trim()}`
    const arr = baseIdx.get(k)
    const e = { size: sz, base: p.base, id: p.id, code: m.code }
    if (arr) arr.push(e); else baseIdx.set(k, [e])
    if (p.id) sheetHasId.add(m.sheet)
    let ss = sizesBySheet.get(m.sheet)
    if (!ss) { ss = new Set(); sizesBySheet.set(m.sheet, ss) }
    ss.add(sz)
  }
  const sizeSp = (size ?? '').replace(/\s+/g, '')
  const sp = parseSizeId(sizeSp)
  const statusOf = (code: string) => byCode[code]?.status ?? null
  return (nos ?? []).map((rawNo) => {
    const no = (rawNo ?? '').trim()
    if (!no) return { no: rawNo, code: null, status: null, fuzzy: false }
    const direct = byCode[buildCode(sheet, sizeSp, no)]
    if (direct) return { no, code: direct.code, status: direct.status, fuzzy: false }
    const cands = baseIdx.get(`${sheet}\n${sp.base}\n${no}`) ?? []
    if (sp.id) {
      const same = cands.filter((c) => c.id === sp.id)
      if (same.length) return { no, code: same[0].code, status: statusOf(same[0].code), fuzzy: same[0].size !== sizeSp }
      if (!sheetHasId.has(sheet) && cands.length === 1 && !cands[0].id) {
        return { no, code: cands[0].code, status: statusOf(cands[0].code), fuzzy: true }
      }
      return { no, code: null, status: null, fuzzy: false }
    }
    const noId = cands.filter((c) => !c.id)
    if (cands.length === 1 && noId.length === 1) {
      return { no, code: cands[0].code, status: statusOf(cands[0].code), fuzzy: cands[0].size !== sizeSp }
    }
    if (cands.length) return { no, code: null, status: null, fuzzy: false, ambiguous: cands.map((c) => c.code) }
    // fallback สุดท้าย: SIZE อ่านไม่ครบ (เช่น '300-1H/F…') -> เสนอตัวที่ขึ้นต้นตรงกันให้เลือกเองเท่านั้น
    if (sizeSp.length >= 3) {
      const opts: string[] = []
      for (const s of sizesBySheet.get(sheet) ?? []) {
        if (s === sizeSp || !s.startsWith(sizeSp)) continue
        const cd = byCode[buildCode(sheet, s, no)]?.code
        if (cd && !opts.includes(cd)) opts.push(cd)
      }
      if (opts.length) return { no, code: null, status: null, fuzzy: false, ambiguous: opts }
    }
    return { no, code: null, status: null, fuzzy: false }
  })
}

export interface ResolvedGroup {
  size: string | null
  nos: string[]
  unnumbered: number
  items: ResolvedSlipNo[]
}

/** เทียบทีละกลุ่ม SIZE (ใบเดียวมีได้หลายกลุ่ม เช่น S.150 ID100 / S.150 ID108) */
function resolveSlipGroups(
  sheet: string | null,
  groups: { size: string | null; nos: string[]; unnumbered?: number }[],
  byCode: Record<string, Mold>,
): ResolvedGroup[] {
  if (!sheet) return []
  return (groups ?? [])
    .filter((g) => g && (g.size || (g.nos ?? []).length || (g.unnumbered ?? 0) > 0))
    .map((g) => ({
      size: g.size ?? null,
      nos: g.nos ?? [],
      unnumbered: g.unnumbered ?? 0,
      items: g.size ? resolveSlipCodes(sheet, g.size, g.nos ?? [], byCode) : [],
    }))
}

interface InspEntry { dims: Record<string, string>; verdict: 'pass' | 'fail' }

function RecvWorksheet({ target, molds, insp, setInsp, busy, error, onClose, onConfirm, onReconcile, reconciling }: {
  target: Row
  molds: Record<string, Mold>
  insp: Record<string, InspEntry>
  setInsp: React.Dispatch<React.SetStateAction<Record<string, InspEntry>>>
  busy: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
  onReconcile: (codes: string[]) => void
  reconciling: boolean
}) {
  const linkedRepair = target.linked_codes.filter((c) => molds[c]?.status === 'repair')
  const skipped = target.linked_codes.filter((c) => molds[c] && molds[c].status !== 'repair')
  // ใบเก่าผูกติดแต่ของไม่ได้ค้างซ่อม: แยกตัวที่ส่งซ่อมต่อได้ (spare/installed) ออกจากตัวที่ปลดระวางแล้ว
  const staleActionable = skipped.filter((c) => molds[c]?.status === 'spare' || molds[c]?.status === 'installed')
  const staleRetired = skipped.filter((c) => molds[c]?.status === 'retired')
  const staleCard = target.job_type !== 'new' && target.linked_codes.length > 0 && skipped.length > 0 && (
    <div className="insp-card" style={{ borderStyle: 'dashed', borderColor: 'var(--amber)' }}>
      <div className="insp-head"><b>⚠️ ใบกับสต็อกไม่ตรงกัน (ข้อมูลเก่า)</b></div>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        ใบนี้ผูกแม่พิมพ์ไว้ {target.linked_codes.length} ตัว แต่ไม่มีตัวไหนค้างซ่อมอยู่ — สถานะปัจจุบัน:
      </p>
      <ul className="repairs">
        {skipped.map((c) => {
          const m = molds[c]
          return (
            <li key={c}>
              <span className="r-no">{c}</span>
              <span>{m?.status_th ?? m?.status ?? '—'}</span>
              {m?.machine && <span className="muted small">{m.machine}</span>}
            </li>
          )
        })}
      </ul>
      {staleRetired.length > 0 && (
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          {staleRetired.length} ตัวถูกปลดระวางแล้ว ไม่สามารถส่งซ่อมได้ ({staleRetired.join(', ')})
        </p>
      )}
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        ถ้าของยังอยู่ที่ช่างซ่อมจริง กดส่งซ่อมตามใบนี้ แล้วตรวจรับต่อได้ทันที — ถ้าของกลับมาแล้วแต่ลืมปิดใบ ให้กดปิดใบอย่างเดียวด้านล่าง
      </p>
      <div className="greet-actions">
        {staleActionable.length > 0 && (
          <button className="btn-accent" disabled={reconciling} onClick={() => onReconcile(staleActionable)}>
            {reconciling ? 'กำลังบันทึก…' : `🔧 ส่งซ่อมตามใบนี้ (${staleActionable.length} ตัว)`}
          </button>
        )}
      </div>
    </div>
  )
  // ใบที่ผูกไม่ติด/ผูกไม่ครบ: แกะทีละกลุ่ม SIZE เทียบทะเบียน
  const resolvedGroups: (ResolvedGroup & { key: string })[] = target.job_type !== 'new' && target.link_sheet
    ? resolveSlipGroups(
        target.link_sheet,
        target.link_groups.length
          ? target.link_groups.map((g) => ({ size: g.size, nos: g.nos ?? [], unnumbered: g.unnumbered ?? 0 }))
          : [{ size: target.link_size, nos: target.link_nos ?? [], unnumbered: 0 }],
        molds,
      )
        .map((g, i) => ({ ...g, key: `${g.size ?? ''}#${i}` }))
        .filter((g) => g.items.some((r) => !r.code) || g.unnumbered > 0)
    : []
  const resolved = resolvedGroups.flatMap((g) => g.items)
  // ตัวที่ตรวจ = ผูกตรง + ตัวที่แกะได้และติ๊กไว้ (มีใน insp)
  const extraRepair = Object.keys(insp).filter((c) => !target.linked_codes.includes(c) && molds[c]?.status === 'repair')
  const toInspect = [...linkedRepair, ...extraRepair.filter((c) => !linkedRepair.includes(c))]
  // ใบผูกไม่ติด: โชว์กล่องเทียบเสมอ (มีเหตุผลบอก) — simple เฉพาะงานสร้างใหม่/ไม่มีอะไรให้เทียบเลย
  const showResolveBox = target.job_type !== 'new' && (target.linked_codes.length === 0 || resolvedGroups.length > 0)
  const simple = target.job_type === 'new' || (toInspect.length === 0 && !showResolveBox)

  const pickAmbiguous = (cands: string[], code: string) => {
    setInsp((p) => {
      const n = { ...p }
      for (const c of cands) delete n[c]
      const m = code ? molds[code] : undefined
      if (code && m && m.status === 'repair') {
        const dims: Record<string, string> = {}
        for (const d of DIM_COLS[m.sheet] ?? []) {
          const v = m.dims[d.key]
          dims[d.key] = v === undefined || v === null ? '' : String(v)
        }
        n[code] = { dims, verdict: 'pass' as const }
      }
      return n
    })
  }

  const noSheet = !target.link_sheet
  const noRef = !noSheet && !(target.link_nos ?? []).length

  const toggleResolved = (code: string) => {
    const m = molds[code]
    if (!m) return
    setInsp((p) => {
      if (p[code]) {
        const n = { ...p }
        delete n[code]
        return n
      }
      const dims: Record<string, string> = {}
      for (const d of DIM_COLS[m.sheet] ?? []) {
        const v = m.dims[d.key]
        dims[d.key] = v === undefined || v === null ? '' : String(v)
      }
      return { ...p, [code]: { dims, verdict: 'pass' as const } }
    })
  }

  const setDim = (code: string, key: string, v: string) =>
    setInsp((p) => ({ ...p, [code]: { dims: { ...(p[code]?.dims ?? {}), [key]: v }, verdict: p[code]?.verdict ?? 'pass' } }))
  const setVerdict = (code: string, v: 'pass' | 'fail') =>
    setInsp((p) => ({ ...p, [code]: { dims: p[code]?.dims ?? {}, verdict: v } }))

  const ready = toInspect.every((c) => {
    const m = molds[c]
    const cols = DIM_COLS[m?.sheet ?? ''] ?? []
    const e = insp[c]
    return e && cols.every((d) => (e.dims[d.key] ?? '').trim() !== '')
  })
  const passN = toInspect.filter((c) => (insp[c]?.verdict ?? 'pass') === 'pass').length
  const failN = toInspect.length - passN

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>📋 ตรวจรับจากซ่อม — {target.source_no}</h3>
          <button className="link" onClick={onClose}>ปิด ✕</button>
        </div>
        {(target.requester || target.receiver) && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            👤 {[target.requester && `ผู้สั่ง: ${target.requester}`, target.receiver && `ผู้รับ: ${target.receiver}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {simple ? (
          target.job_type === 'new' ? (
            <p className="empty">
              ใบงานสร้างใหม่ — จะปิดเฉพาะเอกสาร ไม่เปลี่ยนสถานะแม่พิมพ์ที่อ้างอิง
            </p>
          ) : target.linked_codes.length > 0 ? (
            // ผูกติดแต่ของไม่ได้ค้างซ่อม: ไม่ใช่ "ไม่ผูก" — โชว์สถานะจริง + ให้ทางออก
            <>{staleCard}</>
          ) : (
            <p className="empty">
              ใบนี้ไม่ผูกตัวแม่พิมพ์ในทะเบียน (งานนอกทะเบียน) — จะปิดเฉพาะเอกสาร
            </p>
          )
        ) : (
          <>
            {staleCard}
            {resolvedGroups.length > 0 && resolvedGroups.map((g) => (
              <div className="insp-card" style={{ borderStyle: 'dashed' }} key={g.key}>
                <div className="insp-head">
                  <b>🔍 เทียบจากข้อมูลในใบ</b>
                  <span className="muted small">
                    {target.link_sheet}{g.size ? ` · SIZE ${g.size}` : ''}{g.nos.length ? ` · No. ${g.nos.join(', ')}` : ''}
                    {g.unnumbered > 0 && ` · ไม่ระบุ No. ${g.unnumbered} ตัว`}
                  </span>
                </div>
                {g.items.map((r, i) => {
                  if (r.code) {
                    const m = molds[r.code]
                    const checked = !!insp[r.code]
                    const canCheck = m?.status === 'repair'
                    return (
                      <label key={i} className="pick" style={{ opacity: !canCheck ? 0.75 : 1 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canCheck}
                          onChange={() => toggleResolved(r.code!)}
                        />
                        <b>No.{r.no}</b>
                        <span className="r-no">{r.code}</span>
                        <span className="muted small">{m?.status}{r.fuzzy ? ' · เทียบแบบยืดหยุ่น' : ''}{!canCheck ? ' · ไม่ได้ค้างซ่อม' : ''}</span>
                      </label>
                    )
                  }
                  if (r.ambiguous?.length) {
                    const picked = r.ambiguous.find((c) => insp[c])
                    return (
                      <div key={i} className="pick" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <b>No.{r.no}</b>
                        <span className="muted small">เจอหลายตัว — เลือกตัวที่ส่งซ่อมจริง:</span>
                        <select
                          value={picked ?? ''}
                          onChange={(e) => pickAmbiguous(r.ambiguous!, e.target.value)}
                          style={{ flex: 1, minWidth: 200 }}
                        >
                          <option value="">— เลือก —</option>
                          {r.ambiguous.map((c) => {
                            const m = molds[c]
                            const ok = m?.status === 'repair'
                            return <option key={c} value={c} disabled={!ok}>{c} ({m?.status ?? '?'})</option>
                          })}
                        </select>
                      </div>
                    )
                  }
                  return (
                    <div key={`${g.key}#${i}`} className="pick" style={{ opacity: 0.75 }}>
                      <b>No.{r.no}</b>
                      <span className="muted small">ไม่พบในทะเบียน — SIZE/No. นี้ไม่มีข้อมูลจริง</span>
                    </div>
                  )
                })}
                {g.unnumbered > 0 && (
                  <div className="pick" style={{ opacity: 0.75 }}>
                    <span className="muted small">＋ อีก {g.unnumbered} ตัวในใบไม่ระบุ No. — ตรวจนับหน้างาน</span>
                  </div>
                )}
              </div>
            ))}
            {resolvedGroups.length === 0 && target.job_type !== 'new' && target.linked_codes.length === 0 && (
              <div className="insp-card" style={{ borderStyle: 'dashed' }}>
                <div className="insp-head"><b>🔍 เทียบจากข้อมูลในใบ</b></div>
                {noSheet ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    ชื่องาน “{target.job_name}” ไม่อยู่ในทะเบียน 4 ชนิด (DIEP1/PUNCHP1/PUNCHP3/DIEP3) — ไม่มีข้อมูลแม่พิมพ์ให้เทียบในระบบ
                  </p>
                ) : noRef ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    ใบนี้ไม่ระบุเลข No. — เทียบหาตัวแม่พิมพ์ไม่ได้
                  </p>
                ) : (
                  <p className="muted small" style={{ margin: 0 }}>เทียบไม่พบในทะเบียน</p>
                )}
              </div>
            )}
            <p className="muted small" style={{ margin: '0 0 8px' }}>
              วัดค่าวัดใหม่ทุกตัวเทียบสเปคเดิม · ผ่าน {passN} → สแปร์ · ไม่ผ่าน {failN} → ของเสีย
              {skipped.length > 0 && <> · ข้าม {skipped.length} ตัว (ไม่ได้ค้างซ่อมแล้ว)</>}
            </p>
            {toInspect.map((c) => {
              const m = molds[c]
              if (!m) return null
              const cols = DIM_COLS[m.sheet] ?? []
              const e = insp[c] ?? { dims: {}, verdict: 'pass' as const }
              return (
                <div className="insp-card" key={c}>
                  <div className="insp-head">
                    <b className="r-no">{c}</b>
                    <span className="muted small">{m.sheet} · SIZE {m.size} · No.{m.no}</span>
                    <span className="seg" style={{ marginLeft: 'auto' }}>
                      <button className={`chip${e.verdict === 'pass' ? ' active' : ''}`} onClick={() => setVerdict(c, 'pass')}>✅ ผ่าน</button>
                      <button className={`chip danger${e.verdict === 'fail' ? ' active' : ''}`} onClick={() => setVerdict(c, 'fail')}>❌ ไม่ผ่าน</button>
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table className="excel compact">
                      <thead><tr><th>มิติ</th><th>ค่าเดิม</th><th>วัดใหม่ *</th><th>ผลต่าง</th></tr></thead>
                      <tbody>
                        {cols.map((d) => {
                          const old = m.dims[d.key]
                          const oldS = old === undefined || old === null ? '—' : String(old)
                          const nv = e.dims[d.key] ?? ''
                          const on = parseFloat(oldS), nn = parseFloat(nv)
                          const bothNum = nv.trim() !== '' && !isNaN(on) && !isNaN(nn)
                          const diff = bothNum ? nn - on : null
                          const changed = nv.trim() !== '' && (diff === null ? nv.trim() !== oldS : diff !== 0)
                          return (
                            <tr key={d.key}>
                              <td>{d.short}</td>
                              <td className="num muted">{oldS}</td>
                              <td>
                                <input
                                  className="dim-input"
                                  value={nv}
                                  inputMode="decimal"
                                  onChange={(ev) => setDim(c, d.key, ev.target.value)}
                                  placeholder="—"
                                />
                              </td>
                              <td className={`num ${diff === null || diff === 0 ? 'muted' : 'delta'}`}>
                                {nv.trim() === '' ? '—' : diff === null ? (changed ? '•' : '=') : diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${diff}`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="greet-actions" style={{ marginTop: 12 }}>
          <button className="btn-accent" disabled={busy || (!simple && !ready)} onClick={onConfirm}>
            {busy ? 'กำลังบันทึก…' : (simple || toInspect.length === 0) ? '✅ ยืนยันปิดใบ' : `✅ ยืนยันรับกลับ (ผ่าน ${passN} · เสีย ${failN})`}
          </button>
          <button className="btn-secondary" onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  )
}

/** หมวดหมู่ชื่องาน (mirror แบบย่อของ import — ใช้เฉพาะใบออกในระบบที่ยังไม่มีใน hist) */
function groupOfJob(job: string, sheet: string | null): string {
  if (sheet === 'DIEP1' || sheet === 'DIEP3') return 'DIE CUTTER'
  if (sheet === 'PUNCHP1' || sheet === 'PUNCHP3') return 'PUNCH CUTTER'
  const key = (job ?? '').replace(/\s+/g, '').toUpperCase()
  if (!key) return 'ไม่ระบุ'
  const kws: [string, string][] = [
    ['PRESSURERING', 'PRESSURE RING'], ['REDRAW', 'REDRAW'], ['แหวนรอง', 'แหวนรอง'],
    ['CENTERCORE', 'CORE'],
    ['DIECORE', 'CORE'], ['PUNCHHOLDER', 'HOLDER'], ['HOLDER', 'HOLDER'],
    ['TRIMMING', 'TRIMMING'], ['BLANK', 'BLANK'], ['BOTTOMKNIFE', 'KNIFE'],
    ['KNIFE', 'KNIFE'], ['LOCKNUT', 'NUT'], ['LOOKNUT', 'NUT'], ['NUT', 'NUT'],
    ['DIESHOE', 'SHOE'], ['SHOE', 'SHOE'], ['GRIPPER', 'GRIPPER'], ['EJECTOR', 'EJECTOR'],
    ['BUSH', 'บูช'], ['บูช', 'บูช'], ['STRIPPER', 'RING'], ['KNOCK', 'RING'],
    ['SLEEVE', 'CORE'], ['RING', 'RING'], ['DIESET', 'DIE SET'], ['PLATE', 'PLATE'],
    ['COMPRESS', 'PLATE'], ['STRIP', 'PLATE'], ['UPPER', 'PLATE'], ['LOWER', 'PLATE'],
    ['BASE', 'PLATE'], ['ROLLER', 'PLATE'], ['SUPPORT', 'PLATE'], ['BALANCE', 'PLATE'],
    ['CORE', 'CORE'], ['PUNCHCENTER', 'CORE'], ['SHAFT', 'เพลา'], ['เพลา', 'เพลา'],
    ['GEAR', 'เฟือง'], ['เฟือง', 'เฟือง'], ['ดุม', 'ดุม'],
    ['M16', 'สกรู'], ['น็อต', 'สกรู'], ['สลัก', 'สลัก'],
    ['ก้านธง', 'ทั่วไป'], ['ลิ่ม', 'ลิ่ม'], ['สายพาน', 'สายพาน'], ['ฝัก', 'ฝัก'], ['พูลเลย์', 'พูลเลย์'],
    ['RULLEY', 'พูลเลย์'], ['เครื่องมือวัด', 'เครื่องมือวัด'],
  ]
  for (const [kw, g] of kws) if (key.includes(kw)) return g
  return 'อื่น ๆ'
}

function noKey(no: string): [number, number, string] {
  const t = (no || '').trim()
  return /^\d+$/.test(t) ? [0, parseInt(t, 10), t] : [1, 0, t]
}

/** สร้างสายอ้างอิงแบบ Excel จากรหัสที่ผูก: S.{size} No.{no1},{no2} (fallback ตอนใบใหม่ยังไม่มีใน Excel) */
function sizeRefFromCodes(codes: string[], byCode: Record<string, Mold>): string | null {
  if (!codes.length) return null
  const groups = new Map<string, { sheet: string; size: string; nos: string[] }>()
  for (const c of codes) {
    const m = byCode[c]
    if (!m) continue
    const k = `${m.sheet}\n${m.size}`
    let g = groups.get(k)
    if (!g) { g = { sheet: m.sheet, size: m.size, nos: [] }; groups.set(k, g) }
    g.nos.push(m.no)
  }
  if (!groups.size) return null
  return [...groups.values()]
    .map((g) => `S.${g.size} No.${[...new Set(g.nos)].sort((a, b) => {
      const ka = noKey(a), kb = noKey(b)
      return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : 1)
    }).join(',')}`)
    .join(' + ')
}

export default function Repairs() {
  const { user } = useAuth()
  const canReceive = user?.role === 'store' || user?.role === 'admin'
  const canEdit = user?.role === 'store' || user?.role === 'admin'
  const isAdmin = user?.role === 'admin'

  const [hist, setHist] = useState<Record<string, Hist>>({})
  const [patterns, setPatterns] = useState<PatternEntry[]>([])
  const [live, setLive] = useState<WfRepair[]>([])
  const [docs, setDocs] = useState<WfDoc[]>([])
  const [molds, setMolds] = useState<Mold[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<'open' | 'history'>('open')
  const [q, setQ] = useState('')
  const [prio, setPrio] = useState('all')
  const [grp, setGrp] = useState('all')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // modal ออกใบใหม่ — ฟอร์ม 12 หัวข้อ (เลือกได้หลายตัวในใบเดียว ต้องชนิด+SIZE เดียวกัน)
  const [showNew, setShowNew] = useState(false)
  const [jobType, setJobType] = useState<'repair' | 'new'>('repair')
  const [orderDate, setOrderDate] = useState(todayLocal)
  const [dueDate, setDueDate] = useState('')
  const [jobName, setJobName] = useState('')
  const [fSheet, setFSheet] = useState('')
  const [fSize, setFSize] = useState('')
  const [patternCode, setPatternCode] = useState('')
  const [mq, setMq] = useState('')
  const [manualNo, setManualNo] = useState('')
  const [selCodes, setSelCodes] = useState<string[]>([])
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('ตัว')
  const [nPrio, setNPrio] = useState('ปกติ')
  const [requester, setRequester] = useState('')
  const [machineIn, setMachineIn] = useState('')
  const [dept, setDept] = useState('กระป๋อง 2 ชิ้น')
  const [detail, setDetail] = useState('')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ repair_no: string; codes: string[]; size_ref: string | null } | null>(null)
  const [formError, setFormError] = useState('')

  // รับกลับ + ตรวจวัดรายตัว
  const [recvTarget, setRecvTarget] = useState<Row | null>(null)
  const [recvBusy, setRecvBusy] = useState(false)
  const [recvError, setRecvError] = useState('')
  const [insp, setInsp] = useState<Record<string, { dims: Record<string, string>; verdict: 'pass' | 'fail' }>>({})
  // ผลรับกลับ + พิมพ์ใบแปะใหม่
  const [recvDone, setRecvDone] = useState<{ source_no: string; passed: { code: string; dims: Record<string, string | number> }[]; failed: string[] } | null>(null)
  const [inspector, setInspector] = useState('')
  const [labelCfg, setLabelCfg] = useState<LabelConfig>(() => loadLabelConfig())

  function openRecv(r: Row) {
    setRecvTarget(r)
    setRecvError('')
    setInspector(user?.username ?? '')
    setLabelCfg(loadLabelConfig())
    const init: Record<string, { dims: Record<string, string>; verdict: 'pass' | 'fail' }> = {}
    const addInit = (c: string) => {
      const m = moldByCode[c]
      if (!m || m.status !== 'repair' || init[c]) return
      const dims: Record<string, string> = {}
      for (const d of DIM_COLS[m.sheet] ?? []) {
        const v = m.dims[d.key]
        dims[d.key] = v === undefined || v === null ? '' : String(v)
      }
      init[c] = { dims, verdict: 'pass' }
    }
    for (const c of r.linked_codes) addInit(c)
    // แกะทีละกลุ่ม SIZE เทียบทะเบียน แล้วติ๊กตัวที่ค้างซ่อมให้อัตโนมัติ
    if (r.job_type !== 'new' && r.link_sheet) {
      const gs = r.link_groups.length
        ? r.link_groups
        : [{ size: r.link_size, nos: r.link_nos, unnumbered: 0 }]
      for (const g of gs) {
        if (!g.size) continue
        for (const res of resolveSlipCodes(r.link_sheet, g.size, g.nos ?? [], moldByCode)) {
          if (res.code) addInit(res.code)
        }
      }
    }
    setInsp(init)
  }

  function parseNum(v: string): string | number {
    const t = v.trim()
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : t
  }

  // แก้ไขใบซ่อม
  const [editTarget, setEditTarget] = useState<Row | null>(null)
  const [eJob, setEJob] = useState('')
  const [ePrio, setEPrio] = useState('ปกติ')
  const [eOrdered, setEOrdered] = useState('')
  const [eDue, setEDue] = useState('')
  const [eRequester, setERequester] = useState('')
  const [eMachine, setEMachine] = useState('')
  const [eDept, setEDept] = useState('')
  const [eQty, setEQty] = useState('')
  const [eUnit, setEUnit] = useState('ตัว')
  const [ePattern, setEPattern] = useState('')
  const [eDetail, setEDetail] = useState('')
  const [eRemark, setERemark] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')

  // ลบใบซ่อม
  const [delTarget, setDelTarget] = useState<Row | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')

  function openEdit(r: Row) {
    setEditTarget(r)
    setEJob(r.job_name)
    setEPrio(r.priority)
    setEOrdered(r.ordered_date ?? '')
    setEDue(r.due_date ?? '')
    setERequester(r.requester ?? '')
    setEMachine(r.machine ?? '')
    setEDept(r.department ?? '')
    setEQty(r.qty ?? '')
    setEUnit(r.unit ?? 'ตัว')
    setEPattern(r.pattern_code ?? '')
    setEDetail(r.detail ?? '')
    setERemark(r.remark ?? '')
    setEditError('')
  }

  async function submitEdit() {
    if (!editTarget || editBusy) return
    setEditBusy(true)
    setEditError('')
    try {
      await wfUpdateRepair(editTarget.source_no, {
        job_name: eJob.trim() || null,
        priority: ePrio,
        ordered_date: eOrdered || null,
        due_date: eDue || null,
        requester: eRequester.trim() || null,
        machine: eMachine.trim() || null,
        department: eDept.trim() || null,
        qty: eQty.trim() || '1',
        unit: eUnit.trim() || 'ตัว',
        pattern_code: ePattern.trim() || null,
        detail: eDetail.trim() || null,
        remark: eRemark.trim() || null,
      })
      setEditTarget(null)
      await reload()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setEditBusy(false)
    }
  }

  async function confirmDelete() {
    if (!delTarget || delBusy) return
    setDelBusy(true)
    setDelError('')
    try {
      await wfDeleteRepair(delTarget.source_no, delTarget.linked_codes)
      setDelTarget(null)
      await reload()
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDelBusy(false)
    }
  }

  // พิมพ์ใบนำส่งซ่อม
  const [slipTarget, setSlipTarget] = useState<Row | null>(null)
  const [zoom, setZoom] = useState<number | null>(null) // null = พอดีจอ
  const [fitScale, setFitScale] = useState(0.6)

  function openSlip(r: Row) {
    setSlipTarget(r)
    setZoom(null)
  }

  const curScale = zoom ?? fitScale
  const zoomPct = Math.round(curScale * 100)
  function zoomIn() { setZoom((Math.min(curScale * 1.2, 3))) }
  function zoomOut() { setZoom((Math.max(curScale / 1.2, 0.15))) }

  async function reload() {
    try {
      const [hj, lr, dj, mj, lv, pj, dm] = await Promise.all([
        fetch('/data/repairs.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
        wfRepairs('all').then((d) => d.repairs),
        wfDocs('P4R', 500).then((d) => d.docs).catch(() => [] as WfDoc[]),
        fetch('/data/molds.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }),
        wfLive().then((d) => d).catch(() => null),
        fetch('/data/patterns.json').then((r) => { if (!r.ok) throw new Error(); return r.json() }).catch(() => []),
        wfDims().then((d) => d.dims).catch(() => undefined),
      ])
      const hm: Record<string, Hist> = {}
      for (const h of hj as Hist[]) hm[h.source_no] = h
      setHist(hm)
      setPatterns(pj as PatternEntry[])
      setLive(lr)
      setDocs(dj)
      setMolds(lv ? mergeLive(mj as Mold[], lv.items, dm) : mj)
      setError('')
    } catch {
      setError('โหลดข้อมูลใบซ่อมไม่สำเร็จ — ตรวจว่า sidecar (port 8081) รันอยู่')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])
  useEffect(() => { setPage(1); setExpanded(new Set()) }, [tab, q, prio, grp])

  const docByNo = useMemo(() => {
    const m: Record<string, WfDoc> = {}
    for (const d of docs) m[d.doc_no] = d
    return m
  }, [docs])

  const moldByCode = useMemo(() => {
    const m: Record<string, Mold> = {}
    for (const x of molds) m[x.code] = x
    return m
  }, [molds])

  const rows: Row[] = useMemo(() => {
    return live.map((r) => {
      const h = hist[r.source_no]
      const d = docByNo[r.source_no]
      const linked = h?.link.linked_codes?.length ? h.link.linked_codes : codesFromLines(d?.lines ?? null)
      const linkedSheets = [...new Set(linked.map((c) => moldByCode[c]?.sheet).filter(Boolean))]
      const linkSheet = linkedSheets.length === 1 ? (linkedSheets[0] as string) : null
      return {
        source_no: r.source_no,
        job_name: r.job_name,
        status: r.status,
        ordered_date: r.ordered_date,
        priority: h?.priority || d?.priority || 'ปกติ',
        pattern_code: h?.pattern_code ?? d?.pattern_code ?? null,
        machine: h?.machine ?? d?.machine ?? null,
        requester: h?.requester ?? d?.requester ?? null,
        receiver: h?.receiver ?? r.receiver ?? null,
        received_date: h?.received_date ?? r.received_date ?? null,
        qty: h?.qty ?? d?.qty ?? null,
        unit: h?.unit ?? d?.unit ?? null,
        due_date: h?.due_date ?? d?.due_date ?? null,
        department: d?.department ?? null,
        remark: d?.remark ?? null,
        job_type: d?.job_type || 'repair',
        detail: h?.detail ?? d?.note ?? null,
        size_ref: h?.size_ref ?? sizeRefFromCodes(linked, moldByCode),
        actor: d?.actor ?? null,
        linked_codes: linked,
        link_note: h?.link.link_status && h.link.link_status !== 'linked' ? h.link.link_note : null,
        isNew: !h,
        link_sheet: h?.link.sheet ?? null,
        link_size: h?.link.size ?? null,
        link_nos: h?.link.no_list ?? [],
        link_groups: h?.link.groups ?? (h ? [{
          size: h.link.size ?? null,
          nos: h.link.no_list ?? [],
          linked: h.link.linked_codes ?? [],
          unnumbered: 0,
        }] : []),
        group: h?.link.group ?? groupOfJob(r.job_name, linkSheet),
      }
    })
  }, [live, hist, docByNo])

  const openRows = useMemo(() => rows.filter((r) => r.status === 'open'), [rows])
  const histRows = useMemo(() => rows.filter((r) => r.status !== 'open'), [rows])
  const urgentOpen = useMemo(() => openRows.filter((r) => r.priority !== 'ปกติ').length, [openRows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (tab === 'open' ? openRows : histRows).filter((r) => {
      if (prio !== 'all' && r.priority !== prio) return false
      if (grp !== 'all' && r.group !== grp) return false
      if (!needle) return true
      return [r.source_no, r.job_name, r.pattern_code ?? '', r.size_ref ?? '', r.machine ?? '', r.detail ?? '',
        r.requester ?? '', r.receiver ?? '', r.actor ?? '', r.received_date ?? '']
        .join(' ').toLowerCase().includes(needle)
    })
  }, [tab, openRows, histRows, q, prio, grp])

  const groups = useMemo(() => {
    const c = new Map<string, number>()
    for (const r of (tab === 'open' ? openRows : histRows)) c.set(r.group, (c.get(r.group) ?? 0) + 1)
    return [...c.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
  }, [tab, openRows, histRows])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const candidates = useMemo(() => {
    const needle = mq.trim().toLowerCase()
    return molds
      .filter((m) => {
        if (fSheet && m.sheet !== fSheet) return false
        if (fSize && m.size !== fSize) return false
        if (jobType === 'repair' && m.status !== 'spare' && m.status !== 'installed') return false
        return true
      })
      .filter((m) => !needle || [m.code, m.size, m.no, m.tooling_type].join(' ').toLowerCase().includes(needle))
      .slice(0, 30)
  }, [molds, mq, fSheet, fSize, jobType])

  // แคตตาล็อก: SIZE -> รหัสแบบ — หลักจาก master sheet รหัสแบบ (ข้อมูลจริง), เสริมด้วยประวัติ P4R1
  const masterIndex = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of patterns) {
      if (!p.sheet || !p.size_key || !p.pattern) continue
      const k = `${p.sheet}||${p.size_key}`
      let arr = map.get(k)
      if (!arr) { arr = []; map.set(k, arr) }
      if (!arr.includes(p.pattern)) arr.push(p.pattern)
    }
    return map
  }, [patterns])

  const suggestedPatterns = useMemo(() => {
    if (!fSheet || !fSize) return []
    const out: string[] = []
    const push = (p: string) => { if (!out.includes(p)) out.push(p) }
    // 1. master ตรงเป๊ะ
    const exact = masterIndex.get(`${fSheet}||${fSize}`) ?? []
    exact.forEach(push)
    // 2. master แบบนำหน้า (เช่น key 211 กับ SIZE 211OD115) — ยาวสุดก่อน จำกัด 3 กลุ่ม
    if (!exact.length) {
      const cands = [...masterIndex.entries()]
        .filter(([k]) => k.startsWith(fSheet + '||'))
        .filter(([k]) => {
          const key = k.split('||')[1]
          return key.length >= 3 && fSize.startsWith(key)
        })
        .sort((a, b) => b[0].length - a[0].length)
        .slice(0, 3)
      for (const [, arr] of cands) arr.forEach(push)
    }
    // 3. เสริมด้วยประวัติ P4R1
    for (const h of Object.values(hist)) {
      if (h.pattern_code && h.link.sheet === fSheet && h.link.size === fSize) push(h.pattern_code)
    }
    return out
  }, [fSheet, fSize, masterIndex, hist])

  const sizeOptions = useMemo(() => {
    const s = new Set<string>()
    molds.forEach((m) => { if (!fSheet || m.sheet === fSheet) s.add(m.size) })
    const numFirst = (a: string, b: string) => {
      const na = /^\d+$/.test(a.trim()), nb = /^\d+$/.test(b.trim())
      if (na && nb) return parseInt(a, 10) - parseInt(b, 10)
      return a.localeCompare(b, 'th')
    }
    return [...s].sort(numFirst)
  }, [molds, fSheet])

  const jobNameOptions = useMemo(() => {
    const s = new Set<string>(Object.values(SHEET_TOOLING))
    for (const h of Object.values(hist)) {
      if (h.job_name && s.size < 60) s.add(h.job_name)
    }
    return [...s]
  }, [hist])

  const deptOptions = useMemo(() => {
    const s = new Set<string>(['กระป๋อง 2 ชิ้น'])
    for (const d of docs) {
      if (d.department && d.department.trim()) s.add(d.department.trim())
    }
    return [...s]
  }, [docs])

  const selMolds = useMemo(
    () => selCodes.map((c) => moldByCode[c]).filter(Boolean) as Mold[],
    [selCodes, moldByCode],
  )

  function toggleExpand(no: string) {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(no)) n.delete(no); else n.add(no)
      return n
    })
  }

  function openNewModal() {
    setCreated(null)
    setFormError('')
    setJobType('repair')
    setOrderDate(todayLocal())
    setDueDate('')
    setJobName('')
    setFSheet('')
    setFSize('')
    setPatternCode('')
    setSelCodes([])
    setMq('')
    setManualNo('')
    setQty('1')
    setUnit('ตัว')
    setNPrio('ปกติ')
    setRequester(user?.username ?? '')
    setMachineIn('')
    setQtyTouched(false)
    setMachineTouched(false)
    setDept('กระป๋อง 2 ชิ้น')
    setDetail('')
    setRemark('')
    setShowNew(true)
  }

  function toggleSel(code: string) {
    setSelCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }

  function addManualNo() {
    const no = manualNo.trim()
    if (!no || !fSheet || !fSize) return
    const code = buildCode(fSheet, fSize, no)
    const m = moldByCode[code]
    if (!m) {
      setFormError(`ไม่พบรหัส ${code} ในทะเบียน`)
      return
    }
    if (jobType === 'repair' && m.status !== 'spare' && m.status !== 'installed') {
      setFormError(`${code} ส่งซ่อมไม่ได้ (สถานะ: ${m.status_th})`)
      return
    }
    setFormError('')
    setSelCodes((prev) => (prev.includes(code) ? prev : [...prev, code]))
    setManualNo('')
  }

  const selGroups = useMemo(() => {
    const s = new Set(selMolds.map((m) => `${m.sheet} / SIZE ${m.size}`))
    return [...s]
  }, [selMolds])
  const selMixed = selGroups.length > 1
  const selSizeRef = useMemo(() => sizeRefFromCodes(selCodes, moldByCode), [selCodes, moldByCode])
  const [qtyTouched, setQtyTouched] = useState(false)

  // จำนวน = จำนวนตัวที่เลือก (จนกว่าจะพิมพ์เอง) · เครื่อง = ตัวแรกที่คาเครื่อง (จนกว่าจะพิมพ์เอง)
  const [machineTouched, setMachineTouched] = useState(false)
  useEffect(() => {
    if (!qtyTouched) setQty(String(selCodes.length || 1))
    if (!machineTouched) {
      const onMac = selMolds.find((m) => m.machine)
      setMachineIn(onMac?.machine ?? '')
    }
  }, [selCodes, selMolds, qtyTouched, machineTouched])

  async function submitNew() {
    if (busy) return
    if (jobType === 'repair' && !selCodes.length) {
      setFormError('งานซ่อมกรุณาเลือกแม่พิมพ์อย่างน้อย 1 ตัว')
      return
    }
    if (selMixed) return
    if (!orderDate) {
      setFormError('กรุณาระบุวันที่สั่งซ่อม')
      return
    }
    setBusy(true)
    setFormError('')
    try {
      const r = await wfCreateRepair({
        mold_codes: selCodes,
        priority: nPrio,
        detail: detail.trim() || null,
        pattern_code: patternCode.trim() || null,
        job_type: jobType,
        job_name: jobName.trim() || null,
        order_date: orderDate,
        due_date: dueDate || null,
        requester: requester.trim() || null,
        machine: machineTouched ? (machineIn.trim() || null) : undefined,
        department: dept.trim() || null,
        remark: remark.trim() || null,
        qty: parseInt(qty, 10) || 0,
        unit: unit.trim() || null,
      })
      setCreated({ repair_no: r.repair_no, codes: r.codes, size_ref: r.size_ref })
      await reload()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function confirmReceive() {
    if (!recvTarget || recvBusy) return
    const withInsp = recvTarget.job_type !== 'new' && Object.keys(insp).length > 0
    setRecvBusy(true)
    setRecvError('')
    try {
      let inspections: InspectionInput[] | undefined
      if (withInsp) {
        inspections = Object.entries(insp).map(([code, e]) => ({
          mold_code: code,
          dims: Object.fromEntries(Object.entries(e.dims).map(([k, v]) => [k, parseNum(v)])),
          verdict: e.verdict,
        }))
      }
      const r = await wfReceiveRepair(
        recvTarget.source_no,
        withInsp ? Object.keys(insp) : recvTarget.linked_codes,
        inspections,
      )
      const passed = (r.received_codes ?? []).map((code) => ({
        code,
        dims: Object.fromEntries(
          Object.entries(insp[code]?.dims ?? {}).map(([k, v]) => [k, parseNum(v)]),
        ) as Record<string, string | number>,
      }))
      setRecvTarget(null)
      await reload()
      if (withInsp) setRecvDone({ source_no: recvTarget.source_no, passed, failed: r.retired_codes ?? [] })
    } catch (e) {
      setRecvError(e instanceof Error ? e.message : 'รับกลับไม่สำเร็จ')
    } finally {
      setRecvBusy(false)
    }
  }

  const [reconciling, setReconciling] = useState(false)

  async function confirmReconcile(codes: string[]) {
    if (!recvTarget || reconciling || !codes.length) return
    setReconciling(true)
    setRecvError('')
    try {
      await wfReconcileRepair(recvTarget.source_no, codes)
      // optimistic: ใส่ insp ให้ตัวที่เพิ่งส่งซ่อม แล้วโหลดข้อมูลจริงทับ
      setInsp((prev) => {
        const n = { ...prev }
        for (const c of codes) {
          if (n[c]) continue
          const m = moldByCode[c]
          if (!m) continue
          const dims: Record<string, string> = {}
          for (const d of DIM_COLS[m.sheet] ?? []) {
            const v = m.dims[d.key]
            dims[d.key] = v === undefined || v === null ? '' : String(v)
          }
          n[c] = { dims, verdict: 'pass' as const }
        }
        return n
      })
      await reload()
    } catch (e) {
      setRecvError(e instanceof Error ? e.message : 'ส่งซ่อมตามใบไม่สำเร็จ')
    } finally {
      setReconciling(false)
    }
  }

  if (loading) return <p className="loading">กำลังโหลดใบส่งซ่อม…</p>
  if (error) return <div className="panel"><p className="form-error">{error}</p></div>

  return (
    <>
      <section className="greet">
        <div>
          <h1>แจ้งซ่อม / ส่งซ่อม 🛠</h1>
          <p>สมุดคุม P4R — กดที่แถวเพื่อดูรายละเอียด · ค้าง {openRows.length} ใบ (ด่วน {urgentOpen}) · รับแล้ว {histRows.length} ใบ</p>
        </div>
        <div className="greet-actions">
          <button className="btn-accent" onClick={openNewModal}>＋ ออกใบแจ้งซ่อม</button>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={`tab${tab === 'open' ? ' active' : ''}`} onClick={() => setTab('open')}>คิวค้าง ({openRows.length})</button>
            <button className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>ประวัติรับแล้ว ({histRows.length})</button>
          </div>
          <label className="search inline">🔍<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ / รายการ / รหัสแบบ…" /></label>
          <select value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="all">ทุกระดับ</option>
            <option value="ปกติ">ปกติ</option>
            <option value="ด่วน">ด่วน</option>
            <option value="ด่วนมาก">ด่วนมาก</option>
          </select>
          <select value={grp} onChange={(e) => setGrp(e.target.value)}>
            <option value="all">ทุกหมวดหมู่</option>
            {groups.map((g) => <option key={g.name} value={g.name}>{g.name} ({g.n})</option>)}
          </select>
        </div>

        {!pageRows.length && <p className="empty">ไม่มีใบซ่อมตามเงื่อนไข</p>}
        {!!pageRows.length && (
          <div className="table-wrap">
            <table className="excel compact">
              <thead>
                <tr><th style={{ width: 30 }}></th><th>เลขที่ / รายการ</th><th>ระดับ</th><th>วันที่สั่ง</th><th>สถานะ</th><th>ตัวที่ผูก</th><th>รับงาน</th><th style={{ width: 210 }}>จัดการ</th></tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <Fragment key={r.source_no}>
                    <tr className={`clickable${expanded.has(r.source_no) ? ' expanded' : ''}`} onClick={() => toggleExpand(r.source_no)}>
                      <td className="c exp">{expanded.has(r.source_no) ? '▾' : '▸'}</td>
                      <td>
                        <span className="r-no">{r.source_no}</span>{' '}
                        <span className="pill-count" title={`หมวดหมู่: ${r.group}`}>{r.group}</span>{' '}
                        <b>{r.job_name}</b>
                        {r.isNew && <span className="sub"> · ออกในระบบ</span>}
                        <div className="sub">{[r.size_ref, r.machine].filter(Boolean).join(' · ') || '—'}</div>
                        {(r.requester || r.receiver || r.actor) && (
                          <div className="sub">👤 {[r.requester && `ผู้สั่ง: ${r.requester}`, r.receiver && `ผู้รับ: ${r.receiver}`, !r.requester && !r.receiver && r.actor && `ผู้แจ้ง: ${r.actor}`].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td><span className={`badge ${PRIO_CLASS[r.priority] ?? 'installed'}`}>{r.priority}</span></td>
                      <td className="num">{r.ordered_date ?? '—'}</td>
                      <td>{r.status === 'open'
                        ? <span className="badge repair">ซ่อม</span>
                        : <span className="badge spare">รับแล้ว</span>}</td>
                      <td>
                        {r.linked_codes.length
                          ? <span className="pill-count" title={r.linked_codes.join(', ')}>🔗 {r.linked_codes.length} ตัว</span>
                          : <span className="muted small">{r.link_note ? 'นอกทะเบียน' : '—'}</span>}
                      </td>
                      <td>
                        {r.status === 'open'
                          ? <span className="muted small">—</span>
                          : <><b className="num">{r.received_date ?? '—'}</b>{r.receiver && <div className="sub">👤 {r.receiver}</div>}</>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span className="row-actions">
                          <button className="btn-mini ghost" onClick={() => openSlip(r)} title="พิมพ์ใบนำส่งซ่อม">🖨</button>
                          {canEdit && <button className="btn-mini ghost" onClick={() => openEdit(r)} title="แก้ไขใบซ่อม">✏️</button>}
                          {isAdmin && <button className="btn-mini danger" onClick={() => { setDelTarget(r); setDelError('') }} title="ลบใบซ่อม">🗑</button>}
                          {tab === 'open' && canReceive && (
                            <button className="btn-mini" onClick={() => openRecv(r)}>รับกลับ+ตรวจ</button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {expanded.has(r.source_no) && (
                      <tr className="detail-row">
                        <td></td>
                        <td colSpan={7}>
                          <div className="detail-grid">
                            <div><span>ประเภทงาน</span><b>{r.job_type === 'new' ? 'งานสร้างใหม่' : 'งานซ่อม'}</b></div>
                            <div><span>กำหนดเสร็จ</span><b>{r.due_date ?? '—'}</b></div>
                            <div><span>ชื่อผู้สั่ง (ผู้ส่ง)</span><b>{r.requester ?? '—'}</b></div>
                            <div><span>ผู้รับงาน (ผู้รับ)</span><b>{r.receiver ?? '—'}</b></div>
                            <div><span>วันที่รับงาน</span><b>{r.received_date ?? (r.status === 'open' ? 'ยังไม่ได้รับ (ซ่อม)' : '—')}</b></div>
                            <div><span>รหัสแบบ</span><b>{r.pattern_code ?? '—'}</b></div>
                            <div><span>เครื่อง</span><b>{r.machine ?? '—'}</b></div>
                            <div><span>ผู้แจ้ง</span><b>{r.actor ?? '—'}</b></div>
                            <div><span>SIZE อ้างอิง</span><b>{r.size_ref ?? '—'}</b></div>
                            <div><span>จำนวน</span><b>{[r.qty, r.unit].filter(Boolean).join(' ') || '—'}</b></div>
                            <div><span>แผนก</span><b>{r.department ?? '—'}</b></div>
                            <div style={{ gridColumn: '1 / -1' }}><span>รายละเอียดงานซ่อม</span><b>{r.detail ?? '—'}</b></div>
                            {r.remark && <div style={{ gridColumn: '1 / -1' }}><span>หมายเหตุ</span><b>{r.remark}</b></div>}
                            <div style={{ gridColumn: '1 / -1' }}><span>แม่พิมพ์ที่ผูก ({r.linked_codes.length})</span>
                              <b>{r.linked_codes.length ? r.linked_codes.map((c) => (
                                <span key={c} className="r-no" style={{ marginRight: 4 }}>{c} <span className="muted">({moldByCode[c]?.status_th ?? '?'})</span></span>
                              )) : (r.link_note ?? '—')}</b>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pager">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← ก่อนหน้า</button>
          <span>หน้า {page} / {pages} · {filtered.length} ใบ</span>
          <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>ถัดไป →</button>
        </div>
      </section>

      {showNew && (
        <div className="overlay" onClick={() => setShowNew(false)}>
          <div className="modal modal-form" onClick={(e) => e.stopPropagation()}>
            <div className="mf-head">
              <div>
                <h3>🛠 ออกใบส่งซ่อมใหม่</h3>
                <p className="muted small">กรอกตามใบกระดาษ — เลข P4R รันอัตโนมัติต่อจากใบล่าสุด</p>
              </div>
              <button className="link" onClick={() => setShowNew(false)}>ปิด ✕</button>
            </div>
            {created ? (
              <div className="mf-body">
                <div className="panel success-box">
                  <b>✅ ออกใบ {created.repair_no} แล้ว ({created.codes.length} ตัว)</b>
                  <span>{created.codes.join(', ')} เปลี่ยนเป็น “ส่งซ่อม” — เห็นในเช็คสต็อกทันที</span>
                  {created.size_ref && <span className="muted small">{created.size_ref}</span>}
                  <div className="greet-actions">
                    <button className="btn-secondary" onClick={() => { setCreated(null); openNewModal() }}>ออกใบต่อไป</button>
                    <button className="btn-accent" onClick={() => { setShowNew(false); setTab('open') }}>ไปดูคิวค้าง →</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
              <div className="mf-body">
                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">1</span><b>ประเภทงาน</b></div>
                  <div className="typecards">
                    <button className={`typecard${jobType === 'repair' ? ' active' : ''}`} onClick={() => setJobType('repair')}>
                      <span className="tc-ico">🛠</span>
                      <b>งานซ่อม</b><span>แม่พิมพ์ชำรุด → ส่งซ่อม → รับกลับ</span>
                    </button>
                    <button className={`typecard${jobType === 'new' ? ' active' : ''}`} onClick={() => setJobType('new')}>
                      <span className="tc-ico">＋</span>
                      <b>งานสร้างใหม่</b><span>สั่งทำของใหม่ ไม่แตะสต็อก</span>
                    </button>
                  </div>
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">2</span><b>วันที่</b></div>
                  <div className="form-grid">
                    <label className="field">วันที่สั่งซ่อม
                      <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                    </label>
                    <label className="field">กำหนดเสร็จ <span className="muted">(ว่างได้)</span>
                      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </label>
                  </div>
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">3</span><b>ชื่องาน / ชนิดงาน</b></div>
                  <label className="field">
                    <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder={selMolds[0] ? (SHEET_TOOLING[selMolds[0].sheet] ?? '') : 'เช่น PUNCH CUTTER P3'} list="jobname-list" />
                    <datalist id="jobname-list">
                      {jobNameOptions.map((j) => <option key={j} value={j} />)}
                    </datalist>
                  </label>
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">4</span><b>ชนิด · ไซส์ · รหัสแบบ</b><span className="muted">อ้างอิง sheet รหัสแบบ</span></div>
                  <div className="form-grid">
                    <label className="field">ชนิดแม่พิมพ์
                      <select value={fSheet} onChange={(e) => { setFSheet(e.target.value); setFSize('') }}>
                        <option value="">— เลือกชนิด —</option>
                        {SHEETS.map((s) => <option key={s} value={s}>{s} · {SHEET_TOOLING[s]}</option>)}
                      </select>
                    </label>
                    <label className="field">ไซส์
                      <select value={fSize} onChange={(e) => setFSize(e.target.value)} disabled={!fSheet}>
                        <option value="">— เลือกไซส์ —</option>
                        {sizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  </div>
                  {fSheet && fSize && (
                    <div className="field" style={{ marginTop: 12 }}>รหัสแบบของ {fSheet} ไซส์ {fSize}
                      {suggestedPatterns.length > 0 ? (
                        <span className="seg">
                          {suggestedPatterns.map((p) => (
                            <button key={p} className={`chip${patternCode === p ? ' active' : ''}`} onClick={() => setPatternCode(p)}>{p}</button>
                          ))}
                        </span>
                      ) : (
                        <span className="muted small">ยังไม่เคยมีรหัสแบบของไซส์นี้ — พิมพ์เพิ่มได้เลย</span>
                      )}
                      <input value={patternCode} onChange={(e) => setPatternCode(e.target.value)} placeholder="เช่น 2P4-P3-PD01C" style={{ marginTop: 8 }} />
                    </div>
                  )}
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">5</span><b>รหัสแม่พิมพ์ / No.</b>
                    <span className="muted">หลายตัวได้ · ต้อง{fSheet && fSize ? ` ${fSheet} ${fSize}` : 'ชนิด+SIZE'} เดียวกัน{jobType === 'new' ? ' · สร้างใหม่ไม่บังคับ' : ''}</span>
                  </div>
                  <span className="search inline" style={{ margin: 0 }}>
                    🔍<input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="พิมพ์รหัส / No. เพื่อค้นหา…" />
                  </span>
                  <div className="picklist picklist-sm" style={{ marginTop: 8 }}>
                    {candidates.map((m) => {
                      const on = selCodes.includes(m.code)
                      return (
                        <label key={m.code} className={`pick${on ? ' active' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleSel(m.code)} />
                          <b>{m.code}</b>
                          <span className="muted">{m.sheet} · {m.size}</span>
                          <span className={`badge ${badgeClass(m.status)}`}>{m.status_th}</span>
                        </label>
                      )
                    })}
                    {!candidates.length && <p className="empty">ไม่พบตัวตามเงื่อนไข — ลองเลือกชนิด/ไซส์ หรือพิมพ์ No. ด้านล่าง</p>}
                  </div>
                  {fSheet && fSize && (
                    <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                      <input value={manualNo} onChange={(e) => setManualNo(e.target.value)} placeholder={`พิมพ์ No. ใน ${fSheet} ไซส์ ${fSize} แล้วกด ＋`} inputMode="numeric" style={{ flex: 1 }} />
                      <button className="btn-secondary" onClick={addManualNo}>＋ เพิ่ม No.</button>
                    </div>
                  )}
                  {selCodes.length > 0 && (
                    <div className="selchips">
                      {selCodes.map((c) => (
                        <span key={c} className="selchip">{c}<button onClick={() => toggleSel(c)} title="เอาออก">✕</button></span>
                      ))}
                    </div>
                  )}
                  {selCodes.length > 0 && (
                    <div className="kpi-strip" style={{ marginTop: 8 }}>
                      <span>เลือก <b>{selCodes.length}</b> ตัว</span>
                      <span><b>{selGroups.join(' · ') || '—'}</b></span>
                      {selSizeRef && <span className="muted small">{selSizeRef}</span>}
                    </div>
                  )}
                  {selMixed && (
                    <p className="form-error" style={{ marginTop: 8 }}>
                      ใบเดียวใส่ได้เฉพาะชนิด+SIZE เดียวกัน — เอาตัวต่าง SIZE ออก หรือแยกออกใบใหม่ ({selGroups.join(' / ')})
                    </p>
                  )}
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">6</span><b>จำนวน · หน่วย · ความเร่งด่วน</b></div>
                  <div className="form-grid">
                    <label className="field">จำนวน
                      <input value={qty} onChange={(e) => { setQty(e.target.value); setQtyTouched(true) }} inputMode="numeric" />
                    </label>
                    <label className="field">หน่วย
                      <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                        {['ตัว', 'ชุด'].map((u) => <option key={u} value={u}>{u}</option>)}
                        {!['ตัว', 'ชุด'].includes(unit) && <option value={unit}>{unit}</option>}
                      </select>
                    </label>
                  </div>
                  <div className="field" style={{ marginTop: 12 }}>ความเร่งด่วน
                    <span className="seg">
                      {['ปกติ', 'ด่วน', 'ด่วนมาก'].map((p) => (
                        <button key={p} className={`chip prio-${p === 'ปกติ' ? 'n' : p === 'ด่วน' ? 'u' : 'uu'}${nPrio === p ? ' active' : ''}`} onClick={() => setNPrio(p)}>{p}</button>
                      ))}
                    </span>
                  </div>
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">7</span><b>ผู้สั่ง · เครื่อง · แผนก</b></div>
                  <div className="form-grid">
                    <label className="field">ชื่อผู้สั่ง
                      <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="ชื่อผู้สั่งทำ" />
                    </label>
                    <label className="field">เครื่องที่ใช้ <span className="muted">(ว่างได้)</span>
                      <input value={machineIn} onChange={(e) => { setMachineIn(e.target.value); setMachineTouched(true) }} placeholder="เช่น TP2" />
                    </label>
                  </div>
                  <label className="field" style={{ marginTop: 12 }}>แผนก
                    <input value={dept} onChange={(e) => setDept(e.target.value)} list="dept-list" placeholder="กระป๋อง 2 ชิ้น" />
                    <datalist id="dept-list">
                      {deptOptions.map((d) => <option key={d} value={d} />)}
                    </datalist>
                  </label>
                </section>

                <section className="fstep">
                  <div className="fstep-head"><span className="fstep-num">8</span><b>รายละเอียด · หมายเหตุ</b></div>
                  <label className="field">รายละเอียด
                    <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="เช่น เจียรคมให้หมดรอยเบลอ…" rows={3} />
                  </label>
                  <label className="field" style={{ marginTop: 12 }}>หมายเหตุ <span className="muted">(ว่างได้)</span>
                    <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="หมายเหตุเพิ่มเติม" />
                  </label>
                </section>
              </div>
              <div className="mf-foot">
                {formError && <p className="form-error" style={{ margin: '0 0 8px' }}>{formError}</p>}
                <div className="mf-summary">
                  <span className="muted">
                    {selCodes.length && !selMixed
                      ? <>→ <b>{jobType === 'new' ? `สร้างใหม่ (อ้างอิง ${selCodes.length} ตัว)` : `ส่งซ่อม ${selCodes.length} ตัว`}</b> · ออกเลข P4R อัตโนมัติ</>
                      : 'ออกเลข P4R อัตโนมัติต่อจากใบล่าสุด'}
                  </span>
                  <span className="greet-actions" style={{ margin: 0 }}>
                    <button className="btn-secondary" onClick={() => setShowNew(false)}>ยกเลิก</button>
                    <button
                      className="btn-accent"
                      disabled={busy || (jobType === 'repair' && !selCodes.length) || selMixed || !orderDate}
                      onClick={submitNew}
                    >
                      {busy ? 'กำลังบันทึก…' : `🛠 ยืนยันออกใบ${selCodes.length ? ` (${selCodes.length} ตัว)` : ''}`}
                    </button>
                  </span>
                </div>
              </div>
              </>
            )}
          </div>
        </div>
      )}

      {recvTarget && (
        <RecvWorksheet
          target={recvTarget}
          molds={moldByCode}
          insp={insp}
          setInsp={setInsp}
          busy={recvBusy}
          error={recvError}
          onClose={() => setRecvTarget(null)}
          onConfirm={confirmReceive}
          onReconcile={confirmReconcile}
          reconciling={reconciling}
        />
      )}

      {recvDone && (
        <div className="overlay" onClick={() => setRecvDone(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>✅ รับกลับ {recvDone.source_no} เรียบร้อย</h3>
              <button className="link" onClick={() => setRecvDone(null)}>ปิด ✕</button>
            </div>
            <p>
              ผ่าน <b className="ok">{recvDone.passed.length} ตัว → สแปร์</b>
              {recvDone.failed.length > 0 && <> · <b className="bad">ไม่ผ่าน {recvDone.failed.length} ตัว → ของเสีย</b></>}
            </p>
            {recvDone.failed.length > 0 && (
              <p className="muted small">ของเสีย: {recvDone.failed.join(', ')}</p>
            )}
            {recvDone.passed.length > 0 && (
              <>
                <h2 style={{ margin: '8px 0 8px', fontSize: 17 }}>พิมพ์ใบแปะใหม่ตามสเปคที่วัดล่าสุด? 🖨</h2>
                <div className="print-area">
                  {Array.from({ length: Math.min(5, Math.max(1, labelCfg.copies)) }).map((_, i) => (
                    <div key={i}>
                      {recvDone.passed.map((p) => {
                        const m = moldByCode[p.code]
                        if (!m) return null
                        return (
                          <div className="label-copy" key={p.code}>
                            <MoldLabel
                              detail={{
                                code: p.code, sheet: m.sheet, size: m.size, no: m.no,
                                grade: m.grade ?? '', remark: '',
                                dims: p.dims,
                                date: new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
                              }}
                              inspector={inspector || user?.username || ''}
                              config={labelCfg}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <label className="field no-print" style={{ marginTop: 12 }}>รหัสผู้ตรวจสอบ
                  <input value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="เช่น admin" />
                </label>
                <div className="greet-actions no-print" style={{ marginTop: 12 }}>
                  <button className="btn-accent" onClick={() => window.print()}>🖨 สั่งปริ้น</button>
                  <button className="btn-secondary" onClick={() => setRecvDone(null)}>ปิด</button>
                </div>
              </>
            )}
            {recvDone.passed.length === 0 && (
              <div className="greet-actions no-print" style={{ marginTop: 12 }}>
                <button className="btn-secondary" onClick={() => setRecvDone(null)}>ปิด</button>
              </div>
            )}
          </div>
        </div>
      )}

      {editTarget && (
        <div className="overlay" onClick={() => setEditTarget(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mf-head">
              <div>
                <h3>✏️ แก้ไขใบซ่อม — {editTarget.source_no}</h3>
                <p className="muted small">แก้ได้เฉพาะข้อมูลเอกสาร · ตัวแม่พิมพ์ที่ผูกไว้เปลี่ยนไม่ได้ (ให้ลบแล้วออกใบใหม่)</p>
              </div>
              <button className="link" onClick={() => setEditTarget(null)}>ปิด ✕</button>
            </div>
            <div className="mf-body">
              <label className="field">ชื่องาน / ชนิดงาน
                <input value={eJob} onChange={(e) => setEJob(e.target.value)} />
              </label>
              <div className="field" style={{ marginTop: 12 }}>ระดับความเร่งด่วน
                <span className="seg">
                  {['ปกติ', 'ด่วน', 'ด่วนมาก'].map((p) => (
                    <button key={p} className={`chip${ePrio === p ? ' active' : ''}`} onClick={() => setEPrio(p)}>{p}</button>
                  ))}
                </span>
              </div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="field">วันที่สั่งซ่อม
                  <input type="date" value={eOrdered} onChange={(e) => setEOrdered(e.target.value)} />
                </label>
                <label className="field">กำหนดเสร็จ
                  <input type="date" value={eDue} onChange={(e) => setEDue(e.target.value)} />
                </label>
              </div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="field">ชื่อผู้สั่ง
                  <input value={eRequester} onChange={(e) => setERequester(e.target.value)} />
                </label>
                <label className="field">เครื่องที่ใช้
                  <input value={eMachine} onChange={(e) => setEMachine(e.target.value)} />
                </label>
              </div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="field">แผนก
                  <input value={eDept} onChange={(e) => setEDept(e.target.value)} />
                </label>
                <label className="field">รหัสแบบ
                  <input value={ePattern} onChange={(e) => setEPattern(e.target.value)} />
                </label>
              </div>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="field">จำนวน
                  <input value={eQty} onChange={(e) => setEQty(e.target.value)} inputMode="numeric" />
                </label>
                <label className="field">หน่วย
                  <input value={eUnit} onChange={(e) => setEUnit(e.target.value)} />
                </label>
              </div>
              <label className="field" style={{ marginTop: 12 }}>รายละเอียด
                <textarea value={eDetail} onChange={(e) => setEDetail(e.target.value)} rows={3} />
              </label>
              <label className="field" style={{ marginTop: 12 }}>หมายเหตุ
                <input value={eRemark} onChange={(e) => setERemark(e.target.value)} />
              </label>
              {editError && <p className="form-error" style={{ marginTop: 8 }}>{editError}</p>}
            </div>
            <div className="mf-foot">
              <div className="mf-summary">
                <span className="muted">{editTarget.linked_codes.length ? `ผูก ${editTarget.linked_codes.length} ตัว (ไม่เปลี่ยน)` : 'งานนอกทะเบียน'}</span>
                <span className="greet-actions" style={{ margin: 0 }}>
                  <button className="btn-secondary" onClick={() => setEditTarget(null)}>ยกเลิก</button>
                  <button className="btn-accent" disabled={editBusy} onClick={submitEdit}>
                    {editBusy ? 'กำลังบันทึก…' : '💾 บันทึกการแก้ไข'}
                  </button>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {delTarget && (
        <div className="overlay" onClick={() => setDelTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>🗑 ลบใบซ่อม — {delTarget.source_no}</h3>
              <button className="link" onClick={() => setDelTarget(null)}>ปิด ✕</button>
            </div>
            <p><b>{delTarget.job_name}</b> · {delTarget.ordered_date ?? '—'}</p>
            {(() => {
              const revert = delTarget.linked_codes.filter((c) => moldByCode[c]?.status === 'repair')
              return revert.length ? (
                <p className="form-error">⚠️ ลบแล้วตัวต่อไปนี้จะหลุดจากค้างซ่อม กลับเป็นสแปร์ทันที:<br />{revert.join(', ')}</p>
              ) : (
                <p className="empty">ใบนี้ไม่มีตัวค้างซ่อมผูกอยู่ — ลบเฉพาะเอกสารและประวัติ</p>
              )
            })()}
            {delError && <p className="form-error">{delError}</p>}
            <div className="greet-actions" style={{ marginTop: 12 }}>
              <button className="btn-mini danger" disabled={delBusy} onClick={confirmDelete} style={{ padding: '10px 18px', fontSize: 14 }}>
                {delBusy ? 'กำลังลบ…' : '🗑 ยืนยันลบทั้งใบ'}
              </button>
              <button className="btn-secondary" onClick={() => setDelTarget(null)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {slipTarget && (
        <div className="overlay overlay-fit" onClick={() => setSlipTarget(null)}>
          <div className="modal modal-slip" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head no-print">
              <h3>ใบนำส่งซ่อม — {slipTarget.source_no}</h3>
              <span className="slip-zoombar">
                <button className="btn-mini ghost" onClick={zoomOut} title="ซูมออก">−</button>
                <span className="zoom-pct">{zoom == null ? 'พอดีจอ' : `${zoomPct}%`}</span>
                <button className="btn-mini ghost" onClick={zoomIn} title="ซูมเข้า">＋</button>
                <button className="btn-mini ghost" onClick={() => setZoom(null)} title="กลับมาพอดีจอ">⛶</button>
              </span>
              <button className="link" onClick={() => setSlipTarget(null)}>ปิด ✕</button>
            </div>
            <div className="slip-print-area">
              <SlipFit manual={zoom} onFit={setFitScale}>
                <RepairSlip row={slipTarget} />
              </SlipFit>
            </div>
            <div className="greet-actions no-print" style={{ marginTop: 8 }}>
              <button className="btn-accent" onClick={() => window.print()}>🖨 สั่งพิมพ์ (A4)</button>
              <button className="btn-secondary" onClick={() => setSlipTarget(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
