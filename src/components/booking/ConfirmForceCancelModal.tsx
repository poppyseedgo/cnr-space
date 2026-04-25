import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Booking } from '../../types'
import { Button } from '../common/Button'

/**
 * ConfirmForceCancelModal — 관리자 강제 취소 확인 다이얼로그
 *
 * ✅ 변경 이력
 *  - [2026-04-24 P8-B 신규] AdminPage 인라인 모달을 공통 컴포넌트로 추출
 *    · 추출 원본: AdminPage.tsx L1139~1150 (AdminBookings 내부)
 *    · 동기: DetailModal의 강제취소 버튼이 하드코딩 사유('관리자 강제취소')로
 *           바로 실행되는 버그 해결. 모든 강제취소 경로가 사유 입력 다이얼로그
 *           경유하도록 UX 통일.
 *    · UI: AdminPage 원본 그대로 복사 (Figma 확정 디자인 없음, 기존 UX 유지)
 *
 * 설계 원칙 (ConfirmCancelModal과 동일):
 *  · 파괴적 액션(예약 강제취소)에 대한 실수 방지 장벽
 *  · 기본 focus = "돌아가기" 버튼 (Enter 연타로 실수 방지)
 *  · ESC 키로 취소 (닫기)
 *  · 비동기 처리 중 버튼 비활성화 (중복 클릭 방지)
 *  · 취소 사유는 선택 입력 — 빈값 제출 시 기본값 '관리자 강제 취소' 적용
 *
 * 적용 범위:
 *  · AdminPage 예약 관리 탭의 "강제 취소" 버튼
 *  · DetailModal 관리자 권한 "강제취소" 버튼
 */

interface ConfirmForceCancelModalProps {
  booking:   Booking
  /** 모달에서 받은 사유를 인자로 전달. 빈 문자열이면 내부에서 기본값 치환 */
  onConfirm: (reason: string) => Promise<void> | void
  onClose:   () => void
}

export function ConfirmForceCancelModal({ booking: b, onConfirm, onClose }: ConfirmForceCancelModalProps) {
  const [reason, setReason]   = useState('')
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
  //   onConfirm은 App.tsx의 adminForceCancelBooking을 래핑한 것.
  //   성공 시 App 헬퍼 내부에서 setModal(null) 호출 → 자동 unmount.
  //   실패 시 에러 복구를 위해 loading=false로 복원.
  const handleConfirm = async () => {
    if (loading) return
    setLoading(true)
    try {
      // 빈 문자열이면 AdminPage 원본과 동일한 기본값 적용
      await onConfirm(reason || '관리자 강제 취소')
    } catch {
      setLoading(false)
    }
  }

  // ← AdminPage 원본 인라인 모달 UI 1:1 복사
  //   원본 위치: AdminPage.tsx L1139~1150 (삭제 예정)
  return (
    <div
      className="anm"
      style={{
        background: '#fff',
        borderRadius: 16,
        width: '100%',
        maxWidth: 400,
        padding: '24px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: '#111',
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <AlertTriangle size={15} strokeWidth={1.8} />
        예약 강제 취소
      </div>
      <div style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
        "{b.title}" — {b.user}
      </div>
      <label
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#94A3B8',
          display: 'block',
          marginBottom: 6,
        }}
      >
        취소 사유
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="취소 사유를 입력하세요 (선택)"
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
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
          loading={loading}
          onClick={handleConfirm}
        >
          강제 취소
        </Button>
      </div>
    </div>
  )
}
