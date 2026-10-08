/**
 * ConfirmDialog — 전역 공용 확인 다이얼로그
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — CTA 확인 UX 전수 검사 후속.
 *      파편화의 근본 원인이 "공용 확인 컴포넌트 부재"(커스텀 4종 + native confirm
 *      10곳 각자 구현)였으므로, "확인만 필요한 자리"의 표준을 하나 세운다.
 *  - [2026-10-08 조직도 버그픽스] zIndex 1200 → 3000 — 조직도 카드 드로어(1250)·코드 패널(1250)·
 *      도서 폼 모달(2000) 등 zIndex 1200 이상 서피스 위에서 열면 확인 다이얼로그가 dim 뒤에 묻혀
 *      클릭 불가(상태 라벨 변경 불가의 근본 원인). 전역 공용 확인은 정의상 모든 서피스(모달·드로어
 *      1000~2000대)보다 위여야 하므로 전용 최상위 레이어 3000 으로 올린다.
 *      (DatePicker·드롭다운 등 일시 팝업 9000대는 그 위 유지 — 확인창과 동시 노출 없음)
 *
 * 📌 사용 원칙
 *    · 사용자 노출 화면의 불가역 액션 = 이 컴포넌트 (native confirm 금지 —
 *      모바일 시스템 다이얼로그는 브랜드 이탈 + 버튼명 커스텀 불가)
 *    · 관리자 화면 저빈도 액션 = native confirm 용인 (기존 10곳 점진 치환)
 *    · 사유 입력·프리뷰·2단계가 필요한 자리는 기존 전용 모달 유지
 *      (ConfirmCancelModal / ConfirmForceCancelModal / EmploymentStatusModal 등)
 */

import type { ReactNode } from 'react'
import { ModalPortal } from './ModalPortal'

interface ConfirmDialogProps {
  title:         string
  /** 본문 — 문자열 또는 노드. 파급(불가역·알림·제재 등)을 여기서 명시한다 */
  message:       ReactNode
  confirmLabel?: string
  cancelLabel?:  string
  /** danger=파괴적(빨강) / warn=주의(앰버) / neutral=중립(검정) */
  variant?:      'danger' | 'warn' | 'neutral'
  loading?:      boolean
  onConfirm:     () => void
  onClose:       () => void
}

const VARIANT = {
  danger:  { bg: '#DC2626', hover: '#B91C1C' },
  warn:    { bg: '#B45309', hover: '#92400E' },
  neutral: { bg: '#111111', hover: '#000000' },
}

export function ConfirmDialog({
  title, message, confirmLabel = '확인', cancelLabel = '취소',
  variant = 'neutral', loading = false, onConfirm, onClose,
}: ConfirmDialogProps) {
  const v = VARIANT[variant]
  return (
    <ModalPortal>
      <div
        onClick={() => { if (!loading) onClose() }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
          backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 3000, padding: 16,   // ← [2026-10-08] 1200 → 3000: 드로어(1250)·모달(2000) 위 확인 전용 최상위 레이어
        }}>
        <div
          className="anm"
          onClick={e => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 380,
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)', padding: '22px 24px 20px',
          }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 10 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.7, marginBottom: 18 }}>
            {message}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              disabled={loading}
              onClick={onClose}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#374151',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}>
              {cancelLabel}
            </button>
            <button
              className="btn"
              disabled={loading}
              onClick={onConfirm}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = v.hover }}
              onMouseLeave={e => { e.currentTarget.style.background = v.bg }}
              style={{
                flex: 1.4, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: v.bg, border: 'none', color: '#fff',
                cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
              }}>
              {loading ? '처리 중...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
