// @ts-nocheck
/**
 * _shared/email-sender.ts
 * C&R Space 알림 시스템 — Resend API 발송 헬퍼
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 원칙
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Batch API 우선
 *    · /emails/batch 엔드포인트 (최대 100건/요청)
 *    · 동일 이벤트에서 여러 수신자에게 발송 시 1번의 API 호출로 끝냄
 *    · Resend rate limit(기본 2 req/s) 근본 회피 — 인스턴스 동시 실행에도 안전
 *
 * 2. 각 이메일 개인화 유지
 *    · Batch라도 email마다 다른 subject/html/to 지정 가능
 *    · 예약자용 / 참석자용 / 관리자용 구분 그대로 유지
 *
 * 3. 부분 실패 독립성
 *    · 한 건 실패가 다른 건에 영향 없음
 *    · Batch 전체 실패 시 상세 로그로 원인 추적
 *    · 재시도 로직은 rate_limit_exceeded에 한정 (구조적 오류는 재시도 무의미)
 *
 * 4. 일관된 인터페이스
 *    · 단건 발송도 내부적으로 batch API 사용 (코드 경로 통일)
 *    · sendEmails(list) 단일 진입점 — list.length === 1이면 단건
 *
 * 5. [P2 v5] FROM 헤더 브랜드 고정 + RFC 5322 준수
 *    · 발신자는 `"C&R SPACE" <space@cnrres.com>` 로 하드코딩
 *    · display name은 RFC 5322에 따라 큰따옴표로 감싸서 특수문자('&') 안전 처리
 *    · 환경변수 FROM_EMAIL 있어도 무시 (정책 상수이므로 변경 불가)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-18 P2 v1] 초기 생성
 *   · Resend Batch API 기반 단일 진입점
 *   · 기존 sendEmail(send-notification 내부) 분산 → 통일
 *   · rate_limit_exceeded (429) 감지 시 재시도 로직
 *   · 각 수신자별 발송 결과(id/error) 상세 반환
 *
 * [2026-04-19 P2 v5] FROM 헤더 display name 오표시 버그 수정
 *   · 증상: Outlook에서 발신자가 "Note to self"로 표시되어
 *          C&R SPACE 브랜드가 보이지 않음
 *   · 원인: FROM_EMAIL="C&R SPACE <...>" 의 display name에
 *          특수문자 '&' + 공백이 있음에도 큰따옴표로 감싸지 않아
 *          RFC 5322 위반 → Outlook이 display name 파싱 실패
 *   · 해결: FROM 헤더를 `"C&R SPACE" <space@cnrres.com>` 로 하드코딩.
 *          display name 큰따옴표 포함하여 RFC 5322 준수.
 *   · 배경: 2026-04-18 리팩토링에서 제목의 [C&R SPACE] 접두어 제거
 *          (발신자 FROM으로 식별 가능하다는 전제). 그 전제가 깨진 것을
 *          제목에서 브랜드를 빼면서 드러난 사건.
 *   · 정책: 브랜드 식별자는 운영 상수 — 환경변수로 변경 불가능하게 고정
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. 환경변수 & 상수
// ═══════════════════════════════════════════════════════════════════════════

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

// ← [P2 v5] FROM 헤더 하드코딩 (정책 상수)
//   · display name "C&R SPACE" 를 큰따옴표로 감싼 형태 → RFC 5322 준수
//   · & 특수문자가 phrase에 포함될 때는 quoted-string 필수 (없으면 Outlook "Note to self" 오표시)
//   · 환경변수 FROM_EMAIL 이 설정돼 있어도 무시 (아래 경고 로그)
const FROM_HEADER = '"C&R SPACE" <space@cnrres.com>'

// 디버깅: 환경변수가 다른 값으로 설정돼 있으면 운영자에게 경고 (하드코딩이 우선)
const _envFrom = Deno.env.get('FROM_EMAIL')
if (_envFrom && _envFrom !== FROM_HEADER) {
  console.warn(
    `[email-sender] FROM_EMAIL 환경변수(${_envFrom})가 감지되었으나 무시됨. ` +
    `실제 발신자는 하드코딩된 ${FROM_HEADER} 사용.`
  )
}

// 모듈 로드 시 실제 사용되는 FROM 헤더 로깅 (추후 이슈 재발 시 진단용)
console.log(`[email-sender] FROM 헤더: ${FROM_HEADER}`)

// ═══════════════════════════════════════════════════════════════════════════
// 2. 타입 정의
// ═══════════════════════════════════════════════════════════════════════════

/** 개별 이메일 발송 항목 */
export interface EmailItem {
  to:      string                    // 수신자 이메일 (1명만, 개인화 보장)
  subject: string                    // 제목
  html:    string                    // 본문 HTML
}

