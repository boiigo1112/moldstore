// ตั้งค่าใบแปะแม่พิมพ์ — เก็บใน localStorage ของเครื่อง (มีผลทันทีตอนปริ้น)
export interface LabelConfig {
  widthMm: number
  titleText: string
  titleSizePx: number
  codeSizePx: number
  bodySizePx: number
  dimsSizePx: number
  qrSize: number
  showTitle: boolean
  showQR: boolean
  showSub: boolean
  showDims: boolean
  dimKeys: string[] // [] = แสดงทุกมิติที่มี
  showDate: boolean
  showInspector: boolean
  showRemark: boolean
  footerText: string // '' = ไม่แสดงบรรทัดท้าย
  copies: number
  border: 'dashed' | 'solid' | 'none'
}

export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  widthMm: 92,
  titleText: 'MOLD STORE · ใบแปะแม่พิมพ์',
  titleSizePx: 12,
  codeSizePx: 24,
  bodySizePx: 13,
  dimsSizePx: 12,
  qrSize: 92,
  showTitle: true,
  showQR: true,
  showSub: true,
  showDims: true,
  dimKeys: [],
  showDate: true,
  showInspector: true,
  showRemark: false,
  footerText: '',
  copies: 1,
  border: 'dashed',
}

const KEY = 'moldstore_label_cfg'

export function loadLabelConfig(): LabelConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_LABEL_CONFIG }
    return { ...DEFAULT_LABEL_CONFIG, ...(JSON.parse(raw) as Partial<LabelConfig>) }
  } catch {
    return { ...DEFAULT_LABEL_CONFIG }
  }
}

export function saveLabelConfig(c: LabelConfig) {
  localStorage.setItem(KEY, JSON.stringify(c))
}

export function resetLabelConfig(): LabelConfig {
  localStorage.removeItem(KEY)
  return { ...DEFAULT_LABEL_CONFIG }
}
