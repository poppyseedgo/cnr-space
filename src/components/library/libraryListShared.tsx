/**
 * libraryListShared.tsx — 도서관 메인 리스트 UI 토큰 & 컴포넌트 (SSOT)
 *
 * [2026-07-20] 신규
 *
 * Figma: fMv9JLNlNybDBYUnJDCTrq
 *   · 73:831   Home list (전체 화면)
 *   · 73:834   Hero (로고 / CTA / 안내문 / 통계 / 검색)
 *   · 103:67   cate (좌측 장르 칩)
 *   · 82:53    Frame 2 (카드 그리드)
 *   · 83:336   카드 — 대여가능 (NEW 뱃지 있음)
 *   · 1334:566 카드 — 대여중 (NEW 뱃지 있음)
 *   · 1334:584 카드 — 대여중 (NEW 뱃지 없음)
 *   · 1328:426 카드 — 연체중
 *   · 1328:415 카드 — 대여가능 (뱃지 없음)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 이 파일에 모으는 이유
 * ═══════════════════════════════════════════════════════════════════════════
 * 기존 LibraryPage 는 헤더·필터·카드 스타일이 전부 인라인으로 흩어져 있어
 * Figma 가 바뀔 때마다 수정 지점을 찾기 어려웠다. 모달 쪽에서 이미
 * bookModalShared.tsx 로 토큰을 모은 패턴이 검증됐으므로 동일하게 간다.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Figma 대비 의도적 차이 (기능 보존 목적 — 임의 변경 아님)
 * ═══════════════════════════════════════════════════════════════════════════
 * 1) CTA 라벨
 *    Figma: 전부 "대여하기" / "반납하기"·"반납처리" 혼재
 *    구현:  권한·플로우에 맞춰 "대여 신청"(사용자) / "대여 등록"(관리자) /
 *           "반납 처리"(관리자) 로 통일.
 *    근거:  일반 사용자의 대여는 즉시 확정이 아니라 pending → 관리자 승인이다.
 *           "대여하기"로 표기하면 눌렀는데 대여가 안 된 것처럼 보인다.
 *           Figma 의 반납 라벨 2종은 같은 액션이라 하나로 정규화했다.
 *
 * 2) 반납일 문구
 *    Figma: "반납일  2026/7/20"
 *    구현:  "반납기한  7월 20일(월) 이내"
 *    근거:  [2026-07-20] 확정된 문구 정책 — 반납일은 시점이 아니라
 *           "대여일 기준 7일 이내"라는 기한이다. utils/bookLoan.ts 가 SSOT.
 *           카드 폭(234px)에 전문("...월요일 이내 반납하세요")은 들어가지 않아
 *           축약형(dueNoticeShort 계열)을 쓴다.
 *
 * 3) 관리자 편집/삭제
 *    Figma 에 없으나 기존 기능이라 제거할 수 없다.
 *    CTA 아래 12px 텍스트 버튼 행으로 최소 침습 배치.
 *
 * 4) 검색 아이콘
 *    Figma 원본 vector(24×24)를 export 받지 못해 동일 규격의 stroke SVG 로
 *    재현했다. 픽셀 단위 일치가 필요하면 원본 SVG 를 전달받아 교체할 것.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { fmtDueShortKo } from '../../utils/bookLoan'

// ═══════════════════════════════════════════════════════════════════════════
// 0. 카드 입력 계약 (최소 필드)
// ═══════════════════════════════════════════════════════════════════════════
//
// ← [2026-07-20] 왜 types/index.ts 의 Book/BookCheckout 을 그대로 안 쓰는가
//
//   LibraryPage.tsx 는 파일 상단에 Book / BookCheckout 을 **로컬로 다시 선언**해
//   쓰고 있다(전역 types/index.ts 와 필드가 다른 축소판). 같은 테이블에 대한
//   타입이 두 벌 존재하는 상태다.
//   여기서 전역 타입을 요구하면 LibraryPage 의 로컬 타입과 충돌하고,
//   그렇다고 로컬 타입에 맞추면 다른 호출부가 깨진다.
//
//   근본 처리: 카드가 **실제로 읽는 필드만** 구조적 타입으로 선언한다.
//   양쪽 선언 모두와 호환되고, 카드가 필요 없는 컬럼을 과다 조회하도록
//   강제하지도 않는다.
//
//   ※ 별건으로 LibraryPage 의 로컬 Book/BookCheckout 중복 선언은
//     types/index.ts 로 일원화하는 정리가 필요하다(이번 범위 밖).

/** 카드가 읽는 도서 필드 */
export interface CardBook {
  title:       string
  status:      'available' | 'borrowed' | 'maintenance' | 'lost'
  cover_url:   string | null
  acquired_at: string | null
}

