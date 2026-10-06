export type PageKey =
  | 'dashboard'
  | 'stock'
  | 'molds'
  | 'receive'
  | 'repairs'
  | 'inspect'
  | 'retire'
  | 'reports'
  | 'label-setup'
  | 'users'

export interface MenuItem {
  key: PageKey
  label: string
  desc: string
  icon: string
  adminOnly?: boolean
  badge?: string
}

export const MENU_GROUPS: { label: string; items: MenuItem[] }[] = [
  {
    label: 'ภาพรวม',
    items: [{ key: 'dashboard', label: 'แดชบอร์ด', desc: 'ภาพรวมสต๊อกแม่พิมพ์', icon: '📊' }],
  },
  {
    label: 'คลังแม่พิมพ์',
    items: [
      { key: 'stock', label: 'เช็คสต๊อก', desc: 'ดูสต๊อกแบบ Excel / ค้นหา / รายละเอียด', icon: '🔍' },
      { key: 'molds', label: 'ทะเบียนแม่พิมพ์', desc: 'เพิ่ม / แก้ไข ข้อมูลมาสเตอร์', icon: '📦' },
      { key: 'receive', label: 'รับเข้า', desc: 'รับแม่พิมพ์ใหม่เข้าคลัง', icon: '📥' },
    ],
  },
  {
    label: 'ซ่อม & คุณภาพ',
    items: [
      { key: 'repairs', label: 'แจ้งซ่อม / ส่งซ่อม', desc: 'ใบ P4R1 / สถานะซ่อม', icon: '🛠', badge: 'ค้าง' },
      { key: 'inspect', label: 'ตรวจวัด', desc: 'บันทึกผลวัด / ประวัติ', icon: '📏' },
      { key: 'retire', label: 'ปลดระวาง', desc: 'จำหน่าย / ตัดออกจากระบบ', icon: '🗑' },
    ],
  },
  {
    label: 'บริหาร',
    items: [
      { key: 'reports', label: 'รายงาน', desc: 'สต๊อก / เคลื่อนไหว / ซ่อม', icon: '📑' },
      { key: 'label-setup', label: 'ตั้งค่าใบแปะ', desc: 'ออกแบบใบแปะแม่พิมพ์อิสระ', icon: '🏷️' },
      { key: 'users', label: 'ผู้ใช้ & สิทธิ์', desc: 'ช่าง / Admin / รหัสผ่าน', icon: '👥', adminOnly: true },
    ],
  },
]

export const PAGE_META: Record<PageKey, { title: string; sub: string }> = {
  dashboard: { title: 'ภาพรวมสต๊อกแม่พิมพ์', sub: 'สถานะเรียลไทม์ของคลังแม่พิมพ์ทั้งหมด' },
  stock: { title: 'เช็คสต๊อกแม่พิมพ์', sub: 'ดูสต๊อกแบบเดียวกับไฟล์ Excel — แยกชีท แยก SIZE พร้อมรายละเอียด' },
  molds: { title: 'ทะเบียนแม่พิมพ์', sub: 'เพิ่ม / แก้ไข ข้อมูลมาสเตอร์แม่พิมพ์' },
  receive: { title: 'รับเข้าแม่พิมพ์', sub: 'รับแม่พิมพ์ใหม่ / สั่งทำ / ส่งคืนจากซ่อม' },
  repairs: { title: 'แจ้งซ่อม / ส่งซ่อม', sub: 'ใบแจ้งซ่อม P4R1 และติดตามสถานะ' },
  inspect: { title: 'ตรวจวัด', sub: 'บันทึกผลตรวจวัดและประวัติคุณภาพ' },
  retire: { title: 'ปลดระวาง', sub: 'จำหน่ายแม่พิมพ์ที่หมดอายุ / ชำรุด' },
  reports: { title: 'รายงาน', sub: 'ออกรายงานสต๊อก ความเคลื่อนไหว และซ่อมค้าง' },
  'label-setup': { title: 'ตั้งค่าใบแปะแม่พิมพ์', sub: 'ออกแบบขนาด ส่วนประกอบ และข้อความบนใบแปะอิสระ' },
  users: { title: 'ผู้ใช้ & สิทธิ์', sub: 'จัดการบัญชีช่างและผู้ดูแลระบบ' },
}
