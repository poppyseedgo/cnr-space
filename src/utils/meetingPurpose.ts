/**
 * meetingPurpose.ts — 회의실 사용 목적 분류 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 3] 신규 생성 (Figma 551:3548 위젯 ⑨)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 📌 왜 DB 컬럼이 아니라 파생 함수인가 (설계 근거)
 *
 *   초기 검토안은 `bookings.purpose_code` 컬럼 + 규칙 테이블 + 백필이었다. 폐기한 이유:
 *
 *   1) purpose는 title에서 100% 파생 가능한 값이다. 저장하면 정규화가 깨진다.
 *   2) 실측된 title 표기 흔들림(HR면접 4종 변형, H/O·HO·handover 혼용 등)을 보면
 *      규칙사전은 앞으로 반복 튜닝될 것이 확실하다. 컬럼에 값을 굳혀두면
 *      규칙을 고칠 때마다 전체 백필이 필요하고, 백필 전까지 "DB에 저장된 분류"와
 *      "현재 규칙이 산출하는 분류"가 서로 다른 이중 진실 상태가 된다.
 *      → 규칙 수정 = 배포 한 번으로 과거 데이터까지 즉시 소급되는 구조가 근본적으로 옳다.
 *   3) 위젯은 이미 useBookingsByRange로 bookings를 메모리에 올린다. 추가 조회가 없다.
 *
 *   ※ 다음 조건이 생기면 그때 DB 컬럼으로 승격해야 한다(지금은 해당 없음):
 *      · SQL만으로 목적별 리포트를 뽑아야 할 때
 *      · 타 시스템(그룹웨어 등)이 분류값을 참조해야 할 때
 *      · 사용자가 자동 분류 결과를 수동으로 교정할 수 있어야 할 때
 *        (교정값은 파생 불가능하므로 반드시 저장이 필요해진다)
 *
 * 📌 왜 LLM을 쓰지 않는가
 *   "브랜드실", "PV", "meeting" 같은 타이틀에는 목적 정보 자체가 존재하지 않는다.
 *   어떤 모델도 없는 정보를 복원할 수 없고, 추측시키면 그건 분류가 아니라 조작이다.
 *   고지 결정(2026-07-23)에 따라 이런 건을 전부 '부서별 회의' fallback으로 명시 처리한다.
 *   결과적으로 미분류 0건, 외부 API 전송 0건, 결정론적(같은 입력 = 항상 같은 출력)이다.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type PurposeCode =
  | 'interview' | 'onetoone' | 'rehearsal' | 'handover' | 'training'
  | 'audit'     | 'project'  | 'mgmt'      | 'team'     | 'dept'

export interface PurposeDef {
  code:  PurposeCode
  label: string        // 표·드로어·CSV 표기 (정식 명칭)
  short: string        // 버블 차트 안 표기 — 원 지름이 작아 정식 명칭이 들어가지 않음
  re?:   RegExp        // 없으면 fallback
}

/**
 * ⚠️ 배열 순서 = 매칭 우선순위. 위에서 먼저 걸리면 종료한다.
 *    순서를 바꾸면 분류 결과가 바뀌므로, 변경 시 반드시 실제 title 데이터로 재시뮬레이션할 것.
 *
 *    특히 '리허설'이 training/audit/project보다 위에 있어야 한다. 실측 검증 사례:
 *      · "브랜드실 웨비나 리허설"            → training(웨비나)과 충돌 → 리허설이 정답
 *      · "[23-087] 식약처 사전 발표 리허설"  → audit(식약처)와 충돌   → 리허설이 정답
 *      · "SIV 리허설"                        → project(siv)와 충돌    → 리허설이 정답
 */
