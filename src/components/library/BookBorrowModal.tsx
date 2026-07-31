/**
 * BookBorrowModal.tsx — [일반 사용자] 도서 대여
 *
 * [2026-07-22] BookRequestModal(대여 신청)로 최초 작성
 * [2026-07-21] 대여 정책 변경으로 개편 — 파일명/문구/동작 전환
 *   · 승인 절차 폐지: 신청(pending) 생성 → 즉시 대여 성립(active)
 *   · 대여 시작일 선택 추가: 오늘 ~ 오늘+RESERVE_MAX_DAYS(3일)
 *     관리자 모달과 같은 DateRows 편집 모드를 쓰되 범위만 좁힌다.
 *     범위 상수는 utils/bookLoan.RESERVE_MAX_DAYS 하나를 참조한다 —
 *     서버 user_checkout_books 의 c_reserve_days 와 어긋나면 화면에서는
 *     고를 수 있는데 저장만 실패한다.
 * Figma: 1336:1079
 *
 * ← [2026-07-20] 헤더 '대여하기' 진입(책 미선택) 지원
 *   기존에는 book 이 항상 필수라 카드에서만 진입할 수 있었다.
 *   Hero 의 '대여하기' 버튼은 책이 정해지지 않은 상태이므로
 *   book={null} + books 목록을 받아 Admin 모달과 동일한 도서 검색을 노출한다.
 *   (검색 UI 는 bookModalShared 의 SearchInput/Suggestions 재사용 — 신규 패턴 아님)
 *
 * Admin 등록 모달과의 차이:
 *   · 타이틀 "도서 대여" / 확인 버튼 "대여하기"
 *   · 책: 카드 진입 시 1권 prefilled / 헤더 진입 시 검색으로 선택
 *   · 대여자: 로그인 사용자 본인 고정 (아바타 chip, 변경 불가)
 *   · 대여일: 오늘~+3일만 (관리자는 ±365일 — 소급 등록 권한이 있다)
 *
 * 저장: user_checkout_books RPC → status='active' 즉시 생성
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import type { AppUser, Book } from '../../types'
// ← [2026-07-21] 예약 가능 범위 SSOT — 서버 RPC 의 c_reserve_days 와 일치해야 한다
import { RESERVE_MAX_DAYS, fmtDateShortKo, checkoutWouldConflict } from '../../utils/bookLoan'
import type { BookReservedPeriod } from '../../lib/api' // ← [2026-07-30] 예약 구간 타입
import { todayKST } from './libraryListShared'
import {
  OVERLAY, SHEET, ModalHeader, Field, ModalFooter, MemoField,
  DateRows, UserChipRow, SearchInput, Suggestions, SuggestionRow, MEMO_MAX,
} from './bookModalShared'

interface Props {
  /** 카드 진입 시 해당 도서, 헤더 진입 시 null(검색으로 선택) */
  book:       Book | null
  /** book === null 일 때만 사용 — 메모리 검색 대상 전체 도서 */
  books?:     Book[]
  me:         AppUser | null      // 로그인 사용자 (users 에서 authUserId 로 조회)
  /** 본인의 현재 보유 권수 (대여중 + 예약) */
  heldCount:  number
  maxBorrow:  number
  borrowDays: number
  loading:    boolean
  onClose:    () => void
  /** ← [2026-07-21] checkoutAt('YYYY-MM-DD') 추가 — 서버가 이 날짜 + 7일로 반납기한 계산 */
  onSubmit:   (bookIds: number[], notes: string, checkoutAt: string) => void
  /** ← [2026-07-21] 연체 제재 차단 상태. 서버가 최종 강제하고 여기는 사전 안내다 */
  penaltyBlocked?: boolean
  penaltyReason?:  string | null
  /** ← [2026-07-30] 전 도서 예약/대여 구간 (20260737 RPC, 기간만) — 달력 비활성·안내용.
   *    빈 배열이어도 동작 (조회 실패 시 표시만 생략, 최종 차단은 서버 EXCLUDE 제약) */
  reservedPeriods?: BookReservedPeriod[]
}

