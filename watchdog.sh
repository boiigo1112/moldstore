#!/bin/bash
# Watchdog: ตรวจว่า MoldStore (sidecar :8081 + web :5173) ยังรันอยู่ไหม
# ถ้าดับ -> พยายาม restart ผ่าน systemd ก่อน, ถ้าไม่มี units (เช่น VM โดนรีเซ็ต) -> รัน start-dev.sh
ok=true
curl -s --max-time 8 -o /dev/null http://127.0.0.1:8081/wf/health || ok=false
curl -s --max-time 8 -o /dev/null http://localhost:5173/ || ok=false
if [ "$ok" = true ]; then exit 0; fi
echo "$(date '+%F %T') watchdog: service down, restarting" >> ~/workspace/store-project/logs/watchdog.log
if [ -f /etc/systemd/system/moldstore-wf.service ]; then
  sudo -n systemctl restart moldstore-wf.service moldstore-web.service 2>/dev/null || bash ~/workspace/store-project/start-dev.sh >> ~/workspace/store-project/logs/watchdog.log 2>&1
else
  bash ~/workspace/store-project/start-dev.sh >> ~/workspace/store-project/logs/watchdog.log 2>&1
fi
