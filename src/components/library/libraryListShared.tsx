/**
 * libraryListShared.tsx — 도서관 메인 리스트 UI 토큰 & 컴포넌트 (SSOT)
 *
 * [2026-07-20] 신규
 *
 * Figma: fMv9JLNlNybDBYUnJDCTrq
 *   [2026-07-20 rev2] 1339:1146 Home list — 아래 구조로 개편
 *     · 1339:1149 Hero (로고 / CTA / 안내문 / 통계·검색 / 장르칩)
 *     · 1339:1306 GNB  — 장르 칩이 좌측 사이드바에서 Hero 하단 가로 배열로 이동
 *     · 1339:1205 그리드 — 전폭 1352 / 5열 / 카드 251.2 / gap 24
 *     · 1339:1257 카드 (대여중 + 호버 편집·삭제 오버레이 1340:1332)
 *     · 1339:1247 카드 (대여가능) / 1339:1224 (연체중)
 *   [rev1] 73:831 / 73:834 / 103:67 / 82:53 (좌측 GNB + 4열)
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

  colGap:       24,   // 카드 간 gap (Figma 1339:1205)
  cardW:        251,  // 5열 기준 (1352 - 24*4) / 5 = 251.2
  cardCols:     5,    // 데스크톱 열 수
  coverH:       280,

  searchGap:    20,   // 검색바 요소 간격 (Figma 1339:1178 — rev1 10 → 20)
  chipRowPadY:  24,   // Hero 하단 장르 칩 행 상하 여백 (Figma 1339:1306)

  cardGapFree:  16,   // 대여가능 카드 내부 gap (Figma 83:336)
  cardGapHeld:  12,   // 대여중/연체 카드 내부 gap (Figma 1334:566)

  dimmedCover:  0.3,  // 대여중/연체 표지 불투명도

  danger:       '#F75D5F',   // 호버 오버레이 '삭제' 배경 (Figma 1340:1333)
} as const

const FONT_M = 500   // Pretendard Medium
const FONT_R = 400   // Pretendard Regular
const FONT_SB = 600  // Pretendard SemiBold

// ═══════════════════════════════════════════════════════════════════════════
// 2. 아이콘
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 검색 (24×24) — Figma 1339:1179 원본 vector 적용
 *
 * ← [2026-07-20] rev1 의 stroke 재현본을 원본 path 로 교체.
 *   원본은 20.2765 정사각 viewBox 의 **fill** path 이고, 24×24 프레임 안에서
 *   inset 6.14% (= 1.4736px) 만큼 들어가 있다. 그대로 translate 해서 배치한다.
 */
