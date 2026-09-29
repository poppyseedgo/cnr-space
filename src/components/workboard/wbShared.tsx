/**
 * wbShared.tsx — Work Space(WORKBOARD) 공용 토큰·판정·룩업
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P3-A] 신규 — 보드 미리보기 승인분(2026-09-29) 토큰 SSOT
 *
 * 이 파일이 SSOT 인 것
 *  · 상태/우선순위 카탈로그 (라벨·색) — DB CHECK 값과 id 정확히 일치
 *  · 업무영역 색 팔레트 (sort_order 인덱스 순환)
 *  · 마감 판정 dueInfo() — due_at(timestamptz) → KST 날짜 기준 D-day. 시각 성분은 판정에 쓰지 않는다
 *  · 마감 필터 프리셋 matchesDuePreset()
 *  · useUserLookup() — 사람 uuid → 표시 정보. users(재직) 우선, 없으면 departed_users 1회 지연 로드
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { AppUser, DepartedUser, WbTaskPriority, WbTaskStatus, WbRrule } from '../../types'
import { loadDepartedUsers } from '../../lib/api'
import { todayStr } from '../../utils/time'

export const WB = {
  font:      "'Pretendard', -apple-system, sans-serif",
  pageBg:    '#F6F6F6',
  colBg:     '#EEF0F3',
  cardBorder:'#E2E8F0',
  ink:       '#111111',
  body:      '#374151',
  muted:     '#6B7280',
  faint:     '#94A3B8',
  line:      '#F1F5F9',
  accent:    '#1E6FE8',
  accentBg:  '#EAF2FF',
  dueWarn:   '#DC2626',
  dueToday:  '#EA580C',
  pageMax:   1400,
  drawerW:   520,
} as const

// ─── 상태 ───────────────────────────────────────────────────────────────────
export const WB_STATUSES: { id: WbTaskStatus; label: string }[] = [
  { id: 'todo',  label: '할 일' },
  { id: 'doing', label: '진행 중' },
  { id: 'done',  label: '완료' },
  { id: 'hold',  label: '보류' },
]
export const wbStatusLabel = (s: WbTaskStatus) => WB_STATUSES.find(x => x.id === s)?.label ?? s

// ─── 우선순위 ───────────────────────────────────────────────────────────────
export const WB_PRIORITIES: { id: WbTaskPriority; label: string; dot: string }[] = [
  { id: 'low',    label: '낮음', dot: '#E5E7EB' },
  { id: 'normal', label: '보통', dot: '#CBD5E1' },
  { id: 'high',   label: '높음', dot: '#F59E0B' },
  { id: 'urgent', label: '긴급', dot: '#DC2626' },
]
export const wbPriorityDef = (p: WbTaskPriority) => WB_PRIORITIES.find(x => x.id === p) ?? WB_PRIORITIES[1]

// ─── 반복 ───────────────────────────────────────────────────────────────────
export const WB_RRULE_LABEL: Record<WbRrule, string> = { daily: '매일', weekly: '주간', monthly: '월간' }

// ─── 업무영역 색 (미리보기 4색 + 2색 순환) ──────────────────────────────────
const AREA_PALETTE = [
  { bg: '#E6F2FF', fg: '#1E6FE8' },
  { bg: '#FEF3C7', fg: '#B45309' },
  { bg: '#ECFDF5', fg: '#047857' },
  { bg: '#F3E8FF', fg: '#7E22CE' },
  { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#E0F2FE', fg: '#0369A1' },
]
export const areaColor = (index: number) => AREA_PALETTE[((index % AREA_PALETTE.length) + AREA_PALETTE.length) % AREA_PALETTE.length]

// ─── 날짜 (KST) ─────────────────────────────────────────────────────────────
/** timestamptz ISO → KST 'YYYY-MM-DD' */
export function kstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}
/** timestamptz ISO → KST 'HH:MM' */
export function kstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
}
const DOW = ['일', '월', '화', '수', '목', '금', '토']
function ymdToDate(ymd: string): Date { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
function dateToYmd(d: Date): string { return d.toISOString().slice(0, 10) }
export function addDaysYmd(ymd: string, n: number): string { const d = ymdToDate(ymd); d.setUTCDate(d.getUTCDate() + n); return dateToYmd(d) }
function daysBetween(a: string, b: string): number { return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86400_000) }

