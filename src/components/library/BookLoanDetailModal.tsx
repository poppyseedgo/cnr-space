/**
 * BookLoanDetailModal — 대여 이력 상세 (공용)
 *
 * [2026-07-21] 신설
 *
 * 왜 만들었나
 * ─────────────────────────────────────────────────────────────────────────────
 *   "대여 한 건" 을 열어볼 화면이 어디에도 없었다. 그래서 세 곳이 각각 깨져
 *   있었는데, 증상이 달라 별개 버그처럼 보였을 뿐 원인은 하나다.
 *
 *     ① 알림 클릭 → 빈 화면
 *        NotificationBell 은 booking_id 를 회의실 예약으로만 해석해
 *        bookings.find() 로 찾았다. 도서 알림의 booking_id 는
 *        book_checkouts.id 라 목록에 없고, find 가 undefined 를 반환해
 *        회의실 상세 모달이 data=null 로 열렸다 → 빈 화면.
 *     ② 마이페이지 카드 클릭 안 됨   — onClick 자체가 없었다
 *     ③ 어드민 대여 이력 행 클릭 안 됨 — DataTable 은 onRowClick 을 지원하는데
 *        도서 탭들이 넘기지 않았다
 *
 *   ②③은 "열 화면이 없으니 클릭도 안 붙인" 것이고, ①은 "열 화면이 없어
 *   엉뚱한 화면으로 보낸" 것이다. 이 모달이 생기면 셋 다 같은 목적지를 갖는다.
 *
 * 설계
 * ─────────────────────────────────────────────────────────────────────────────
 *   · 표시 규칙은 전부 utils/bookLoan.ts 에 위임한다. 상태 라벨·연체 판정·
 *     제재 계산을 여기서 다시 쓰면 같은 대여가 화면마다 다르게 보인다.
 *   · 관리자 액션(반납/분실)은 prop 으로 주입받는다. 모달이 직접 RPC 를
 *     호출하면 호출부의 목록 갱신·토스트와 어긋난다.
 *   · loan=null + loading=false 는 "찾을 수 없음" 상태다. 알림 클릭 경로에서
 *     삭제된 건이나 권한 없는 건을 열 수 있으므로 빈 화면 대신 사유를 보여준다.
 *     (이 모달이 고치려는 버그가 정확히 '빈 화면' 이므로 필수 상태다)
 */

import { useState, useRef } from 'react'
import type { AdminBookLoan, MyBookLoan } from '../../types'
import {
  loanDisplayStatus, loanStatusStyle, daysUntilDue, ddayLabel,
  fmtLoanDate, fmtDueFullKo, fmtDueShortKo, kstDateStr, addDaysKst,
  penaltyOverdueDays, daysUntilPenalty, PENALTY_TIER_DAYS,
} from '../../utils/bookLoan'
import { DatePickerPopup } from '../common/DatePickerPopup'

// 마이페이지는 MyBookLoan, 어드민은 AdminBookLoan(= MyBookLoan + user_id)을 넘긴다.
export type DetailLoan = MyBookLoan | Partial<AdminBookLoan>

interface Props {
  loan:        DetailLoan | null
  /** 조회 중 (알림 클릭 경로에서만 true 가 된다) */
  loading?:    boolean
  /** 대여자 표시명. 어드민에서만 넘긴다 — 마이페이지는 본인이라 불필요 */
  borrowerName?: string | null
  isAdmin?:    boolean
  onClose:     () => void
  /** 관리자 반납 처리. 없으면 버튼을 렌더하지 않는다 */
  onReturn?:   (loan: DetailLoan) => void
  onLost?:     (loan: DetailLoan) => void
  /** ← [2026-08-13] 관리자 기한 변경 (admin_set_book_due). 없으면 버튼 미렌더.
   *   성공 여부를 반환해야 한다 — 실패 시 에디터를 닫지 않고 재시도하게 둔다. */
  onChangeDue?: (loan: DetailLoan, dueOn: string) => Promise<boolean>
  /** 행의 '기한 변경' 버튼으로 진입 시 에디터를 처음부터 펼친다 */
  dueEditorInitialOpen?: boolean
  /** 기한 달력 비활성 판정 (같은 도서의 다른 대여/예약 구간 — 자기 자신 제외는 호출부 책임) */
  isDueDateDisabled?: (dateStr: string) => boolean
}

const SHEET_W = 480

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 16,
}
const SHEET: React.CSSProperties = {
  background: '#fff', borderRadius: 20, width: '100%', maxWidth: SHEET_W,
  maxHeight: '86vh', display: 'flex', flexDirection: 'column',
  overflow: 'hidden', boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
}
const ROW: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12,
  padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 13,
}
const LABEL: React.CSSProperties = { color: '#94A3B8', flexShrink: 0 }
const VALUE: React.CSSProperties = { color: '#111', fontWeight: 500, textAlign: 'right' }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={ROW}>
      <span style={LABEL}>{label}</span>
      <span style={VALUE}>{children}</span>
    </div>
  )
}

