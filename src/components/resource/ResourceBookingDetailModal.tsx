/**
 * ResourceBookingDetailModal.tsx — 자원 예약 상세 조회 모달
 *
 * 진입: 개체 카드(내 예약이 홀더) · 타임라인 사용 블록 · 캘린더 리스트 항목 · 마이페이지 자원 예약 행
 * 역할: 상세 표시 + 액션 분기 — [예약 변경](confirmed·미반납, 본인 또는 자원 관리자) / [예약 취소](시작 전, 본인)
 *       변경은 ResourceBookingModal edit 모드로 위임(onEdit), 취소는 호출부 ConfirmDialog 로 위임(onCancel)
 *
 * 버튼 영역 — 회의실 DetailModal 조합 규칙 이식 (공통 Button variant 동일):
 *   종료·취소·반납완료        → [닫기]
 *   관리자 · 사용중/연체      → [닫기] [예약 변경(info-outline)] [반납 확인(success)]   ← [2026-08-26] 고지 지시
 *   관리자 · 시작 전          → [닫기 | 본인이면 예약 취소(danger-outline)] [예약 변경]
 *   본인   · 사용중/연체      → [닫기] [예약 변경]
 *   본인   · 시작 전          → [예약 취소] [예약 변경]
 *   타인(비관리자)            → [닫기]
 *
 * ✅ 변경 이력
 *  - [2026-08-26] 최초 작성 (기한 변경 기능과 함께 — 고지 지시: 카드 클릭 즉시 상세·변경)
 *  - [2026-08-26] 관리자 [반납 확인] CTA 추가 — 회의실 상세 모달 버튼 조합 규칙으로 정리
 *  - [2026-08-27] 판정식 SSOT 이관(bookingDisplayStatus → utils/resourceStatus), 반납일 당일 '연체' 오표기 수정
 */

import { ModalPortal } from '../common/ModalPortal'
import { ModalCloseButton } from '../common/ModalCloseButton'
import { Button } from '../common/Button'
import { ResourceName } from './ResourceIcon'
import { bookingDisplayStatus, fmtDueShort, fmtTimeShort, type ResourceBookingDisplayStatus } from '../../utils/resourceStatus'   // ← [2026-08-27] 판정식 SSOT
import type { ResourceBooking } from '../../types/resource'

const FONT = "'Pretendard', -apple-system, sans-serif"

/** ← [2026-08-27] 판정은 utils/resourceStatus.bookingDisplayStatus (SSOT). 'done' 상태 폐지 — 점유 끝~반납일은 '사용중' */
type St = ResourceBookingDisplayStatus
export const RESOURCE_BOOKING_BADGE: Record<St, { label: string; bg: string; fg: string }> = {
  upcoming:  { label: '예약중',   bg: '#CBECFF', fg: '#111' },
  inuse:     { label: '사용중',   bg: '#FCE7F3', fg: '#BE185D' },
  overdue:   { label: '연체',     bg: '#FEE2E2', fg: '#B91C1C' },
  returned:  { label: '반납완료', bg: '#DCFCE7', fg: '#16A34A' },
  cancelled: { label: '취소',     bg: '#E2E8F0', fg: '#64748B' },
}
const BADGE = RESOURCE_BOOKING_BADGE

interface Props {
  booking:      ResourceBooking
  itemLabel:    string
  categoryName: string
  categoryIcon: string | null | undefined
  /** 예약자 표시명 (live 우선, 스냅샷 폴백 — 호출부 계산) */
  holderLabel:  string
  isMine:       boolean
  isAdmin:      boolean
  onEdit:       () => void
  onCancel?:    () => void
  /** ← [2026-08-26] 관리자 반납 확인 — 사용중·연체 건 (호출부 ConfirmDialog "실물 수령") */
  onReturn?:    () => void
  onClose:      () => void
}

