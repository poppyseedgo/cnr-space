/**
 * BookDetailModal.tsx — 도서 상세 모달
 *
 * [2026-07-21] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 만드는가
 * ═══════════════════════════════════════════════════════════════════════════
 * 그리드 카드는 표지·제목·대여자·반납기한만 보여준다. 출판사·분류·ISBN·비고·
 * 입고일은 편집 모달을 열어야만 볼 수 있었고, 편집 모달은 관리자 전용이라
 * 일반 임직원은 도서 정보를 확인할 방법이 아예 없었다.
 * New Collection 슬라이더 카드는 정보가 더 적어(제목·저자뿐) 클릭 후 갈 곳이
 * 필요했다.
 *
 * → 조회 전용 상세를 한 벌 만들고, **그리드 카드와 슬라이더가 같은 모달을 연다.**
 *   두 곳에 각각 만들면 필드가 갈라진다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 액션은 만들지 않는다 — 기존 핸들러로 위임
 * ═══════════════════════════════════════════════════════════════════════════
 * 대여 등록/신청·반납·편집·삭제는 이미 LibraryPage 에 핸들러가 있고
 * 각각 RPC 를 경유한다. 이 모달은 콜백만 호출한다(상태 전이 로직 0).
 * 버튼 노출 조건도 BookGridCard 와 동일하게 맞췄다 —
 * 같은 도서인데 카드에서는 삭제가 보이고 상세에서는 안 보이면 안 된다.
 *   · 대여 등록/신청 : status === 'available'
 *   · 반납 처리      : status === 'borrowed' && checkout && isAdmin
 *   · 편집           : isAdmin
 *   · 삭제           : isAdmin && status === 'available'
 *                      (대여 이력이 남은 도서를 지우면 book_checkouts 가 고아가 된다)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 스타일
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 에 상세 모달 화면이 없다. 새 언어를 만들지 않고 bookModalShared 의
 * 토큰(BM/OVERLAY/SHEET/ModalHeader/Field)을 그대로 쓴다. 표지를 나란히 놓아야
 * 해서 시트 폭만 462 → 560 으로 넓혔다(그 외 값은 전부 기존 토큰).
 */

import { useEffect, useState } from 'react'
import { BM, OVERLAY, SHEET, ModalHeader, Field } from './bookModalShared'
import {
  LT, ListBadge, statusBadgeConfig, newBadgeLabel, pickCoverFit,
} from './libraryListShared'
import { fmtDueShortKo } from '../../utils/bookLoan'

// ═══════════════════════════════════════════════════════════════════════════
// 0. 입력 계약 — 이 모달이 실제로 읽는 필드만
// ═══════════════════════════════════════════════════════════════════════════

export interface DetailBook {
  id:          number
  title:       string
  author:      string | null
  publisher:   string | null
  isbn:        string | null
  cover_url:   string | null
  status:      'available' | 'borrowed' | 'maintenance' | 'lost'
  notes:       string | null
  acquired_at: string | null
  new_until:   string | null
}

export interface DetailCheckout {
  checkout_at: string
  due_at:      string
}

export interface DetailBorrower {
  name?: string | null
  dept?: string | null
}

export interface BookDetailModalProps {
  book:            DetailBook
  categoryName?:   string | null
  checkout?:       DetailCheckout | null
  borrower?:       DetailBorrower | null
  isAdmin:         boolean
  isOverdueStatus: boolean
  /** ← [2026-07-21] 연체 제재 차단 상태 (본인 기준). 카드 CTA 와 같은 규칙 */
  penaltyBlocked?: boolean
  penaltyReason?:  string | null
  onClose:    () => void
  onCheckout: () => void   // 관리자 = 대여 등록 / 일반 = 대여하기 (← [2026-07-21] 승인 폐지)
  onReturn:   () => void
  onEdit:     () => void
  onDelete:   () => void
}

const SHEET_W  = 560
const COVER_W  = 168

/** 'YYYY-MM-DD' → '2026년 7월 3일'. Date 파싱 없이 문자열만 다룬다(KST 밀림 방지). */
function fmtDateKo(d: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '')
  return m ? `${m[1]}년 ${+m[2]}월 ${+m[3]}일` : '-'
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 본체
// ═══════════════════════════════════════════════════════════════════════════

