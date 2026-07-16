#!/usr/bin/env node
/**
 * ============================================================
 * C&R Space — 도서 메타데이터 일괄 백필 스크립트
 * scripts/backfill-book-metadata.mjs
 * ============================================================
 *
 * 목적:
 *   books 테이블에 cover_url이 비어있는 도서들을 대상으로,
 *   카카오 책 검색 API에서 자동 매칭하여 표지/저자/출판사/ISBN을
 *   일괄 보강한다.
 *
 * 3단계 의사결정:
 *   · score ≥ threshold (기본 0.9) → auto_apply  (자동 적용)
 *   · 0.6 ≤ score < threshold       → manual_review (Phase D Admin UI에서 처리)
 *   · score < 0.6                    → no_match      (스킵)
 *
 * 스코어링 알고리즘 (제목 유사도):
 *   1.0  — 정규화 후 완전 일치
 *   0.95 — 부가표기((큰글자도서), [Prestige Lounge 전용 특별 도서] 등) 제거 후 일치
 *   0.70~0.90 — 한쪽이 다른쪽을 완전히 포함
 *   ~0.85 × dice — Dice 계수 (문자 bigram 기반)
 *
 * 동점 처리:
 *   같은 점수의 후보가 여럿이면 published_at이 빠른 것 우선 (원본 에디션 선호).
 *
 * 안전 장치:
 *   · 기본 DRY RUN: --apply 플래그가 없으면 DB 변경 절대 안 함
 *   · Idempotent: cover_url이 이미 있는 도서는 자동 스킵
 *   · 100ms rate-limit (--delay-ms로 조정)
 *   · 도서 단위 try-catch: 1건 실패해도 나머지 계속 진행
 *
 * 환경변수 (.env.local 또는 .env, 또는 export):
 *   SUPABASE_URL                또는 VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (DB SELECT + Edge Function 호출용)
 *
 * Changelog:
 *   [2026-05-14 v2] .env.local 파일도 함께 읽도록 수정 (Vite 표준 컨벤션 준수)
 *     - 우선순위: .env.local → .env (이미 설정된 값은 덮어쓰지 않음)
 *     - 에러 메시지에 어느 파일을 확인했는지 명시
 *
 *   [2026-05-14 v1] 최초 작성
 * ============================================================
 */

import fs   from 'node:fs/promises'
import path from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// 1. 환경변수 로드 (.env.local + .env)
// ════════════════════════════════════════════════════════════════════════════
// ← [v2] Vite 컨벤션 따라 .env.local 우선 → .env 보조
//   .env.local: gitignore 기본 포함, 개인/비밀 값
//   .env:       공통 값 (커밋되는 경우도 있음)
const envFilesChecked = []
async function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      const envText = await fs.readFile(file, 'utf-8')
      envFilesChecked.push(`✓ ${file}`)
      for (const line of envText.split('\n')) {
        // 주석 라인 스킵
        if (/^\s*#/.test(line)) continue
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (m) {
          const key   = m[1]
          const value = m[2].replace(/^['"]|['"]$/g, '')
          // 먼저 설정된 값은 덮어쓰지 않음 (export 우선, .env.local 차순위, .env 마지막)
          if (process.env[key] === undefined) process.env[key] = value
        }
      }
    } catch {
      envFilesChecked.push(`✗ ${file} (없음)`)
    }
  }
}
await loadEnv()

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL (또는 VITE_SUPABASE_URL) 환경변수 미설정')
  console.error('')
  console.error('   확인한 파일:')
  envFilesChecked.forEach(f => console.error(`     ${f}`))
  console.error('')
  console.error('   해결책 1) .env.local 파일에 추가:')
  console.error('     VITE_SUPABASE_URL=https://jjzcqpbwkkujttwxksvy.supabase.co')
  console.error('   해결책 2) 셸에서 export (현재 세션만):')
  console.error('     export SUPABASE_URL=https://jjzcqpbwkkujttwxksvy.supabase.co')
  process.exit(1)
}
if (!SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY 환경변수 미설정')
  console.error('')
  console.error('   확인한 파일:')
  envFilesChecked.forEach(f => console.error(`     ${f}`))
  console.error('')
  console.error('   값 확인: Supabase Dashboard > Settings > API > "service_role" secret')
  console.error('   ⚠️  이 키는 RLS를 우회하는 마스터 권한입니다. .env.local에만 두고')
  console.error('       절대 커밋하지 마세요. (.env.local은 Vite 기본 .gitignore에 포함)')
  console.error('')
  console.error('   해결책 1) .env.local 파일에 추가:')
  console.error('     SUPABASE_SERVICE_ROLE_KEY=<service_role secret 값>')
  console.error('   해결책 2) 셸에서 export (현재 세션만):')
  console.error('     export SUPABASE_SERVICE_ROLE_KEY=<service_role secret 값>')
  process.exit(1)
}


