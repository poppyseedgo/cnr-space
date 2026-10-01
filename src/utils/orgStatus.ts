/**
 * orgStatus.ts — 조직도 판정·표시 단일 진실 원천 (SSOT)
 *
 * ✅ 변경 이력
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §5.4 · §6.5
 *      · 상태 라벨: org_status_types(category·color) 기반. profiles.employment_status 와 1:1 이 아니므로
 *        utils/employment.ts(사용자 관리) 와 분리한다. 카드 라벨 색은 category 로 결정(사용자 정의 코드도 동일 규칙)
 *      · 카드 정렬: 단위장 → 직급 level ↓ → 대표 직무 level ↓ → 이름
 *      · 트리 빌드: org_units.parent_unit_id 기준, sort_order → name
 *      · 퇴사 판정: profile_id 있는데 users 에 없음 (departed_users 존재 여부는 표시 보조)
 *  - [2026-10-01 ORG Phase 5] orgPersonView displayNames(조직도 표기 이름) 우선 · CSV 'Azure 이름' 열
 *  - [2026-10-01 ORG Phase 4-B] orgExportRows — 파일 단위 카드 CSV 행 빌더(utils/csv.exportCSV 와 결합)
 */

import type { AppUser, OrgCard, OrgJob, OrgPersonStatus, OrgRank, OrgStatusCategory, OrgStatusType, OrgUnit, OrgEmploymentType } from '../types'

export const ORG_FONT = "'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"

// ─── 상태 라벨 색 (category 별) — 와이어프레임 확정 색 ───────────────────────
export interface OrgBadgeSpec { label: string; color: string; bg: string; dot: string }
const CAT_STYLE: Record<OrgStatusCategory, Omit<OrgBadgeSpec, 'label'>> = {
  hire_planned:   { color: '#115E59', bg: '#CCFBF1', dot: '#0D9488' },   // teal
  departing:      { color: '#92400E', bg: '#FEF3C7', dot: '#D97706' },   // amber
  leave_planned:  { color: '#5B21B6', bg: '#EDE9FE', dot: '#8B5CF6' },   // violet (연)
  leave:          { color: '#5B21B6', bg: '#EDE9FE', dot: '#7C3AED' },   // violet
  return_planned: { color: '#3730A3', bg: '#E0E7FF', dot: '#4F46E5' },   // indigo
}
export const ORG_DEPARTED_STYLE = { color: '#991B1B', bg: '#FEE2E2', dot: '#DC2626' }
export const ORG_VACANCY_STYLE  = { color: '#4B5563', bg: '#F3F4F6', dot: '#9CA3AF' }

export const ORG_EMPLOYMENT_TYPE_LABEL: Record<OrgEmploymentType, string> = {
  regular: '정규', contract: '계약', parttime: '파트타임', intern: '인턴',
}

