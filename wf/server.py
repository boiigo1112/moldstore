"""MoldStore workflow sidecar API (port 8081).

งานวงจรแม่พิมพ์: เบิก-สลับคืน (ออก P4R อัตโนมัติ), live status, machines.
- เก็บเอกสาร/ความเคลื่อนไหวใน data/wf.db (ของตัวเอง ไม่แตะโครงสร้าง app.db ของ exe)
- auth: ตรวจรหัสผ่านกับตาราง users ใน app.db (อ่านอย่างเดียว) แล้วออก token ของตัวเอง
- mirror สถานะปัจจุบันกลับไป app.db (molds/repair_orders) เพื่อให้ dashboard ของ exe เห็นตัวเลขจริง

รัน:  python wf/server.py [--port 8081] [--db data/wf.db] [--app-db data/app.db] [--seed]
"""
import argparse
import datetime as dt
import json
import os
import re
import secrets
import sqlite3
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bcrypt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_TTL_HOURS = 12
ALLOW_ROLES_SWAP = ("technician", "store", "admin")
ALLOW_ROLES_MASTER = ("store", "admin")

# ชนิดแม่พิมพ์ + ชื่องานตามไฟล์ Excel (ทะเบียนของใหม่ต้องอยู่ใน 4 ชีทนี้)
STOCK_SHEETS = ("DIEP1", "PUNCHP1", "PUNCHP3", "DIEP3")
SHEET_TOOLING = {"DIEP1": "DIE CUTTER P1", "PUNCHP1": "PUNCH CUTTER P1",
                 "PUNCHP3": "PUNCH CUTTER P3", "DIEP3": "DIE CUTTER P3"}
SHEET_WORK = {"DIEP1": "DIECUTTERP1", "PUNCHP1": "PUNCH CUTTER P1",
              "PUNCHP3": "PUNCH CUTTER P3", "DIEP3": "DIECUTTERP3"}
SHEETS_WITH_GRADE = ("DIEP1", "PUNCHP1")


def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def today():
    return dt.date.today().isoformat()


def be_year2():
    return dt.date.today().year + 543 - 2500  # 2569 -> 69


# ---------------- db ----------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS machines(code TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS mold_live(code TEXT PRIMARY KEY, status TEXT NOT NULL, machine TEXT,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_type TEXT NOT NULL,
  doc_no TEXT UNIQUE NOT NULL, doc_date TEXT NOT NULL, actor TEXT NOT NULL, machine TEXT,
  note TEXT, ref_doc TEXT, voided INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doc_items(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL,
  mold_code TEXT NOT NULL, role TEXT NOT NULL, prev_status TEXT, new_status TEXT);
