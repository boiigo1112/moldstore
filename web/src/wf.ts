// Client สำหรับ workflow sidecar (port 8081 ผ่าน Vite proxy /wf)
import type { AuthUser } from './api'
const KEY = 'moldstore_wf_token'

function headers(): HeadersInit {
  const t = localStorage.getItem(KEY)
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new Error('เชื่อมต่อ workflow API ไม่ได้ — ตรวจว่า sidecar (port 8081) รันอยู่')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error((data && data.error) || `ผิดพลาด (HTTP ${res.status})`)
  return data as T
}

export const wfHasToken = () => !!localStorage.getItem(KEY)
export const wfClearToken = () => localStorage.removeItem(KEY)

export async function wfLogin(username: string, password: string) {
  const data = await req<{ token: string; user: unknown }>('/wf/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  localStorage.setItem(KEY, data.token)
  return data
}

export const wfMe = () =>
  req<{ user: AuthUser }>('/wf/me', { headers: headers() })

export interface LiveItem { code: string; status: string; machine: string | null; updated_at: string }

export const wfLive = () => req<{ at: string; items: LiveItem[] }>('/wf/live', { headers: headers() })
export const wfMachines = () =>
  req<{ machines: { code: string; active: number }[] }>('/wf/machines', { headers: headers() })
export const wfAddMachine = (code: string) =>
  req<{ machine: { code: string } }>('/wf/machines', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
export const wfOnMachine = (machine: string) =>
  req<{ machine: string; items: LiveItem[] }>(
    `/wf/on-machine?machine=${encodeURIComponent(machine)}`, { headers: headers() })
export const wfSwap = (body: { machine: string; out_code: string | null; in_code: string; note?: string }) =>
  req<{ issue_no: string; repair_no: string | null; in_code: string; out_code: string | null; machine: string; mirrored: boolean }>('/wf/swap', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export const wfSummary = () =>
  req<{ live_by_status: Record<string, number>; machines: number; issues_today: number; repairs_open: number | null; at: string }>('/wf/summary', { headers: headers() })
export interface RegisterBody {
  sheet: string; size: string; no: string
  dims: Record<string, string | number>; grade?: string | null; remark?: string | null
}
export const wfRegister = (body: RegisterBody) =>
  req<{ doc_no: string; code: string; entry: unknown }>('/wf/molds', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export interface WfRepair {
  source_no: string; job_name: string; status: string
  ordered_date: string | null; created_at: string
  received_date: string | null; receiver: string | null
}
export const wfRepairs = (status = 'all', q = '') =>
  req<{ repairs: WfRepair[]; total: number }>(
    `/wf/repairs?status=${status}&q=${encodeURIComponent(q)}`, { headers: headers() })
export const wfCreateRepair = (body: {
  mold_codes: string[]; priority: string; detail?: string | null; pattern_code?: string | null
  job_type?: string; job_name?: string | null; order_date?: string; due_date?: string | null
  requester?: string | null; machine?: string | null; department?: string | null
  remark?: string | null; qty?: number; unit?: string | null
}) =>
  req<{ repair_no: string; code: string; codes: string[]; sheet: string | null; size: string | null; size_ref: string | null; pattern_code: string | null; job_type: string; prev_status: string | null; priority: string }>('/wf/repairs', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export interface InspectionInput {
  mold_code: string
  dims: Record<string, string | number>
  verdict: 'pass' | 'fail'
}
export const wfReceiveRepair = (
  source_no: string,
  mold_codes: string[],
  inspections?: InspectionInput[],
) =>
  req<{ source_no: string; received_codes: string[]; retired_codes?: string[] }>('/wf/repairs/receive', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(inspections?.length ? { source_no, mold_codes, inspections } : { source_no, mold_codes }),
  })
export const wfReconcileRepair = (source_no: string, mold_codes: string[]) =>
  req<{ source_no: string; repaired: { code: string; from: string; machine: string | null }[] }>('/wf/repairs/reconcile', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_no, mold_codes }),
  })
export const wfDims = () =>
  req<{ dims: Record<string, Record<string, string | number>> }>('/wf/dims', { headers: headers() })
export const wfUpdateRepair = (source_no: string, body: Record<string, unknown>) =>
  req<{ source_no: string; updated: boolean }>(`/wf/repairs/${encodeURIComponent(source_no)}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export const wfDeleteRepair = (source_no: string, mold_codes: string[]) =>
  req<{ source_no: string; deleted: boolean; reverted: { code: string; to: string }[] }>(`/wf/repairs/${encodeURIComponent(source_no)}`, {
    method: 'DELETE',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mold_codes }),
  })
export interface WfDoc {
  id: number; doc_type: string; doc_no: string; doc_date: string; actor: string
  machine: string | null; note: string | null; priority: string | null; pattern_code: string | null; lines: string | null
  job_type: string | null; due_date: string | null; requester: string | null
  department: string | null; remark: string | null; qty: string | null; unit: string | null
}
export const wfDocs = (type: string, limit = 200) =>
  req<{ docs: WfDoc[] }>(`/wf/docs?type=${type}&limit=${limit}`, { headers: headers() })
export interface IntegrityData {
  ok: boolean
  checks: {
    codes_json_app_live?: { app_not_live: string[]; live_not_app: string[] }
    status_mismatch_n?: number
    open_papers?: number
    repair_no_open_paper_n?: number
    open_linked_not_repair_n?: number
    installed_without_machine_n?: number
    docitems_badref_n?: number
    chain_break_n?: number
    lastmv_live_mismatch_n?: number
    movements_orphan_n?: number
    [k: string]: unknown
  }
  examples: Record<string, unknown[]>
}
export const wfIntegrity = () =>
  req<IntegrityData>('/wf/integrity', { headers: headers() })
