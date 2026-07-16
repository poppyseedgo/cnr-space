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
 *  - 대여/반납: 관리자가 오프라인 후 앱에 기록
 *
 * ✅ 변경 이력
 *  - [2026-07-16] 최초 작성
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
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
  created_at:  string
  updated_at:  string
  category?:   BookCategory | null
}

interface EditForm {
  title:       string
  author:      string
  publisher:   string
  isbn:        string
  category_id: string
  acquired_at: string
  status:      'available' | 'maintenance' | 'lost'
  notes:       string
  cover_url:   string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LibraryPageProps {
  isAdmin:    boolean
  users:      AppUser[]
  authUserId: string
  showToast:  (msg: string, type: ToastType) => void
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const MAX_BORROW_PER_USER = 2
const BORROW_DAYS         = 7

const EMPTY_FORM: EditForm = {
  title: '', author: '', publisher: '', isbn: '',
  category_id: '', acquired_at: '', status: 'available',
  notes: '', cover_url: '',
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function isOverdue(dueAt: string): boolean {
  return new Date(dueAt) < new Date()
}

function formatDue(dueAt: string): string {
  const d = new Date(dueAt)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatAcquired(acquired: string | null): string {
  if (!acquired) return ''
  return acquired.slice(0, 7) // "YYYY-MM"
}

// CSV 행 파싱
function parseCSV(text: string): string[][] {
  return text.trim().split('\n').map(row => {
    const cols: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') { inQ = !inQ; continue }
      if (row[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue }
      cur += row[i]
    }
    cols.push(cur.trim())
    return cols
  })
}

// ─── BookCard ─────────────────────────────────────────────────────────────────

function StatusBadge({ status, dueAt }: { status: Book['status'] | 'overdue'; dueAt?: string }) {
  const configs = {
    available:   { bg: 'var(--color-available-bg)',  color: 'var(--color-available-text)',  label: '대여가능' },
    borrowed:    { bg: 'var(--color-busy-bg)',        color: 'var(--color-busy-text)',        label: '대여중' },
    overdue:     { bg: 'var(--color-danger-bg)',      color: 'var(--color-danger-text)',      label: '연체중' },
    maintenance: { bg: 'var(--color-neutral-bg)',     color: 'var(--color-neutral-text)',     label: '정비중' },
    lost:        { bg: 'var(--color-expired-bg)',     color: 'var(--color-expired-text)',     label: '분실' },
  }
  const cfg = configs[status] ?? configs.available
  return (
    <span className="chip chip--xs" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}{dueAt && status === 'overdue' ? ` (${formatDue(dueAt)}까지)` : ''}
    </span>
  )
}

function CoverPlaceholder({ title }: { title: string }) {
  const colors = ['#DBEAFE','#D1FAE5','#FCE7F3','#FEF3C7','#EDE9FE','#FFEDD5']
  const idx = title.charCodeAt(0) % colors.length
  return (
    <div style={{
      width: '100%', aspectRatio: '3/4',
      background: colors[idx],
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 8, gap: 8,
    }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <span style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', padding: '0 8px', wordBreak: 'keep-all' }}>
        {title.slice(0, 10)}
      </span>
    </div>
  )
}

function BookCard({
  book, checkout, borrower, isAdmin, isOverdueStatus,
  onCheckout, onReturn, onEdit, onDelete,
}: {
  book: Book
  checkout?: BookCheckout | null
  borrower?: AppUser
  isAdmin: boolean
  isOverdueStatus: boolean
  onCheckout: (b: Book) => void
  onReturn: (b: Book, c: BookCheckout) => void
  onEdit: (b: Book) => void
  onDelete: (b: Book) => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const displayStatus = isOverdueStatus ? 'overdue' : book.status as any

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'box-shadow 0.15s',
    }}
    onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-card-lg)')}
    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-card)')}>
      {/* 표지 */}
      <div style={{ padding: 12, paddingBottom: 8 }}>
        {book.cover_url && !imgErr ? (
          <img
            src={book.cover_url}
            alt={book.title}
            onError={() => setImgErr(true)}
            style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 8 }}
          />
        ) : (
          <CoverPlaceholder title={book.title} />
        )}
      </div>

      {/* 정보 */}
      <div style={{ padding: '0 12px', flex: 1 }}>
        {/* 상태 뱃지 */}
        <div style={{ marginBottom: 6 }}>
          <StatusBadge
            status={displayStatus}
            dueAt={checkout?.due_at}
          />
        </div>
        {/* 제목 */}
        <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4, marginBottom: 2,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', wordBreak: 'keep-all' }}>
          {book.title}
        </div>
        {/* 저자·출판사 */}
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
          {[book.author, book.publisher].filter(Boolean).join(' · ')}
        </div>
        {/* 카테고리 */}
        {book.category && (
          <span style={{ fontSize: 10, background: '#F1F5F9', color: '#64748B',
            padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginBottom: 4 }}>
            {book.category.name}
          </span>
        )}
        {/* 취득연월 */}
        {book.acquired_at && (
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
            {formatAcquired(book.acquired_at)} 구매
          </div>
        )}
        {/* 대여자 정보 (관리자) */}
        {isAdmin && checkout && (
          <div style={{ fontSize: 11, padding: '4px 8px', background: '#F8FAFC',
            borderRadius: 6, marginBottom: 4 }}>
            <span style={{ color: '#374151', fontWeight: 500 }}>
              {borrower?.name ?? '알 수 없음'}
            </span>
            <span style={{ color: '#94A3B8' }}> · {borrower?.dept ?? ''}</span>
            <br/>
            <span style={{ color: isOverdueStatus ? '#DC2626' : '#64748B', fontSize: 10 }}>
              반납예정 {checkout.due_at ? formatDue(checkout.due_at) : '-'}
              {isOverdueStatus && ' ⚠️ 연체'}
            </span>
          </div>
        )}
      </div>

      {/* 관리자 버튼 */}
      {isAdmin && (
        <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* 대여가능 → 대여관리 */}
          {book.status === 'available' && (
            <button
              className="btn"
              onClick={() => onCheckout(book)}
              style={{ width: '100%', background: '#000', color: '#fff',
                padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 500 }}>
              대여 등록
            </button>
          )}
          {/* 대여중/연체 → 반납 */}
          {book.status === 'borrowed' && checkout && (
            <button
              className="btn"
              onClick={() => onReturn(book, checkout)}
              style={{ width: '100%',
                background: isOverdueStatus ? 'var(--color-danger-bg)' : 'var(--color-available-bg)',
                color: isOverdueStatus ? 'var(--color-danger-text)' : 'var(--color-available-text)',
                padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 500 }}>
              반납 처리
            </button>
          )}
          {/* 편집·삭제 */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn"
              onClick={() => onEdit(book)}
              style={{ flex: 1, background: '#F8FAFC', color: '#374151',
                padding: '5px 0', borderRadius: 6, fontSize: 11 }}>
              ✏️ 편집
            </button>
            {book.status === 'available' && (
              <button
                className="btn"
                onClick={() => onDelete(book)}
                style={{ flex: 1, background: '#FEE2E2', color: '#DC2626',
                  padding: '5px 0', borderRadius: 6, fontSize: 11 }}>
                🗑️ 삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CheckoutModal ────────────────────────────────────────────────────────────

function CheckoutModal({
  book, users, activeCheckouts, onConfirm, onClose, loading,
}: {
  book: Book
  users: AppUser[]
  activeCheckouts: BookCheckout[]
  onConfirm: (userId: string) => void
  onClose: () => void
  loading: boolean
}) {
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 2권 이미 대여중인 사용자 제외
  const userBorrowCount = useMemo(() => {
    const map: Record<string, number> = {}
    activeCheckouts.forEach(c => { map[c.user_id] = (map[c.user_id] ?? 0) + 1 })
    return map
  }, [activeCheckouts])

  const filtered = useMemo(() => {
    if (!q.trim()) return []
    const lower = q.toLowerCase()
    return users.filter(u =>
      u.is_active !== false &&
      (u.name.toLowerCase().includes(lower) || u.dept?.toLowerCase().includes(lower) || u.employee_id?.includes(lower))
    ).slice(0, 8)
  }, [q, users])

  const selectedUser = users.find(u => u.user_id === selectedId)

  return (
    <div style={OVERLAY_STYLE} onClick={onClose}>
      <div style={{ ...MODAL_STYLE, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={MODAL_HEADER_STYLE}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>대여 등록</div>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>📖 {book.title}</div>
          </div>
          <button className="btn" onClick={onClose} style={CLOSE_BTN_STYLE}>✕</button>
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <label style={LABEL_STYLE}>대여자 검색</label>
          <input
            autoFocus
            value={q}
            onChange={e => { setQ(e.target.value); setSelectedId(null) }}
            placeholder="이름, 부서, 사번으로 검색..."
            style={INPUT_STYLE}
          />

          {/* 검색 결과 */}
          {filtered.length > 0 && !selectedId && (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', marginTop: 4 }}>
              {filtered.map(u => {
                const cnt = userBorrowCount[u.user_id] ?? 0
                const maxed = cnt >= MAX_BORROW_PER_USER
                return (
                  <button
                    key={u.user_id}
                    disabled={maxed}
                    onClick={() => { setSelectedId(u.user_id); setQ(u.name) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '10px 14px',
                      background: maxed ? '#FAFAFA' : '#fff',
                      opacity: maxed ? 0.5 : 1,
                      borderBottom: '1px solid #F1F5F9',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      cursor: maxed ? 'not-allowed' : 'pointer',
                    }}>
                    <span>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</span>
                      <span style={{ fontSize: 12, color: '#64748B', marginLeft: 6 }}>{u.dept}</span>
                    </span>
                    {maxed && (
                      <span style={{ fontSize: 11, color: '#DC2626' }}>최대 {MAX_BORROW_PER_USER}권</span>
                    )}
                    {!maxed && cnt > 0 && (
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>{cnt}권 대여중</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* 선택된 유저 */}
          {selectedUser && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#F0FDF4',
              borderRadius: 8, border: '1px solid #BBF7D0' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>✅ {selectedUser.name}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                {selectedUser.dept} · 현재 {userBorrowCount[selectedUser.user_id] ?? 0}권 대여중
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                반납 예정일: {(() => { const d = new Date(); d.setDate(d.getDate() + BORROW_DAYS); return `${d.getMonth()+1}/${d.getDate()}` })()}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn" onClick={onClose}
              style={{ flex: 1, background: '#F1F5F9', color: '#374151',
                padding: '10px 0', borderRadius: 8, fontSize: 14 }}>
              취소
            </button>
            <button
              className="btn"
              disabled={!selectedId || loading}
              onClick={() => selectedId && onConfirm(selectedId)}
              style={{ flex: 2, background: selectedId ? '#000' : '#E2E8F0',
                color: selectedId ? '#fff' : '#94A3B8',
                padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {loading ? '처리중...' : '대여 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── BookEditModal ────────────────────────────────────────────────────────────

function BookEditModal({
  book, categories, onSave, onClose, loading,
}: {
  book: Book | null   // null = 신규
  categories: BookCategory[]
  onSave: (form: EditForm, kakaoItem?: any) => void  // ← [fix-img] kakaoItem 추가
  onClose: () => void
  loading: boolean
}) {
  const isNew = book === null
  const [form, setForm] = useState<EditForm>(() => ({
    title:       book?.title       ?? '',
    author:      book?.author      ?? '',
    publisher:   book?.publisher   ?? '',
    isbn:        book?.isbn        ?? '',
    category_id: book?.category_id ? String(book.category_id) : '',
    acquired_at: book?.acquired_at ?? '',
    status:      (book?.status === 'borrowed' ? 'available' : book?.status) ?? 'available',
    notes:       book?.notes       ?? '',
    cover_url:   book?.cover_url   ?? '',
  }))
  const [kakaoQ,           setKakaoQ]           = useState('')
  const [kakaoResults,     setKakaoResults]     = useState<any[]>([])
  const [kakaoLoading,     setKakaoLoading]     = useState(false)
  const [pendingKakaoItem, setPendingKakaoItem] = useState<any>(null)  // ← [fix-img]
  const [kakaoError,       setKakaoError]       = useState<string | null>(null)  // ← [fix-api]

  const up = (k: keyof EditForm, v: string) => setForm(p => ({ ...p, [k]: v }))

  async function searchKakao() {
    if (!kakaoQ.trim()) return
    setKakaoLoading(true)
    setKakaoError(null)  // ← [fix-api] 이전 오류 초기화
    try {
      const { data, error } = await supabase.functions.invoke('search-book', {
        body: { action: 'search', query: kakaoQ },
      })
      if (error) throw error
      setKakaoResults(data?.books ?? [])  // ← [fix-api] Edge Function 응답 키: 'books' (not 'documents')
    } catch (e: any) {
      // ← [fix-api] 오류 사용자에게 표시 (silent fail 제거)
      setKakaoError(e?.message ?? '카카오 검색 실패')
      setKakaoResults([])
    } finally {
      setKakaoLoading(false)
    }
  }

  function applyKakao(item: any) {
    // ← [fix-api] Edge Function search가 정규화한 형식:
    //   item.author    (string, authors[] join 완료)
    //   item.isbn      (string, ISBN13 이미 선택됨)
    //   item.title     (string, HTML 태그 이미 제거됨)
    //   item.thumbnail (string, Kakao CDN URL)
    setForm(p => ({
      ...p,
      title:     p.title || item.title || '',
      author:    item.author    ?? '',
      publisher: item.publisher ?? '',
      isbn:      item.isbn      ?? '',
      cover_url: item.thumbnail ?? '',
    }))
    setPendingKakaoItem(item)  // ← [fix-img]
    setKakaoResults([])
    setKakaoError(null)
    setKakaoQ('')
  }

  return (
    <div style={OVERLAY_STYLE} onClick={onClose}>
      <div style={{ ...MODAL_STYLE, maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={MODAL_HEADER_STYLE}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {isNew ? '📚 도서 추가' : '✏️ 도서 편집'}
          </div>
          <button className="btn" onClick={onClose} style={CLOSE_BTN_STYLE}>✕</button>
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 카카오 책 검색 */}
          <div>
            <label style={LABEL_STYLE}>카카오 책 검색 (자동완성)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={kakaoQ}
                onChange={e => setKakaoQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchKakao()}
                placeholder="제목 또는 ISBN으로 검색..."
                style={{ ...INPUT_STYLE, marginBottom: 0, flex: 1 }}
              />
              <button className="btn" onClick={searchKakao} disabled={kakaoLoading}
                style={{ background: '#F1F5F9', color: '#374151', padding: '0 14px',
                  borderRadius: 8, fontSize: 13, whiteSpace: 'nowrap' }}>
                {kakaoLoading ? '...' : '검색'}
              </button>
            </div>
            {kakaoError && (
              <div style={{ marginTop: 4, padding: '6px 10px', background: '#FEF2F2',
                border: '1px solid #FECACA', borderRadius: 6, fontSize: 12, color: '#DC2626' }}>
                ⚠️ {kakaoError}
              </div>
            )}
            {kakaoResults.length > 0 && (
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                {kakaoResults.slice(0, 5).map((item, i) => (
                  <button key={i} onClick={() => applyKakao(item)}
                    style={{ width: '100%', textAlign: 'left', padding: '10px 12px',
                      borderBottom: '1px solid #F1F5F9', background: '#fff',
                      display: 'flex', gap: 10, alignItems: 'center' }}>
                    {item.thumbnail && (
                      <img src={item.thumbnail} alt="" style={{ width: 32, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                    )}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {item.title}{/* ← [fix-api] HTML 이미 제거됨 */}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>
                        {item.author} · {item.publisher}{/* ← [fix-api] author (string), not authors[] */}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 표지 URL 미리보기 */}
          {form.cover_url && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <img src={form.cover_url} alt="표지" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                style={{ width: 60, height: 84, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0' }} />
              <div style={{ flex: 1 }}>
                <label style={LABEL_STYLE}>표지 URL</label>
                <input value={form.cover_url} onChange={e => up('cover_url', e.target.value)} style={INPUT_STYLE} />
              </div>
            </div>
          )}

          {/* 필수: 제목 */}
          <div>
            <label style={{ ...LABEL_STYLE }}>
              제목 <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input value={form.title} onChange={e => up('title', e.target.value)}
              placeholder="도서 제목" style={INPUT_STYLE} />
          </div>

          {/* 저자 */}
          <div>
            <label style={LABEL_STYLE}>저자</label>
            <input value={form.author} onChange={e => up('author', e.target.value)}
              placeholder="저자명" style={INPUT_STYLE} />
          </div>

          {/* 출판사 */}
          <div>
            <label style={LABEL_STYLE}>출판사</label>
            <input value={form.publisher} onChange={e => up('publisher', e.target.value)}
              placeholder="출판사" style={INPUT_STYLE} />
          </div>

          {/* ISBN */}
          <div>
            <label style={LABEL_STYLE}>ISBN</label>
            <input value={form.isbn} onChange={e => up('isbn', e.target.value)}
              placeholder="9791234567890" style={INPUT_STYLE} />
          </div>

          {/* 카테고리 + 구매연월 (2열) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={LABEL_STYLE}>카테고리</label>
              <select value={form.category_id} onChange={e => up('category_id', e.target.value)} style={INPUT_STYLE}>
                <option value="">분류 없음</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE}>구매연월</label>
              <input type="month" value={form.acquired_at} onChange={e => up('acquired_at', e.target.value)}
                style={INPUT_STYLE} />
            </div>
          </div>

          {/* 대여중 상태 안내 */}
          {!isNew && book?.status === 'borrowed' && (
            <div style={{ background: '#FEF9C3', border: '1px solid #FEF08A',
              borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#713F12' }}>
              📌 대여중인 도서입니다. 상태 변경은 카드의 [반납 처리] 버튼을 이용하세요.
            </div>
          )}

          {/* 상태 버튼 - 신규·대여중 제외 */}
          {!isNew && book?.status !== 'borrowed' && (
            <div>
              <label style={LABEL_STYLE}>상태</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['available', 'maintenance', 'lost'] as const).map(s => {
                  const labels = { available: '대여가능', maintenance: '정비중', lost: '분실' }
                  return (
                    <button key={s} onClick={() => up('status', s)} className="btn"
                      style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12,
                        background: form.status === s ? '#000' : '#F1F5F9',
                        color: form.status === s ? '#fff' : '#374151', fontWeight: 500 }}>
                      {labels[s]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 메모 */}
          <div>
            <label style={LABEL_STYLE}>메모</label>
            <textarea value={form.notes} onChange={e => up('notes', e.target.value)}
              placeholder="기타 메모 (선택)" rows={2}
              style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={onClose}
              style={{ flex: 1, background: '#F1F5F9', color: '#374151',
                padding: '10px 0', borderRadius: 8, fontSize: 14 }}>
              취소
            </button>
            <button className="btn"
              disabled={!form.title.trim() || loading}
              onClick={() => onSave(form, pendingKakaoItem ?? undefined)}
              style={{ flex: 2, background: form.title.trim() ? '#000' : '#E2E8F0',
                color: form.title.trim() ? '#fff' : '#94A3B8',
                padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {loading ? '저장중...' : isNew ? '추가하기' : '저장하기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ImportModal ──────────────────────────────────────────────────────────────

function ImportModal({
  categories, onImport, onClose, loading,
}: {
  categories: BookCategory[]
  onImport: (rows: any[]) => void
  onClose: () => void
  loading: boolean
}) {
  const [preview, setPreview] = useState<any[]>([])
  const [errors,  setErrors]  = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const HEADERS = ['제목', '저자', '출판사', 'ISBN', '카테고리', '구매연월', '메모']

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const rows = parseCSV(text)
      if (!rows.length) return
      // 첫 행이 헤더인지 확인
      const hasHeader = rows[0][0] === '제목' || rows[0][0].includes('title')
      const dataRows = hasHeader ? rows.slice(1) : rows
      const errs: string[] = []
      const parsed = dataRows.filter(r => r.length > 0 && r[0]).map((r, i) => {
        const title = r[0]?.trim()
        if (!title) { errs.push(`${i + 2}행: 제목 없음`); return null }
        const catName = r[4]?.trim()
        const cat = catName ? categories.find(c => c.name === catName) : null
        if (catName && !cat) errs.push(`${i + 2}행: 카테고리 "${catName}" 없음 — 분류 없음으로 등록`)
        return {
          title,
          author:      r[1]?.trim() || null,
          publisher:   r[2]?.trim() || null,
          isbn:        r[3]?.trim() || null,
          category_id: cat?.id ?? null,
          acquired_at: r[5]?.trim() || null,
          notes:       r[6]?.trim() || null,
          status:      'available' as const,
        }
      }).filter(Boolean)
      setPreview(parsed)
      setErrors(errs)
    }
    reader.readAsText(file, 'UTF-8')
  }

  return (
    <div style={OVERLAY_STYLE} onClick={onClose}>
      <div style={{ ...MODAL_STYLE, maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={MODAL_HEADER_STYLE}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>📥 도서 일괄 등록 (CSV)</div>
          <button className="btn" onClick={onClose} style={CLOSE_BTN_STYLE}>✕</button>
        </div>

        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 포맷 안내 */}
          <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 12, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>CSV 형식 (첫 행: 헤더)</div>
            <code style={{ display: 'block', color: '#374151', lineHeight: 1.8 }}>
              {HEADERS.join(',')}
            </code>
            <div style={{ color: '#64748B', marginTop: 6 }}>
              · 제목은 필수 / 나머지는 선택<br/>
              · 카테고리: DB에 등록된 이름과 정확히 일치<br/>
              · 구매연월: YYYY-MM 형식 (예: 2023-08)<br/>
              · 인코딩: UTF-8
            </div>
          </div>

          {/* 파일 선택 */}
          <div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
            <button className="btn" onClick={() => fileRef.current?.click()}
              style={{ width: '100%', background: '#F1F5F9', color: '#374151',
                padding: '12px 0', borderRadius: 8, fontSize: 14, border: '2px dashed #CBD5E1' }}>
              📂 CSV 파일 선택
            </button>
          </div>

          {/* 오류 */}
          {errors.length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: 10, fontSize: 12, color: '#DC2626' }}>
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* 미리보기 */}
          {preview.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                미리보기 ({preview.length}건)
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      {['제목','저자','출판사','카테고리'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left',
                          borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#374151' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 20).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '6px 10px' }}>{r.title}</td>
                        <td style={{ padding: '6px 10px', color: '#64748B' }}>{r.author ?? '-'}</td>
                        <td style={{ padding: '6px 10px', color: '#64748B' }}>{r.publisher ?? '-'}</td>
                        <td style={{ padding: '6px 10px', color: '#64748B' }}>
                          {r.category_id ? categories.find(c => c.id === r.category_id)?.name : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 20 && (
                  <div style={{ padding: '6px 10px', color: '#64748B', fontSize: 11 }}>
                    외 {preview.length - 20}건...
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}
              style={{ flex: 1, background: '#F1F5F9', color: '#374151',
                padding: '10px 0', borderRadius: 8, fontSize: 14 }}>
              취소
            </button>
            <button className="btn"
              disabled={preview.length === 0 || loading}
              onClick={() => onImport(preview)}
              style={{ flex: 2,
                background: preview.length > 0 ? '#000' : '#E2E8F0',
                color: preview.length > 0 ? '#fff' : '#94A3B8',
                padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {loading ? '등록중...' : `${preview.length}건 등록`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 공통 스타일 상수 ─────────────────────────────────────────────────────────

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: 16,
}

const MODAL_STYLE: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  width: '100%',
}

const MODAL_HEADER_STYLE: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '20px 20px 16px',
  borderBottom: '1px solid #F1F5F9',
}

const CLOSE_BTN_STYLE: React.CSSProperties = {
  background: '#F1F5F9', color: '#64748B',
  width: 28, height: 28, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, flexShrink: 0,
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#374151', marginBottom: 4,
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', border: '1px solid #E2E8F0', borderRadius: 8,
  padding: '9px 12px', fontSize: 13, outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
  marginBottom: 0,
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function LibraryPage({ isAdmin, users, authUserId, showToast }: LibraryPageProps) {
  // ── Data State ──
  const [books,          setBooks]          = useState<Book[]>([])
  const [categories,     setCategories]     = useState<BookCategory[]>([])
  const [activeCheckouts, setActiveCheckouts] = useState<BookCheckout[]>([])
  const [loading,        setLoading]        = useState(true)

  // ── UI State ──
  const [searchQ,        setSearchQ]        = useState('')
  const [filterCategory, setFilterCategory] = useState<number | 'ALL'>('ALL')
  const [filterStatus,   setFilterStatus]   = useState<'all' | 'available' | 'borrowed'>('all')

  // ── Modal State ──
  const [checkoutModal,  setCheckoutModal]  = useState<Book | null>(null)
  const [editModal,      setEditModal]      = useState<{ book: Book | null } | null>(null)
  const [importModal,    setImportModal]    = useState(false)
  const [actionLoading,  setActionLoading]  = useState(false)
  const [deleteConfirm,  setDeleteConfirm]  = useState<Book | null>(null)

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

      // 3. 활성 대여 (관리자만 조회 가능)
      let checkouts: BookCheckout[] = []
      if (isAdmin) {
        const { data: coData } = await supabase
          .from('book_checkouts')
          .select('id, book_id, user_id, checkout_at, due_at, returned_at, status, notes')
          .eq('status', 'active')
        checkouts = (coData ?? []) as BookCheckout[]
      }

      setBooks((booksData ?? []) as Book[])
      setCategories((catData ?? []) as BookCategory[])
      setActiveCheckouts(checkouts)
    } catch (e: any) {
      showToast('도서 목록을 불러올 수 없습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // 카테고리
    if (filterCategory !== 'ALL') {
      list = list.filter(b => b.category_id === filterCategory)
    }
    // 상태
    if (filterStatus === 'available') {
      list = list.filter(b => b.status === 'available')
    } else if (filterStatus === 'borrowed') {
      list = list.filter(b => b.status === 'borrowed')
    }
    return list
  }, [books, searchQ, filterCategory, filterStatus])

  // ─── 대여 등록 ──────────────────────────────────────────────────────────────

  async function handleCheckout(userId: string) {
    if (!checkoutModal) return
    setActionLoading(true)
    try {
      const dueAt = new Date()
      dueAt.setDate(dueAt.getDate() + BORROW_DAYS)

      // 1. INSERT checkout
      const { error: cErr } = await supabase
        .from('book_checkouts')
        .insert({
          book_id:     checkoutModal.id,
          user_id:     userId,
          due_at:      dueAt.toISOString(),
          status:      'active',
        })
      if (cErr) throw cErr

      // 2. UPDATE book status
      const { error: bErr } = await supabase
        .from('books')
        .update({ status: 'borrowed', updated_at: new Date().toISOString() })
        .eq('id', checkoutModal.id)
      if (bErr) throw bErr

      showToast('대여 등록 완료', 'success')
      setCheckoutModal(null)
      await load()
    } catch (e: any) {
      showToast(`대여 등록 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 반납 처리 ──────────────────────────────────────────────────────────────

  async function handleReturn(book: Book, checkout: BookCheckout) {
    setActionLoading(true)
    try {
      // 1. UPDATE checkout → returned
      const { error: cErr } = await supabase
        .from('book_checkouts')
        .update({ status: 'returned', returned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', checkout.id)
      if (cErr) throw cErr

      // 2. UPDATE book status → available
      const { error: bErr } = await supabase
        .from('books')
        .update({ status: 'available', updated_at: new Date().toISOString() })
        .eq('id', book.id)
      if (bErr) throw bErr

      showToast('반납 처리 완료', 'success')
      await load()
    } catch (e: any) {
      showToast(`반납 처리 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 도서 저장 (추가/편집) ───────────────────────────────────────────────────

  // ── 카카오 표지 → Supabase Storage 영구 저장 ──────────────────────────────
  // [fix-img] Kakao CDN URL은 외부 도메인 <img> 차단됨
  //   → Edge Function 'apply' 액션으로 Storage book-covers/{book_id}에 업로드
  //   → books.cover_url이 Storage URL로 업데이트됨 (reload 후 반영)
  async function applyKakaoToStorage(bookId: number, kakaoItem: any): Promise<void> {
    try {
      const { error } = await supabase.functions.invoke('search-book', {
        body: { action: 'apply', book_id: bookId, kakao: kakaoItem },
      })
      if (error) console.warn('[Library] 표지 Storage 저장 실패:', error.message)
      // 실패해도 책 정보 저장은 완료 — 표지만 없음
    } catch (e) {
      console.warn('[Library] 표지 Storage 저장 오류:', e)
    }
  }

  async function handleSaveBook(form: EditForm, kakaoItem?: any) {
    if (!editModal) return
    setActionLoading(true)
    const isNew = editModal.book === null

    const payload: any = {
      title:       form.title.trim(),
      author:      form.author.trim() || null,
      publisher:   form.publisher.trim() || null,
      isbn:        form.isbn.trim() || null,
      // [fix-img] cover_url은 kakaoItem이 있을 때 null로 초기화
      //   → applyKakaoToStorage() 호출 후 Edge Function이 Storage URL로 업데이트
      //   → kakaoItem 없을 때만 form.cover_url (수동 입력 URL) 사용
      cover_url:   kakaoItem ? null : (form.cover_url.trim() || null),
      category_id: form.category_id ? parseInt(form.category_id) : null,
      acquired_at: form.acquired_at ? `${form.acquired_at}-01` : null,  // ← [fix①]
      notes:       form.notes.trim() || null,
      updated_at:  new Date().toISOString(),
    }
    if (isNew) {
      payload.status = 'available'
    } else {
      // ← [fix②] borrowed 상태는 status 변경 불가
      if (editModal.book?.status !== 'borrowed') {
        payload.status = form.status
      }
    }

    try {
      if (isNew) {
        // INSERT → 생성된 id 받아서 cover 처리
        const { data: inserted, error } = await supabase
          .from('books').insert(payload).select('id').single()
        if (error) throw error
        showToast('도서를 추가했습니다.', 'success')
        // [fix-img] 카카오 표지 있으면 Storage 업로드 (비동기, 완료 대기)
        if (kakaoItem && inserted?.id) {
          await applyKakaoToStorage(inserted.id, kakaoItem)
        }
      } else {
        const bookId = editModal.book!.id
        const { error } = await supabase.from('books')
          .update(payload).eq('id', bookId)
        if (error) throw error
        showToast('도서 정보를 수정했습니다.', 'success')
        // [fix-img] 카카오 표지 변경된 경우 Storage 업로드
        if (kakaoItem) {
          await applyKakaoToStorage(bookId, kakaoItem)
        }
      }
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
      // ← [fix③] FK 제약 방지: 대여 이력(반납 포함) 있으면 삭제 차단
      const { count, error: cErr } = await supabase
        .from('book_checkouts')
        .select('id', { count: 'exact', head: true })
        .eq('book_id', book.id)
      if (cErr) throw cErr
      if ((count ?? 0) > 0) {
        showToast('대여 이력이 있는 도서는 삭제할 수 없습니다. 상태를 "분실"로 변경하세요.', 'warning')
        setDeleteConfirm(null)
        setActionLoading(false)
        return
      }
      const { error } = await supabase.from('books').delete().eq('id', book.id)
      if (error) throw error
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
    let success = 0
    const errs: string[] = []
    try {
      // 50건씩 배치 insert
      const BATCH = 50
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const { error } = await supabase.from('books').insert(
          batch.map((r: any) => ({
            title:       r.title,
            author:      r.author,
            publisher:   r.publisher,
            isbn:        r.isbn,
            category_id: r.category_id,
            acquired_at: r.acquired_at ? (r.acquired_at.length === 7 ? `${r.acquired_at}-01` : r.acquired_at) : null,  // ← [fix①] YYYY-MM → YYYY-MM-01
            notes:       r.notes,
            status:      'available',
          }))
        )
        if (error) errs.push(error.message)
        else success += batch.length
      }
      if (errs.length > 0) {
        showToast(`${success}건 등록, ${errs.length}건 오류`, 'warning')
      } else {
        showToast(`${success}건 일괄 등록 완료`, 'success')
      }
      setImportModal(false)
      await load()
    } catch (e: any) {
      showToast(`일괄 등록 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  const checkoutMap = useMemo(() => {
    const m: Record<number, BookCheckout> = {}
    activeCheckouts.forEach(c => { m[c.book_id] = c })
    return m
  }, [activeCheckouts])

  // 통계
  const stats = useMemo(() => ({
    total:     books.length,
    available: books.filter(b => b.status === 'available').length,
    borrowed:  books.filter(b => b.status === 'borrowed').length,
    overdue:   isAdmin
      ? activeCheckouts.filter(c => isOverdue(c.due_at)).length
      : 0,
  }), [books, activeCheckouts, isAdmin])

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', paddingBottom: 60 }}>
      {/* ── 헤더 배너 ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        padding: '32px 24px 24px',
        color: '#fff',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px' }}>📚 도서관</div>
              <div style={{ fontSize: 14, color: '#94A3B8', marginTop: 4 }}>CNR Research 사내 도서관</div>
            </div>
            {/* 관리자 액션 버튼 */}
            {isAdmin && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setImportModal(true)}
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff',
                    padding: '8px 14px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.2)' }}>
                  📥 일괄 등록
                </button>
                <button className="btn" onClick={() => setEditModal({ book: null })}
                  style={{ background: '#fff', color: '#111',
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                  + 도서 추가
                </button>
              </div>
            )}
          </div>

          {/* 통계 */}
          <div style={{ display: 'flex', gap: 20, marginTop: 20, flexWrap: 'wrap' }}>
            {[
              { label: '전체', val: stats.total,     color: '#94A3B8' },
              { label: '대여가능', val: stats.available, color: '#34D399' },
              { label: '대여중', val: stats.borrowed,  color: '#F472B6' },
              ...(isAdmin && stats.overdue > 0
                ? [{ label: '연체중 ⚠️', val: stats.overdue, color: '#F87171' }]
                : []),
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: '#64748B' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 필터 바 ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #F1F5F9', padding: '12px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 검색 */}
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="제목, 저자, 출판사 검색..."
              style={{ ...INPUT_STYLE, paddingLeft: 34 }}
            />
          </div>

          {/* 상태 필터 */}
          <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', padding: 3, borderRadius: 8 }}>
            {([['all','전체'], ['available','대여가능'], ['borrowed','대여중']] as const).map(([v, l]) => (
              <button key={v} className="btn" onClick={() => setFilterStatus(v)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12,
                  background: filterStatus === v ? '#fff' : 'transparent',
                  color: filterStatus === v ? '#111' : '#64748B',
                  fontWeight: filterStatus === v ? 600 : 400,
                  boxShadow: filterStatus === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* 카테고리 탭 (스크롤) */}
        {categories.length > 0 && (
          <div style={{ maxWidth: 1100, margin: '10px auto 0', overflowX: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => setFilterCategory('ALL')}
              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, whiteSpace: 'nowrap',
                background: filterCategory === 'ALL' ? '#111' : '#F1F5F9',
                color: filterCategory === 'ALL' ? '#fff' : '#374151', fontWeight: 500 }}>
              전체
            </button>
            {categories.map(c => (
              <button key={c.id} className="btn" onClick={() => setFilterCategory(c.id)}
                style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, whiteSpace: 'nowrap',
                  background: filterCategory === c.id ? '#111' : '#F1F5F9',
                  color: filterCategory === c.id ? '#fff' : '#374151', fontWeight: 500 }}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 도서 그리드 ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
            <div>도서 목록 불러오는 중...</div>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 600 }}>도서가 없습니다</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>검색어나 필터를 바꿔보세요</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14 }}>
              {filteredBooks.length}권
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 16,
            }}>
              {filteredBooks.map(book => {
                const checkout = checkoutMap[book.id] ?? null
                const borrower = checkout ? users.find(u => u.user_id === checkout.user_id) : undefined
                const overdue  = checkout ? isOverdue(checkout.due_at) : false
                return (
                  <BookCard
                    key={book.id}
                    book={book}
                    checkout={checkout}
                    borrower={borrower}
                    isAdmin={isAdmin}
                    isOverdueStatus={overdue}
                    onCheckout={setCheckoutModal}
                    onReturn={(b, c) => handleReturn(b, c)}
                    onEdit={b => setEditModal({ book: b })}
                    onDelete={setDeleteConfirm}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── 모달들 ── */}

      {/* 대여 등록 모달 */}
      {checkoutModal && (
        <CheckoutModal
          book={checkoutModal}
          users={users}
          activeCheckouts={activeCheckouts}
          onConfirm={handleCheckout}
          onClose={() => setCheckoutModal(null)}
          loading={actionLoading}
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
        <ImportModal
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
