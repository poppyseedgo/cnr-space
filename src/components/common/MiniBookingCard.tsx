import type { Booking, Room } from '../../types'
import { BookingStatusBadge } from './BookingStatusBadge'
import { MetaBadge } from './MetaBadge'
import { tsDate, tsMin, fmtTSRangeFull, todayStr, nowMinutes } from '../../utils/time'

/**
 * MiniBookingCard — 공통 소형 예약 카드 컴포넌트
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 목적 (v2.1 신규)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HomeView, MyPage-MyBookingWeeklyView, BookingListTable(카드 뷰)에서
 * 동일하게 사용되는 "오늘 내 예약" 소형 카드의 단일 진실 원천.
 *
 * 기존 문제:
 *  · HomeView, MyBookingWeeklyView 각각 별도로 cardState 판정 로직 구현
 *  · v2.1 설계 변경 시 3곳 모두 수정 필요 → 불일치 위험
 *
 * v2.1 해결:
 *  · MiniBookingCard에 cardState 로직 통합
 *  · 3개 사용처는 데이터만 전달, 렌더링 위임
 *  · cardState 판정 규칙 변경 시 이 파일만 수정
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * v2.1 cardState 판정 규칙 (DB 매트릭스)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DB 규칙:
 *  · User/Admin 취소: status='cancelled' + autoCancelled=false + cancelledBy='user'/'admin'
 *  · Admin 거절:      status='rejected'
 *  · 기한초과(cron):  status='pending'   + autoCancelled=true  + cancelledBy='system'
 *  · 노쇼(cron):      status='confirmed' + autoCancelled=true  + cancelledBy='system' + !checkedIn
 *
 * cardState 10개 (배타성 보장):
 *  · rejected       — 거절됨
 *  · adminCancel    — 관리자 강제취소
 *  · userCancel     — 사용자 본인 취소
 *  · pendingExpired — 기한초과 취소
 *  · noshow         — 노쇼
 *  · earlyEnded     — 조기반납
 *  · using          — 사용 중 (체크인 완료 + 진행 중)
 *  · done           — 종료 (체크인 후 종료 또는 과거)
 *  · checkin        — 체크인 가능 (진행 중 미체크인)
 *  · pending        — 승인 대기 (에메랄드)
 *  · soon           — 곧 시작 (10분 이내)
 *  · waiting        — 대기 중 (기본값)
 *
 * 설계 문서: 예약상태관리_설계문서_v2.1.md
 */

export type CardState =
  | 'rejected' | 'adminCancel' | 'userCancel' | 'pendingExpired' | 'noshow'
  | 'earlyEnded' | 'using' | 'done' | 'checkin' | 'pending' | 'soon' | 'waiting'

// ─── cardState 판정 (v2.1) ───────────────────────────────────────────────────
export function judgeCardState(b: Booking, now: number, isToday: boolean): CardState {
  const sm       = tsMin(b.start_at)
  const em       = tsMin(b.end_at)
  const isActive = isToday && sm <= now && now < em
                   && b.status === 'confirmed'
                   && !b.autoCancelled
  const isPast   = em < now
  const minsUntil = sm - now
  const isSoon   = minsUntil > 0 && minsUntil <= 10

  // 배타성 보장 순서: 취소류 먼저 → 정상 상태
  if (b.status === 'rejected')                                                    return 'rejected'
  if (b.status === 'cancelled' && b.cancelledBy === 'admin')                      return 'adminCancel'
  if (b.status === 'cancelled' && b.cancelledBy === 'user')                       return 'userCancel'
  if (b.status === 'pending'   && b.autoCancelled && b.cancelledBy === 'system')  return 'pendingExpired'
  if (b.status === 'confirmed' && b.autoCancelled && b.cancelledBy === 'system'
      && !b.checkedIn && !b.earlyEnded)                                           return 'noshow'
  if (b.earlyEnded)                                                               return 'earlyEnded'
  if (b.checkedIn && isActive)                                                    return 'using'
  if (b.checkedIn)                                                                return 'done'
  if (isActive)                                                                   return 'checkin'
  if (isPast)                                                                     return 'done'
  if (b.status === 'pending')                                                     return 'pending'
  if (isSoon)                                                                     return 'soon'
  return 'waiting'
}

// ─── cardState별 버튼 스타일 맵 ───────────────────────────────────────────────
type ButtonStyle = {
  label: string | null
  btnBg: string
  btnColor: string
  disabled: boolean
  showBtn: boolean
}