const DOW_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
function fmtDateKo(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 ${DOW_FULL[new Date(y, m - 1, d).getDay()]}`
}

export function ResourceBookingDetailModal({
  booking: b, itemLabel, categoryName, categoryIcon, holderLabel, isMine, isAdmin, onEdit, onCancel, onReturn, onClose,
}: Props) {
  const now = new Date()
  const st = bookingDisplayStatus(b, now)
  const badge = BADGE[st]
  const useDay = b.start_at.slice(0, 10)
  const localUseDay = (() => { const d = new Date(b.start_at)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const active     = b.status === 'confirmed' && !b.returned_at && (st === 'upcoming' || st === 'inuse' || st === 'overdue')
  const editable   = (isMine || isAdmin) && active
  const cancellable = isMine && st === 'upcoming' && !!onCancel
  const returnable = isAdmin && (st === 'inuse' || st === 'overdue') && !!onReturn
  const btn: React.CSSProperties = { minHeight: 56, borderRadius: 16 }
  // 회의실 DetailModal 버튼 조합 — 닫기/취소가 왼쪽, 주요 액션이 오른쪽
  const BtnClose  = () => <Button variant="ghost"          flex onClick={onClose}  style={btn}>닫기</Button>
  const BtnCancel = () => <Button variant="danger-outline" flex onClick={onCancel} style={btn}>예약 취소</Button>
  const BtnEdit   = () => <Button variant="info-outline"   flex onClick={onEdit}   style={btn}>예약 변경</Button>
  const BtnReturn = () => <Button variant="success"        flex onClick={onReturn} style={btn}>반납 확인</Button>
  const actions = !editable
    ? <BtnClose />
    : returnable
      ? <>{cancellable ? <BtnCancel /> : <BtnClose />}<BtnEdit /><BtnReturn /></>
      : <>{cancellable ? <BtnCancel /> : <BtnClose />}<BtnEdit /></>

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 16, padding: '13px 0', borderBottom: '1px solid #F2F4F6', fontSize: 14 }}>
      <span style={{ width: 76, flexShrink: 0, color: '#6B7684' }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 500, color: '#191F28' }}>{value}</span>
    </div>
  )

  return (
    <ModalPortal>
      <div onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}>
        <div className="anm" onClick={e => e.stopPropagation()}
          style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 462, maxHeight: '92vh',
                   overflowY: 'auto', fontFamily: FONT, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px 12px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <ResourceName icon={categoryIcon} size={28} gap={7}
                style={{ fontSize: 19, fontWeight: 600, color: '#191F28' }}>{categoryName} 예약 상세</ResourceName>
              <span style={{ background: badge.bg, color: badge.fg, borderRadius: 6, fontSize: 11, padding: '2px 7px' }}>{badge.label}</span>
            </span>
            <ModalCloseButton onClick={onClose} />
          </div>

          <div style={{ padding: '0 24px' }}>
            {st === 'overdue' && (
              <div style={{ background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, padding: '7px 12px', fontSize: 12, marginBottom: 4 }}>
                {fmtDueShort(b.return_due)} 반납 예정이었습니다 — 관리자에게 반납해 주세요
              </div>
            )}
            {st === 'inuse' && now >= new Date(b.end_at) && (   /* ← [2026-08-27] 사용시간 종료 후 ~ 반납일: 반납 확인 전까지 점유 — 반납 안내 */
              <div style={{ background: '#FDF2F8', color: '#BE185D', borderRadius: 8, padding: '7px 12px', fontSize: 12, marginBottom: 4 }}>
                {fmtDueShort(b.return_due)} 반납 예정입니다 — 관리자에게 반납해 주세요
              </div>
            )}
            {row(`${categoryName} 번호`,
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F2F4F6', borderRadius: 10, padding: '7px 12px' }}>
                <ResourceName icon={categoryIcon} size={20} style={{ fontSize: 14 }}>{itemLabel}</ResourceName>
              </span>)}
            {row('예약자', holderLabel)}
            {row('사용일', fmtDateKo(localUseDay))}
            {row('사용시간', `${fmtTimeShort(b.start_at)} ~ ${fmtTimeShort(b.end_at)}`)}
            {row('반납일', <>{fmtDateKo(b.return_due)}{!b.returned_at && b.status === 'confirmed' && (
              <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: '#8B95A1', marginTop: 2 }}>관리자 반납 확인 전까지 점유 · 타인 예약은 반납일 19:00 이후부터</span>)}</>)}   {/* ← [2026-08-27] 당일 건 포함 */}
            {b.returned_at && row('반납 확인', `${fmtDueShort(b.returned_at.slice(0, 10))} ${fmtTimeShort(b.returned_at)}`)}
            {b.memo && row('메모', <span style={{ fontWeight: 400 }}>{b.memo}</span>)}
            {b.period_changed_at && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#8B95A1' }}>
                {fmtDueShort(b.period_changed_at.slice(0, 10))} {fmtTimeShort(b.period_changed_at)} 기간 변경됨
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: 8, marginTop: 8 }}>{actions}</div>
        </div>
      </div>
    </ModalPortal>
  )
}
