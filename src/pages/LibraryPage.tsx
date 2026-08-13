/**
 * LibraryPage.tsx — C&R Space 사내 도서관
 *
 * ✅ 기능
 *  - 전체 임직원: 도서 목록 조회, 검색(제목/저자/출판사), 카테고리·상태 필터
 *  - 관리자(isAdmin): 대여 등록, 반납 처리, 도서 추가/편집/삭제, CSV 일괄 등록
 *
 * ✅ 독립 모듈
 *  - 회의실 예약과 무관하게 동작
 *  - Supabase 공유 인스턴스(jjzcqpbwkkujttwxksvy) 사용
 *  - 사용자 풀만 공유 (users prop으로 전달)
 *
 * ✅ DB 테이블
 *  - books: 도서 카탈로그
 *  - book_checkouts: 대여 이력 (active / returned / overdue / lost)
 *  - book_categories: 분류 (자기참조 트리)
 *
 * ✅ 대여 규칙
 *  - 1인 동시 2권 제한
 *  - 대여 기간: 대여일 기준 +7일 (due_at 자동 계산)
 *  - 대여/반납: 관리자가 오프라인 후 앱에 기록 (반납기한 = 대여일 + 7일 이내)
 *
 * ✅ 변경 이력
 *  - [2026-07-16] 최초 작성
 *  - [2026-07-23] BookEditModal / ImportModal / EditForm / 공통 스타일 상수를
 *                 components/library/bookFormShared.tsx 로 추출.
 *                 어드민 '도서 관리' 탭이 같은 모달을 재사용하기 위함이며,
 *                 이 파일의 동작·마크업은 변경되지 않았다.
 */

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
// 모든 상태 전이는 RPC 경유
import {
  checkoutErrorMessage,
  // ← [2026-07-21] 연체 제재 — 대여 시도 전에 사유를 알려주기 위한 조회
  fetchMyPenaltyState,
  // ← [2026-07-21] 승인 폐지. 사용자도 RPC 로 즉시 대여한다.
  userCheckoutBooksWithNotify,
  // ← [2026-07-23] RPC + 알림 발송을 묶은 래퍼 (LibraryPage / BookAdminPanel 공용)
  adminCheckoutBooksWithNotify,
  // ← [2026-07-23] 반납/분실은 RPC 경유, 도서 마스터 저장 규칙은 api 로 일원화
  adminReturnBook, returnErrorMessage,
  persistBook, deleteBookRecord, importBookRows,
  // ← [2026-07-30] 내 대여 연장 — 마이페이지와 같은 래퍼(RPC+알림)를 쓴다
  extendBookCheckoutWithNotify, extendErrorMessage,
  loadBookReservedPeriods, type BookReservedPeriod,  // ← [2026-07-30] 예약 기간 공개
} from '../lib/api'
import { BookCheckoutModal } from '../components/library/BookCheckoutModal'
// ← [2026-07-20] Figma 73:831 Home list — 리스트 UI 토큰/카드/칩 SSOT
import {
  LT, SearchIcon, BooksLogoMark, BookGridCard, GenreChip, HeroCta, HeroStat,
  HERO_FONT_SB, isNewBook, todayKST,
  // ← [2026-07-21] Figma 1366:2276 정렬순
  BookSortRow, type BookSort,
} from '../components/library/libraryListShared'
// ← [2026-07-21] 연체 판정 SSOT — 마이페이지·알림·어드민과 동일 기준 사용
import {
  daysUntilDue, hasCheckoutStarted,
  // ← [2026-07-30] 내 대여 연장 — 판정·표기 전부 bookLoan SSOT 재사용 (재계산 금지)
  ddayLabel, canExtend, extendBlockedReason, previewExtendedDue,
  dueNoticeShort, fmtDueShortKo,
  kstDateStr, fmtDateShortKo,  // ← [2026-07-30] 예약 기간 표시
} from '../utils/bookLoan'   // ← [2026-07-23] 시작 판정 SSOT
import type { BookPenaltyState } from '../types'
import { useBreakpoint } from '../hooks/useBreakpoint'
// ← [2026-07-21] Figma 1347:1991 New Collection — 최근 3개월 입고 도서 자동 슬라이드
import { NewCollectionSlider } from '../components/library/NewCollectionSlider'
// ← [2026-07-21] 도서 상세 모달 — 그리드 카드/슬라이더 카드 공용 진입점
import { BookDetailModal } from '../components/library/BookDetailModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog' // ← [2026-07-30] 반납 확인 (CTA 전수검사 P1)
// ← [2026-07-21] 승인 폐지로 '대여 신청' → '대여하기'. 파일명도 의미에 맞게 변경.
import { BookBorrowModal }  from '../components/library/BookBorrowModal'
// ← [2026-07-23] 도서 등록/편집 폼 계열 — 어드민 '도서 관리' 탭과 공용.
//   이 파일 안에 있던 BookEditModal / ImportModal / EditForm / 스타일 상수를
//   bookFormShared.tsx 로 이동했다. 로직 변경 없음(위치 이동만).
import {
  BookEditModal, BookImportModal,
  OVERLAY_STYLE, MODAL_STYLE,
  type EditForm,
} from '../components/library/bookFormShared'
import type { AppUser, ToastType } from '../types'

// ─── 로컬 타입 ────────────────────────────────────────────────────────────────

interface BookCategory {
  id:        number
  name:      string
  parent_id: number | null
  sort_order: number
}

interface BookCheckout {
  id:          string
  book_id:     number
  user_id:     string
  checkout_at: string
  due_at:      string
  returned_at: string | null
  /** ← [2026-07-30] 내 대여 연장 판정(canExtend)에 필요. 0 | 1 (DB CHECK <= 1) */
  extension_count: number
  status:      'active' | 'returned' | 'overdue' | 'lost'
  notes:       string | null
}

interface Book {
  id:          number
  category_id: number | null
  title:       string
  author:      string | null
  publisher:   string | null
  isbn:        string | null
  cover_url:   string | null
  status:      'available' | 'borrowed' | 'maintenance' | 'lost'
  notes:       string | null
  acquired_at: string | null
  new_until:   string | null   // ← [2026-07-20] ⭐NEW⭐ 노출 종료일
  created_at:  string
  updated_at:  string
  category?:   BookCategory | null
}


// ─── Props ────────────────────────────────────────────────────────────────────

