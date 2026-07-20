/**
 * BookRequestModal.tsx — [일반 사용자] 도서 대여 신청
 *
 * [2026-07-22] 신규
 * Figma: 1336:1079
 *
 * ← [2026-07-20] 헤더 '대여 신청' 진입(책 미선택) 지원
 *   기존에는 book 이 항상 필수라 카드에서만 진입할 수 있었다.
 *   Hero 의 '대여 신청' 버튼은 책이 정해지지 않은 상태이므로
 *   book={null} + books 목록을 받아 Admin 모달과 동일한 도서 검색을 노출한다.
 *   (검색 UI 는 bookModalShared 의 SearchInput/Suggestions 재사용 — 신규 패턴 아님)
 *
 * Admin 등록 모달과의 차이:
 *   · 타이틀 "도서 대여 신청" / 확인 버튼 "대여 신청"
 *   · 책: 카드 진입 시 1권 prefilled / 헤더 진입 시 검색으로 선택
 *   · 대여자: 로그인 사용자 본인 고정 (아바타 chip, 변경 불가)
 *   · 대여일/반납기한: 예상값 — 실제 값은 관리자 승인 시점에 확정된다
 *     (승인이 늦어지면 대여기간이 줄어드는 문제를 막기 위해 서버가 승인 시각 기준으로 재계산)
 *
 * 저장: request_book_checkout RPC → status='pending' 생성
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import type { AppUser, Book } from '../../types'
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
  /** 본인의 현재 보유 권수 (active + pending) */
  heldCount:  number
  maxBorrow:  number
  borrowDays: number
  loading:    boolean
  onClose:    () => void
  onSubmit:   (bookIds: number[], notes: string) => void
}

export function BookRequestModal({
  book, books = [], me, heldCount, maxBorrow, borrowDays, loading, onClose, onSubmit,
}: Props) {
  const [memo, setMemo] = useState('')

  // ── 도서 선택 (헤더 진입 시에만 검색) ──────────────────────────────────────
  const [selectedBooks, setSelectedBooks] = useState<Book[]>(book ? [book] : [])
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
      ? `대여·신청 합계 ${maxBorrow}권까지 가능합니다 (현재 ${heldCount}권)`
      : `잔여 ${remain}권 — 도서를 ${remain}권만 선택해주세요`

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={SHEET} onClick={e => e.stopPropagation()}>
        <ModalHeader title="도서 대여 신청" onClose={onClose} />

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
                  현재 {heldCount}권 보유 · 잔여 {remain}권
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

          {/* ── 대여일 / 반납기한 (예상값) ─────────────────────────────── */}
          <DateRows
            borrowDays={borrowDays}
            noteText="관리자 승인 시점을 기준으로 기한이 확정됩니다"
          />

          {/* ── 메모 ───────────────────────────────────────────────────── */}
          <MemoField value={memo} onChange={setMemo} />

          {/* 안내 */}
          <div style={{
            marginTop: 12, padding: '10px 12px', background: '#FFFBEB',
            border: '1px solid #FDE68A', borderRadius: 8,
            fontSize: 12, color: '#92400E', lineHeight: 1.6,
          }}>
            신청 후 관리자 승인이 완료되면 대여가 확정됩니다.
            같은 도서를 여러 명이 신청한 경우 먼저 승인된 신청이 확정됩니다.
          </div>
        </div>

        <ModalFooter
          confirmLabel="대여 신청"
          onCancel={onClose}
          onConfirm={() => onSubmit(selectedBooks.map(b => b.id), memo.slice(0, MEMO_MAX))}
          disabled={!canSubmit || !me}
          loading={loading}
          hint={hint}
        />
      </div>
    </div>
  )
}
