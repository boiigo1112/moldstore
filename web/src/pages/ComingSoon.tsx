import type { PageKey } from '../menu'

const COMING: Record<Exclude<PageKey, 'dashboard'>, { icon: string; what: string; next: string }> = {
  stock: { icon: '🔍', what: 'หน้าเช็คสต๊อก (ใช้งานแล้ว)', next: '—' },
  molds: { icon: '📦', what: 'เพิ่ม / แก้ไข / ลบ ข้อมูลมาสเตอร์แม่พิมพ์ + ประวัติการเปลี่ยน', next: 'ต่อ API ทะเบียนแม่พิมพ์' },
  receive: { icon: '📥', what: 'ฟอร์มรับเข้าแม่พิมพ์ใหม่ + อัปโหลดรูป + พิมพ์ป้าย', next: 'ต่อ API รับเข้า' },
  repairs: { icon: '🛠', what: 'รายการใบ P4R1 + สร้างใบซ่อม + อัปเดตสถานะ', next: 'ต่อ API repairs' },
  inspect: { icon: '📏', what: 'บันทึกผลตรวจวัด + แนบไฟล์ + ประวัติรายตัว', next: 'ต่อ API inspections' },
  retire: { icon: '🗑', what: 'คำขอปลดระวาง + อนุมัติ Admin + เหตุผล', next: 'ต่อ API retire' },
  reports: { icon: '📑', what: 'รายงานเพิ่มเติม + Export Excel', next: 'ต่อยอดจากหน้ารายงานปัจจุบัน' },
  'label-setup': { icon: '🏷️', what: 'หน้าตั้งค่าใบแปะ (ใช้งานแล้ว)', next: '—' },
  users: { icon: '👥', what: 'รายชื่อผู้ใช้ + เพิ่ม/ปิดสิทธิ์ + รีเซ็ตรหัสผ่าน', next: 'เฉพาะ Admin – ต่อ API users' },
}

export default function ComingSoon({ page, go }: { page: Exclude<PageKey, 'dashboard'>; go: (p: PageKey) => void }) {
  const c = COMING[page]
  return (
    <div className="panel placeholder">
      <div className="big">{c.icon}</div>
      <h2>โมดูลนี้กำลังจะมา</h2>
      <p>โครงพร้อมแล้ว — จะมี: {c.what}</p>
      <p style={{ fontSize: 13 }}>ขั้นตอนถัดไป: {c.next}</p>
      <div className="greet-actions" style={{ justifyContent: 'center' }}>
        <button className="btn-secondary" onClick={() => go('dashboard')}>← กลับแดชบอร์ด</button>
        <button className="btn-accent">เริ่มทำโมดูลนี้ต่อ</button>
      </div>
    </div>
  )
}