/** 'YYYY-MM-DD' → 'M/D' */
export function shortDate(d?: string | null): string {
  if (!d || d.length < 10) return ''
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

/**
 * 카드에 붙는 상태 라벨 — 활성 상태 1건(사람당 1개) 기준.
 * 라벨 문구 규칙(설계서 §5.4): 입사예정 + 입사일 / 퇴사예정 + 퇴사일 / 휴직류 + 복귀일 / 복직예정 + 복귀일
 */
export function orgStatusBadge(st: OrgPersonStatus | null | undefined, types: Map<string, OrgStatusType>): OrgBadgeSpec | null {
  if (!st) return null
  const t = types.get(st.status_code)
  if (!t) return { label: st.status_code, ...CAT_STYLE.leave }
  const s = CAT_STYLE[t.category]
  let label = t.label
  switch (t.category) {
    case 'hire_planned':   if (st.start_on)  label += ` · ${shortDate(st.start_on)}`; break
    case 'departing':      if (st.end_on)    label += ` · ${shortDate(st.end_on)}`; break
    case 'leave_planned':  if (st.start_on)  label += ` · ${shortDate(st.start_on)}~`; break
    case 'leave':
    case 'return_planned': if (st.return_on) label += ` · 복귀 ${shortDate(st.return_on)}`; break
  }
  return { label, ...s }
}

// ─── 사람 표시 룩업 ──────────────────────────────────────────────────────────
export interface OrgPersonView {
  name:       string
  /** [Phase 5] Azure 원본 이름(표기 이름이 적용된 경우에만 값, 아니면 null) */
  azureName:  string | null
  dept:       string
  email:      string
  avatarUrl:  string | null
  /** profile_id 있는데 users 에 없음 = 퇴사 */
  departed:   boolean
  user:       AppUser | null
}
export function orgPersonView(card: OrgCard, users: AppUser[], persons: Map<string, { name: string; email: string | null }>, departed: Map<string, { name: string; avatar_url?: string | null }>, displayNames?: Map<string, { display_name: string }>): OrgPersonView {
  if (card.is_vacancy) return { name: card.display_name || '공석', azureName: null, dept: '', email: '', avatarUrl: null, departed: false, user: null }
  if (card.profile_id) {
    const u = users.find(x => x.user_id === card.profile_id)
    if (u) {
      const dn = displayNames?.get(card.profile_id)?.display_name   // [Phase 5] 조직도 표기 이름 우선
      return { name: dn || u.name, azureName: dn && dn !== u.name ? u.name : null, dept: u.dept, email: u.email, avatarUrl: u.avatar_url ?? null, departed: false, user: u }
    }
    const d = departed.get(card.profile_id)
    return { name: d?.name ?? card.display_name ?? '(퇴사자)', azureName: null, dept: '', email: '', avatarUrl: d?.avatar_url ?? null, departed: true, user: null }
  }
  if (card.person_id) {
    const p = persons.get(card.person_id)
    return { name: p?.name ?? card.display_name ?? '(입사예정)', azureName: null, dept: '', email: p?.email ?? '', avatarUrl: null, departed: false, user: null }
  }
  return { name: card.display_name ?? '-', azureName: null, dept: '', email: '', avatarUrl: null, departed: false, user: null }
}

// ─── 정렬 (hierarchy) ───────────────────────────────────────────────────────
export function primaryJob(card: OrgCard, jobs: Map<string, OrgJob>): OrgJob | null {
  const pj = card.jobs.find(j => j.is_primary) ?? card.jobs[0]
  return pj ? (jobs.get(pj.job_id) ?? null) : null
}
export function cardLevel(card: OrgCard, ranks: Map<string, OrgRank>, jobs: Map<string, OrgJob>): number {
  const r = card.rank_id ? ranks.get(card.rank_id) : null
  if (r) return 1000 + r.level
  const j = primaryJob(card, jobs)
  return j ? j.level : 0
}
/** 단위 안 카드 정렬: 단위장 → level ↓ → sort_order → 이름 */
export function sortCards(cards: OrgCard[], ranks: Map<string, OrgRank>, jobs: Map<string, OrgJob>, nameOf: (c: OrgCard) => string): OrgCard[] {
  return [...cards].sort((a, b) =>
    (Number(b.is_unit_head) - Number(a.is_unit_head)) ||
    (cardLevel(b, ranks, jobs) - cardLevel(a, ranks, jobs)) ||
    (a.sort_order - b.sort_order) ||
    nameOf(a).localeCompare(nameOf(b), 'ko'))
}

// ─── 트리 ───────────────────────────────────────────────────────────────────
export interface OrgUnitNode { unit: OrgUnit; children: OrgUnitNode[]; depth: number }
export function buildUnitTree(units: OrgUnit[]): OrgUnitNode[] {
  const byParent = new Map<string | null, OrgUnit[]>()
  for (const u of units) {
    const k = u.parent_unit_id ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(u)
  }
  const sortU = (a: OrgUnit, b: OrgUnit) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko')
  const build = (parent: string | null, depth: number, seen: Set<string>): OrgUnitNode[] =>
    (byParent.get(parent) ?? []).sort(sortU).filter(u => !seen.has(u.id)).map(u => {
      seen.add(u.id)
      return { unit: u, children: build(u.id, depth + 1, seen), depth }
    })
  return build(null, 0, new Set())
}
/** 단위 + 하위 전체 인원(공석 제외) */
export function subtreeHeadcount(node: OrgUnitNode, cardsByUnit: Map<string, OrgCard[]>): number {
  const own = (cardsByUnit.get(node.unit.id) ?? []).filter(c => !c.is_vacancy).length
  return own + node.children.reduce((s, ch) => s + subtreeHeadcount(ch, cardsByUnit), 0)
}
/** 하위 단위 id 집합 (드래그 순환 방지용 — 자기 하위로는 드롭 불가) */
export function descendantIds(unitId: string, units: OrgUnit[]): Set<string> {
  const out = new Set<string>()
  const walk = (id: string) => units.filter(u => u.parent_unit_id === id).forEach(u => { out.add(u.id); walk(u.id) })
  walk(unitId)
  return out
}

// ─── [Phase 4-B] CSV 내보내기 행 빌더 ───────────────────────────────────────
/**
 * 조직도 파일 1개의 카드를 CSV 행으로 변환. 트리 순서(단위 sort_order → 카드 정렬) 그대로.
 * 헤더 = 객체 key 순서(utils/csv.exportCSV 규칙). 공석도 포함(이름 = 표기, 이메일·사번 공란).
 */
export function orgExportRows(
  units: OrgUnit[], cards: OrgCard[], ranks: Map<string, OrgRank>, jobs: Map<string, OrgJob>, types: Map<string, OrgStatusType>,
  person: (c: OrgCard) => OrgPersonView, statusOf: (c: OrgCard) => OrgPersonStatus | null,
): Record<string, string>[] {
  const byUnit = new Map<string, OrgCard[]>()
  for (const c of cards) { if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []); byUnit.get(c.unit_id)!.push(c) }
  const cardById = new Map(cards.map(c => [c.id, c]))
  const unitById = new Map(units.map(u => [u.id, u]))
  const pathOf = (u: OrgUnit): string => { const p = u.parent_unit_id ? unitById.get(u.parent_unit_id) : null; return p ? `${pathOf(p)} > ${u.name}` : u.name }
  const rows: Record<string, string>[] = []
  const walk = (n: OrgUnitNode, depth: number) => {
    const path = pathOf(n.unit)
    for (const c of sortCards(byUnit.get(n.unit.id) ?? [], ranks, jobs, x => person(x).name)) {
      const pv = person(c), st = statusOf(c), stType = st ? types.get(st.status_code) : null
      const pj = primaryJob(c, jobs)
      const others = c.jobs.filter(j => j.job_id !== pj?.id).map(j => jobs.get(j.job_id)?.code).filter(Boolean)
      const mgr = c.reports_to_card_id ? cardById.get(c.reports_to_card_id) : null
      rows.push({
        '단위 경로':   path,
        '단위 깊이':   String(depth),
        '단위 약칭':   n.unit.code ?? '',
        '이름':        c.is_vacancy ? (c.display_name || '공석') : pv.name,
        'Azure 이름':  pv.azureName ?? '',
        '구분':        c.is_vacancy ? '공석' : pv.departed ? '퇴사' : c.profile_id ? '재직' : '입사예정',
        '이메일':      c.is_vacancy ? '' : pv.email,
        '사번':        pv.user?.employee_id ?? '',
        '직급':        c.rank_id ? (ranks.get(c.rank_id)?.label ?? '') : '',
        '대표 직무':   pj?.code ?? '',
        '겸직':        others.join(' / '),
        '단위장':      c.is_unit_head ? 'Y' : '',
        '보고선':      mgr ? person(mgr).name : '',
        '고용형태':    ORG_EMPLOYMENT_TYPE_LABEL[c.employment_type] ?? c.employment_type,
        '근무지':      c.work_location ?? '',
        'FTE':         String(c.fte ?? 1),
        '상태':        stType?.label ?? (st?.status_code ?? ''),
        '상태 시작일': st?.start_on ?? '',
        '상태 종료일': st?.end_on ?? '',
        '복직 예정일': st?.return_on ?? '',
        'Azure 부서':  pv.user?.dept ?? '',
        '메모':        c.memo ?? '',
      })
    }
    n.children.forEach(ch => walk(ch, depth + 1))
  }
  buildUnitTree(units).forEach(r => walk(r, 0))
  return rows
}

