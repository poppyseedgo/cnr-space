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
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
// ← [2026-07-22] 대여 등록/신청/승인 — 모든 상태 전이는 RPC 경유
import {
  adminCheckoutBooks, requestBookCheckout, approveBookRequest, rejectBookRequest,
  fetchPendingBookRequests, checkoutErrorMessage,
} from '../lib/api'
import { BookCheckoutModal } from '../components/library/BookCheckoutModal'
// ← [2026-07-20] Figma 73:831 Home list — 리스트 UI 토큰/카드/칩 SSOT
import {
  LT, SearchIcon, BooksLogoMark, BookGridCard, GenreChip, HeroCta, HeroStat,
  HERO_FONT_SB, isNewBook, todayKST,
} from '../components/library/libraryListShared'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { BookRequestModal }  from '../components/library/BookRequestModal'
import { BookRequestPanel }  from '../components/library/BookRequestPanel'
import type { BookRequest } from '../types'
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
  new_until:   string | null   // ← [2026-07-20] ⭐NEW⭐ 노출 종료일
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
  /** ← [2026-07-20] ⭐NEW⭐ — 체크 여부와 노출 종료일('YYYY-MM-DD') */
  is_new:      boolean
  new_until:   string
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
  category_id: '', acquired_at: '', is_new: false, new_until: '', status: 'available',
  notes: '', cover_url: '',
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function isOverdue(dueAt: string): boolean {
  return new Date(dueAt) < new Date()
}

// ── [2026-07-20] ⭐NEW⭐ 종료일 프리셋용 KST 날짜 유틸 ────────────────────────
//   'YYYY-MM-DD' 문자열을 직접 만든다. new Date('YYYY-MM-DD') 는 UTC 자정으로
//   해석돼 KST 에서 하루 밀리므로 파싱을 거치지 않는다.