/** 발송 결과 (항목별) */
export interface EmailSendResult {
  to:       string                   // 요청한 수신자
  success:  boolean                  // 성공 여부
  messageId?: string                 // Resend 반환 ID (성공 시)
  error?:   string                   // 실패 이유 (실패 시)
}

/** 전체 발송 응답 */
export interface EmailSendResponse {
  total:     number                  // 요청된 총 건수
  succeeded: number                  // 성공 건수
  failed:    number                  // 실패 건수
  results:   EmailSendResult[]       // 각 건별 상세
  rateLimited: boolean               // rate limit 발생 여부 (재시도 이후에도 실패 시 true)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 내부 유틸
// ═══════════════════════════════════════════════════════════════════════════

/** 에러 객체를 안전하게 문자열로 변환 */
function errorToString(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return String(e) }
}

/** rate_limit_exceeded 에러 감지 */
function isRateLimitError(errMsg: string): boolean {
  return errMsg.includes('rate_limit_exceeded') || errMsg.includes('Too many requests')
}

/** sleep 헬퍼 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Resend Batch API 호출 (내부)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resend /emails/batch 엔드포인트 호출 (최대 100건)
 *
 * @param items  발송할 이메일 목록
 * @returns      Resend API raw 응답 (성공 시 { data: [{id}, ...] })
 * @throws       네트워크 오류 또는 비-OK 응답 시 Error (message에 상태/본문 포함)
 */
async function callResendBatch(items: EmailItem[]): Promise<{ data: { id: string }[] }> {
  const payload = items.map(item => ({
    from:    FROM_HEADER,                      // ← [P2 v5] 하드코딩된 "C&R SPACE" <space@cnrres.com>
    to:      [item.to],                        // Resend는 to가 배열이어야 함
    subject: encodeSubjectUtf8(item.subject),  // ← [P2 v2] Outlook 한글 제목 깨짐 방지
    html:    item.html,
  }))

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    // 상태 코드와 본문을 그대로 에러에 담아 상위 호출자가 isRateLimitError()로 판단 가능
    throw new Error(`Resend batch 실패 [${res.status}]: ${body}`)
  }

  return await res.json()
}

/**
 * Subject를 RFC 2047 MIME encoded-word(UTF-8, Base64)로 인코딩
 *
 * 배경: Outlook이 한글이 섞인 Subject 헤더를 Latin-1로 잘못 해석해
 *      "[승인요청]..." 가 "[??인요청]..." 형태로 깨져 보이는 문제.
 *      Resend API는 Subject를 raw 문자열 그대로 SMTP 헤더에 넣는데,
 *      비-ASCII가 포함된 헤더는 RFC 2047에 따라 인코딩되어야 한다.
 *
 * 동작:
 *   · 모든 문자가 ASCII면 인코딩 생략 (원본 반환 → 성능/가독성)
 *   · 비-ASCII가 있으면 전체를 UTF-8 → Base64 → =?UTF-8?B?xxx?= 형식으로 감쌈
 *   · Resend/Outlook/Gmail/Apple Mail 모두 해당 형식 해석 지원
 *
 * ← [2026-04-18 P2 v4] Outlook 제목 "??인요청" 인코딩 깨짐 수정
 */
