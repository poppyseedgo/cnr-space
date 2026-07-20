/**
 * BookCheckoutModal.tsx — [Admin] 도서 대여 등록
 *
 * [2026-07-22] 신규 — 기존 LibraryPage 내부 CheckoutModal 대체
 *
 * Figma: 1335:820 (책 선택 진입) / 1335:994 (책 미선택 진입)
 *
 * 요건:
 *   · 대여자 단일 선택 / 도서 복수 선택
 *   · 대여자 검색은 SPACE 참석자 검색 패턴 재사용
 *     (usersProp 메모리 필터링 — DB 호출 0회, 이름·이메일·부서, 최대 8건, 키보드 네비)
 *     단, 참석자 검색과 달리 "본인 제외" 하지 않는다 → 관리자도 도서를 빌릴 수 있어야 함
 *   · 저장은 admin_checkout_books RPC 단일 트랜잭션 (부분 실패 없음)
 *
 * 한도 규칙(서버와 동일): 대여자의 active + pending 합계 + 선택 권수 ≤ MAX_BORROW_PER_USER
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { todayKST } from './libraryListShared'
import type { AppUser, Book, MyBookLoan } from '../../types'
import {
  OVERLAY, SHEET, BM, ModalHeader, Field, ModalFooter, MemoField,
  DateRows, UserChipRow, SearchInput, Suggestions, SuggestionRow, MEMO_MAX,
} from './bookModalShared'

interface Props {
  initialBook:  Book | null          // 책 카드에서 진입 시 미리 담김
  books:        Book[]               // 전체 도서(메모리 검색용)
  users:        AppUser[]
  /** 대여자별 보유 권수 (active + pending) — 한도 계산용 */
  heldCountByUser: Record<string, number>
  maxBorrow:    number
  borrowDays:   number
  loading:      boolean
  onClose:      () => void
  /** ← [2026-07-20] checkoutAt('YYYY-MM-DD') 추가 — 서버가 이 날짜 + 7일로 반납기한 계산 */
  onSubmit:     (userId: string, bookIds: number[], notes: string, checkoutAt: string) => void
}

