#!/bin/bash
# สตาร์ท MoldStore dev servers (รันครั้งเดียว เปิด 2 terminal ก็ได้)
# หน้าเว็บ: http://localhost:5173  |  sidecar API: http://127.0.0.1:8081
set -e
PROJ="$HOME/workspace/store-project"
mkdir -p "$PROJ/dev-data" "$PROJ/logs"

# ใช้สำเนา DB สำหรับ dev (กันข้อมูลตัวจริงเพี้ยน) — copy ครั้งแรกเท่านั้น
[ -f "$PROJ/dev-data/app.db" ] || cp "$PROJ/src/data/app.db" "$PROJ/dev-data/app.db"
[ -f "$PROJ/dev-data/wf.db" ] || cp "$PROJ/src/data/wf.db" "$PROJ/dev-data/wf.db"

# 1) workflow sidecar :8081 (ใช้ venv ในโปรเจกต์ จะได้ไม่หายตอน VM รีเซ็ต)
if [ ! -x "$PROJ/.venv/bin/python" ]; then
  python3 -m venv "$PROJ/.venv" && "$PROJ/.venv/bin/pip" install --quiet bcrypt
fi
( cd "$PROJ/src" && nohup "$PROJ/.venv/bin/python" wf/server.py --port 8081 \
    --db "$PROJ/dev-data/wf.db" --app-db "$PROJ/dev-data/app.db" \
    > "$PROJ/logs/wf.log" 2>&1 & )
echo "sidecar started (log: $PROJ/logs/wf.log)"

# 2) vite dev :5173
( cd "$PROJ/src/web" && nohup npx vite --port 5173 --strictPort \
    > "$PROJ/logs/vite.log" 2>&1 & )
echo "vite started (log: $PROJ/logs/vite.log)"

sleep 6
curl -s -o /dev/null -w "sidecar :8081 -> %{http_code}\n" http://127.0.0.1:8081/wf/health
curl -s -o /dev/null -w "vite    :5173 -> %{http_code}\n" http://localhost:5173/
echo "เปิดเบราว์เซอร์: http://localhost:5173  (admin/admin123)"