CREATE TABLE IF NOT EXISTS inspections(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_no TEXT NOT NULL,
  mold_code TEXT NOT NULL, measured TEXT NOT NULL, verdict TEXT NOT NULL,
  inspector TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY AUTOINCREMENT, mold_code TEXT NOT NULL,
  doc_no TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, machine TEXT,
  actor TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seq(name TEXT PRIMARY KEY, last INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mold_static(code TEXT PRIMARY KEY, data TEXT NOT NULL);
-- repair_meta: ค่าที่แก้ผ่านระบบของใบซ่อม ( durable ข้ามการ import ใหม่ )
-- deleted=1 คือ tombstone: ใบนี้ถูกลบแล้ว ห้าม import งอกกลับมา
CREATE TABLE IF NOT EXISTS repair_meta(source_no TEXT PRIMARY KEY, detail TEXT, pattern_code TEXT,
  requester TEXT, machine TEXT, department TEXT, remark TEXT, qty TEXT, unit TEXT,
  priority TEXT, due_date TEXT, job_name TEXT, ordered_date TEXT, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tokens(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
  username TEXT NOT NULL, role TEXT NOT NULL, expires_at TEXT NOT NULL);
"""


def wf_connect(db_path):
    con = sqlite3.connect(db_path, timeout=30.0)
    con.row_factory = sqlite3.Row
    return con


def init_db(db_path):
    con = wf_connect(db_path)
    con.executescript(SCHEMA)
    try:  # migrate: ใบซ่อมรุ่นใหม่มีระดับความเร่งด่วน
        con.execute("ALTER TABLE docs ADD COLUMN priority TEXT")
    except Exception:  # noqa: BLE001
        pass  # มีคอลัมน์แล้ว
    try:  # migrate: ใบซ่อมรุ่นใหม่เก็บรหัสแบบ
        con.execute("ALTER TABLE docs ADD COLUMN pattern_code TEXT")
    except Exception:  # noqa: BLE001
        pass  # มีคอลัมน์แล้ว
    for col in ("job_type", "due_date", "requester", "department", "remark", "qty", "unit"):
        try:  # migrate: ฟอร์มใบส่งซ่อมครบฟิลด์ (ประเภทงาน/กำหนดเสร็จ/ผู้สั่ง/แผนก/หมายเหตุ/จำนวน/หน่วย)
            con.execute(f"ALTER TABLE docs ADD COLUMN {col} TEXT")
        except Exception:  # noqa: BLE001
            pass  # มีคอลัมน์แล้ว
    con.commit()
    con.close()


def seed(db_path, app_db, data_json):
    """ตั้งต้น mold_live + machines (เพิ่มเฉพาะของใหม่ ไม่ทับงานที่ขยับแล้ว)"""
    init_db(db_path)
    with open(data_json, encoding="utf-8") as fh:
        molds = json.load(fh)
    con = wf_connect(db_path)
    ts, added_live, added_mac = now_iso(), 0, 0
    for m in molds:
        cur = con.execute("INSERT OR IGNORE INTO mold_live(code,status,machine,updated_at,updated_by)"
                          " VALUES(?,?,?,?,?)",
                          (m["code"], m["status"], m["machine"], ts, "import"))
        added_live += cur.rowcount
        if m["machine"]:
            added_mac += con.execute("INSERT OR IGNORE INTO machines(code) VALUES(?)",
                                     (m["machine"],)).rowcount
    # เครื่องจาก app.db (เผื่อมี TP27 แบบใน P4R1)
    try:
        app = sqlite3.connect(f"file:{app_db}?mode=ro", uri=True)
        for (mc,) in app.execute("SELECT DISTINCT machine FROM molds WHERE machine IS NOT NULL"):
            if mc and str(mc).strip():
                added_mac += con.execute("INSERT OR IGNORE INTO machines(code) VALUES(?)",
                                         (str(mc).strip(),)).rowcount
        app.close()
    except Exception as e:  # noqa: BLE001
        print(f"  (ข้าม machines จาก app.db: {e})")
    con.commit()
    n_live = con.execute("SELECT COUNT(*) FROM mold_live").fetchone()[0]
    n_mac = con.execute("SELECT COUNT(*) FROM machines").fetchone()[0]
    con.close()
    print(f"seed: mold_live={n_live} (+{added_live} ใหม่), machines={n_mac} (+{added_mac} ใหม่)")


# ---------------- numbering ----------------

SHEET_BY_TOOLING = {"DIE CUTTER P1": "DIEP1", "PUNCH CUTTER P1": "PUNCHP1",
                   "PUNCH CUTTER P3": "PUNCHP3", "DIE CUTTER P3": "DIEP3"}
STOCK_SHEETS = ("DIEP1", "PUNCHP1", "PUNCHP3", "DIEP3")


def parse_mold_code(code):
    """แกะรหัส {SHEET}-{SIZE}-{No.} -> (sheet, size, no) ตาม convention เดียวกับ frontend"""
    for s in STOCK_SHEETS:
        if code == s or code.startswith(s + "-"):
            rest = code[len(s) + 1:]
            if "-" in rest:
                size, no = rest.rsplit("-", 1)
                return s, size, no
    return None, None, None


def mold_groups(app_db, codes):
    """คืน dict code -> (sheet, size, no, tooling) โดยใช้ app.db เป็นหลัก, แกะรหัสเป็น fallback"""
    out = {}
    try:
        app = sqlite3.connect(f"file:{app_db}?mode=ro", uri=True)
        app.row_factory = sqlite3.Row
        for cd in codes:
            r = app.execute("SELECT tooling_type,size FROM molds WHERE code=?", (cd,)).fetchone()
            if r and r["size"]:
                sheet = SHEET_BY_TOOLING.get(r["tooling_type"] or "")
                s, _, no = parse_mold_code(cd)
                out[cd] = (sheet or s, r["size"], no, r["tooling_type"])
        app.close()
    except Exception:  # noqa: BLE001
        pass
    for cd in codes:
        if cd not in out:
            s, size, no = parse_mold_code(cd)
            if s:
                out[cd] = (s, size, no, None)
    return out


def build_size_ref(groups, codes):
    """สร้างสายอ้างอิงแบบ Excel: S.{size} No.{no1},{no2} (เรียง No.)"""
    if not codes:
        return None
    size = groups[codes[0]][1]
    def key(c):
        no = groups[c][2] or ""
        return (0, int(no), no) if no.isdigit() else (1, 0, no)
    nos = [groups[c][2] for c in sorted(codes, key=key) if groups[c][2]]
    return f"S.{size} No.{','.join(nos)}" if nos else f"S.{size}"


def next_issue_no(con):
    name = f"ISS-{be_year2():02d}"
    row = con.execute("SELECT last FROM seq WHERE name=?", (name,)).fetchone()
    last = (row["last"] if row else 0) + 1
    con.execute("INSERT OR REPLACE INTO seq(name,last) VALUES(?,?)", (name, last))
    return f"ISS-{be_year2():02d}-{last:04d}"


def next_reg_no(con):
    """REG-{yy พ.ศ.2 หลัก}-{running} เช่น REG-69-0001 (ลงทะเบียนของใหม่)"""
    name = f"REG-{be_year2():02d}"
    row = con.execute("SELECT last FROM seq WHERE name=?", (name,)).fetchone()
    last = (row["last"] if row else 0) + 1
    con.execute("INSERT OR REPLACE INTO seq(name,last) VALUES(?,?)", (name, last))
    return f"REG-{be_year2():02d}-{last:04d}"


def next_p4r_no(con, app_db):
    """P4R-{MM}-{seq} รันต่อจากเลขมากสุดทั้งใน app.db และ wf"""
    best = 2222
    try:
        app = sqlite3.connect(f"file:{app_db}?mode=ro", uri=True)
        for (s,) in app.execute("SELECT source_no FROM repair_orders"):
            m = re.search(r"P4R-\d+-(\d+)", str(s or ""))
            if m:
                best = max(best, int(m.group(1)))
        app.close()
    except Exception:  # noqa: BLE001
        pass
    for (s,) in con.execute("SELECT doc_no FROM docs WHERE doc_type='P4R'"):
        m = re.search(r"P4R-\d+-(\d+)", s or "")
        if m:
            best = max(best, int(m.group(1)))
    mm = dt.date.today().month
    return f"P4R-{mm:02d}-{best + 1:04d}"


# ---------------- app.db mirror ----------------

STATUS_TH = {"spare": "สแปร์", "installed": "ใช้งานบนเครื่อง",
             "repair": "ส่งซ่อม", "retired": "ยกเลิกใช้งาน"}


def append_mold_json(entry):
    """เติมของลงทะเบียนใหม่ลง molds.json (public + สำเนา dist ถ้ามี)
    entry ต้องมี sheet/size แล้ว — block/seq จัดให้อยู่ในกลุ่ม SIZE เดียวกัน"""
    paths = [os.path.join(ROOT, "web", "public", "data", "molds.json")]
    dist_copy = os.path.join(ROOT, "web", "dist", "data", "molds.json")
    if os.path.exists(dist_copy):
        paths.append(dist_copy)
    updated = 0
    for p in paths:
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as fh:
                items = json.load(fh)
        except (ValueError, OSError):
            continue
        if any(m.get("code") == entry["code"] for m in items):
            continue
        same = [m for m in items if m.get("sheet") == entry["sheet"] and m.get("size") == entry["size"]]
        if same:
            entry["block"] = same[-1]["block"]
            entry["seq"] = max(m.get("seq", 0) for m in same) + 1
        else:
            blocks = [m.get("block", 0) for m in items if m.get("sheet") == entry["sheet"]]
            entry["block"] = (max(blocks) if blocks else 0) + 1
            entry["seq"] = 1
        items.append(entry)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False)
        updated += 1
    return updated


def mirror_statuses(app_db, changes, new_repair=None):
    """changes=[(status,machine,code)], new_repair=(source_no,job_name,ordered_date)"""
    con = sqlite3.connect(app_db, timeout=30.0)
    for status, machine, code in changes:
        con.execute("UPDATE molds SET status=?, machine=? WHERE code=?", (status, machine, code))
    if new_repair:
        sno, job, od = new_repair
        con.execute("INSERT OR IGNORE INTO repair_orders(source_no,job_name,status,ordered_date,created_at)"
                    " VALUES(?,?,?,?,?)",
                    (sno, job, "open", od, now_iso()))
    con.commit()
    con.close()


META_COLS = ("detail", "pattern_code", "requester", "machine", "department", "remark",
             "qty", "unit", "priority", "due_date", "job_name", "ordered_date")


def meta_upsert(con, sno, values, deleted=None):
    """เก็บค่าที่แก้ผ่านระบบลง repair_meta (durable ข้าม import)"""
    cur = con.execute("SELECT source_no FROM repair_meta WHERE source_no=?", (sno,)).fetchone()
    if cur:
        sets, args = [], []
        for k, v in values.items():
            if k in META_COLS:
                sets.append(f"{k}=?")
                args.append(v)
        if deleted is not None:
            sets.append("deleted=?")
            args.append(deleted)
        if sets:
            con.execute(f"UPDATE repair_meta SET {', '.join(sets)} WHERE source_no=?", (*args, sno))
    else:
        cols = ["source_no"] + [k for k in values if k in META_COLS] + (["deleted"] if deleted is not None else [])
        vals = [sno] + [values[k] for k in values if k in META_COLS] + ([deleted] if deleted is not None else [])
        con.execute(f"INSERT INTO repair_meta({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})", vals)


# doc column -> repairs.json field (สำหรับ patch ไฟล์ให้ UI เห็นทันที)
JSON_MAP = {"note": "detail", "pattern_code": "pattern_code", "requester": "requester",
            "machine": "machine", "department": "department", "remark": "remark",
            "qty": "qty", "unit": "unit", "priority": "priority", "due_date": "due_date",
            "doc_date": "ordered_date", "job_name": "job_name"}


def patch_repairs_json(sno, values):
    """patch ค่าลง repairs.json ทันที (public + dist) ให้ UI ตรงกับ DB โดยไม่ต้องรอ import"""
    paths = [os.path.join(ROOT, "web", "public", "data", "repairs.json")]
    dist_copy = os.path.join(ROOT, "web", "dist", "data", "repairs.json")
    if os.path.exists(dist_copy):
        paths.append(dist_copy)
    for p in paths:
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as fh:
                items = json.load(fh)
        except (ValueError, OSError):
            continue
        hit = False
        for r in items:
            if r.get("source_no") == sno:
                for k, v in values.items():
                    if k in JSON_MAP:
                        r[JSON_MAP[k]] = v
                hit = True
                break
        if hit:
            with open(p, "w", encoding="utf-8") as fh:
                json.dump(items, fh, ensure_ascii=False)


def txn_retry(con, work, tries=3):
    """รัน work() (ที่เขียน DB แต่ยังไม่ commit) ซ้ำได้ถ้าชน IntegrityError (เช่น เลขเอกสารซ้ำจาก request พร้อมกัน)"""
    last = None
    for _ in range(tries):
        try:
            out = work()
            con.commit()
            return out, None
        except sqlite3.IntegrityError as e:
            con.rollback()
            last = e
    return None, last


# ---------------- http ----------------

class Handler(BaseHTTPRequestHandler):
    server_version = "MoldWF/0.1"

    def log_message(self, *a):  # เงียบ log ปกติ
        pass

    # -- helpers --
    def body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    def send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def auth(self):
        h = self.headers.get("Authorization") or ""
        if not h.startswith("Bearer "):
            return None
        tok = h[7:]
        con = wf_connect(self.server.db_path)
        row = con.execute("SELECT user_id,username,role,expires_at FROM tokens WHERE token=?",
                          (tok,)).fetchone()
        con.close()
        if not row or row["expires_at"] < now_iso():
            return None
        return {"id": row["user_id"], "username": row["username"], "role": row["role"]}

    # -- routes --
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/wf/login":
            return self.r_login()
        user = self.auth()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        if path == "/wf/machines":
            return self.r_add_machine(user)
        if path == "/wf/swap":
            return self.r_swap(user)
        if path == "/wf/molds":
            return self.r_register(user)
        if path == "/wf/repairs":
            return self.r_repair_create(user)
        if path == "/wf/repairs/receive":
            return self.r_repair_receive(user)
        if path == "/wf/repairs/reconcile":
            return self.r_repair_reconcile(user)
        if path == "/wf/sync":
            return self.r_sync(user)
        return self.send(404, {"error": "not found"})

    def _repair_no_from_path(self, path):
        # /wf/repairs/<source_no> -> source_no | None
        if path.startswith("/wf/repairs/"):
            sno = urllib.parse.unquote(path[len("/wf/repairs/"):]).strip()
            if sno and "/" not in sno:
                return sno
        return None

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        user = self.auth()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        sno = self._repair_no_from_path(path)
        if sno:
            return self.r_repair_update(user, sno)
        return self.send(404, {"error": "not found"})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        user = self.auth()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        sno = self._repair_no_from_path(path)
        if sno:
            return self.r_repair_delete(user, sno)
        return self.send(404, {"error": "not found"})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path, qs = parsed.path, urllib.parse.parse_qs(parsed.query)
        if path == "/wf/health":
            return self.send(200, {"ok": True})
        user = self.auth()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        if path == "/wf/me":
            return self.send(200, {"user": user})
        if path == "/wf/machines":
            con = wf_connect(self.server.db_path)
            rows = [dict(r) for r in con.execute("SELECT code,active FROM machines ORDER BY code")]
            con.close()
            return self.send(200, {"machines": rows})
        if path == "/wf/live":
            con = wf_connect(self.server.db_path)
            rows = [dict(r) for r in
                    con.execute("SELECT code,status,machine,updated_at FROM mold_live")]
            con.close()
            return self.send(200, {"at": now_iso(), "items": rows})
        if path == "/wf/on-machine":
            mc = (qs.get("machine") or [""])[0]
            con = wf_connect(self.server.db_path)
            rows = [dict(r) for r in con.execute(
                "SELECT code,status,machine,updated_at FROM mold_live"
                " WHERE status='installed' AND machine=? ORDER BY code", (mc,))]
            con.close()
            return self.send(200, {"machine": mc, "items": rows})
        if path == "/wf/repairs":
            return self.r_repairs_list(qs)
        if path == "/wf/dims":
            con = wf_connect(self.server.db_path)
            rows = con.execute(
                "SELECT mold_code,measured FROM inspections WHERE id IN"
                " (SELECT MAX(id) FROM inspections GROUP BY mold_code)")
            out = {}
            for r in rows:
                try:
                    d = json.loads(r["measured"] or "{}")
                    if isinstance(d, dict):
                        out[r["mold_code"]] = d
                except (ValueError, TypeError):
                    continue
            con.close()
            return self.send(200, {"dims": out})
        if path == "/wf/docs":
            dtype = (qs.get("type") or [None])[0]
            lim = min(int((qs.get("limit") or ["50"])[0]), 200)
            con = wf_connect(self.server.db_path)
            q = ("SELECT d.*, GROUP_CONCAT(i.mold_code||':'||i.role, ',') AS lines FROM docs d"
                 " LEFT JOIN doc_items i ON i.doc_id=d.id")
            args: list = []
            if dtype:
                q += " WHERE d.doc_type=?"
                args.append(dtype)
            q += " GROUP BY d.id ORDER BY d.id DESC LIMIT ?"
            args.append(lim)
            rows = [dict(r) for r in con.execute(q, args)]
            con.close()
            return self.send(200, {"docs": rows})
        if path == "/wf/summary":
            return self.r_summary()
        if path == "/wf/integrity":
            return self.r_integrity()
        return self.send(404, {"error": "not found"})

    # -- handlers --
    def r_login(self):
        b = self.body()
        u, p = str(b.get("username") or ""), str(b.get("password") or "")
        try:
            app = sqlite3.connect(f"file:{self.server.app_db}?mode=ro", uri=True)
            app.row_factory = sqlite3.Row
            row = app.execute("SELECT id,username,display_name,role,password_hash FROM users"
                              " WHERE username=?", (u,)).fetchone()
            app.close()
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": f"อ่านฐานผู้ใช้ไม่ได้: {e}"})
        if not row or not bcrypt.checkpw(p.encode(), row["password_hash"].encode()):
            return self.send(401, {"error": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"})
        tok = secrets.token_hex(24)
        exp = (dt.datetime.now().astimezone() + dt.timedelta(hours=TOKEN_TTL_HOURS)).isoformat(
            timespec="seconds")
        con = wf_connect(self.server.db_path)
        con.execute("INSERT INTO tokens(token,user_id,username,role,expires_at) VALUES(?,?,?,?,?)",
                    (tok, row["id"], row["username"], row["role"], exp))
        con.execute("DELETE FROM tokens WHERE expires_at < ?", (now_iso(),))
        con.commit()
        con.close()
        user = {"id": row["id"], "username": row["username"],
                "display_name": row["display_name"], "role": row["role"]}
        return self.send(200, {"token": tok, "user": user})

    def r_add_machine(self, user):
        if user["role"] not in ALLOW_ROLES_MASTER:
            return self.send(403, {"error": "ต้องเป็นเจ้าหน้าที่ Store หรือ Admin"})
        code = str(self.body().get("code") or "").strip().upper()
        if not code:
            return self.send(400, {"error": "กรุณาระบุรหัสเครื่อง"})
        con = wf_connect(self.server.db_path)
        con.execute("INSERT OR IGNORE INTO machines(code) VALUES(?)", (code,))
        con.commit()
        con.close()
        return self.send(200, {"machine": {"code": code}})

    def r_register(self, user):
        """ลงทะเบียนแม่พิมพ์ของใหม่ (รับเข้าจากสั่งซื้อ): สร้างรหัส + สถานะสแปร์"""
        if user["role"] not in ALLOW_ROLES_MASTER:
            return self.send(403, {"error": "ต้องเป็นเจ้าหน้าที่ Store หรือ Admin"})
        b = self.body()
        sheet = str(b.get("sheet") or "").strip().upper()
        size = str(b.get("size") or "").strip()
        no = str(b.get("no") or "").strip()
        if sheet not in STOCK_SHEETS:
            return self.send(400, {"error": "ชนิดแม่พิมพ์ไม่ถูกต้อง (DIEP1/PUNCHP1/PUNCHP3/DIEP3)"})
        if not size or not no:
            return self.send(400, {"error": "กรุณาระบุ SIZE และ No."})
        code = f"{sheet}-{size}-{no}".replace(" ", "")
        dims = b.get("dims") or {}
        dims = {str(k).strip(): v for k, v in dims.items()
                if str(k).strip() and v not in (None, "")}
        if not dims:
            return self.send(400, {"error": "กรุณากรอกตัวเลขค่าวัดอย่างน้อย 1 ค่า"})
        grade = str(b.get("grade") or "").strip() or None
        if sheet not in SHEETS_WITH_GRADE:
            grade = None
        remark = str(b.get("remark") or "").strip() or None
        con = wf_connect(self.server.db_path)
        if con.execute("SELECT 1 FROM mold_live WHERE code=?", (code,)).fetchone():
            con.close()
            return self.send(400, {"error": f"รหัส {code} มีอยู่ในระบบแล้ว"})
        ts = now_iso()
        entry = {
            "code": code, "sheet": sheet, "block": 0, "seq": 1,
            "tooling_type": SHEET_TOOLING[sheet], "work_name": SHEET_WORK[sheet],
            "size": size, "no": no, "grade": grade,
            "status": "spare", "status_th": STATUS_TH["spare"],
            "machine": None, "remark": remark, "dims": dims,
        }
        box3: dict = {}
        def _work3():
            doc_no = next_reg_no(con)
            con.execute("INSERT INTO docs(doc_type,doc_no,doc_date,actor,note,created_at)"
                        " VALUES(?,?,?,?,?,?)",
                        ("REG", doc_no, today(), user["username"],
                         f"ลงทะเบียนของใหม่ {code}", ts))
            doc_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
            con.execute("INSERT INTO doc_items(doc_id,mold_code,role,prev_status,new_status)"
                        " VALUES(?,?,?,NULL,'spare')", (doc_id, code, "reg"))
            con.execute("INSERT INTO mold_live(code,status,machine,updated_at,updated_by)"
                        " VALUES(?,?,?,?,?)", (code, "spare", None, ts, user["username"]))
            con.execute("INSERT INTO mold_static(code,data) VALUES(?,?)",
                        (code, json.dumps(entry, ensure_ascii=False)))
            con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                        " VALUES(?,?,NULL,'spare',NULL,?,?)", (code, doc_no, user["username"], ts))
            box3["doc_no"] = doc_no
        _, err3 = txn_retry(con, _work3)
        if err3:
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {err3}"})
        doc_no = box3["doc_no"]
        con.close()
        # mirror ไป app.db (ของใหม่ต้อง INSERT ไม่ใช่ UPDATE)
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            app.execute("INSERT OR IGNORE INTO molds(code,tooling_type,size,status,machine,created_at)"
                        " VALUES(?,?,?,?,?,?)",
                        (code, entry["tooling_type"], size, "spare", None, ts))
            app.commit()
            app.close()
        except Exception:  # noqa: BLE001
            pass
        # เติมลง molds.json ให้หน้าเช็คสต็อกเห็นทันที (block/seq จัดในฟังก์ชัน)
        append_mold_json(entry)
        return self.send(200, {"doc_no": doc_no, "code": code, "entry": entry})

    # -- repairs (แจ้งซ่อม / ส่งซ่อม / รับกลับ) --
    def r_repairs_list(self, qs):
        """คิวใบส่งซ่อมจาก app.db (live) — frontend เอาไปประกบรายละเอียดจาก repairs.json เอง"""
        st = (qs.get("status") or ["all"])[0]
        q = (qs.get("q") or [""])[0].strip().lower()
        lim = min(int((qs.get("limit") or ["5000"])[0]), 10000)
        try:
            app = sqlite3.connect(f"file:{self.server.app_db}?mode=ro", uri=True)
            app.row_factory = sqlite3.Row
            rows = [dict(r) for r in app.execute(
                "SELECT source_no,job_name,status,ordered_date,created_at"
                " FROM repair_orders ORDER BY ordered_date DESC, source_no DESC LIMIT ?", (lim,))]
            app.close()
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": f"อ่านใบซ่อมไม่ได้: {e}"})
        # แนบข้อมูลรับกลับที่ทำในระบบ (วันที่รับงาน + ผู้รับงาน) จาก movements
        # ไม่แตะ schema app.db (exe อ่านไฟล์นี้อยู่)
        try:
            wcon = wf_connect(self.server.db_path)
            rcpts = {}
            for m in wcon.execute(
                    "SELECT doc_no, actor, MAX(at) AS at FROM movements"
                    " WHERE from_status='repair' GROUP BY doc_no"):
                rcpts[m["doc_no"]] = {
                    "date": (m["at"] or "")[:10] or None,
                    "receiver": m["actor"] or None,
                }
            wcon.close()
        except Exception:  # noqa: BLE001
            rcpts = {}
        for r in rows:
            rc = rcpts.get(r["source_no"], {})
            r["received_date"] = rc.get("date")
            r["receiver"] = rc.get("receiver")
        if st in ("open", "received"):
            rows = [r for r in rows if r["status"] == st]
        if q:
            rows = [r for r in rows
                    if q in str(r["source_no"]).lower() or q in str(r["job_name"] or "").lower()]
        return self.send(200, {"repairs": rows, "total": len(rows)})

    def r_repair_create(self, user):
        """ออกใบแจ้งซ่อม/สร้างใหม่ (ฟอร์ม 12 หัวข้อ):
        - งานซ่อม: ต้องเลือกแม่พิมพ์ ≥1 ตัว (ชนิด+SIZE เดียวกัน, สแปร์/บนเครื่อง) -> repair
        - งานสร้างใหม่: ไม่บังคับเลือกตัว (ถ้าเลือกผูกไว้เฉย ๆ ไม่เปลี่ยนสถานะ)"""
        if user["role"] not in ALLOW_ROLES_SWAP:
            return self.send(403, {"error": "ไม่มีสิทธิ์แจ้งซ่อม"})
        b = self.body()
        job_type = str(b.get("job_type") or "repair").strip()
        if job_type not in ("repair", "new"):
            job_type = "repair"
        codes = [str(c).strip() for c in (b.get("mold_codes") or []) if str(c).strip()]
        if not codes and b.get("mold_code"):
            codes = [str(b.get("mold_code")).strip()]
        seen = set()
        codes = [c for c in codes if not (c in seen or seen.add(c))]
        priority = str(b.get("priority") or "ปกติ").strip() or "ปกติ"
        if priority not in ("ปกติ", "ด่วน", "ด่วนมาก"):
            priority = "ปกติ"
        detail = str(b.get("detail") or "").strip() or None
        pattern = str(b.get("pattern_code") or "").strip() or None
        job_name = str(b.get("job_name") or "").strip() or None
        order_date = str(b.get("order_date") or "").strip() or today()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", order_date):
            return self.send(400, {"error": "รูปแบบวันที่สั่งไม่ถูกต้อง"})
        due_date = str(b.get("due_date") or "").strip() or None
        if due_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
            return self.send(400, {"error": "รูปแบบกำหนดเสร็จไม่ถูกต้อง"})
        requester = str(b.get("requester") or "").strip() or user["username"]
        department = str(b.get("department") or "").strip() or "กระป๋อง 2 ชิ้น"
        remark = str(b.get("remark") or "").strip() or None
        try:
            qty = int(str(b.get("qty") or "").strip() or 0)
        except ValueError:
            return self.send(400, {"error": "จำนวนต้องเป็นตัวเลข"})
        if qty <= 0:
            qty = len(codes) if codes else 1
        unit = str(b.get("unit") or "").strip() or "ตัว"
        if job_type == "repair" and not codes:
            return self.send(400, {"error": "งานซ่อมกรุณาเลือกแม่พิมพ์อย่างน้อย 1 ตัว"})
        con = wf_connect(self.server.db_path)
        prev_of = {}
        for code in codes:
            lv = con.execute("SELECT status,machine FROM mold_live WHERE code=?", (code,)).fetchone()
            if not lv:
                con.close()
                return self.send(400, {"error": f"ไม่พบรหัส {code}"})
            if job_type == "repair" and lv["status"] not in ("spare", "installed"):
                con.close()
                return self.send(400, {"error": f"{code} ส่งซ่อมไม่ได้ (สถานะปัจจุบัน: {lv['status']})"})
            prev_of[code] = (lv["status"], lv["machine"])
        sheet = size = tooling = size_ref = None
        if codes:
            groups = mold_groups(self.server.app_db, codes)
            unknown = [c for c in codes if c not in groups or not groups[c][0] or not groups[c][1]]
            if unknown:
                con.close()
                return self.send(400, {"error": f"ผูก SIZE ไม่ได้: {', '.join(unknown)}"})
            keys = {(groups[c][0], groups[c][1]) for c in codes}
            if len(keys) > 1:
                con.close()
                return self.send(400, {"error": "ใบเดียวใส่ได้เฉพาะชนิด+SIZE เดียวกัน (แยกใบตาม SIZE): "
                                       + ", ".join(f"{s}/{z}" for s, z in sorted(keys))})
            sheet, size = next(iter(keys))
            tooling = next((groups[c][3] for c in codes if groups[c][3]), sheet)
            size_ref = build_size_ref(groups, codes)
        if not job_name:
            job_name = tooling or "งานซ่อม"
        if "machine" in b:
            # ส่ง key มา = ค่าที่ผู้ใช้ตั้งใจ (ค่าว่าง = ปล่อยว่างจริง)
            machine = str(b.get("machine") or "").strip() or None
        else:
            # ไม่ส่งมา = ใช้เครื่องของตัวที่คาอยู่ (ถ้ามี)
            machine = next((prev_of[c][1] for c in codes if prev_of.get(c, (None, None))[1]), None)
        ts = now_iso()
        box: dict = {}
        def _work():
            p4r = next_p4r_no(con, self.server.app_db)
            con.execute("INSERT INTO docs(doc_type,doc_no,doc_date,actor,machine,note,priority,pattern_code,"
                        "job_type,due_date,requester,department,remark,qty,unit,created_at)"
                        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        ("P4R", p4r, order_date, user["username"], machine, detail, priority, pattern,
                         job_type, due_date, requester, department, remark, str(qty), unit, ts))
            doc_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
            for code in codes:
                if job_type == "repair":
                    prev, mc = prev_of[code]
                    con.execute("INSERT INTO doc_items(doc_id,mold_code,role,prev_status,new_status)"
                                " VALUES(?,?,?,?,'repair')", (doc_id, code, "repair", prev))
                    con.execute("UPDATE mold_live SET status='repair',updated_at=?,updated_by=?"
                                " WHERE code=?", (ts, user["username"], code))
                    con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                                " VALUES(?,?,?,?,?,?,?)",
                                (code, p4r, prev, "repair", mc, user["username"], ts))
                else:
                    con.execute("INSERT INTO doc_items(doc_id,mold_code,role,prev_status,new_status)"
                                " VALUES(?,?,?,'new',NULL,NULL)", (doc_id, code, "new"))
            box["p4r"] = p4r
        _, err = txn_retry(con, _work)
        if err:
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {err}"})
        p4r = box["p4r"]
        con.close()
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            if job_type == "repair":
                for code in codes:
                    app.execute("UPDATE molds SET status='repair' WHERE code=?", (code,))
            app.execute("INSERT OR IGNORE INTO repair_orders(source_no,job_name,status,ordered_date,created_at)"
                        " VALUES(?,?,?,?,?)",
                        (p4r, job_name, "open", order_date, ts))
            app.commit()
            app.close()
        except Exception:  # noqa: BLE001
            pass
        return self.send(200, {"repair_no": p4r, "codes": codes, "code": codes[0] if codes else "",
                               "sheet": sheet, "size": size, "size_ref": size_ref,
                               "pattern_code": pattern, "job_type": job_type,
                               "prev_status": prev_of[codes[0]][0] if codes and job_type == "repair" else None,
                               "priority": priority})

    def r_repair_receive(self, user):
        """รับกลับจากซ่อม + ตรวจวัดรายตัว:
        - inspections: [{mold_code, dims:{มิติ:ค่า}, verdict:'pass'|'fail'}]
        - pass -> spare + อัปเดต dims ล่าสุด; fail -> retired (ของเสีย)
        - ตรวจไม่ครบทุกตัวที่ค้างซ่อม -> 400; ปิดใบเสมอ"""
        if user["role"] not in ALLOW_ROLES_MASTER:
            return self.send(403, {"error": "ต้องเป็นเจ้าหน้าที่ Store หรือ Admin"})
        b = self.body()
        sno = str(b.get("source_no") or "").strip()
        extra = [str(c).strip() for c in (b.get("mold_codes") or []) if str(c).strip()]
        if not sno:
            return self.send(400, {"error": "กรุณาระบุเลขที่ใบซ่อม"})
        con = wf_connect(self.server.db_path)
        doc = con.execute("SELECT id FROM docs WHERE doc_type='P4R' AND doc_no=? AND voided=0",
                          (sno,)).fetchone()
        linked = []
        job_type = "repair"
        if doc:
            jtype = con.execute("SELECT job_type FROM docs WHERE id=?", (doc["id"],)).fetchone()
            if jtype and jtype["job_type"]:
                job_type = jtype["job_type"]
            linked = [r[0] for r in con.execute(
                "SELECT mold_code FROM doc_items WHERE doc_id=?", (doc["id"],))]
        if job_type == "new":
            # งานสร้างใหม่: ไม่แตะสถานะแม่พิมพ์ ปิดเฉพาะเอกสาร
            con.close()
            try:
                app = sqlite3.connect(self.server.app_db, timeout=30.0)
                app.execute("UPDATE repair_orders SET status='received' WHERE source_no=?", (sno,))
                app.commit()
                app.close()
            except Exception:  # noqa: BLE001
                pass
            return self.send(200, {"source_no": sno, "received_codes": []})
        targets = linked or extra
        live_status = {}
        for cd in targets:
            r = con.execute("SELECT status FROM mold_live WHERE code=?", (cd,)).fetchone()
            if r:
                live_status[cd] = r["status"]
        insp = b.get("inspections") or []
        ts = now_iso()
        if insp:
            if not isinstance(insp, list):
                con.close()
                return self.send(400, {"error": "รูปแบบข้อมูลตรวจวัดไม่ถูกต้อง"})
            seen = set()
            cleaned = []
            for it in insp:
                if not isinstance(it, dict):
                    con.close()
                    return self.send(400, {"error": "รูปแบบข้อมูลตรวจวัดไม่ถูกต้อง"})
                cd = str(it.get("mold_code") or "").strip()
                v = str(it.get("verdict") or "").strip()
                dims = it.get("dims") or {}
                if not cd or cd in seen:
                    con.close()
                    return self.send(400, {"error": f"รหัสซ้ำหรือไม่ระบุ: {cd or '?'}"})
                if cd not in targets:
                    con.close()
                    return self.send(400, {"error": f"{cd} ไม่ได้ผูกกับใบ {sno}"})
                if live_status.get(cd) != "repair":
                    con.close()
                    return self.send(400, {"error": f"{cd} ไม่ได้ค้างซ่อมแล้ว"})
                if v not in ("pass", "fail"):
                    con.close()
                    return self.send(400, {"error": f"{cd} ยังไม่ตัดสินผ่าน/ไม่ผ่าน"})
                if not isinstance(dims, dict):
                    con.close()
                    return self.send(400, {"error": f"{cd} ค่าวัดไม่ถูกต้อง"})
                seen.add(cd)
                cleaned.append({"code": cd, "verdict": v, "dims": dims})
            missing = [cd for cd in targets if live_status.get(cd) == "repair" and cd not in seen]
            if missing:
                con.close()
                return self.send(400, {"error": f"ยังมีตัวที่ไม่ได้ตรวจรับ: {', '.join(missing)}"})
            passed, failed = [], []
            try:
                for it in cleaned:
                    cd, v = it["code"], it["verdict"]
                    con.execute("INSERT INTO inspections(doc_no,mold_code,measured,verdict,inspector,at)"
                                " VALUES(?,?,?,?,?,?)",
                                (sno, cd, json.dumps(it["dims"], ensure_ascii=False),
                                 v, user["username"], ts))
                    to_st = "spare" if v == "pass" else "retired"
                    con.execute("UPDATE mold_live SET status=?,machine=NULL,updated_at=?,updated_by=?"
                                " WHERE code=?", (to_st, ts, user["username"], cd))
                    con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                                " VALUES(?,?,'repair',?,NULL,?,?)",
                                (cd, sno, to_st, user["username"], ts))
                    (passed if v == "pass" else failed).append(cd)
                con.commit()
            except Exception as e:  # noqa: BLE001
                con.rollback()
                con.close()
                return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {e}"})
            con.close()
            try:
                app = sqlite3.connect(self.server.app_db, timeout=30.0)
                for cd in passed + failed:
                    st = "spare" if cd in passed else "retired"
                    app.execute("UPDATE molds SET status=?,machine=NULL WHERE code=?", (st, cd))
                app.execute("UPDATE repair_orders SET status='received' WHERE source_no=?", (sno,))
                app.commit()
                app.close()
            except Exception:  # noqa: BLE001
                pass
            return self.send(200, {"source_no": sno, "received_codes": passed,
                                   "retired_codes": failed})
        valid = [cd for cd in targets if live_status.get(cd) == "repair"]
        # ปิดใบเสมอ (กันใบค้างตัน): ขยับเฉพาะตัวที่ยังค้างซ่อมจริง ตัวอื่น/งานนอกทะเบียน = ปิดเอกสารอย่างเดียว
        try:
            for cd in valid:
                con.execute("UPDATE mold_live SET status='spare',machine=NULL,updated_at=?,updated_by=?"
                            " WHERE code=?", (ts, user["username"], cd))
                con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                            " VALUES(?,?,'repair','spare',NULL,?,?)",
                            (cd, sno, user["username"], ts))
            con.commit()
        except Exception as e:  # noqa: BLE001
            con.rollback()
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {e}"})
        con.close()
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            for cd in valid:
                app.execute("UPDATE molds SET status='spare',machine=NULL WHERE code=?", (cd,))
            app.execute("UPDATE repair_orders SET status='received' WHERE source_no=?", (sno,))
            app.commit()
            app.close()
        except Exception:  # noqa: BLE001
            pass
        return self.send(200, {"source_no": sno, "received_codes": valid})

    def r_repair_reconcile(self, user):
        """ปรับสต็อกให้ตรงใบซ่อมเก่า: ส่งแม่พิมพ์ที่ผูกกับใบนี้ (แต่ไม่ได้ค้างซ่อม)
        เข้าสถานะซ่อม เพื่อให้รับกลับ+ตรวจวัดได้ตามปกติ
        - ใช้เคลียร์ข้อมูลเก่าที่ใบกับสต็อกไม่ตรงกันเท่านั้น (store/admin)
        - ห้ามปลุกตัวที่ปลดระวางแล้ว; ใบต้องค้างอยู่"""
        if user["role"] not in ALLOW_ROLES_MASTER:
            return self.send(403, {"error": "ต้องเป็นเจ้าหน้าที่ Store หรือ Admin"})
        b = self.body()
        sno = str(b.get("source_no") or "").strip()
        codes = [str(c).strip() for c in (b.get("mold_codes") or []) if str(c).strip()]
        if not sno:
            return self.send(400, {"error": "กรุณาระบุเลขที่ใบซ่อม"})
        if not codes:
            return self.send(400, {"error": "กรุณาเลือกแม่พิมพ์"})
        try:
            app = sqlite3.connect(f"file:{self.server.app_db}?mode=ro", uri=True)
            prow = app.execute("SELECT status FROM repair_orders WHERE source_no=?", (sno,)).fetchone()
            app.close()
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": f"อ่านใบซ่อมไม่ได้: {e}"})
        if not prow:
            return self.send(404, {"error": f"ไม่พบใบ {sno}"})
        if prow[0] != "open":
            return self.send(400, {"error": f"ใบ {sno} ปิดแล้ว"})
        con = wf_connect(self.server.db_path)
        ts = now_iso()
        repaired = []
        try:
            for cd in codes:
                r = con.execute("SELECT status,machine FROM mold_live WHERE code=?", (cd,)).fetchone()
                if not r:
                    con.close()
                    return self.send(400, {"error": f"ไม่พบรหัส {cd} ในทะเบียน"})
                if r["status"] == "retired":
                    con.close()
                    return self.send(400, {"error": f"{cd} ถูกปลดระวางแล้ว ไม่สามารถส่งซ่อมได้"})
                if r["status"] == "repair":
                    continue
                old, mc = r["status"], r["machine"]
                con.execute("UPDATE mold_live SET status='repair',updated_at=?,updated_by=? WHERE code=?",
                            (ts, user["username"], cd))
                con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                            " VALUES(?,?,?,?,?,?,?)",
                            (cd, sno, old, "repair", mc, user["username"], ts))
                repaired.append({"code": cd, "from": old, "machine": mc})
            con.commit()
        except Exception as e:  # noqa: BLE001
            con.rollback()
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {e}"})
        con.close()
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            for it in repaired:
                app.execute("UPDATE molds SET status='repair',machine=? WHERE code=?",
                            (it["machine"], it["code"]))
            app.commit()
            app.close()
        except Exception:  # noqa: BLE001
            pass
        return self.send(200, {"source_no": sno, "repaired": repaired})

    def r_repair_update(self, user, sno):
        """แก้ไขใบซ่อม (เฉพาะข้อมูลเอกสาร ไม่แตะตัวแม่พิมพ์/สถานะ): store/admin"""
        if user["role"] not in ALLOW_ROLES_MASTER:
            return self.send(403, {"error": "ต้องเป็นเจ้าหน้าที่ Store หรือ Admin"})
        b = self.body()
        sets, args = [], []
        def put(col, val):
            sets.append(f"{col}=?")
            args.append(val)
        if "priority" in b:
            p = str(b.get("priority") or "").strip()
            if p not in ("ปกติ", "ด่วน", "ด่วนมาก"):
                return self.send(400, {"error": "ระดับความเร่งด่วนไม่ถูกต้อง"})
            put("priority", p)
        if "detail" in b:
            put("note", str(b.get("detail") or "").strip() or None)
        if "pattern_code" in b:
            put("pattern_code", str(b.get("pattern_code") or "").strip() or None)
        if "requester" in b:
            put("requester", str(b.get("requester") or "").strip() or None)
        if "machine" in b:
            put("machine", str(b.get("machine") or "").strip() or None)
        if "department" in b:
            put("department", str(b.get("department") or "").strip() or None)
        if "remark" in b:
            put("remark", str(b.get("remark") or "").strip() or None)
        if "due_date" in b:
            dd = str(b.get("due_date") or "").strip() or None
            if dd and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dd):
                return self.send(400, {"error": "รูปแบบกำหนดเสร็จไม่ถูกต้อง"})
            put("due_date", dd)
        if "ordered_date" in b:
            od = str(b.get("ordered_date") or "").strip() or None
            if od and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", od):
                return self.send(400, {"error": "รูปแบบวันที่สั่งไม่ถูกต้อง"})
            put("doc_date", od)
        if "qty" in b:
            try:
                qv = int(str(b.get("qty") or "").strip() or 0)
            except ValueError:
                return self.send(400, {"error": "จำนวนต้องเป็นตัวเลข"})
            put("qty", str(qv if qv > 0 else 1))
        if "unit" in b:
            put("unit", str(b.get("unit") or "").strip() or "ตัว")
        if "job_name" in b:
            job = str(b.get("job_name") or "").strip() or None
        else:
            job = None
        if not sets and job is None:
            return self.send(400, {"error": "ไม่มีข้อมูลให้แก้ไข"})
        con = wf_connect(self.server.db_path)
        doc = con.execute("SELECT id FROM docs WHERE doc_type='P4R' AND doc_no=? AND voided=0",
                          (sno,)).fetchone()
        try:
            if doc and sets:
                con.execute(f"UPDATE docs SET {', '.join(sets)} WHERE id=?", (*args, doc["id"]))
            # เก็บค่าที่แก้ลง meta (durable ข้าม import) — รวมใบเก่าที่ไม่มี wf doc ด้วย
            meta_vals = {}
            keymap = {"detail": "note", "pattern_code": "pattern_code", "requester": "requester",
                      "machine": "machine", "department": "department", "remark": "remark",
                      "due_date": "due_date", "ordered_date": "doc_date", "qty": "qty",
                      "unit": "unit", "priority": "priority"}
            for jk, dk in keymap.items():
                if jk in b:
                    meta_vals[jk] = str(b.get(jk) or "").strip() or None
            if "job_name" in b:
                meta_vals["job_name"] = str(b.get("job_name") or "").strip() or None
            if meta_vals:
                meta_upsert(con, sno, meta_vals)
            con.commit()
        except Exception as e:  # noqa: BLE001
            con.rollback()
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {e}"})
        con.close()
        # patch repairs.json ให้ UI เห็นทันที (ไม่ต้องรอ import)
        patch_vals = {}
        for jk, dk in keymap.items():
            if jk in b:
                patch_vals[dk] = str(b.get(jk) or "").strip() or None
        if "job_name" in b:
            patch_vals["job_name"] = str(b.get("job_name") or "").strip() or None
        if patch_vals:
            patch_repairs_json(sno, patch_vals)
        # mirror ชื่อเรื่อง + วันที่สั่ง ไป repair_orders
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            row = app.execute("SELECT job_name,ordered_date FROM repair_orders WHERE source_no=?",
                              (sno,)).fetchone()
            if not row:
                app.close()
                return self.send(404, {"error": f"ไม่พบใบ {sno}"})
            if job is not None:
                app.execute("UPDATE repair_orders SET job_name=? WHERE source_no=?", (job, sno))
            if "ordered_date" in b:
                od2 = str(b.get("ordered_date") or "").strip() or row[1]
                app.execute("UPDATE repair_orders SET ordered_date=? WHERE source_no=?", (od2, sno))
            app.commit()
            app.close()
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {e}"})
        return self.send(200, {"source_no": sno, "updated": True})

    def r_repair_delete(self, user, sno):
        """ลบใบซ่อมทั้งใบ (admin): ลบเอกสาร+ประวัติในใบนั้น, ย้อนแม่พิมพ์ที่ค้างซ่อมเพราะใบนี้กลับสถานะเดิม"""
        if user["role"] != "admin":
            return self.send(403, {"error": "เฉพาะ Admin เท่านั้นที่ลบใบซ่อมได้"})
        b = self.body() or {}
        extra = [str(c).strip() for c in (b.get("mold_codes") or []) if str(c).strip()]
        con = wf_connect(self.server.db_path)
        doc = con.execute("SELECT id FROM docs WHERE doc_type='P4R' AND doc_no=? AND voided=0",
                          (sno,)).fetchone()
        revert = {}  # code -> status ที่จะย้อนกลับ
        if doc:
            for r in con.execute("SELECT mold_code,prev_status FROM doc_items WHERE doc_id=?",
                                 (doc["id"],)):
                if r["mold_code"] not in revert:
                    revert[r["mold_code"]] = r["prev_status"] or "spare"
        for cd in extra:
            revert.setdefault(cd, "spare")
        ts = now_iso()
        reverted = []
        try:
            for cd, back in revert.items():
                cur = con.execute("SELECT status FROM mold_live WHERE code=?", (cd,)).fetchone()
                if cur and cur["status"] == "repair":
                    con.execute("UPDATE mold_live SET status=?,updated_at=?,updated_by=? WHERE code=?",
                                (back, ts, user["username"], cd))
                    con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                                " VALUES(?,?,'repair',?,NULL,?,?)",
                                (cd, f"{sno}-VOID", back, user["username"], ts))
                    reverted.append({"code": cd, "to": back})
            if doc:
                con.execute("DELETE FROM doc_items WHERE doc_id=?", (doc["id"],))
                con.execute("DELETE FROM docs WHERE id=?", (doc["id"],))
            con.execute("DELETE FROM movements WHERE doc_no=?", (sno,))
            # tombstone: กัน import รอบหน้างอกใบนี้กลับมา
            meta_upsert(con, sno, {}, deleted=1)
            con.commit()
        except Exception as e:  # noqa: BLE001
            con.rollback()
            con.close()
            return self.send(500, {"error": f"ลบไม่สำเร็จ: {e}"})
        con.close()
        try:
            app = sqlite3.connect(self.server.app_db, timeout=30.0)
            con2 = wf_connect(self.server.db_path)
            try:
                for r in reverted:
                    mrow = con2.execute("SELECT machine FROM mold_live WHERE code=?",
                                        (r["code"],)).fetchone()
                    app.execute("UPDATE molds SET status=?,machine=? WHERE code=?",
                                (r["to"], mrow["machine"] if mrow else None, r["code"]))
            finally:
                con2.close()
            app.execute("DELETE FROM repair_orders WHERE source_no=?", (sno,))
            app.commit()
            app.close()
        except Exception:  # noqa: BLE001
            pass
        return self.send(200, {"source_no": sno, "deleted": True, "reverted": reverted})

    def r_swap(self, user):
        if user["role"] not in ALLOW_ROLES_SWAP:
            return self.send(403, {"error": "ไม่มีสิทธิ์เบิก-สลับ"})
        b = self.body()
        machine = str(b.get("machine") or "").strip().upper()
        out_code = (str(b.get("out_code") or "").strip() or None)
        in_code = str(b.get("in_code") or "").strip()
        note = str(b.get("note") or "").strip() or None
        if not machine or not in_code:
            return self.send(400, {"error": "กรุณาระบุเครื่องและแม่พิมพ์ตัวเข้า"})
        if out_code == in_code:
            return self.send(400, {"error": "ตัวออกกับตัวเข้าต้องเป็นคนละตัว"})
        con = wf_connect(self.server.db_path)
        if not con.execute("SELECT 1 FROM machines WHERE code=?", (machine,)).fetchone():
            con.close()
            return self.send(400, {"error": f"ไม่มีเครื่อง {machine} ในมาสเตอร์ — เพิ่มเครื่องก่อน"})
        live_in = con.execute("SELECT status,machine FROM mold_live WHERE code=?",
                              (in_code,)).fetchone()
        if not live_in:
            con.close()
            return self.send(400, {"error": f"ไม่พบรหัส {in_code}"})
        if live_in["status"] != "spare":
            con.close()
            return self.send(400, {"error": f"{in_code} ไม่ใช่สแปร์ (สถานะปัจจุบัน: {live_in['status']})"})
        live_out = None
        if out_code:
            live_out = con.execute("SELECT status,machine FROM mold_live WHERE code=?",
                                   (out_code,)).fetchone()
            if not live_out:
                con.close()
                return self.send(400, {"error": f"ไม่พบรหัส {out_code}"})
            if live_out["status"] != "installed" or (live_out["machine"] or "").upper() != machine:
                con.close()
                return self.send(400, {"error": f"{out_code} ไม่ได้คาอยู่บนเครื่อง {machine}"})
        ts, od = now_iso(), today()
        box2: dict = {}
        def _work2():
            issue_no = next_issue_no(con)
            con.execute("INSERT INTO docs(doc_type,doc_no,doc_date,actor,machine,note,created_at)"
                        " VALUES(?,?,?,?,?,?,?)",
                        ("ISS", issue_no, od, user["username"], machine, note, ts))
            doc_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
            con.execute("INSERT INTO doc_items(doc_id,mold_code,role,prev_status,new_status)"
                        " VALUES(?,?,?,'spare','installed')", (doc_id, in_code, "in"))
            con.execute("UPDATE mold_live SET status='installed',machine=?,updated_at=?,updated_by=?"
                        " WHERE code=?", (machine, ts, user["username"], in_code))
            con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                        " VALUES(?,?,'spare','installed',?,?,?)",
                        (in_code, issue_no, machine, user["username"], ts))
            box2["issue_no"] = issue_no
            repair_no = None
            if out_code:
                repair_no = next_p4r_no(con, self.server.app_db)
                con.execute("INSERT INTO docs(doc_type,doc_no,doc_date,actor,machine,note,ref_doc,created_at)"
                            " VALUES(?,?,?,?,?,?,?,?)",
                            ("P4R", repair_no, od, user["username"], machine,
                             "ออกอัตโนมัติจากการสลับคืน", issue_no, ts))
                r_id = con.execute("SELECT last_insert_rowid()").fetchone()[0]
                con.execute("INSERT INTO doc_items(doc_id,mold_code,role,prev_status,new_status)"
                            " VALUES(?,?,?,'installed','repair')", (r_id, out_code, "out"))
                con.execute("UPDATE mold_live SET status='repair',machine=?,updated_at=?,updated_by=?"
                            " WHERE code=?", (machine, ts, user["username"], out_code))
                con.execute("INSERT INTO movements(mold_code,doc_no,from_status,to_status,machine,actor,at)"
                            " VALUES(?,?,'installed','repair',?,?,?)",
                            (out_code, repair_no, machine, user["username"], ts))
            box2["repair_no"] = repair_no
        _, err2 = txn_retry(con, _work2)
        if err2:
            con.close()
            return self.send(500, {"error": f"บันทึกไม่สำเร็จ: {err2}"})
        issue_no, repair_no = box2["issue_no"], box2["repair_no"]
        con.close()
        # mirror ไป app.db เพื่อให้ dashboard เห็น (best-effort)
        mirrored = True
        try:
            changes = [("installed", machine, in_code)]
            new_repair = None
            if out_code and repair_no:
                changes.append(("repair", machine, out_code))
                app = sqlite3.connect(self.server.app_db, timeout=30.0)
                job = app.execute("SELECT tooling_type FROM molds WHERE code=?",
                                  (out_code,)).fetchone()
                app.close()
                new_repair = (repair_no, (job[0] if job else out_code), od)
            mirror_statuses(self.server.app_db, changes, new_repair)
        except Exception:  # noqa: BLE001
            mirrored = False
        return self.send(200, {"issue_no": issue_no, "repair_no": repair_no,
                               "in_code": in_code, "out_code": out_code,
                               "machine": machine, "mirrored": mirrored})

    def r_summary(self):
        con = wf_connect(self.server.db_path)
        by_status = {r["status"]: r["c"] for r in con.execute(
            "SELECT status,COUNT(*) c FROM mold_live GROUP BY status")}
        n_mac = con.execute("SELECT COUNT(*) c FROM machines").fetchone()["c"]
        today0 = today()
        issues = con.execute("SELECT COUNT(*) c FROM docs WHERE doc_type='ISS' AND doc_date=?",
                             (today0,)).fetchone()["c"]
        con.close()
        try:
            app = sqlite3.connect(f"file:{self.server.app_db}?mode=ro", uri=True)
            open_r = app.execute("SELECT COUNT(*) FROM repair_orders WHERE status='open'").fetchone()[0]
            app.close()
        except Exception:  # noqa: BLE001
            open_r = None
        return self.send(200, {"live_by_status": by_status, "machines": n_mac,
                               "issues_today": issues, "repairs_open": open_r, "at": now_iso()})

    def r_integrity(self):
        """ตรวจความสัมพันธ์ข้อมูลแบบ live (สำหรับแผงความถูกต้องในหน้า Reports)"""
        out: dict = {"ok": True, "checks": {}, "examples": {}}
        con = wf_connect(self.server.db_path)
        live = {r["code"]: dict(r) for r in con.execute("SELECT code,status,machine FROM mold_live")}
        items = [dict(r) for r in con.execute("SELECT mold_code,prev_status FROM doc_items")]
        mv = [dict(r) for r in con.execute(
            "SELECT id,mold_code,from_status,to_status FROM movements ORDER BY id")]
        con.close()
        try:
            app = sqlite3.connect(f"file:{self.server.app_db}?mode=ro", uri=True)
            app.row_factory = sqlite3.Row
            molds = {r["code"]: dict(r) for r in app.execute("SELECT code,status,machine FROM molds")}
            papers = {r["source_no"]: dict(r) for r in
                      app.execute("SELECT source_no,status FROM repair_orders")}
            app.close()
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": f"อ่าน app.db ไม่ได้: {e}"})
        try:
            with open(os.path.join(ROOT, "web", "public", "data", "repairs.json"),
                      encoding="utf-8") as fh:
                hist = {r["source_no"]: r for r in json.load(fh)}
        except (ValueError, OSError):
            hist = {}

        def ex(key, items, n=10):
            items = list(items)[:n]
            if items:
                out["examples"][key] = items

        c = out["checks"]
        # 1. รหัสต้องตรงกัน 3 ที่
        c["codes_json_app_live"] = {
            "app_not_live": sorted(set(molds) - set(live)),
            "live_not_app": sorted(set(live) - set(molds)),
        }
        # 2. สถานะต้องตรงกัน (live เป็นหลัก)
        mm = [{"code": k, "app": molds[k]["status"], "live": live[k]["status"]}
              for k in set(molds) & set(live) if molds[k]["status"] != live[k]["status"]]
        c["status_mismatch_n"] = len(mm)
        ex("status_mismatch", mm)
        # 3. ใบ open ต้องมีใน app ตรงกับ live
        c["open_papers"] = sum(1 for v in papers.values() if v["status"] == "open")
        # 4. ตัว repair ต้องมีใบ open ผูก (จาก JSON link)
        linked_open = set()
        for no, v in papers.items():
            if v["status"] == "open" and no in hist:
                linked_open.update(hist[no].get("link", {}).get("linked_codes", []) or [])
        inrepair = {k for k, v in live.items() if v["status"] == "repair"}
        no_paper = sorted(inrepair - linked_open)
        c["repair_no_open_paper_n"] = len(no_paper)
        ex("repair_no_open_paper", no_paper)
        not_repair = sorted(linked_open - inrepair)
        c["open_linked_not_repair_n"] = len(not_repair)
        ex("open_linked_not_repair", not_repair)
        # 5. installed ต้องมีเครื่อง
        no_mac = sorted(k for k, v in live.items() if v["status"] == "installed" and not v["machine"])
        c["installed_without_machine_n"] = len(no_mac)
        ex("installed_without_machine", no_mac)
        # 6. doc_items ต้องอ้างรหัสที่มีจริง
        badref = sorted({d["mold_code"] for d in items if d["mold_code"] not in live})
        c["docitems_badref_n"] = len(badref)
        ex("docitems_badref", badref)
        # 7. โซ่ movements ต้องต่อเนื่อง + ปลายโซ่ต้องตรง live
        bycode: dict = {}
        for m in mv:
            bycode.setdefault(m["mold_code"], []).append(m)
        brk = []
        lastmm = []
        for code, ms in bycode.items():
            # VOID marker เป็นเหตุการณ์ย้อนสถานะอิสระ ไม่นับต่อโซ่ (กัน false positive)
            chain = [m for m in ms if not str(m["doc_no"] or "").endswith("-VOID")]
            for a, b in zip(chain, chain[1:]):
                if a["to_status"] != b["from_status"]:
                    brk.append({"code": code, "m1": a["id"], "m2": b["id"]})
                    break
            if code in live and ms[-1]["to_status"] != live[code]["status"]:
                lastmm.append({"code": code, "last": ms[-1]["to_status"], "live": live[code]["status"]})
        c["chain_break_n"] = len(brk)
        ex("chain_break", brk)
        c["lastmv_live_mismatch_n"] = len(lastmm)
        ex("lastmv_live_mismatch", lastmm)
        # 8. movements อ้างรหัสที่หายไป
        orph = sorted({m["mold_code"] for m in mv if m["mold_code"] not in live})
        c["movements_orphan_n"] = len(orph)
        ex("movements_orphan", orph)
        fails = ["status_mismatch_n", "docitems_badref_n", "chain_break_n",
                 "lastmv_live_mismatch_n", "movements_orphan_n"]
        out["ok"] = all(c.get(k, 0) == 0 for k in fails) and not c["codes_json_app_live"]["app_not_live"] \
            and not c["codes_json_app_live"]["live_not_app"]
        return self.send(200, out)

    def r_sync(self, user):
        if user["role"] != "admin":
            return self.send(403, {"error": "เฉพาะ Admin"})
        con = wf_connect(self.server.db_path)
        rows = con.execute("SELECT code,status,machine FROM mold_live").fetchall()
        con.close()
        mirror_statuses(self.server.app_db, [(r["status"], r["machine"], r["code"]) for r in rows])
        return self.send(200, {"mirrored": len(rows)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "wf.db"))
    ap.add_argument("--app-db", default=os.path.join(ROOT, "data", "app.db"))
    ap.add_argument("--seed-data", default=os.path.join(ROOT, "web", "public", "data", "molds.json"))
    ap.add_argument("--seed", action="store_true")
    args = ap.parse_args()
    init_db(args.db)
    if args.seed:
        seed(args.db, args.app_db, args.seed_data)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.db_path, srv.app_db = args.db, args.app_db
    print(f"mold workflow api on 127.0.0.1:{args.port} (db={args.db})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
