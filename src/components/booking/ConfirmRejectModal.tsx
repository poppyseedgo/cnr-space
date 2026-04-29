import { useState, useEffect } from 'react'
import { ShieldX } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { fmtTSDateFull, fmtTSRangeFull } from '../../utils/time'
import type { Booking, Room } from '../../types'
import { Button } from '../common/Button'
import { ModalCloseButton } from '../common/ModalCloseButton'

/**
 * ConfirmRejectModal — 예약 승인 거절 다이얼로그
 *
 * 설계 원칙:
 *  · 에메랄드 룸 승인 요청 거절 시 사유 입력 + 실수 방지 장벽
 *  · 기본 focus = "돌아가기" 버튼 (Enter 연타로 실수 방지)
 *  · ESC 키로 닫기
 *  · 사유 입력은 선택 — 빈값 그대로 onConfirm에 전달 (App/api에서 기본값 처리)
 *  · 비동기 처리 중 버튼 비활성화 (중복 클릭 방지)
 *
 * 적용 범위:
 *  · DetailModal 관리자 권한 "거절" 버튼 (기존 인라인 UI 대체)
 *
 * ✅ 변경 이력
 *  - [2026-04-29 신규] DetailModal 인라인 거절 flow를 공통 다이얼로그로 추출
 */

interface ConfirmRejectModalProps {
  booking:   Booking
  room?:     Room
  /** 사유 문자열 전달 — 빈값 허용, App에서 기본값 처리 */
  onConfirm: (reason: string) => Promise<void> | void
  onClose:   () => void
}

export function ConfirmRejectModal({ booking: b, room: r, onConfirm, onClose }: ConfirmRejectModalProps) {
  const { isMobile } = useBreakpoint()
  const [reason, setReason]   = useState('')
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
      await onConfirm(reason)
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
              background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <ShieldX size={18} strokeWidth={2} color="#DC2626" />
            </div>
            <div style={{
              fontSize: isMobile ? 16 : 17,
              fontWeight: 600,
              color: '#111111',
              lineHeight: 1.4,
            }}>
              예약 승인 거절
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

        {/* 사유 입력 */}
        <label style={{
          fontSize: 11, fontWeight: 600, color: '#94A3B8',
          display: 'block', marginBottom: 6,
        }}>
          거절 사유 (신청자에게 전달됩니다)
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="거절 사유를 입력하세요 (선택)"
          disabled={loading}
          style={{
            width: '100%',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />

        {/* 안내 문구 */}
        <div style={{
          fontSize: 12, color: '#64748B', lineHeight: 1.6, marginBottom: 4,
        }}>
          거절 시 예약이 즉시 취소되며 신청자에게 알림이 발송됩니다.
        </div>
      </div>

      {/* 버튼 영역 — 기본 focus = "돌아가기" (실수 방지) */}
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
          돌아가기
        </Button>
        <Button
          variant="danger"
          flex
          onClick={handleConfirm}
          loading={loading}
        >
          {loading ? '처리 중' : '거절 확정'}
        </Button>
      </div>
    </div>
  )
}
