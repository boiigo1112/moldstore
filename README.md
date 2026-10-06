# MoldStore (Store1) — ระบบจัดการสต็อกแม่พิมพ์

เว็บแอปจัดการสต็อกแม่พิมพ์โรงงาน: ทะเบียนแม่พิมพ์, ใบส่งซ่อม/รับคืน, รายงานสรุป, พิมพ์ฉลาก/ใบงาน

## สถาปัตยกรรม (3 ส่วน)

| ส่วน | เทคโนโลยี | พอร์ต |
|---|---|---|
| หน้าเว็บ | React 18 + Vite + TypeScript (`web/`) | 5173 |
| Workflow sidecar | Python (`wf/server.py`) — API งานจริงที่ใช้ตอนนี้ | 8081 |
| API หลัก | Go (`api/moldstore-api.exe`, Windows เท่านั้น, ไม่มีซอร์ส) | 8080 |

> ฝั่ง Linux/macOS ใช้ sidecar (8081) เป็น API หลักแทน ระบบล็อกอินมีโหมดพัฒนารองรับอยู่แล้ว

## วิธีรัน

**Windows:** ดับเบิลคลิก `start-windows.bat`
**Linux/macOS:** `bash start-dev.sh`

แล้วเปิด http://localhost:5173

บัญชีทดสอบ: `admin / admin123` (แอดมิน), `tech01 / tech123` (ช่าง)

## โครงสร้าง

```
.
├── web/            # React frontend (Vite + TS)
│   ├── src/pages/  # หน้า: Dashboard, Molds, Repairs, Stock, Reports, LabelSetup, Login
│   ├── src/components/  # Layout, MoldLabel, RepairSlip, SlipFit
│   └── public/data/     # JSON ข้อมูล (สร้างจาก tools/import_excel.py)
├── wf/
│   └── server.py   # Python sidecar: auth, live status, docs, machines (:8081)
├── tools/
│   ├── import_excel.py    # นำเข้าข้อมูลจาก .xlsm -> JSON + app.db
│   └── reconcile_status.py # ตรวจ/แก้สถานะแม่พิมพ์ให้ตรงกับใบซ่อมค้าง
├── api/            # moldstore-api.exe (อยู่ในไฟล์ rar ต้นฉบับ, ไม่ commit)
├── data/           # app.db / wf.db (อยู่ในไฟล์ rar ต้นฉบับ, ไม่ commit)
└── path/           # ไฟล์ .xlsm ต้นฉบับ (ไม่ commit)
```

## นำเข้าข้อมูลใหม่

```bash
python3 tools/import_excel.py
```

อ่านไฟล์ `.xlsm` ใน `path/` แล้วสร้าง JSON + อัปเดต `data/app.db` อัตโนมัติ
(มี reconcile สถานะกับใบซ่อมค้างในตัว)

## หมายเหตุ

- ไฟล์ `.db`, `.exe`, `.xlsm` ไม่ได้อยู่ใน git — อยู่ใน `Store1_0_t3zk.rar` ต้นฉบับ
- คู่มือสำหรับ dev ดู `README-DEV.md`
