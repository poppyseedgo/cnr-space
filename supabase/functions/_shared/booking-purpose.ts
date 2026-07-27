/**
 * _shared/booking-purpose.ts — 예약 '목적' 라벨 사전 (Edge Function 전용)
 *
 * [2026-07-27 목적 Phase 4]
 *   · 프론트 SSOT src/data/bookingPurpose.ts 와 코드/라벨이 반드시 일치해야 한다.
 *     (Deno ↔ 프론트는 import 경계가 달라 파일을 공유할 수 없어 복제 — 카탈로그와 동일 사유)
 *   · email-templates(이메일 목적 행) / notification-inapp(인앱 본문) /
 *     send-notification(Teams 카드 facts)이 공용으로 사용.
 *   · 코드 10종은 DB CHECK(chk_bookings_purpose_code)와도 일치.
 */

export const PURPOSE_LABELS: Record<string, string> = {
  audit:    'Audit',
  hr:       'HR',
  task:     '과제',
  survey:   '실태조사',
  client:   '의뢰사 미팅',
  part:     '파트 회의',
  team:     '팀 회의',
  mgmt:     '경영회의',
  training: '교육',
  etc:      '기타',
}

/** code → 라벨. 미정의/없음 → null (호출부는 행/표기 생략 — 과거 예약 fail-safe) */
export function purposeLabelOf(code?: string | null): string | null {
  if (!code) return null
  return PURPOSE_LABELS[code] ?? null
}

/** 텍스트 한 줄 표기 — 기타면 "기타(상세)". 없으면 null */
export function purposeText(code?: string | null, detail?: string | null): string | null {
  const label = purposeLabelOf(code)
  if (!label) return null
  return code === 'etc' && detail ? `${label}(${detail})` : label
}