interface LibraryPageProps {
  isAdmin:    boolean
  users:      AppUser[]
  authUserId: string
  showToast:  (msg: string, type: ToastType) => void
  /** ← [2026-07-30] '나의 도서 대여' CTA → 마이페이지 > 도서 대여 탭 이동 */
  onGoMyLoans: () => void
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const MAX_BORROW_PER_USER = 2
const BORROW_DAYS         = 7


// ─── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * 연체 여부 — 판정 SSOT 는 utils/bookLoan.ts 의 daysUntilDue 다.
 *
 * ← [2026-07-21 버그픽스] 기존 구현은 `new Date(dueAt) < new Date()` 로
 *   **시각까지** 비교했다. 그런데 마이페이지·알림·어드민은 bookLoan 의
 *   daysUntilDue(날짜 단위)를 쓴다. 두 기준이 달라 반납기한 당일에만
 *   화면끼리 어긋났다.
 *
 *     반납기한 2026-07-23 12:00 인 대여 건
 *       09:00 → 이 화면 정상 / 마이페이지 정상   (일치)
 *       13:00 → 이 화면 "연체" / 마이페이지 정상 (불일치)
 *
 *   대여자는 "오늘까지 반납" 메일을 받았는데 도서관 화면에는 이미 연체로
 *   찍히는 상태였다. 정책 문구가 "대여일 + 7일 **이내** 반납"이므로
 *   시각 단위 판정 자체가 정책과 어긋난다 → 날짜 단위로 통일한다.
 */
function isOverdue(dueAt: string): boolean {
  return daysUntilDue(dueAt) < 0
}


// ─── BookCard 제거됨 [2026-07-20] ───────────────────────────────────────────
//   Figma 73:831 Home list 반영으로 카드/뱃지/표지 렌더가 전면 교체됐다.
//   → src/components/library/libraryListShared.tsx 의 BookGridCard 사용.
//   StatusBadge / CoverPlaceholder / formatDue / formatAcquired 도 함께 이관·정리.

// ─── CheckoutModal 제거됨 [2026-07-22] ──────────────────────────────────────
//   → src/components/library/BookCheckoutModal.tsx (Admin, 복수 도서 + RPC)
//   → src/components/library/BookBorrowModal.tsx   (사용자 자가 대여)




// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function LibraryPage({ isAdmin, users, authUserId, showToast, onGoMyLoans }: LibraryPageProps) {
  // ── Data State ──
  const [books,          setBooks]          = useState<Book[]>([])
  const [categories,     setCategories]     = useState<BookCategory[]>([])
  const [activeCheckouts, setActiveCheckouts] = useState<BookCheckout[]>([])
  // ← [2026-07-30] 예약 기간 공개: 전 도서 live 구간(기간만, RPC) + 미시작 예약 원본 행.
  //   futureCheckouts 는 RLS 상 관리자에겐 전체·비관리자에겐 본인 것만 — 예약자명 매칭용
  const [reservedPeriods, setReservedPeriods] = useState<BookReservedPeriod[]>([])
  const [futureCheckouts, setFutureCheckouts] = useState<BookCheckout[]>([])
  const [loading,        setLoading]        = useState(true)

  // ── UI State ──
  const [searchQ,        setSearchQ]        = useState('')
  // ← [2026-07-20] Figma 103:70 '⭐NEW⭐' 칩 — 이번 달 취득 도서만
  const [filterCategory, setFilterCategory] = useState<number | 'ALL' | 'NEW'>('ALL')
  // ← [2026-07-20] 통계 4칸이 그대로 필터 버튼이 되므로 'overdue' 추가.
  //   3칸만 눌리고 연체중만 안 눌리면 일관성이 깨진다.
  const [filterStatus,   setFilterStatus]   = useState<'all' | 'available' | 'borrowed' | 'overdue'>('all')

  // ── Modal State ──
  const [checkoutModal,  setCheckoutModal]  = useState<Book | null>(null)
  // Admin 대여 등록 / 사용자 대여하기 — 책 미선택(헤더) 진입용 플래그
  const [checkoutOpen,   setCheckoutOpen]   = useState(false)
  const [borrowModal,    setBorrowModal]    = useState<Book | null>(null)
  const [borrowOpen,     setBorrowOpen]     = useState(false)
  // ← [2026-07-21] 본인 보유 권수. 승인 폐지로 pending 이 사라져 active 만 센다
  //   (예약도 status='active' 라 자동 포함 — 서버 한도 산식과 동일)
  const [myHeldCount,    setMyHeldCount]    = useState(0)
  // ← [2026-07-21] 연체 제재 상태. 관리자도 본인 대여는 제한되지만,
  //   관리자 대여 등록(타인 지정)은 대여자 기준으로 서버가 판정하므로
  //   여기 값은 '본인이 빌릴 수 있는가' 에만 쓴다.
  const [penalty, setPenalty] = useState<BookPenaltyState>({
    blocked: false, tier: null, blockedUntil: null, overdueDays: 0, reason: null,
  })
  const [heldCountByUser, setHeldCountByUser] = useState<Record<string, number>>({})
  // ← [2026-07-30] 내 대여 연장 진행중인 checkout id (버튼 비활성/라벨용)
  const [extendingId, setExtendingId] = useState<string | null>(null)

  // ← [2026-07-22] 로그인 사용자 정보 — 신청 모달 아바타 / 승인 처리자 이름 기록용
  //   프로필은 항상 users(live)에서 조회 (스냅샷 금지 원칙)
  const me = useMemo(
    () => users.find(u => u.user_id === authUserId) ?? null,
    [users, authUserId]
  )
  const currentUserName = me?.name ?? null
  const [editModal,      setEditModal]      = useState<{ book: Book | null } | null>(null)
  const [importModal,    setImportModal]    = useState(false)
  const [actionLoading,  setActionLoading]  = useState(false)
  const [deleteConfirm,  setDeleteConfirm]  = useState<Book | null>(null)
  // ← [2026-07-30 CTA 전수검사 P1] 반납 확인 — 반납은 불가역이고 연체 건이면 제재
  //   확정+알림까지 연쇄되는데 카드·상세에서 원클릭이었다 (어드민 패널의 returnTarget
  //   확인 모달과 불일치). 실행은 기존 handleReturn 그대로, 앞에 확인만 세운다.
  const [returnConfirm, setReturnConfirm] = useState<{ book: Book; checkout: BookCheckout } | null>(null)
  //  ← [2026-07-21] 도서 상세 모달. 그리드 카드 클릭과 New Collection 카드 클릭이
  //     같은 상태를 연다(모달이 두 벌로 갈리지 않도록).
  const [detailModal,    setDetailModal]    = useState<Book | null>(null)
  //  ← [2026-07-21] 목록 정렬 (Figma 1366:2276). 기본 '최신 순'.
  const [sortBy,         setSortBy]         = useState<BookSort>('recent')
  //  누적 대여 횟수 맵 — '인기 순' 전용. get_book_checkout_counts() RPC 로만 채운다.
  //  (RLS 상 비관리자는 본인 대여 행만 볼 수 있어 클라이언트 집계가 불가능하다)
  const [popularity,     setPopularity]     = useState<Record<number, number>>({})