// ════════════════════════════════════════════════════════════════════════════
// 2. 인자 파싱
// ════════════════════════════════════════════════════════════════════════════
const args = {
  apply:     false,
  threshold: 0.9,
  bookId:    null,
  delayMs:   100,
  force:     false,   // ← [v3] cover_url 있어도 전체 재처리 (저화질 → 고화질 재적용)
}

function printHelp() {
  console.log(`
사용법: node scripts/backfill-book-metadata.mjs [옵션]

옵션:
  --apply               실제로 DB에 적용 (없으면 DRY RUN)
  --threshold <0.0~1.0> auto_apply 임계값 (기본: 0.9)
  --book-id <int>       특정 도서만 처리 (단일 테스트용)
  --force               cover_url 이 이미 있어도 전체 재처리 (저화질 → 고화질 재적용)
  --delay-ms <int>      요청 사이 대기 시간 ms (기본: 100)
  --help                도움말

예시:
  node scripts/backfill-book-metadata.mjs                       # cover 없는 것만 DRY RUN
  node scripts/backfill-book-metadata.mjs --apply                # cover 없는 것만 실제 적용
  node scripts/backfill-book-metadata.mjs --force                # 전체 재처리 DRY RUN
  node scripts/backfill-book-metadata.mjs --force --apply         # 전체 고화질 재적용
  node scripts/backfill-book-metadata.mjs --book-id 7 --apply    # 1건만 테스트 적용
  node scripts/backfill-book-metadata.mjs --threshold 0.85 --apply  # 더 공격적
`)
}

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if      (a === '--apply')     args.apply     = true
  else if (a === '--force')     args.force     = true   // ← [v3]
  else if (a === '--threshold') args.threshold = parseFloat(process.argv[++i])
  else if (a === '--book-id')   args.bookId    = parseInt(process.argv[++i])
  else if (a === '--delay-ms')  args.delayMs   = parseInt(process.argv[++i])
  else if (a === '--help')      { printHelp(); process.exit(0) }
  else { console.error(`❌ 알 수 없는 옵션: ${a}`); printHelp(); process.exit(1) }
}

if (isNaN(args.threshold) || args.threshold < 0 || args.threshold > 1) {
  console.error(`❌ --threshold는 0.0~1.0 사이여야 합니다 (입력: ${args.threshold})`)
  process.exit(1)
}


// ════════════════════════════════════════════════════════════════════════════
// 3. 텍스트 정규화 + 유사도
// ════════════════════════════════════════════════════════════════════════════

/** 소문자 + NFKC + 공백/구두점/괄호 제거 */
function normalize(s) {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_,.~∼·:;]/g, '')
    .replace(/[「」『』【】《》〈〉()[\]{}]/g, '')
}

/** 부가표기 제거: (큰글자도서), [Prestige Lounge ...], 「...」, 『...』, 【...】 */
function stripAnnotations(s) {
  if (!s) return s
  return s
    .replace(/[\(\[][^)\]]{0,40}[\)\]]/g, '')
    .replace(/「[^」]{0,40}」/g, '')
    .replace(/『[^』]{0,40}』/g, '')
    .replace(/【[^】]{0,40}】/g, '')
    .replace(/《[^》]{0,40}》/g, '')
    .trim()
}

/** Dice 계수 (문자 bigram 기반) */
function dice(a, b) {
  if (!a || !b)             return 0
  if (a === b)              return 1.0
  if (a.length < 2 || b.length < 2) return 0

  const bigrams = (s) => {
    const grams = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      grams.set(g, (grams.get(g) || 0) + 1)
    }
    return grams
  }

  const aG = bigrams(a)
  const bG = bigrams(b)
  let intersect = 0
  for (const [g, c] of aG) {
    if (bG.has(g)) intersect += Math.min(c, bG.get(g))
  }
  return (2 * intersect) / (a.length - 1 + b.length - 1)
}

/** 제목 매칭 스코어 (0.0~1.0) */
function scoreTitle(orig, cand) {
  const o = normalize(orig)
  const c = normalize(cand)

  if (!o || !c) return 0
  if (o === c)  return 1.0

  // 부가표기 제거 후 일치
  const oS = normalize(stripAnnotations(orig))
  const cS = normalize(stripAnnotations(cand))
  if (oS && cS && oS === cS) return 0.95

  // 한쪽이 다른쪽을 완전히 포함 (특별판 / 합본 케이스)
  if (oS && cS) {
    if (cS.includes(oS)) {
      const ratio = oS.length / cS.length
      return Math.min(0.9, 0.7 + ratio * 0.2)
    }
    if (oS.includes(cS)) {
      const ratio = cS.length / oS.length
      return Math.min(0.85, 0.6 + ratio * 0.25)
    }
  }

  // Dice 계수 기반 (최대 0.85까지만 — 정확 일치보다 항상 낮게)
  return dice(o, c) * 0.85
}


