// @ts-nocheck
/**
 * _shared/departure.ts — 퇴사 실행 공용 모듈 (Phase 2)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 퇴사 파이프라인 일원화
 *      · DB 측 처리는 전부 process_departure RPC(20260735, 단일 트랜잭션)가 담당
 *      · 이 모듈은 "RPC 호출 + auth.users 삭제(admin API — SQL 불가)"만 수행
 *      · 호출 3경로 공용: sync-all-users(자동) / depart-user(수동 UI) /
 *        process-scheduled-departures(예정일 익일 cron)
 *      · 알림 미발송 확정 정책 — send-notification 을 호출하지 않는다
 *
 * 📌 auth 삭제가 RPC 뒤인 이유: RPC 실패 시 auth 계정을 보존해 재시도 가능하게.
 *    반대 순서면 "로그인만 죽고 데이터는 산" 반쪽 퇴사가 생긴다.
 * 📌 한 번도 로그인 안 한 퇴사자는 auth.users 에 없음 → authDeleted=false 정상.
 */

export interface DepartureResult {
  userId:             string
  rpc:                Record<string, unknown>   // process_departure 반환 jsonb
  cancelledBookings:  number
  authDeleted:        boolean
  error?:             string
}

// ── auth.users 이메일 → id 맵 (GoTrue admin API 페이지네이션) ───────────────
//    임직원 ~300명 규모 — 1페이지(1000)로 충분하나 안전하게 루프 유지
export async function fetchAuthEmailMap(
  supabaseUrl: string,
  serviceKey:  string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let page = 0
  const perPage = 1000
  while (true) {
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
    )
    if (!res.ok) throw new Error(`auth.users 조회 실패 (${res.status}): ${await res.text()}`)
    const data  = await res.json()
    const users = data.users ?? []
    for (const u of users) {
      if (u.email) map.set(u.email.toLowerCase(), u.id)
    }
    if (users.length < perPage) break
    page++
  }
  return map
}

/**
 * executeDeparture — 퇴사 1인 실행
 *
 * @param userId   profiles.id (미로그인 신규동기화 계정은 Azure object id 일 수 있음)
 * @param email    이메일 — auth.users 매칭 키 (UUID 불일치 케이스 대응, 기존 sync 관례)
 * @param actor    수동 퇴사 시 처리 관리자 uuid. 자동/cron 은 null
 * @param authMap  선조회한 auth 이메일 맵 (일괄 처리 시 재조회 방지). 없으면 내부 조회
 */
export async function executeDeparture(
  supabaseUrl: string,
  serviceKey:  string,
  userId:      string,
  email:       string,
  actor:       string | null,
  authMap?:    Map<string, string>,
): Promise<DepartureResult> {
  // ① DB 측 전체 처리 — process_departure RPC (원자적)
  //    예약 취소는 status='cancelled' + cancelled_by='departed' 로 기록됨
  //    (구 방식 cancelled_by='system' 의 노쇼 오염 종결 — 20260735 참조)
  const rpcRes = await fetch(
    `${supabaseUrl}/rest/v1/rpc/process_departure`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         serviceKey,
        'Authorization': `Bearer ${serviceKey}`,   // DB REST = SERVICE_KEY (프로젝트 규칙)
      },
      body: JSON.stringify({ p_user_id: userId, p_actor: actor }),
    }
  )
  if (!rpcRes.ok) {
    const msg = await rpcRes.text()
    return { userId, rpc: {}, cancelledBookings: 0, authDeleted: false,
             error: `process_departure 실패 (${rpcRes.status}): ${msg}` }
  }
  const rpc = await rpcRes.json()

  // ② auth.users 삭제 — 이메일 재사용 보장 (동일 이메일 재입사 = 완전 새 계정)
  let authDeleted = false
  const map    = authMap ?? await fetchAuthEmailMap(supabaseUrl, serviceKey)
  const authId = map.get((email ?? '').toLowerCase())
  if (authId) {
    const delRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${authId}`,
      {
        method:  'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      }
    )
    authDeleted = delRes.ok
    if (!delRes.ok) console.error(`[departure] auth.users DELETE 실패 (${email}):`, await delRes.text())
  }
  // authId 없음 = 한 번도 로그인 안 한 계정 → 정상 skip

  return {
    userId,
    rpc,
    cancelledBookings: Number(rpc?.cancelled_bookings ?? 0),
    authDeleted,
  }
}
