// @ts-nocheck
/**
 * sync-all-users Edge Function v10
 * Microsoft Graph API User.Read.All (Application 권한)
 *
 * ✅ 변경 이력
 *  - v10 [2026-10-01] Azure 프로필 전체 필드 저장 (20261011 짝 배포 — profiles.azure_extra jsonb · azure_synced_at · azure_user_id)
 *      · Graph $select 확장: givenName,surname,jobTitle,officeLocation,mobilePhone,businessPhones,employeeId,employeeType,employeeHireDate,
 *        companyName,city,country,usageLocation,preferredLanguage,createdDateTime + $expand=manager(id,displayName,mail)
 *      · $expand 가 거부되면(400) $expand 없이 재시도 — sync 자체는 절대 멈추지 않는다
 *      · 신규 INSERT·기존 PATCH 모두 azure_extra(원본 그대로) · azure_synced_at · azure_user_id 기록. name/email/employee_id/dept 규칙은 불변
 *      · 조직도 카드 드로어 'Azure 프로필' 섹션이 이 jsonb 를 그대로 표시
 *  - v9 [2026-10-01] 조직도 입사예정자 연결 후크 (20261006_org_phase2 짝 배포)
 *      · 신규 profiles INSERT 직후, 삽입된 이메일마다 RPC org_link_planned_person(p_email) 1회 호출
 *        → 조직도 입사예정자(org_persons)와 이메일이 일치하면 전 파일 카드 profile_id 백필 + 입사예정 상태 종료
 *      · 실패해도 sync 는 계속한다(조직도는 보조 시스템 — console.error 만). 반환값에 orgLinked 수 추가
 *  - v8 [2026-07-30] 퇴사 파이프라인 일원화 + 휴직 상태 연동 (20260735 짝 배포)
 *      · 변경 1: processDeparted/cancelFutureBookings 제거 →
 *               _shared/departure.ts executeDeparture (process_departure RPC 경유)
 *               - 퇴사 취소가 status='cancelled' + cancelled_by='departed' 로 기록됨
 *                 (구 방식 cancelled_by='system' 이 노쇼 확정룰과 충돌해
 *                  퇴사 취소 전건이 노쇼로 집계되던 근본 원인 종결)
 *               - departed_users upsert / 도서·자원 강제반납 / 권한 회수 / profiles
 *                 DELETE 가 RPC 단일 트랜잭션 — 반쪽 퇴사(테이블 불일치) 원천 차단
 *      · 변경 2: 휴직자(employment_status='leave') 퇴사 감지 제외 가드 ⚠️필수
 *               - v7.1(2026-07-27)의 accountEnabled 필터 때문에 휴직자 AD 계정을
 *                 잠그면(일반적 IT 운영) 다음 sync 에서 자동 퇴사되는 파괴 경로 차단
 *      · 변경 3: 재부활 가드 — 최근 14일 내 퇴사자 이메일은 신규 INSERT 제외
 *               - 예정일 퇴사 후 IT 의 AD 비활성화가 늦으면 sync 가 프로필을
 *                 되살리던 경합 차단 (14일 내 동일 이메일 재입사는 비현실적)
 *      · 변경 4: fetchAuthUserEmailMap → _shared/departure.ts fetchAuthEmailMap 공용화
 *  - v7 [2026-05-14] dept(부서) 자동 동기화 추가
 *      · 배경: User.Read.All 권한 IT팀 승인 완료 (기존 User.ReadBasic.All은
 *              department 필드 미포함이라 조직개편 시 부서 변경 미반영 컴플레인 발생)
 *      · 변경 1: Graph $select에 `department` 추가 (line 77)
 *      · 변경 2: 신규 INSERT 시 Azure department 값으로 저장 (기존 빈문자 하드코딩 → 라이브 값)
 *      · 변경 3: 기존 PATCH 시 dept 갱신 — 단 Azure에 값 있을 때만 (관리자 수동입력 보호)
 *      · 짝 배포: src/hooks/useAuth.tsx의 `!user.dept` 가드 제거
 *               (사용자가 부서 변경 후 즉시 로그인 시 sync 주기 안 기다리고 반영)
 *
 * 퇴사자 처리 정책 (v8 — process_departure RPC 가 단일 트랜잭션으로 수행):
 *   - departed_users 이력 upsert (avatar_url 스냅샷 포함 — 취소선 UI 용)
 *   - 미래 회의실/자원 예약 취소: status='cancelled' + cancelled_by='departed'
 *   - 도서·자원 강제 반납 (이력 행 보존) / admin_roles 회수 + 감사 기록
 *   - profiles DELETE (이메일 재사용 가능하도록) / auth.users DELETE 는 본 함수가 수행
 *   - 휴직자(employment_status='leave')는 AD 비활성이어도 퇴사 감지 제외
 *   - 알림 미발송 (확정 정책)
 *
 * 신규 직원 INSERT id 결정 기준:
 *   - auth.users에 존재(로그인 이력 있음) → auth.users.id 사용
 *   - auth.users에 없음(미로그인)         → Azure AD object id 사용
 *
 * 기존 직원 PATCH:
 *   - name, employee_id 갱신 (필수 — 항상)
 *   - dept 갱신 — Azure에 department 값 있을 때만 (빈값 덮어쓰기 방지)
 *   - id, role, avatar_url 절대 건드리지 않음
 *
 * 프로필 사진 동기화:
 *   - avatar_url 없는 계정만 처리 (이미 있으면 skip)
 *   - 1회 실행 시 최대 50명 처리 (timeout 방지)
 *   - 10개씩 병렬 처리
 *   - 사진 없는 계정(404)은 정상 케이스로 skip
 *   - 실패해도 전체 sync 영향 없음
 *
 * 안전장치:
 *   - 퇴사자가 전체 profiles의 30% 초과 시 싱크 중단
 */

