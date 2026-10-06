import { useEffect, useRef, useState } from 'react'

// ย่อเนื้อหาใบ A4 ให้พอดีกรอบที่เห็นบนจอ (กว้างและสูง) — ไม่ต้องเลื่อนดู
// รองรับซูม manual: ถ้า manual != null จะใช้ค่านั้นแทน (กรอบจะเลื่อนดูได้)
// ตอนพิมพ์จะคืนขนาดจริง A4 ผ่าน CSS @media print
const DESIGN_W = 780

interface Props {
  children: React.ReactNode
  manual: number | null
  onFit: (s: number) => void
}

export default function SlipFit({ children, manual, onFit }: Props) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(0.6)
  const onFitRef = useRef(onFit)
  onFitRef.current = onFit

  useEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return
      const ow = outer.current.clientWidth
      const oh = outer.current.clientHeight
      const ih = inner.current.offsetHeight
      if (ow > 0 && oh > 0 && ih > 0) {
        const s = Math.min(ow / DESIGN_W, oh / ih)
        setFit(s)
        onFitRef.current(s)
      }
    }
    measure()
    const t = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {})
    }
    return () => {
      window.removeEventListener('resize', measure)
      clearTimeout(t)
    }
  }, [])

  const scale = manual ?? fit

  return (
    <div className={`slip-fit-outer${manual != null ? ' zoomed' : ''}`} ref={outer}>
      <div
        className="slip-fit-inner"
        ref={inner}
        style={{ width: DESIGN_W, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
