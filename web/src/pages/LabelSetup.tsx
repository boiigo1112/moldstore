import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { DIM_COLS } from '../moldMeta'
import MoldLabel from '../components/MoldLabel'
import {
  DEFAULT_LABEL_CONFIG, loadLabelConfig, resetLabelConfig, saveLabelConfig,
  type LabelConfig,
} from '../labelConfig'

const SAMPLE = {
  code: 'DIEP1-109-6301',
  sheet: 'DIEP1',
  size: '109',
  no: '6301',
  grade: 'พิเศษ',
  remark: 'PO-69102',
  dims: {
    'Outside มุม 12-6': 170,
    'Outside มุม 3-9': 170,
    'Inside มุม มุม 12-6': 109.17,
    'Inside มุม มุม 13-9': 109.17,
    HEIGHT: 35.39,
  } as Record<string, string | number>,
  date: new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }),
}

function Num({ label, value, min, max, onChange, unit }: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void; unit?: string
}) {
  return (
    <label className="field">{label}
      <span className="num-row">
        <input
          type="range" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number" min={min} max={max} value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        />
        {unit && <span className="muted small">{unit}</span>}
      </span>
    </label>
  )
}

function Toggle({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className={`pick${value ? ' active' : ''}`}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <b>{label}</b>{hint && <span className="muted">{hint}</span>}
    </label>
  )
}