import { executeDeparture, fetchAuthEmailMap } from '../_shared/departure.ts' // ← [v8] 퇴사 공용 모듈

const TENANT_ID     = Deno.env.get('AZURE_TENANT_ID')           ?? ''
const CLIENT_ID     = Deno.env.get('AZURE_CLIENT_ID')           ?? ''
const CLIENT_SECRET = Deno.env.get('AZURE_CLIENT_SECRET')       ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sbHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

// ── Graph 토큰 발급 ──────────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getGraphToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < cachedToken.expiresAt - 60_000) return cachedToken.token
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )
  if (!res.ok) throw new Error(`Graph 토큰 발급 실패: ${await res.text()}`)
  const data  = await res.json()
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return cachedToken.token
}

// ── Azure AD 전체 사용자 페이지네이션 조회 ───────────────────────────────────
async function fetchAllAzureUsers(token: string): Promise<any[]> {
  const all: any[] = []
  // ← [2026-07-27 재직자 카운트 BUGFIX] 재직자만 조회 — 근본 원인 수정.
  //   기존엔 무필터 전량 조회라 ①비활성 계정(accountEnabled=false — 퇴사 후 계정만 잠그는 일반적 운영)과
  //   ②게스트(userType='Guest')가 전부 포함됐다. 비활성 계정은 UPN이 계속 응답에 남아
  //   퇴사 감지(azUPNSet 부재 조건)에 영원히 걸리지 않고 profiles에 잔류 —
  //   '재직자' 카운트가 Azure 디렉토리 전체 수로 부풀려지던 원인.
  //   이 필터로 비활성 계정이 응답에서 빠지면 기존 퇴사 감지 로직이 자동으로
  //   이들을 퇴사 처리한다(departed_users 이력 + profiles DELETE + 미래 예약 취소) — 별도 백필 불필요.
  //   ※ $filter의 userType 조건은 advanced query 요건($count=true + ConsistencyLevel: eventual) 필요 — 둘 다 이미 충족.
  // ← [v10] 조직도 카드용 전체 필드. manager 는 $expand (거부되면 없이 재시도)
  const SELECT = 'id,displayName,givenName,surname,mail,userPrincipalName,department,accountEnabled,userType,' +
                 'jobTitle,officeLocation,mobilePhone,businessPhones,employeeId,employeeType,employeeHireDate,companyName,city,country,usageLocation,preferredLanguage,createdDateTime'
  const build = (expand: boolean) =>
    'https://graph.microsoft.com/v1.0/users' +
    `?$select=${SELECT}` +
    (expand ? '&$expand=manager($select=id,displayName,mail)' : '') +
    "&$filter=accountEnabled eq true and userType eq 'Member'" + // ← [2026-07-27] 재직 + 내부 구성원만
    '&$top=999' +
    '&$count=true'
  let url: string | null = build(true)
  let expand = true

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
    })
    if (!res.ok) {
      if (expand && all.length === 0 && res.status === 400) {   // ← [v10] $expand 미지원/거부 → manager 없이
        console.warn('[sync] Graph $expand=manager 거부 → manager 없이 재시도:', (await res.text()).slice(0, 200))
        expand = false; url = build(false); continue
      }
      throw new Error(`Graph API 오류 (${res.status}): ${await res.text()}`)
    }
    const data = await res.json()
    all.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return all
}