export const PURPOSE_DEFS: PurposeDef[] = [
  { code:'interview', label:'면접·채용',          short:'면접',     re:/면접|채용/i },
  { code:'onetoone',  label:'면담·1:1',           short:'면담',     re:/면담|1:1|1o1|personal meeting/i },
  { code:'rehearsal', label:'리허설',             short:'리허설',   re:/리허설|rehearsal|simulation/i },
  { code:'handover',  label:'인수인계(H/O)',      short:'인수인계', re:/인수인계|handover|(^|[\s[\]_-])h\s?\/?\s?o($|[\s[\]_-])/i },
  { code:'training',  label:'교육·트레이닝',      short:'교육',     re:/교육|ojt|training|트레이닝|웨비나|시연|설명|녹화/i },
  { code:'audit',     label:'외부방문·실사·감사', short:'외부방문', re:/방문|점검|실사|실태조사|audit|감사|식약처|oversight/i },
  { code:'project',   label:'과제·프로젝트',      short:'과제',     re:/pjm|kom|kick\s?off|과제|sponsor|스폰서|의뢰자|srm|siv|psv|prt|\btf\b|국책|review meeting/i },
  { code:'mgmt',      label:'경영회의',           short:'경영회의', re:/경영회의|경영관리|월간경영|ir 미팅|자문위원|advisor|klt|회계/i },
  // ← [2026-07-23 고지 지시] 라벨 '팀·파트 정례회의' → '정기 회의' (분류 규칙·범위는 변경 없음)
  { code:'team',      label:'정기 회의',          short:'정기회의',
    re:/스크럼|파트\s?미팅|part\s?meeting|partmeeting|팀\s?미팅|팀\s?회의|파트\s?회의|lm\s?meeting|\blmm\b|division\s?meeting|주간|weekly|정기\s?회의|정기\s?미팅|데일리|\boom\b|내부\s?미팅|내부\s?회의|team\s?meeting|part\s?[12]|manager meeting|파트\s?업무|업무분장/i },
  // ── fallback: 위 9종 어디에도 걸리지 않는 전부 ──
  //   실측상 대부분 "브랜드실" "PV" "DM 미팅"처럼 부서명·약어만 적힌 건이다.
  //   고지 결정(2026-07-23): 목적을 추측하지 않고 '부서별 회의'로 명시 처리한다.
  { code:'dept',      label:'부서별 회의',        short:'부서별' },
]

const FALLBACK = PURPOSE_DEFS[PURPOSE_DEFS.length - 1]

/** 예약 타이틀 1건 → 목적 분류 1건 (결정론적, 미분류 없음) */
export function classifyPurpose(title: string | null | undefined): PurposeDef {
  const t = (title ?? '').trim()
  for (const d of PURPOSE_DEFS) {
    if (d.re && d.re.test(t)) return d
  }
  return FALLBACK
}

export interface PurposeAggRow {
  code:  PurposeCode
  label: string
  short: string
  count: number
  ratio: number   // 0~1
}

/**
 * 예약 목록 → 목적별 집계 (count desc).
 *
 * 모수 규칙: 자동취소·거절 건은 제외한다.
 *   사유: 실제로 열리지 않은 회의를 "이 회의실은 면접에 많이 쓰인다"의 근거로 삼으면 왜곡된다.
 *   ※ 이 조건은 dashboardAgg.aggregateUsers의 count 조건과 동일하게 맞췄다.
 */
export function aggregatePurposes(bookings: { title?: string | null; autoCancelled?: boolean; status?: string }[]): PurposeAggRow[] {
  const counts = new Map<PurposeCode, number>()
  let total = 0

  bookings.forEach(b => {
    if (b.autoCancelled || b.status === 'rejected') return
    const d = classifyPurpose(b.title)
    counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
    total++
  })

  return PURPOSE_DEFS
    .map(d => {
      const count = counts.get(d.code) ?? 0
      return { code: d.code, label: d.label, short: d.short, count, ratio: total > 0 ? count / total : 0 }
    })
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

/**
 * 스택 바 세그먼트 색상 — [2026-07-23 Figma 갱신] 버블 차트 → 가로 100% 스택 바로 변경.
 *
 * Figma는 rgba(0,0,0,0.9)에서 시작해 세그먼트마다 투명도를 낮춘다(0.9 → 0.8 → 0.7 …).
 * 분류가 10개이므로 0.9에서 0.35까지 균등 분배한다.
 * 색상은 순위를 나타내는 장식이지 데이터가 아니다 — 실제 값은 세그먼트 폭과 표가 담당한다.
 */
export function segmentAlpha(index: number, total: number): number {
  if (total <= 1) return 0.9
  const MAX = 0.9, MIN = 0.35
  return MAX - (MAX - MIN) * (index / (total - 1))
}