function encodeSubjectUtf8(subject: string): string {
  // ASCII만 있으면 그대로 (인코딩 오버헤드 회피)
  if (/^[\x00-\x7F]*$/.test(subject)) return subject

  // UTF-8 바이트 → Base64 변환 (Deno 내장 btoa는 binary string 요구)
  const bytes = new TextEncoder().encode(subject)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const b64 = btoa(binary)

  return `=?UTF-8?B?${b64}?=`
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 공개 API — sendEmails
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이메일 여러 건 발송 (Batch API 사용)
 *
 * 동작:
 *  1. 100건씩 청크 분할 (Resend 제한)
 *  2. 각 청크를 Batch API로 발송
 *  3. rate_limit_exceeded 감지 시 1.5초 대기 후 1회 재시도
 *  4. 재시도 후에도 실패하면 해당 청크의 모든 항목을 failed로 마킹
 *  5. 청크 간 200ms 간격 (동시 실행 인스턴스 대비 추가 안전선)
 *
 * @param items  발송 목록 (to/subject/html)
 * @returns      전체 발송 결과 (성공/실패 카운트 + 각 건별 상세)
 */
export async function sendEmails(items: EmailItem[]): Promise<EmailSendResponse> {
  const results: EmailSendResult[] = []
  let rateLimited = false

  if (!RESEND_API_KEY) {
    console.warn('[email-sender] RESEND_API_KEY 없음 — 전체 스킵')
    return {
      total:       items.length,
      succeeded:   0,
      failed:      items.length,
      rateLimited: false,
      results:     items.map(i => ({ to: i.to, success: false, error: 'RESEND_API_KEY 미설정' })),
    }
  }

  if (items.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, rateLimited: false, results: [] }
  }

  // 100건씩 청크 분할
  const CHUNK_SIZE = 100
  const chunks: EmailItem[][] = []
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE))
  }

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]

    try {
      // 1차 시도
      const res = await callResendBatch(chunk)
      // Resend batch 응답은 각 항목의 id를 순서대로 반환
      const ids = res.data ?? []
      chunk.forEach((item, i) => {
        results.push({
          to: item.to,
          success: true,
          messageId: ids[i]?.id,
        })
      })
      console.log(`[email-sender] batch ${c + 1}/${chunks.length} 성공 — ${chunk.length}건`)
    } catch (e) {
      const errMsg = errorToString(e)

      // rate limit이면 1회 재시도
      if (isRateLimitError(errMsg)) {
        console.warn(`[email-sender] batch ${c + 1} rate limit 감지 — 1.5초 후 재시도`)
        await sleep(1500)
        try {
          const retryRes = await callResendBatch(chunk)
          const ids = retryRes.data ?? []
          chunk.forEach((item, i) => {
            results.push({
              to: item.to,
              success: true,
              messageId: ids[i]?.id,
            })
          })
          console.log(`[email-sender] batch ${c + 1} 재시도 성공 — ${chunk.length}건`)
        } catch (retryErr) {
          const retryMsg = errorToString(retryErr)
          console.error(`[email-sender] batch ${c + 1} 재시도 실패:`, retryMsg)
          rateLimited = isRateLimitError(retryMsg)
          chunk.forEach(item => {
            results.push({ to: item.to, success: false, error: retryMsg })
          })
        }
      } else {
        // rate limit이 아닌 구조적 오류 — 재시도 의미 없음
        console.error(`[email-sender] batch ${c + 1} 실패:`, errMsg)
        chunk.forEach(item => {
          results.push({ to: item.to, success: false, error: errMsg })
        })
      }
    }

    // 청크 간 간격 (동시 실행 인스턴스 대비, 마지막 청크 제외)
    if (c < chunks.length - 1) {
      await sleep(200)
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed    = results.length - succeeded

  console.log(`[email-sender] 전체 완료 — ${succeeded}/${results.length} 성공${failed > 0 ? ` (${failed} 실패)` : ''}`)

  return {
    total: items.length,
    succeeded,
    failed,
    rateLimited,
    results,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 편의 래퍼 — sendEmail (단건)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이메일 1건 발송 — 내부적으로 sendEmails([item]) 호출
 *
 * @returns 해당 1건의 발송 결과 (EmailSendResult)
 */
export async function sendEmail(item: EmailItem): Promise<EmailSendResult> {
  const response = await sendEmails([item])
  return response.results[0] ?? { to: item.to, success: false, error: '응답 없음' }
}
