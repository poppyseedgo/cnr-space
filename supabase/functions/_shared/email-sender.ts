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
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-18 P2 v1] 초기 생성
 *   · Resend Batch API 기반 단일 진입점
 *   · 기존 sendEmail(send-notification 내부) 분산 → 통일
 *   · rate_limit_exceeded (429) 감지 시 재시도 로직
 *   · 각 수신자별 발송 결과(id/error) 상세 반환
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. 환경변수
// ═══════════════════════════════════════════════════════════════════════════

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'C&R SPACE <onboarding@resend.dev>'

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
    from:    FROM_EMAIL,
    to:      [item.to],       // Resend는 to가 배열이어야 함
    subject: item.subject,
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
