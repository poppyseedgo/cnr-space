import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { fmtTSDateFull, fmtTSRangeFull } from '../../utils/time'
import type { Booking, Room } from '../../types'
import { Button } from '../common/Button'
import { ModalCloseButton } from '../common/ModalCloseButton'

/**
 * ConfirmEarlyEndModal — 조기 반납 확인 다이얼로그
 *
 * 설계 원칙:
 *  · 진행 중 예약의 조기 반납 전 실수 방지 확인
 *  · 기본 focus = "닫기" 버튼 (Enter 연타로 실수 방지)
 *  · ESC 키로 취소 (닫기)
 *  · 확정 버튼 = 우측 + 검정 (primary action, 위험 없는 상태변경)
 *  · 비동기 처리 중 버튼 비활성화 (중복 클릭 방지)
 *
 * 적용 범위:
 *  · HomeView 소형카드 "조기반납" 버튼
 *
 * ✅ 변경 이력
 *  - [2026-04-29 신규] 조기반납 confirm dialog 도입 (즉시 실행 → 다이얼로그 경유로 변경)
 */

interface ConfirmEarlyEndModalProps {
  booking:   Booking
  room?:     Room
  onConfirm: () => Promise<void> | void
  onClose:   () => void
}

export function ConfirmEarlyEndModal({ booking: b, room: r, onConfirm, onClose }: ConfirmEarlyEndModalProps) {
  const { isMobile } = useBreakpoint()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loading])

  const handleConfirm = async () => {
    if (loading) return
    setLoading(true)
    try {
      await onConfirm()
    } catch {
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
              background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <LogOut size={18} strokeWidth={2} color="#D97706" />
            </div>
            <div style={{
              fontSize: isMobile ? 16 : 17,
              fontWeight: 600,
              color: '#111111',
              lineHeight: 1.4,
            }}>
              지금 조기 반납하시겠습니까?
            </div>
          </div>
          <ModalCloseButton onClick={onClose} disabled={loading} style={{ marginLeft: 8 }} />
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
          </div>
        </div>

        {/* 안내 문구 */}
        <div style={{
          fontSize: 12, color: '#64748B', lineHeight: 1.6, marginBottom: 4,
        }}>
          반납 즉시 회의실이 해제되며, 남은 시간은 다른 사람이 예약할 수 있습니다.
        </div>
      </div>

      {/* 버튼 영역 — 기본 focus = "닫기" (실수 방지) */}
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
          variant="primary"
          flex
          onClick={handleConfirm}
          loading={loading}
        >
          {loading ? '처리 중' : '조기 반납'}
        </Button>
      </div>
    </div>
  )
}
