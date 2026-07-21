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
 *     · 승인 대기 : BookRequestPanel
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

import { useState, useEffect, useMemo } from 'react'
import {
  loadAllBooks, loadBookCategories,
  loadBookCheckoutsByRange, loadOutstandingBookLoans,
  adminReturnBook, returnErrorMessage,
  persistBook, deleteBookRecord, importBookRows,
  adminCheckoutBooksWithNotify, approveBookRequestWithNotify, rejectBookRequestWithNotify,
  fetchPendingBookRequests, checkoutErrorMessage,
} from '../../lib/api'
import { SegmentTabBar } from '../common/SegmentTabBar'
import { DateRangeFilter } from '../common/DateRangeFilter'
import { DataTable, type Column } from '../common/DataTable'
import { UserChip } from '../common/UserChip'
import { exportCSV } from '../../utils/csv'
import {
  loanDisplayStatus, loanStatusStyle, daysUntilDue, ddayLabel,
  fmtDueShortKo,
} from '../../utils/bookLoan'
import { isNewBook, todayKST } from './libraryListShared'
import { BookEditModal, BookImportModal, OVERLAY_STYLE, MODAL_STYLE } from './bookFormShared'
import { BookCheckoutModal } from './BookCheckoutModal'
import { BookRequestPanel } from './BookRequestPanel'
import type {
  AppUser, Book, BookCategory, AdminBookLoan, BookRequest, BookReturnAction,
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

type SubTab   = 'overview' | 'books' | 'loans' | 'overdue' | 'requests'
type QuickId  = 'd7' | 'd30' | 'd90' | 'year'
type LoanFilter = 'all' | 'active' | 'returned' | 'overdue' | 'lost' | 'closed'
type BookFilter = 'all' | 'available' | 'borrowed' | 'maintenance' | 'lost'

const PER_PAGE = 15

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
  const [pendingReqs, setPendingReqs] = useState<BookRequest[]>([])

  const [loadingMaster, setLoadingMaster] = useState(true)
  const [loadingRange,  setLoadingRange]  = useState(false)
  const [reqLoading,    setReqLoading]    = useState(false)
  const [busy,          setBusy]          = useState(false)
  const [reqBusyId,     setReqBusyId]     = useState<string | null>(null)

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
      const [bs, cs, out] = await Promise.all([
        loadAllBooks(), loadBookCategories(), loadOutstandingBookLoans(),
      ])
      setBooks(bs); setCategories(cs); setOutstanding(out)
    } catch (e: any) {
      showToast(`도서 데이터를 불러오지 못했습니다: ${e.message}`, 'error')
    } finally {
      setLoadingMaster(false)
    }
  }

  async function loadRange() {
    setLoadingRange(true)
    try {
      setRangeLoans(await loadBookCheckoutsByRange(dateFrom, dateTo))
    } catch (e: any) {
      showToast(`대여 이력을 불러오지 못했습니다: ${e.message}`, 'error')
    } finally {
      setLoadingRange(false)
    }
  }

  async function loadPending() {
    setReqLoading(true)
    try {
      setPendingReqs(await fetchPendingBookRequests())
    } catch {
      /* 승인 대기 목록 실패가 화면 전체를 막지 않게 한다 */
    } finally {
      setReqLoading(false)
    }
  }

  useEffect(() => { loadMaster(); loadPending() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRange() }, [dateFrom, dateTo])   // eslint-disable-line react-hooks/exhaustive-deps

  /** 상태를 바꾸는 처리 후 공통 재조회 */
  async function reloadAll() {
    await Promise.all([loadMaster(), loadRange(), loadPending()])
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

  async function handleCheckout(userId: string, bookIds: number[], notes: string, checkoutAt?: string) {
    setBusy(true)
    try {
      const titles = bookIds.map(id => books.find(b => b.id === id)?.title).filter(Boolean) as string[]
      const res = await adminCheckoutBooksWithNotify(userId, bookIds, notes, titles, checkoutAt)
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

  async function handleApprove(req: BookRequest) {
    setReqBusyId(req.id)
    try {
      const res = await approveBookRequestWithNotify(req, currentUserName)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await reloadAll()
        return
      }
      showToast('대여 신청을 승인했습니다', 'success')
      await reloadAll()
    } finally { setReqBusyId(null) }
  }

  async function handleReject(req: BookRequest, reason: string) {
    setReqBusyId(req.id)
    try {
      const res = await rejectBookRequestWithNotify(req, reason, currentUserName)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await loadPending()
        return
      }
      showToast('대여 신청을 거절했습니다', 'success')
      await reloadAll()
    } finally { setReqBusyId(null) }
  }

  // ─── 파생 데이터 ───────────────────────────────────────────────────────────

  /** 도서별 현재 활성 대여 (카드/테이블의 '대여자' 표기용) */
  const activeLoanByBook = useMemo(() => {
    const m: Record<number, AdminBookLoan> = {}
    outstanding.forEach(l => { m[l.book_id] = l })
    return m
  }, [outstanding])

  /** 사용자별 보유 권수 (active + pending 합산)
   *
   *  한도 판정은 서버(admin_checkout_books)가 최종적으로 강제한다. 여기 값은
   *  모달에서 "이미 2권"을 미리 알려주기 위한 표시용이다. 합산 대상이 서버와
   *  달라지면 화면에서는 가능해 보이는데 등록만 실패하는 상황이 되므로
   *  active + pending 이라는 서버와 같은 기준을 쓴다. */
  const heldCountByUser = useMemo(() => {
    const m: Record<string, number> = {}
    outstanding.forEach(l => { m[l.user_id] = (m[l.user_id] ?? 0) + 1 })
    pendingReqs.forEach(r => { m[r.user_id] = (m[r.user_id] ?? 0) + 1 })
    return m
  }, [outstanding, pendingReqs])

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
    if (loanFilter === 'active')   list = list.filter(l => l.status === 'active' && daysUntilDue(l.due_at) >= 0)
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
  useEffect(() => { setLoanPage(1) },    [loanQ, loanFilter, dateFrom, dateTo])
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
  function csvLoans()   { exportCSV(filteredLoans.map(loanCsvRow), `대여이력_${dateFrom}_${dateTo}`) }
  function csvOverdue() {
    exportCSV(overdueRows.map(l => ({
      ...loanCsvRow(l),
      연체일수: Math.max(0, -daysUntilDue(l.due_at)),
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
      key: 'act', label: '처리', width: 120,
      render: l => {
        // 반납/분실은 대여가 성립한 건에만 노출한다 (pending/종결 건은 대상 아님)
        if (l.status !== 'active' && l.status !== 'overdue') {
          return <span style={{ fontSize: 12, color: '#C3C9D6' }}>-</span>
        }
        return (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" style={{ ...BTN_MINI, background: '#111', color: '#fff' }}
              onClick={() => setReturnTarget({ loan: l, action: 'return' })}>반납</button>
            <button className="btn" style={{ ...BTN_MINI, background: '#FEF2F2', color: '#DC2626' }}
              onClick={() => setReturnTarget({ loan: l, action: 'lost' })}>분실</button>
          </div>
        )
      },
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
    ...loanColumns.filter(c => c.key !== 'returned'),
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
    { id: 'requests' as const, label: '승인 대기', count: pendingReqs.length },
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

          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)',
          }}>
            <StatCard label="전체 도서"   value={stats.total} />
            <StatCard label="대여 가능"   value={stats.available} color="#1988FF" />
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
              { id: 'active'   as const, label: '대여중', count: rangeLoans.filter(l => l.status === 'active' && daysUntilDue(l.due_at) >= 0).length },
              { id: 'overdue'  as const, label: '연체',   count: rangeLoans.filter(l => l.status === 'active' && daysUntilDue(l.due_at) < 0).length },
              { id: 'returned' as const, label: '반납',   count: rangeLoans.filter(l => l.status === 'returned').length },
              { id: 'lost'     as const, label: '분실',   count: rangeLoans.filter(l => l.status === 'lost').length },
              { id: 'closed'   as const, label: '거절·취소', count: rangeLoans.filter(l => l.status === 'rejected' || l.status === 'cancelled').length },
            ]}
            activeTab={loanFilter}
            onTabChange={id => setLoanFilter(id)}
            searchProps={{ value: loanQ, onChange: setLoanQ, placeholder: '도서명 · 대여자 · 부서 검색' }}
            onCsvClick={csvLoans}
            csvLabel="CSV 추출"
          />

          <div style={{ fontSize: 12, color: '#A5AEC0' }}>
            조회 기준은 <b style={{ color: '#64748B' }}>대여일</b>입니다.
            기간 밖에 시작된 미반납 건은 연체 관리 탭에서 확인하세요.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
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

          <div style={{ fontSize: 12, color: '#A5AEC0' }}>
            연체 판정은 저장된 상태값이 아니라 <b style={{ color: '#64748B' }}>반납기한(due_at)</b> 기준입니다.
            사용자 화면·알림과 동일한 기준을 사용하므로 숫자가 어긋나지 않습니다.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <DataTable
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

      {/* ═══════════════════════ 승인 대기 ═══════════════════════ */}
      {tab === 'requests' && (
        pendingReqs.length === 0 && !reqLoading ? (
          <div style={{ ...CARD, padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1E1E1E' }}>승인 대기 중인 신청이 없습니다</div>
            <div style={{ fontSize: 13, color: '#A5AEC0', marginTop: 6 }}>
              사용자가 도서관 화면에서 대여를 신청하면 여기에 표시됩니다.
            </div>
          </div>
        ) : (
          <BookRequestPanel
            requests={pendingReqs}
            users={users}
            loading={reqLoading}
            busyId={reqBusyId}
            onApprove={handleApprove}
            onReject={handleReject}
            onRefresh={loadPending}
          />
        )
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
