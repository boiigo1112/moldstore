// ข้อมูลกลางของแม่พิมพ์ (ใช้ร่วมกันระหว่าง Stock / Molds / Reports)
// โครงรหัส: {SHEET}-{SIZE}-{No.} โดยตัดช่องว่างออก เช่น DIEP1-109-6301
export interface Mold {
  code: string
  sheet: string
  block: number
  seq: number
  tooling_type: string
  work_name: string
  size: string
  no: string
  grade: string | null
  status: 'spare' | 'installed' | 'repair' | 'retired'
  status_th: string
  machine: string | null
  remark: string | null
  dims: Record<string, string | number>
}

export const SHEETS = ['DIEP1', 'PUNCHP1', 'PUNCHP3', 'DIEP3'] as const

// ชื่องานหลักของแต่ละชีท (ตามไฟล์ Excel)
export const SHEET_WORK: Record<string, string> = {
  DIEP1: 'DIECUTTERP1',
  PUNCHP1: 'PUNCH CUTTER P1',
  PUNCHP3: 'PUNCH CUTTER P3',
  DIEP3: 'DIECUTTERP3',
}

// ชื่อ tooling_type ที่แสดง (ตาม import_excel WORKNAME_MAP)
export const SHEET_TOOLING: Record<string, string> = {
  DIEP1: 'DIE CUTTER P1',
  PUNCHP1: 'PUNCH CUTTER P1',
  PUNCHP3: 'PUNCH CUTTER P3',
  DIEP3: 'DIE CUTTER P3',
}

// คอลัมน์มิติของแต่ละชีท (key ใน dims + หัวสั้นที่จะแสดง)
export const DIM_COLS: Record<string, { key: string; short: string }[]> = {
  DIEP1: [
    { key: 'Outside มุม 12-6', short: 'Outside 12-6' },
    { key: 'Outside มุม 3-9', short: 'Outside 3-9' },
    { key: 'Inside มุม มุม 12-6', short: 'Inside 12-6' },
    { key: 'Inside มุม มุม 13-9', short: 'Inside 13-9' },
    { key: 'HEIGHT', short: 'HEIGHT' },
  ],
  PUNCHP1: [
    { key: 'Outside มุม 12-6', short: 'Outside 12-6' },
    { key: 'Outside มุม 3-9', short: 'Outside 3-9' },
    { key: 'Inside มุม มุม 12-6', short: 'Inside 12-6' },
    { key: 'Inside มุม มุม 13-9', short: 'Inside 13-9' },
    { key: 'HEIGHT', short: 'HEIGHT' },
    { key: 'R-IN', short: 'R-IN' },
  ],
  PUNCHP3: [
    { key: 'Outside มุม 12-6', short: 'Outside 12-6' },
    { key: 'Outside มุม 3-9', short: 'Outside 3-9' },
    { key: 'Inside มุม มุม 12-6', short: 'Inside 12-6' },
    { key: 'Inside มุม มุม 13-9', short: 'Inside 13-9' },
    { key: 'HEIGHT', short: 'HEIGHT' },
    { key: 'ความสูงบ่า', short: 'สูงบ่า' },
    { key: 'ความลึก', short: 'ความลึก' },
  ],
  DIEP3: [
    { key: 'Outside มุม 12-6', short: 'Outside 12-6' },
    { key: 'Outside มุม 3-9', short: 'Outside 3-9' },
    { key: 'Inside มุม มุม 12-6', short: 'Inside 12-6' },
    { key: 'Inside มุม มุม 13-9', short: 'Inside 13-9' },
    { key: 'HEIGHT', short: 'HEIGHT' },
    { key: 'ความสูงบ่า', short: 'สูงบ่า' },
  ],
}

export const HAS_GRADE = new Set(['DIEP1', 'PUNCHP1'])

export const STATUS_TH: Record<Mold['status'], string> = {
  spare: 'สแปร์',
  installed: 'ใช้งานบนเครื่อง',
  repair: 'ส่งซ่อม',
  retired: 'ยกเลิกใช้',
}

