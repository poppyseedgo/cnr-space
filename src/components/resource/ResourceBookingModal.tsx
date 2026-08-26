/**
 * ResourceBookingModal.tsx — 자원 예약 생성·변경 모달
 *
 * 디자인: Figma ydfT0xP6nc83VxFd7GyEx4 노드 3108:7512 (포인터 예약) 1:1
 *  - 좌측 라벨 열(필수 빨간점) + 우측 값, 행 사이 hairline(#F2F4F6)
 *  - 자원 칩(아이콘 + 라벨 + 상태 뱃지 + X), 동적 "N시간 사용" 배지
 *  - 하단 [취소(회색)] [{카테고리} 예약하기 / 변경하기(검정 #191F28)]
 *
 * 정책 (회의실 BookingModal 규칙 이식 — 2026-08-26 미리보기 승인)
 *  - 시작 옵션: 사용일이 오늘이면 현재 시각(KST) 이후 슬롯만 (tOpts 동일 — t > nowMinutes)
 *  - 초기값: 현재 시각 다음 slot_step 경계로 스냅 / 프리필이 과거면 첫 가용 슬롯
 *  - 30초 tick: 시작이 과거로 밀리면 첫 슬롯으로 점프, 선택 개체는 유지(skipItemClear — 회의실 skipRoomClear)
 *  - 사용일·반납일: 공통 DatePickerPopup (공휴일 표기 SSOT) — min today / max today+30일(관리자 무제한)
 *  - 개체 칩: 카테고리 전체 개체 나열(개수 제한 없음, wrap), 선택 조합(사용일·시간·반납일)과 충돌하는
 *    개체·점검중·연체 홀더는 비활성 뱃지. 시간 변경으로 선택 개체가 불가해지면 자동 해제.
 *    프론트 판정은 안내용 — 겹침 방어는 DB EXCLUDE, 시간 규칙은 20260752 트리거가 최종.
 *  - edit 모드: 개체·예약자 잠금, 시작 후 건은 사용일·시작시간 잠금(START_LOCKED), 반납일 앞당기기 가능(min = 오늘)
 *  - allow_multi_day=false → 반납일 고정(사용일과 동일)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 *  - [2026-08-21] 회의실 BookingModal 기준 정합 (배지·dot·X·푸터)
 *  - [2026-08-26] 과거 시간 차단·tick 보정·DatePickerPopup·개체 칩 선택·edit 모드 (근본 수정)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ModalPortal } from '../common/ModalPortal'
import { ModalCloseButton } from '../common/ModalCloseButton'
import { Button } from '../common/Button'
import { DatePickerPopup } from '../common/DatePickerPopup'   // ← [2026-08-26] 공통 날짜 선택 (회의실·도서·어드민 공용 SSOT)
import { insertResourceBooking, loadOverdueResourceBookings, loadResourceBookingsRange,
         updateResourceBookingPeriod } from '../../lib/resourceApi'
import { ResourceName } from './ResourceIcon'
import { nowMinutes, todayStr, timeToMin } from '../../utils/time'   // ← [2026-08-26] 회의실과 동일 KST 기준
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../../types/resource'

const FONT = "'Pretendard', -apple-system, sans-serif"
const DATE_LIMIT_DAYS = 30   // 회의실 check_booking_date_limit 동일 (20260752 DATE_LIMIT_30D)

interface Props {
  category:  ResourceCategory
  /** 카테고리의 비폐기 개체 — 칩으로 전부 나열 */
  items:     ResourceItem[]
  /** 생성: 프리필 개체(카드·타임라인) / 없으면 미선택 */
  initialItem?:    ResourceItem | null
  /** 변경 모드 — 지정 시 해당 예약의 기간을 수정 */
  editBooking?:    ResourceBooking | null
  /** 자원 관리자 여부 — 30일 제한 면제(DB 동일) */
  isAdmin?:        boolean
  snapshot:  { user_name: string; user_dept: string }
  /** 대리예약 — 지정 시 이 사용자가 예약자가 된다 (Phase 3, insert booker override) */
  booker?:   { user_id: string; email: string }
  /** 타임라인 슬롯·캘린더 날짜 프리필 — 'YYYY-MM-DD' / 'HH:MM' */
  initialDate?:    string
  initialStartHM?: string
  showToast: (msg: string) => void
  onDone:    () => void
  onClose:   () => void
}