/** 이번 달 말일 (KST) */
function endOfThisMonthKST(): string {
  const today = todayKST()                    // 'YYYY-MM-DD'
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  // Date(y, m, 0) = m월의 마지막 날 (월 인덱스가 0-based라 m 은 다음 달)
  const last = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/** 오늘(KST) + n일 */
function addDaysKST(n: number): string {
  const today = todayKST()
  const d = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

// ─── BookCard 제거됨 [2026-07-20] ───────────────────────────────────────────
//   Figma 73:831 Home list 반영으로 카드/뱃지/표지 렌더가 전면 교체됐다.
//   → src/components/library/libraryListShared.tsx 의 BookGridCard 사용.
//   StatusBadge / CoverPlaceholder / formatDue / formatAcquired 도 함께 이관·정리.

// ─── CheckoutModal 제거됨 [2026-07-22] ──────────────────────────────────────
//   → src/components/library/BookCheckoutModal.tsx (Admin, 복수 도서 + RPC)
//   → src/components/library/BookRequestModal.tsx  (사용자 신청)

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
    is_new:      !!book?.new_until,
    new_until:   book?.new_until?.slice(0, 10) ?? '',
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
            {/* ← [v3] 검색 중 움직이는 로딩 표시 (카카오 API 응답 지연 대응) */}
            {kakaoLoading && (
              <div style={{ marginTop: 8, padding: '14px 12px', display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 10,
                background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%',
                  border: '2px solid #CBD5E1', borderTopColor: '#334155',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite' }} />{/* index.css @keyframes spin (transform 기반, GPU) */}
                <span style={{ fontSize: 13, color: '#475569' }}>도서를 검색 중입니다...</span>
              </div>
            )}
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

          {/* ── ⭐NEW⭐ 라벨 ────────────────────────────────────────────────
              [2026-07-20] 신규.
              예전에는 구매연월이 이번 달이면 자동으로 붙었다. 관리자가 제어할
              수 없었고 월이 바뀌면 일제히 사라졌다. 이제 노출 종료일을 직접
              지정한다(books.new_until). 종료일이 지나면 스스로 내려간다. */}
          <div style={{
            border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px',
            background: form.is_new ? '#F8FAFC' : '#fff',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.is_new}
                onChange={e => {
                  const on = e.target.checked
                  // 켤 때 종료일이 비어 있으면 이번 달 말일을 기본값으로 채운다.
                  // (기존 자동 동작과 같은 기간이라 운영 감각이 바뀌지 않는다)
                  setForm(f => ({
                    ...f,
                    is_new: on,
                    new_until: on ? (f.new_until || endOfThisMonthKST()) : f.new_until,
                  }))
                }}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                ⭐NEW⭐ 신규 도서로 표시
              </span>
            </label>

            {form.is_new && (
              <div style={{ marginTop: 10 }}>
                <label style={LABEL_STYLE}>노출 종료일</label>
                <input
                  type="date"
                  value={form.new_until}
                  min={todayKST()}
                  onChange={e => up('new_until', e.target.value)}
                  style={INPUT_STYLE}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {([['이번 달 말', endOfThisMonthKST()],
                     ['+2주', addDaysKST(14)],
                     ['+1개월', addDaysKST(30)]] as const).map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      className="btn"
                      onClick={() => up('new_until', val)}
                      style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 11,
                        border: '1px solid #E2E8F0',
                        background: form.new_until === val ? '#111' : '#fff',
                        color:      form.new_until === val ? '#fff' : '#475569',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                  이 날짜까지 목록 카드에 라벨이 표시되고 ⭐NEW⭐ 필터에 잡힙니다.
                  지나면 자동으로 사라집니다.
                </div>
              </div>
            )}
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
  // ← [2026-07-20] Figma 103:70 '⭐NEW⭐' 칩 — 이번 달 취득 도서만
  const [filterCategory, setFilterCategory] = useState<number | 'ALL' | 'NEW'>('ALL')
  // ← [2026-07-20] 통계 4칸이 그대로 필터 버튼이 되므로 'overdue' 추가.
  //   3칸만 눌리고 연체중만 안 눌리면 일관성이 깨진다.
  const [filterStatus,   setFilterStatus]   = useState<'all' | 'available' | 'borrowed' | 'overdue'>('all')

  // ── Modal State ──
  const [checkoutModal,  setCheckoutModal]  = useState<Book | null>(null)
  // ← [2026-07-22] Admin 대여 등록(책 미선택 진입) / 사용자 대여 신청 / 승인 대기
  const [checkoutOpen,   setCheckoutOpen]   = useState(false)   // 헤더 진입(빈 상태)
  const [requestModal,   setRequestModal]   = useState<Book | null>(null)
  // ← [2026-07-20] Hero '대여 신청'(책 미선택 진입) — 모달에서 도서를 검색해 고른다
  const [requestOpen,    setRequestOpen]    = useState(false)
  const [pendingReqs,    setPendingReqs]    = useState<BookRequest[]>([])
  const [reqLoading,     setReqLoading]     = useState(false)
  const [reqBusyId,      setReqBusyId]      = useState<string | null>(null)
  const [myHeldCount,    setMyHeldCount]    = useState(0)        // 본인 보유(active+pending)
  const [heldCountByUser, setHeldCountByUser] = useState<Record<string, number>>({})

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

      // 3. 대여기록 (active + pending)
      //   ← [2026-07-22] 변경점 2가지
      //     · pending 포함 — 1인 한도는 "대여중 + 신청대기" 합산이므로 카운트에 필요
      //     · isAdmin 조건 제거 — 일반 사용자도 "본인" 보유 권수를 알아야 신청 한도를 계산할 수 있다.
      //       RLS(book_checkouts_select_self_or_admin)가 비관리자에겐 본인 행만 반환하므로 안전하다.
      const { data: coData } = await supabase
        .from('book_checkouts')
        .select('id, book_id, user_id, checkout_at, due_at, returned_at, status, notes')
        .in('status', ['active', 'pending'])
      const allCheckouts = (coData ?? []) as BookCheckout[]

      // 카드에 표시할 대여자 정보는 'active' 만 (pending 은 아직 대여가 아님)
      const checkouts = allCheckouts.filter(c => c.status === 'active')

      // 보유 권수 맵 (active + pending 합산)
      const heldMap: Record<string, number> = {}
      allCheckouts.forEach(c => { heldMap[c.user_id] = (heldMap[c.user_id] ?? 0) + 1 })

      setBooks((booksData ?? []) as Book[])
      setCategories((catData ?? []) as BookCategory[])
      setActiveCheckouts(checkouts)
      setHeldCountByUser(heldMap)
      setMyHeldCount(heldMap[authUserId] ?? 0)
    } catch (e: any) {
      showToast('도서 목록을 불러올 수 없습니다.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps
  // ← [2026-07-22] 관리자만 승인 대기 목록 조회
  useEffect(() => { loadPendingRequests() }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 대여기록 맵 ───────────────────────────────────────────────────────────
  //   ← [2026-07-20] 선언 위치를 필터링 위로 올렸다.
  //     '연체중' 필터가 due_at 을 봐야 해서 filteredBooks 가 이 맵에 의존한다.
  //     아래에 두면 TDZ(선언 전 참조)로 런타임에 터진다.
  const checkoutMap = useMemo(() => {
    const m: Record<number, BookCheckout> = {}
    activeCheckouts.forEach(c => { m[c.book_id] = c })
    return m
  }, [activeCheckouts])

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
    return list
  }, [books, searchQ, filterCategory, filterStatus, checkoutMap])

  // ─── 대여 등록 ──────────────────────────────────────────────────────────────

  // ── [Admin] 대여 등록 — admin_checkout_books RPC (여러 권 단일 트랜잭션)
  //   기존 개별 INSERT+UPDATE 방식은 N권 처리 시 부분 실패로
  //   "책은 borrowed 인데 대여기록 없음" 유령 데이터가 생겨 RPC 로 이관했다.
  async function handleCheckout(
    userId: string, bookIds: number[], notes: string,
    /** ← [2026-07-20] 대여일('YYYY-MM-DD'). 서버가 이 날짜 + 7일로 반납기한 계산 */
    checkoutAt?: string,
  ) {
    setActionLoading(true)
    try {
      // 날짜만 받으므로 그 날 정오(KST)로 고정한다.
      // 자정으로 보내면 타임존 경계에서 하루 밀릴 수 있고, 정오면 ±12시간 여유가 있다.
      const checkoutIso = checkoutAt
        ? new Date(`${checkoutAt}T12:00:00+09:00`).toISOString()
        : null
      const res = await adminCheckoutBooks(userId, bookIds, notes, checkoutIso)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await load()
        return
      }

      // 대여 확정 알림 — 여러 권이어도 1통 (스팸 방지)
      const titles = bookIds
        .map(id => books.find(b => b.id === id)?.title)
        .filter(Boolean) as string[]
      const label = titles.length > 1 ? `${titles[0]} 외 ${titles.length - 1}권` : (titles[0] ?? '')
      const due   = res.rows?.[0]?.due_at

      // ← [2026-07-20] 미래 날짜로 등록(예약)한 경우 '대여 확정' 알림을 보내지 않는다.
      //
      //   book_borrowed 는 "지금 대여되었습니다" 문구다. 아직 시작하지 않은
      //   예약에 이 메일이 나가면 대여자가 오늘 책을 받은 것으로 오해한다.
      //   ※ 시작일에 자동 통지하려면 book-due-reminder cron 에 '대여 시작'
      //     타입과 notified_started 컬럼을 추가해야 한다 (별도 작업).
      const startsInFuture = !!checkoutAt && checkoutAt > todayKST()

      if (startsInFuture) {
        showToast(`${checkoutAt}부터 대여 예정으로 등록했습니다 (알림 미발송)`, 'success')
      } else {
        supabase.functions.invoke('send-notification', {
          body: {
            type: 'book_borrowed',
            booking: {
              id:         res.rows?.[0]?.id ?? '',
              title:      label,
              user_id:    userId,
              book_title: label,
              due_at:     due,
              due_date_kst: due ? String(due).slice(0, 10) : undefined,
            },
          },
        }).catch(err => console.warn('[library] 대여 알림 발송 실패:', err))
      }

      showToast(`대여 등록 완료 (${bookIds.length}권)`, 'success')
      setCheckoutModal(null)
      setCheckoutOpen(false)
      await load()
    } catch (e: any) {
      showToast(`대여 등록 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ── [사용자] 대여 신청 — request_book_checkout RPC (pending 생성)
  async function handleRequest(bookIds: number[], notes: string) {
    setActionLoading(true)
    try {
      const res = await requestBookCheckout(bookIds, notes)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        return
      }
      const title = books.find(b => b.id === bookIds[0])?.title ?? ''

      // 관리자 전원에게 승인 요청 알림 (recipients='admins_only')
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'book_requested',
          booking: {
            id:         res.rows?.[0]?.id ?? '',
            title,
            user_id:    authUserId,
            book_title: title,
          },
        },
      }).catch(err => console.warn('[library] 신청 알림 발송 실패:', err))

      showToast('대여 신청이 접수되었습니다. 관리자 승인 후 확정됩니다.', 'success')
      setRequestModal(null)
      await load()
    } catch (e: any) {
      showToast(`대여 신청 실패: ${e.message}`, 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // ── [Admin] 승인 대기 목록 로드
  async function loadPendingRequests() {
    if (!isAdmin) return
    setReqLoading(true)
    try {
      setPendingReqs(await fetchPendingBookRequests())
    } catch {
      /* 목록 실패는 화면 전체를 막지 않는다 */
    } finally {
      setReqLoading(false)
    }
  }

  // ── [Admin] 신청 승인 — 승인 시점 기준으로 반납일이 재계산된다
  async function handleApprove(req: BookRequest) {
    setReqBusyId(req.id)
    try {
      const res = await approveBookRequest(req.id, currentUserName)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await loadPendingRequests(); await load()
        return
      }
      const due = res.rows?.[0]?.due_at
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'book_request_approved',
          booking: {
            id:         req.id,
            title:      req.book?.title ?? '',
            user_id:    req.user_id,
            book_title: req.book?.title ?? '',
            due_at:     due,
            due_date_kst: due ? String(due).slice(0, 10) : undefined,
          },
        },
      }).catch(err => console.warn('[library] 승인 알림 발송 실패:', err))

      showToast('대여 신청을 승인했습니다', 'success')
      await loadPendingRequests(); await load()
    } finally {
      setReqBusyId(null)
    }
  }

  // ── [Admin] 신청 거절 (사유 기록)
  async function handleReject(req: BookRequest, reason: string) {
    setReqBusyId(req.id)
    try {
      const res = await rejectBookRequest(req.id, reason, currentUserName)
      if (!res.ok) {
        showToast(checkoutErrorMessage(res.code ?? 'UNKNOWN', res.detail), 'error')
        await loadPendingRequests()
        return
      }
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'book_request_rejected',
          booking: {
            id:         req.id,
            title:      req.book?.title ?? '',
            user_id:    req.user_id,
            book_title: req.book?.title ?? '',
            reject_reason: reason,
          },
        },
      }).catch(err => console.warn('[library] 거절 알림 발송 실패:', err))

      showToast('대여 신청을 거절했습니다', 'success')
      await loadPendingRequests()
    } finally {
      setReqBusyId(null)
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
      // ← [2026-07-20] 체크 해제 시 반드시 null 로 덮어써야 라벨이 실제로 내려간다
      new_until:   form.is_new && form.new_until ? form.new_until : null,
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
            new_until:   null,   // ← [2026-07-20] 일괄 등록은 NEW 미지정 (등록 후 편집에서 개별 설정)
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
    <div style={{ minHeight: '100vh', background: LT.white, paddingBottom: 60 }}>
      <div style={{ maxWidth: LT.pageMax, margin: '0 auto' }}>

        {/* ══════════════════════════════════════════════════════════════════
            Hero — Figma 73:834
              padding 24 / gap 40 / radius 24
            ══════════════════════════════════════════════════════════════════ */}
        <section style={{
          display: 'flex', flexDirection: 'column',
          gap: isMobile ? 24 : LT.heroGap,
          padding: LT.pagePad, borderRadius: LT.heroRadius, background: LT.white,
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
                ← [2026-07-20] 권한별 분기
                  · 관리자   : 대여 등록 / 도서 추가 / 일괄 등록
                  · 일반사용자: 대여 신청 1개만
                Figma 는 4개를 한 줄에 다 그려 두었지만 그건 두 역할의 합집합이다. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isAdmin ? (
                <>
                  <HeroCta primary onClick={() => setCheckoutOpen(true)}>대여 등록</HeroCta>
                  <HeroCta onClick={() => setEditModal({ book: null })}>도서 추가</HeroCta>
                  <HeroCta onClick={() => setImportModal(true)}>일괄 등록</HeroCta>
                </>
              ) : (
                <HeroCta primary onClick={() => setRequestOpen(true)}>대여 신청</HeroCta>
              )}
            </div>
          </div>

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
                Figma 의 py 24 는 아래쪽만 반영해 이중 여백을 피한다. */}
          <div style={{
            width: '100%', display: 'flex', flexWrap: 'wrap', gap: 10,
            paddingBottom: LT.chipRowPadY,
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
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            카드 그리드 — Figma 1339:1205
              전폭 1352 / 5열 / 카드 251.2 / gap 24 / py 24
            ══════════════════════════════════════════════════════════════════ */}
        <main style={{ padding: `${LT.pagePad}px ${LT.pagePad}px 0` }}>

          {/* 관리자 승인 대기 패널 (선착순) */}
          {isAdmin && pendingReqs.length > 0 && (
            <div style={{ marginBottom: LT.colGap }}>
              <BookRequestPanel
                requests={pendingReqs}
                users={users}
                loading={reqLoading}
                busyId={reqBusyId}
                onApprove={handleApprove}
                onReject={handleReject}
                onRefresh={loadPendingRequests}
              />
            </div>
          )}

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
              rowGap: isMobile ? 20 : LT.colGap,
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
                    onCheckout={() => isAdmin ? setCheckoutModal(book) : setRequestModal(book)}
                    onReturn={() => { if (checkout) handleReturn(book, checkout) }}
                    onEdit={() => setEditModal({ book })}
                    onDelete={() => setDeleteConfirm(book)}
                  />
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* ── 모달들 ── */}

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
          onClose={() => { setCheckoutModal(null); setCheckoutOpen(false) }}
          onSubmit={handleCheckout}
        />
      )}

      {/* ← [2026-07-22] 대여 신청 모달 (일반 사용자) */}
      {!isAdmin && (requestModal || requestOpen) && (
        <BookRequestModal
          book={requestModal}
          books={books}
          me={me}
          heldCount={myHeldCount}
          maxBorrow={MAX_BORROW_PER_USER}
          borrowDays={BORROW_DAYS}
          loading={actionLoading}
          onClose={() => { setRequestModal(null); setRequestOpen(false) }}
          onSubmit={handleRequest}
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