// ← [v10] profiles.azure_extra — Graph 응답을 정규화 없이 보존 (조직도 드로어가 라벨만 입힌다). @odata 키 제거
function azureExtra(u: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(u ?? {})) {
    if (k.startsWith('@odata')) continue
    if (k === 'manager' && v && typeof v === 'object') { const m: any = v; out.manager = { id: m.id ?? null, displayName: m.displayName ?? null, mail: m.mail ?? null }; continue }
    out[k] = v ?? null
  }
  return out
}

// ── profiles 전체 조회 ───────────────────────────────────────────────────────
async function fetchAllProfiles(): Promise<{
  id: string; name: string; email: string; dept: string
  employee_id: string; role: string; avatar_url: string | null
  employment_status: string // ← [v8] 휴직 가드 판정용 (20260735 신설 컬럼)
}[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,name,email,dept,employee_id,role,avatar_url,employment_status`, // ← [v8] employment_status 추가
    { headers: sbHeaders }
  )
  if (!res.ok) throw new Error(`profiles 조회 실패 (${res.status}): ${await res.text()}`)
  return await res.json()
}

// ── auth.users 이메일 → id 맵 조회 ──────────────────────────────────────────
// ← [v8] 로컬 구현 제거 → _shared/departure.ts fetchAuthEmailMap 공용화 (동일 로직)
//   퇴사 처리(processDeparted + cancelFutureBookings)도 제거 —
//   process_departure RPC(20260735) 단일 트랜잭션 + executeDeparture 로 대체.
//   구현은 _shared/departure.ts 참조.

// ── 최근 퇴사자 이메일 조회 — 재부활 가드 ──────────────────────────────────
// ← [v8] 예정일 퇴사 직후 IT 의 AD 비활성화가 늦으면, Azure 응답에 계정이 남아
//   syncProfiles 가 profiles 를 재생성(부활)하는 경합이 있다. 최근 N일 내
//   퇴사자 이메일은 신규 INSERT 에서 제외한다. N일 경과 후 동일 이메일은
//   재입사자로 간주해 정상 INSERT (이메일 재사용 정책 유지).
const RESURRECT_GUARD_DAYS = 14

async function fetchRecentDepartedEmails(): Promise<Set<string>> {
  const since = new Date(Date.now() - RESURRECT_GUARD_DAYS * 86400_000).toISOString()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/departed_users?departed_at=gte.${since}&select=email`,
    { headers: sbHeaders }
  )
  if (!res.ok) {
    console.error('[sync] departed_users 조회 실패 (가드 없이 진행):', await res.text())
    return new Set()
  }
  const rows: { email: string }[] = await res.json()
  return new Set(rows.map(r => (r.email ?? '').toLowerCase()).filter(Boolean))
}

