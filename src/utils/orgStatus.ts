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
 *  - [2026-10-01 ORG Phase 5-B] orgDepartedInfo(퇴사 판정 2종 + 7일 자동 숨김) · isCardHidden · 겸직(is_primary) 헤드카운트/CSV 반영
 *  - [2026-10-01 ORG Phase 5] orgPersonView displayNames(조직도 표기 이름) 우선 · CSV 'Azure 이름' 열
 *  - [2026-10-01 ORG Phase 6] splitBench(작업대 분리) · ERR 작업대/분리/합치기/되돌리기 코드
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
/** [Phase 6] 작업대 분리 — bench = kind='bench' 루트, inBench = 작업대 하위 단위 id(작업대 자신 포함). 트리·헤드카운트·Excel·CSV 는 orgUnits 만 쓴다 */
export function splitBench(units: OrgUnit[]): { bench: OrgUnit | null; inBench: Set<string>; orgUnits: OrgUnit[]; benchUnits: OrgUnit[] } {
  const bench = units.find(u => u.kind === 'bench') ?? null
  const inBench = bench ? new Set([bench.id, ...descendantIds(bench.id, units)]) : new Set<string>()
  return { bench, inBench, orgUnits: units.filter(u => !inBench.has(u.id)), benchUnits: units.filter(u => inBench.has(u.id)) }
}
/** 단위 + 하위 전체 인원 — 공석·겸직 카드·숨김 카드 제외 (= 사람 수). isHidden 은 [Phase 5-B] 자동/수동 숨김 판정 */
export function subtreeHeadcount(node: OrgUnitNode, cardsByUnit: Map<string, OrgCard[]>, isHidden?: (c: OrgCard) => boolean): number {
  const own = (cardsByUnit.get(node.unit.id) ?? []).filter(c => !c.is_vacancy && c.is_primary !== false && !(isHidden && isHidden(c))).length
  return own + node.children.reduce((s, ch) => s + subtreeHeadcount(ch, cardsByUnit, isHidden), 0)
}

