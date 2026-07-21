/**
 * libraryListShared.tsx — 도서관 메인 리스트 UI 토큰 & 컴포넌트 (SSOT)
 *
 * [2026-07-20] 신규
 * [2026-07-21] New Collection 슬라이더용 판정 추가
 *   · isRecentAcquisition() / monthsAgoYM() / NEW_COLLECTION_MONTHS — 최근 3개월 입고분
 *   · acquiredMonthLabel() — "N월 신규 도서" 문구 SSOT (newBadgeLabel 이 이걸 호출)
 *   ※ isNewBook(new_until) 기존 판정은 변경 없음
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

import { useState, useEffect } from 'react'
import type { ReactNode, CSSProperties } from 'react'
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
  /** ← [2026-07-20] 제목 아래 14px 회색 작가명 (Figma 1345:1820) */
  author:      string | null
  status:      'available' | 'borrowed' | 'maintenance' | 'lost'
  cover_url:   string | null
  acquired_at: string | null
  /** ⭐NEW⭐ 노출 종료일 (date, KST). NULL = 표시 안 함 */
  new_until:   string | null
}

/** 카드가 읽는 대여 필드 */
export interface CardCheckout {
  due_at: string
}

/** 카드가 읽는 대여자 필드 */
export interface CardBorrower {
  name?:       string | null
  dept?:       string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Figma 토큰
// ═══════════════════════════════════════════════════════════════════════════

export const LT = {
  // ── 색 ────────────────────────────────────────────────────────────────
  ink:          '#1E1E1E',   // 제목·본문 (검정 아님에 주의)
  black:        '#000000',
  white:        '#FFFFFF',
  //  ← [2026-07-21] Home list 배경 (Figma 1340:1342). 흰색이던 페이지 바탕을
  //     회색으로 내려 카드 표지가 바탕에 파묻히지 않게 한다.
  pageBg:       '#F6F6F6',

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

  //  ← [2026-07-20] 가로/세로 gap 분리.
  //     Figma 1339:1205 는 24 균등이지만, 카드 아래에 제목이 붙어 있어
  //     세로 24 는 "제목 ↔ 다음 카드 표지" 간격으로 읽혀 답답했다.
  //     행 간격만 40 으로 벌리고 열 간격은 그대로 둔다(5열 폭 251 유지).
  colGap:       24,   // 열(좌우) 간격 — Figma 1339:1205
  rowGap:       40,   // 행(상하) 간격
  cardW:        251,  // 5열 기준 (1352 - 24*4) / 5 = 251.2
  cardCols:     5,    // 데스크톱 열 수

  // ── 표지 박스 (← [2026-07-20] 잘림 해결) ──────────────────────────────
  //
  //  문제(근본 원인):
  //    Figma 는 표지를 251×280 고정으로 그렸다. 비율이 1:1.12 로 거의 정사각인데
  //    실제 책 표지는 1:1.4 ~ 1:1.5 다. object-fit:cover 로 채우면
  //    세로가 20~26% 잘려 나간다(제목/저자가 날아감).
  //    → 높이를 px 로 고정한 것 자체가 원인이므로 '비율 박스'로 바꾼다.
  //
  //  해법:
  //    1) 박스를 aspect-ratio 로 정의 → 카드 폭이 변해도 비율 유지,
  //       같은 행 카드 높이가 항상 일치(그리드 정렬 유지).
  //    2) object-fit: contain → 원본을 절대 자르지 않는다.
  //       비율이 다른 표지는 여백이 생기므로 중립 배경을 깐다.
  //
  //  비율을 바꾸고 싶으면 coverRatio 한 줄만 고치면 된다.
  //    '1 / 1.45' → 표준 단행본 (권장, 여백 최소)
  //    '3 / 4'    → 여백 더 적지만 세로 긴 표지에 위아래 여백
  //    '2 / 3'    → 세로 긴 표지 우선
  coverRatio:   '1 / 1.45',
  coverRatioNum: 1 / 1.45,   // 위 값의 수치판 (w/h) — 자동 맞춤 계산용
  coverBg:      '#F5F6F8',

  //  ← [2026-07-20] 표지 자동 맞춤 임계값
  //
  //    contain 만 쓰면 잘림은 0 이지만 비율이 어긋난 표지에 좌우 여백이 남는다.
  //    cover 만 쓰면 여백은 0 이지만 20% 넘게 잘리는 표지가 나온다.
  //    → 표지마다 원본 비율을 재서 "조금 모자란" 것만 확대(cover)한다.
  //
  //    coverAutoFillMaxCrop = cover 로 채웠을 때 감수할 최대 잘림 비율.
  //    0.10 이면 10% 이내로 잘리는 표지는 확대해 여백을 없애고,
  //    그보다 많이 잘릴 표지는 contain 으로 원본을 온전히 보여준다.
  //    여백이 더 신경 쓰이면 0.15~0.2 로, 잘림이 싫으면 0.05 로 낮추면 된다.
  coverAutoFillMaxCrop: 0.10,

  searchGap:    20,   // 검색바 요소 간격 (Figma 1339:1178 — rev1 10 → 20)
  chipRowPadY:  24,   // Hero 하단 장르 칩 행 상하 여백 (Figma 1339:1306)

  //  ← [2026-07-20 rev3] 카드 본문이 '표지 + 제목' 으로 단순해지면서
  //     상태별 gap 구분이 사라졌다. 호버 프레임 두 종 모두 gap 12.
  cardGap:      12,   // Figma 1344:1539 / 1344:1552

  dimmedCover:  0.3,  // 대여중/연체 표지 불투명도

  danger:       '#F75D5F',   // 호버 오버레이 '삭제' 배경 (Figma 1344:1555)
} as const

/**
 * 호버 오버레이 버튼 공통 스타일 — Figma 1344:1545 / 1547 / 1550 / 1560
 *   px16 py12 · radius 0 · 14px Regular · lineHeight 1.4 · flex 1
 *   배경/글자색만 호출부에서 덮어쓴다.
 */
const HOVER_BTN: CSSProperties = {
  flex: 1, minWidth: 0, border: 'none', cursor: 'pointer', borderRadius: 0,
  padding: '12px 16px', fontFamily: 'inherit',
  fontSize: 14, fontWeight: 400, lineHeight: 1.4,
}

/**
 * 이 기기가 진짜 hover 를 지원하는가.
 *
 * ← [2026-07-20 rev3] CTA 를 호버 영역으로 옮기면서 필요해졌다.
 *   터치 기기는 hover 이벤트가 없거나(또는 탭 후 잔류) 신뢰할 수 없어서,
 *   hover 로만 CTA 를 열면 모바일에서 대여 버튼을 누를 방법이 사라진다.
 *   (hover: none) 이면 오버레이를 항상 펼쳐 둔다.
 */
function useCanHover(): boolean {
  const [can, setCan] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover)').matches
      : true,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(hover: hover)')
    const onChange = () => setCan(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return can
}

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

// ─── ⭐NEW⭐ 판정 (SSOT) ────────────────────────────────────────────────────
//
// ← [2026-07-20] 설계 변경
//
//   변경 전: acquired_at 이 "이번 달"이면 자동으로 NEW.
//            → 관리자가 켜고 끌 수 없고, 월이 바뀌면 일괄 소멸했다.
//            게다가 같은 판정을 카드 뱃지와 목록 필터가 **따로** 구현해서
//            한쪽만 고치면 "뱃지는 뜨는데 NEW 필터에는 안 잡히는" 불일치가 났다.
//
//   변경 후: books.new_until (date) 하나가 단일 진실 소스.
//            뱃지와 필터 모두 아래 isNewBook() 만 호출한다. 중복 없음.

/** 오늘 날짜 (KST, 'YYYY-MM-DD') — 서버/브라우저 타임존과 무관하게 고정 */
export function todayKST(): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 준다
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/**
 * NEW 노출 여부 — new_until 이 오늘(KST) 이상이면 노출.
 * 'YYYY-MM-DD' 는 사전순 == 시간순이라 문자열 비교로 충분하다
 * (Date 로 파싱하면 UTC 자정 해석 때문에 KST 에서 하루 밀린다).
 */
export function isNewBook(book: Pick<CardBook, 'new_until'>): boolean {
  if (!book.new_until) return false
  return book.new_until.slice(0, 10) >= todayKST()
}

/**
 * 카드 뱃지 문구.
 *
 * ← [2026-07-21] 고지 확정 — "신규 도서" 라벨 폐기, "N월 신규 도서" 로 통일.
 *
 *   변경 전: acquired_at 이 당월일 때만 "7월 신규 도서", 그 외에는 "신규 도서".
 *            → 6월 입고분에 ⭐NEW⭐ 를 켜면 "신규 도서"로 뭉뚱그려져
 *              New Collection 슬라이더의 "6월 신규 도서" 와 문구가 어긋났다.
 *
 *   변경 후: isNewBook 이면 acquired_at 의 월을 그대로 표기. 예외 없음.
 *            문구 생성은 acquiredMonthLabel() 한 곳뿐이라 슬라이더와 항상 일치한다.
 *
 *   ※ acquired_at 이 비어 있으면 표기할 월이 없으므로 null(뱃지 미표시).
 *     예전에는 이 경우 "신규 도서"가 나왔다 — 입고일 입력이 실질 필수가 된다.
 */
export function newBadgeLabel(book: Pick<CardBook, 'new_until' | 'acquired_at'>): string | null {
  if (!isNewBook(book)) return null
  return acquiredMonthLabel(book.acquired_at)
}

// ─── New Collection (최근 N개월 입고) 판정 ──────────────────────────────────
//
// ← [2026-07-21] 신설 — Figma 1347:1991 "New Collection" 자동 슬라이드용
//
//   ⭐NEW⭐(isNewBook / new_until) 와 **다른 개념**이라 함수를 분리한다.
//     · ⭐NEW⭐          = 관리자가 손으로 켜는 강조. 종료일 수동 지정.
//     · New Collection = "최근 3개월 입고분" 이라는 시간 창. 자동 롤링.
//
//   new_until 하나로 둘 다 표현하려 하면, 매월 9권을 사람이 켜고 꺼야 하고
//   월이 바뀌어도 자동으로 빠지지 않는다. 시간 축 개념은 acquired_at 이 맞다.
//   두 판정은 서로 간섭하지 않으며 한 도서가 양쪽에 동시에 속할 수 있다.

/** 슬라이더가 보여줄 입고 기간 (당월 포함 개월 수). 사내 규칙: 매월 3권 구입 → 최대 9권 */
export const NEW_COLLECTION_MONTHS = 3

/**
 * 'YYYY-MM' — 오늘(KST) 기준 (months-1) 개월 전의 달.
 * months=3, 오늘이 2026-07 이면 '2026-05'.
 *
 * Date 파싱을 거치지 않는 이유는 todayKST() 주석과 같다
 * (new Date('YYYY-MM-DD') 는 UTC 자정 해석이라 KST 에서 하루/한 달 밀린다).
 */
export function monthsAgoYM(months: number): string {
  const today = todayKST()
  let y = +today.slice(0, 4)
  let m = +today.slice(5, 7) - (months - 1)
  while (m <= 0) { m += 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * 최근 N개월 입고분인가.
 *
 *   하한: (당월 - N + 1) 월  — 3개월 롤링
 *   상한: 당월                — 미래 날짜로 등록된 도서는 아직 입고 전이므로 제외.
 *
 *   'YYYY-MM' 는 사전순 == 시간순이라 문자열 비교로 충분하다.
 */
export function isRecentAcquisition(
  book: Pick<CardBook, 'acquired_at'>,
  months: number = NEW_COLLECTION_MONTHS,
): boolean {
  const ym = book.acquired_at?.slice(0, 7)
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return false   // 미입력/형식오류 = 대상 아님
  const nowYM = todayKST().slice(0, 7)
  if (ym > nowYM) return false                          // 미래 입고 제외
  return ym >= monthsAgoYM(months)
}

/**
 * "N월 신규 도서" 문구 (SSOT).
 * 그리드 뱃지(newBadgeLabel)와 슬라이더 라벨이 같은 문자열을 쓰도록 여기 한 곳에만 둔다.
 */
export function acquiredMonthLabel(acquiredAt: string | null): string | null {
  const m = /^\d{4}-(\d{2})/.exec(acquiredAt ?? '')
  return m ? `${+m[1]}월 신규 도서` : null
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 카드 — Figma 83:336 / 1334:566 / 1328:426
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 표지 맞춤 방식 결정 — 원본 비율(w/h)을 받아 cover / contain 을 고른다.
 *
 * ← [2026-07-20] "가로가 비지 않도록, 살짝 모자라면 자동 확대"
 *
 *   박스 비율 B 와 원본 비율 R 의 어긋난 정도:
 *     deviation = 1 - min(R,B) / max(R,B)
 *
 *   이 값은 두 가지를 동시에 뜻한다.
 *     · cover 로 채웠을 때 **잘려나가는** 비율
 *     · contain 으로 넣었을 때 **남는 여백** 비율
 *   즉 둘은 같은 크기의 손해다. 어느 쪽을 택할지만 정하면 된다.
 *
 *   deviation ≤ 임계값 → 조금 모자란 것이므로 확대(cover). 여백 0.
 *   deviation >  임계값 → 많이 잘리므로 원본 유지(contain). 잘림 0.
 */
export function pickCoverFit(naturalRatio: number): 'cover' | 'contain' {
  if (!Number.isFinite(naturalRatio) || naturalRatio <= 0) return 'contain'
  const B = LT.coverRatioNum
  const deviation = 1 - Math.min(naturalRatio, B) / Math.max(naturalRatio, B)
  return deviation <= LT.coverAutoFillMaxCrop ? 'cover' : 'contain'
}

/** 표지 대체 (cover_url 없음/로드 실패) — 카드 규격 유지가 목적 */
function CoverFallback({ title }: { title: string }) {
  return (
    <div style={{
      width: '100%', height: '100%', background: LT.coverBg,
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
  /**
   * ← [2026-07-21] 카드 클릭 → 도서 상세 모달.
   *   표지 위의 CTA/편집/삭제 버튼은 stopPropagation 으로 이 핸들러를 막는다
   *   (버튼을 눌렀는데 상세까지 같이 열리는 이중 발화 방지).
   */
  onOpenDetail?: () => void
}

export function BookGridCard({
  book, checkout, borrower, isAdmin, isOverdueStatus,
  onCheckout, onReturn, onEdit, onDelete, onOpenDetail,
}: BookGridCardProps) {
  const [imgErr, setImgErr]   = useState(false)
  //  표지 원본 비율을 잰 뒤 결정되는 맞춤 방식.
  //  onLoad 전에는 contain(안전측) — 로드 후 잘림이 임계값 이내면 cover 로 승격.
  const [coverFit, setCoverFit] = useState<'cover' | 'contain'>('contain')
  const [hovered, setHovered]   = useState(false)
  const canHover = useCanHover()

  const displayStatus = (isOverdueStatus ? 'overdue' : book.status) as CardBook['status'] | 'overdue'
  const badge   = statusBadgeConfig(displayStatus)
  const newLbl  = newBadgeLabel(book)
  const held    = book.status === 'borrowed' && !!checkout   // 대여중/연체 = 메타 노출
  const dimmed  = book.status !== 'available'

  // ← [2026-07-20 rev3] 오버레이 노출 조건
  //
  //   hover 로만 열면 터치 기기에서 CTA 에 영영 접근할 수 없다.
  //   (CTA 가 카드 하단 흐름에 있을 때는 문제가 없었지만, 이제 호버 영역으로
  //    옮겼으므로 hover 가 없는 기기에서는 대여 자체가 불가능해진다.)
  //   → (hover: none) 기기에서는 항상 펼쳐 둔다.
  const overlayOpen = !canHover || hovered

  // ← [2026-07-21] 오버레이 버튼 공통 래퍼 — 카드 클릭(상세 열기)으로 전파되지 않게 한다.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn() }

  return (
    <div
      role={onOpenDetail ? 'button' : undefined}
      tabIndex={onOpenDetail ? 0 : undefined}
      aria-label={onOpenDetail ? `${book.title} 상세 보기` : undefined}
      onClick={onOpenDetail}
      onKeyDown={e => {
        if (!onOpenDetail) return
        // 내부 버튼에서 올라온 Enter/Space 는 무시 (버튼이 스스로 처리한다)
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail() }
      }}
      style={{
        display: 'flex', flexDirection: 'column', gap: LT.cardGap,
        alignItems: 'flex-start', width: '100%',
        cursor: onOpenDetail ? 'pointer' : 'default',
        outlineOffset: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={e => {
        // 카드 밖으로 포커스가 나갈 때만 닫는다 (내부 버튼 간 이동은 유지)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHovered(false)
      }}
    >
      {/* ══ 표지 영역 — 뱃지·메타·CTA·편집/삭제 오버레이의 기준 박스 ══ */}
      <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
        <div style={{
          width: '100%', aspectRatio: LT.coverRatio, overflow: 'hidden',
          background: LT.coverBg, opacity: dimmed ? LT.dimmedCover : 1,
        }}>
          {book.cover_url && !imgErr
            ? <img
                src={book.cover_url}
                alt={book.title}
                onError={() => setImgErr(true)}
                onLoad={e => {
                  const el = e.currentTarget
                  if (!el.naturalWidth || !el.naturalHeight) return
                  setCoverFit(pickCoverFit(el.naturalWidth / el.naturalHeight))
                }}
                style={{
                  width: '100%', height: '100%',
                  objectFit: coverFit,   // pickCoverFit() 이 표지별로 결정
                  display: 'block',
                }}
              />
            : <CoverFallback title={book.title} />}
        </div>

        {/* ── 뱃지 행 (Figma 1344:1562 — left 8 / top 7.3 / right 8) ────── */}
        <div style={{
          position: 'absolute', left: 8, right: 8, top: 7.3,
          display: 'flex', alignItems: 'center',
          justifyContent: newLbl ? 'space-between' : 'flex-end',
          pointerEvents: 'none',
        }}>
          {newLbl && <ListBadge bg={LT.badgeNew}>{newLbl}</ListBadge>}
          <ListBadge bg={badge.bg}>{badge.label}</ListBadge>
        </div>

        {/* ← [2026-07-20 rev4] 대여 정보 패널(Figma 1344:1568, 표지 위 반투명
            오버레이)은 제거하고 카드 본문 아래로 원복했다.
            호버로만 보이면 목록에서 누가 빌렸는지 한눈에 훑을 수 없어
            관리 화면의 기본 용도(대여 현황 파악)를 깎아먹는다.
            CTA·편집/삭제는 요청대로 호버 영역에 그대로 둔다. */}

        {/* ── CTA + 편집/삭제 (Figma 1344:1549 / 1344:1544) ───────────────
            표지 하단 기준으로 쌓는다.
              편집/삭제 : bottom 0, padding 8, gap 8      (높이 60)
              CTA       : 그 바로 위, 좌우 padding 8만    (높이 44)
            Figma 는 top 176.3 / 220.3 절대값으로 그려져 있지만 그건 표지
            280px 고정 기준이다. 우리 표지는 비율 박스(≈364px)라 top 값을
            그대로 쓰면 어긋난다 → 하단 기준으로 환산해 배치한다.
            (썸네일 사이즈 정책은 요청대로 손대지 않음) */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column',
          opacity: overlayOpen ? 1 : 0,
          visibility: overlayOpen ? 'visible' : 'hidden',
          transition: 'opacity 0.15s',
        }}>
          {/* CTA */}
          <div style={{
            display: 'flex', alignItems: 'center',
            // 아래 편집/삭제 행이 padding 8 로 하단 여백을 만든다.
            // 관리자가 아니면 그 행이 없으므로 여기서 하단 8 을 준다.
            padding: isAdmin ? '0 8px' : '0 8px 8px',
          }}>
            {book.status === 'available' && (
              <button
                onClick={stop(onCheckout)}
                tabIndex={overlayOpen ? 0 : -1}
                style={{ ...HOVER_BTN, background: LT.black, color: LT.white }}>
                {isAdmin ? '대여 등록' : '대여 신청'}
              </button>
            )}
            {book.status === 'borrowed' && checkout && isAdmin && (
              <button
                onClick={stop(onReturn)}
                tabIndex={overlayOpen ? 0 : -1}
                style={{ ...HOVER_BTN, background: LT.badgeBusy, color: LT.black }}>
                반납 처리
              </button>
            )}
          </div>

          {/* 편집 / 삭제 */}
          {isAdmin && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'center', padding: 8,
            }}>
              {/* 삭제는 대여 이력이 걸리지 않는 available 에서만.
                  Figma 는 대여중 카드에도 삭제를 그려 두었지만, 대여 기록이
                  남은 도서를 지우면 book_checkouts 가 고아가 된다. 기존 가드 유지. */}
              {book.status === 'available' && (
                <button
                  onClick={stop(onDelete)}
                  tabIndex={overlayOpen ? 0 : -1}
                  style={{ ...HOVER_BTN, background: LT.danger, color: LT.white }}>
                  삭제
                </button>
              )}
              <button
                onClick={stop(onEdit)}
                tabIndex={overlayOpen ? 0 : -1}
                style={{ ...HOVER_BTN, background: LT.white, color: LT.black }}>
                편집
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══ 제목 + 작가 (Figma 1345:1825 — flex-col / gap 4 / lineHeight 1.25) ══
            제목  20px Regular  #111
            작가  14px Regular  #A1A4AF   ← [2026-07-20 rev5] 신규
          author 가 비어 있는 도서(CSV 일괄 등록분 등)는 행 자체를 그리지 않는다.
          빈 줄을 넣으면 카드마다 높이가 달라져 그리드 행이 어긋난다. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        width: '100%', minWidth: 0,
      }}>
        <p style={{
          margin: 0, width: '100%',
          fontSize: 20, fontWeight: FONT_R, lineHeight: 1.25, color: LT.ink,
          wordBreak: 'keep-all',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {book.title}
        </p>
        {book.author && (
          <p
            title={book.author}
            style={{
              margin: 0, width: '100%',
              fontSize: 14, fontWeight: FONT_R, lineHeight: 1.25, color: LT.metaDept,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            {book.author}
          </p>
        )}
      </div>

      {/* ══ 대여자 / 반납기한 — 대여중·연체일 때만 (Figma 1344:1568 내용) ══
          ← [2026-07-20 rev4] 표지 호버 오버레이 → 카드 본문으로 원복.
            gap 4 · 14px Regular · lineHeight 1.5
            ← [2026-07-20 rev5] 아바타 제거 (Figma 1344:1809 에 아바타 없음). */}
      {held && checkout && (
        <div style={{
          // ← [2026-07-20 rev6] gap 4 → 0.
          //   lineHeight 1.5 (=21px) 가 이미 행간을 만들고 있어 gap 까지 주면
          //   '대여' 행과 '반납기한' 행이 따로 노는 덩어리로 보였다.
          display: 'flex', flexDirection: 'column', gap: 0,
          width: '100%', fontSize: 14, fontWeight: FONT_R, lineHeight: 1.5,
        }}>
          {/* 상태 + 대여자 */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
            <span style={{
              color: isOverdueStatus ? LT.metaOverdue : LT.metaBusy, flexShrink: 0,
            }}>
              {isOverdueStatus ? '연체' : '대여'}
            </span>
            {/* 부서명이 폭을 넘기면 말줄임. 이름은 식별 정보라 축약하지 않는다.
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

          {/* 반납기한 — Figma 라벨 '반납일'/'2026/7/20' 에서 기한 표기로 변경
              (배포 완료된 문구 정책 유지) */}
          <div style={{
            // ← [2026-07-20 rev6] padding '2px 0' → 0 (상하 여백 제거)
            display: 'flex', gap: 4, alignItems: 'center',
            padding: 0, color: LT.black, whiteSpace: 'nowrap',
          }}>
            <span>반납기한</span>
            <span>{checkout.due_at ? `${fmtDueShortKo(checkout.due_at)} 이내` : '-'}</span>
          </div>
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

/**
 * 통계 1칸 — Figma 1339:1169 (gap 2 / opacity .8 / label 14 / value 24)
 *
 * ← [2026-07-20] 상태 필터 역할을 여기로 통합.
 *   검색바 안에 있던 전체/대여가능/대여중 pill 과 이 통계는 같은 값을 두 번
 *   보여주고 있었다(중복). 숫자 쪽이 정보량이 많으므로 통계를 버튼으로 만들고
 *   pill 은 삭제했다. onClick 이 없으면 기존처럼 표시 전용으로 동작한다.
 */
export function HeroStat({
  label, value, valueColor, labelWeight = FONT_R, active, onClick,
}: {
  label: string
  value: number
  valueColor: string
  labelWeight?: number
  active?: boolean
  onClick?: () => void
}) {
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-pressed={interactive ? !!active : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        alignItems: 'flex-start', whiteSpace: 'nowrap',
        // 선택된 항목만 불투명 — Figma 의 opacity .8 을 비활성 표현으로 재사용
        opacity: !interactive || active ? 1 : 0.45,
        padding: 0, background: 'transparent', fontFamily: 'inherit',
        border: 'none',
        // 선택 표시는 하단 라인. 배경/테두리를 쓰면 Figma 의 여백 설계가 깨진다.
        borderBottom: interactive
          ? `2px solid ${active ? LT.black : 'transparent'}`
          : '2px solid transparent',
        paddingBottom: 2,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'opacity 0.15s',
      }}>
      <span style={{ fontSize: 14, fontWeight: labelWeight, lineHeight: 1.5, color: LT.ink }}>
        {label}
      </span>
      <span style={{ fontSize: 24, fontWeight: FONT_R, lineHeight: 1.5, color: valueColor }}>
        {value}
      </span>
    </button>
  )
}

export const HERO_FONT_SB = FONT_SB

// ═══════════════════════════════════════════════════════════════════════════
// 7. 정렬순 — Figma 1366:2276 "정렬순"
//     p4 / gap 8 / 항목 gap 8 / 사각 14×14 border 1px #000 (선택 시 fill #000)
//     라벨 14px Regular #111 lh 1.4
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 정렬 기준.
 *   recent  — 최신 순  : 입고일(acquired_at) 내림차순
 *   title   — 가나다 순: 제목 한국어 로케일 정렬
 *   popular — 인기 순  : 누적 대여 횟수 내림차순
 *
 * ← [2026-07-21] 문자열 리터럴을 여기 한 곳에만 둔다.
 *   LibraryPage 의 state 타입과 라벨 정의가 따로 놀면 값을 하나 추가할 때
 *   한쪽만 고쳐 조용히 어긋난다.
 */
export type BookSort = 'recent' | 'title' | 'popular'

export const BOOK_SORT_OPTIONS: { value: BookSort; label: string }[] = [
  { value: 'recent',  label: '최신 순'   },
  { value: 'title',   label: '가나다 순' },
  { value: 'popular', label: '인기 순'   },
]

/**
 * Figma 는 체크박스 모양으로 그렸지만 동작은 단일 선택이다.
 * → 시각은 Figma 그대로 두고 시맨틱만 radiogroup 으로 준다.
 *   체크박스 role 을 쓰면 보조기기가 "여러 개 고를 수 있다"고 잘못 안내한다.
 */
export function BookSortRow({
  value, onChange,
}: { value: BookSort; onChange: (v: BookSort) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="도서 정렬 기준"
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 4, flexWrap: 'wrap' }}>
      {BOOK_SORT_OPTIONS.map(opt => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              display: 'flex', gap: 8, alignItems: 'center',
              padding: 0, border: 'none', background: 'transparent',
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
            <span style={{
              width: 14, height: 14, flexShrink: 0, borderRadius: 0,
              border: `1px solid ${LT.black}`,
              background: active ? LT.black : 'transparent',
              boxSizing: 'border-box',
              transition: 'background 0.12s',
            }} />
            <span style={{
              fontSize: 14, fontWeight: FONT_R, lineHeight: 1.4,
              color: '#111', whiteSpace: 'nowrap',
            }}>
              {opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