/** 'M/D(요일)' */
export function fmtYmdShort(ymd: string): string {
  const d = ymdToDate(ymd)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`
}

export type DueTone = 'none' | 'normal' | 'today' | 'warn' | 'over'
export interface DueInfo { tone: DueTone; label: string; ymd: string | null; dday: number | null }

/** due_at → 표시. 완료(done) 업무는 tone 'normal' 로 강조 해제 (호출부가 status 로 판단해 넘김) */
export function dueInfo(dueAt: string | null, isDone = false): DueInfo {
  if (!dueAt) return { tone: 'none', label: '', ymd: null, dday: null }
  const ymd = kstDate(dueAt)
  const dday = daysBetween(todayStr(), ymd)     // 양수 = 남음, 0 = 오늘, 음수 = 지남
  const base = fmtYmdShort(ymd)
  if (isDone) return { tone: 'normal', label: base, ymd, dday }
  if (dday < 0)  return { tone: 'over',   label: `D+${-dday} · ${base}`, ymd, dday }
  if (dday === 0) return { tone: 'today', label: `오늘 · ${base}`, ymd, dday }
  if (dday === 1) return { tone: 'warn',  label: `D-1 · ${base}`, ymd, dday }
  return { tone: 'normal', label: base, ymd, dday }
}
export const dueColor = (t: DueTone) => t === 'over' || t === 'warn' ? WB.dueWarn : t === 'today' ? WB.dueToday : WB.muted

// ─── 마감 필터 프리셋 (보드 상단) ───────────────────────────────────────────
export type DuePreset = 'all' | 'today' | 'week' | 'month' | 'nextMonth' | 'overdue' | 'none'
export const DUE_PRESETS: { id: DuePreset; label: string }[] = [
  { id: 'all',       label: '전체' },
  { id: 'today',     label: '오늘' },
  { id: 'week',      label: '이번 주' },
  { id: 'month',     label: '이번 달' },
  { id: 'nextMonth', label: '다음 달' },
  { id: 'overdue',   label: '지연' },
  { id: 'none',      label: '마감 없음' },
]

/** 이번 주 = 월~일 (KST) */
export function weekRange(today: string): [string, string] {
  const d = ymdToDate(today); const dow = d.getUTCDay()      // 0=일
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const start = addDaysYmd(today, mondayOffset)
  return [start, addDaysYmd(start, 6)]
}
export function monthRange(today: string, offsetMonths = 0): [string, string] {
  const [y, m] = today.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1))
  const last  = new Date(Date.UTC(y, m + offsetMonths, 0))
  return [dateToYmd(first), dateToYmd(last)]
}

export function matchesDuePreset(dueAt: string | null, preset: DuePreset, status: WbTaskStatus, today = todayStr()): boolean {
  if (preset === 'all') return true
  if (preset === 'none') return dueAt === null
  if (!dueAt) return false
  const ymd = kstDate(dueAt)
  switch (preset) {
    case 'today':     return ymd === today
    case 'week':      { const [a, b] = weekRange(today);     return ymd >= a && ymd <= b }
    case 'month':     { const [a, b] = monthRange(today, 0); return ymd >= a && ymd <= b }
    case 'nextMonth': { const [a, b] = monthRange(today, 1); return ymd >= a && ymd <= b }
    case 'overdue':   return ymd < today && status !== 'done'
  }
  return true
}

// ─── 체크리스트 진행 ────────────────────────────────────────────────────────
export function checklistProgress(items: { done: boolean }[]): { done: number; total: number } {
  return { done: items.filter(i => i.done).length, total: items.length }
}
export const newChecklistId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ─── 사람 룩업 ──────────────────────────────────────────────────────────────
export interface WbPerson { id: string; name: string; dept: string; avatar_url: string | null; departed: boolean }

/**
 * users(재직) 우선, 미스 시 departed_users 를 1회 지연 로드해 폴백.
 * 둘 다 없으면 '(알 수 없음)' — uuid 를 그대로 노출하지 않는다.
 */
export function useUserLookup(users: AppUser[]) {
  const [departed, setDeparted] = useState<DepartedUser[] | null>(null)
  const loadingRef = useRef(false)
  const userMap = useMemo(() => {
    const m = new Map<string, WbPerson>()
    for (const u of users) m.set(u.user_id, { id: u.user_id, name: u.name, dept: u.dept, avatar_url: u.avatar_url ?? null, departed: false })
    return m
  }, [users])
  const departedMap = useMemo(() => {
    const m = new Map<string, WbPerson>()
    for (const d of departed ?? []) m.set(d.id, { id: d.id, name: d.name, dept: d.dept, avatar_url: d.avatar_url ?? null, departed: true })
    return m
  }, [departed])

  const ensureDeparted = useCallback(() => {
    if (departed !== null || loadingRef.current) return
    loadingRef.current = true
    loadDepartedUsers().then(setDeparted).catch(() => setDeparted([]))
  }, [departed])

  const lookup = useCallback((id: string | null | undefined): WbPerson => {
    if (!id) return { id: '', name: '-', dept: '', avatar_url: null, departed: false }
    const u = userMap.get(id); if (u) return u
    const d = departedMap.get(id); if (d) return d
    ensureDeparted()
    return { id, name: departed === null ? '…' : '(알 수 없음)', dept: '', avatar_url: null, departed: true }
  }, [userMap, departedMap, departed, ensureDeparted])

  return lookup
}

/** 이름 첫 글자 (아바타 폴백) — UserAvatar 가 내부에서 처리하지만 칩 등 직접 렌더용 */
export const initial = (name: string) => (name || '?').trim().charAt(0)
