/**
 * BookAdminPanel.tsx — Admin '도서 관리' 탭
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규.
 *
 * 📌 이 화면의 위치
 *   LibraryPage(사용자용 카드 갤러리)는 그대로 두고, 어드민에는 동일 기능을
 *   "운영자 관점"으로 다시 제공한다. 두 화면은 목적이 다르다.
 *
 *     LibraryPage  = 무엇을 빌릴까 (표지 중심 · 탐색)
 *     BookAdminPanel = 지금 어떤 상태인가 (테이블 중심 · 처리/추출)
 *
 *   UI 는 다르지만 로직은 한 벌만 쓴다. 아래 것들을 그대로 재사용한다.
 *     · 폼/모달   : bookFormShared (BookEditModal / BookImportModal)
 *     · 대여 등록 : BookCheckoutModal
 *     · 연체 판정 : utils/bookLoan (loanDisplayStatus / daysUntilDue …)
 *     · 상태 전이 : lib/api 의 RPC 래퍼 (알림 발송 포함)
 *     · CSV       : utils/csv
 *   즉 이 파일에는 "조회 · 집계 · 배치" 만 있고 규칙은 하나도 새로 만들지 않는다.
 *
 * 📌 조회 기간 정책
 *   · 개요 / 대여 이력 → 기간 필터 적용 (loadBookCheckoutsByRange)
 *   · 연체 관리        → 기간 필터 미적용 (loadOutstandingBookLoans)
 *     6개월 전에 나간 책이 아직 안 들어왔다면 이번 달 필터에서 빠져 화면에서
 *     사라진다. 연체는 기간이 아니라 상태의 문제라 모수를 분리한다.
 *
 * 📌 Figma
 *   도서 관리 화면 노드가 아직 없다. 기존 어드민(승인 관리/예약 관리)의
 *   공통 컴포넌트와 토큰을 그대로 따랐으므로, Figma 가 나오면 마크업만
 *   교체하면 된다(데이터 계층은 영향 없음).
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  loadAllBooks, loadBookCategories,
  loadBookCheckoutsByRange, loadOutstandingBookLoans,
  adminReturnBook, returnErrorMessage,
  persistBook, deleteBookRecord, importBookRows,
  adminCheckoutBooksWithNotify, checkoutErrorMessage,
  // ← [2026-07-21] 연체 제재 조회/해제
  adminListBookPenalties, revokeBookPenalty, adminExemptCheckout,
  adminCancelBookCheckout,  // ← [2026-07-30] 예약 취소 (미시작 한정)
  adminSetBookDue,          // ← [2026-08-13] 기한 자유 변경 (admin_set_book_due)
  loadBookReservedPeriods,  // ← [2026-08-13] 등록 모달·기한 달력 예약 구간 비활성용
  type BookReservedPeriod,
} from '../../lib/api'
// ← [2026-07-23] 대여 이력 조회 기준 컬럼 타입
import type { BookLoanDateField } from '../../lib/api'
import { SegmentTabBar } from '../common/SegmentTabBar'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { DataTable, type Column } from '../common/DataTable'
import { UserChip } from '../common/UserChip'
import { exportCSV } from '../../utils/csv'
import {
  loanDisplayStatus, loanStatusStyle, daysUntilDue, ddayLabel,
  fmtDueShortKo,
  // ← [2026-07-21] 연체 제재 등급 라벨 — 사용자 화면과 같은 문구를 쓴다
  penaltyTierLabel, penaltyOverdueDays, PENALTY_TIER_DAYS,
  hasCheckoutStarted,  // ← [2026-07-30] 예약(미시작) 판정 SSOT
  spanWouldConflict, kstDateStr,  // ← [2026-08-13] 기한 달력 겹침 판정(자기 자신 제외)
} from '../../utils/bookLoan'
import { isNewBook, todayKST } from './libraryListShared'
import { BookLoanDetailModal } from './BookLoanDetailModal'   // ← [2026-07-21] 대여 상세
import { BookEditModal, BookImportModal, OVERLAY_STYLE, MODAL_STYLE } from './bookFormShared'
import { BookCheckoutModal } from './BookCheckoutModal'
import type {
  AppUser, Book, BookCategory, AdminBookLoan, BookReturnAction, AdminBookPenalty,
} from '../../types'

// ─── Props ───────────────────────────────────────────────────────────────────

interface BookAdminPanelProps {
  /** 전사 사용자 — 대여자 이름/부서는 항상 여기서 live 조회 (스냅샷 금지) */
  users:         AppUser[]
  /** 로그인한 관리자 user_id — 승인/거절 처리자 이름 기록용 */
  currentUserId: string
  showToast:     (msg: string, type?: string) => void
  isMobile?:     boolean
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

// ← [2026-07-21] 승인 폐지로 'requests' 제거 (5탭 → 4탭)
// ← [2026-07-21] 연체 패널티 정책 도입으로 '대여 제한' 탭 추가 (4탭 → 5탭)
type SubTab   = 'overview' | 'books' | 'loans' | 'overdue' | 'penalties'
type QuickId  = 'd7' | 'd30' | 'd90' | 'year'
type LoanFilter = 'all' | 'active' | 'reserved' | 'returned' | 'overdue' | 'lost' | 'closed' // ← [2026-07-30] 'reserved'(예약·미시작) 추가
type BookFilter = 'all' | 'available' | 'borrowed' | 'maintenance' | 'lost'

const PER_PAGE = 15

/**
 * 대여 이력 조회 기준 컬럼 메타 (← [2026-07-23])
 *
 * 라벨/설명/파일명 접미사를 한 곳에서 관리한다. 화면 문구와 CSV 파일명이
 * 따로 놀면 "이 파일이 무슨 기준이었는지" 를 알 수 없게 된다.
 */
const LOAN_DATE_FIELD_META: Record<'checkout_at' | 'created_at', {
  label: string; short: string; desc: string
}> = {
  checkout_at: {
    label: '대여일',
    short: '대여일순',
    desc: '대여가 시작되는(또는 시작된) 날짜 기준입니다. 오늘 접수된 미래 예약은 조회 기간 밖이라 빠질 수 있습니다.',
  },
  created_at: {
    label: '생성일',
    short: '생성순',
    desc: '대여가 접수된 시각 기준입니다. 미래 예약·소급 등록을 포함해 최근 접수 순으로 정렬됩니다.',
  },
}

/** 대여 기간 — DB(admin_checkout_books)의 7일과 반드시 일치 */
const BORROW_DAYS = 7

/** 1인 동시 대여 한도 — LibraryPage / admin_checkout_books 의 값과 반드시 일치 */
const MAX_BORROW_PER_USER = 2

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────
//   'YYYY-MM-DD' 문자열을 직접 만든다. new Date('YYYY-MM-DD') 는 UTC 자정으로
//   해석돼 KST 기준 하루가 밀린다 (프로젝트 전반의 확정 규칙).

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgoStr(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return ymd(d)
}
function startOfYearStr(): string {
  return `${new Date().getFullYear()}-01-01`
}
/**
 * ISO → 'YYYY-MM-DD'. 시각 성분은 버린다.
 *
 * ※ 브라우저 로컬 타임존 기준이다. Intl 로 'Asia/Seoul' 을 강제하지 않는 이유는
 *   연체 판정 SSOT 인 utils/bookLoan.ts(daysUntilDue / fmtDueShortKo)가 로컬
 *   기준이기 때문이다. 여기서만 KST 를 강제하면 표에 찍힌 날짜와 D-day 뱃지가
 *   서로 다른 기준을 쓰게 되어, 해외 접속 시 "연체인데 기한은 내일"처럼 어긋난다.
 *   사내 사용자는 전원 KST 이므로 실사용 결과는 동일하다.
 *   (타임존 정책을 바꾼다면 bookLoan.ts 를 먼저 바꾸고 여기가 따라가야 한다)
 */
function dateOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return ymd(d)
}
/** ISO → 'YYYY-MM' (dateOf 와 동일 기준) */
function monthOf(iso: string | null | undefined): string {
  return dateOf(iso).slice(0, 7)
}
/** ISO → 'MM-DD HH:mm' (← [2026-07-23] 생성일시 열 — 같은 날 접수 순서를 봐야 한다) */
function dateTimeOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── 공통 스타일 ──────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #EEF1F6', borderRadius: 16, padding: 18,
}
const SECTION_TITLE: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 12,
}
const BTN_DARK: React.CSSProperties = {
  background: '#111', color: '#fff', borderRadius: 8,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
}
const BTN_LIGHT: React.CSSProperties = {
  background: '#F1F5F9', color: '#374151', borderRadius: 8,
  padding: '8px 14px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
}
const BTN_MINI: React.CSSProperties = {
  borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
}