// ── 대여일 선택 범위 — 오늘(KST) + n일을 'YYYY-MM-DD' 로
//   'YYYY-MM-DD' 를 로컬 자정으로 분해해 다룬다.
//   new Date('YYYY-MM-DD') 는 UTC 자정 해석이라 KST 에서 하루 밀린다.
function shiftDays(n: number): string {
  const t = todayKST()
  const d = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BookBorrowModal({
  book, books = [], me, heldCount, maxBorrow, borrowDays, loading, onClose, onSubmit,
  penaltyBlocked = false, penaltyReason = null, reservedPeriods = [],
}: Props) {
  const [memo, setMemo] = useState('')
  // ← [2026-07-21] 대여 시작일. 기본값은 오늘 = 지금 바로 대여.
  const [checkoutAt, setCheckoutAt] = useState<string>(() => todayKST())


  // ── 도서 선택 (헤더 진입 시에만 검색) ──────────────────────────────────────
  const [selectedBooks, setSelectedBooks] = useState<Book[]>(book ? [book] : [])

  // ── [2026-07-30] 예약 구간 → 달력 비활성 (고지 확정: date picker 유지 + 구간 날짜 비활성화)
  //   선택한 도서들의 live 구간(진행 중 대여 + 예약)에 걸치는 날짜는 시작일로 고를 수 없다.
  //   여러 권 선택 시 합집합 — 한 권이라도 막히면 그 날짜로는 일괄 대여가 실패하기 때문.
  //   판정 창은 오늘~+RESERVE_MAX_DAYS 뿐이므로 그 범위만 계산한다.
  // ← [2026-07-30 정정] "시작일이 구간 안"이 아니라 "그 시작일로 대여하면 기간이 겹치는가"로
  //   판정한다 (checkoutWouldConflict SSOT). 구간 나열 방식은 예약 8/3~ 앞의 7/30 시작
  //   (기한 8/6 → 침범) 케이스를 달력에서 못 막아 서버 에러로만 잡혔다.
  const disabledDates = useMemo(() => {
    const set = new Set<string>()
    if (selectedBooks.length === 0 || reservedPeriods.length === 0) return set
    const ids = new Set(selectedBooks.map(b => b.id))
    const mine = reservedPeriods.filter(p => ids.has(p.book_id))
    if (mine.length === 0) return set
    for (let i = 0; i <= RESERVE_MAX_DAYS; i++) {
      const d = shiftDays(i)
      if (mine.some(p => checkoutWouldConflict(d, borrowDays, p))) set.add(d)
    }
    return set
  }, [selectedBooks, reservedPeriods, borrowDays])

  // 선택 도서의 예약 구간 안내문 (창과 무관하게 가까운 것부터 최대 3건 — "언제 되는지"의 근거)
  const reservedNotes = useMemo(() => {
    if (selectedBooks.length === 0) return [] as string[]
    const today = todayKST()
    const out: string[] = []
    for (const b of selectedBooks) {
      const ps = reservedPeriods
        .filter(p => p.book_id === b.id && p.due_on >= today)
        .sort((a, z) => a.start_on.localeCompare(z.start_on))
        .slice(0, 3)
      for (const p of ps)
        out.push(`『${b.title}』 ${fmtDateShortKo(p.start_on)} ~ ${fmtDateShortKo(p.due_on)} 대여 예정`)
    }
    return out
  }, [selectedBooks, reservedPeriods])

  // 현재 선택일이 (도서 선택 변경으로) 비활성 구간에 들어가면 창 내 첫 가능일로 자동 이동.
  // 가능일이 없으면 그대로 두고 확인 버튼을 막는다 — 말없이 엉뚱한 날짜로 바꾸는 것보다 명시가 낫다.
  const firstAvailable = useMemo(() => {
    for (let i = 0; i <= RESERVE_MAX_DAYS; i++) {
      const d = shiftDays(i)
      if (!disabledDates.has(d)) return d
    }
    return null
  }, [disabledDates])
  useEffect(() => {
    if (disabledDates.has(checkoutAt) && firstAvailable) setCheckoutAt(firstAvailable)
  }, [disabledDates, checkoutAt, firstAvailable])
  const dateBlocked = disabledDates.has(checkoutAt)   // firstAvailable 없음 → 확인 차단
  const [bookQ, setBookQ]         = useState('')
  const [bookFocus, setBookFocus] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  const searchMode = book === null

  // Admin 모달(BookCheckoutModal)과 동일한 메모리 필터링 규칙
  const bookResults = useMemo(() => {
    if (!searchMode) return []
    const q = bookQ.trim().toLowerCase()
    if (!q) return []
    const picked = new Set(selectedBooks.map(b => b.id))
    return books
      .filter(b => {
        if (picked.has(b.id)) return false
        if (b.status === 'maintenance' || b.status === 'lost') return false
        return (b.title ?? '').toLowerCase().includes(q)
            || (b.author ?? '').toLowerCase().includes(q)
            || (b.publisher ?? '').toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [searchMode, bookQ, books, selectedBooks])

  const remain    = Math.max(0, maxBorrow - heldCount)
  const overLimit = remain < 1 || selectedBooks.length > remain
  const canSubmit = selectedBooks.length > 0 && !overLimit && !loading

  const hint = !overLimit ? null
    : remain < 1
      ? `대여·예약 합계 ${maxBorrow}권까지 가능합니다 (현재 ${heldCount}권)`
      : `잔여 ${remain}권 — 도서를 ${remain}권만 선택해주세요`

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>
        <ModalHeader title="도서 대여" onClose={onClose} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>

          {/* ── 책 ─────────────────────────────────────────────────────────
              카드 진입: prefilled(변경 불가) / 헤더 진입: 검색으로 선택 */}
          <Field label="책" required align={searchMode ? 'flex-start' : 'center'}>
            {!searchMode && book ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {book.cover_url && (
                  <div style={{ width: 28, height: 38, borderRadius: 4, overflow: 'hidden',
                    background: '#E2E8F0', flexShrink: 0 }}>
                    <img src={book.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <span style={{
                  fontSize: 20, fontWeight: 500, color: '#111', lineHeight: 1.5,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{book.title}</span>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }}>
                {selectedBooks.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {selectedBooks.map(b => (
                      <div key={b.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: '#F8FAFC', borderRadius: 8, padding: '6px 8px',
                      }}>
                        <div style={{
                          width: 24, height: 32, borderRadius: 4, overflow: 'hidden',
                          background: '#E2E8F0', flexShrink: 0,
                        }}>
                          {b.cover_url && (
                            <img src={b.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )}
                        </div>
                        <span style={{
                          flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: '#111',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{b.title}</span>
                        <button
                          onClick={() => setSelectedBooks(prev => prev.filter(x => x.id !== b.id))}
                          aria-label="도서 삭제"
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                            color: '#94A3B8', fontSize: 13, padding: 2, lineHeight: 1 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}

                <SearchInput
                  big
                  value={bookQ}
                  onChange={setBookQ}
                  placeholder="도서명 입력하여 검색"
                  onFocus={() => setBookFocus(true)}
                  onBlur={() => { blurTimer.current = setTimeout(() => setBookFocus(false), 120) }}
                />

                {bookFocus && bookResults.length > 0 && (
                  <Suggestions>
                    {bookResults.map(b => {
                      const borrowed = b.status === 'borrowed'
                      return (
                        <SuggestionRow
                          key={b.id}
                          disabled={borrowed}
                          onClick={() => {
                            if (borrowed) return
                            setSelectedBooks(prev => [...prev, b])
                            setBookQ('')
                          }}
                          left={
                            <span style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{b.title}</span>
                              {b.author && (
                                <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 6 }}>{b.author}</span>
                              )}
                            </span>
                          }
                          right={borrowed
                            ? <span style={{ fontSize: 11, color: '#DC2626', flexShrink: 0 }}>대여중</span>
                            : undefined}
                        />
                      )
                    })}
                  </Suggestions>
                )}

                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                  현재 {heldCount}권 보유(예약 포함) · 잔여 {remain}권
                </div>
              </div>
            )}
          </Field>

          {/* ── 대여자 (본인 고정) ─────────────────────────────────────── */}
          <Field label="대여자" required>
            {me
              ? <UserChipRow
                  name={me.name}
                  dept={me.dept}
                  avatarUrl={(me as any).avatar_url ?? null}
                />
              : <span style={{ fontSize: 14, color: '#94A3B8' }}>사용자 정보를 불러오는 중입니다…</span>}
          </Field>

          {/* ── 대여일 / 반납기한 ───────────────────────────────────────
              ← [2026-07-21] 사용자도 시작일을 고를 수 있다(대여 예약).
                범위는 오늘 ~ 오늘+RESERVE_MAX_DAYS. 과거는 선택 불가 —
                소급 대여를 열면 연체 판정을 스스로 회피할 수 있다.
                반납기한은 항상 "선택한 대여일 + borrowDays" 로 다시 계산된다
                (DateRows 내부 규칙 = 서버 RPC 규칙). */}
          <DateRows
            borrowDays={borrowDays}
            value={checkoutAt}
            onChange={setCheckoutAt}
            min={todayKST()}
            max={shiftDays(RESERVE_MAX_DAYS)}
            isDateDisabled={d => disabledDates.has(d)}  /* ← [2026-07-30] 예약 구간 날짜 비활성 */
          />

          {/* ← [2026-07-30] 선택 도서의 예약 구간 안내 — 달력에서 왜 막혔는지의 근거를
                같은 화면에 노출한다. 구간이 없으면 렌더하지 않음 */}
          {reservedNotes.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#B45309', lineHeight: 1.7 }}>
              {reservedNotes.map((t, i) => <div key={i}>· {t}</div>)}
              {dateBlocked && !firstAvailable && (
                <div style={{ color: '#B91C1C', fontWeight: 600 }}>
                  선택 가능한 대여 시작일이 없습니다 (오늘~{RESERVE_MAX_DAYS}일 내 전부 예약됨)
                </div>
              )}
            </div>
          )}

          {/* ── 메모 ───────────────────────────────────────────────────── */}
          <MemoField value={memo} onChange={setMemo} />

          {/* ← [2026-07-21] 연체 제재 배너.
              제재 중이면 아래 일반 안내 대신 이것만 보여준다 — 두 개를 같이
              띄우면 "바로 대여가 확정됩니다" 와 "대여할 수 없습니다" 가
              동시에 보여 모순이 된다. */}
          {penaltyBlocked ? (
            <div style={{
              marginTop: 12, padding: '10px 12px', background: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 8,
              fontSize: 12, color: '#B91C1C', lineHeight: 1.6,
            }}>
              {penaltyReason ?? '연체 제재로 대여할 수 없습니다.'}
              <br />
              사정이 있는 경우 도서 관리자에게 문의해 주세요.
            </div>
          ) : (
          <div style={{
            marginTop: 12, padding: '10px 12px', background: '#EEF2FF',
            border: '1px solid #C7D2FE', borderRadius: 8,
            fontSize: 12, color: '#3730A3', lineHeight: 1.6,
          }}>
            {/* ← [2026-07-21] 즉시 대여 문구에서 취소 안내를 뺐다.
                오늘 대여는 그 즉시 시작되므로 '시작 전 취소'가 성립하지 않는다.
                취소 안내는 예약(미래 시작)일 때만 노출한다. */}
            {checkoutAt === todayKST() ? (
              '확인을 누르면 바로 대여가 확정됩니다. 1층 책장에서 직접 도서를 찾아가세요.'
            ) : (
              <>
                {checkoutAt}부터 대여 예정으로 등록됩니다. 시작일 당일 아침에 알림을 보내드립니다.
                <br />
                대여 시작 전까지는 마이페이지에서 취소할 수 있습니다.
              </>
            )}
          </div>
          )}
        </div>

        <ModalFooter
          confirmLabel={checkoutAt === todayKST() ? '대여하기' : '대여 예약'}
          onCancel={onClose}
          onConfirm={() => onSubmit(selectedBooks.map(b => b.id), memo.slice(0, MEMO_MAX), checkoutAt)}
          disabled={!canSubmit || !me || penaltyBlocked || dateBlocked}  /* ← [2026-07-30] 예약 겹침 시작일 차단 */
          loading={loading}
          hint={penaltyBlocked ? (penaltyReason ?? '대여가 제한되었습니다')
              : dateBlocked    ? '선택한 날짜는 예약과 겹칩니다. 다른 시작일을 선택해 주세요'
              : hint}
        />
      </div>
    </div>
  )
}
