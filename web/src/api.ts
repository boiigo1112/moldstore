export interface AuthUser {
  id: number
  username: string
  display_name: string
  role: string
}

export interface TypeStat {
  tooling_type: string
  spare: number
  installed: number
  repair: number
}

export interface RepairRow {
  source_no: string
  job_name: string
  status: string
  ordered_date: string
}

export interface DashboardData {
  molds_total: number
  molds_by_status: Record<string, number>
  molds_by_type: TypeStat[]
  repairs_open: number
  repairs_total: number
  recent_repairs: RepairRow[]
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('moldstore_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function apiLogin(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  let res: Response
  try {
    res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กรุณาตรวจว่า API (port 8080) รันอยู่')
  }
  const data = await parseBody(res)
  if (!res.ok) {
    if (data && typeof data.error === 'string' && data.error) throw new Error(data.error)
    if (res.status === 500) throw new Error('เซิร์ฟเวอร์ขัดข้อง (500) — อาจลืมรัน moldstore-api.exe')
    throw new Error(`เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})`)
  }
  if (!data || !data.token) throw new Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง')
  return data
}

export async function apiMe(): Promise<AuthUser> {
  const res = await fetch('/api/me', { headers: authHeaders() })
  if (!res.ok) throw new Error('unauthorized')
  const data = await parseBody(res)
  if (!data) throw new Error('unauthorized')
  return data
}

export async function apiDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/dashboard', { headers: authHeaders() })
  if (!res.ok) throw new Error('โหลด dashboard ไม่สำเร็จ')
  const data = await parseBody(res)
  if (!data) throw new Error('โหลด dashboard ไม่สำเร็จ')
  return data
}
