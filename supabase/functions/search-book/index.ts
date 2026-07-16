// @ts-nocheck
/**
 * ============================================================
 * search-book Edge Function
 * ============================================================
 * 카카오 책 검색 API 프록시 + 표지 이미지 영구 저장
 *
 * 두 액션 지원:
 *   1. POST { action: 'search', query: string, page?: number }
 *      → 카카오 책 검색 결과 반환 (제목/저자/출판사/ISBN/썸네일 URL 등)
 *      → 페이지당 10건, page 1~50 까지 (카카오 한도)
 *
 *   2. POST { action: 'apply', book_id: number, kakao: {...}, override_title?: boolean }
 *      → 카카오 검색 결과 1건을 books 행에 적용:
 *         · 썸네일 URL을 fetch하여 Supabase Storage 'book-covers'에 영구 업로드
 *         · books 테이블 UPDATE (author, publisher, isbn, cover_url)
 *         · 기본적으로 title은 건드리지 않음 (관리자가 입력한 정식 명칭 보존)
 *         · override_title: true 이면 카카오의 title로 덮어쓰기
 *      → 원자성 약속:
 *         · 이미지 업로드 실패 → books 변경 없음 (예외 throw)
 *         · 이미지 업로드 성공 → books UPDATE 실행
 *         · 두 단계가 트랜잭션은 아니지만, Storage 업로드가 먼저이므로
 *           UPDATE 실패 시에도 다음 호출이 upsert로 안전하게 재시도 가능
 *
 * Changelog:
 *   [2026-07-16 v3] 표지 최대 해상도 저장 (화질 개선)
 *     - 카카오 thumbnail은 R120x174(120×174px)로 강제 축소된 URL이라 저화질.
 *     - toHiResCover(): thumbnail URL의 fname= 원본 URL(최대 해상도)을 추출하여 저장.
 *       · fname 원본 예: http://t1.daumcdn.net/lbook/image/5477653?... (리사이즈 없는 원본)
 *       · http→https 승격 시도
 *     - normalizeKakaoBook에 cover_hires 필드 추가 (검색 결과에도 고화질 URL 노출)
 *     - uploadCoverImage: 고화질 URL 우선 다운로드, 실패 시 원본 thumbnail로 폴백(견고성)
 *
 *   [2026-05-14 v2] published_at → acquired_at 매핑 제거 (의미 오류 수정)
 *     - acquired_at은 "회사가 책을 입수한 날짜" 컬럼이므로 카카오 출판일과 다른 컬럼
 *     - 출판일 정보가 필요해지면 별도 컬럼(books.published_at)을 추후 추가 예정
 *
 *   [2026-05-14 v1] 최초 작성
 *     - 카카오 책 검색 API 연동 (v3/search/book)
 *     - Supabase Storage 'book-covers' bucket 영구 저장 (book_id 키)
 *     - 카카오 의존성 제거: 등록 후에는 카카오 CDN 미사용
 *
 * 환경변수:
 *   KAKAO_REST_API_KEY         — 카카오 디벨로퍼스 REST API 키
 *   SUPABASE_URL               — Supabase 자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase 자동 주입 (Storage 쓰기 + DB UPDATE)
 *
 * 배포:
 *   supabase functions deploy search-book \
 *     --project-ref jjzcqpbwkkujttwxksvy \
 *     --no-verify-jwt
 * ============================================================
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── 환경변수 ────────────────────────────────────────────────────────────────
const KAKAO_REST_API_KEY = Deno.env.get('KAKAO_REST_API_KEY') ?? ''
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ── Supabase 클라이언트 (Service Role: Storage 쓰기 + books UPDATE) ─────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── CORS ───────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (body: unknown, status: number = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// ── 타입 정의 ───────────────────────────────────────────────────────────────
interface KakaoBookRaw {
  title:        string
  authors:      string[]
  publisher:    string
  isbn:         string
  thumbnail:    string
  contents:     string
  datetime:     string
  url:          string
  translators?: string[]
  price?:       number
  status?:      string
}

interface KakaoSearchResponse {
  documents: KakaoBookRaw[]
  meta: {
    total_count:    number
    pageable_count: number
    is_end:         boolean
  }
}

interface NormalizedBook {
  title:        string
  author:       string
  publisher:    string
  isbn:         string
  thumbnail:    string          // 저화질 축소본 (검색 미리보기 카드용 — 빠름)
  cover_hires:  string          // ← [v3] 최대 해상도 원본 URL (Storage 저장용)
  contents:     string
  published_at: string | null
  kakao_url:    string
}

// ── 카카오 책 검색 API 호출 ────────────────────────────────────────────────
async function searchKakao(query: string, page: number = 1): Promise<KakaoSearchResponse> {
  if (!KAKAO_REST_API_KEY) {
    throw new Error('KAKAO_REST_API_KEY 환경변수 미설정')
  }

  const safePage = Math.min(Math.max(page, 1), 50)

  const url = new URL('https://dapi.kakao.com/v3/search/book')
  url.searchParams.set('query', query)
  url.searchParams.set('size',  '10')
  url.searchParams.set('page',  String(safePage))
  url.searchParams.set('sort',  'accuracy')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`카카오 API 오류 (${res.status}): ${text}`)
  }

  return await res.json() as KakaoSearchResponse
}

// ── ISBN 정규화: "ISBN10 ISBN13" → ISBN13 우선 ────────────────────────────
function pickIsbn(rawIsbn: string): string {
  if (!rawIsbn) return ''
  const parts  = rawIsbn.trim().split(/\s+/)
  const isbn13 = parts.find(p => p.length === 13)
  return isbn13 ?? parts[0] ?? ''
}

// ── 최대 해상도 표지 URL 도출 ────────────────────────────────────────────────
// ← [v3] 카카오 thumbnail 은 R120x174 로 강제 축소된 CDN URL.
//   구조: https://search1.kakaocdn.net/thumb/R120x174.q85/?fname=<원본URL(인코딩)>
//   전략:
//     1) fname= 의 원본 URL 추출 → 리사이즈 없는 최대 해상도 (진짜 원본)
//        · http→https 승격 (t1.daumcdn.net 등은 https 지원)
//     2) fname 없으면 리사이즈 규격만 확대 (R120x174 → R500x0: 폭 500 고정, 비율 유지)
//     3) 파싱 불가 시 원본 문자열 그대로 반환
function toHiResCover(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)

    // 1) 카카오 CDN 썸네일이면 fname 원본 추출
    if (u.hostname.endsWith('kakaocdn.net') && u.searchParams.has('fname')) {
      const origin = u.searchParams.get('fname')
      if (origin && origin.length > 0) {
        return origin.replace(/^http:\/\//i, 'https://')
      }
    }

    // 2) fname 이 없으면 리사이즈 규격만 확대
    return url.replace(/\/thumb\/[A-Za-z]\d+x\d+(\.[a-z0-9]+)?\//i, '/thumb/R500x0.q90/')
  } catch {
    return url
  }
}

// ── 카카오 응답 → 프론트에서 다루기 쉬운 형태로 정규화 ─────────────────────
function normalizeKakaoBook(d: KakaoBookRaw): NormalizedBook {
  const thumb = d.thumbnail ?? ''
  return {
    title:        d.title ?? '',
    author:       (d.authors ?? []).join(', '),
    publisher:    d.publisher ?? '',
    isbn:         pickIsbn(d.isbn ?? ''),
    thumbnail:    thumb,                 // 저화질 (미리보기용)
    cover_hires:  toHiResCover(thumb),   // ← [v3] 고화질 (저장용)
    contents:     d.contents ?? '',
    published_at: d.datetime ? d.datetime.slice(0, 10) : null,
    kakao_url:    d.url ?? '',
  }
}

// ── 이미지 fetch → Supabase Storage 업로드 → public URL 반환 ──────────────
// ← [v3] 고화질(원본) URL 우선 다운로드, 실패 시 저화질 thumbnail 로 폴백.
//   sourceUrl 은 검색 결과의 thumbnail(저화질) 또는 cover_hires(고화질) 어느 쪽이 와도
//   내부에서 toHiResCover 로 재도출하므로 항상 최대 해상도를 시도한다.
async function uploadCoverImage(bookId: number, sourceUrl: string): Promise<string> {
  const hiResUrl = toHiResCover(sourceUrl)  // ← [v3] 항상 고화질 재도출

  let imgRes = await fetch(hiResUrl)
  // ← [v3] 고화질 실패(404/hotlink 차단 등) → 원본 저화질 썸네일로 폴백
  if (!imgRes.ok && hiResUrl !== sourceUrl) {
    imgRes = await fetch(sourceUrl)
  }
  if (!imgRes.ok) {
    throw new Error(`이미지 다운로드 실패 (${imgRes.status}): ${hiResUrl}`)
  }

  const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const ext         = contentType.includes('png')  ? 'png'
                    : contentType.includes('webp') ? 'webp'
                    : 'jpg'

  const buffer = await imgRes.arrayBuffer()
  const bytes  = new Uint8Array(buffer)

  const path = `${bookId}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('book-covers')
    .upload(path, bytes, {
      contentType,
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage 업로드 실패: ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from('book-covers')
    .getPublicUrl(path)

  const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`
  return publicUrl
}

// ── books 테이블 UPDATE ────────────────────────────────────────────────────
async function updateBookMetadata(
  bookId: number,
  fields: Partial<{
    title:     string
    author:    string
    publisher: string
    isbn:      string
    cover_url: string
  }>
): Promise<void> {
  if (Object.keys(fields).length === 0) return

  const { error } = await supabase
    .from('books')
    .update(fields)
    .eq('id', bookId)

  if (error) {
    throw new Error(`books UPDATE 실패: ${error.message}`)
  }
}

// ============================================================================
// 메인 핸들러
// ============================================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST 만 지원합니다' }, 405)
  }

  try {
    const body   = await req.json()
    const action = body?.action

    // ─────────────────────────────────────────────────────────────────────
    // action: 'search' — 카카오 책 검색만 수행 (DB 변경 없음)
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'search') {
      const query = (body?.query ?? '').toString().trim()
      const page  = Number(body?.page ?? 1)

      if (query.length === 0) {
        return jsonResponse({ books: [], total: 0, is_end: true, page })
      }

      const kakao = await searchKakao(query, page)
      const books = kakao.documents.map(normalizeKakaoBook)

      return jsonResponse({
        books,
        total:  kakao.meta.total_count,
        is_end: kakao.meta.is_end,
        page,
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // action: 'apply' — 선택된 카카오 결과를 books 행에 영구 적용
    //   1) 이미지 업로드 (Storage)
    //   2) books UPDATE (메타데이터 + cover_url)
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'apply') {
      const bookId        = Number(body?.book_id)
      const kakao         = body?.kakao
      const overrideTitle = body?.override_title === true

      if (!Number.isInteger(bookId) || bookId <= 0) {
        return jsonResponse({ error: 'book_id (양의 정수) 필수' }, 400)
      }
      if (!kakao || typeof kakao !== 'object') {
        return jsonResponse({ error: 'kakao 객체 필수' }, 400)
      }

      const { data: existing, error: selErr } = await supabase
        .from('books')
        .select('id, title')
        .eq('id', bookId)
        .maybeSingle()

      if (selErr) {
        throw new Error(`books 조회 실패: ${selErr.message}`)
      }
      if (!existing) {
        return jsonResponse({ error: `book_id ${bookId} 없음` }, 404)
      }

      // ← [v3] cover_hires(고화질)가 있으면 우선, 없으면 thumbnail.
      //   uploadCoverImage 내부에서 다시 toHiResCover 를 적용하므로 어느 쪽이 와도 안전.
      const coverSource: string =
        (typeof kakao.cover_hires === 'string' && kakao.cover_hires.length > 0)
          ? kakao.cover_hires
          : (typeof kakao.thumbnail === 'string' ? kakao.thumbnail : '')

      let coverUrl: string | undefined = undefined
      if (coverSource.length > 0) {
        coverUrl = await uploadCoverImage(bookId, coverSource)
      }

      // UPDATE 필드 구성 (값이 있는 것만 UPDATE — 부분 보강 지원)
      // ← [2026-05-14 v2] published_at → acquired_at 매핑 제거
      //   acquired_at은 "회사가 책을 입수한 날짜" 컬럼이므로 카카오 출판일과 의미 다름.
      //   출판일이 필요하면 books.published_at 컬럼을 추후 별도 추가.
      const updates: Record<string, any> = {}
      if (kakao.author    && typeof kakao.author    === 'string') updates.author    = kakao.author
      if (kakao.publisher && typeof kakao.publisher === 'string') updates.publisher = kakao.publisher
      if (kakao.isbn      && typeof kakao.isbn      === 'string') updates.isbn      = kakao.isbn
      if (coverUrl)                                               updates.cover_url = coverUrl
      if (overrideTitle && kakao.title && typeof kakao.title === 'string') updates.title = kakao.title

      await updateBookMetadata(bookId, updates)

      return jsonResponse({
        ok:        true,
        book_id:   bookId,
        updated:   updates,
        cover_url: coverUrl ?? null,
      })
    }

    return jsonResponse({
      error: `알 수 없는 action: ${action}. 'search' 또는 'apply' 만 지원합니다.`,
    }, 400)

  } catch (err) {
    console.error('[search-book] 오류:', err)
    return jsonResponse({
      error: err instanceof Error ? err.message : String(err),
    }, 500)
  }
})
