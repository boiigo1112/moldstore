import type { CSSProperties } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { DIM_COLS, SHEET_TOOLING } from '../moldMeta'
import type { LabelConfig } from '../labelConfig'

export interface LabelDetail {
  code: string
  sheet: string
  size: string
  no: string
  grade: string
  remark: string
  dims: Record<string, string | number>
  date: string
}

interface Props {
  detail: LabelDetail
  inspector: string
  config: LabelConfig
}

// ใบแปะแม่พิมพ์ — หน้าตา/ขนาดทั้งหมดมาจาก config (หน้า Molds + หน้าตั้งค่าใช้ตัวเดียวกัน)
export default function MoldLabel({ detail, inspector, config }: Props) {
  const dims = (DIM_COLS[detail.sheet] ?? []).filter(
    (d) =>
      detail.dims[d.key] !== undefined &&
      detail.dims[d.key] !== '' &&
      (config.dimKeys.length === 0 || config.dimKeys.includes(d.key)),
  )
  const style = {
    '--label-w': `${config.widthMm}mm`,
    '--label-title': `${config.titleSizePx}px`,
    '--label-code': `${config.codeSizePx}px`,
    '--label-body': `${config.bodySizePx}px`,
    '--label-dims': `${config.dimsSizePx}px`,
    border: config.border === 'none' ? 'none' : config.border === 'solid' ? '1.5px solid #000' : '2px dashed #999',
  } as CSSProperties

  return (
    <div className="label-card" style={style}>
      <div className="label-head">
        <div>
          {config.showTitle && <div className="label-title">{config.titleText || 'ใบแปะแม่พิมพ์'}</div>}
          <div className="label-code">{detail.code}</div>
        </div>
        {config.showQR && <QRCodeSVG value={detail.code} size={config.qrSize} level="M" />}
      </div>
      {config.showSub && (
        <div className="label-sub">
          {SHEET_TOOLING[detail.sheet] ?? detail.sheet} · SIZE {detail.size} · No.{detail.no}
          {detail.grade ? ` · เกรด${detail.grade}` : ''}
        </div>
      )}
      {config.showDims && dims.length > 0 && (
        <div className="label-dims">
          {dims.map((d) => (
            <span key={d.key}>{d.short}: <b>{String(detail.dims[d.key])}</b></span>
          ))}
        </div>
      )}
      {(config.showDate || config.showInspector || (config.showRemark && detail.remark)) && (
        <div className="label-foot">
          {config.showDate && <span>วันที่: <b>{detail.date}</b></span>}
          {config.showInspector && <span>ผู้ตรวจ: <b>{inspector || '—'}</b></span>}
        </div>
      )}
      {config.showRemark && detail.remark && <div className="label-remark">{detail.remark}</div>}
      {config.footerText.trim() !== '' && <div className="label-footer">{config.footerText}</div>}
    </div>
  )
}