export function badgeClass(s: Mold['status']) {
  return s === 'spare' ? 'spare' : s === 'installed' ? 'installed' : s === 'repair' ? 'repair' : 'retired'
}

export function fmt(v: string | number | null | undefined) {
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

export function toCSV(rows: string[][]): string {
  return '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

export function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** สร้างรหัสแม่พิมพ์จาก ชีท+ไซส์+No. (ตัดช่องว่าง) */
export function buildCode(sheet: string, size: string, no: string) {
  return `${sheet.trim()}-${size.trim()}-${no.trim()}`.replace(/ /g, '')
}

/** แกะรหัสกลับเป็น {sheet,size,no} — size อาจมีขีด ให้ยึดส่วนท้ายเป็น No. */
export function parseCode(code: string): { sheet: string; size: string; no: string } | null {
  const hit = SHEETS.find((s) => code === s || code.startsWith(s + '-'))
  if (!hit) return null
  const rest = code.slice(hit.length + 1)
  const i = rest.lastIndexOf('-')
  if (i < 0) return null
  return { sheet: hit, size: rest.slice(0, i), no: rest.slice(i + 1) }
}

/** เลข No. ถัดไปที่แนะนำ = ค่าสูงสุดที่เป็นตัวเลข + 1 (เจอแต่ตัวเลขล้วนถึงรันให้) */
export function suggestNextNo(items: { no: string }[]): string {
  let best: number | null = null
  for (const m of items) {
    const t = m.no.trim()
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10)
      if (best === null || n > best) best = n
    }
  }
  return best === null ? '' : String(best + 1)
}

export interface LiveStatus { status: string; machine: string | null }

/**
 * รวม live status ทับข้อมูลนิ่ง + เติมรหัสที่มีแต่ใน live (ของลงทะเบียนใหม่)
 * + ทับ dims ล่าสุดจากใบตรวจรับ (ถ้ามี)
 * โดยคงลำดับเดิมของไฟล์ และจัดของใหม่ไว้ท้ายกลุ่ม sheet ของมัน
 */
export function mergeLive(
  staticMolds: Mold[],
  live: { code: string; status: string; machine: string | null }[],
  dims?: Record<string, Record<string, string | number>>,
): Mold[] {
  const KNOWN = new Set(['spare', 'installed', 'repair', 'retired'])
  const map = new Map<string, LiveStatus>()
  for (const it of live) {
    if (KNOWN.has(it.status)) map.set(it.code, { status: it.status, machine: it.machine })
  }
  const seen = new Set(staticMolds.map((m) => m.code))
  const out = staticMolds.map((x) => {
    const lv = map.get(x.code)
    const dm = dims?.[x.code]
    const base = lv ? { ...x, status: lv.status as Mold['status'], status_th: STATUS_TH[lv.status as Mold['status']], machine: lv.machine } : x
    return dm ? { ...base, dims: dm } : base
  })
  // ของใหม่ที่ไม่มีในไฟล์ Excel (ลงทะเบียนผ่านระบบ)
  const maxBlock = new Map<string, number>()
  for (const m of out) maxBlock.set(m.sheet, Math.max(maxBlock.get(m.sheet) ?? 0, m.block))
  for (const it of live) {
    if (seen.has(it.code) || !KNOWN.has(it.status)) continue
    const p = parseCode(it.code)
    if (!p) continue
    const b = (maxBlock.get(p.sheet) ?? 0) + 1
    maxBlock.set(p.sheet, b)
    out.push({
      code: it.code,
      sheet: p.sheet,
      block: b,
      seq: 1,
      tooling_type: SHEET_TOOLING[p.sheet] ?? p.sheet,
      work_name: SHEET_WORK[p.sheet] ?? p.sheet,
      size: p.size,
      no: p.no,
      grade: null,
      status: it.status as Mold['status'],
      status_th: STATUS_TH[it.status as Mold['status']],
      machine: it.machine,
      remark: 'ลงทะเบียนผ่านระบบ',
      dims: {},
    })
  }
  return out
}