export function BookLoanDetailModal({
  loan, loading = false, borrowerName = null, isAdmin = false,
  onClose, onReturn, onLost,
  onChangeDue, dueEditorInitialOpen = false, isDueDateDisabled,
}: Props) {

  // ── [2026-08-13] 기한 변경 에디터 ──────────────────────────────────────
  //   훅은 조기 return(로딩/찾을 수 없음)보다 앞에 있어야 한다 — 렌더 간
  //   훅 개수가 달라지면 React 가 터진다.
  const [dueOpen,   setDueOpen]   = useState(dueEditorInitialOpen)
  const [newDue,    setNewDue]    = useState('')
  const [duePickerOpen, setDuePickerOpen] = useState(false)
  const [dueSaving, setDueSaving] = useState(false)
  const dueAnchorRef = useRef<HTMLButtonElement>(null)

  // ── 찾을 수 없음 / 로딩 ────────────────────────────────────────────────
  //   알림에서 열었는데 대여 기록이 삭제됐거나 권한이 없는 경우다.
  //   아무것도 안 그리면 정확히 기존 버그(빈 화면)가 재현되므로 반드시 문구를 낸다.
  if (loading || !loan) {
    return (
      <div style={OVERLAY} onClick={onClose}>
        <div style={{ ...SHEET, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: loading ? '#64748B' : '#111', fontWeight: 600 }}>
              {loading ? '대여 정보를 불러오는 중…' : '대여 정보를 찾을 수 없습니다'}
            </div>
            {!loading && (
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8, lineHeight: 1.7 }}>
                기록이 삭제되었거나 조회 권한이 없습니다.
                <br />
                마이페이지의 대여 목록에서 다시 확인해 주세요.
              </div>
            )}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid #F1F5F9' }}>
            <button
              onClick={onClose}
              style={{
                width: '100%', height: 48, borderRadius: 14,
                background: '#F1F5F9', color: '#374151', fontSize: 14, fontWeight: 600,
              }}>
              닫기
            </button>
          </div>
        </div>
      </div>
    )
  }

  const dueAt = loan.due_at as string
  const st    = loanStatusStyle(loanDisplayStatus(loan as MyBookLoan))
  const dud   = daysUntilDue(dueAt)
  const live  = loan.status === 'active' || loan.status === 'overdue'

  // 제재 정보 — 면제 건은 계산 자체를 하지 않는다(화면과 서버 판정 일치)
  const exempt = !!loan.penalty_exempt
  const over   = exempt ? null : penaltyOverdueDays(dueAt, loan.extension_count ?? 0)
  const left   = exempt ? null : daysUntilPenalty(dueAt, loan.extension_count ?? 0)

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>

        {/* ── 헤더 ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '18px 20px 14px', borderBottom: '1px solid #F1F5F9',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          {loan.book?.cover_url && (
            <img
              src={loan.book.cover_url} alt=""
              style={{
                width: 52, height: 74, objectFit: 'cover', borderRadius: 6,
                flexShrink: 0, background: '#F1F5F9',
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111', lineHeight: 1.4 }}>
              {loan.book?.title ?? '(제목 없음)'}
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
              {[loan.book?.author, loan.book?.publisher].filter(Boolean).join(' · ') || '—'}
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{
                display: 'inline-block', padding: '3px 9px', borderRadius: 6,
                fontSize: 11, fontWeight: 700,
                background: st.bg, color: st.color,
              }}>
                {st.label}
              </span>
              {live && (
                <span style={{
                  marginLeft: 6, fontSize: 12, fontWeight: 600,
                  color: dud < 0 ? '#DC2626' : '#64748B',
                }}>
                  {ddayLabel(dueAt)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── 본문 ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '4px 20px 16px', overflowY: 'auto' }}>
          {borrowerName && <Row label="대여자">{borrowerName}</Row>}
          <Row label="대여일">{fmtLoanDate(loan.checkout_at as string)}</Row>
          <Row label="반납기한">{fmtDueFullKo(dueAt)}</Row>

          {/* ── [2026-08-13] 관리자 기한 변경 — 인라인 에디터 (미리보기 확정안) ──
              연장/단축 모두, 횟수 제한 없음. 사용자 셀프 연장 1회권은 소모되지
              않는다(서버가 extension_count 무변경). 겹침·범위의 최종 판정은 서버. */}
          {isAdmin && live && onChangeDue && dueOpen && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 10,
              border: '1px solid #E2E8F0', background: '#F8FAFC',
            }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>새 반납기한</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  ref={dueAnchorRef}
                  type="button"
                  onClick={() => setDuePickerOpen(v => !v)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#fff', border: '1px solid #CBD5E1', borderRadius: 10,
                    padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 500, color: newDue ? '#111' : '#94A3B8',
                  }}>
                  {newDue ? fmtDueShortKo(newDue) : '날짜 선택'}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="#94A3B8" strokeWidth="2" aria-hidden>
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                </button>
                {duePickerOpen && (
                  <DatePickerPopup
                    value={newDue || kstDateStr(dueAt)}
                    onChange={next => { setNewDue(next); setDuePickerOpen(false) }}
                    onClose={() => setDuePickerOpen(false)}
                    anchorRef={dueAnchorRef}
                    min={addDaysKst(kstDateStr(loan.checkout_at as string), 1)}
                    max={addDaysKst(kstDateStr(Date.now()), 365)}
                    isDateDisabled={isDueDateDisabled}
                  />
                )}
                <button
                  disabled={!newDue || dueSaving}
                  onClick={async () => {
                    if (!newDue) return
                    setDueSaving(true)
                    try {
                      const ok = await onChangeDue(loan, newDue)
                      if (ok) { setDueOpen(false); setNewDue('') }
                    } finally { setDueSaving(false) }
                  }}
                  style={{
                    flexShrink: 0, padding: '8px 16px', borderRadius: 10,
                    background: (!newDue || dueSaving) ? '#CBD5E1' : '#111',
                    color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: (!newDue || dueSaving) ? 'default' : 'pointer',
                  }}>
                  {dueSaving ? '적용 중' : '적용'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, lineHeight: 1.6 }}>
                연장 횟수 제한 없음 · 사용자 셀프 연장 1회권은 소모되지 않습니다
              </div>
            </div>
          )}
          <Row label="연장">
            {(loan.extension_count ?? 0) > 0 ? '1회 사용' : '미사용'}
          </Row>
          {loan.returned_at && (
            <Row label="반납일">{fmtLoanDate(loan.returned_at)}</Row>
          )}
          {loan.notes && <Row label="메모">{loan.notes}</Row>}

          {/* ── 제재 정보 ────────────────────────────────────────────────
              연체(due_at 기준)와 제재(effective_due 기준)는 시점이 다르다.
              대여 상세는 그 차이를 설명하기 가장 좋은 자리다. */}
          {live && exempt && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 10,
              background: '#F8FAFC', border: '1px solid #E2E8F0',
              fontSize: 12, color: '#64748B', lineHeight: 1.7,
            }}>
              이 대여는 <b style={{ color: '#475569' }}>대여 제한 면제</b> 대상입니다.
              반납이 늦어져도 제재가 적용되지 않습니다.
            </div>
          )}
          {live && !exempt && over !== null && left !== null && (
            over >= PENALTY_TIER_DAYS.warn ? (
              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 10,
                background: '#FEF2F2', border: '1px solid #FECACA',
                fontSize: 12, color: '#B91C1C', lineHeight: 1.7,
              }}>
                기한을 <b>{over}일</b> 초과해 대여가 제한된 상태입니다.
                반납 시 제재 등급이 확정됩니다.
              </div>
            ) : dud < 0 ? (
              <div style={{
                marginTop: 14, padding: '10px 12px', borderRadius: 10,
                background: '#FFFBEB', border: '1px solid #FDE68A',
                fontSize: 12, color: '#B45309', lineHeight: 1.7,
              }}>
                연체 중입니다. <b>{left}일</b> 뒤부터 대여가 제한됩니다.
                <br />
                <span style={{ color: '#A16207' }}>
                  대여 기간(7일)과 연장 가능 기간(7일)을 합한 시점부터 제재가 시작됩니다.
                </span>
              </div>
            ) : null
          )}
        </div>

        {/* ── 액션 ─────────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0, borderTop: '1px solid #F1F5F9',
          display: 'flex', gap: 8, padding: 8,
        }}>
          {isAdmin && live && onChangeDue && (
            <button
              onClick={() => setDueOpen(v => !v)}
              style={{
                flexShrink: 0, height: 48, padding: '0 16px', borderRadius: 14,
                background: dueOpen ? '#E0E7FF' : '#EEF2FF', color: '#4338CA',
                fontSize: 14, fontWeight: 600,
              }}>
              기한 변경
            </button>
          )}
          {isAdmin && live && onReturn && (
            <button
              onClick={() => onReturn(loan)}
              style={{
                flex: 1, height: 48, borderRadius: 14,
                background: '#111', color: '#fff', fontSize: 14, fontWeight: 600,
              }}>
              반납 처리
            </button>
          )}
          {isAdmin && live && onLost && (
            <button
              onClick={() => onLost(loan)}
              style={{
                flexShrink: 0, height: 48, padding: '0 16px', borderRadius: 14,
                background: '#FEF2F2', color: '#DC2626', fontSize: 14, fontWeight: 600,
              }}>
              분실
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              flex: isAdmin && live ? 0 : 1, flexShrink: 0,
              height: 48, padding: '0 20px', borderRadius: 14,
              background: '#F1F5F9', color: '#374151', fontSize: 14, fontWeight: 600,
            }}>
            닫기
          </button>
        </div>

      </div>
    </div>
  )
}
