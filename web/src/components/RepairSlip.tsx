// ใบนำส่งซ่อมอุปกรณ์ — ลอกตามรูปใบกระดาษจริง 100%
// หัวบริษัท, เลขที่ 4 ช่อง, ส่วนที่ 1-5, ช่องติ๊ก, ตารางวัสดุ 5 แถว,
// FR-MT-158-2-01/04/69
import type { CSSProperties } from 'react'

export interface SlipData {
  source_no: string
  job_name: string
  pattern_code: string | null
  qty: string | null
  unit: string | null
  ordered_date: string | null
  due_date: string | null
  machine: string | null
  detail: string | null
  size_ref: string | null
  priority: string | null
  job_type: string
  department: string | null
  remark: string | null
}

function parts(iso: string | null) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const be = parseInt(m[1], 10) + 543
  const p2 = (n: string) => String(parseInt(n, 10)).padStart(2, '0')
  return { d: p2(m[3]), m: p2(m[2]), be: String(be) }
}

export default function RepairSlip({ row, style }: { row: SlipData; style?: CSSProperties }) {
  const o = parts(row.ordered_date)
  const due = parts(row.due_date)
  const qtyUnit = [row.qty, row.unit].filter(Boolean).join(' ')
  const urgent = row.priority === 'ด่วน' || row.priority === 'ด่วนมาก' ? row.priority : null
  const isNew = row.job_type === 'new'
  return (
    <div className="slip-page" style={style}>
      {urgent && <div className="slip-urgent">{urgent}</div>}
      <div className="slip-company">บริษัท&nbsp;&nbsp;&nbsp;โลหะกิจรุ่งเจริญทรัพย์&nbsp;&nbsp;&nbsp;&nbsp;จำกัด</div>
      <div className="slip-title">รายงานสั่งทำ / ซ่อม อะไหล่อุปกรณ์&nbsp;&nbsp;&nbsp;&nbsp;แผนกวิศวกรรม&nbsp;&nbsp;(Work&nbsp;&nbsp;&nbsp;Shop)&nbsp;&nbsp;&nbsp;ส่วนซ่อมบำรุงกลาง</div>
      <div className="slip-docno"><b>เลขที่</b><span className="slip-numboxes"><i /><span>-</span><i /><span>-</span><i /><span>-</span><i /></span></div>

      {/* ---------- ส่วนที่ 1 ---------- */}
      <div className="slip-box">
        <div className="slip-s1head">
          <b>ส่วนที่ 1 : สำหรับผู้สั่งทำ</b>
          <span className="slip-checks"><b>{isNew ? '☑' : '☐'} งานสร้างใหม่</b><b>{isNew ? '☐' : '☑'} งานซ่อม</b></span>
        </div>
        <div className="slip-line">
          <span className="slip-f">วันที่ <u>{o?.d ?? ''}</u></span>
          <span className="slip-f">เดือน <u>{o?.m ?? ''}</u></span>
          <span className="slip-f">พ.ศ. <u>{o?.be ?? '2569'}</u></span>
          <span className="slip-fill" />
          <span className="slip-f">กำหนดแล้วเสร็จวันที่ : <u>{due ? `${due.d}/${due.m}/${due.be}` : ''}</u></span>
        </div>
        <div className="slip-line">
          <span className="slip-f">ชื่องาน : <u>{row.job_name}</u></span>
          <span className="slip-fill" />
          <span className="slip-f">จำนวน : <u>{qtyUnit}</u></span>
        </div>
        <div className="slip-line">
          <span className="slip-f">เครื่องใช้งาน : <u>{row.machine ?? ''}</u></span>
          <span className="slip-fill" />
          <span className="slip-f">แผนก : <u>{row.department ?? 'กระป๋อง 2 ชิ้น'}</u></span>
        </div>
        <div className="slip-line"><span className="slip-f wrap">รายละเอียด : <u>{row.detail ?? ''}</u></span></div>
        <div className="slip-line"><span className="slip-f wrap"><u>{row.size_ref ?? ''}</u></span></div>
        <div className="slip-line"><span className="slip-f wrap"><u>{row.remark ?? ''}</u></span></div>
        <div className="slip-line">
          <span className="slip-f">เลขที่ต้นสังกัด : <u>{row.source_no}</u></span>
          <span className="slip-fill" />
          <span className="slip-f">รหัสแบบ <u>{row.pattern_code ?? '-'}</u></span>
        </div>
        <div className="slip-note">หมายเหตุ&nbsp;&nbsp;:&nbsp;&nbsp;&nbsp;งานสร้างใหม่&nbsp;&nbsp;ให้แนบแบบที่ผ่านการลงนามผู้อนุมัติแบบแล้ว&nbsp;&nbsp;มาพร้อมกับใบรายงานสั่งทำ / ซ่อม อะไหล่อุปกรณ์แผ่นนี้&nbsp;&nbsp;ด้วยทุกครั้ง</div>
        <div className="slip-sign3">
          <span><i className="slip-sigline" />ผู้ขอทำ</span>
          <span><i className="slip-sigline" />หัวหน้าแผนก</span>
          <span><i className="slip-sigline" />ผู้จัดการส่วน</span>
        </div>
      </div>

      {/* ---------- ส่วนที่ 2 + 3 ---------- */}
      <div className="slip-box slip-cols">
        <div className="slip-col">
          <div className="slip-colhead"><b>ส่วนที่ 2 : สำหรับแผนกวิศวกรรม&nbsp;&nbsp;( Work Shop )</b></div>
          <div className="slip-line"><span className="slip-f">วันที่ : <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span><span className="slip-f">ผู้รับงาน <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></span></div>
          <div className="slip-center"><b>รายการวัสดุอุปกรณ์หลักที่ต้องใช้</b></div>
          <table className="slip-table">
            <thead><tr><th style={{ width: 44 }}>ลำดับ</th><th>รายการวัสดุอุปกรณ์</th><th style={{ width: 64 }}>จำนวน</th><th style={{ width: 100 }}>หมายเหตุ</th></tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => <tr key={i}><td>{i}</td><td></td><td></td><td></td></tr>)}
              <tr><td colSpan={2} className="slip-cost">ราคาต้นทุนต่อชิ้น (บาท)</td><td colSpan={2}></td></tr>
              <tr><td colSpan={2} className="slip-cost">ราคารวม (บาท)</td><td colSpan={2}></td></tr>
            </tbody>
          </table>
          <div className="slip-footnote">** ราคาต้นทุน&nbsp;&nbsp;คือ&nbsp;&nbsp;ค่าราคาของชิ้นงานที่ขึ้นรูปเสร็จแล้ว รวมวัสดุ, ค่าแรง, ค่าเครื่อง, ค่าไฟ, ค่า Tool&nbsp;&nbsp;ฯลฯ **</div>
          <div className="slip-sign2"><span><i className="slip-sigline sm" />เช็ครายการโดย</span><span><i className="slip-sigline sm" />หัวหน้าหน่วย / หัวหน้าแผนก</span></div>
        </div>
        <div className="slip-col">
          <div className="slip-colhead"><b>ส่วนที่ 3 : สำหรับผู้มีอำนาจ (เฉพาะงานสร้างใหม่)</b></div>
          <div className="slip-approve">☐ อนุมัติ</div>
          <div className="slip-approve">☐ ไม่อนุมัติ เพราะ</div>
          <div className="slip-writeline" />
          <div className="slip-writeline" />
          <div className="slip-writeline" />
          <div className="slip-writeline" />
          <div className="slip-writeline" />
          <div className="slip-sign1"><i className="slip-sigline" />ผู้จัดการฝ่ายซ่อมบำรุงกลาง</div>
        </div>
      </div>

      {/* ---------- ส่วนที่ 4 + 5 ---------- */}
      <div className="slip-box slip-cols">
        <div className="slip-col">
          <div className="slip-colhead"><b>ส่วนที่ 4 : การดำเนินการเมื่อทำชิ้นงานเสร็จ ( สำหรับแผนกวิศวกรรม Work Shop )</b></div>
          <div><b>1.&nbsp;&nbsp;สภาพพื้นที่&nbsp;&nbsp;:</b></div>
          <div>☐ สะอาด ไม่มีสิ่งแปลกปลอม</div>
          <div>☐ อื่นๆ</div>
          <div><b>2. ชิ้นงาน&nbsp;&nbsp;:</b></div>
          <div>☐ การตรวจสอบครบถ้วนสมบูรณ์</div>
          <div>☐ อุปกรณ์ ชำรุด ขาดหาย</div>
          <div className="slip-sigrow"><span>ผู้ตรวจสอบ : <i className="slip-sigline inline" /></span></div>
          <div className="slip-sigsub">( เจ้าหน้าที่ตรวจสอบคุณภาพวิศวกรรม )</div>
        </div>
        <div className="slip-col">
          <div className="slip-colhead"><b>ส่วนที่ 5 : การตรวจรับชิ้นงาน ( สำหรับต้นสังกัดผู้สั่งทำ )</b></div>
          <div><b>1.&nbsp;&nbsp;สภาพงานที่ตรวจรับ&nbsp;&nbsp;:</b></div>
          <div>☐ ดี /ผ่าน&nbsp;&nbsp;&nbsp;☐ แก้ไข/ปรับปรุง&nbsp;&nbsp;&nbsp;☐ ไม่ผ่าน</div>
          <div>☐ อื่น</div>
          <div><b>2.&nbsp;&nbsp;การตรวจ :</b></div>
          <div>☐ ชิ้นส่วนจากการทำงานครบถ้วนสมบูรณ์</div>
          <div>☐ สะอาด ไม่มีสิ่งแปลกปลอมปนเปื้อน</div>
          <div className="slip-sigright"><i className="slip-sigline" />ผู้รับ</div>
          <div className="slip-sigright"><i className="slip-sigline" />หัวหน้าแผนก</div>
          <div className="slip-sigright">วันที่ <u>&nbsp;&nbsp;&nbsp;&nbsp;</u> / <u>&nbsp;&nbsp;&nbsp;&nbsp;</u> / <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u></div>
        </div>
      </div>
      <div className="slip-formno">FR-MT-158-2-01/04/69</div>
    </div>
  )
}
