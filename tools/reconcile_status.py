"""Reconcile สถานะแม่พิมพ์กับใบซ่อมที่ค้างอยู่

ปัญหา: ชีทสต็อกใน Excel อาจระบุสถานะเป็น สแปร์/ใช้งานบนเครื่อง ทั้งที่แม่พิมพ์ตัวนั้น
มีใบซ่อมสถานะ open (ค้าง) อยู่ -> สถานะที่ถูกต้องคือ repair (ส่งซ่อม)

สคริปต์นี้หาแม่พิมพ์ที่ผูกกับใบซ่อม open แล้วแต่สถานะไม่ใช่ repair แล้วแก้ให้:
- data/app.db (ตาราง molds)
- data/wf.db (ตาราง mold_live)
- web/public/data/molds.json + meta.json (นับ by_type ใหม่)

รันจากโฟลเดอร์ Store1:  python tools/reconcile_status.py [--apply]
ค่าเริ่มต้น dry-run (แสดงอย่างเดียว) ใส่ --apply เพื่อเขียนจริง
"""
import io
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "web", "public", "data")
APP_DB = os.path.join(ROOT, "data", "app.db")
WF_DB = os.path.join(ROOT, "data", "wf.db")
STATUS_TH = {"spare": "สแปร์", "installed": "ใช้งานบนเครื่อง",
             "repair": "ส่งซ่อม", "retired": "ยกเลิกใช้งาน"}


def find_mismatches():
    repairs = json.load(open(os.path.join(DATA_DIR, "repairs.json"), encoding="utf-8"))
    open_codes = {}
    for r in repairs:
        if r.get("status") == "open":
            for c in (r.get("link") or {}).get("linked_codes", []):
                open_codes.setdefault(c, []).append(r["source_no"])
    con = sqlite3.connect(APP_DB)
    mism = []
    for code, papers in open_codes.items():
        row = con.execute("SELECT status, tooling_type, size FROM molds WHERE code=?",
                          (code,)).fetchone()
        if row and row[0] != "repair":
            mism.append({"code": code, "from": row[0], "tooling_type": row[1],
                         "size": row[2], "papers": papers})
    con.close()
    return mism


def apply(mism):
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    codes = [m["code"] for m in mism]
    # 1) app.db
    shutil.copy2(APP_DB, APP_DB + ".bak")
    con = sqlite3.connect(APP_DB, timeout=30.0)
    con.executemany("UPDATE molds SET status='repair' WHERE code=?",
                    [(c,) for c in codes])
    con.commit()
    n1 = con.total_changes
    con.close()
    # 2) wf.db (mirror)
    if os.path.exists(WF_DB):
        con = sqlite3.connect(WF_DB, timeout=30.0)
        con.executemany(
            "UPDATE mold_live SET status='repair', updated_at=?, updated_by='reconcile' WHERE code=?",
            [(now, c) for c in codes])
        con.commit()
        n2 = con.total_changes
        con.close()
    else:
        n2 = 0
    # 3) molds.json + meta.json
    pj = os.path.join(DATA_DIR, "molds.json")
    molds = json.load(open(pj, encoding="utf-8"))
    codeset = set(codes)
    for m in molds:
        if m["code"] in codeset and m["status"] != "repair":
            m["status"] = "repair"
            m["status_th"] = STATUS_TH["repair"]
    with io.open(pj, "w", encoding="utf-8") as fh:
        json.dump(molds, fh, ensure_ascii=False)
    by_type = {}
    for m in molds:
        t = by_type.setdefault(m["sheet"], {"total": 0, "spare": 0, "installed": 0,
                                             "repair": 0, "retired": 0})
        t["total"] += 1
        t[m["status"]] += 1
    mj = os.path.join(DATA_DIR, "meta.json")
    meta = json.load(open(mj, encoding="utf-8"))
    meta["by_type"] = by_type
    meta["imported_at"] = now
    with io.open(mj, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    print(f"  app.db: {n1} แถว | wf.db mold_live: {n2} แถว | molds.json/meta.json อัปเดตแล้ว")


def main():
    apply_flag = "--apply" in sys.argv
    mism = find_mismatches()
    print(f"พบแม่พิมพ์ที่ผูกกับใบซ่อมค้างแต่สถานะไม่ใช่ repair: {len(mism)} ตัว")
    for m in mism:
        print(f"  {m['code']} | {m['from']} -> repair | {m['tooling_type']} {m['size']} | {m['papers']}")
    if not mism:
        return
    if not apply_flag:
        print("dry-run: ใส่ --apply เพื่อเขียนจริง")
        return
    apply(mism)
    print("เสร็จ")


if __name__ == "__main__":
    main()
