// @ts-nocheck
/**
 * _shared/booking-purpose.ts
 * 회의 목적 코드 → 표시 라벨 (Deno Edge 공용)
 *
 * ✅ 변경 이력
 *  - [2026-08-10] 재생성 — 원본 유실(0810PM12 zip 부재). SSOT 는 프론트
 *      src/data/bookingPurpose.ts 의 BOOKING_PURPOSES / purposeExportText 와
 *      동일 데이터·동일 로직. 프론트에서 목적 코드가 바뀌면 이 파일도 함께 갱신.
 *  - [2026-07-27 목적 Phase 4] 최초 생성 — Teams facts·이메일 PURPOSE 행·인앱 프리픽스 공용
 *
 * 규칙: 코드 미정의/NULL(과거 예약) → null 반환, 호출부는 행/프리픽스 생략 (fail-safe)
 */

const PURPOSE_LABELS: Record<string, string> = {
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

/** 목적 표시 텍스트 — '기타'는 상세를 괄호로 병기. 미정의/NULL 은 null (행 생략) */
export function purposeText(purpose?: string | null, detail?: string | null): string | null {
  if (!purpose) return null
  const label = PURPOSE_LABELS[purpose]
  if (!label) return null
  return purpose === 'etc' && detail ? `${label}(${detail})` : label
}
