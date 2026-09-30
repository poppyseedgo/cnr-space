/**
 * wbShared.tsx — Work Space(WORKBOARD) 공용 토큰·판정·룩업
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-F] useUserLookup(users, members) — 멤버 풀 우선(is_super 배지), 그다음 users(전 직원, 표시 전용), 마지막 departed_users
 *  - [2026-09-30 WORKBOARD P3-E] 마일스톤 상태 카탈로그·진행률(milestoneProgress)·D-day(milestoneDday) · WB_MS_TOAST / WB_AREA_TOAST
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
import type { AppUser, DepartedUser, WbTaskPriority, WbTaskStatus, WbRrule, WbMember } from '../../types'
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
export interface WbPerson { id: string; name: string; dept: string; avatar_url: string | null; departed: boolean; isSuper?: boolean }

/**
 * users(재직) 우선, 미스 시 departed_users 를 1회 지연 로드해 폴백.
 * 둘 다 없으면 '(알 수 없음)' — uuid 를 그대로 노출하지 않는다.
 */
export function useUserLookup(users: AppUser[], members: WbMember[] = []) {   // ← [P3-F] members 우선
  const [departed, setDeparted] = useState<DepartedUser[] | null>(null)
  const loadingRef = useRef(false)
  const userMap = useMemo(() => {
    const m = new Map<string, WbPerson>()
    for (const u of users) m.set(u.user_id, { id: u.user_id, name: u.name, dept: u.dept, avatar_url: u.avatar_url ?? null, departed: false })
    for (const u of members) m.set(u.user_id, { id: u.user_id, name: u.name, dept: u.dept ?? '', avatar_url: u.avatar_url ?? null, departed: false, isSuper: u.is_super })
    return m
  }, [users, members])
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

// ─── 토스트 문구 SSOT ─────────────────────────────────────────────────────────
// ← [2026-09-29 WORKBOARD P3-B, 고지 지시] 모든 액션은 완료 시점에 토스트를 낸다 (확인 다이얼로그는 파괴적 액션만).
//   문구를 한 곳에 두어 보드·드로어·내 업무가 같은 말을 쓴다.
export const WB_TOAST = {
  created:        '업무를 만들었습니다',
  deleted:        '업무를 삭제했습니다',
  statusMoved:    (label: string) => `'${label}'(으)로 이동했습니다`,
  completed:      '완료했습니다',
  titleSaved:     '제목을 저장했습니다',
  descSaved:      '설명을 저장했습니다',
  assigneeAdded:  (name: string) => `${name} 님을 담당자로 추가했습니다`,
  assigneeRemoved:(name: string) => `${name} 님을 담당에서 제외했습니다`,
  dueSaved:       (label: string) => `마감을 ${label}(으)로 설정했습니다`,
  dueCleared:     '마감을 해제했습니다',
  startSaved:     (label: string) => `시작일을 ${label}(으)로 설정했습니다`,   // ← [P3-D]
  startCleared:   '시작일을 해제했습니다',
  datesMoved:     (from: string, to: string) => `${from} → ${to}`,          // 타임라인 드래그
  prioritySaved:  (label: string) => `우선순위 '${label}'`,
  areaSaved:      (name: string) => `업무영역을 '${name}'(으)로 변경했습니다`,
  msSaved:        (title: string | null) => title ? `마일스톤 '${title}' 연결` : '마일스톤 연결을 해제했습니다',
  checkDone:      (text: string) => `☑ ${text}`,
  checkUndone:    (text: string) => `☐ ${text}`,
  checkAdded:     '체크리스트 항목을 추가했습니다',
  checkRemoved:   '체크리스트 항목을 삭제했습니다',
  commentAdded:   '댓글을 등록했습니다',
  commentRemoved: '댓글을 삭제했습니다',
} as const

// ─── 이슈 — ← [2026-09-30 WORKBOARD P3-C] ───────────────────────────────────
import type { WbIssueStatus, WbIssueSeverity } from '../../types'

export const WB_ISSUE_STATUSES: { id: WbIssueStatus; label: string }[] = [
  { id: 'open',        label: '열림' },
  { id: 'in_progress', label: '진행 중' },
  { id: 'resolved',    label: '해결' },
  { id: 'wontfix',     label: '보류' },
]
export const wbIssueStatusLabel = (s: WbIssueStatus) => WB_ISSUE_STATUSES.find(x => x.id === s)?.label ?? s

/** 심각도 — 카드 좌측 띠(bar) · 칩(bg/fg) · 빠른등록 점(dot) */
export const WB_SEVERITIES: { id: WbIssueSeverity; label: string; bar: string; bg: string; fg: string }[] = [
  { id: 'low',      label: '낮음', bar: '#CBD5E1', bg: '#F1F5F9', fg: '#64748B' },
  { id: 'medium',   label: '보통', bar: '#3B82F6', bg: '#DBEAFE', fg: '#1D4ED8' },
  { id: 'high',     label: '높음', bar: '#F59E0B', bg: '#FEF3C7', fg: '#B45309' },
  { id: 'critical', label: '긴급', bar: '#DC2626', bg: '#FEE2E2', fg: '#B91C1C' },
]
export const wbSeverityDef = (s: WbIssueSeverity) => WB_SEVERITIES.find(x => x.id === s) ?? WB_SEVERITIES[1]
/** 빠른 등록 기본 심각도 (고지 확정 2026-09-30) */
export const WB_QUICK_ISSUE_SEVERITY: WbIssueSeverity = 'medium'

export const WB_ISSUE_TOAST = {
  created:        '이슈를 등록했습니다',
  quickCreated:   (title: string) => `이슈 등록 — ${title.length > 24 ? title.slice(0, 24) + '…' : title}`,
  deleted:        '이슈를 삭제했습니다',
  statusMoved:    (label: string) => `'${label}'(으)로 이동했습니다`,
  resolved:       '해결로 처리했습니다',
  severitySaved:  (label: string) => `심각도 '${label}'`,
  occurredSaved:  (label: string) => `발생일을 ${label}(으)로 변경했습니다`,
  taskLinked:     (title: string | null) => title ? `업무 '${title}' 연결` : '업무 연결을 해제했습니다',
  converted:      '업무로 전환했습니다 — 보드에서 확인',
  titleSaved:     '제목을 저장했습니다',
  descSaved:      '설명을 저장했습니다',
  msSaved:        (title: string | null) => title ? `마일스톤 '${title}' 연결` : '마일스톤 연결을 해제했습니다',
} as const

// ─── 타임라인 — ← [2026-09-30 WORKBOARD P3-D] ───────────────────────────────
export type TimelineZoom = 'week' | 'month' | 'quarter'
export const TIMELINE_ZOOMS: { id: TimelineZoom; label: string; days: number }[] = [
  { id: 'week',    label: '주',   days: 7 },
  { id: 'month',   label: '월',   days: 31 },
  { id: 'quarter', label: '분기', days: 153 },   // 5개월 (첨부 레이아웃)
]
export const TL = { labelW: 300, rowH: 44, groupH: 38, headerH: 44, barH: 22, msBarH: 18 } as const

/** 줌별 표시 시작일 — week: 그 주 월요일 / month·quarter: 그 달 1일 */
export function timelineRangeStart(anchor: string, zoom: TimelineZoom): string {
  if (zoom === 'week') return weekRange(anchor)[0]
  return anchor.slice(0, 7) + '-01'
}
/** 줌별 이동 단위 */
export function timelineShift(anchor: string, zoom: TimelineZoom, dir: 1 | -1): string {
  if (zoom === 'week') return addDaysYmd(anchor, 7 * dir)
  const [y, m] = anchor.split('-').map(Number)
  const step = zoom === 'month' ? 1 : 5
  const d = new Date(Date.UTC(y, m - 1 + step * dir, 1))
  return d.toISOString().slice(0, 10)
}
/** 표시 범위 종료일(포함) */
export function timelineRangeEnd(start: string, zoom: TimelineZoom): string {
  if (zoom === 'week') return addDaysYmd(start, 6)
  const [y, m] = start.split('-').map(Number)
  const months = zoom === 'month' ? 1 : 5
  return new Date(Date.UTC(y, m - 1 + months, 0)).toISOString().slice(0, 10)
}
export function daysDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400_000)
}