function getButtonStyle(cs: CardState): ButtonStyle {
  const MAP: Record<CardState, ButtonStyle> = {
    waiting:        { label: '체크인 대기', btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: true },
    soon:           { label: '체크인 대기', btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: true },
    pending:        { label: '승인 대기',   btnBg: '#FEF3C7', btnColor: '#92400E', disabled: true,  showBtn: true },
    checkin:        { label: '체크인',      btnBg: '#16A34A', btnColor: '#fff',    disabled: false, showBtn: true },
    using:          { label: '조기반납',    btnBg: '#111111', btnColor: '#fff',    disabled: false, showBtn: true },
    noshow:         { label: null,          btnBg: '',        btnColor: '',        disabled: true,  showBtn: false },
    pendingExpired: { label: null,          btnBg: '',        btnColor: '',        disabled: true,  showBtn: false },
    done:           { label: '종료',        btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: true },
    earlyEnded:     { label: '반납됨',      btnBg: '#DBEAFE', btnColor: '#2563EB', disabled: true,  showBtn: true },
    adminCancel:    { label: '강제취소',    btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: false },
    rejected:       { label: '거절됨',      btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: false },
    userCancel:     { label: '취소됨',      btnBg: '#F1F5F9', btnColor: '#94A3B8', disabled: true,  showBtn: true },
  }
  return MAP[cs]
}

// ─── opacity 판정 (취소/종료 상태에서 흐리게 표시) ───────────────────────────
function getOpacity(cs: CardState): number {
  const DIMMED: CardState[] = ['userCancel', 'adminCancel', 'rejected', 'pendingExpired', 'noshow']
  return DIMMED.includes(cs) ? 0.45 : 1
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface MiniBookingCardProps {
  booking:      Booking
  room?:        Room
  currentUser:  string
  size?:        'sm' | 'md'                   // sm: 스트립용(고정 크기), md: 리스트용(유연 크기)
  onClick?:     (b: Booking) => void
  onCheckIn?:   (id: string) => void
  onEarlyEnd?:  (id: string) => void
  onCancel?:    (id: string) => void
  isMobile?:    boolean
}

// ─── Component ───────────────────────────────────────────────────────────────
export function MiniBookingCard({
  booking: b,
  room: r,
  currentUser,
  size = 'sm',
  onClick,
  onCheckIn,
  onEarlyEnd,
  onCancel,
  isMobile = false,
}: MiniBookingCardProps) {
  const today   = todayStr()
  const now     = nowMinutes()
  const isToday = tsDate(b.start_at) === today

  const cs      = judgeCardState(b, now, isToday)
  const S       = getButtonStyle(cs)
  const opacity = getOpacity(cs)

  // 액션 연결
  const handleAction = () => {
    if (cs === 'checkin' && onCheckIn) onCheckIn(b.id)
    else if (cs === 'using' && onEarlyEnd) onEarlyEnd(b.id)
  }
  const isCancellable = (cs === 'waiting' || cs === 'soon' || cs === 'pending') && !!onCancel

  // 크기 스타일
  const dims = size === 'sm'
    ? { width: isMobile ? 150 : 170, height: isMobile ? 140 : 160 }
    : { width: '100%', minHeight: 160 }

  return (
    <div
      className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-3xl p-3"
      onClick={() => onClick && onClick(b)}
      style={{
        ...dims,
        flexShrink: 0,
        overflow: 'hidden',
        opacity,
        border: cs === 'pending' ? '1.5px solid #FCD34D' : 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* 상단: 메타 뱃지 + 제목 + 상태 뱃지 + 룸 + 시간 */}
      <div>
        {b.recurGroupId && (
          <span style={{ marginRight: 3, marginBottom: 3, display: 'inline-block' }}>
            <MetaBadge type="recurring" size="xs" />
          </span>
        )}
        {b.user !== currentUser && (
          <span style={{ marginBottom: 3, display: 'inline-block' }}>
            <MetaBadge type="guest" size="xs" />
          </span>
        )}
        <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-1 mb-1.5">
          {b.title}
        </div>
        <div style={{ marginBottom: 4 }}>
          <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} size="sm" currentUser={currentUser} />
        </div>
        <div className="text-[10px] text-slate-400">{r?.room_name ?? ''}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRangeFull(b.start_at, b.end_at)}</div>
      </div>

      {/* 하단: 액션 버튼 + 취소 버튼 */}
      <div className="flex gap-1.5 mt-2">
        {S.showBtn && (
          <button
            className="btn flex-1 text-[11px] font-semibold rounded-xl py-2"
            onClick={e => { e.stopPropagation(); handleAction() }}
            disabled={S.disabled}
            style={{
              background: S.btnBg, color: S.btnColor,
              cursor: S.disabled ? 'default' : 'pointer',
              minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {S.label}
          </button>
        )}
        {isCancellable && (
          <button
            className="btn text-[11px] font-semibold rounded-xl py-2 px-2.5 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
            style={{ background: '#F3F4F8' }}
            onClick={e => { e.stopPropagation(); onCancel!(b.id) }}
          >
            취소
          </button>
        )}
      </div>
    </div>
  )
}