export function BookDetailModal({
  book, categoryName, checkout, borrower, isAdmin, isOverdueStatus,
  penaltyBlocked = false, penaltyReason = null,
  onClose, onCheckout, onReturn, onEdit, onDelete,
}: BookDetailModalProps) {
  const [imgErr, setImgErr]     = useState(false)
  const [coverFit, setCoverFit] = useState<'cover' | 'contain'>('contain')

  // ESC 로 닫기 — 다른 모달들과 동작을 맞춘다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const displayStatus = (isOverdueStatus ? 'overdue' : book.status) as
    DetailBook['status'] | 'overdue'
  const badge  = statusBadgeConfig(displayStatus)
  const newLbl = newBadgeLabel(book)

  const canCheckout = book.status === 'available'
  const canReturn   = book.status === 'borrowed' && !!checkout && isAdmin
  const canDelete   = isAdmin && book.status === 'available'

  return (
    <div style={OVERLAY} onClick={onClose} role="presentation">
      <div
        style={{ ...SHEET, maxWidth: SHEET_W }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${book.title} 상세`}>

        <ModalHeader title="도서 상세" onClose={onClose} />

        {/* ── 본문 (스크롤 영역) ─────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 16px' }}>

          {/* 표지 + 표제 */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', paddingBottom: 20 }}>
            <div style={{
              width: COVER_W, flexShrink: 0, aspectRatio: LT.coverRatio,
              background: LT.coverBg, overflow: 'hidden',
            }}>
              {book.cover_url && !imgErr ? (
                <img
                  src={book.cover_url}
                  alt=""
                  onError={() => setImgErr(true)}
                  onLoad={e => {
                    const el = e.currentTarget
                    if (el.naturalWidth && el.naturalHeight) {
                      setCoverFit(pickCoverFit(el.naturalWidth / el.naturalHeight))
                    }
                  }}
                  style={{ width: '100%', height: '100%', objectFit: coverFit, display: 'block' }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: '0 12px',
                  boxSizing: 'border-box', fontSize: 13, color: '#A1A4AF',
                  textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.5,
                }}>
                  {book.title}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <ListBadge bg={badge.bg}>{badge.label}</ListBadge>
                {newLbl && <ListBadge bg={LT.badgeNew}>{newLbl}</ListBadge>}
              </div>
              <div style={{
                fontSize: 22, fontWeight: 500, color: BM.valueColor,
                lineHeight: 1.35, wordBreak: 'keep-all',
              }}>
                {book.title}
              </div>
              {book.author && (
                <div style={{ fontSize: 15, color: LT.metaDept, lineHeight: 1.5 }}>
                  {book.author}
                </div>
              )}
            </div>
          </div>

          {/* 서지 정보 */}
          <DetailRow label="출판사" value={book.publisher || '-'} />
          <DetailRow label="분류"   value={categoryName || '미분류'} />
          <DetailRow label="입고일" value={fmtDateKo(book.acquired_at)} />
          <DetailRow label="ISBN"   value={book.isbn || '-'} />

          {/* 대여 정보 — 대여 중일 때만.
              대여자 표시는 그리드 카드와 같은 기준(live users 조회 결과)을 그대로 받는다. */}
          {book.status === 'borrowed' && checkout && (
            <>
              <DetailRow
                label="대여자"
                value={`${borrower?.name ?? '알 수 없음'}${borrower?.dept ? `  ${borrower.dept}` : ''}`}
              />
              <DetailRow label="대여일" value={fmtDateKo(checkout.checkout_at?.slice(0, 10) ?? null)} />
              <DetailRow
                label="반납기한"
                value={`${fmtDueShortKo(checkout.due_at)} 이내`}
                valueColor={isOverdueStatus ? LT.metaOverdue : undefined}
              />
            </>
          )}

          {book.notes && (
            <Field label="비고" align="flex-start">
              <span style={{
                fontSize: 15, color: BM.valueColor, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {book.notes}
              </span>
            </Field>
          )}
        </div>

        {/* ← [2026-07-21] 제재 배너. 버튼만 회색이면 "왜 안 되지?" 가 되므로
            모달에서는 사유를 문장으로 알려준다. */}
        {penaltyBlocked && penaltyReason && (
          <div style={{
            flexShrink: 0, margin: '0 8px 8px', padding: '10px 12px',
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            fontSize: 12, color: '#B91C1C', lineHeight: 1.6,
          }}>
            {penaltyReason}
          </div>
        )}

        {/* ── 액션 ────────────────────────────────────────────────────────
            ModalFooter(취소+확인 2버튼 고정)는 관리자 4버튼 구성에 맞지 않아
            전용 행을 쓴다. 버튼 규격(높이 56 / radius 16)은 동일하게 맞췄다. */}
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${BM.fieldBorder}`,
          display: 'flex', gap: 8, padding: 8, flexWrap: 'wrap',
        }}>
          {canDelete && (
            <ActionBtn onClick={onDelete} bg="#FEF2F2" color="#DC2626" grow={0}>삭제</ActionBtn>
          )}
          {isAdmin && (
            <ActionBtn onClick={onEdit} bg={BM.btnCancelBg} color={BM.btnCancelTx} grow={0}>편집</ActionBtn>
          )}
          {/* ← [2026-07-21] 제재 중이면 비활성 + 사유 노출.
              모달은 카드보다 공간이 넉넉하므로 title 대신 아래 배너로도 알린다. */}
          {canCheckout && (
            <ActionBtn
              onClick={penaltyBlocked ? () => {} : onCheckout}
              bg={penaltyBlocked ? '#E5E7EB' : BM.btnPrimaryBg}
              color={penaltyBlocked ? '#9CA3AF' : '#fff'}>
              {penaltyBlocked ? '대여 제한' : (isAdmin ? '대여 등록' : '대여하기')}
            </ActionBtn>
          )}
          {canReturn && (
            <ActionBtn onClick={onReturn} bg={LT.badgeBusy} color={LT.black}>반납 처리</ActionBtn>
          )}
          {/* 실행 가능한 액션이 하나도 없으면(예: 일반 사용자 + 대여중) 닫기만 남긴다 */}
          {!canCheckout && !canReturn && !isAdmin && (
            <ActionBtn onClick={onClose} bg={BM.btnCancelBg} color={BM.btnCancelTx}>닫기</ActionBtn>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 조각
// ═══════════════════════════════════════════════════════════════════════════

function DetailRow({
  label, value, valueColor,
}: { label: string; value: string; valueColor?: string }) {
  return (
    <Field label={label}>
      <span style={{
        fontSize: 15, color: valueColor ?? BM.valueColor, lineHeight: 1.5,
        wordBreak: 'break-word',
      }}>
        {value}
      </span>
    </Field>
  )
}

function ActionBtn({
  onClick, bg, color, grow = 1, children,
}: {
  onClick: () => void
  bg: string
  color: string
  grow?: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: grow ? '1 1 120px' : '0 0 auto',
        minWidth: grow ? 120 : 88,
        height: 56, borderRadius: 16, border: 'none',
        background: bg, color,
        fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      }}>
      {children}
    </button>
  )
}
