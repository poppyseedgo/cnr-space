/**
 * ResourceBookingModal.tsx — 자원 예약 생성 모달 (Phase 2A)
 *
 * 디자인: Figma ydfT0xP6nc83VxFd7GyEx4 노드 3108:7512 (포인터 예약) 1:1
 *  - 좌측 라벨 열(필수 빨간점) + 우측 값, 행 사이 hairline(#F2F4F6)
 *  - 자원 칩(아이콘 + 라벨 + 예약가능 뱃지 + X), 하늘색 안내 배너
 *  - 하단 [취소(회색)] [{카테고리} 예약하기(검정 #191F28)]
 *  일반화 지점(고지 확정): 제목·버튼·안내 배너 문구를 카테고리 동적으로,
 *  메모 아래 점유 규칙 안내 1줄 추가 (Figma 에 없음 — 미리보기 승인분)
 *
 * 정책 반영
 *  - 시간 옵션: category.open_time~close_time 을 slot_step_minutes 간격으로 생성
 *  - allow_multi_day=false → 반납일 고정(사용일과 동일, 변경 불가)
 *  - 겹침 검증은 DB EXCLUDE 가 최종 방어 — 실패 시 resourceApi 매핑 문구 표시
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 *  - [2026-08-21] 회의실 BookingModal 기준 정합 (미리보기 승인)
 *      ① 사용시간 고정 배너("N단위 동적 등록") → 동적 "N분/시간 사용" 배지 (Figma 337:1265 스펙 동일)
 *      ② 필수 dot: 텍스트 ● 9px → 4×4px 원형 #EF4444, 라벨 우상단(top) 정렬 (BookingModal Field 동일)
 *      ③ 헤더 X: 텍스트 ✕ → ModalCloseButton 공통 컴포넌트 (칩 내부 제거용 ✕는 공통화 대상 아님 — 유지)
 *      ④ 푸터: gap 10·padding 24·자체 버튼 → gap 8·padding 8 + 공통 Button(ghost/primary, h56·r16), flex 1:1
 */

import { useMemo, useState } from 'react'
import { ModalPortal } from '../common/ModalPortal'
import { ModalCloseButton } from '../common/ModalCloseButton'   // ← [2026-08-21] 회의실 모달과 동일 헤더 X
import { Button } from '../common/Button'                       // ← [2026-08-21] 회의실 모달과 동일 푸터 버튼
import { insertResourceBooking } from '../../lib/resourceApi'
import { ResourceName } from './ResourceIcon'  // ← [2026-08-21] 카테고리 SVG 아이콘 공통 표기
import type { ResourceCategory, ResourceItem } from '../../types/resource'

const FONT = "'Pretendard', -apple-system, sans-serif"

interface Props {
  item:      ResourceItem
  category:  ResourceCategory
  snapshot:  { user_name: string; user_dept: string }
  /** 대리예약 — 지정 시 이 사용자가 예약자가 된다 (Phase 3, insert booker override) */
  booker?:   { user_id: string; email: string }
  /** 타임라인 슬롯 클릭 프리필 (Phase 2B) — 'YYYY-MM-DD' / 'HH:MM' */
  initialDate?:    string
  initialStartHM?: string
  showToast: (msg: string) => void
  onDone:    () => void            // 성공 — 목록 리로드
  onClose:   () => void
}

/** KST 오늘 'YYYY-MM-DD' */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DOW_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
function fmtDateKo(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 ${DOW_FULL[new Date(y, m - 1, d).getDay()]}`
}

/** '13:30' → '오후 1:30' (Figma 표기) */
function fmtTimeKo(hm: string): string {
  const [h, mi] = hm.split(':').map(Number)
  const ampm = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${ampm} ${h12}:${String(mi).padStart(2, '0')}`
}

/** open~close 를 step 분 간격 'HH:MM' 배열로 */
function timeOpts(open: string, close: string, step: number): string[] {
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  const out: string[] = []
  for (let t = oh * 60 + om; t <= ch * 60 + cm; t += step)
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  return out
}