// ─── 통계 카드 ────────────────────────────────────────────────────────────────

function StatCard({ label, value, unit = '권', color = '#111', hint }: {
  label: string; value: number; unit?: string; color?: string; hint?: string
}) {
  return (
    <div style={{ ...CARD, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#8B94A7', fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 12, color: '#8B94A7' }}>{unit}</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: '#A5AEC0', marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

// ─── 미니 막대 차트 (월별 추이) ───────────────────────────────────────────────
//   Recharts 를 쓰지 않는다 — 어드민 대시보드에서 이미 제거한 의존성이고,
//   순수 SVG 로 충분한 표현이다.

function MiniBarChart({ data }: { data: { label: string; count: number }[] }) {
  const [hov, setHov] = useState<number | null>(null)
  if (!data.length) {
    return <div style={{ padding: 30, textAlign: 'center', color: '#A5AEC0', fontSize: 13 }}>표시할 데이터가 없습니다</div>
  }
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, paddingBottom: 24, position: 'relative' }}>
      {data.map((d, i) => {
        const pct = d.count > 0 ? Math.max((d.count / max) * 100, 4) : 0
        return (
          <div key={d.label}
            onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'flex-end', gap: 4, position: 'relative' }}>
            {(hov === i || d.count === max) && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#4F46E5' }}>{d.count}</span>
            )}
            <div style={{
              width: '100%', height: `${pct}%`, minHeight: d.count > 0 ? 3 : 0,
              borderRadius: '5px 5px 0 0',
              background: hov === i ? '#4338CA' : '#A5B4FC',
              transition: 'height .35s ease, background .15s ease',
            }} />
            <span style={{ position: 'absolute', bottom: -20, fontSize: 10, color: '#94A3B8', whiteSpace: 'nowrap' }}>
              {d.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── 순위 리스트 ──────────────────────────────────────────────────────────────

function RankList({ rows, unit = '건', empty = '데이터가 없습니다' }: {
  rows: { key: string; label: string; sub?: string; value: number }[]
  unit?: string; empty?: string
}) {
  if (!rows.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#A5AEC0', fontSize: 13 }}>{empty}</div>
  }
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 18, fontSize: 12, fontWeight: 700, color: i < 3 ? '#4F46E5' : '#C3C9D6', flexShrink: 0 }}>
            {i + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#1E1E1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </div>
            {r.sub && <div style={{ fontSize: 11, color: '#A5AEC0' }}>{r.sub}</div>}
            <div style={{ height: 4, borderRadius: 2, background: '#F1F5F9', marginTop: 4 }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#A5B4FC', width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#111', flexShrink: 0 }}>
            {r.value}{unit}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── 도서 상태 뱃지 ───────────────────────────────────────────────────────────
//   books.status 용. 대여 상태(book_checkouts)는 bookLoan.loanStatusStyle 을 쓴다.

const BOOK_STATUS_META: Record<Book['status'], { label: string; bg: string; color: string }> = {
  available:   { label: '대여가능', bg: '#EFF6FF', color: '#1D4ED8' },
  borrowed:    { label: '대여중',   bg: '#FFF7ED', color: '#C2410C' },
  maintenance: { label: '정비중',   bg: '#F1F5F9', color: '#475569' },
  lost:        { label: '분실',     bg: '#FEF2F2', color: '#DC2626' },
}

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999,
      background: bg, color, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═════════════════════════════════════════════════════════════════════════════

export function BookAdminPanel({ users, currentUserId, showToast, isMobile = false }: BookAdminPanelProps) {
  // ── 서브탭 ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<SubTab>('overview')

  // ── 데이터 ────────────────────────────────────────────────────────────────
  const [books,       setBooks]       = useState<Book[]>([])
  const [categories,  setCategories]  = useState<BookCategory[]>([])
  const [outstanding, setOutstanding] = useState<AdminBookLoan[]>([])   // 미반납 전량
  const [rangeLoans,  setRangeLoans]  = useState<AdminBookLoan[]>([])   // 기간 이력

  const [loadingMaster, setLoadingMaster] = useState(true)
  const [loadingRange,  setLoadingRange]  = useState(false)
  const [busy,          setBusy]          = useState(false)

  // ── 기간 필터 (개요 / 대여 이력 공용) ─────────────────────────────────────
  const [dateFrom,    setDateFrom]    = useState(daysAgoStr(89))
  const [dateTo,      setDateTo]      = useState(todayKST())
  const [activeQuick, setActiveQuick] = useState<QuickId | null>('d90')

  // ── 화면 상태 ─────────────────────────────────────────────────────────────
  const [bookQ,      setBookQ]      = useState('')
  const [bookFilter, setBookFilter] = useState<BookFilter>('all')
  const [bookCat,    setBookCat]    = useState<'ALL' | number>('ALL')
  const [bookPage,   setBookPage]   = useState(1)

  const [loanQ,      setLoanQ]      = useState('')
  const [loanFilter, setLoanFilter] = useState<LoanFilter>('all')
  const [loanPage,   setLoanPage]   = useState(1)

  // ── 조회 기준 컬럼 (← [2026-07-23]) ───────────────────────────────────────
  //
  //   '대여일'(checkout_at)은 사용자가 고르는 값이라 최대 3일 뒤 미래일 수 있다.
  //   기본 기간이 '오늘까지'이므로, 오늘 접수된 미래 예약은 대여일 기준 조회에서
  //   **아예 빠진다**. "방금 들어온 대여"를 보려면 생성 시각으로 조회해야 한다.
  //
  //   정렬은 서버가 ORDER BY <기준> DESC 로 이미 처리하므로 별도 정렬 UI 를 두지
  //   않는다. 기준과 정렬을 따로 두면 "생성순 정렬인데 목록에 없는 건"이 생겨
  //   같은 혼란이 반복된다.
  //
  //   기본값은 'checkout_at' — 기존 동작과 개요 통계 모수를 그대로 유지한다.
  const [loanDateField, setLoanDateField] = useState<BookLoanDateField>('checkout_at')

  const [overdueOnly, setOverdueOnly] = useState(true)   // false = 미반납 전체
  const [overduePage, setOverduePage] = useState(1)

  // ── 모달 ──────────────────────────────────────────────────────────────────
  const [editModal,     setEditModal]     = useState<{ book: Book | null } | null>(null)
  const [importOpen,    setImportOpen]    = useState(false)
  const [checkoutOpen,  setCheckoutOpen]  = useState(false)
  const [deleteTarget,  setDeleteTarget]  = useState<Book | null>(null)
  const [returnTarget,  setReturnTarget]  = useState<{ loan: AdminBookLoan; action: BookReturnAction } | null>(null)

  const currentUserName = useMemo(
    () => users.find(u => u.user_id === currentUserId)?.name ?? '',
    [users, currentUserId],
  )

  const userById = useMemo(() => {
    const m: Record<string, AppUser> = {}
    users.forEach(u => { m[u.user_id] = u })
    return m
  }, [users])

  // ─── 로드 ──────────────────────────────────────────────────────────────────

  async function loadMaster() {
    setLoadingMaster(true)
    try {
      const [bs, cs, out, rp] = await Promise.all([
        loadAllBooks(), loadBookCategories(), loadOutstandingBookLoans(),
        loadBookReservedPeriods(),   // ← [2026-08-13] 실패 시 [] 안전값 — 최종 차단은 서버 EXCLUDE
      ])
      setBooks(bs); setCategories(cs); setOutstanding(out); setReservedPeriods(rp)
    } catch (e: any) {
      showToast(`도서 데이터를 불러오지 못했습니다: ${e.message}`, 'error')
    } finally {
      setLoadingMaster(false)
    }
  }

  async function loadRange() {
    setLoadingRange(true)
    try {
      setRangeLoans(await loadBookCheckoutsByRange(dateFrom, dateTo, loanDateField))
    } catch (e: any) {
      showToast(`대여 이력을 불러오지 못했습니다: ${e.message}`, 'error')
    } finally {
      setLoadingRange(false)
    }
  }

  /** user_id → 이름. 제재 목록은 user_id 만 갖고 오므로 여기서 해석한다 */
  const userNameById = useMemo(() => {
    const m: Record<string, string> = {}
    users.forEach(u => { m[u.user_id] = u.name })
    return m
  }, [users])

  // ── 제재 목록 (← [2026-07-21]) ────────────────────────────────────────────
  const [penalties,        setPenalties]        = useState<AdminBookPenalty[]>([])
  const [penaltyActiveOnly, setPenaltyActiveOnly] = useState(true)
  const [penaltyLoading,   setPenaltyLoading]   = useState(false)
  const [revokingId,       setRevokingId]       = useState<string | null>(null)
  const [penaltyPage,      setPenaltyPage]      = useState(1)
  // ← [2026-07-21] 대여 상세. DataTable 은 onRowClick 을 지원하는데
  //   도서 탭들이 넘기지 않아 행이 클릭되지 않았다(열 화면이 없었기 때문).
  const [detailLoan, setDetailLoan] = useState<AdminBookLoan | null>(null)
  // ← [2026-08-13] 행 '기한 변경' 버튼 진입 시 상세 모달의 에디터를 펼친 채 연다
  const [detailDueOpen, setDetailDueOpen] = useState(false)
  const [reservedPeriods, setReservedPeriods] = useState<BookReservedPeriod[]>([])

  const loadPenalties = useCallback(async (activeOnly: boolean) => {
    setPenaltyLoading(true)
    try {
      setPenalties(await adminListBookPenalties(activeOnly))
    } catch (e: any) {
      showToast(`제재 목록 조회 실패: ${e.message}`, 'error')
    } finally {
      setPenaltyLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    setPenaltyPage(1)                       // 필터를 바꾸면 1페이지로
    loadPenalties(penaltyActiveOnly)
  }, [penaltyActiveOnly, loadPenalties])

  /** 제재 해제 — 삭제가 아니라 해제 이력 기록. 사유는 선택 입력 */
  async function handleRevoke(row: AdminBookPenalty) {
    const who = userNameById[row.user_id] ?? '해당 사용자'
    const reason = window.prompt(
      `${who} 의 ${penaltyTierLabel(row.tier)} 을 해제합니다.\n사유를 입력하세요 (선택, 200자 이내)`,
      '',
    )
    if (reason === null) return          // 취소

    setRevokingId(row.id)
    try {
      const res = await revokeBookPenalty(row.id, reason)
      if (!res.ok) { showToast(res.message ?? '해제 실패', 'error'); return }
      showToast('제재를 해제했습니다', 'success')
      await loadPenalties(penaltyActiveOnly)
    } finally {
      setRevokingId(null)
    }
  }

  /**
   * 진행 중 연체 건 면제 토글 (← [2026-07-21])
   *
   * 아직 반납 전이라 book_penalties 에 행이 없다. 그래서 '대여 제한' 탭의
   * 해제 버튼으로는 풀 수 없고, 대여 건 자체를 제재 계산에서 빼야 한다.
   * 출장·병가처럼 반납이 불가능한 사정이 확인됐을 때 쓴다.
   */
  const [exemptingId, setExemptingId] = useState<string | null>(null)

  async function handleToggleExempt(loan: AdminBookLoan) {
    const next = !loan.penalty_exempt
    const who  = userNameById[loan.user_id] ?? '해당 사용자'
    const ok = window.confirm(
      next
        ? `${who} 의 "${loan.book?.title ?? '이 도서'}" 대여를 제재 대상에서 제외합니다.\n\n` +
          '반납이 늦어져도 대여 제한이 적용되지 않습니다. 계속할까요?'
        : `${who} 의 "${loan.book?.title ?? '이 도서'}" 면제를 취소합니다.\n\n` +
          '이후 연체 일수에 따라 대여 제한이 적용됩니다. 계속할까요?',
    )
    if (!ok) return

    setExemptingId(loan.id)
    try {
      const res = await adminExemptCheckout(loan.id, next)
      if (!res.ok) { showToast(res.message ?? '처리 실패', 'error'); return }
      showToast(next ? '제재 면제 처리했습니다' : '면제를 취소했습니다', 'success')
      await reloadAll()
    } finally {
      setExemptingId(null)
    }
  }

  useEffect(() => { loadMaster() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRange() }, [dateFrom, dateTo, loanDateField])   // eslint-disable-line react-hooks/exhaustive-deps

  /** 상태를 바꾸는 처리 후 공통 재조회 */
  async function reloadAll() {
    await Promise.all([loadMaster(), loadRange()])
  }

  // ─── 퀵 기간 버튼 ──────────────────────────────────────────────────────────

  function onQuick(id: QuickId) {
    setActiveQuick(id)
    setDateTo(todayKST())
    if (id === 'd7')   setDateFrom(daysAgoStr(6))
    if (id === 'd30')  setDateFrom(daysAgoStr(29))
    if (id === 'd90')  setDateFrom(daysAgoStr(89))
    if (id === 'year') setDateFrom(startOfYearStr())
  }

  // ─── 액션 ──────────────────────────────────────────────────────────────────

  async function handleSaveBook(form: any, kakaoItem?: any) {
    if (!editModal) return
    setBusy(true)
    const isNew = editModal.book === null
    try {
      await persistBook(form, editModal.book, kakaoItem)
      showToast(isNew ? '도서를 추가했습니다.' : '도서 정보를 수정했습니다.', 'success')
      setEditModal(null)
      await loadMaster()
    } catch (e: any) {
      showToast(`저장 실패: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleDelete(book: Book) {
    setBusy(true)
    try {
      const res = await deleteBookRecord(book.id)
      if (res.blocked) {
        showToast('대여 이력이 있는 도서는 삭제할 수 없습니다. 상태를 "분실"로 변경하세요.', 'warning')
        setDeleteTarget(null)
        return
      }
      showToast('도서를 삭제했습니다.', 'success')
      setDeleteTarget(null)
      await loadMaster()
    } catch (e: any) {
      showToast(`삭제 실패: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleImport(rows: any[]) {
    setBusy(true)
    try {
      const { success, errors } = await importBookRows(rows)
      if (errors.length > 0) showToast(`${success}건 등록, ${errors.length}건 오류`, 'warning')
      else                   showToast(`${success}건 일괄 등록 완료`, 'success')
      setImportOpen(false)
      await loadMaster()
    } catch (e: any) {
      showToast(`일괄 등록 실패: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  async function handleCheckout(userId: string, bookIds: number[], notes: string, checkoutAt?: string, dueOn?: string) {
    setBusy(true)
    try {
      const titles = bookIds.map(id => books.find(b => b.id === id)?.title).filter(Boolean) as string[]
      const res = await adminCheckoutBooksWithNotify(userId, bookIds, notes, titles, checkoutAt, dueOn)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await loadMaster()
        return
      }
      showToast(
        res.deferredNotify
          ? `${checkoutAt}부터 대여 예정으로 등록했습니다 (알림 미발송)`
          : `대여 등록 완료 (${bookIds.length}권)`,
        'success',
      )
      setCheckoutOpen(false)
      await reloadAll()
    } catch (e: any) {
      showToast(`대여 등록 실패: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  /** 반납 / 분실 — admin_return_book RPC (두 테이블 단일 트랜잭션) */
  async function handleReturn(loan: AdminBookLoan, action: BookReturnAction) {
    setBusy(true)
    try {
      const res = await adminReturnBook(loan.id, action)
      if (!res.ok) {
        showToast(returnErrorMessage(res.code!), 'error')
        await reloadAll()
        return
      }
      showToast(action === 'return' ? '반납 처리 완료' : '분실 처리 완료', 'success')
      setReturnTarget(null)
      await reloadAll()
    } catch (e: any) {
      showToast(`처리 실패: ${e.message}`, 'error')
    } finally { setBusy(false) }
  }

  // ─── 파생 데이터 ───────────────────────────────────────────────────────────

  /** 도서별 현재 활성 대여 (카드/테이블의 '대여자' 표기용) */
  const activeLoanByBook = useMemo(() => {
    const m: Record<number, AdminBookLoan> = {}
    outstanding.forEach(l => { m[l.book_id] = l })
    return m
  }, [outstanding])

  /** 사용자별 보유 권수
   *
   *  ← [2026-07-21] 승인 폐지로 pending 합산을 제거했다. outstanding 은
   *  active/overdue 전량이고 예약(미래 시작)도 status='active' 이므로
   *  서버 admin_checkout_books 의 한도 산식과 그대로 일치한다.
   *  한도의 최종 강제는 서버가 한다 — 여기 값은 모달에서 "이미 2권"을
   *  미리 알려주기 위한 표시용이다. */
  const heldCountByUser = useMemo(() => {
    const m: Record<string, number> = {}
    outstanding.forEach(l => { m[l.user_id] = (m[l.user_id] ?? 0) + 1 })
    return m
  }, [outstanding])

  /** 연체 건 (due_at 기준 — DB status 가 아니라 bookLoan SSOT 를 따른다) */
  const overdueLoans = useMemo(
    () => outstanding.filter(l => daysUntilDue(l.due_at) < 0),
    [outstanding],
  )

  const stats = useMemo(() => {
    const returnedInRange = rangeLoans.filter(l => l.status === 'returned').length
    // 대여 성립 건만 집계한다 — pending/rejected/cancelled 는 대여가 아니다
    const borrowedInRange = rangeLoans.filter(
      l => l.status !== 'pending' && l.status !== 'rejected' && l.status !== 'cancelled',
    ).length
    return {
      total:      books.length,
      available:  books.filter(b => b.status === 'available').length,
      borrowed:   outstanding.length,
      // ← [2026-07-30] 예약(미시작) — outstanding(live 전량) 중 시작 전 건
      reserved:   outstanding.filter(l => !hasCheckoutStarted(l.checkout_at)).length,
      overdue:    overdueLoans.length,
      rangeOut:   borrowedInRange,
      rangeBack:  returnedInRange,
    }
  }, [books, outstanding, overdueLoans, rangeLoans])

  /** 월별 대여 추이 (조회 기간 내, 대여일 기준) */
  const monthly = useMemo(() => {
    const m: Record<string, number> = {}
    rangeLoans.forEach(l => {
      if (l.status === 'pending' || l.status === 'rejected' || l.status === 'cancelled') return
      const key = monthOf(l.checkout_at)
      if (!key) return
      m[key] = (m[key] ?? 0) + 1
    })
    return Object.keys(m).sort().map(k => ({ label: k.slice(2).replace('-', '/'), count: m[k] }))
  }, [rangeLoans])

  /** 인기 도서 Top 10 (조회 기간 내) */
  const topBooks = useMemo(() => {
    const m: Record<number, number> = {}
    rangeLoans.forEach(l => {
      if (l.status === 'pending' || l.status === 'rejected' || l.status === 'cancelled') return
      m[l.book_id] = (m[l.book_id] ?? 0) + 1
    })
    return Object.keys(m)
      .map(k => {
        const id = Number(k)
        const b = books.find(x => x.id === id)
        return { key: k, label: b?.title ?? `도서 #${id}`, sub: b?.author ?? undefined, value: m[id] }
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [rangeLoans, books])

  /** 부서별 이용 Top 10 (조회 기간 내) — 부서는 users 에서 live 조회 */
  const topDepts = useMemo(() => {
    const m: Record<string, number> = {}
    rangeLoans.forEach(l => {
      if (l.status === 'pending' || l.status === 'rejected' || l.status === 'cancelled') return
      const dept = userById[l.user_id]?.dept || '(부서 없음)'
      m[dept] = (m[dept] ?? 0) + 1
    })
    return Object.keys(m)
      .map(k => ({ key: k, label: k, value: m[k] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [rangeLoans, userById])

  // ── 도서 관리 탭 목록 ──────────────────────────────────────────────────────
  const filteredBooks = useMemo(() => {
    const q = bookQ.trim().toLowerCase()
    let list = books
    if (q) {
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.author ?? '').toLowerCase().includes(q) ||
        (b.publisher ?? '').toLowerCase().includes(q) ||
        (b.isbn ?? '').toLowerCase().includes(q))
    }
    if (bookCat !== 'ALL') list = list.filter(b => b.category_id === bookCat)
    if (bookFilter !== 'all') list = list.filter(b => b.status === bookFilter)
    // sort 전 복사 필수 — state 배열을 제자리 정렬하면 렌더가 어긋난다
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'ko'))
  }, [books, bookQ, bookCat, bookFilter])

  // ── 대여 이력 탭 목록 ──────────────────────────────────────────────────────
  const filteredLoans = useMemo(() => {
    const q = loanQ.trim().toLowerCase()
    let list = rangeLoans
    if (q) {
      list = list.filter(l =>
        (l.book?.title ?? '').toLowerCase().includes(q) ||
        (userById[l.user_id]?.name ?? '').toLowerCase().includes(q) ||
        (userById[l.user_id]?.dept ?? '').toLowerCase().includes(q))
    }
    // ← [2026-07-30] '대여중'에서 미시작 예약 제외 — 예약 탭과 상호배타 (책은 아직 서가에 있다)
    if (loanFilter === 'active')   list = list.filter(l => l.status === 'active' && hasCheckoutStarted(l.checkout_at) && daysUntilDue(l.due_at) >= 0)
    if (loanFilter === 'reserved') list = list.filter(l => l.status === 'active' && !hasCheckoutStarted(l.checkout_at))
    if (loanFilter === 'overdue')  list = list.filter(l => l.status === 'active' && daysUntilDue(l.due_at) < 0)
    if (loanFilter === 'returned') list = list.filter(l => l.status === 'returned')
    if (loanFilter === 'lost')     list = list.filter(l => l.status === 'lost')
    if (loanFilter === 'closed')   list = list.filter(l => l.status === 'rejected' || l.status === 'cancelled')
    return list
  }, [rangeLoans, loanQ, loanFilter, userById])

  // ── 연체 탭 목록 ───────────────────────────────────────────────────────────
  const overdueRows = useMemo(() => {
    const list = overdueOnly ? overdueLoans : outstanding
    return [...list].sort((a, b) => a.due_at.localeCompare(b.due_at))
  }, [overdueOnly, overdueLoans, outstanding])

  // 필터 변경 시 페이지 초기화 — 3페이지에서 필터를 바꾸면 빈 화면이 뜬다
  useEffect(() => { setBookPage(1) },    [bookQ, bookCat, bookFilter])
  useEffect(() => { setLoanPage(1) },    [loanQ, loanFilter, dateFrom, dateTo, loanDateField])
  useEffect(() => { setOverduePage(1) }, [overdueOnly])

  // ─── CSV ───────────────────────────────────────────────────────────────────

  function csvBooks() {
    exportCSV(filteredBooks.map(b => ({
      ID:        b.id,
      제목:      b.title,
      저자:      b.author ?? '',
      출판사:    b.publisher ?? '',
      ISBN:      b.isbn ?? '',
      분류:      categories.find(c => c.id === b.category_id)?.name ?? '',
      상태:      BOOK_STATUS_META[b.status].label,
      대여자:    activeLoanByBook[b.id] ? (userById[activeLoanByBook[b.id].user_id]?.name ?? '') : '',
      반납기한:  activeLoanByBook[b.id] ? dateOf(activeLoanByBook[b.id].due_at) : '',
      입고일:    b.acquired_at ?? '',
      NEW종료일: b.new_until ?? '',
      메모:      b.notes ?? '',
    })), '도서목록')
  }

  function loanCsvRow(l: AdminBookLoan) {
    const u = userById[l.user_id]
    return {
      도서:      l.book?.title ?? '',
      저자:      l.book?.author ?? '',
      대여자:    u?.name ?? '(알 수 없음)',
      부서:      u?.dept ?? '',
      상태:      loanStatusStyle(loanDisplayStatus(l)).label,
      생성일시:  l.created_at ? dateTimeOf(l.created_at) : '',   // ← [2026-07-23]
      대여일:    dateOf(l.checkout_at),
      반납기한:  dateOf(l.due_at),
      반납일:    dateOf(l.returned_at),
      연장횟수:  l.extension_count,
      신청일:    dateOf(l.requested_at),
      처리자:    l.processed_by_name ?? '',
      거절사유:  l.reject_reason ?? '',
      메모:      l.notes ?? '',
    }
  }
  function csvLoans() {
    // ← [2026-07-23] 파일명에 조회 기준을 남긴다. 기준이 다르면 모수가 다른 파일이라
    //   나중에 두 파일을 비교할 때 왜 건수가 다른지 설명이 안 된다.
    const basis = LOAN_DATE_FIELD_META[loanDateField].short
    exportCSV(filteredLoans.map(loanCsvRow), `대여이력_${basis}_${dateFrom}_${dateTo}`)
  }
  function csvOverdue() {
    // ← [2026-07-21] 제재 관련 열 추가.
    //   연체일수(due_at 기준)와 제재초과일(effective_due 기준)은 다른 숫자다.
    //   CSV 로 뽑아 공유할 때 둘을 함께 보여야 "왜 아직 제재가 아닌지" 설명된다.
    exportCSV(overdueRows.map(l => ({
      ...loanCsvRow(l),
      연체일수:    Math.max(0, -daysUntilDue(l.due_at)),
      제재초과일:  penaltyOverdueDays(l.due_at, l.extension_count),
      제재면제:    l.penalty_exempt ? 'Y' : '',
    })), overdueOnly ? '연체목록' : '미반납목록')
  }

  // ─── 셀 렌더 조각 ──────────────────────────────────────────────────────────

  function BorrowerCell({ userId }: { userId: string }) {
    const u = userById[userId]
    // 퇴사자/외부 사용자는 users 에 없다. 이름 비교로 추정하지 않고 그대로 표시한다.
    if (!u) return <span style={{ fontSize: 12, color: '#A5AEC0' }}>(퇴사·미상)</span>
    return <UserChip name={u.name} avatarUrl={u.avatar_url} dept={u.dept} variant="sm" />
  }

  function LoanStatusCell({ loan }: { loan: AdminBookLoan }) {
    const st = loanStatusStyle(loanDisplayStatus(loan))
    return <Badge label={st.label} bg={st.bg} color={st.color} />
  }

  // ─── 컬럼 정의 ─────────────────────────────────────────────────────────────

  const bookColumns: Column<Book>[] = [
    {
      key: 'title', label: '도서', flex: true, pad: '10 16',
      render: b => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 30, height: 42, borderRadius: 4, background: '#F5F6F8',
            flexShrink: 0, overflow: 'hidden' }}>
            {b.cover_url && (
              <img src={b.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1E1E',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.title}
              {isNewBook(b) && <span style={{ marginLeft: 6, fontSize: 10, color: '#16A34A', fontWeight: 700 }}>NEW</span>}
            </div>
            <div style={{ fontSize: 11, color: '#A5AEC0', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[b.author, b.publisher].filter(Boolean).join(' · ') || '-'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'category', label: '분류', width: 110,
      render: b => <span style={{ fontSize: 12, color: '#64748B' }}>
        {categories.find(c => c.id === b.category_id)?.name ?? '-'}
      </span>,
    },
    {
      key: 'status', label: '상태', width: 90,
      render: b => <Badge {...BOOK_STATUS_META[b.status]} />,
    },
    {
      key: 'borrower', label: '대여자 / 반납기한', width: 190,
      render: b => {
        const l = activeLoanByBook[b.id]
        if (!l) return <span style={{ fontSize: 12, color: '#C3C9D6' }}>-</span>
        const over = daysUntilDue(l.due_at) < 0
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <BorrowerCell userId={l.user_id} />
            <span style={{ fontSize: 11, color: over ? '#DC2626' : '#8B94A7', fontWeight: over ? 700 : 400 }}>
              {fmtDueShortKo(l.due_at)} · {ddayLabel(l.due_at)}
            </span>
          </div>
        )
      },
    },
    {
      key: 'acquired', label: '입고', width: 90,
      render: b => <span style={{ fontSize: 12, color: '#64748B' }}>{b.acquired_at?.slice(0, 7) ?? '-'}</span>,
    },
    {
      key: 'actions', label: '관리', width: 110,
      render: b => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" style={{ ...BTN_MINI, background: '#F1F5F9', color: '#374151' }}
            onClick={() => setEditModal({ book: b })}>편집</button>
          <button className="btn" style={{ ...BTN_MINI, background: '#FEF2F2', color: '#DC2626' }}
            onClick={() => setDeleteTarget(b)}>삭제</button>
        </div>
      ),
    },
  ]

  // ← [2026-07-30] 예약(미시작) 취소 — admin_cancel_book_checkout. 무통보(고지 확정).
  //   시작 여부는 서버가 최종 판정(ALREADY_STARTED) — 자정 경계 경합 방어.
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  async function handleCancelReserved(l: AdminBookLoan) {
    const title = l.book?.title ?? `도서 #${l.book_id}`
    if (!window.confirm(`『${title}』 예약을 취소할까요?\n예약자에게 알림은 발송되지 않습니다.`)) return
    setCancellingId(l.id)
    try {
      const res = await adminCancelBookCheckout(l.id)
      if (!res.ok) { showToast(res.message ?? '예약 취소 실패', 'error'); return }
      showToast(`『${res.bookTitle ?? title}』 예약을 취소했습니다`, 'success')
      await Promise.all([loadRange(), loadMaster()])   // loadMaster 가 outstanding(미반납 전량)도 재조회
    } finally { setCancellingId(null) }
  }

  // ← [2026-08-13] 기한 변경 — admin_set_book_due. 성공 시 목록 재조회.
  //   반환 boolean 은 상세 모달 에디터의 닫힘 여부 — 실패 시 열어두고 재시도.
  async function handleChangeDue(loan: AdminBookLoan, dueOn: string): Promise<boolean> {
    const res = await adminSetBookDue(loan.id, dueOn)
    if (!res.ok || !res.row) {
      showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
      return false
    }
    const row = res.row
    showToast(`반납기한을 ${fmtDueShortKo(dueOn)} 로 변경했습니다`, 'success')
    // 열려 있는 상세 모달의 값도 즉시 갱신 — 재조회를 기다리면 옛 기한이 남는다
    setDetailLoan(prev => prev && prev.id === loan.id ? { ...prev, due_at: row.due_at, notes: row.notes } : prev)
    await Promise.all([loadRange(), loadMaster()])
    return true
  }

  /** 기한 달력 비활성 — 같은 도서의 다른 대여/예약 구간과 겹치는 날짜.
   *  자기 자신 제외: get_book_reserved_periods 는 id 를 반환하지 않으므로
   *  시작일 일치로 판별한다 (EXCLUDE 제약상 같은 도서에 같은 시작일 구간은 유일). */
  function dueDisabledFor(loan: AdminBookLoan) {
    const selfStart = kstDateStr(loan.checkout_at)
    const others = reservedPeriods.filter(p => p.book_id === loan.book_id && p.start_on !== selfStart)
    if (others.length === 0) return undefined
    return (d: string) => others.some(p => spanWouldConflict(kstDateStr(loan.checkout_at), d, p))
  }

  const loanColumns: Column<AdminBookLoan>[] = [
    {
      key: 'book', label: '도서', flex: true, pad: '10 16',
      render: l => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1E1E',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.book?.title ?? `도서 #${l.book_id}`}
          </div>
          <div style={{ fontSize: 11, color: '#A5AEC0' }}>{l.book?.author ?? '-'}</div>
        </div>
      ),
    },
    { key: 'user',   label: '대여자', width: 170, render: l => <BorrowerCell userId={l.user_id} /> },
    { key: 'status', label: '상태',   width: 90,  render: l => <LoanStatusCell loan={l} /> },
    // ← [2026-07-23] 생성일시 — checkout_at 과 다른 값이다.
    //   미래 예약(대여일 +3일)·소급 등록(대여일 과거)이 있으므로
    //   "언제 접수됐는가" 는 이 열로만 알 수 있다.
    {
      key: 'created', label: '생성일시', width: 110,
      render: l => (
        <span style={{ fontSize: 12, color: l.created_at ? '#64748B' : '#C3C9D6' }}>
          {dateTimeOf(l.created_at) || '-'}
        </span>
      ),
    },
    {
      key: 'period', label: '대여 → 기한', width: 160,
      render: l => (
        <span style={{ fontSize: 12, color: '#64748B' }}>
          {dateOf(l.checkout_at).slice(5)} → {dateOf(l.due_at).slice(5)}
          {l.extension_count > 0 && <span style={{ color: '#4F46E5', fontWeight: 700 }}> (연장)</span>}
        </span>
      ),
    },
    {
      key: 'returned', label: '반납일', width: 100,
      render: l => <span style={{ fontSize: 12, color: '#64748B' }}>{dateOf(l.returned_at).slice(5) || '-'}</span>,
    },
    {
      key: 'act', label: '처리', width: 190,   // ← [2026-08-13] '기한 변경' 추가로 확장
      render: l => {
        // 반납/분실은 대여가 성립한 건에만 노출한다 (pending/종결 건은 대상 아님)
        if (l.status !== 'active' && l.status !== 'overdue') {
          return <span style={{ fontSize: 12, color: '#C3C9D6' }}>-</span>
        }
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            {/* ← [2026-08-13] 기한 변경 — 상세 모달을 에디터 펼침 상태로 연다 (미리보기 확정안) */}
            <button className="btn" style={{ ...BTN_MINI, background: '#EEF2FF', color: '#4338CA' }}
              onClick={e => { e.stopPropagation(); setDetailDueOpen(true); setDetailLoan(l) }}>기한 변경</button>
            <button className="btn" style={{ ...BTN_MINI, background: '#111', color: '#fff' }}
              onClick={e => { e.stopPropagation(); setReturnTarget({ loan: l, action: 'return' }) }}>반납</button>
            <button className="btn" style={{ ...BTN_MINI, background: '#FEF2F2', color: '#DC2626' }}
              onClick={e => { e.stopPropagation(); setReturnTarget({ loan: l, action: 'lost' }) }}>분실</button>
          </div>
        )
      },
    },
    // ← [2026-07-30] 예약(미시작·active) 행 전용 취소 액션 — 행 클릭(상세)과 분리
    {
      key: 'act', label: '', width: 76,
      render: l => (l.status === 'active' && !hasCheckoutStarted(l.checkout_at)) ? (
        <button
          className="btn"
          disabled={cancellingId === l.id}
          onClick={e => { e.stopPropagation(); handleCancelReserved(l) }}
          style={{
            padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
            background: '#FFF5F5', border: '1px solid #FECACA', color: '#DC2626',
            cursor: cancellingId === l.id ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          }}>
          {cancellingId === l.id ? '취소 중' : '예약 취소'}
        </button>
      ) : null,
    },
  ]

  const overdueColumns: Column<AdminBookLoan>[] = [
    {
      key: 'dday', label: '연체', width: 90, pad: '10 16',
      render: l => {
        const d = daysUntilDue(l.due_at)
        return (
          <span style={{ fontSize: 13, fontWeight: 800, color: d < 0 ? '#DC2626' : '#475569' }}>
            {d < 0 ? `${-d}일` : ddayLabel(l.due_at)}
          </span>
        )
      },
    },
    // ← [2026-07-23] 'created'(생성일시)도 제외 — 연체 탭은 기한 중심이라 폭을 아낀다
    ...loanColumns.filter(c => c.key !== 'returned' && c.key !== 'created'),
    // ── 제재 상태 + 면제 토글 (← [2026-07-21]) ─────────────────────────────
    //   연체 일수(due_at 기준)와 제재 기준(effective_due 기준)이 다르므로
    //   "연체 10일인데 왜 제재가 아직?" 을 여기서 바로 설명해야 한다.
    {
      key: 'penalty', label: '제재', width: 150,
      render: (l: AdminBookLoan) => {
        if (l.penalty_exempt) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...BTN_MINI, background: '#F1F5F9', color: '#64748B', display: 'inline-block' }}>
                면제
              </span>
              <button
                onClick={e => { e.stopPropagation(); handleToggleExempt(l) }}
                disabled={exemptingId === l.id}
                style={{ ...BTN_MINI, background: 'transparent', color: '#94A3B8',
                         textDecoration: 'underline' }}>
                {exemptingId === l.id ? '처리중' : '해제'}
              </button>
            </div>
          )
        }
        const over = penaltyOverdueDays(l.due_at, l.extension_count)
        const hit  = over >= PENALTY_TIER_DAYS.warn
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: hit ? '#B91C1C' : '#94A3B8', whiteSpace: 'nowrap',
            }}>
              {hit ? `초과 ${over}일` : `D-${Math.max(0, PENALTY_TIER_DAYS.warn - over)}`}
            </span>
            <button
              onClick={e => { e.stopPropagation(); handleToggleExempt(l) }}
              disabled={exemptingId === l.id}
              style={{ ...BTN_MINI, background: '#F1F5F9', color: '#374151' }}>
              {exemptingId === l.id ? '처리중' : '면제'}
            </button>
          </div>
        )
      },
    },
  ]

  // ─── 페이징 ────────────────────────────────────────────────────────────────

  const bookTotalPages    = Math.max(1, Math.ceil(filteredBooks.length / PER_PAGE))
  const loanTotalPages    = Math.max(1, Math.ceil(filteredLoans.length / PER_PAGE))
  const overdueTotalPages = Math.max(1, Math.ceil(overdueRows.length / PER_PAGE))
  const pageSlice = <T,>(list: T[], page: number) => list.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // ─── 서브탭 정의 ───────────────────────────────────────────────────────────

  const subTabs = [
    { id: 'overview' as const, label: '개요',      count: stats.total },
    { id: 'books'    as const, label: '도서 관리', count: books.length },
    { id: 'loans'    as const, label: '대여 이력', count: rangeLoans.length },
    { id: 'overdue'  as const, label: '연체 관리', count: overdueLoans.length },
    // 유효 제재만 카운트 — 해제·만료분까지 세면 숫자가 계속 늘어나 의미가 없다
    { id: 'penalties' as const, label: '대여 제한',
      count: penalties.filter(p => !p.revoked_at && (!p.ends_at || new Date(p.ends_at) > new Date())).length },
  ]

  const quickButtons = [
    { id: 'd7'   as const, label: '7일' },
    { id: 'd30'  as const, label: '30일' },
    { id: 'd90'  as const, label: '90일' },
    { id: 'year' as const, label: '올해' },
  ]

  // ═══════════════════════════════════════════════════════════════════════════
  // 렌더
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>도서 관리</div>
          <div style={{ fontSize: 12, color: '#8B94A7', marginTop: 4 }}>
            사내 도서 카탈로그와 대여 현황을 관리합니다
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={BTN_LIGHT} onClick={() => setCheckoutOpen(true)}>대여 등록</button>
          <button className="btn" style={BTN_LIGHT} onClick={() => setImportOpen(true)}>CSV 일괄 등록</button>
          <button className="btn" style={BTN_DARK}  onClick={() => setEditModal({ book: null })}>+ 도서 추가</button>
        </div>
      </div>

      {/* ── 서브탭 ───────────────────────────────────────────────────────── */}
      <SegmentTabBar
        tabs={subTabs}
        activeTab={tab}
        onTabChange={id => setTab(id)}
      />

      {/* ═══════════════════════ 개요 ═══════════════════════ */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DateRangeFilter
            from={dateFrom} to={dateTo}
            onFromChange={d => { setDateFrom(d); setActiveQuick(null) }}
            onToChange={d => { setDateTo(d); setActiveQuick(null) }}
            activeQuick={activeQuick}
            onQuickClick={onQuick}
            quickButtons={quickButtons}
          />

          {/* ← [2026-07-23] 개요 통계는 대여 이력 탭과 같은 rangeLoans 를 쓴다.
              조회 기준을 바꾸면 여기 모수도 함께 바뀌므로 기준을 명시한다.
              기본값(대여일)일 때는 문구를 띄우지 않아 화면을 어지럽히지 않는다. */}
          {loanDateField !== 'checkout_at' && (
            <div style={{ fontSize: 12, color: '#A5AEC0' }}>
              기간 통계 기준: <b style={{ color: '#64748B' }}>
                {LOAN_DATE_FIELD_META[loanDateField].label}
              </b> (대여 이력 탭에서 변경)
            </div>
          )}

          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)',
          }}>
            <StatCard label="전체 도서"   value={stats.total} />
            <StatCard label="대여 가능"   value={stats.available} color="#1988FF" />
            <StatCard label="예약" value={stats.reserved} unit="건" color="#B45309" hint="시작 전 예약 — 대여 이력 탭 '예약' 필터에서 취소 가능" />{/* ← [2026-07-30] */}
            <StatCard label="대여 중"     value={stats.borrowed}  color="#C2410C" />
            <StatCard label="연체"        value={stats.overdue}   color="#DC2626"
              hint={stats.overdue > 0 ? '연체 관리 탭에서 처리' : undefined} />
            <StatCard label="기간 내 대여" value={stats.rangeOut}  unit="건" />
            <StatCard label="기간 내 반납" value={stats.rangeBack} unit="건" />
          </div>

          <div style={CARD}>
            <div style={SECTION_TITLE}>월별 대여 추이</div>
            {loadingRange
              ? <div style={{ padding: 40, textAlign: 'center', color: '#A5AEC0', fontSize: 13 }}>불러오는 중...</div>
              : <MiniBarChart data={monthly} />}
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
            <div style={CARD}>
              <div style={{ ...SECTION_TITLE, display: 'flex', justifyContent: 'space-between' }}>
                <span>인기 도서 Top 10</span>
                <button className="btn" style={{ ...BTN_MINI, background: '#F1F5F9', color: '#475569' }}
                  onClick={() => exportCSV(topBooks.map((r, i) => ({ 순위: i + 1, 도서: r.label, 저자: r.sub ?? '', 대여건수: r.value })), `인기도서_${dateFrom}_${dateTo}`)}>
                  CSV
                </button>
              </div>
              <RankList rows={topBooks} empty="조회 기간에 대여 기록이 없습니다" />
            </div>
            <div style={CARD}>
              <div style={{ ...SECTION_TITLE, display: 'flex', justifyContent: 'space-between' }}>
                <span>부서별 이용 Top 10</span>
                <button className="btn" style={{ ...BTN_MINI, background: '#F1F5F9', color: '#475569' }}
                  onClick={() => exportCSV(topDepts.map((r, i) => ({ 순위: i + 1, 부서: r.label, 대여건수: r.value })), `부서별이용_${dateFrom}_${dateTo}`)}>
                  CSV
                </button>
              </div>
              <RankList rows={topDepts} empty="조회 기간에 대여 기록이 없습니다" />
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ 도서 관리 ═══════════════════════ */}
      {tab === 'books' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SegmentTabBar
            tabs={[
              { id: 'all'         as const, label: '전체',     count: books.length },
              { id: 'available'   as const, label: '대여가능', count: books.filter(b => b.status === 'available').length },
              { id: 'borrowed'    as const, label: '대여중',   count: books.filter(b => b.status === 'borrowed').length },
              { id: 'maintenance' as const, label: '정비중',   count: books.filter(b => b.status === 'maintenance').length },
              { id: 'lost'        as const, label: '분실',     count: books.filter(b => b.status === 'lost').length },
            ]}
            activeTab={bookFilter}
            onTabChange={id => setBookFilter(id)}
            searchProps={{ value: bookQ, onChange: setBookQ, placeholder: '제목 · 저자 · 출판사 · ISBN 검색' }}
            onCsvClick={csvBooks}
            csvLabel="CSV 추출"
          />

          {/* 분류 필터 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[{ id: 'ALL' as const, name: '전체 분류' }, ...categories].map(c => {
              const id = c.id as 'ALL' | number
              const on = bookCat === id
              return (
                <button key={String(id)} className="btn"
                  onClick={() => setBookCat(id)}
                  style={{
                    padding: '5px 12px', borderRadius: 999, fontSize: 12,
                    border: '1px solid ' + (on ? '#111' : '#E2E8F0'),
                    background: on ? '#111' : '#fff', color: on ? '#fff' : '#475569',
                    fontWeight: on ? 600 : 400,
                  }}>
                  {c.name}
                </button>
              )
            })}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
              data={pageSlice(filteredBooks, bookPage)}
              columns={bookColumns}
              getRowKey={b => b.id}
              loading={loadingMaster}
              emptyMessage="조건에 맞는 도서가 없습니다."
              page={bookPage} totalPages={bookTotalPages} onPageChange={setBookPage}
              minWidth={980}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════ 대여 이력 ═══════════════════════ */}
      {tab === 'loans' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DateRangeFilter
            from={dateFrom} to={dateTo}
            onFromChange={d => { setDateFrom(d); setActiveQuick(null) }}
            onToChange={d => { setDateTo(d); setActiveQuick(null) }}
            activeQuick={activeQuick}
            onQuickClick={onQuick}
            quickButtons={quickButtons}
          />

          <SegmentTabBar
            tabs={[
              { id: 'all'      as const, label: '전체',   count: rangeLoans.length },
              { id: 'active'   as const, label: '대여중', count: rangeLoans.filter(l => l.status === 'active' && hasCheckoutStarted(l.checkout_at) && daysUntilDue(l.due_at) >= 0).length },
              // ← [2026-07-30] 예약(미시작) — 잘못 등록된 예약을 찾고 취소하는 자리
              { id: 'reserved' as const, label: '예약',   count: rangeLoans.filter(l => l.status === 'active' && !hasCheckoutStarted(l.checkout_at)).length },
              { id: 'overdue'  as const, label: '연체',   count: rangeLoans.filter(l => l.status === 'active' && daysUntilDue(l.due_at) < 0).length },
              { id: 'returned' as const, label: '반납',   count: rangeLoans.filter(l => l.status === 'returned').length },
              { id: 'lost'     as const, label: '분실',   count: rangeLoans.filter(l => l.status === 'lost').length },
              // ← [2026-07-21] rejected 는 폐지된 승인 플로우의 과거 이력,
              //   cancelled 는 사용자가 시작 전에 취소한 예약. 둘 다 대여 미성립이라 한 칸에 묶는다.
              { id: 'closed'   as const, label: '취소·거절', count: rangeLoans.filter(l => l.status === 'rejected' || l.status === 'cancelled').length },
            ]}
            activeTab={loanFilter}
            onTabChange={id => setLoanFilter(id)}
            searchProps={{ value: loanQ, onChange: setLoanQ, placeholder: '도서명 · 대여자 · 부서 검색' }}
            onCsvClick={csvLoans}
            csvLabel="CSV 추출"
          />

          {/* ── 조회 기준 전환 (← [2026-07-23]) ─────────────────────────────
              정렬 옵션이 아니라 '기간 판정 기준' 을 바꾼다.
              대여일 기준으로는 오늘 접수된 미래 예약이 목록에 아예 안 잡히므로,
              정렬만 추가하면 "생성순인데 없는 건" 이 남는다. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>조회 기준</span>
            <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 8, padding: 2 }}>
              {(['checkout_at', 'created_at'] as const).map(f => (
                <button
                  key={f}
                  className="btn"
                  onClick={() => setLoanDateField(f)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: loanDateField === f ? '#fff' : 'transparent',
                    color:      loanDateField === f ? '#1E1E1E' : '#94A3B8',
                    boxShadow:  loanDateField === f ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
                  }}>
                  {LOAN_DATE_FIELD_META[f].label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#A5AEC0' }}>
              {LOAN_DATE_FIELD_META[loanDateField].desc}
            </span>
          </div>

          <div style={{ fontSize: 12, color: '#A5AEC0' }}>
            기간 밖에 시작된 미반납 건은 연체 관리 탭에서 확인하세요.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
              onRowClick={(l: AdminBookLoan) => setDetailLoan(l)}
              data={pageSlice(filteredLoans, loanPage)}
              columns={loanColumns}
              getRowKey={l => l.id}
              loading={loadingRange}
              emptyMessage="조회 기간에 해당하는 대여 이력이 없습니다."
              page={loanPage} totalPages={loanTotalPages} onPageChange={setLoanPage}
              minWidth={1000}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════ 연체 관리 ═══════════════════════ */}
      {tab === 'overdue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SegmentTabBar
            tabs={[
              { id: 'overdue' as const, label: '연체',      count: overdueLoans.length },
              { id: 'all'     as const, label: '미반납 전체', count: outstanding.length },
            ]}
            activeTab={overdueOnly ? 'overdue' : 'all'}
            onTabChange={id => setOverdueOnly(id === 'overdue')}
            onCsvClick={csvOverdue}
            csvLabel="CSV 추출"
          />

          <div style={{ fontSize: 12, color: '#A5AEC0', lineHeight: 1.7 }}>
            연체 판정은 저장된 상태값이 아니라 <b style={{ color: '#64748B' }}>반납기한(due_at)</b> 기준입니다.
            사용자 화면·알림과 동일한 기준을 사용하므로 숫자가 어긋나지 않습니다.
            <br />
            <b style={{ color: '#64748B' }}>제재</b> 열은 기준이 다릅니다 —
            대여 7일 + 연장 7일 = 최대 14일 안의 연체에는 제재가 적용되지 않으므로,
            연체 일수보다 늦게 카운트가 시작됩니다. D-n 은 제재 적용까지 남은 일수입니다.
            사정이 있는 건은 <b style={{ color: '#64748B' }}>면제</b> 처리하면 제재 계산에서 빠집니다.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
              onRowClick={(l: AdminBookLoan) => setDetailLoan(l)}
              data={pageSlice(overdueRows, overduePage)}
              columns={overdueColumns}
              getRowKey={l => l.id}
              loading={loadingMaster}
              emptyMessage={overdueOnly ? '연체 중인 도서가 없습니다. 👍' : '대여 중인 도서가 없습니다.'}
              page={overduePage} totalPages={overdueTotalPages} onPageChange={setOverduePage}
              minWidth={1000}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════ 대여 제한 (← [2026-07-21]) ═══════════════════ */}
      {tab === 'penalties' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SegmentTabBar
            tabs={[
              { id: 'active' as const, label: '적용 중',
                count: penalties.filter(p => !p.revoked_at && (!p.ends_at || new Date(p.ends_at) > new Date())).length },
              { id: 'all'    as const, label: '전체 이력', count: penalties.length },
            ]}
            activeTab={penaltyActiveOnly ? 'active' : 'all'}
            onTabChange={id => setPenaltyActiveOnly(id === 'active')}
            onCsvClick={() => exportCSV(
              penalties.map(p => ({
                직원:      userNameById[p.user_id] ?? p.user_id,
                도서:      p.book_title ?? '',
                초과일수:  p.overdue_days,
                등급:      penaltyTierLabel(p.tier),
                시작:      fmtDueShortKo(p.starts_at),
                해제예정:  p.ends_at ? fmtDueShortKo(p.ends_at) : '영구',
                사유:      p.reason ?? '',
                해제일:    p.revoked_at ? fmtDueShortKo(p.revoked_at) : '',
                해제사유:  p.revoked_reason ?? '',
              })),
              '대여제한',
            )}
            csvLabel="CSV 추출"
          />

          <div style={{ fontSize: 12, color: '#A5AEC0', lineHeight: 1.7 }}>
            제재 기준일은 반납기한이 아니라 <b style={{ color: '#64748B' }}>최대 대여 가능 기한</b>입니다.
            대여 7일 + 연장 7일 = 14일 안의 연체에는 제재가 적용되지 않습니다.
            <br />
            아직 반납하지 않아 <b style={{ color: '#64748B' }}>진행 중인 연체</b>는 여기 표시되지 않습니다 —
            반납 시점에 등급이 확정되어 이 목록에 들어옵니다. 진행 중 건은 연체 관리 탭에서 확인하세요.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
              data={pageSlice(penalties, penaltyPage)}
              columns={[
                { key: 'user',  label: '직원',  width: 120,
                  render: (p: AdminBookPenalty) => userNameById[p.user_id] ?? '—' },
                { key: 'book',  label: '도서',  width: 240,
                  render: (p: AdminBookPenalty) => p.book_title ?? '—' },
                { key: 'over',  label: '초과일수', width: 90,
                  render: (p: AdminBookPenalty) => `${p.overdue_days}일` },
                { key: 'tier',  label: '등급',  width: 130,
                  render: (p: AdminBookPenalty) => (
                    <span style={{
                      ...BTN_MINI,
                      background: p.tier === 'permanent' ? '#FEE2E2' : '#FEF3C7',
                      color:      p.tier === 'permanent' ? '#B91C1C' : '#B45309',
                      display: 'inline-block',
                    }}>{penaltyTierLabel(p.tier)}</span>
                  ) },
                { key: 'range', label: '기간',  width: 190,
                  render: (p: AdminBookPenalty) =>
                    `${fmtDueShortKo(p.starts_at)} ~ ${p.ends_at ? fmtDueShortKo(p.ends_at) : '영구'}` },
                { key: 'state', label: '상태',  width: 110,
                  render: (p: AdminBookPenalty) => {
                    if (p.revoked_at) return <span style={{ color: '#64748B' }}>해제됨</span>
                    if (p.ends_at && new Date(p.ends_at) <= new Date())
                      return <span style={{ color: '#64748B' }}>만료</span>
                    return <span style={{ color: '#B91C1C', fontWeight: 600 }}>적용 중</span>
                  } },
                { key: 'act',   label: '',      width: 90,
                  render: (p: AdminBookPenalty) => {
                    const done = !!p.revoked_at ||
                      (!!p.ends_at && new Date(p.ends_at) <= new Date())
                    if (done) return <span style={{ color: '#CBD5E1', fontSize: 12 }}>—</span>
                    return (
                      <button
                        onClick={() => handleRevoke(p)}
                        disabled={revokingId === p.id}
                        style={{ ...BTN_MINI, background: '#F1F5F9', color: '#374151' }}>
                        {revokingId === p.id ? '처리중' : '해제'}
                      </button>
                    )
                  } },
              ]}
              getRowKey={p => p.id}
              loading={penaltyLoading}
              emptyMessage={penaltyActiveOnly
                ? '적용 중인 대여 제한이 없습니다. 👍'
                : '대여 제한 이력이 없습니다.'}
              page={penaltyPage}
              totalPages={Math.max(1, Math.ceil(penalties.length / PER_PAGE))}
              onPageChange={setPenaltyPage}
              minWidth={1000}
            />
          </div>
        </div>
      )}

      {/* ← [2026-07-21] 대여 상세. 반납/분실은 기존 핸들러를 그대로 재사용한다 —
           모달이 직접 RPC 를 부르면 목록 갱신·토스트가 어긋난다. */}
      {detailLoan && (
        <BookLoanDetailModal
          loan={detailLoan}
          isAdmin
          borrowerName={userNameById[detailLoan.user_id] ?? null}
          onClose={() => { setDetailLoan(null); setDetailDueOpen(false) }}
          onReturn={l => { setDetailLoan(null); setDetailDueOpen(false); setReturnTarget({ loan: l as AdminBookLoan, action: 'return' }) }}
          onLost={l   => { setDetailLoan(null); setDetailDueOpen(false); setReturnTarget({ loan: l as AdminBookLoan, action: 'lost'   }) }}
          onChangeDue={(l, d) => handleChangeDue(l as AdminBookLoan, d)}  /* ← [2026-08-13] */
          dueEditorInitialOpen={detailDueOpen}
          isDueDateDisabled={dueDisabledFor(detailLoan)}
        />
      )}

      {/* ═══════════════════════ 모달 ═══════════════════════ */}

      {/* 도서 추가/편집 — LibraryPage 와 동일한 모달 */}
      {editModal && (
        <BookEditModal
          book={editModal.book}
          categories={categories}
          onSave={handleSaveBook}
          onClose={() => setEditModal(null)}
          loading={busy}
        />
      )}

      {/* CSV 일괄 등록 */}
      {importOpen && (
        <BookImportModal
          categories={categories}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
          loading={busy}
        />
      )}

      {/* 대여 등록 (복수 도서 + 대여자 검색) */}
      {checkoutOpen && (
        <BookCheckoutModal
          initialBook={null}
          books={books}
          users={users}
          heldCountByUser={heldCountByUser}
          maxBorrow={MAX_BORROW_PER_USER}
          borrowDays={BORROW_DAYS}
          loading={busy}
          reservedPeriods={reservedPeriods}  /* ← [2026-08-13] 달력 예약 구간 비활성 */
          onClose={() => setCheckoutOpen(false)}
          onSubmit={handleCheckout}
        />
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <div style={OVERLAY_STYLE} onClick={() => setDeleteTarget(null)}>
          <div style={{ ...MODAL_STYLE, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>도서를 삭제할까요?</div>
              <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
                "{deleteTarget.title}" 삭제 시 복구할 수 없습니다.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setDeleteTarget(null)}
                  style={{ flex: 1, background: '#F1F5F9', color: '#374151', padding: '10px 0', borderRadius: 8 }}>
                  취소
                </button>
                <button className="btn" disabled={busy} onClick={() => handleDelete(deleteTarget)}
                  style={{ flex: 1, background: '#DC2626', color: '#fff', padding: '10px 0', borderRadius: 8, fontWeight: 600 }}>
                  {busy ? '삭제중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 반납 / 분실 확인 */}
      {returnTarget && (
        <div style={OVERLAY_STYLE} onClick={() => setReturnTarget(null)}>
          <div style={{ ...MODAL_STYLE, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>
                {returnTarget.action === 'return' ? '반납 처리' : '분실 처리'}
              </div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, marginBottom: 8 }}>
                <b>{returnTarget.loan.book?.title ?? '도서'}</b><br />
                대여자: {userById[returnTarget.loan.user_id]?.name ?? '(퇴사·미상)'}<br />
                반납기한: {fmtDueShortKo(returnTarget.loan.due_at)} · {ddayLabel(returnTarget.loan.due_at)}
              </div>
              <div style={{
                fontSize: 12, borderRadius: 8, padding: '9px 12px', marginBottom: 18,
                background: returnTarget.action === 'return' ? '#F8FAFC' : '#FEF2F2',
                color:      returnTarget.action === 'return' ? '#475569' : '#B91C1C',
              }}>
                {returnTarget.action === 'return'
                  ? '대여 기록이 반납완료로 바뀌고 도서는 대여가능 상태가 됩니다.'
                  : '대여 기록과 도서 상태가 모두 분실로 바뀝니다. 반납일은 기록되지 않습니다.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setReturnTarget(null)}
                  style={{ flex: 1, background: '#F1F5F9', color: '#374151', padding: '10px 0', borderRadius: 8 }}>
                  취소
                </button>
                <button className="btn" disabled={busy}
                  onClick={() => handleReturn(returnTarget.loan, returnTarget.action)}
                  style={{
                    flex: 2, padding: '10px 0', borderRadius: 8, fontWeight: 600, color: '#fff',
                    background: returnTarget.action === 'return' ? '#111' : '#DC2626',
                  }}>
                  {busy ? '처리중...' : (returnTarget.action === 'return' ? '반납 처리' : '분실 처리')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