/** 카드가 읽는 대여 필드 */
export interface CardCheckout {
  due_at: string
}

/** 카드가 읽는 대여자 필드 */
export interface CardBorrower {
  name?: string | null
  dept?: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Figma 토큰
// ═══════════════════════════════════════════════════════════════════════════

export const LT = {
  // ── 색 ────────────────────────────────────────────────────────────────
  ink:          '#1E1E1E',   // 제목·본문 (검정 아님에 주의)
  black:        '#000000',
  white:        '#FFFFFF',

  badgeNew:     '#78FF4F',   // "N월 신규 도서"
  badgeAvail:   '#ACF0FF',   // 대여가능
  badgeBusy:    '#E1FF4F',   // 대여중
  badgeOverdue: '#FF9496',   // 연체중

  metaBusy:     '#3DDA0E',   // 메타 "대여" 라벨
  metaOverdue:  '#FF2B2B',   // 메타 "연체" 라벨
  metaDept:     '#A1A4AF',   // 메타 부서

  statAvail:    '#1988FF',   // 통계 - 대여가능 수치
  statBusy:     '#FF676A',   // 통계 - 대여중 수치

  placeholder:  '#C0C0C0',   // 검색 placeholder
  underline:    '#111111',   // 검색 밑줄

  // ── 치수 ──────────────────────────────────────────────────────────────
  pageMax:      1400,
  pagePad:      24,
  heroRadius:   24,
  heroGap:      40,

  gnbW:         320,
  colGap:       24,   // GNB ↔ 그리드, 그리고 카드 간 gap
  cardW:        234,
  coverH:       280,

  cardGapFree:  16,   // 대여가능 카드 내부 gap (Figma 83:336)
  cardGapHeld:  12,   // 대여중/연체 카드 내부 gap (Figma 1334:566)

  dimmedCover:  0.3,  // 대여중/연체 표지 불투명도
} as const

const FONT_M = 500   // Pretendard Medium
const FONT_R = 400   // Pretendard Regular
const FONT_SB = 600  // Pretendard SemiBold

// ═══════════════════════════════════════════════════════════════════════════
// 2. 아이콘
// ═══════════════════════════════════════════════════════════════════════════

/** 검색 (24×24) — Figma 1328:395 재현 */
export function SearchIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <circle cx="10.5" cy="10.5" r="8" stroke="#111" strokeWidth="1.6" />
      <path d="M16.5 16.5 L21.8 21.8" stroke="#111" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * C&R BOOKS 로고 마크 — Figma 73:836
 *   책등 6개. 첫 번째만 15° 기울어져 있다(책이 기대어 선 모양).
 *   외부 이미지 없이 div 로 재현 (SVG 불필요).
 */
export function BooksLogoMark({ scale = 1 }: { scale?: number }) {
  const barW = 14 * scale
  const barH = 68 * scale
  return (
    <div style={{ display: 'flex', gap: 3 * scale, alignItems: 'center', flexShrink: 0 }}>
      <div style={{
        width: 30.834 * scale, height: 69.696 * scale,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <div style={{
          width: 13.561 * scale, height: 68.52 * scale,
          background: LT.black, transform: 'rotate(15deg)',
        }} />
      </div>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ width: barW, height: barH, background: LT.black, flexShrink: 0 }} />
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 뱃지 — Figma 1334:721 / 1334:723 (px8 py2, radius 0, 14px Regular)
// ═══════════════════════════════════════════════════════════════════════════

export function ListBadge({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '2px 8px', background: bg, color: LT.black,
      fontSize: 14, fontWeight: FONT_R, lineHeight: 1.5, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

/** 도서 상태 → 뱃지 색/라벨 (Figma 4종) */
export function statusBadgeConfig(status: CardBook['status'] | 'overdue') {
  switch (status) {
    case 'borrowed':    return { bg: LT.badgeBusy,    label: '대여중' }
    case 'overdue':     return { bg: LT.badgeOverdue, label: '연체중' }
    case 'maintenance': return { bg: '#E5E7EB',       label: '정비중' }
    case 'lost':        return { bg: '#E5E7EB',       label: '분실'   }
    default:            return { bg: LT.badgeAvail,   label: '대여가능' }
  }
}

/**
 * 신규 도서 판정 — acquired_at('YYYY-MM' 또는 'YYYY-MM-DD')이 이번 달이면 신규.
 * Figma 문구 "7월 신규 도서" 의 '7월'은 고정값이 아니라 취득월이다.
 */
export function newBadgeLabel(acquiredAt: string | null): string | null {
  if (!acquiredAt) return null
  const m = /^(\d{4})-(\d{2})/.exec(acquiredAt)
  if (!m) return null
  const now = new Date()
  if (+m[1] !== now.getFullYear() || +m[2] !== now.getMonth() + 1) return null
  return `${+m[2]}월 신규 도서`
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 카드 — Figma 83:336 / 1334:566 / 1328:426
// ═══════════════════════════════════════════════════════════════════════════

/** 표지 대체 (cover_url 없음/로드 실패) — 카드 규격 유지가 목적 */
function CoverFallback({ title }: { title: string }) {
  return (
    <div style={{
      width: '100%', height: LT.coverH, background: '#F1F3F5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px', boxSizing: 'border-box',
    }}>
      <span style={{
        fontSize: 14, fontWeight: FONT_R, color: '#A1A4AF',
        textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.5,
      }}>
        {title}
      </span>
    </div>
  )
}

export interface BookGridCardProps {
  book:            CardBook
  checkout?:       CardCheckout | null
  borrower?:       CardBorrower | null
  isAdmin:         boolean
  isOverdueStatus: boolean
  /** 콜백은 인자를 받지 않는다 — 대상 book/checkout 은 호출부가 클로저로 이미 갖고 있고,
   *  인자로 되돌려주면 카드가 전체 엔티티 타입을 알아야 해서 결합이 생긴다. */
  onCheckout: () => void
  onReturn:   () => void
  onEdit:     () => void
  onDelete:   () => void
}

export function BookGridCard({
  book, checkout, borrower, isAdmin, isOverdueStatus,
  onCheckout, onReturn, onEdit, onDelete,
}: BookGridCardProps) {
  const [imgErr, setImgErr] = useState(false)

  const displayStatus = (isOverdueStatus ? 'overdue' : book.status) as CardBook['status'] | 'overdue'
  const badge   = statusBadgeConfig(displayStatus)
  const newLbl  = newBadgeLabel(book.acquired_at)
  const held    = book.status === 'borrowed' && !!checkout   // 대여중/연체 = 메타 노출
  const dimmed  = book.status !== 'available'

  // Figma: 대여가능 16px / 대여중·연체 12px
  const innerGap = held ? LT.cardGapHeld : LT.cardGapFree

  return (
    <div style={{
      position: 'relative',
      display: 'flex', flexDirection: 'column', gap: innerGap,
      alignItems: 'flex-start', width: '100%',
    }}>

      {/* ── 표지 (h 280, radius 0) ─────────────────────────────────────── */}
      <div style={{
        width: '100%', height: LT.coverH, overflow: 'hidden',
        opacity: dimmed ? LT.dimmedCover : 1, flexShrink: 0,
      }}>
        {book.cover_url && !imgErr
          ? <img
              src={book.cover_url}
              alt={book.title}
              onError={() => setImgErr(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          : <CoverFallback title={book.title} />}
      </div>

      {/* ── 뱃지 행 (표지 위 absolute — left 8 / top 7.3 / right 8) ──────
          Figma 1334:720: width 218 = 카드 234 - 좌우 8. justify-between.
          NEW 가 없으면 상태 뱃지만 우측에 붙는다(Figma 1334:613 left 174). */}
      <div style={{
        position: 'absolute', left: 8, right: 8, top: 7.3,
        display: 'flex', alignItems: 'center',
        justifyContent: newLbl ? 'space-between' : 'flex-end',
        pointerEvents: 'none',
      }}>
        {newLbl && <ListBadge bg={LT.badgeNew}>{newLbl}</ListBadge>}
        <ListBadge bg={badge.bg}>{badge.label}</ListBadge>
      </div>

      {/* ── 제목 (16 Medium / 1.25 / #1E1E1E) ──────────────────────────── */}
      <p style={{
        margin: 0, width: '100%',
        fontSize: 16, fontWeight: FONT_M, lineHeight: 1.25, color: LT.ink,
        wordBreak: 'keep-all',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {book.title}
      </p>

      {/* ── 메타 (대여중/연체일 때만) — Figma 1334:699 ──────────────────
          gap 4 / 14px Regular / lineHeight 1.5 */}
      {held && checkout && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          width: '100%', fontSize: 14, fontWeight: FONT_R, lineHeight: 1.5,
        }}>
          {/* 상태 + 대여자 */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
            <span style={{
              color: isOverdueStatus ? LT.metaOverdue : LT.metaBusy, flexShrink: 0,
            }}>
              {isOverdueStatus ? '연체' : '대여'}
            </span>
            <span style={{
              display: 'flex', gap: 4, alignItems: 'center',
              padding: '2px 0', minWidth: 0,
            }}>
              <span style={{
                color: LT.black, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {borrower?.name ?? '알 수 없음'}
              </span>
              {borrower?.dept && (
                <span style={{ color: LT.metaDept, flexShrink: 0 }}>{borrower.dept}</span>
              )}
            </span>
          </div>

          {/* 반납기한 — Figma 라벨 '반납일'/'2026/7/20' 에서 기한 표기로 변경 */}
          <div style={{
            display: 'flex', gap: 4, alignItems: 'center',
            padding: '2px 0', color: LT.black, whiteSpace: 'nowrap',
          }}>
            <span>반납기한</span>
            <span>{checkout.due_at ? `${fmtDueShortKo(checkout.due_at)} 이내` : '-'}</span>
          </div>
        </div>
      )}

      {/* ── CTA (full width / py16 / radius 0 / 16px) ───────────────────── */}
      {book.status === 'available' && (
        <button
          onClick={onCheckout}
          style={{
            width: '100%', border: 'none', cursor: 'pointer',
            padding: '16px 0', background: LT.black, color: LT.white,
            fontSize: 16, fontWeight: FONT_R, lineHeight: 1.5,
            fontFamily: 'inherit', borderRadius: 0,
          }}>
          {isAdmin ? '대여 등록' : '대여 신청'}
        </button>
      )}

      {book.status === 'borrowed' && checkout && isAdmin && (
        <button
          onClick={onReturn}
          style={{
            width: '100%', border: 'none', cursor: 'pointer',
            padding: '16px 0', background: LT.badgeBusy, color: LT.black,
            fontSize: 16, fontWeight: FONT_M, lineHeight: 1.5,
            fontFamily: 'inherit', borderRadius: 0,
          }}>
          반납 처리
        </button>
      )}

      {/* ── 관리자 편집/삭제 (Figma 외 — 기존 기능 보존) ─────────────── */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button
            onClick={onEdit}
            style={{
              flex: 1, padding: '8px 0', background: 'transparent',
              border: `1px solid ${LT.black}`, borderRadius: 0, cursor: 'pointer',
              fontSize: 12, fontWeight: FONT_R, color: LT.ink, fontFamily: 'inherit',
            }}>
            편집
          </button>
          {book.status === 'available' && (
            <button
              onClick={onDelete}
              style={{
                flex: 1, padding: '8px 0', background: 'transparent',
                border: `1px solid ${LT.metaOverdue}`, borderRadius: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: FONT_R, color: LT.metaOverdue, fontFamily: 'inherit',
              }}>
              삭제
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 장르 칩 — Figma 103:67 (px16 py10 / radius 32 / border 1px black / 16px)
// ═══════════════════════════════════════════════════════════════════════════

export function GenreChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '10px 16px', borderRadius: 32, cursor: 'pointer',
        fontSize: 16, fontWeight: FONT_R, lineHeight: 1.5, fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        background: active ? LT.black : 'transparent',
        color:      active ? LT.white : LT.black,
        border:     active ? '1px solid transparent' : `1px solid ${LT.black}`,
      }}>
      {children}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Hero 조각 — Figma 73:834
// ═══════════════════════════════════════════════════════════════════════════

/** 상단 CTA 버튼 (px16 py8 / border 1px black / radius 0 / 16px Regular) */
export function HeroCta({
  primary, onClick, children,
}: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 16px', cursor: 'pointer', borderRadius: 0,
        border: `1px solid ${LT.black}`,
        background: primary ? LT.black : LT.white,
        color:      primary ? LT.white : LT.ink,
        fontSize: 16, fontWeight: FONT_R, lineHeight: 1.5, fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  )
}

/** 통계 1칸 — Figma 1332:510 (gap 2 / opacity .8 / label 14 / value 24) */
export function HeroStat({
  label, value, valueColor, labelWeight = FONT_R,
}: { label: string; value: number; valueColor: string; labelWeight?: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      alignItems: 'flex-start', opacity: 0.8, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 14, fontWeight: labelWeight, lineHeight: 1.5, color: LT.ink }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: FONT_R, lineHeight: 1.5, color: valueColor }}>
        {value}
      </span>
    </div>
  )
}

export const HERO_FONT_SB = FONT_SB