// ─── [Phase 5-B] 퇴사 판정 · 숨김 ──────────────────────────────────────────
/** 퇴사일(또는 profiles 삭제일) + 이 일수가 지나면 캔버스에서 자동 숨김 (설계서 §12.2). 프론트 계산 — cron 없음 */
export const ORG_DEPARTED_HIDE_DAYS = 7
export interface OrgDepartedInfo {
  /** ① profiles 부재(유령) ② 활성 상태 category=departing 이고 퇴사일 경과 */
  departed:   boolean
  /** 기준일(YYYY-MM-DD): departed_users.departed_at 또는 상태 end_on */
  since:      string | null
  /** since + ORG_DEPARTED_HIDE_DAYS 경과 → 자동 숨김 */
  autoHidden: boolean
  /** 퇴사예정 상태이지만 아직 퇴사일 전 */
  departing:  boolean
}
export function orgDepartedInfo(card: OrgCard, person: OrgPersonView, status: OrgPersonStatus | null, types: Map<string, OrgStatusType>, departedAt: string | null | undefined, today = todayKST()): OrgDepartedInfo {
  const none: OrgDepartedInfo = { departed: false, since: null, autoHidden: false, departing: false }
  if (card.is_vacancy) return none
  if (person.departed) {
    const since = departedAt ? departedAt.slice(0, 10) : null
    return { departed: true, since, autoHidden: since ? addDays(since, ORG_DEPARTED_HIDE_DAYS) <= today : false, departing: false }
  }
  const cat = status ? types.get(status.status_code)?.category : null
  if (cat === 'departing' && status?.end_on) {
    if (status.end_on <= today) return { departed: true, since: status.end_on, autoHidden: addDays(status.end_on, ORG_DEPARTED_HIDE_DAYS) <= today, departing: false }
    return { ...none, departing: true }
  }
  return none
}
/** 숨김 = 수동(hidden_at) 또는 자동(퇴사 + 7일) */
export function isCardHidden(card: OrgCard, info: OrgDepartedInfo): boolean { return !!card.hidden_at || info.autoHidden }
export function todayKST(): string { return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) }
function addDays(ymd: string, n: number): string { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** 사람 키 — 겸직 카드 묶음용 */
export function cardPersonKey(c: OrgCard): string | null { return c.profile_id ?? (c.person_id ? 'p:' + c.person_id : null) }
/** 하위 단위 id 집합 (드래그 순환 방지용 — 자기 하위로는 드롭 불가) */
/** [8-C] 단위별 인원(하위 포함) — 본 카드·공석 제외·숨김 제외. ① 구조 설계·③ 인원 배치 공용 */
export function subtreeCounts(units: OrgUnit[], cards: OrgCard[], isHidden?: (c: OrgCard) => boolean): Map<string, number> {
  const byUnit = new Map<string, number>()
  for (const c of cards) if (!c.is_vacancy && c.is_primary !== false && !(isHidden?.(c))) byUnit.set(c.unit_id, (byUnit.get(c.unit_id) ?? 0) + 1)
  const out = new Map<string, number>()
  const walk = (n: OrgUnitNode): number => { const t = (byUnit.get(n.unit.id) ?? 0) + n.children.reduce((s, c) => s + walk(c), 0); out.set(n.unit.id, t); return t }
  buildUnitTree(units).forEach(walk)
  return out
}
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
  person: (c: OrgCard) => OrgPersonView, statusOf: (c: OrgCard) => OrgPersonStatus | null, isHidden?: (c: OrgCard) => boolean,
): Record<string, string>[] {
  const byUnit = new Map<string, OrgCard[]>()
  for (const c of cards) { if (isHidden && isHidden(c)) continue; if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []); byUnit.get(c.unit_id)!.push(c) }
  const unitNameById = new Map(units.map(u => [u.id, u.name]))
  const primaryUnitByPerson = new Map<string, string>()   // [Phase 5-B] 겸직 카드의 '본 소속'
  for (const c of cards) { const k = cardPersonKey(c); if (k && c.is_primary !== false) primaryUnitByPerson.set(k, unitNameById.get(c.unit_id) ?? '') }
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
        '구분':        c.is_vacancy ? '공석' : c.is_primary === false ? '겸직' : pv.departed ? '퇴사' : c.profile_id ? '재직' : '입사예정',
        '본 소속':     c.is_primary === false ? (primaryUnitByPerson.get(cardPersonKey(c) ?? '') ?? '') : '',
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
  // [Phase 6] 작업대 · 분리/합치기 · 되돌리기
  ORG_ACTIVATE_BENCH_NOT_EMPTY:'연결되지 않은 단위나 보류 카드가 남아 있습니다. 조직에 붙이거나 제거한 뒤 Active 지정하세요.',
  ORG_BENCH_PROTECTED:         '보류 영역은 삭제하거나 바꿀 수 없습니다.',
  ORG_MOVE_DUPLICATE_PERSON:   '대상 단위에 이미 같은 사람의 카드가 있습니다.',
  ORG_MERGE_DUPLICATE_PERSON:  '양쪽 단위에 모두 있는 사람이 있어 합칠 수 없습니다. 한쪽 카드를 먼저 정리하세요.',
  ORG_MERGE_SELF:              '같은 단위끼리는 합칠 수 없습니다.',
  ORG_UNIT_NOT_FOUND:          '대상 단위를 찾을 수 없습니다.',
  ORG_UNDO_NOTHING:            '되돌릴 내 변경이 없습니다.',
  ORG_UNDO_CONFLICT:           '그 뒤에 다른 사용자의 변경이 있어 되돌릴 수 없습니다.',
  org_cards_unit_profile:      '같은 단위에 같은 사람의 카드가 이미 있습니다.',
  org_cards_unit_person:       '같은 단위에 같은 사람의 카드가 이미 있습니다.',
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
  // [8-B] 단위 바인드
  ORG_BIND_SAME_FILE:          '같은 조직도 안의 단위는 승계(기준)로 쓸 수 없습니다.',
  ORG_BIND_INVALID:            '바인드 항목 형식이 올바르지 않습니다.',
  ORG_PLACE_INVALID:           '배치 항목 형식이 올바르지 않습니다.',
  // [8-A] RPC 가 아직 없을 때(PostgREST PGRST202) — 최신 마이그레이션 미적용
  'Could not find the function': 'DB 마이그레이션이 아직 적용되지 않았습니다 — supabase/migrations 의 최신 파일을 먼저 실행하세요.',
}
export function orgErrorMessage(err: unknown, fallback = '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  for (const k of Object.keys(ERR)) if (msg.includes(k)) return ERR[k]
  return fallback
}