// ── [2026-07-20] 대여일 선택 범위 — 오늘(KST) ± n일을 'YYYY-MM-DD' 로
//   'YYYY-MM-DD' 문자열을 로컬 자정으로 분해해서 다룬다.
//   new Date('YYYY-MM-DD') 는 UTC 자정 해석이라 KST 에서 하루 밀린다.
function shiftDays(n: number): string {
  const t = todayKST()
  const d = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BookCheckoutModal({
  initialBook, books, users, heldCountByUser, maxBorrow, borrowDays,
  loading, onClose, onSubmit,
}: Props) {
  // ── 선택 상태 ──────────────────────────────────────────────────────────────
  const [selectedBooks, setSelectedBooks] = useState<Book[]>(initialBook ? [initialBook] : [])
  const [bookQ,   setBookQ]   = useState('')
  const [bookFocus, setBookFocus] = useState(false)

  const [borrower, setBorrower] = useState<AppUser | null>(null)
  const [userQ,    setUserQ]    = useState('')
  const [userFocus, setUserFocus] = useState(false)
  const [userHighlight, setUserHighlight] = useState(-1)

  const [memo, setMemo] = useState('')
  // ← [2026-07-20] 대여일 — 기본값은 오늘(KST). 서버가 이 날짜 + 7일로 반납기한 계산
  const [checkoutAt, setCheckoutAt] = useState<string>(() => todayKST())
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  // ── 도서 검색 (메모리 필터링) ──────────────────────────────────────────────
  const bookResults = useMemo(() => {
    const q = bookQ.trim().toLowerCase()
    if (!q) return []
    const picked = new Set(selectedBooks.map(b => b.id))
    return books
      .filter(b => {
        if (picked.has(b.id)) return false                    // 이미 담은 책 제외
        if (b.status === 'maintenance' || b.status === 'lost') return false
        return (b.title ?? '').toLowerCase().includes(q)
            || (b.author ?? '').toLowerCase().includes(q)
            || (b.publisher ?? '').toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [bookQ, books, selectedBooks])

  // ── 대여자 검색 (참석자 검색 패턴 — 본인 제외 없음) ────────────────────────
  const userResults = useMemo(() => {
    const q = userQ.trim().toLowerCase()
    if (!q) return []
    return users
      .filter(u => {
        if (u.is_active === false) return false               // 퇴사자 제외
        const name  = (u.name  ?? '').toLowerCase()
        const email = (u.email ?? '').toLowerCase()
        const dept  = (u.dept  ?? '').toLowerCase()
        return name.includes(q) || email.includes(q) || dept.includes(q)
      })
      .slice(0, 8)
  }, [userQ, users])

  useEffect(() => { setUserHighlight(-1) }, [userQ])

  // ── 한도 계산 ──────────────────────────────────────────────────────────────
  const held    = borrower ? (heldCountByUser[borrower.user_id] ?? 0) : 0
  const remain  = Math.max(0, maxBorrow - held)
  const overLimit = !!borrower && selectedBooks.length > remain

  const canSubmit = !!borrower && selectedBooks.length > 0 && !overLimit && !loading

  const hint = (() => {
    if (!borrower || !overLimit) return null
    return remain === 0
      ? `이미 ${held}권 대여·신청 중입니다 (추가 대여 불가)`
      : `잔여 ${remain}권 — 도서를 ${remain}권만 선택해주세요`
  })()

  // ── 대여자 키보드 네비 ─────────────────────────────────────────────────────
  const onUserKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!userFocus || userResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setUserHighlight(i => (i + 1) % userResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setUserHighlight(i => (i <= 0 ? userResults.length - 1 : i - 1))
    } else if (e.key === 'Enter' && userHighlight >= 0) {
      e.preventDefault(); pickUser(userResults[userHighlight])
    }
  }

  const pickUser = (u: AppUser) => {
    if ((heldCountByUser[u.user_id] ?? 0) >= maxBorrow) return
    setBorrower(u); setUserQ(''); setUserFocus(false); setUserHighlight(-1)
  }

  const softBlur = (fn: () => void) => {
    blurTimer.current = setTimeout(fn, 120)   // 결과 클릭이 blur보다 먼저 처리되도록
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>
        <ModalHeader title="도서 대여" onClose={onClose} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 16px' }}>

          {/* ── 책 (복수 선택) ─────────────────────────────────────────── */}
          <Field label="책" required align="flex-start">
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
                onBlur={() => softBlur(() => setBookFocus(false))}
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
            </div>
          </Field>

          {/* ── 대여자 (단일 선택) ─────────────────────────────────────── */}
          <Field label="대여자" required align="flex-start">
            <div style={{ flex: 1, minWidth: 0 }}>
              {borrower ? (
                <UserChipRow
                  name={borrower.name}
                  dept={borrower.dept}
                  avatarUrl={(borrower as any).avatar_url ?? null}
                  onRemove={() => setBorrower(null)}
                />
              ) : (
                <>
                  <SearchInput
                    value={userQ}
                    onChange={setUserQ}
                    placeholder="팀즈에 등록된 이름으로 검색하세요"
                    onFocus={() => setUserFocus(true)}
                    onBlur={() => softBlur(() => setUserFocus(false))}
                    onKeyDown={onUserKeyDown}
                  />
                  {userFocus && userResults.length > 0 && (
                    <Suggestions>
                      {userResults.map((u, idx) => {
                        const cnt   = heldCountByUser[u.user_id] ?? 0
                        const maxed = cnt >= maxBorrow
                        return (
                          <SuggestionRow
                            key={u.user_id}
                            disabled={maxed}
                            highlighted={idx === userHighlight}
                            onClick={() => pickUser(u)}
                            left={
                              <span>
                                <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{u.name}</span>
                                <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 6 }}>{u.dept}</span>
                              </span>
                            }
                            right={
                              maxed
                                ? <span style={{ fontSize: 11, color: '#DC2626', flexShrink: 0 }}>최대 {maxBorrow}권</span>
                                : cnt > 0
                                  ? <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>{cnt}권 보유</span>
                                  : undefined
                            }
                          />
                        )
                      })}
                    </Suggestions>
                  )}
                  {userFocus && userQ.trim().length > 0 && userResults.length === 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#94A3B8' }}>
                      검색 결과가 없습니다
                    </div>
                  )}
                </>
              )}

              {borrower && (
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                  현재 {held}권 보유 · 잔여 {remain}권
                </div>
              )}
            </div>
          </Field>

          {/* ── 대여일 / 반납기한 ────────────────────────────────────────
              ← [2026-07-20] 대여일 선택 가능.
                · 소급 등록: 창구에서 이미 빌려준 건을 나중에 입력
                · 예약 등록: 미래 날짜로 선점
                범위는 오늘 기준 ±365일 — 서버 RPC 의 CHECKOUT_AT_OUT_OF_RANGE
                검증과 동일하게 맞춘다. */}
          <DateRows
            borrowDays={borrowDays}
            value={checkoutAt}
            onChange={setCheckoutAt}
            min={shiftDays(-365)}
            max={shiftDays(365)}
          />

          {/* ── 메모 ───────────────────────────────────────────────────── */}
          <MemoField value={memo} onChange={setMemo} />
        </div>

        <ModalFooter
          confirmLabel="대여 등록"
          onCancel={onClose}
          onConfirm={() => {
            if (!borrower) return
            onSubmit(borrower.user_id, selectedBooks.map(b => b.id), memo.slice(0, MEMO_MAX), checkoutAt)
          }}
          disabled={!canSubmit}
          loading={loading}
          hint={hint}
        />
      </div>
    </div>
  )
}
