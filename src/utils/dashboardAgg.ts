/**
 * dashboardAgg.ts — 어드민 대시보드 집계 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 2] 신규 생성
 *    · 사유: Figma 551:3316의 신규 위젯 "사용자 예약 순위" / "사용자 누적 노쇼" 가
 *            DetailDrawer(type='users')의 userAgg와 완전히 동일한 값을 보여준다.
 *            카드에서 따로 집계하면 "카드의 예약 건수"와 "드로어를 열었을 때의 예약 건수"가
 *            서로 다르게 나오는 이중 진실이 발생한다(집계 조건이 한쪽만 바뀌는 순간 즉시 어긋남).
 *    · 조치: AdminPage.tsx DetailDrawer 내부의 userAgg useMemo 본문을 이 파일로 추출.
 *            DetailDrawer와 신규 카드 2종이 같은 함수를 호출한다.
 *    · 집계 조건은 기존 로직 1:1 이식 — 새 조건을 추가하거나 완화하지 않았다.
 */
import type { Booking, AppUser } from '../types'
import { isNoshow } from './noshow'

/** 사용자별 집계 1행 — DetailDrawer userAgg가 쓰던 형태와 동일 */
export interface UserAggRow {
  user_id?:     string
  name:         string
  dept:         string
  /** ← [2026-07-23] 프로필 사진 URL. live users에서만 얻을 수 있고 예약 스냅샷에는 없다.
   *    카드가 '최근 생성된 예약'과 동일하게 실제 사진을 띄우기 위해 집계 단계에서 함께 담는다. */
  avatarUrl:    string | null
  count:        number   // 유효 예약 건수 (자동취소·거절 제외)
  noshow:       number   // 노쇼 건수 (utils/noshow.ts SSOT 기준)
  lastNoshowAt: number   // 마지막 노쇼 시점 (epoch ms, 없으면 0)
}

/**
 * 사용자별 예약/노쇼 집계.
 *
 * ※ 기존 AdminPage.tsx DetailDrawer userAgg(2026-05-26판)에서 그대로 옮긴 규칙:
 *   · 매핑 키 = b.user_id (UUID) 우선, 없으면 b.user(이름) fallback
 *       → 동명이인이라도 user_id가 다르면 별도 행. user_id 없는 외부 게스트만 이름 키 사용.
 *   · 표시명/부서/프로필사진 = users 배열의 live 값 우선, 없으면 예약 스냅샷(b.user / b.dept) fallback
 *     (avatar_url은 스냅샷에 없으므로 live에서 못 찾으면 null → UserAvatar가 이니셜로 대체)
 *       → 퇴사자·부서이동 사용자도 안전 (프로젝트 live-first 원칙)
 *   · count 조건 = !autoCancelled && status !== 'rejected'
 *   · noshow 판정 = utils/noshow.ts의 isNoshow (단일 SSOT — 여기서 재정의 금지)
 *   · 기본 정렬 = count desc
 */
export function aggregateUsers(bookings: Booking[], users: AppUser[]): UserAggRow[] {
  const map = new Map<string, UserAggRow>()

  bookings.forEach(b => {
    const key = b.user_id ?? b.user                              // ← UUID 우선, 없으면 이름 (외부 게스트 fallback)
    if (!map.has(key)) {
      // 표시명: users 배열에서 live name 우선 (퇴사자도 안전)
      const liveUser    = b.user_id ? users.find(u => u.user_id === b.user_id) : null
      const displayName = liveUser?.name ?? b.user
      const displayDept = liveUser?.dept ?? b.dept
      map.set(key, { user_id: b.user_id, name: displayName, dept: displayDept, avatarUrl: liveUser?.avatar_url ?? null, count: 0, noshow: 0, lastNoshowAt: 0 })
    }
    const s = map.get(key)!
    if (!b.autoCancelled && b.status !== 'rejected') s.count++
    if (isNoshow(b)) {
      s.noshow++
      // 가장 최근 노쇼 시점 추적 — start_at ISO 문자열을 timestamp로 변환
      const t = new Date(b.start_at).getTime()
      if (t > s.lastNoshowAt) s.lastNoshowAt = t
    }
  })

  // 기본 정렬은 예약 많은 순 (기존 호환). 정렬 변경은 호출부에서 처리
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}