  // ─── 데이터 로드 ───────────────────────────────────────────────────────────

  async function load() {
    setLoading(true)
    try {
      // 1. 도서 목록 + 카테고리 join
      const { data: booksData, error: bErr } = await supabase
        .from('books')
        .select('*, category:book_categories(id, name, parent_id, sort_order)')
        .order('title')
      if (bErr) throw bErr

      // 2. 카테고리
      const { data: catData, error: cErr } = await supabase
        .from('book_categories')
        .select('*')
        .order('sort_order')
      if (cErr) throw cErr

      // 3. 대여기록
      //   ← [2026-07-21] 승인 폐지로 pending 조회 제거. active/overdue 가 곧 점유다.
      //     예약(미래 시작)도 status='active' 이므로 같은 질의로 잡힌다.
      //     RLS(book_checkouts_select_self_or_admin)가 비관리자에겐 본인 행만
      //     반환하므로, 일반 사용자는 자기 보유 권수만 정확히 알게 된다.
      const { data: coData } = await supabase
        .from('book_checkouts')
        .select('id, book_id, user_id, checkout_at, due_at, returned_at, extension_count, status, notes')   // ← [2026-07-30] 연장 판정에 extension_count 필요
        .in('status', ['active', 'overdue'])
      const allCheckouts = (coData ?? []) as BookCheckout[]

      // 카드에 "지금 대여중"으로 표시할 건은 이미 시작된 것만.
      // 미래 예약은 도서를 잠그지 않으므로 카드에 대여자를 띄우면 안 된다.
      //
      // ← [2026-07-23] 절대 시각 비교(new Date(checkout_at) <= now)를
      //   hasCheckoutStarted(KST 날짜)로 교체했다. 대여일은 KST 정오로 저장되는데
      //   books.status 잠금은 KST '날짜' 기준이라, 오전(00:00~11:59)에는
      //   카드가 '대여중'인데 대여자·반납기한 행만 사라지는 상태가 됐었다.
      //   판정식은 utils/bookLoan.hasCheckoutStarted / DB book_checkout_started() 가 SSOT.
      const now = new Date()
      const checkouts = allCheckouts.filter(c => hasCheckoutStarted(c.checkout_at, now))
      // ← [2026-07-30] 미시작 예약은 별도 보관 — 상세 모달 예약자명 매칭(관리자)용.
      //   카드 '대여중' 판정(checkouts)에는 계속 미포함 (books.status 를 안 잠그는 설계와 일치)
      setFutureCheckouts(allCheckouts.filter(c => !hasCheckoutStarted(c.checkout_at, now)))

      // 보유 권수 맵 (예약 포함 — 서버 한도 산식과 동일)
      const heldMap: Record<string, number> = {}
      allCheckouts.forEach(c => { heldMap[c.user_id] = (heldMap[c.user_id] ?? 0) + 1 })

      // 4. 누적 대여 횟수 (인기 순 정렬용)
      //   ← [2026-07-21] 왜 RPC 인가: book_checkouts SELECT 정책이 비관리자에게
      //     본인 행만 돌려주므로 클라이언트 집계는 사용자마다 다른 순위를 만든다.
      //     get_book_checkout_counts() 는 SECURITY DEFINER 로 집계값만 반환한다.
      //     실패해도 목록 자체는 살아 있어야 하므로 throw 하지 않고 빈 맵으로 둔다
      //     (인기 순 선택 시 전부 0 → 제목순으로 안정 정렬).
      const { data: popData, error: pErr } = await supabase.rpc('get_book_checkout_counts')
      const popMap: Record<number, number> = {}
      if (!pErr) {
        ;(popData ?? []).forEach((r: { book_id: number; checkout_count: number }) => {
          popMap[r.book_id] = Number(r.checkout_count) || 0
        })
      }

      setBooks((booksData ?? []) as Book[])
      setPopularity(popMap)
      setCategories((catData ?? []) as BookCategory[])
      setActiveCheckouts(checkouts)
      // ← [2026-07-30] 전 도서 예약/대여 구간 (기간만) — 실패 시 [] 로 표시만 생략
      setReservedPeriods(await loadBookReservedPeriods())
      setHeldCountByUser(heldMap)
      setMyHeldCount(heldMap[authUserId] ?? 0)
    } catch (e: any) {
      showToast('도서 목록을 불러올 수 없습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 대여기록 맵 ───────────────────────────────────────────────────────────
  //   ← [2026-07-20] 선언 위치를 필터링 위로 올렸다.
  //     '연체중' 필터가 due_at 을 봐야 해서 filteredBooks 가 이 맵에 의존한다.
  //     아래에 두면 TDZ(선언 전 참조)로 런타임에 터진다.
  const checkoutMap = useMemo(() => {
    const m: Record<number, BookCheckout> = {}
    activeCheckouts.forEach(c => { m[c.book_id] = c })
    return m
  }, [activeCheckouts])

  // ─── 내 대여 차단 상태 (← [2026-07-21]) ───────────────────────────────────
  //   load() 안에 넣지 않은 이유: 도서 목록 로드 실패가 제재 조회를 막거나
  //   그 반대가 되면 안 된다. 서로 독립적으로 실패할 수 있어야 한다.
  useEffect(() => {
    if (!authUserId) return
    let alive = true
    fetchMyPenaltyState()
      .then(st => { if (alive) setPenalty(st) })
      .catch(() => { /* 조회 실패 시 차단 아님으로 둔다 — 서버가 재검사한다 */ })
    return () => { alive = false }
  }, [authUserId, books])   // 반납/대여 후 load() 로 books 가 갱신되면 함께 재조회

  // ─── 연체 도서 id 집합 (← [2026-07-21] New Collection 슬라이더 뱃지용) ────
  //   연체는 books.status 로 표현되지 않고 대여기록의 due_at 으로만 판정된다.
  //   슬라이더에 books 만 넘기면 연체 책이 '대여중'으로 보이므로, 목록 카드와
  //   같은 isOverdue(= bookLoan.daysUntilDue) 판정으로 계산해 함께 넘긴다.
  const overdueBookIds = useMemo(() => {
    const set = new Set<number>()
    activeCheckouts.forEach(c => { if (isOverdue(c.due_at)) set.add(c.book_id) })
    return set
  }, [activeCheckouts])

  // ─── 내가 대여 중인 도서 (← [2026-07-21] 목록 최상단 고정용) ──────────────
  //   activeCheckouts 는 이미 "시작된 대여"만 담고 있다(예약 제외).
  //   예약은 아직 손에 없는 책이라 '내 책' 으로 끌어올리면 카드의 '대여가능'
  //   뱃지와 어긋나 혼란스럽다.
  const myBookIds = useMemo(() => {
    const set = new Set<number>()
    activeCheckouts.forEach(c => { if (c.user_id === authUserId) set.add(c.book_id) })
    return set
  }, [activeCheckouts, authUserId])

  // ─── 필터링 ────────────────────────────────────────────────────────────────

  const filteredBooks = useMemo(() => {
    let list = books
    // 검색
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.publisher?.toLowerCase().includes(q)
      )
    }
    // 카테고리 / 신규
    if (filterCategory === 'NEW') {
      // ← [2026-07-20] 카드 뱃지와 완전히 같은 판정을 쓴다 (isNewBook 이 SSOT).
      //   예전에는 여기서 '이번 달 취득분'을 따로 계산해 뱃지와 어긋날 수 있었다.
      list = list.filter(b => isNewBook(b))
    } else if (filterCategory !== 'ALL') {
      list = list.filter(b => b.category_id === filterCategory)
    }
    // 상태
    if (filterStatus === 'available') {
      list = list.filter(b => b.status === 'available')
    } else if (filterStatus === 'borrowed') {
      list = list.filter(b => b.status === 'borrowed')
    } else if (filterStatus === 'overdue') {
      // 연체는 books 가 아니라 대여기록의 due_at 으로 판정된다
      list = list.filter(b => {
        const c = checkoutMap[b.id]
        return !!c && isOverdue(c.due_at)
      })
    }
    // ── 정렬 (Figma 1366:2276) ───────────────────────────────────────────
    //   ← [2026-07-21] filter 는 원본 배열을 참조로 넘길 수 있으므로
    //     sort 전에 반드시 복사한다. 아래 filter 들을 하나도 안 거친 경우
    //     list === books 라서 그대로 sort 하면 state 배열을 제자리에서
    //     뒤집어 버린다(React 가 변경을 감지 못 해 화면이 안 바뀐다).
    const sorted = [...list]
    const byTitle = (a: Book, b: Book) => a.title.localeCompare(b.title, 'ko')
    if (sortBy === 'title') {
      sorted.sort(byTitle)
    } else if (sortBy === 'recent') {
      // 입고일 내림차순. 입고일 미입력은 항상 뒤로 (빈 문자열이 먼저 오면
      // '최신'인 척 상단을 차지한다). 동률은 제목순으로 고정 — 안 그러면
      // 렌더마다 순서가 흔들려 보인다.
      sorted.sort((a, b) => {
        const da = a.acquired_at ?? ''
        const db = b.acquired_at ?? ''
        if (!da && !db) return byTitle(a, b)
        if (!da) return 1
        if (!db) return -1
        if (da !== db) return db.localeCompare(da)
        return byTitle(a, b)
      })
    } else {
      // 인기 순 = 누적 대여 횟수 내림차순. 기록이 없으면 0.
      sorted.sort((a, b) => {
        const ca = popularity[a.id] ?? 0
        const cb = popularity[b.id] ?? 0
        if (ca !== cb) return cb - ca
        return byTitle(a, b)
      })
    }
    // ── 내 대여 도서 최상단 고정 (← [2026-07-21] 복원) ──────────────────
    //
    //   목록을 훑는 목적은 대부분 "내가 빌린 책이 뭐였지 / 언제까지지" 다.
    //   300권 사이에서 그걸 찾게 하지 않는다.
    //
    //   검색 중일 때는 적용하지 않는다. 검색은 목표가 분명한 행위라
    //   관련도 순서를 흔들면 오히려 방해가 된다. 카테고리/상태 필터는
    //   그대로 둔다 — 걸러진 결과 안에서 내 책이 먼저 오는 건 자연스럽다.
    //
    //   sort 안에서 처리하지 않고 분리한 이유: 정렬 비교 함수에 조건을
    //   끼워 넣으면 '제목순'·'인기순' 각각의 규칙이 오염돼 나중에
    //   정렬 하나를 고칠 때 이 규칙까지 같이 깨진다.
    if (!searchQ.trim() && myBookIds.size > 0) {
      const mine: Book[] = []
      const rest: Book[] = []
      // 정렬 결과 안에서의 상대 순서는 그대로 유지한다(안정 분할).
      for (const b of sorted) (myBookIds.has(b.id) ? mine : rest).push(b)
      return [...mine, ...rest]
    }

    return sorted
  }, [books, searchQ, filterCategory, filterStatus, checkoutMap, sortBy, popularity, myBookIds])

  // ─── 대여 등록 ──────────────────────────────────────────────────────────────

  // ── [Admin] 대여 등록 — admin_checkout_books RPC (여러 권 단일 트랜잭션)
  //   기존 개별 INSERT+UPDATE 방식은 N권 처리 시 부분 실패로
  //   "책은 borrowed 인데 대여기록 없음" 유령 데이터가 생겨 RPC 로 이관했다.
  async function handleCheckout(
    userId: string, bookIds: number[], notes: string,
    /** ← [2026-07-20] 대여일('YYYY-MM-DD') */
    checkoutAt?: string,
    /** ← [2026-08-13] 반납기한('YYYY-MM-DD') — 미지정 시 대여일 +7일(서버 기본) */
    dueOn?: string,
  ) {
    setActionLoading(true)
    try {
      // ← [2026-07-23] RPC 호출 + 대여 알림 페이로드 조립을 api 로 이동.
      //   어드민 '도서 관리' 탭도 같은 경로를 쓴다. 알림 필드 이름이 한 글자만
      //   달라도 인앱 본문이 깨지므로(2026-07-20 사례) 규칙을 한 곳에 고정한다.
      const titles = bookIds
        .map(id => books.find(b => b.id === id)?.title)
        .filter(Boolean) as string[]

      const res = await adminCheckoutBooksWithNotify(userId, bookIds, notes, titles, checkoutAt, dueOn)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail) + (res.code === 'PERIOD_CONFLICT' ? conflictPeriodText(res.detail) : ''), 'error')
        await load()
        return
      }