export default function LabelSetup() {
  const { user } = useAuth()
  const allowed = user?.role === 'store' || user?.role === 'admin'
  const [cfg, setCfg] = useState<LabelConfig>(() => loadLabelConfig())
  const [savedTick, setSavedTick] = useState(false)

  const allDims = useMemo(() => {
    const seen = new Map<string, string>()
    for (const cols of Object.values(DIM_COLS)) {
      for (const c of cols) if (!seen.has(c.key)) seen.set(c.key, c.short)
    }
    return [...seen.entries()]
  }, [])

  if (!allowed) {
    return (
      <div className="panel placeholder">
        <div className="big">🔒</div>
        <h2>เฉพาะเจ้าหน้าที่ Store / Admin</h2>
        <p>การตั้งค่าใบแปะต้องทำโดยเจ้าหน้าที่ Store หรือผู้ดูแลระบบ</p>
      </div>
    )
  }

  const set = <K extends keyof LabelConfig>(k: K, v: LabelConfig[K]) => {
    setCfg((p) => ({ ...p, [k]: v }))
    setSavedTick(false)
  }
  const save = () => { saveLabelConfig(cfg); setSavedTick(true) }
  const reset = () => { setCfg(resetLabelConfig()); setSavedTick(false) }

  return (
    <>
      <section className="greet">
        <div>
          <h1>ตั้งค่าใบแปะแม่พิมพ์ 🏷️</h1>
          <p>ออกแบบเองอิสระ — ดูตัวอย่างสดด้านขวา กดบันทึกแล้วมีผลกับใบแปะที่ปริ้นจากหน้าทะเบียนทันที</p>
        </div>
        <div className="greet-actions">
          <button className="btn-secondary" onClick={reset}>↩ คืนค่าเริ่มต้น</button>
          <button className="btn-accent" onClick={save}>💾 บันทึกการตั้งค่า</button>
        </div>
      </section>

      {savedTick && <section className="panel success-box"><b>✅ บันทึกแล้ว — ใบแปะที่ปริ้นครั้งต่อไปจะใช้แบบใหม่นี้</b></section>}

      <section className="setup-grid">
        <div className="setup-controls">
          <div className="panel">
            <h3>📐 ขนาดใบแปะ</h3>
            <div className="chips">
              {[80, 92, 100, 110].map((w) => (
                <button key={w} className={`chip${cfg.widthMm === w ? ' active' : ''}`} onClick={() => set('widthMm', w)}>{w} มม.</button>
              ))}
            </div>
            <Num label="ความกว้างใบแปะ" value={cfg.widthMm} min={50} max={150} unit="มม." onChange={(v) => set('widthMm', v)} />
            <Num label="ขนาดตัวอักษรรหัส" value={cfg.codeSizePx} min={14} max={40} unit="px" onChange={(v) => set('codeSizePx', v)} />
            <Num label="ขนาดหัวเรื่อง" value={cfg.titleSizePx} min={9} max={20} unit="px" onChange={(v) => set('titleSizePx', v)} />
            <Num label="ขนาดตัวอักษรทั่วไป" value={cfg.bodySizePx} min={9} max={20} unit="px" onChange={(v) => set('bodySizePx', v)} />
            <Num label="ขนาดตัวเลขค่าวัด" value={cfg.dimsSizePx} min={9} max={18} unit="px" onChange={(v) => set('dimsSizePx', v)} />
            <Num label="ขนาด QR Code" value={cfg.qrSize} min={48} max={160} unit="px" onChange={(v) => set('qrSize', v)} />
          </div>

          <div className="panel">
            <h3>🧩 ส่วนประกอบบนใบแปะ</h3>
            <div className="picklist">
              <Toggle label="หัวเรื่อง" value={cfg.showTitle} onChange={(v) => set('showTitle', v)} />
              <Toggle label="QR Code" hint="สแกนได้รหัสแม่พิมพ์" value={cfg.showQR} onChange={(v) => set('showQR', v)} />
              <Toggle label="บรรทัดชนิด / SIZE / No. / เกรด" value={cfg.showSub} onChange={(v) => set('showSub', v)} />
              <Toggle label="ตารางตัวเลขค่าวัด" value={cfg.showDims} onChange={(v) => set('showDims', v)} />
              <Toggle label="วันที่" value={cfg.showDate} onChange={(v) => set('showDate', v)} />
              <Toggle label="รหัสผู้ตรวจสอบ" value={cfg.showInspector} onChange={(v) => set('showInspector', v)} />
              <Toggle label="หมายเหตุ" value={cfg.showRemark} onChange={(v) => set('showRemark', v)} />
            </div>
          </div>

          <div className="panel">
            <h3>📏 เลือกค่าวัดที่จะโชว์ <span className="muted small">(ไม่ติ๊กเลย = โชว์ทั้งหมดที่มี)</span></h3>
            <div className="picklist">
              {allDims.map(([key, short]) => {
                const on = cfg.dimKeys.includes(key)
                return (
                  <label key={key} className={`pick${on ? ' active' : ''}`}>
                    <input
                      type="checkbox" checked={on}
                      onChange={() => set('dimKeys', on ? cfg.dimKeys.filter((k) => k !== key) : [...cfg.dimKeys, key])}
                    />
                    <b>{short}</b><span className="muted">{key}</span>
                  </label>
                )
              })}
            </div>
            {cfg.dimKeys.length > 0 && (
              <button className="link" onClick={() => set('dimKeys', [])}>ล้างตัวเลือก (กลับไปโชว์ทั้งหมด)</button>
            )}
          </div>

          <div className="panel">
            <h3>✏️ ข้อความ + การพิมพ์</h3>
            <div className="form-grid">
              <label className="field">ข้อความหัวเรื่อง
                <input value={cfg.titleText} onChange={(e) => set('titleText', e.target.value)} placeholder="MOLD STORE · ใบแปะแม่พิมพ์" />
              </label>
              <label className="field">บรรทัดท้ายใบ (เว้นว่าง = ไม่แสดง)
                <input value={cfg.footerText} onChange={(e) => set('footerText', e.target.value)} placeholder="เช่น ห้ามแกะก่อนได้รับอนุญาต" />
              </label>
              <label className="field">จำนวนสำเนาต่อครั้ง
                <select value={cfg.copies} onChange={(e) => set('copies', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ใบ</option>)}
                </select>
              </label>
              <label className="field">เส้นขอบใบแปะ
                <select value={cfg.border} onChange={(e) => set('border', e.target.value as LabelConfig['border'])}>
                  <option value="dashed">เส้นประ (ตัดตามรอย)</option>
                  <option value="solid">เส้นทึบ</option>
                  <option value="none">ไม่มีขอบ</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="panel preview-sticky">
          <div className="panel-head"><h3>👁️ ตัวอย่างสด</h3><span className="muted small">จะปริ้น {cfg.copies} สำเนา</span></div>
          <MoldLabel detail={SAMPLE} inspector={user?.username ?? 'admin'} config={cfg} />
          <p className="muted small" style={{ marginTop: 12 }}>ตัวอย่างใช้ข้อมูลจำลอง — ของจริงจะใส่รหัส/ค่าวัด/วันที่/ผู้ตรวจของใบนั้นๆ ให้เอง</p>
          <div className="greet-actions" style={{ marginTop: 8 }}>
            <button className="btn-accent" onClick={save}>💾 บันทึกการตั้งค่า</button>
          </div>
        </div>
      </section>
    </>
  )
}
