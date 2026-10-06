# MoldStore — คู่มือติดตั้งเพื่อพัฒนาต่อ

**ที่มา:** แตกจาก `Store1_0_t3zk.rar` (23 MB) → โฟลเดอร์ `src/` ในโปรเจกต์นี้
**วันที่ติดตั้ง:** 2026-10-06
**สถานะ:** พร้อมพัฒนาต่อบน Linux (frontend + workflow sidecar) ✅

---

## 1. ระบบนี้คืออะไร

**MoldStore v0.1 — ระบบจัดการคลังแม่พิมพ์ (Mold Store Management System)** ภาษาไทยทั้งระบบ
รับเข้า · เบิก-คืน · ส่งซ่อม (ใบ P4R1) · ตรวจวัด · ปลดระวาง · รายงานสต๊อก

### สถาปัตยกรรม (3 ส่วน)
┌─────────────┐      /api/* (proxy)      ┌──────────────────────┐
│  React +    │ ───────────────────────▶ │ moldstore-api.exe    │  port 8080
│  Vite (dev  │                          │ Go + SQLite (exe)    │  ⚠️ Windows เท่านั้น
│  :5173)     │      /wf/* (proxy)       └──────────────────────┘
│             │ ───────────────────────▶ ┌──────────────────────┐
└─────────────┘                          │ wf/server.py         │  port 8081
                                         │ Python (มี source)    │  ✅ รันบน Linux ได้
                                         └──────────────────────┘
```

| ส่วน | เทคโนโลยี | source code | รันบน Linux |
|---|---|---|---|
| Frontend `web/` | React 18 + Vite 6 + TypeScript | ✅ มีครบ | ✅ |
| Workflow sidecar `wf/server.py` | Python (stdlib + bcrypt) | ✅ มีครบ | ✅ |
| API หลัก `api/moldstore-api.exe` | Go 1.21 + SQLite (modernc) + JWT | ❌ มีแค่ไฟล์ exe (Windows) | ❌ |

**API หลักทำอะไร** (สกัดจาก binary): `POST /api/login`, `GET /api/me`, `GET /api/dashboard`, `GET /api/health` + serve ไฟล์ static ของ `web/dist`
**Sidecar ทำอะไร** (อ่านจาก source ได้เต็ม): `/wf/login`, `/wf/live`, `/wf/machines`, `/wf/swap` (เบิก-สลับคืน ออกเลข P4R อัตโนมัติ), `/wf/molds`, `/wf/repairs` (+ receive/reconcile), `/wf/docs`, `/wf/dims`, `/wf/integrity`, `/wf/sync` — เก็บข้อมูลใน `data/wf.db` และ mirror สถานะกลับไป `data/app.db`

> หน้าเว็บส่วนใหญ่ (ทะเบียน, ส่งซ่อม, เช็คสต๊อก) เรียกผ่าน `/wf/*` เป็นหลัก ส่วน `/api/*` ใช้แค่ login / dashboard สรุปภาพรวม

---

## 2. ข้อมูลในระบบ (วิเคราะห์แล้ว)

### ฐานข้อมูล `data/app.db` (SQLite)
| ตาราง | จำนวน | หมายเหตุ |
|---|---|---|
| `molds` | 799 | spare 594 / installed 164 / repair 39 / retired 2 |
| `repair_orders` | 2,222 | open 183 / received 2,039 (เลข P4R-01-0001 …) |
| `users` | 2 | admin (ผู้ดูแลระบบ), tech01 (ช่าง 01) |

`molds`: `code` (เช่น `DIEP1-109-6301`), `tooling_type`, `size`, `status`, `machine`
`data/app.db.bak` = สำรองก่อน import, `data/wf.db` = ข้อมูล workflow (machines 43 เครื่อง, mold_live mirror 799 รายการ)

### ไฟล์ Excel ต้นฉบับ `path/แจ้งซ่อมแม่พิมพ์ ปี2569 ล่าสุด .xlsm`
- ชีท `P4R1` (2,228 แถว) = ใบแจ้งซ่อม · `DIEP1/PUNCHP1/PUNCHP3/DIEP3` = ทะเบียนสต็อก · `WORKSHOP (ใหม่ล่าสุด)` = ฟอร์มต้นฉบับ · `รหัสแบบ` = รหัสแบบตามชนิด tooling · `REDRAWP2` = ชีตว่าง
- **ไฟล์นี้โครงสร้างตรงกับ `2569.xlsm` ที่เคยนำเข้าระบบเดิมทุกประการ** (ข้อมูลชุดเดียวกัน)
- `tools/import_excel.py` = สคริปต์นำ Excel → `web/public/data/*.json` + `data/app.db` (ลบแถว DEMO, สำรอง .bak อัตโนมัติ)

### JSON สำเร็จรูป `web/public/data/`
`molds.json` 799 · `repairs.json` 2,222 · `orphans.json` 1,263 (ใบซ่อมที่ผูกกับแม่พิมพ์ไม่ได้) · `patterns.json` 74 · `meta.json` (สรุปยอด)

---

## 3. สิ่งที่ติดตั้งแล้ว (2026-10-06)

- [x] แตกไฟล์ทั้งหมด → `src/` (2,516 ไฟล์; ตัด `__pycache__` ออกได้)
- [x] **Frontend:** ลบ `node_modules` ที่แพ็กมาจาก Windows ทิ้ง → `npm install` ใหม่บน Linux → `npm run build` ผ่าน ✅ (hash ไฟล์ตรงกับ dist ที่แถมมา แปลว่า build ซ้ำได้ตรงต้นฉบับ)
- [x] **Sidecar:** ติดตั้ง `bcrypt` + `openpyxl` (Python 3.12) → ทดสอบบูต + login จริง (`admin/admin123`) + เรียก `/wf/summary`, `/wf/live` ผ่าน ✅
- [x] ทดสอบ dev server: Vite `:5173` → proxy `/wf/*` → sidecar `:8081` ครบวงจร ✅

---

## 4. วิธีรันเพื่อพัฒนาต่อ

เปิด 2 terminal (อย่าใช้ DB ตัวจริงตรง ๆ — copy ไปใช้ก่อน กันข้อมูลเพี้ยน):

```bash
# เตรียม DB สำหรับ dev (ทำครั้งเดียว)
mkdir -p ~/workspace/store-project/dev-data
cp src/data/app.db src/data/wf.db ~/workspace/store-project/dev-data/

# Terminal 1 — workflow sidecar (port 8081)
cd ~/workspace/store-project/src
python3 wf/server.py --port 8081 \
  --db ~/workspace/store-project/dev-data/wf.db \
  --app-db ~/workspace/store-project/dev-data/app.db

# Terminal 2 — frontend dev (port 5173)
cd ~/workspace/store-project/src/web
npm run dev
```

เปิดเบราว์เซอร์ → http://localhost:5173
- บัญชีทดลอง: `admin / admin123` (ผู้ดูแลระบบ) · `tech01 / tech123` (ช่าง)
- **โหมด dev (2026-10-06):** แพตช์ `web/src/pages/Login.tsx` + `web/src/auth.tsx` ให้ fallback ไป login ผ่าน workflow sidecar (`/wf/login`, `/wf/me`) เมื่อ Go API (port 8080) ไม่รัน — หน้า login จะขึ้นป้าย "⚙️ โหมดพัฒนา" สีเทาเตือนไว้ ถ้า exe รันอยู่จะใช้ path เดิมปกติ ไม่กระทบ production
- สตาร์ทเร็ว: `bash ~/workspace/store-project/start-dev.sh` (รัน sidecar + vite เป็น background, log ใน `logs/`)

```bash
# build ไฟล์ production
cd ~/workspace/store-project/src/web && npm run build   # ได้ไฟล์ใน web/dist/

# นำเข้า Excel ใหม่ (ระวัง: เขียนทับ app.db — มี .bak สำรองอัตโนมัติ)
cd ~/workspace/store-project/src && python3 tools/import_excel.py
```

---

## 5. ข้อจำกัดสำคัญ ⚠️

1. **`moldstore-api.exe` รันบน Linux ไม่ได้** (ไฟล์ Windows PE32+) และ**ไม่มี source code ของ Go backend** แถมมา — พัฒนาต่อได้เฉพาะ frontend + sidecar บน Linux
   - ทางเลือก: (ก) รัน exe บนเครื่อง Windows แล้วให้ frontend ชี้ไป (ข) เขียน backend ใหม่แทน (มี API surface ไม่ซับซ้อน: login/me/dashboard — ดู `web/src/api.ts`) (ค) ขอ source Go จากคนทำเดิม
2. **ห้ามใช้ `data/app.db` ตัวจริงตอน dev** — ใช้สำเนาใน `dev-data/` (sidecar มี logic mirror สถานะกลับเข้า app.db)
3. รหัสผ่านใน DB เป็น bcrypt — ถ้าจะเปลี่ยนรหัส admin ต้องแก้ผ่าน code หรือขอจากคนทำเดิม
4. `web/dist/` ที่แถมมา build ซ้ำได้ตรง 100% — แปลว่า source กับ dist ตรงกัน เชื่อถือได้

---

## 6. โครงสร้างไฟล์

```
src/
├── api/moldstore-api.exe      # backend หลัก (Go, Windows เท่านั้น)
├── data/                      # app.db, wf.db, app.db.bak (ตัวจริง — อย่าแก้ตรง)
├── path/                      # ไฟล์ Excel ต้นฉบับ (.xlsm)
├── tools/import_excel.py       # สคริปต์นำเข้า Excel → JSON + SQLite
├── wf/server.py               # workflow sidecar (Python, แก้ไขได้)
└── web/
    ├── src/                   # React source (pages/, components/, api.ts, wf.ts …)
    │   └── pages/            # Dashboard, Stock, Molds, Repairs, Reports, LabelSetup, Login
    ├── public/data/           # JSON ข้อมูลสำเร็จรูป
    ├── dist/                  # build สำเร็จ (serve ด้วย nginx/Dockerfile ได้)
    ├── Dockerfile, nginx.conf # สำหรับ deploy ฝั่ง web
    └── package.json
```

เมนูในระบบ: แดชบอร์ด · เช็คสต๊อก · ทะเบียนแม่พิมพ์ · รับเข้า · แจ้งซ่อม/ส่งซ่อม · ตรวจวัด · ปลดระวาง · รายงาน · ตั้งค่าใบแปะ · ผู้ใช้ & สิทธิ์ (admin)

---

## 7. รันบนเครื่องตัวเอง (Windows) — สำหรับเปิดดู/ใช้งานจริง

ไฟล์ `start-windows.bat` (ดับเบิลคลิกไฟล์เดียวจบ):
1. แตกไฟล์ `Store1_0_t3zk.rar` ไว้ที่ใดที่หนึ่ง แล้ววาง `start-windows.bat` ไว้ในโฟลเดอร์เดียวกัน (ข้าง ๆ โฟลเดอร์ `api`, `wf`, `web`, `data`)
2. ครั้งแรกต้องมี **Python** (python.org, ติ๊ก Add to PATH) และ **Node.js** (nodejs.org, ตัว LTS) — ไฟล์ bat จะเช็กและบอกเองถ้ายังไม่มี
3. ดับเบิลคลิก `start-windows.bat` → จะเปิดหน้าต่างมา 3 บาน (API :8080, workflow :8081, web :5173) แล้วเปิดเบราว์เซอร์ให้อัตโนมัติ
4. login: `admin / admin123` (ช่าง: `tech01 / tech123`)

บน Windows จะได้โหมดเต็ม (รวม Go API ตัว exe) ไม่ต้องใช้ patch โหมดพัฒนา