// ─── 마일스톤 · 업무영역 — ← [2026-09-30 WORKBOARD P3-E] ─────────────────────
import type { WbMilestone, WbMilestoneStatus, WbTask, WbIssue } from '../../types'

/** DB CHECK 값과 id 일치. 목록 정렬 순서 = 이 배열 순서(진행 중 → 예정 → 완료 → 취소) */
export const WB_MS_STATUSES: { id: WbMilestoneStatus; label: string; bg: string; fg: string; closed: boolean }[] = [
  { id: 'active',    label: '진행 중', bg: '#EAF2FF', fg: '#1E6FE8', closed: false },
  { id: 'planned',   label: '예정',    bg: '#F1F5F9', fg: '#64748B', closed: false },
  { id: 'done',      label: '완료',    bg: '#ECFDF5', fg: '#047857', closed: true },
  { id: 'cancelled', label: '취소',    bg: '#F3F4F6', fg: '#9CA3AF', closed: true },
]
export const wbMsStatusDef = (s: WbMilestoneStatus) => WB_MS_STATUSES.find(x => x.id === s) ?? WB_MS_STATUSES[1]
export const MS_COLOR = { bg: '#F5F3FF', fg: '#7C3AED' } as const   // 타임라인·칩 공통 (보라)

export interface MilestoneProgress { total: number; done: number; doing: number; hold: number; overdue: number; pct: number; openIssues: number; issues: number }
/**
 * 진행률 = 연결 업무 중 완료 / 전체 (보류 포함 — 고지 확정). tasks 는 완료 90일 윈도우라 오래된 완료는 빠질 수 있다(표시 기준 일관).
 * 지연 = 미완료이면서 due < 오늘(KST)
 */