export function SearchIcon({ size = 24, color = LT.black }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <g transform="translate(1.4736, 1.4736)">
        <path
          fill={color}
          d="M20.2765 19.216L14.6125 13.5519C15.9735 11.9179 16.6522 9.82212 16.5074 7.70048C16.3625 5.57885 15.4053 3.59473 13.8348 2.16087C12.2644 0.727017 10.2016 -0.046177 8.07555 0.00213499C5.94953 0.050447 3.92397 0.916546 2.42026 2.42026C0.916546 3.92397 0.050447 5.94953 0.00213499 8.07555C-0.046177 10.2016 0.727017 12.2644 2.16087 13.8348C3.59473 15.4053 5.57885 16.3625 7.70048 16.5074C9.82212 16.6522 11.9179 15.9735 13.5519 14.6125L19.216 20.2765L20.2765 19.216ZM1.52654 8.27654C1.52654 6.94152 1.92243 5.63648 2.66412 4.52645C3.40582 3.41641 4.46003 2.55125 5.69343 2.04036C6.92683 1.52947 8.28403 1.39579 9.5934 1.65624C10.9028 1.91669 12.1055 2.55957 13.0495 3.50357C13.9935 4.44758 14.6364 5.65031 14.8968 6.95969C15.1573 8.26906 15.0236 9.62626 14.5127 10.8597C14.0018 12.0931 13.1367 13.1473 12.0266 13.889C10.9166 14.6307 9.61157 15.0265 8.27654 15.0265C6.48694 15.0246 4.77121 14.3128 3.50577 13.0473C2.24033 11.7819 1.52853 10.0661 1.52654 8.27654Z"
        />
      </g>
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
  const [imgErr, setImgErr]   = useState(false)
  // ← [2026-07-20] 편집/삭제는 카드 하단 고정이 아니라 표지 호버 오버레이로 이동
  //   (Figma 1340:1332). 터치 기기는 hover 가 없으므로 focus-within 도 함께 사용.
  const [hovered, setHovered] = useState(false)

  const displayStatus = (isOverdueStatus ? 'overdue' : book.status) as CardBook['status'] | 'overdue'
  const badge   = statusBadgeConfig(displayStatus)
  const newLbl  = newBadgeLabel(book.acquired_at)
  const held    = book.status === 'borrowed' && !!checkout   // 대여중/연체 = 메타 노출
  const dimmed  = book.status !== 'available'

  // Figma: 대여가능 16px / 대여중·연체 12px
  const innerGap = held ? LT.cardGapHeld : LT.cardGapFree

  const showActions = isAdmin && hovered

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: innerGap,
        alignItems: 'flex-start', width: '100%',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={e => {
        // 카드 밖으로 포커스가 나갈 때만 닫는다 (내부 버튼 간 이동은 유지)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHovered(false)
      }}
    >
      {/* ── 표지 영역 (h 280 / radius 0) — 뱃지·액션 오버레이의 기준 박스 ── */}
      <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
        <div style={{
          width: '100%', height: LT.coverH, overflow: 'hidden',
          opacity: dimmed ? LT.dimmedCover : 1,
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

        {/* 뱃지 행 (Figma 1339:1259 — left 8 / top 7.3 / right 8 / space-between)
            NEW 가 없으면 상태 뱃지만 우측 정렬 (Figma 1339:1329). */}
        <div style={{
          position: 'absolute', left: 8, right: 8, top: 7.3,
          display: 'flex', alignItems: 'center',
          justifyContent: newLbl ? 'space-between' : 'flex-end',
          pointerEvents: 'none',
        }}>
          {newLbl && <ListBadge bg={LT.badgeNew}>{newLbl}</ListBadge>}
          <ListBadge bg={badge.bg}>{badge.label}</ListBadge>
        </div>

        {/* 편집/삭제 오버레이 (Figma 1340:1332 — 표지 하단 / padding 8 / gap 8)
            ← [2026-07-20] 카드 하단 고정 → 표지 호버로 이동.
            레이아웃 높이에 영향을 주지 않도록 absolute 로 띄운다
            (기존처럼 흐름에 두면 관리자 화면만 카드 높이가 달라진다). */}
        {isAdmin && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            display: 'flex', gap: 8, alignItems: 'center', padding: 8,
            opacity: showActions ? 1 : 0,
            visibility: showActions ? 'visible' : 'hidden',
            transition: 'opacity 0.15s',
          }}>
            {book.status === 'available' && (
              <button
                onClick={onDelete}
                tabIndex={showActions ? 0 : -1}
                style={{
                  flex: 1, minWidth: 0, border: 'none', cursor: 'pointer', borderRadius: 0,
                  padding: '12px 16px', background: LT.danger, color: LT.white,
                  fontSize: 14, fontWeight: FONT_R, lineHeight: 1.4, fontFamily: 'inherit',
                }}>
                삭제
              </button>
            )}
            <button
              onClick={onEdit}
              tabIndex={showActions ? 0 : -1}
              style={{
                flex: 1, minWidth: 0, border: 'none', cursor: 'pointer', borderRadius: 0,
                padding: '12px 16px', background: LT.white, color: LT.black,
                fontSize: 14, fontWeight: FONT_R, lineHeight: 1.4, fontFamily: 'inherit',
              }}>
              편집
            </button>
          </div>
        )}
      </div>

      {/* ── 제목 (Figma 1339:1265 — 20px Regular / 1.25 / #1E1E1E) ────── */}
      <p style={{
        margin: 0, width: '100%',
        fontSize: 20, fontWeight: FONT_R, lineHeight: 1.25, color: LT.ink,
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
            {/* ← [2026-07-20] 부서명이 카드 폭을 넘기면 말줄임.
                이름은 축약하지 않고(식별 정보) 부서만 줄인다.
                flex 자식은 min-width:auto 가 기본이라 minWidth:0 이 없으면
                ellipsis 가 동작하지 않는다 — 부모/자식 모두 지정. */}
            <span style={{
              display: 'flex', gap: 4, alignItems: 'center',
              padding: '2px 0', minWidth: 0, flex: 1,
            }}>
              <span style={{ color: LT.black, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {borrower?.name ?? '알 수 없음'}
              </span>
              {borrower?.dept && (
                <span
                  title={borrower.dept}
                  style={{
                    color: LT.metaDept, minWidth: 0, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                  {borrower.dept}
                </span>
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