// ════════════════════════════════════════════════════════════════════════════
// 4. API 호출
// ════════════════════════════════════════════════════════════════════════════

async function loadBooks() {
  let url = `${SUPABASE_URL}/rest/v1/books?select=id,title,cover_url,isbn&order=id`
  if (args.bookId) {
    // 단일 도서: cover_url 있어도 처리 (재적용 시나리오)
    url += `&id=eq.${args.bookId}`
  } else if (!args.force) {
    // 전체: cover_url 없는 것만 (idempotent)
    url += `&cover_url=is.null`
  }
  // ← [v3] --force: cover_url 필터 없이 전체 재처리
  //   apply 는 Storage upsert + cover_url(?v=timestamp) 갱신이라 재적용 안전(멱등).

  const res = await fetch(url, {
    headers: {
      apikey:        SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`books 조회 실패 (${res.status}): ${await res.text()}`)
  return await res.json()
}

async function callEdgeFunction(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/search-book`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${SERVICE_KEY}`,
      apikey:         SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Edge Function 호출 실패 (${res.status}): ${text}`)
  }
  return await res.json()
}


// ════════════════════════════════════════════════════════════════════════════
// 5. 도서 1건 처리
// ════════════════════════════════════════════════════════════════════════════

async function processBook(book) {
  // 카카오 검색
  const searchResult = await callEdgeFunction({ action: 'search', query: book.title })
  const candidates   = searchResult.books || []

  if (candidates.length === 0) {
    return { book, decision: 'no_match', best: null, alternatives: [] }
  }

  // 스코어링 + 정렬 (점수 내림차순, 동점 시 published_at 빠른 순)
  const scored = candidates.map(c => ({
    kakao: c,
    score: scoreTitle(book.title, c.title),
  }))

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score
    const aDate = a.kakao.published_at || '9999-12-31'
    const bDate = b.kakao.published_at || '9999-12-31'
    return aDate.localeCompare(bDate)
  })

  const best = scored[0]
  let decision
  if      (best.score >= args.threshold) decision = 'auto_apply'
  else if (best.score >= 0.6)            decision = 'manual_review'
  else                                   decision = 'no_match'

  // 적용 (--apply 플래그 + auto_apply 결정인 경우만)
  let applyResult = null
  if (args.apply && decision === 'auto_apply') {
    try {
      applyResult = await callEdgeFunction({
        action:  'apply',
        book_id: book.id,
        kakao:   best.kakao,
      })
    } catch (e) {
      decision    = 'apply_failed'
      applyResult = { error: String(e.message || e) }
    }
  }

  return {
    book,
    decision,
    best,
    alternatives: scored.slice(0, 5),
    applyResult,
  }
}


// ════════════════════════════════════════════════════════════════════════════
// 6. 리포트 작성
// ════════════════════════════════════════════════════════════════════════════

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function writeReports(results, summary) {
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = path.join('scripts', 'reports')
  await fs.mkdir(dir, { recursive: true })

  const jsonPath = path.join(dir, `backfill-${ts}.json`)
  const csvPath  = path.join(dir, `backfill-${ts}.csv`)

  // JSON: 전체 raw 데이터
  await fs.writeFile(
    jsonPath,
    JSON.stringify({ ran_at: new Date().toISOString(), args, summary, results }, null, 2),
    'utf-8'
  )

  // CSV: 수동 검토용 (Excel 열기 좋게)
  const header = [
    'book_id', 'original_title', 'decision', 'best_score',
    'best_kakao_title', 'best_kakao_author', 'best_kakao_publisher',
    'best_kakao_isbn', 'best_kakao_published_at', 'best_kakao_thumbnail', 'best_kakao_url',
    'alt2_score', 'alt2_title', 'alt2_isbn',
    'alt3_score', 'alt3_title', 'alt3_isbn',
    'apply_error',
  ]
  const rows = [header]

  for (const r of results) {
    const b   = r.best
    const a2  = r.alternatives[1]
    const a3  = r.alternatives[2]
    rows.push([
      r.book.id,
      r.book.title,
      r.decision,
      b ? b.score.toFixed(3) : '',
      b?.kakao.title ?? '',
      b?.kakao.author ?? '',
      b?.kakao.publisher ?? '',
      b?.kakao.isbn ?? '',
      b?.kakao.published_at ?? '',
      b?.kakao.thumbnail ?? '',
      b?.kakao.kakao_url ?? '',
      a2 ? a2.score.toFixed(3) : '',
      a2?.kakao.title ?? '',
      a2?.kakao.isbn ?? '',
      a3 ? a3.score.toFixed(3) : '',
      a3?.kakao.title ?? '',
      a3?.kakao.isbn ?? '',
      r.applyResult?.error ?? '',
    ])
  }

  // Excel에서 한글 깨짐 방지용 UTF-8 BOM 추가
  const BOM = '\uFEFF'
  const csv = BOM + rows.map(row => row.map(csvEscape).join(',')).join('\n')
  await fs.writeFile(csvPath, csv, 'utf-8')

  return { jsonPath, csvPath }
}


// ════════════════════════════════════════════════════════════════════════════
// 7. 메인 실행
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const sep = '━'.repeat(64)
  console.log(sep)
  console.log('C&R Space — 도서 메타데이터 일괄 백필')
  console.log(sep)
  console.log(`모드:       ${args.apply ? '✅ APPLY (실제 적용)' : '🔍 DRY RUN (리포트만)'}`)
  console.log(`임계값:     ${args.threshold} (이 이상이면 auto_apply)`)
  console.log(`요청 간격:  ${args.delayMs}ms`)
  if (args.bookId) console.log(`단일 도서:  book_id=${args.bookId}`)
  console.log(sep)

  const books = await loadBooks()
  console.log(`처리 대상: ${books.length}건`)
  if (books.length === 0) {
    console.log('처리할 도서가 없습니다. (모든 도서에 이미 cover_url이 있거나 --book-id 미발견)')
    process.exit(0)
  }
  console.log('')

  const results = []
  const summary = {
    total:         books.length,
    auto_apply:    0,
    manual_review: 0,
    no_match:      0,
    apply_failed:  0,
    error:         0,
  }

  for (let i = 0; i < books.length; i++) {
    const b = books[i]
    const prefix = `[${String(i+1).padStart(3, ' ')}/${books.length}] #${String(b.id).padStart(3, ' ')}`
    process.stdout.write(`${prefix} "${b.title.slice(0, 36).padEnd(36)}" `)

    try {
      const r = await processBook(b)
      results.push(r)
      summary[r.decision] = (summary[r.decision] || 0) + 1

      const icon = {
        auto_apply:    '✅',
        manual_review: '⚠️ ',
        no_match:      '❌',
        apply_failed:  '💥',
      }[r.decision] ?? '? '
      const score   = r.best ? r.best.score.toFixed(2) : '—'
      const matched = (r.best?.kakao.title ?? '—').slice(0, 30)
      console.log(`${icon} ${r.decision.padEnd(14)} score=${score} → ${matched}`)
    } catch (e) {
      console.log(`💥 ERROR: ${e.message}`)
      results.push({ book: b, decision: 'error', error: String(e.message || e) })
      summary.error++
    }

    // Rate limit (마지막 1건 제외)
    if (i < books.length - 1 && args.delayMs > 0) {
      await new Promise(r => setTimeout(r, args.delayMs))
    }
  }

  console.log('')
  console.log(sep)
  console.log('결과 요약:')
  console.log(`  ✅ auto_apply    : ${String(summary.auto_apply).padStart(4)}건  (점수 ≥ ${args.threshold})`)
  console.log(`  ⚠️  manual_review : ${String(summary.manual_review).padStart(4)}건  (0.6 ≤ 점수 < ${args.threshold})`)
  console.log(`  ❌ no_match      : ${String(summary.no_match).padStart(4)}건  (점수 < 0.6 또는 검색 결과 없음)`)
  if (summary.apply_failed) console.log(`  💥 apply_failed  : ${String(summary.apply_failed).padStart(4)}건`)
  if (summary.error)        console.log(`  💥 error         : ${String(summary.error).padStart(4)}건`)
  console.log(sep)

  const { jsonPath, csvPath } = await writeReports(results, summary)
  console.log(`📄 JSON 리포트: ${jsonPath}`)
  console.log(`📊 CSV 리포트:  ${csvPath}`)
  console.log('')

  if (!args.apply) {
    console.log('💡 DRY RUN 완료. 실제 적용하려면 --apply 플래그를 추가하여 재실행하세요.')
    console.log('   CSV를 먼저 열어보고 auto_apply 후보들이 합리적인지 확인 권장.')
  } else {
    console.log('✅ 적용 완료.')
    console.log('   Supabase Dashboard > Storage > book-covers 에서 업로드된 이미지를 확인할 수 있습니다.')
    console.log('   manual_review 건들은 Phase D (Admin UI) 또는 --book-id 옵션으로 개별 처리하세요.')
  }
}

main().catch(e => {
  console.error('💥 치명적 오류:', e)
  process.exit(1)
})