export function milestoneProgress(msId: string, tasks: WbTask[], issues: WbIssue[], today = todayStr()): MilestoneProgress {
  const mine = tasks.filter(t => t.milestone_id === msId)
  const done = mine.filter(t => t.status === 'done').length
  const doing = mine.filter(t => t.status === 'doing').length
  const hold = mine.filter(t => t.status === 'hold').length
  const overdue = mine.filter(t => t.status !== 'done' && t.due_at && kstDate(t.due_at) < today).length
  const mineIssues = issues.filter(i => i.milestone_id === msId)
  const openIssues = mineIssues.filter(i => i.status === 'open' || i.status === 'in_progress').length
  return { total: mine.length, done, doing, hold, overdue, pct: mine.length ? Math.round((done / mine.length) * 100) : 0, openIssues, issues: mineIssues.length }
}

/** 카드 우상단 문구 — 진행 중: end_on 기준 D-day / 예정: start_on 까지 / 완료·취소: 종료일 */
export function milestoneDday(m: WbMilestone, today = todayStr()): { label: string; tone: 'warn' | 'today' | 'normal' | 'muted' } {
  if (m.status === 'done' || m.status === 'cancelled') return { label: m.end_on ? `${fmtYmdShort(m.end_on)} 종료` : wbMsStatusDef(m.status).label, tone: 'muted' }
  if (m.status === 'planned') {
    if (!m.start_on) return { label: '기간 미정', tone: 'muted' }
    const d = daysDiff(today, m.start_on)
    return d > 0 ? { label: `시작까지 D-${d}`, tone: 'muted' } : d === 0 ? { label: '오늘 시작', tone: 'today' } : { label: `시작 ${-d}일 경과 · 미착수`, tone: 'warn' }
  }
  if (!m.end_on) return { label: '마감 미정', tone: 'muted' }
  const d = daysDiff(today, m.end_on)
  return d > 0 ? { label: `D-${d} · 마감 ${fmtYmdShort(m.end_on)}`, tone: d <= 7 ? 'today' : 'normal' } : d === 0 ? { label: '오늘 마감', tone: 'today' } : { label: `D+${-d} · 마감 초과`, tone: 'warn' }
}

/** 기간 경과율 (상세 헤더) — 기간이 없으면 null */
export function milestoneElapsedPct(m: WbMilestone, today = todayStr()): number | null {
  if (!m.start_on || !m.end_on) return null
  const total = daysDiff(m.start_on, m.end_on) + 1, passed = daysDiff(m.start_on, today) + 1
  return Math.max(0, Math.min(100, Math.round((passed / total) * 100)))
}

export const WB_MS_TOAST = {
  created:      '마일스톤을 만들었습니다',
  saved:        '마일스톤을 저장했습니다',
  statusMoved:  (label: string) => `마일스톤을 '${label}'(으)로 변경했습니다`,
  deleted:      '마일스톤을 삭제했습니다',
} as const

export const WB_AREA_TOAST = {
  created:      (name: string) => `업무영역 '${name}'을(를) 추가했습니다`,
  saved:        (name: string) => `업무영역 '${name}'을(를) 저장했습니다`,
  activated:    (name: string) => `'${name}' 활성화`,
  deactivated:  (name: string) => `'${name}' 비활성화 — 새 업무 선택지에서 숨겨집니다`,
  reordered:    '순서를 저장했습니다',
} as const