      if (res.deferredNotify) {
        showToast(`${checkoutAt}부터 대여 예정으로 등록했습니다 (알림 미발송)`, 'success')
      } else {
        showToast(`대여 등록 완료 (${bookIds.length}권)`, 'success')
      }
      setCheckoutModal(null)
      setCheckoutOpen(false)
      await load()
    } catch (e: any) {
      showToast(`대여 등록 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ── [사용자] 자가 대여 — user_checkout_books RPC (← [2026-07-21])
  //   승인 절차가 없다. 서버가 본인·한도·예약범위(오늘~+3일)·기간 겹침을
  //   모두 검증하고 즉시 대여를 성립시킨다.
  // ← [2026-07-30] PERIOD_CONFLICT 시 로컬 데이터로 충돌 구간 병기 (D3 대체 —
  //   RPC detail 은 'id:제목' 그대로 두고, 기간은 이미 들고 있는 reservedPeriods 에서 찾는다)
  function conflictPeriodText(detail?: string): string {
    const bookId = Number((detail ?? '').split(':')[0])
    if (!bookId) return ''
    const today = kstDateStr(Date.now())
    const ps = reservedPeriods
      .filter(p => p.book_id === bookId && p.due_on >= today)
      .sort((a, z) => a.start_on.localeCompare(z.start_on))
      .slice(0, 2)
    if (ps.length === 0) return ''
    return ` (예약: ${ps.map(p => `${fmtDateShortKo(p.start_on)}~${fmtDateShortKo(p.due_on)}`).join(', ')})`
  }

  async function handleUserBorrow(bookIds: number[], notes: string, checkoutAt?: string) {
    setActionLoading(true)
    try {
      const titles = bookIds
        .map(id => books.find(b => b.id === id)?.title)
        .filter(Boolean) as string[]

      const res = await userCheckoutBooksWithNotify(bookIds, notes, titles, checkoutAt)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail) + (res.code === 'PERIOD_CONFLICT' ? conflictPeriodText(res.detail) : ''), 'error')
        await load()
        return
      }

      showToast(
        res.deferredNotify
          ? `${checkoutAt}부터 대여 예정으로 등록했습니다`
          : `대여 완료 (${bookIds.length}권)`,
        'success',
      )
      setBorrowModal(null)
      setBorrowOpen(false)
      await load()
    } catch (e: any) {
      showToast(`대여 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 반납 처리 ──────────────────────────────────────────────────────────────
  //   ← [2026-07-23] 클라이언트 2단 UPDATE → admin_return_book RPC 경유로 변경.
  //     기존 방식은 book_checkouts UPDATE 와 books UPDATE 가 서로 다른 요청이라
  //     사이에 실패가 끼면 "대여기록은 반납완료인데 도서는 대여중"인 행이 남았다.
  //     그 도서는 활성 대여가 없어 반납 버튼도 노출되지 않아 화면에서 복구가
  //     불가능했다. 재시도 코드로 덮지 않고 두 갱신을 DB 트랜잭션으로 묶는다.

  async function handleReturn(_book: Book, checkout: BookCheckout) {
    setActionLoading(true)
    try {
      const res = await adminReturnBook(checkout.id, 'return')
      if (!res.ok) { showToast(returnErrorMessage(res.code!), 'error'); return }
      showToast('반납 처리 완료', 'success')
      await load()
    } catch (e: any) {
      showToast(`반납 처리 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 내 대여 연장 (← [2026-07-30]) ──────────────────────────────────────────
  //   마이페이지 doExtend 와 같은 api 래퍼(extendBookCheckoutWithNotify) 경유.
  //   성공 시 전체 재조회 대신 해당 행만 서버 반환값(due_at/extension_count)으로
  //   교체 — 목록 300권 재조회로 화면이 출렁일 이유가 없다. 실패 시엔 실제
  //   상태와 어긋났을 수 있으므로 재조회한다(마이페이지와 동일 정책).

  async function handleExtend(checkout: BookCheckout) {
    if (extendingId) return
    setExtendingId(checkout.id)
    try {
      const title = books.find(b => b.id === checkout.book_id)?.title ?? ''
      const res = await extendBookCheckoutWithNotify(checkout.id, {
        userId: authUserId, bookTitle: title,
      })
      if (!res.ok || !res.row) {
        showToast(extendErrorMessage(res.code ?? 'UNKNOWN'), 'error')
        await load()
        return
      }
      const updated = res.row
      setActiveCheckouts(prev => prev.map(c =>
        c.id === updated.id
          ? { ...c, due_at: updated.due_at, extension_count: updated.extension_count }
          : c
      ))
      showToast(`연장되었습니다 · ${dueNoticeShort(updated.due_at)}`, 'success')
    } catch (e: any) {
      showToast(e?.message ?? '연장에 실패했습니다', 'error')
    } finally {
      setExtendingId(null)
    }
  }

  /**
   * 카드/상세모달에 넘길 "내 대여" 파생값 묶음.
   *   타인 대여면 null — 뱃지·연장 UI 자체가 뜨지 않는다.
   *   판정·문구는 전부 bookLoan SSOT. 화면별 재계산을 금지해 마이페이지의
   *   연장 가능 여부와 어긋나지 않게 한다.
   */
  function buildMyLoan(checkout: BookCheckout | null) {
    if (!checkout || checkout.user_id !== authUserId) return null
    const ok = canExtend(checkout)
    return {
      dday:          ddayLabel(checkout.due_at),
      overdue:       isOverdue(checkout.due_at),
      canExtend:     ok,
      blockedReason: extendBlockedReason(checkout),
      extending:     extendingId === checkout.id,
      extendedDueShort: ok ? fmtDueShortKo(previewExtendedDue(checkout.due_at)) : null,
      onExtend:      () => handleExtend(checkout),
    }
  }

  // ─── 도서 저장 (추가/편집) ───────────────────────────────────────────────────
  //   ← [2026-07-23] payload 조립·표지 Storage 이관 로직을 api.persistBook 으로
  //     이동. 어드민 '도서 관리' 탭과 동일한 규칙을 쓰기 위함이며, 여기서는
  //     화면 상태와 토스트만 담당한다.

  async function handleSaveBook(form: EditForm, kakaoItem?: any) {
    if (!editModal) return
    setActionLoading(true)
    const isNew = editModal.book === null
    try {
      await persistBook(form, editModal.book, kakaoItem)
      showToast(isNew ? '도서를 추가했습니다.' : '도서 정보를 수정했습니다.', 'success')
      setEditModal(null)
      await load()
    } catch (e: any) {
      showToast(`저장 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 도서 삭제 ──────────────────────────────────────────────────────────────

  async function handleDelete(book: Book) {
    setActionLoading(true)
    try {
      // 대여 이력(반납분 포함)이 있으면 FK 제약으로 삭제 불가 → api 가 blocked 로 반환
      const res = await deleteBookRecord(book.id)
      if (res.blocked) {
        showToast('대여 이력이 있는 도서는 삭제할 수 없습니다. 상태를 "분실"로 변경하세요.', 'warning')
        setDeleteConfirm(null)
        return
      }
      showToast('도서를 삭제했습니다.', 'success')
      setDeleteConfirm(null)
      await load()
    } catch (e: any) {
      showToast(`삭제 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── CSV 일괄 등록 ───────────────────────────────────────────────────────────

  async function handleImport(rows: any[]) {
    setActionLoading(true)
    try {
      const { success, errors } = await importBookRows(rows)
      if (errors.length > 0) showToast(`${success}건 등록, ${errors.length}건 오류`, 'warning')
      else                   showToast(`${success}건 일괄 등록 완료`, 'success')
      setImportModal(false)
      await load()
    } catch (e: any) {
      showToast(`일괄 등록 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────


  // 통계
  const { isMobile } = useBreakpoint()   // ← [2026-07-20] Figma 1400 데스크톱 기준 → 모바일 대응

  const stats = useMemo(() => ({
    total:     books.length,
    available: books.filter(b => b.status === 'available').length,
    borrowed:  books.filter(b => b.status === 'borrowed').length,
    overdue:   isAdmin
      ? activeCheckouts.filter(c => isOverdue(c.due_at)).length
      : 0,
  }), [books, activeCheckouts, isAdmin])

  return (
    // ← [2026-07-21] 페이지 바탕 #F6F6F6 (Figma 1340:1342)
    <div style={{ minHeight: '100vh', background: LT.pageBg, paddingBottom: 60 }}>
      <div style={{ maxWidth: LT.pageMax, margin: '0 auto' }}>

        {/* ══════════════════════════════════════════════════════════════════
            Hero — Figma 73:834
              padding 24 / gap 40 / radius 24
            ══════════════════════════════════════════════════════════════════ */}
        <section style={{
          display: 'flex', flexDirection: 'column',
          gap: isMobile ? 24 : LT.heroGap,
          // ← [2026-07-21] Hero 자체 흰 배경 제거 — 페이지 바탕(#F6F6F6)이 그대로 비친다
          padding: LT.pagePad, borderRadius: LT.heroRadius, background: 'transparent',
        }}>

          {/* 로고 ↔ CTA 그룹 (Figma 1333:565 — space-between) */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 16, width: '100%', flexWrap: 'wrap',
          }}>
            {/* 로고 (Figma 73:835 — gap 12 / items-end) */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <BooksLogoMark scale={isMobile ? 0.55 : 1} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                <span style={{ fontSize: isMobile ? 13 : 16, lineHeight: 1, color: LT.black, whiteSpace: 'nowrap' }}>
                  씨엔알리서치 사내 도서관
                </span>
                <span style={{ fontSize: isMobile ? 16 : 20, lineHeight: 1, color: LT.black, whiteSpace: 'nowrap' }}>
                  C&amp;R BOOKS
                </span>
              </div>
            </div>

            {/* CTA (Figma 1339:1162 — gap 8)
                ← [2026-07-21] 권한별 분기
                  · 관리자   : 대여 등록(타인 지정) / 도서 추가 / 일괄 등록
                  · 일반사용자: 대여하기 1개만 (승인 폐지 — 즉시 성립)
                Figma 는 4개를 한 줄에 다 그려 두었지만 그건 두 역할의 합집합이다. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isAdmin ? (
                <>
                  <HeroCta primary onClick={() => setCheckoutOpen(true)}>대여 등록</HeroCta>
                  <HeroCta onClick={() => setEditModal({ book: null })}>도서 추가</HeroCta>
                  <HeroCta onClick={() => setImportModal(true)}>일괄 등록</HeroCta>
                </>
              ) : (
                <HeroCta
                  primary
                  onClick={() => {
                    // 제재 중이면 모달을 열지 않고 사유만 알린다.
                    // 모달을 열어두고 확인 버튼만 막으면 도서를 고르고 나서야
                    // 안 된다는 걸 알게 되어 헛수고를 시킨다.
                    if (penalty.blocked) {
                      showToast(penalty.reason ?? '연체 제재로 대여할 수 없습니다', 'error')
                      return
                    }
                    setBorrowOpen(true)
                  }}>
                  {penalty.blocked ? '대여 제한' : '대여하기'}
                </HeroCta>
              )}
              {/* ← [2026-07-30] 마이페이지 > 도서 대여 탭으로 이동.
                  관리자·일반 공통 — 관리자도 개인 대여 현황은 마이페이지에서 본다. */}
              <HeroCta onClick={onGoMyLoans}>나의 도서 대여</HeroCta>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              New Collection — Figma 1347:1991
                Hero 안, 로고행(y 24) ↔ 통계·검색(y 589.7) 사이.
                Hero 가 flex-col gap 40 이므로 별도 상단 여백은 주지 않는다.

                대상: acquired_at 최근 3개월 입고분 (isRecentAcquisition SSOT).
                     ⭐NEW⭐(new_until) 와는 독립 — 여기서 검색/필터 상태는
                     건드리지 않고, 카드 클릭 시 기존 검색어 상태만 채운다.
                3개월 내 입고분이 없으면 컴포넌트가 스스로 null 을 반환한다.
              ══════════════════════════════════════════════════════════════ */}
          <NewCollectionSlider
            books={books}
            isMobile={isMobile}
            overdueBookIds={overdueBookIds}
            onSelect={b => {
              // 슬라이더는 축약 필드(SlideBook)만 갖고 있다. 상세 모달은 전체
              // 필드가 필요하므로 id 로 원본 Book 을 되찾아 넘긴다.
              const full = books.find(x => x.id === b.id)
              if (full) setDetailModal(full)
            }}
          />

          {/* 통계 + 검색 (Figma 1332:520 — gap 40 / items-end) */}
          <div style={{
            display: 'flex', width: '100%',
            gap: isMobile ? 20 : LT.heroGap,
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'flex-end',
          }}>
            {/* 통계 = 상태 필터 (Figma 1339:1168 — gap 32)
                ← [2026-07-20] 표시 전용이던 통계가 그대로 필터 버튼이 된다.
                  선택된 항목만 불투명 + 하단 라인으로 표시한다. */}
            <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexShrink: 0 }}>
              <HeroStat
                label="전체 도서" value={stats.total} valueColor={LT.black}
                labelWeight={HERO_FONT_SB}
                active={filterStatus === 'all'}
                onClick={() => setFilterStatus('all')}
              />
              <HeroStat
                label="대여가능" value={stats.available} valueColor={LT.statAvail}
                active={filterStatus === 'available'}
                onClick={() => setFilterStatus('available')}
              />
              <HeroStat
                label="대여중" value={stats.borrowed} valueColor={LT.statBusy}
                active={filterStatus === 'borrowed'}
                onClick={() => setFilterStatus('borrowed')}
              />
              {isAdmin && stats.overdue > 0 && (
                <HeroStat
                  label="연체중" value={stats.overdue} valueColor={LT.metaOverdue}
                  active={filterStatus === 'overdue'}
                  onClick={() => setFilterStatus('overdue')}
                />
              )}
            </div>

            {/* 검색 (Figma 1339:1178 — flex 1 / gap 20 / py 12 / border-bottom #111) */}
            <div style={{
              flex: 1, minWidth: 0, display: 'flex', gap: LT.searchGap, alignItems: 'center',
              padding: '12px 0', borderBottom: `1px solid ${LT.underline}`,
            }}>
              <SearchIcon />

              {/* ← [2026-07-20] 상태 필터 pill 삭제.
                  왼쪽 통계(전체 도서/대여가능/대여중)와 같은 값을 두 번 보여주는
                  중복이었다. 통계 쪽이 숫자까지 있어 정보량이 많으므로 그쪽을
                  버튼으로 만들고 여기서는 제거 — 검색바는 검색만 담당한다. */}

              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="도서 제목, 저자, 출판사 검색"
                className="lib-search-input"
                style={{
                  flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                  fontFamily: 'inherit', fontSize: isMobile ? 16 : 24, fontWeight: 400,
                  lineHeight: 1.5, letterSpacing: '-0.456px', color: LT.ink,
                }}
              />
              <style>{`.lib-search-input::placeholder{color:${LT.placeholder};}`}</style>
            </div>
          </div>

          {/* ── 장르 칩 (Figma 1339:1306 GNB — Hero 하단 / py 24 / wrap gap 10)
              ← [2026-07-20] 좌측 사이드바(320px) → Hero 내부 전폭 가로 배열로 이동.
                컨테이너는 Hero 의 flex-col 자식이라 gap 40 이 이미 적용되므로
                Figma 의 py 24 는 아래쪽만 반영해 이중 여백을 피한다.
              ← [2026-07-21] 아래에 정렬순 행이 붙으면서 이 행의 하단 여백을
                제거했다. 그대로 두면 칩↔정렬 사이만 24 로 벌어져 두 줄이
                한 덩어리로 읽히지 않는다. 하단 여백은 정렬 행이 이어받는다. */}
          <div style={{
            width: '100%', display: 'flex', flexWrap: 'wrap', gap: 10,
          }}>
            <GenreChip active={filterCategory === 'ALL'} onClick={() => setFilterCategory('ALL')}>
              전체 장르
            </GenreChip>
            <GenreChip active={filterCategory === 'NEW'} onClick={() => setFilterCategory('NEW')}>
              ⭐NEW⭐
            </GenreChip>
            {categories.map(c => (
              <GenreChip
                key={c.id}
                active={filterCategory === c.id}
                onClick={() => setFilterCategory(c.id)}>
                {c.name}
              </GenreChip>
            ))}
          </div>

          {/* ── 정렬순 (Figma 1366:2276) ─────────────────────────────────
              장르 칩 바로 아래. 장르(무엇을 볼지)를 고른 다음 정렬(어떤 순서로
              볼지)을 고르는 순서가 자연스러워 그리드 상단이 아니라 여기에 둔다.
              Hero 의 flex-col gap 40 이 칩 행과의 간격을 만들어 버리므로
              marginTop 을 음수로 상쇄해 두 줄을 한 덩어리로 붙인다. */}
          <div style={{
            width: '100%',
            marginTop: isMobile ? -16 : -(LT.heroGap - 12),
            paddingBottom: LT.chipRowPadY,
          }}>
            <BookSortRow value={sortBy} onChange={setSortBy} />
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            카드 그리드 — Figma 1339:1205
              전폭 1352 / 5열 / 카드 251.2 / gap 24 / py 24
            ══════════════════════════════════════════════════════════════════ */}
        <main style={{ padding: `${LT.pagePad}px ${LT.pagePad}px 0` }}>

          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', fontSize: 16, color: LT.metaDept }}>
              도서 목록 불러오는 중...
            </div>
          ) : filteredBooks.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: LT.ink }}>도서가 없습니다</div>
              <div style={{ fontSize: 14, marginTop: 6, color: LT.metaDept }}>
                검색어나 필터를 바꿔보세요
              </div>
            </div>
          ) : (
            /* ← [2026-07-20] 열 정의
                 · 데스크톱: repeat(5, minmax(0,1fr)) — Figma 5열 고정.
                   auto-fill 을 쓰면 뷰포트에 따라 6열/4열로 흔들려 카드 폭이
                   Figma(251)와 어긋난다. 열 수를 고정하고 폭은 1fr 로 늘린다.
                 · 모바일: repeat(2, minmax(0,1fr)) — 2열 유지.
                   minmax(0,1fr) 이라 좌우가 항상 화면 폭에 꽉 찬다
                   (minmax(150px,...) 는 폭이 모자라면 남는 여백이 생겼다).
                   표지 높이는 고정 유지 — 잘리지 않는 현재 동작 그대로. */
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${isMobile ? 2 : LT.cardCols}, minmax(0, 1fr))`,
              columnGap: isMobile ? 12 : LT.colGap,
              rowGap: isMobile ? 20 : LT.rowGap,
              alignItems: 'start',
            }}>
              {filteredBooks.map(book => {
                const checkout = checkoutMap[book.id] ?? null
                const borrower = checkout ? users.find(u => u.user_id === checkout.user_id) : undefined
                const overdue  = checkout ? isOverdue(checkout.due_at) : false
                return (
                  <BookGridCard
                    key={book.id}
                    book={book}
                    checkout={checkout}
                    borrower={borrower}
                    isAdmin={isAdmin}
                    isOverdueStatus={overdue}
                    penaltyBlocked={!isAdmin && penalty.blocked}
                    penaltyReason={penalty.reason}
                    myLoan={buildMyLoan(checkout)}
                    onCheckout={() => isAdmin ? setCheckoutModal(book) : setBorrowModal(book)}
                    onReturn={() => { if (checkout) setReturnConfirm({ book, checkout }) }}  /* ← [2026-07-30] 확인 선행 */
                    onEdit={() => setEditModal({ book })}
                    onDelete={() => setDeleteConfirm(book)}
                    onOpenDetail={() => setDetailModal(book)}
                  />
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* ── 모달들 ── */}

      {/* ← [2026-07-21] 도서 상세 (조회 전용) — 액션은 전부 기존 핸들러로 위임.
            액션을 고르면 상세를 닫고 해당 모달로 넘긴다. 상세가 뒤에 남아 있으면
            모달이 2겹으로 쌓여 ESC/오버레이 클릭 대상이 모호해진다. */}
      {/* ← [2026-07-30 CTA 전수검사 P1] 반납 확인 다이얼로그 — 연체 건은 제재 확정 경고 병기 */}
      {returnConfirm && (
        <ConfirmDialog
          title="반납 처리"
          variant={isOverdue(returnConfirm.checkout.due_at) ? 'danger' : 'neutral'}
          confirmLabel="반납 처리"
          loading={actionLoading}
          message={
            <>
              『{returnConfirm.book.title}』을(를) 반납 처리할까요?
              {isOverdue(returnConfirm.checkout.due_at) && (
                <div style={{ marginTop: 8, color: '#B91C1C', fontWeight: 600 }}>
                  연체 상태입니다 — 반납 시 제재 등급이 확정되고 대여자에게 알림이 발송됩니다.
                </div>
              )}
            </>
          }
          onConfirm={async () => {
            await handleReturn(returnConfirm.book, returnConfirm.checkout)
            setReturnConfirm(null)
          }}
          onClose={() => setReturnConfirm(null)}
        />
      )}

      {detailModal && (() => {
        const co  = checkoutMap[detailModal.id] ?? null
        const bwr = co ? users.find(u => u.user_id === co.user_id) : undefined
        // ← [2026-07-30] 이 도서의 예약(미시작) 구간 — 기간은 RPC(전 직원), 예약자명은
        //   futureCheckouts(RLS: 관리자 전체/비관리자 본인)에서 시작일 매칭. 관리자만 병기.
        const today = kstDateStr(Date.now())
        const rsv = reservedPeriods
          .filter(p => p.book_id === detailModal.id && p.start_on > today)
          .sort((a, z) => a.start_on.localeCompare(z.start_on))
          .map(p => {
            const fc = futureCheckouts.find(c =>
              c.book_id === detailModal.id && kstDateStr(c.checkout_at) === p.start_on)
            const name = isAdmin && fc ? (users.find(u => u.user_id === fc.user_id)?.name ?? null) : null
            return { start_on: p.start_on, due_on: p.due_on, borrowerName: name }
          })
        return (
          <BookDetailModal
            book={detailModal}
            categoryName={detailModal.category?.name ?? null}
            checkout={co}
            borrower={bwr}
            isAdmin={isAdmin}
            reservedPeriods={rsv}
            isOverdueStatus={co ? isOverdue(co.due_at) : false}
            myLoan={buildMyLoan(co)}
            onClose={() => setDetailModal(null)}
            onCheckout={() => {
              const b = detailModal
              setDetailModal(null)
              if (isAdmin) setCheckoutModal(b); else setBorrowModal(b)
            }}
            onReturn={() => {
              const b = detailModal
              setDetailModal(null)
              if (co) setReturnConfirm({ book: b, checkout: co })  /* ← [2026-07-30] 확인 선행 */
            }}
            onEdit={() => {
              const b = detailModal
              setDetailModal(null)
              setEditModal({ book: b })
            }}
            onDelete={() => {
              const b = detailModal
              setDetailModal(null)
              setDeleteConfirm(b)
            }}
          />
        )
      })()}

      {/* ← [2026-07-22] 대여 등록 모달 (Admin) — 책 카드 진입 / 헤더 진입 공용 */}
      {isAdmin && (checkoutModal || checkoutOpen) && (
        <BookCheckoutModal
          initialBook={checkoutModal}
          books={books}
          users={users}
          heldCountByUser={heldCountByUser}
          maxBorrow={MAX_BORROW_PER_USER}
          borrowDays={BORROW_DAYS}
          loading={actionLoading}
          reservedPeriods={reservedPeriods}  /* ← [2026-07-30] 달력 예약 구간 비활성 */
          onClose={() => { setCheckoutModal(null); setCheckoutOpen(false) }}
          onSubmit={handleCheckout}
        />
      )}

      {/* ← [2026-07-21] 대여 모달 (일반 사용자) — 승인 없이 즉시 성립 */}
      {!isAdmin && (borrowModal || borrowOpen) && (
        <BookBorrowModal
          book={borrowModal}
          books={books}
          me={me}
          heldCount={myHeldCount}
          maxBorrow={MAX_BORROW_PER_USER}
          borrowDays={BORROW_DAYS}
          loading={actionLoading}
          penaltyBlocked={penalty.blocked}
          penaltyReason={penalty.reason}
          reservedPeriods={reservedPeriods}  /* ← [2026-07-30] 달력 예약 구간 비활성 */
          onClose={() => { setBorrowModal(null); setBorrowOpen(false) }}
          onSubmit={handleUserBorrow}
        />
      )}

      {/* 도서 추가/편집 모달 */}
      {editModal && (
        <BookEditModal
          book={editModal.book}
          categories={categories}
          onSave={handleSaveBook}
          onClose={() => setEditModal(null)}
          loading={actionLoading}
        />
      )}

      {/* 일괄 등록 모달 */}
      {importModal && (
        <BookImportModal
          categories={categories}
          onImport={handleImport}
          onClose={() => setImportModal(false)}
          loading={actionLoading}
        />
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div style={OVERLAY_STYLE} onClick={() => setDeleteConfirm(null)}>
          <div style={{ ...MODAL_STYLE, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>도서를 삭제할까요?</div>
              <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
                "{deleteConfirm.title}" 삭제 시 복구할 수 없습니다.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setDeleteConfirm(null)}
                  style={{ flex: 1, background: '#F1F5F9', color: '#374151', padding: '10px 0', borderRadius: 8 }}>
                  취소
                </button>
                <button className="btn"
                  disabled={actionLoading}
                  onClick={() => handleDelete(deleteConfirm)}
                  style={{ flex: 1, background: '#DC2626', color: '#fff', padding: '10px 0', borderRadius: 8, fontWeight: 600 }}>
                  {actionLoading ? '삭제중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
