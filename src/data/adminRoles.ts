/**
 * adminRoles.ts — 관리자 권한 카탈로그
 *
 * [2026-07-28] 'pointer' → 'resource' 개명 — 자원예약 일반화 확정(20260734_resource_phase1.sql).
 *              구 'pointer' 는 권한 이력(admin_role_grants) 라벨 표시용으로만 deprecated 보존
 * [2026-07-27] 'kb' 역할 추가 — GA 챗봇 지식베이스 관리 탭 (20260733_kb_chunks.sql)
 * [2026-07-24] 신규 · Phase 1
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 왜 '탭 = 역할' 인가
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   권한 이름을 새로 지으면(예: '운영', '자원관리') 화면 이름과 달라져서
 *   "이 사람에게 무엇을 준 건지"를 매번 설명해야 한다. 어드민 탭과 1:1로 두면
 *   부여 화면의 체크박스 이름이 곧 그 사람이 보게 될 메뉴 이름이 된다.
 *
 *   ⚠ 이 파일의 id 는 DB admin_roles.role 값과 **정확히 같아야 한다**.
 *     RLS 정책들이 has_admin_role('book') 처럼 문자열로 참조하므로,
 *     이름을 바꾸면 정책이 조용히 false 를 돌려준다.
 */

import type { AdminTabId } from '../components/layout/AdminSideNav'

export interface AdminRoleDef {
  /** DB admin_roles.role 값 */
  id:    string
  label: string
  /** 이 역할이 여는 어드민 탭. null = 대응 화면이 아직 없음 */
  tab:   AdminTabId | null
  desc:  string
  /** 폐기 예정 — 신규 부여 대상에서 제외하되 기존 데이터는 보존 */
  deprecated?: boolean
}

export const ADMIN_ROLES: AdminRoleDef[] = [
  { id: 'dashboard',    label: '대시보드',   tab: 'dashboard',     desc: '통계·지표 열람. 예약자 이름과 부서가 함께 보인다' },
  { id: 'booking',      label: '예약 관리',  tab: 'bookings',      desc: '전체 예약 조회·강제 취소' },
  { id: 'approval',     label: '승인 관리',  tab: 'approvals',     desc: '에메랄드 룸 승인·거절' },
  { id: 'room',         label: '회의실',     tab: 'rooms',         desc: '회의실 등록·수정·비활성화' },
  { id: 'user',         label: '사용자',     tab: 'users',         desc: 'Azure 동기화·퇴사 처리·권한 부여 화면 진입' },
  { id: 'visitor',      label: '방문 기록',  tab: 'visitors',      desc: '방문자 로그 조회·반납 (2차 비밀번호 별도)' },
  { id: 'book',         label: '도서 관리',  tab: 'books',         desc: '도서·대여·연체 관리' },
  { id: 'notification', label: '알림 설정',  tab: 'notifications', desc: '알림 채널 on/off·관리자 수신자 지정' },
  { id: 'notice',       label: '공지 배너',  tab: 'notices',       desc: '헤더 공지 내용·색·게시기간' },
  { id: 'kb',           label: 'KB 관리',    tab: 'kb',            desc: 'GA 챗봇 지식베이스 청크 편집' }, // ← [2026-07-27] 20260733 CHECK와 동기화
  { id: 'resource',     label: '자원예약',   tab: null,            desc: '자원 카테고리·개체 등록, 예약·반납 확인 — 화면 미구현, 권한만 선점' }, // ← [2026-07-28] 'pointer'에서 개명, 20260734 CHECK와 동기화
  { id: 'super',        label: '최고 관리자', tab: null,           desc: '모든 메뉴 + 권한 부여·회수' },
  // 폐기: zoom — 사내 ZOOM 사용 종료(2026-07-21). 기존 데이터 보존을 위해 목록에만 남긴다
  { id: 'zoom',         label: '[폐기] ZOOM', tab: null,           desc: '사내 사용 종료', deprecated: true },
  // 폐기: pointer — 'resource'로 개명(2026-07-28). DB에 데이터·CHECK 허용값 모두 없음.
  //       admin_role_grants 이력의 라벨 렌더링(roleSummary·권한 변경 이력)용으로만 남긴다
  { id: 'pointer',      label: '[구] 자원 관리', tab: null,        desc: "'resource'로 개명됨", deprecated: true }, // ← [2026-07-28] 이력 표시용
]

/** super 는 모든 역할을 포함한다 (DB has_admin_role 과 동일 규칙) */
export const SUPER_ROLE = 'super'

/** 신규 부여 화면에 노출할 역할 (폐기 제외) */
export const GRANTABLE_ROLES = ADMIN_ROLES.filter(r => !r.deprecated)

/** super 를 제외한 일반 역할 — 백필·'전 역할 보유' 판정에 쓴다 */
export const NORMAL_ROLES = GRANTABLE_ROLES.filter(r => r.id !== SUPER_ROLE)

/** 이 역할 집합으로 해당 탭을 볼 수 있는가 */
export function canSeeTab(roles: string[], tab: AdminTabId): boolean {
  if (roles.includes(SUPER_ROLE)) return true
  const def = ADMIN_ROLES.find(r => r.tab === tab)
  return def ? roles.includes(def.id) : false
}

/** 역할 집합 → 볼 수 있는 탭 목록 (ADMIN_ROLES 순서 유지) */
export function visibleTabs(roles: string[]): AdminTabId[] {
  return ADMIN_ROLES
    .filter(r => r.tab !== null && (roles.includes(SUPER_ROLE) || roles.includes(r.id)))
    .map(r => r.tab as AdminTabId)
}

/** 목록 배지용 요약 — super 우선, 그다음 개수 */
export function roleSummary(roles: string[]): string {
  if (roles.includes(SUPER_ROLE)) return '최고 관리자'
  const normal = roles.filter(r => r !== SUPER_ROLE)
  if (normal.length === 0) return '-'
  if (normal.length === NORMAL_ROLES.length) return '전 역할'
  const labels = normal
    .map(id => ADMIN_ROLES.find(r => r.id === id)?.label ?? id)
    .slice(0, 2)
  return normal.length > 2 ? `${labels.join('·')} 외 ${normal.length - 2}` : labels.join('·')
}