/* 필수 표시 빨간점 — ← [2026-08-21] 회의실 BookingModal Field 스펙 1:1 (4×4px 원형 #EF4444) */
function Req() {
  return <span aria-hidden="true" style={{
    width: 4, height: 4, borderRadius: '50%', background: '#EF4444',
    flexShrink: 0, display: 'inline-block', marginTop: 2,   // ← 라벨 우상단(top) 정렬 (미리보기 확정)
  }} />
}

/* 좌 라벨 + 우 콘텐츠 행 — Figma 라벨 열 고정폭 */
function Row({ label, required, hairline = true, children, alignTop = false }: {
  label: string; required?: boolean; hairline?: boolean; children: React.ReactNode; alignTop?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: alignTop ? 'flex-start' : 'center', gap: 16,
      padding: '15px 0', borderBottom: hairline ? '1px solid #F2F4F6' : 'none',
    }}>
      {/* ← [2026-08-21] dot top 정렬을 위해 inline-flex + alignItems flex-start + gap 2 (BookingModal Field 동일) */}
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

/* 값 텍스트 위에 투명 date input 을 덮는 한국어 날짜 선택 (Figma 텍스트 표기 유지) */
function DateField({ value, min, onChange, disabled }: {
  value: string; min: string; onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ fontSize: 16, fontWeight: 500, color: disabled ? '#8B95A1' : '#191F28', fontFamily: FONT }}>
        {fmtDateKo(value)}
      </span>
      {!disabled && (
        <input
          type="date" value={value} min={min} aria-label="날짜 선택"
          onChange={e => { if (e.target.value) onChange(e.target.value) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                   opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
        />
      )}
    </span>
  )
}