// ─── RPC 에러 한글 매핑 ─────────────────────────────────────────────────────
const ERR: Record<string, string> = {
  NOT_AUTHENTICATED:           '로그인이 필요합니다.',
  FORBIDDEN:                   '조직도 관리 권한이 필요합니다.',
  NOT_SUPER:                   'Active 지정은 최고 관리자만 할 수 있습니다.',
  ORG_FILE_NOT_FOUND:          '조직도 파일을 찾을 수 없습니다.',
  ORG_FILE_NOT_EDITABLE:       '초안 파일에서만 편집할 수 있습니다. 복사해서 편집하세요.',
  ORG_FILE_NOT_DELETABLE:      '초안 파일만 삭제할 수 있습니다.',
  ORG_FILE_STATUS_RPC_ONLY:    '파일 상태는 Active 지정으로만 바뀝니다.',
  ORG_FILE_ARCHIVED_READONLY:  '지난 조직도는 수정할 수 없습니다. 복사해서 편집하세요.',
  ORG_FILE_ACTIVE_READONLY:    'Active 조직도의 적용일·계보는 변경할 수 없습니다.',
  ORG_FILE_LOCKED:             '다른 사용자가 편집 중입니다.',
  ORG_UNIT_CYCLE:              '자기 자신이나 하위 단위 아래로는 이동할 수 없습니다.',
  ORG_UNIT_PARENT_OTHER_FILE:  '상위 단위는 같은 조직도 안에 있어야 합니다.',
  ORG_UNIT_HAS_CHILDREN:       '하위 단위가 있는 단위는 삭제할 수 없습니다.',
  ORG_UNIT_HAS_CARDS:          '카드가 남아 있는 단위는 삭제할 수 없습니다. 카드를 먼저 옮기세요.',
  ORG_CARD_UNIT_OTHER_FILE:    '카드는 같은 조직도의 단위에만 배치할 수 있습니다.',
  ORG_CARD_REPORTS_OTHER_FILE: '보고선은 같은 조직도의 카드여야 합니다.',
  ORG_ACTIVATE_NOT_DRAFT:      '초안만 Active 로 지정할 수 있습니다.',
  ORG_ACTIVATE_NEEDS_EFFECTIVE:'적용일을 먼저 지정하세요.',
  ORG_ACTIVATE_EMPTY:          '단위가 없는 빈 조직도는 Active 로 지정할 수 없습니다.',
  ORG_ACTIVATE_GHOSTS:         '퇴사자 카드가 남아 있습니다. 정리한 뒤 다시 시도하세요.',
  ORG_NAME_REQUIRED:           '이름을 입력하세요.',
  ORG_STATUS_UNKNOWN:          '알 수 없는 상태 코드입니다.',
  ORG_STATUS_START_REQUIRED:   '시작일을 지정하세요.',
  ORG_STATUS_RETURN_REQUIRED:  '복귀 예정일을 지정하세요.',
  ORG_STATUS_PLANNED_REQUIRED: '예정 휴직 종류를 지정하세요.',
  ORG_STATUS_ALREADY_ENDED:    '이미 종료된 상태입니다.',
  DEPARTURE_DATE_REQUIRED:     '퇴사 예정일을 지정하세요.',
  DEPARTURE_DATE_PAST:         '퇴사 예정일은 오늘 이후여야 합니다.',
  USER_NOT_FOUND:              '대상 사용자를 찾을 수 없습니다.',
  org_cards_file_profile:      '이 조직도에 이미 같은 사람의 카드가 있습니다.',
  org_units_file_code:         '같은 약칭(code)의 단위가 이미 있습니다.',
  org_files_one_active:        'Active 조직도는 하나만 둘 수 있습니다.',
}
export function orgErrorMessage(err: unknown, fallback = '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  for (const k of Object.keys(ERR)) if (msg.includes(k)) return ERR[k]
  return fallback
}
