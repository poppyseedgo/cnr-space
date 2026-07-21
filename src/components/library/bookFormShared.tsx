/**
 * bookFormShared.tsx — 도서 등록/편집 폼 계열 공용 모듈
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규. LibraryPage.tsx 내부에 있던 아래 요소를 그대로 추출.
 *      · EditForm / EMPTY_FORM
 *      · endOfThisMonthKST / addDaysKST / parseCSV
 *      · BookEditModal        (도서 추가·편집)
 *      · ImportModal → BookImportModal 로 이름만 변경 (CSV 일괄 등록)
 *      · 공통 스타일 상수 6종 (OVERLAY/MODAL/HEADER/CLOSE/LABEL/INPUT)
 *
 * 📌 추출 이유 (근본 원인)
 *   어드민 '도서 관리' 탭에서도 동일한 추가/편집/일괄등록이 필요하다.
 *   두 화면이 각자 모달을 갖게 되면 필드 추가(예: ⭐NEW⭐ new_until)나
 *   카카오 표지 적용 규칙이 바뀔 때 한쪽만 고쳐지고 반드시 어긋난다.
 *   실제로 이 프로젝트에서 뱃지 라벨·날짜 포맷이 세 곳에 흩어져 같은 문제를
 *   겪었다. 화면을 늘리기 전에 폼을 단일 출처로 만든다.
 *
 * 📌 이번 추출의 원칙
 *   로직·마크업·스타일을 한 줄도 바꾸지 않는다. 위치 이동과 export 부여,
 *   ImportModal → BookImportModal 이름 변경만 수행한다.
 *   (동작 변경과 구조 변경을 한 번에 하면 회귀 원인을 분리할 수 없다)
 *
 * 📌 사용처
 *   - src/pages/LibraryPage.tsx                 (사용자/관리자 겸용 도서관 화면)
 *   - src/components/library/BookAdminPanel.tsx (어드민 '도서 관리' 탭)
 */

import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { todayKST } from './libraryListShared'
import type { Book, BookCategory, BookEditForm } from '../../types'

// ─── 폼 타입 ─────────────────────────────────────────────────────────────────
/** 도서 추가/편집 폼 상태
 *
 *  ← [2026-07-23] 실체 정의는 types/index.ts 의 BookEditForm 으로 이동했다.
 *    저장 로직(api.persistBook)이 같은 타입을 참조해야 하는데, lib 이
 *    components 를 import 하면 순환이 생기기 때문이다.
 *    기존 호출부(LibraryPage)가 쓰던 이름은 그대로 유지한다.
 */
export type EditForm = BookEditForm

export const EMPTY_FORM: EditForm = {
  title: '', author: '', publisher: '', isbn: '',
  category_id: '', acquired_at: '', is_new: false, new_until: '', status: 'available',
  notes: '', cover_url: '',
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

// ─── 공통 스타일 상수 ─────────────────────────────────────────────────────────

export const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 2000, padding: 16,
}

export const MODAL_STYLE: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  width: '100%',
}

export const MODAL_HEADER_STYLE: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '20px 20px 16px',
  borderBottom: '1px solid #F1F5F9',
}

export const CLOSE_BTN_STYLE: React.CSSProperties = {
  background: '#F1F5F9', color: '#64748B',
  width: 28, height: 28, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, flexShrink: 0,
}

export const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#374151', marginBottom: 4,
}

export const INPUT_STYLE: React.CSSProperties = {
  width: '100%', border: '1px solid #E2E8F0', borderRadius: 8,
  padding: '9px 12px', fontSize: 13, outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
  marginBottom: 0,
}

// ─── BookEditModal ────────────────────────────────────────────────────────────

export function BookEditModal({
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

// ─── BookImportModal (구 ImportModal) ────────────────────────────────────────

export function BookImportModal({
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