export function ResourceBookingModal({ item, category, snapshot, booker, initialDate, initialStartHM, showToast, onDone, onClose }: Props) {  // ← [Phase 3] booker / [Phase 2B] 프리필 추가
  const step  = category.slot_step_minutes
  const open  = category.open_time.slice(0, 5)
  const close = category.close_time.slice(0, 5)
  const opts  = useMemo(() => timeOpts(open, close, step), [open, close, step])

  // ← [Phase 2B] 타임라인 슬롯 프리필 — 시작 slot 다음 옵션을 종료 기본값으로
  const initStart = initialStartHM && opts.includes(initialStartHM) ? initialStartHM : (opts[0] ?? '09:00')
  const initEnd   = opts[opts.indexOf(initStart) + 1] ?? opts[opts.length - 1] ?? '10:00'
  const [useDate, setUseDate]   = useState(initialDate ?? todayStr())
  const [startHM, setStartHM]   = useState(initStart)
  const [endHM, setEndHM]       = useState(initEnd)
  const [dueDate, setDueDate]   = useState(initialDate ?? todayStr())
  const [memo, setMemo]         = useState('')
  const [saving, setSaving]     = useState(false)

  // 사용일 변경 시 반납일이 앞서지 않게 보정 / 당일반납 강제 카테고리는 항상 동일
  const effDue = category.allow_multi_day ? (dueDate < useDate ? useDate : dueDate) : useDate
  const valid  = startHM < endHM
  // ← [2026-08-21] 동적 "N분 사용" 배지 — 회의실 BookingModal durMin 산식 동일 (종료−시작, 분)
  const durMin = useMemo(() => {
    const [sh, sm] = startHM.split(':').map(Number)
    const [eh, em] = endHM.split(':').map(Number)
    return (eh * 60 + em) - (sh * 60 + sm)
  }, [startHM, endHM])

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await insertResourceBooking({
        item_id:    item.id,
        start_at:   new Date(`${useDate}T${startHM}:00`).toISOString(),
        end_at:     new Date(`${useDate}T${endHM}:00`).toISOString(),
        return_due: effDue,
        memo:       memo.trim() || null,
      }, snapshot, booker)  // ← [Phase 3] 대리예약 override
      showToast(booker ? `${snapshot.user_name}님 명의로 ${item.label} 대리예약이 완료되었습니다.` : `${item.label} 예약이 완료되었습니다.`)
      onDone()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '예약에 실패했습니다.')
      setSaving(false)
    }
  }

  const selStyle: React.CSSProperties = {
    border: 'none', background: 'transparent', fontFamily: FONT, fontWeight: 500,
    fontSize: 16, color: '#191F28', cursor: 'pointer', padding: 0, outline: 'none',
  }

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

          {/* 헤더 — Figma: 아이콘 + "{카테고리} 예약" + X */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '22px 24px 12px' }}>
            <ResourceName icon={category.icon} size={18} gap={7}
              style={{ fontSize: 19, fontWeight: 600, color: '#191F28' }}>{category.name} 예약</ResourceName>{/* ← [2026-08-21] 아이콘 */}
            {/* ← [2026-08-21] 회의실 모달과 동일 공통 X (32×32 원형 · hover #F1F5F9 · SVG) */}
            <ModalCloseButton onClick={onClose} />
          </div>

          <div style={{ padding: '0 24px' }}>
            {/* 자원 번호 칩 */}
            <Row label={`${category.name} 번호`} required>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
                             background: '#F2F4F6', borderRadius: 10, padding: '8px 12px' }}>
                <ResourceName icon={category.icon} size={14}
                  style={{ fontSize: 14, fontWeight: 500, color: '#191F28' }}>{item.label}</ResourceName>{/* ← [2026-08-21] 아이콘 */}
                <span style={{ background: '#D5F0FF', color: '#111', borderRadius: 6,
                               fontSize: 11, padding: '2px 7px' }}>예약가능</span>
                <button onClick={onClose} aria-label="자원 선택 해제"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: '#8B95A1', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            </Row>

            {/* 사용일 */}
            <Row label="사용일" required>
              <DateField value={useDate} min={todayStr()} onChange={setUseDate} />
            </Row>

            {/* 사용시간 + 단위 안내 배너 */}
            <Row label="사용시간" required alignTop>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select value={startHM} onChange={e => setStartHM(e.target.value)} style={selStyle} aria-label="시작 시간">
                  {opts.slice(0, -1).map(t => <option key={t} value={t}>{fmtTimeKo(t)}</option>)}
                </select>
                <span style={{ color: '#B0B8C1', fontSize: 13 }}>부터</span>
                <select value={endHM} onChange={e => setEndHM(e.target.value)} style={selStyle} aria-label="종료 시간">
                  {opts.slice(1).map(t => <option key={t} value={t}>{fmtTimeKo(t)}</option>)}
                </select>
                <span style={{ color: '#B0B8C1', fontSize: 13 }}>까지</span>
              </div>
              {!valid && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: '#F04452' }}>
                  종료 시간은 시작 시간보다 늦어야 합니다
                </p>
              )}
              {/* ← [2026-08-21] 고정 문구 배너 → 동적 "N분 사용" 배지 (회의실 Figma 337:1265 —
                    h26 / r6 / bg #edf8ff / 12px Regular #111 / 시간행과 gap 16). valid일 때만 노출 */}
              {valid && (
                <div style={{
                  width: '100%', height: 26, padding: '16px 4px', borderRadius: 6,
                  background: '#edf8ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', marginTop: 16,
                }}>
                  <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: 12, lineHeight: 1.5, color: '#111' }}>
                    {(() => {
                      // 회의실 BookingModal 표기 산식 동일 — "15분 사용" / "1시간 사용" / "1시간 30분 사용"
                      const h = Math.floor(durMin / 60)
                      const m = durMin % 60
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
              <DateField value={effDue} min={useDate} onChange={setDueDate}
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

            {/* 점유 규칙 안내 — Figma 외 추가분 (미리보기 승인) */}
            {effDue !== useDate && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8B95A1' }}>
                반납일 19:00까지 이 {category.name}의 다른 예약이 제한됩니다
              </p>
            )}
          </div>

          {/* 하단 버튼 — ← [2026-08-21] 회의실 BookingModal 푸터 1:1
                gap 8 · padding 8 · 공통 Button(ghost/primary) · minHeight 56 · radius 16 · flex 1:1 */}
          <div style={{ display: 'flex', gap: 8, padding: 8 }}>
            <Button variant="ghost" flex onClick={onClose} disabled={saving}
              style={{ minHeight: 56, borderRadius: 16 }}>취소</Button>
            <Button variant="primary" flex onClick={submit} disabled={!valid} loading={saving}
              style={{ minHeight: 56, borderRadius: 16 }}>
              {category.name} 예약하기
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
