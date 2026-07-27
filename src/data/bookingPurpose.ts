/**
 * bookingPurpose.ts — 예약 '목적' 카테고리 SSOT
 *
 * [2026-07-27 Phase 1] 회의실 예약 목적 카테고리 신규 기능
 *   · 코드/라벨 10종 — 순서는 Figma(2688:1081) 칩 배열 순서 그대로.
 *     BookingModal 칩 렌더가 이 배열을 순회하므로 순서 변경 = UI 순서 변경.
 *   · DB 저장값은 code (라벨 아님) — 라벨 문구가 바뀌어도 백필 불필요.
 *     DB CHECK(chk_bookings_purpose_code)의 화이트리스트와 반드시 일치해야 함.
 *   · ⚠ utils/meetingPurpose.ts(대시보드 title 파생 9분류)와는 **별개 체계**.
 *     통합 금지 — 어드민 통계 반영은 한 달 운영 후 별건 (2026-07-27 고지 확정).
 */

/** 목적 코드 union — DB bookings.purpose 와 1:1 */
export type BookingPurposeCode =
  | 'audit' | 'hr' | 'task' | 'survey' | 'client'
  | 'part'  | 'team' | 'mgmt' | 'training' | 'etc'

export interface BookingPurposeDef {
  code:  BookingPurposeCode
  label: string
}

/** Figma 칩 순서 그대로 (2688:1081) */
export const BOOKING_PURPOSES: BookingPurposeDef[] = [
  { code: 'audit',    label: 'Audit' },
  { code: 'hr',       label: 'HR' },
  { code: 'task',     label: '과제' },
  { code: 'survey',   label: '실태조사' },
  { code: 'client',   label: '의뢰사 미팅' },
  { code: 'part',     label: '파트 회의' },
  { code: 'team',     label: '팀 회의' },
  { code: 'mgmt',     label: '경영회의' },
  { code: 'training', label: '교육' },
  { code: 'etc',      label: '기타' },
]

/** '기타' 상세 사유 최대 길이 — DB CHECK(1~40자)와 일치 */
export const PURPOSE_DETAIL_MAX = 40

/** code → 라벨. 미정의/NULL(과거 예약)은 null — 호출부는 칩 미렌더로 처리 */
export function purposeLabelOf(code?: string | null): string | null {
  if (!code) return null
  return BOOKING_PURPOSES.find(p => p.code === code)?.label ?? null
}

/** '기타' 여부 — 상세 입력 필수 판정 SSOT */
export function isEtcPurpose(code?: string | null): boolean {
  return code === 'etc'
}

/** CSV·텍스트 내보내기용 목적 표기 — 기타면 "기타(상세)", 없으면 빈 문자열 [2026-07-27 Phase 3] */
export function purposeExportText(purpose?: string | null, detail?: string | null): string {
  const label = purposeLabelOf(purpose)
  if (!label) return ''
  return purpose === 'etc' && detail ? `${label}(${detail})` : label
}