// ── profiles 신규/기존 분리 처리 ─────────────────────────────────────────────
// name, employee_id, dept 갱신 — id, role, avatar_url 절대 건드리지 않음
// dept는 Azure department 값이 비어있지 않을 때만 PATCH (수동 입력값 보호)
async function syncProfiles(
  azUsers: any[],
  existingEmails: Set<string>,
  authEmailMap: Map<string, string>,
  recentDeparted: Set<string>, // ← [v8] 최근 14일 퇴사자 — 재부활 가드
): Promise<{ inserted: number; updated: number; skipped: number; orgLinked: number }> { // ← [v9] orgLinked

  const rows = azUsers
    .map(u => ({
      azureId:     u.id,
      name:        u.displayName ?? '',
      email:       (u.mail ?? u.userPrincipalName ?? '').toLowerCase(),
      employee_id: u.userPrincipalName ?? '',
      dept:        u.department ?? '', // ← [v7 2026-05-14] Azure AD department 추출
      extra:       azureExtra(u),      // ← [v10] 전체 필드
    }))
    .filter(r => r.name && r.email)

  if (rows.length === 0) return { inserted: 0, updated: 0, skipped: azUsers.length }

  // 신규 INSERT
  const toInsert = rows
    .filter(r => !existingEmails.has(r.email))
    .filter(r => !recentDeparted.has(r.email)) // ← [v8] 최근 퇴사자 부활 차단 (AD 비활성화 지연 경합)
    .map(r => ({
      id:          authEmailMap.get(r.email) ?? r.azureId,
      name:        r.name,
      email:       r.email,
      employee_id: r.employee_id,
      role:        'USER',
      dept:        r.dept, // ← [v7 2026-05-14] Azure department 그대로 (빈문자열 가능)
      azure_user_id:   r.azureId,          // ← [v10]
      azure_extra:     r.extra,            // ← [v10]
      azure_synced_at: new Date().toISOString(),
    }))

  if (toInsert.length > 0) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles`,
      {
        method:  'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(toInsert),
      }
    )
    if (!res.ok) throw new Error(`profiles INSERT 실패 (${res.status}): ${await res.text()}`)
  }

  // ← [v9 2026-10-01] 조직도 입사예정자 연결 — 삽입된 이메일마다 RPC 1회 (실패해도 sync 중단 없음)
  let orgLinked = 0
  for (const r of toInsert) {
    try {
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/org_link_planned_person`, {
        method:  'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=representation' },
        body:    JSON.stringify({ p_email: r.email }),
      })
      if (!rpc.ok) { console.error(`[sync][org] 연결 RPC 실패 (${r.email}):`, await rpc.text()); continue }
      const out = await rpc.json()
      if (out?.linked) { orgLinked++; console.log(`[sync][org] 입사예정자 연결 (${r.email})`, JSON.stringify(out)) }
    } catch (e) {
      console.error(`[sync][org] 연결 RPC 예외 (${r.email}):`, e)
    }
  }

  // 기존 PATCH — name, employee_id, dept(있을 때만)
  const toUpdate = rows.filter(r => existingEmails.has(r.email))
  for (const row of toUpdate) {
    // ← [v7 2026-05-14] dept 조건부 추가
    //   · Azure department가 빈문자가 아닐 때만 dept 갱신 → 수동 입력된 dept를 빈값으로 덮어쓰기 방지
    //   · 이름은 이미 `.filter(r => r.name && r.email)`로 빈값 제외돼 있어 항상 안전
    const patchBody: Record<string, any> = {
      name:        row.name,
      employee_id: row.employee_id,
      azure_user_id:   row.azureId,          // ← [v10]
      azure_extra:     row.extra,            // ← [v10] 전체 필드 — 매 sync 갱신
      azure_synced_at: new Date().toISOString(),
    }
    if (row.dept) patchBody.dept = row.dept // ← Azure SoT — 값 있을 때만 갱신

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(row.email)}`,
      {
        method:  'PATCH',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(patchBody),
      }
    )
    if (!res.ok) console.error(`[sync] PATCH 실패 (${row.email}):`, await res.text())
  }

  return { inserted: toInsert.length, updated: toUpdate.length, skipped: azUsers.length - rows.length, orgLinked } // ← [v9] orgLinked
}

// ── 프로필 사진 동기화 ───────────────────────────────────────────────────────
// avatar_url 없는 계정만 처리, 1회 최대 50명, 10개씩 병렬
async function syncAvatars(
  azUsers: any[],
  profiles: { id: string; email: string; avatar_url: string | null }[],
  token: string,
): Promise<{ synced: number; skipped: number; noPhoto: number; failed: number }> {

  // email → { profileId, azureId } 맵
  const emailMap = new Map<string, { profileId: string; azureId: string }>()
  for (const u of azUsers) {
    const email = (u.mail ?? u.userPrincipalName ?? '').toLowerCase()
    if (email) emailMap.set(email, { profileId: '', azureId: u.id })
  }
  for (const p of profiles) {
    const email = (p.email ?? '').toLowerCase()
    const entry = emailMap.get(email)
    if (entry) entry.profileId = p.id
  }

  // avatar_url 없는 계정만 추출, 최대 50명
  const targets = profiles
    .filter(p => p.avatar_url === null && p.email)
    .slice(0, 50)
    .map(p => ({ email: (p.email ?? '').toLowerCase(), profileId: p.id }))
    .filter(t => emailMap.get(t.email)?.azureId)

  if (targets.length === 0) return { synced: 0, skipped: profiles.length, noPhoto: 0, failed: 0 }

  let synced = 0, noPhoto = 0, failed = 0
  const CHUNK = 10

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK)
    await Promise.all(chunk.map(async ({ email, profileId }) => {
      const azureId = emailMap.get(email)!.azureId
      try {
        // 1. Graph API photo 조회
        const photoRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${azureId}/photo/$value`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (photoRes.status === 404) {
          noPhoto++
          // 사진 없음 확인 → '' 로 마킹해서 다음 sync에서 재시도 안 하게 함
          await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`,
            {
              method:  'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body:    JSON.stringify({ avatar_url: '' }),
            }
          ).catch(() => {})
          return
        } // 사진 없음 — 정상
        if (!photoRes.ok) { failed++; return }

        const contentType  = photoRes.headers.get('content-type') ?? 'image/jpeg'
        const arrayBuffer  = await photoRes.arrayBuffer()
        const fileName     = `${profileId}.jpg`

        // 2. Supabase Storage 업로드 (upsert)
        const uploadRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/avatars/${fileName}`,
          {
            method:  'POST',
            headers: {
              'apikey':         SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type':   contentType,
              'x-upsert':       'true',
            },
            body: arrayBuffer,
          }
        )
        if (!uploadRes.ok) {
          console.error(`[avatar] Storage 업로드 실패 (${email}):`, await uploadRes.text())
          failed++
          return
        }

        // 3. public URL 조회
        const urlRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/public/avatars/${fileName}`,
          { method: 'HEAD', headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        )
        const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${fileName}`

        // 4. profiles.avatar_url 업데이트
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`,
          {
            method:  'PATCH',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body:    JSON.stringify({ avatar_url: avatarUrl }),
          }
        )
        if (patchRes.ok) synced++
        else { console.error(`[avatar] profiles PATCH 실패 (${email}):`, await patchRes.text()); failed++ }

      } catch (e) {
        console.error(`[avatar] 처리 실패 (${email}):`, e)
        failed++
      }
    }))
  }

  return { synced, skipped: profiles.length - targets.length, noPhoto, failed }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. Azure AD 전체 조회
    const token    = await getGraphToken()
    const azUsers  = await fetchAllAzureUsers(token)
    const azUPNSet = new Set(azUsers.map(u => (u.userPrincipalName ?? '').toLowerCase()))

    // 2. profiles 전체 조회
    const profiles       = await fetchAllProfiles()
    const existingEmails = new Set(profiles.map(p => (p.email ?? '').toLowerCase()))

    // 3. auth.users 이메일 → id 맵 (← [v8] 공용 모듈 사용)
    const authEmailMap = await fetchAuthEmailMap(SUPABASE_URL, SERVICE_KEY)

    // 4. 퇴사자 감지 (employee_id 있는 계정만 — 수동 생성 계정 보호)
    // ← [v8 ⚠️필수 가드] 휴직자(employment_status='leave') 제외
    //   배경: v7.1 의 accountEnabled eq true 필터 때문에 휴직자 AD 계정을 잠그면
    //   UPN 이 Azure 응답에서 사라져 퇴사로 오탐 → 프로필 삭제·예약 취소·강제 반납이
    //   전부 실행되는 파괴 경로. 휴직 상태(20260735)가 이 오탐을 명시적으로 막는다.
    const departed = profiles.filter(
      p => p.employee_id
        && !azUPNSet.has(p.employee_id.toLowerCase())
        && p.employment_status !== 'leave' // ← [v8] 휴직자 퇴사 감지 제외
    )

    // 안전장치: 퇴사자 30% 초과 시 싱크 중단
    const employeeProfiles = profiles.filter(p => p.employee_id)
    if (employeeProfiles.length > 0) {
      const ratio = departed.length / employeeProfiles.length
      if (ratio > 0.3) {
        const msg = `[sync] 안전장치 발동: 퇴사자 비율 ${Math.round(ratio * 100)}% (${departed.length}/${employeeProfiles.length}) — 30% 초과로 싱크 중단`
        console.error(msg)
        return new Response(
          JSON.stringify({ success: false, error: msg, aborted: true }),
          { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 5. 퇴사자 처리 — ← [v8] process_departure RPC 경유 (단일 트랜잭션)
    //    · 예약 취소가 cancelled_by='departed' 로 기록 (노쇼 오염 종결)
    //    · 도서·자원 강제 반납 + 권한 회수 + 감사 기록까지 RPC 가 원자적 수행
    //    · 순차 실행 — RPC 가 books/bookings 락을 잡으므로 병렬 경합 회피
    //    · 개별 실패는 로그 후 계속 (다음 sync 재시도 — RPC 멱등)
    let cancelledCount = 0
    for (const p of departed) {
      const r = await executeDeparture(SUPABASE_URL, SERVICE_KEY, p.id, p.email ?? '', null, authEmailMap)
      if (r.error) console.error(`[sync] 퇴사 처리 실패 (${p.email}):`, r.error)
      else {
        cancelledCount += r.cancelledBookings
        console.log(`[sync] 퇴사 처리 완료 (${p.email})`, JSON.stringify(r.rpc))
      }
    }
    departed.forEach(p => existingEmails.delete((p.email ?? '').toLowerCase()))

    // 6. 신규/기존 직원 처리 (← [v8] 재부활 가드 전달)
    const recentDeparted = await fetchRecentDepartedEmails()
    const { inserted, updated, skipped, orgLinked } = await syncProfiles(azUsers, existingEmails, authEmailMap, recentDeparted) // ← [v9] orgLinked

    // 7. 프로필 사진 동기화 (avatar_url 없는 계정만, 최대 50명)
    const avatarResult = await syncAvatars(azUsers, profiles, token)

    const result = {
      success: true,
      total:   azUsers.length,
      inserted, updated, skipped,
      orgLinked,                                   // ← [v9 2026-10-01] 조직도 입사예정자 연결 수
      departed:          departed.length,
      cancelledBookings: cancelledCount,
      avatar:            avatarResult,
      syncedAt:          new Date().toISOString(),
    }

    console.log('[sync-all-users] 완료:', JSON.stringify(result))
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[sync-all-users] 오류:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