const DOW_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
function fmtDateKo(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 ${DOW_FULL[new Date(y, m - 1, d).getDay()]}`
}
function fmtTimeKo(hm: string): string {
  const [h, mi] = hm.split(':').map(Number)
  const ampm = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${ampm} ${h12}:${String(mi).padStart(2, '0')}`
}
function minToHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
/** open~close 를 step 분 간격 'HH:MM' 배열로 (close 포함 — 종료 옵션용) */
function timeOpts(open: string, close: string, step: number): string[] {
  const out: string[] = []
  for (let t = timeToMin(open); t <= timeToMin(close); t += step) out.push(minToHM(t))
  return out
}
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
/** 로컬(KST) 'YYYY-MM-DD' + 'HH:MM' → Date */
function atLocal(ymd: string, hm: string): Date { return new Date(`${ymd}T${hm}:00`) }
function localYmd(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function localHM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* 필수 표시 빨간점 — 회의실 BookingModal Field 스펙 1:1 (4×4px 원형 #EF4444) */
function Req() {
  return <span aria-hidden="true" style={{
    width: 4, height: 4, borderRadius: '50%', background: '#EF4444',
    flexShrink: 0, display: 'inline-block', marginTop: 2,
  }} />
}

function Row({ label, required, hairline = true, children, alignTop = false }: {
  label: string; required?: boolean; hairline?: boolean; children: React.ReactNode; alignTop?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: alignTop ? 'flex-start' : 'center', gap: 16,
      padding: '15px 0', borderBottom: hairline ? '1px solid #F2F4F6' : 'none',
    }}>
      <span style={{
        width: 76, flexShrink: 0, color: '#6B7684', fontSize: 14, paddingTop: alignTop ? 2 : 0,
        display: 'inline-flex', alignItems: 'flex-start', gap: 2,
      }}>
        {label}{required && <Req />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

/* 한국어 날짜 텍스트 트리거 + 공통 DatePickerPopup — ← [2026-08-26] native input 오버레이 대체 */
function DateText({ value, min, max, onChange, disabled }: {
  value: string; min: string; max?: string; onChange: (v: string) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} type="button" disabled={disabled} aria-label="날짜 선택"
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer',
                 fontSize: 16, fontWeight: 500, color: disabled ? '#8B95A1' : '#191F28', fontFamily: FONT,
                 display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {fmtDateKo(value)}
        {!disabled && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: '#94A3B8' }}>
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9H21" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 3V6M16 3V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <DatePickerPopup value={value} min={min} max={max} anchorRef={ref}
          onChange={d => { onChange(d); setOpen(false) }} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

type ChipState = 'available' | 'conflict' | 'overdue' | 'maintenance'
const CHIP_BADGE: Record<ChipState, { label: string; bg: string; fg: string }> = {
  available:   { label: '예약가능', bg: '#D5F0FF', fg: '#111' },
  conflict:    { label: '예약중',   bg: '#FCE7F3', fg: '#BE185D' },
  overdue:     { label: '연체',     bg: '#FEE2E2', fg: '#B91C1C' },
  maintenance: { label: '점검중',   bg: '#E2E8F0', fg: '#64748B' },
}

export function ResourceBookingModal({
  category, items, initialItem, editBooking, isAdmin = false, snapshot, booker,
  initialDate, initialStartHM, showToast, onDone, onClose,
}: Props) {
  const isEdit  = !!editBooking
  const step    = category.slot_step_minutes
  const open    = category.open_time.slice(0, 5)
  const close   = category.close_time.slice(0, 5)
  const allOpts = useMemo(() => timeOpts(open, close, step), [open, close, step])
  const today   = todayStr()
  const maxDate = isAdmin ? undefined : shiftYmd(today, DATE_LIMIT_DAYS)

  // ── 초기값 — 회의실 BookingModal ① 신규: 현재 시각 다음 slot 경계 스냅 / ② 과거 날짜 → today ──
  const init = useMemo(() => {
    if (editBooking) {
      return { date: localYmd(editBooking.start_at), start: localHM(editBooking.start_at),
               end: localHM(editBooking.end_at), due: editBooking.return_due, memo: editBooking.memo ?? '' }
    }
    let date = initialDate ?? today
    if (date < today) date = today
    const starts = allOpts.slice(0, -1)
    const nowMin = nowMinutes()
    const usable = date === today ? starts.filter(t => timeToMin(t) > nowMin) : starts
    let start = initialStartHM && usable.includes(initialStartHM) ? initialStartHM : (usable[0] ?? starts[0] ?? '09:00')
    if (!initialStartHM && date === today && usable.length > 0) {
      const snap = Math.ceil((nowMin + 1) / step) * step   // 회의실 snapStart 산식 (15→step)
      start = usable.find(t => timeToMin(t) >= snap) ?? usable[0]
    }
    const end = allOpts[allOpts.indexOf(start) + 1] ?? allOpts[allOpts.length - 1] ?? '10:00'
    return { date, start, end, due: date, memo: '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [itemId, setItemId]   = useState<number | null>(editBooking?.item_id ?? initialItem?.id ?? null)
  const [useDate, setUseDate] = useState(init.date)
  const [startHM, setStartHM] = useState(init.start)
  const [endHM, setEndHM]     = useState(init.end)
  const [dueDate, setDueDate] = useState(init.due)
  const [memo, setMemo]       = useState(init.memo)
  const [saving, setSaving]   = useState(false)
  const [tick, setTick]       = useState(0)
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(id) }, [])

  const nowMin   = nowMinutes()
  const started  = isEdit && new Date(editBooking!.start_at) <= new Date()   // 시작 후 → 사용일·시작시간 잠금
  const isToday  = useDate === today

  // ── 시작/종료 옵션 — 회의실 tOpts/endOpts 규칙 (오늘이면 현재 이후만) ──
  const startOpts = useMemo(() => {
    const starts = allOpts.slice(0, -1)
    if (started) return [startHM]                               // 잠금
    return isToday ? starts.filter(t => timeToMin(t) > nowMin) : starts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOpts, isToday, nowMin, started, tick])
  const endOpts = useMemo(() => {
    const s = timeToMin(startHM)
    let ends = allOpts.filter(t => timeToMin(t) > s)
    if (started && isToday) ends = ends.filter(t => timeToMin(t) > nowMin)   // PAST_END — 단축은 now 까지
    return ends
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOpts, startHM, started, isToday, nowMin, tick])
  const noTimeLeft = !started && isToday && startOpts.length === 0

  // ── tick 자동 보정 — 회의실 BookingModal ③: 시작이 과거로 밀리면 첫 슬롯으로 점프, 개체 유지 ──
  const skipItemClear = useRef(false)
  useEffect(() => {
    if (started || !isToday || startOpts.length === 0) return
    if (timeToMin(startHM) <= nowMin) {
      const next = startOpts[0]
      if (next === startHM) return
      skipItemClear.current = true
      setStartHM(next)
      setEndHM(allOpts[allOpts.indexOf(next) + 1] ?? allOpts[allOpts.length - 1])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, useDate])
  // 시작 변경으로 종료가 시작 이하가 되면 다음 슬롯으로
  useEffect(() => {
    if (timeToMin(endHM) <= timeToMin(startHM)) setEndHM(allOpts[allOpts.indexOf(startHM) + 1] ?? allOpts[allOpts.length - 1])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHM])

  // 반납일 — 사용일과 동일 강제 카테고리 / 앞서지 않게 보정 / edit 앞당기기는 오늘까지(PAST_RETURN_DUE)
  const dueMin = useDate > today ? useDate : today
  const effDue = category.allow_multi_day ? (dueDate < dueMin ? dueMin : dueDate) : useDate
  const valid  = startHM < endHM && !noTimeLeft
  const durMin = timeToMin(endHM) - timeToMin(startHM)

  // ── 개체 가용 판정 — 선택 조합의 점유구간(DB compute_occupancy 동일 산식)과 겹치는 confirmed 건 ──
  const [rangeBookings, setRangeBookings] = useState<ResourceBooking[]>([])
  const [overdueBookings, setOverdueBookings] = useState<ResourceBooking[]>([])
  useEffect(() => {
    let alive = true
    Promise.all([
      loadResourceBookingsRange(atLocal(shiftYmd(useDate, -1), '00:00').toISOString(),
                                atLocal(shiftYmd(effDue, 1), '00:00').toISOString()),
      loadOverdueResourceBookings(),
    ]).then(([r, o]) => { if (alive) { setRangeBookings(r); setOverdueBookings(o) } })
      .catch(e => showToast(e instanceof Error ? e.message : '예약 정보를 불러오지 못했습니다.'))
    return () => { alive = false }
  }, [useDate, effDue, showToast])

  const occStart = atLocal(useDate, startHM)
  const occEnd   = effDue === useDate ? atLocal(useDate, endHM) : atLocal(effDue, '19:00')   // 반납일 19:00 KST 독점
  const chipState = (item: ResourceItem): ChipState => {
    if (item.status !== 'available') return 'maintenance'
    if (overdueBookings.some(b => b.item_id === item.id && b.id !== editBooking?.id)) return 'overdue'
    const hit = rangeBookings.some(b => b.item_id === item.id && b.id !== editBooking?.id
      && new Date(b.start_at) < occEnd && new Date(b.occupied_until) > occStart)
    return hit ? 'conflict' : 'available'
  }
  const states = useMemo(() => new Map(items.map(i => [i.id, chipState(i)])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, rangeBookings, overdueBookings, useDate, startHM, endHM, effDue])

  // ── 회의실 ④ 개체 자동 해제 — 조합 변경으로 선택 개체가 불가해지면 해제 (초기 마운트·tick 보정 직후 skip) ──
  const isMounted = useRef(false)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    if (skipItemClear.current) { skipItemClear.current = false; return }
    if (isEdit) return
    if (itemId != null && valid && states.get(itemId) !== 'available') setItemId(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states])

  const selectedItem = items.find(i => i.id === itemId) ?? null
  const canSubmit = valid && selectedItem != null && states.get(selectedItem.id) === 'available'   // edit 도 자기 건 제외 후 겹침 판정

  const submit = async () => {
    if (!canSubmit || saving || !selectedItem) return
    setSaving(true)
    try {
      const payload = {
        start_at:   atLocal(useDate, startHM).toISOString(),
        end_at:     atLocal(useDate, endHM).toISOString(),
        return_due: effDue,
        memo:       memo.trim() || null,
      }
      if (isEdit) {
        await updateResourceBookingPeriod(editBooking!.id, payload, isAdmin)
        showToast('예약이 변경되었습니다.')
      } else {
        await insertResourceBooking({ item_id: selectedItem.id, ...payload }, snapshot, booker)
        showToast(booker ? `${snapshot.user_name}님 명의로 ${selectedItem.label} 대리예약이 완료되었습니다.`
                         : `${selectedItem.label} 예약이 완료되었습니다.`)
      }
      onDone()
    } catch (e) {
      showToast(e instanceof Error ? e.message : (isEdit ? '변경에 실패했습니다.' : '예약에 실패했습니다.'))
      setSaving(false)
    }
  }

  const selStyle: React.CSSProperties = {
    border: 'none', background: 'transparent', fontFamily: FONT, fontWeight: 500,
    fontSize: 16, color: '#191F28', cursor: 'pointer', padding: 0, outline: 'none',
  }
  const lockStyle: React.CSSProperties = { ...selStyle, color: '#8B95A1', cursor: 'default', appearance: 'none' }

  return (
    <ModalPortal>
      <div
        onClick={() => { if (!saving) onClose() }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
                 backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
                 justifyContent: 'center', zIndex: 1200, padding: 16 }}>
        <div
          className="anm" onClick={e => e.stopPropagation()}
          style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 462,
                   maxHeight: '92vh', overflowY: 'auto', fontFamily: FONT,
                   boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>

          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '22px 24px 12px' }}>
            <ResourceName icon={category.icon} size={28} gap={7}
              style={{ fontSize: 19, fontWeight: 600, color: '#191F28' }}>
              {isEdit ? '예약 변경' : `${category.name} 예약`}
            </ResourceName>
            <ModalCloseButton onClick={onClose} />
          </div>

          <div style={{ padding: '0 24px' }}>
            {/* 상태 배너 — 시작 후 변경 / 오늘 슬롯 없음 */}
            {started && (
              <div style={{ background: '#FDF2F8', color: '#BE185D', borderRadius: 8, padding: '7px 12px',
                            fontSize: 12, marginBottom: 4 }}>
                사용 중인 예약입니다. 사용일과 시작 시간은 변경할 수 없습니다
              </div>
            )}
            {noTimeLeft && (
              <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#C2410C',
                            borderRadius: 8, padding: '7px 12px', fontSize: 12, marginBottom: 4 }}>
                오늘은 예약 가능한 시간이 없습니다 — 날짜를 변경하세요
              </div>
            )}

            {/* 자원 번호 칩 — 전체 나열, 단건 선택 (edit 은 잠금) */}
            <Row label={`${category.name} 번호`} required alignTop>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(isEdit ? items.filter(i => i.id === itemId) : items).map(item => {
                  const st = states.get(item.id) ?? 'available'
                  const sel = item.id === itemId
                  const disabled = isEdit || st !== 'available'
                  const badge = CHIP_BADGE[st]
                  return (
                    <button key={item.id} type="button"
                      onClick={() => { if (!disabled) setItemId(sel ? null : item.id) }}
                      aria-pressed={sel} aria-disabled={disabled}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: FONT,
                               background: '#F2F4F6', borderRadius: 10, padding: '7px 12px',
                               border: sel ? '1px solid #191F28' : '1px solid transparent',
                               opacity: !isEdit && disabled ? 0.55 : 1,
                               cursor: disabled ? 'default' : 'pointer' }}>
                      <ResourceName icon={category.icon} size={20}
                        style={{ fontSize: 14, fontWeight: 500, color: '#191F28' }}>{item.label}</ResourceName>
                      <span style={{ background: badge.bg, color: badge.fg, borderRadius: 6,
                                     fontSize: 11, padding: '2px 7px' }}>{badge.label}</span>
                      {sel && !isEdit && (
                        <span aria-label="자원 선택 해제"
                          style={{ color: '#8B95A1', fontSize: 13, lineHeight: 1 }}>✕</span>
                      )}
                    </button>
                  )
                })}
                {items.length === 0 && <span style={{ fontSize: 13, color: '#8B95A1' }}>등록된 개체가 없습니다</span>}
              </div>
              {isEdit && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8B95A1' }}>자원은 변경할 수 없습니다 — 다른 자원은 취소 후 다시 예약해 주세요</p>}
            </Row>

            {/* 사용일 */}
            <Row label="사용일" required>
              <DateText value={useDate} min={today} max={maxDate} disabled={started}
                onChange={d => { setUseDate(d); if (!category.allow_multi_day || dueDate < d) setDueDate(d) }} />
            </Row>

            {/* 사용시간 */}
            <Row label="사용시간" required alignTop>
              {noTimeLeft ? (
                <span style={{ fontSize: 16, fontWeight: 500, color: '#B0B8C1' }}>선택 가능한 시간 없음</span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <select value={startHM} onChange={e => setStartHM(e.target.value)} disabled={started}
                    style={started ? lockStyle : selStyle} aria-label="시작 시간">
                    {startOpts.map(t => <option key={t} value={t}>{fmtTimeKo(t)}</option>)}
                  </select>
                  <span style={{ color: '#B0B8C1', fontSize: 13 }}>부터</span>
                  <select value={endHM} onChange={e => setEndHM(e.target.value)} style={selStyle} aria-label="종료 시간">
                    {endOpts.map(t => <option key={t} value={t}>{fmtTimeKo(t)}</option>)}
                  </select>
                  <span style={{ color: '#B0B8C1', fontSize: 13 }}>까지</span>
                </div>
              )}
              {!noTimeLeft && !valid && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#F04452' }}>
                  종료 시간은 시작 시간보다 늦어야 합니다
                </p>
              )}
              {valid && (
                <div style={{
                  width: '100%', height: 26, padding: '16px 4px', borderRadius: 6,
                  background: '#edf8ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', marginTop: 16,
                }}>
                  <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: 12, lineHeight: 1.5, color: '#111' }}>
                    {(() => {
                      const h = Math.floor(durMin / 60), m = durMin % 60
                      const parts: string[] = []
                      if (h > 0) parts.push(`${h}시간`)
                      if (m > 0) parts.push(`${m}분`)
                      return `${parts.join(' ')} 사용`
                    })()}
                  </span>
                </div>
              )}
            </Row>

            {/* 반납일 */}
            <Row label="반납일" required>
              <DateText value={effDue} min={dueMin} max={maxDate} onChange={setDueDate}
                        disabled={!category.allow_multi_day} />
            </Row>

            {/* 메모 */}
            <Row label="메모" hairline={false} alignTop>
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  value={memo} maxLength={100} rows={2}
                  onChange={e => setMemo(e.target.value)}
                  placeholder="메모할 사항이 있다면!"
                  style={{ flex: 1, border: 'none', outline: 'none', resize: 'none',
                           fontFamily: FONT, fontSize: 14, color: '#191F28', padding: 0 }}
                />
                <span style={{ flexShrink: 0, fontSize: 11, color: '#B0B8C1', alignSelf: 'flex-start' }}>
                  {memo.length}/100
                </span>
              </div>
            </Row>

            {effDue !== useDate && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8B95A1' }}>
                반납일 19:00까지 이 {category.name}의 다른 예약이 제한됩니다
              </p>
            )}
          </div>

          {/* 하단 버튼 — 회의실 BookingModal 푸터 1:1 */}
          <div style={{ display: 'flex', gap: 8, padding: 8 }}>
            <Button variant="ghost" flex onClick={onClose} disabled={saving}
              style={{ minHeight: 56, borderRadius: 16 }}>취소</Button>
            <Button variant="primary" flex onClick={submit} disabled={!canSubmit} loading={saving}
              style={{ minHeight: 56, borderRadius: 16 }}>
              {isEdit ? '변경하기' : `${category.name} 예약하기`}
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
