import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'
// ← [2026-04-21] 공통 X 아이콘
import { IconClose } from '../common/IconClose'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { fmtTSDateFull, fmtTSRangeFull } from '../../utils/time'
import type { Booking, Room } from '../../types'
import { Button } from '../common/Button'

/**
 * ConfirmCancelModal — 예약 취소 확인 다이얼로그
 *
 * 설계 원칙:
 *  · 파괴적 액션(예약 취소)에 대한 실수 방지 장벽
 *  · 기본 focus = "닫기" 버튼 (Enter 연타로 실수 방지)
 *  · ESC 키로 취소 (닫기)
 *  · 확정 버튼 = 우측 + 빨강 (위험 시각 표지)
 *  · 비동기 처리 중 버튼 비활성화 (중복 클릭 방지)
 *
 * 적용 범위:
 *  · DetailModal의 "예약 취소" 버튼 1곳
 *  · HomeView/MyPage 소형카드의 "취소" 버튼은 즉시 실행 유지 (정책 상 별도)
 *
 * ✅ 변경 이력
 *  - [2026-04-19 P2 v8 신규] 예약 취소 confirm dialog 도입
 */

interface ConfirmCancelModalProps {
  booking:   Booking
  room?:     Room
  onConfirm: () => Promise<void> | void
  onClose:   () => void
}

export function ConfirmCancelModal({ booking: b, room: r, onConfirm, onClose }: ConfirmCancelModalProps) {
  const { isMobile } = useBreakpoint()
  const [loading, setLoading] = useState(false)

  // ── 접근성: ESC 키로 닫기 ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  // ── 확인 클릭 핸들러 ─────────────────────────────────────────────
  //   onConfirm은 App.tsx의 cancelBooking을 래핑한 것.
  //   cancelBooking 내부에서 setModal(null) 호출하므로 이 모달은 자동 unmount됨.
  //   여기서는 중복 클릭 방지를 위한 loading 표시만 담당.
  const handleConfirm = async () => {
    if (loading) return
    setLoading(true)
    try {
      await onConfirm()
      // 성공/실패 모두 onConfirm 내부에서 setModal(null) 호출 → 컴포넌트 unmount됨
      // setLoading(false)는 필요 없음 (unmount됨)
    } catch {
      // 방어적: onConfirm에서 throw된 경우에도 모달이 닫혀있을 가능성 높음
      setLoading(false)
    }
  }

  return (
    <div className="anm" style={{
      background: '#fff',
      borderRadius: isMobile ? '20px 20px 0 0' : 16,
      width: '100%',
      maxWidth: isMobile ? '100%' : 400,
      boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignSelf: isMobile ? 'flex-end' : 'center',
      position: 'relative',
    }}>
      {/* 모바일 drag handle */}
      {isMobile && (
        <div style={{
          width: 36, height: 4, background: '#E2E8F0', borderRadius: 2,
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1,
        }} />
      )}

      {/* 본문 */}
      <div style={{ padding: isMobile ? '28px 20px 16px' : '24px 24px 16px' }}>
        {/* 헤더: 아이콘 + 제목 + 닫기 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <AlertTriangle size={18} strokeWidth={2} color="#DC2626" />
            </div>
            <div style={{
              fontSize: isMobile ? 16 : 17,
              fontWeight: 600,
              color: '#111111',
              lineHeight: 1.4,
            }}>
              정말 취소하시겠습니까?
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              width: 28, height: 28, borderRadius: '50%', background: '#F1F5F9',
              color: '#64748B', flexShrink: 0, marginLeft: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.4 : 1,
              border: 'none',
            }}
          >
            <IconClose size={20} />
          </button>
        </div>

        {/* 예약 요약 카드 */}
        <div style={{
          background: '#F8FAFC',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: '#111111',
            wordBreak: 'break-word', marginBottom: 6, lineHeight: 1.35,
          }}>
            {b.title}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.6 }}>
            <div>
              <span style={{ color: r?.color ?? '#64748B', fontWeight: 600 }}>
                {r?.room_name ?? '-'}
              </span>
            </div>
            <div>{fmtTSDateFull(b.start_at)}</div>
            <div>{fmtTSRangeFull(b.start_at, b.end_at)}</div>
            {(b.attendees?.length ?? 0) > 0 && (
              <div style={{ marginTop: 2 }}>참석자 {b.attendees!.length}명</div>
            )}
            {b.recurGroupId && (
              <div style={{ marginTop: 2, color: '#0F6E56' }}>
                반복 예약 · 이 회차만 취소됩니다
              </div>
            )}
          </div>
        </div>

        {/* 안내 문구 */}
        <div style={{
          fontSize: 12, color: '#64748B', lineHeight: 1.6, marginBottom: 4,
        }}>
          취소된 예약은 되돌릴 수 없으며, 참석자에게 취소 알림이 발송됩니다.
        </div>
      </div>

      {/* 버튼 영역 */}
      {/* 기본 focus = "닫기" 버튼 (Enter 연타 시 실수로 취소 확정되는 걸 막음) */}
      <div style={{
        display: 'flex', gap: 8,
        padding: isMobile ? '8px 20px 20px' : '8px 24px 20px',
      }}>
        <Button
          variant="ghost"
          flex
          onClick={onClose}
          disabled={loading}
          autoFocus
        >
          닫기
        </Button>
        <Button
          variant="danger"
          flex
          onClick={handleConfirm}
          loading={loading}
        >
          {loading ? '처리 중' : '취소 확정'}
        </Button>
      </div>
    </div>
  )
}
