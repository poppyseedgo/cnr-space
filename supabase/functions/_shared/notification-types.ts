// @ts-nocheck
/**
 * _shared/notification-types.ts
 * C&R Space 알림 시스템 — 모든 이벤트의 정책 상수
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 원칙: Single Source of Truth
 * ═══════════════════════════════════════════════════════════════════════════
 * · 이 파일 하나만 보면 "어떤 이벤트가 누구에게 어떤 제목/본문으로 가는지" 파악 가능
 * · 신규 알림 추가 시 여기에 정책 1줄 추가 → 템플릿/발송 로직 자동 반영
 * · 제목/헤더 색상/CTA/수신자 규칙을 모두 여기서 관리 (하드코딩 금지)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-17 P2 v1] 초기 생성
 *   · 기존 send-notification의 10개 type + checkin 3개 + daily 1개 = 총 14개 통합
 *   · 이모지 제거, 업무적 말머리 적용 ([예약확정], [자동취소] 등)
 *   · 수신자 정책 표준화 (RecipientRule 5종)
 *   · 인앱 type도 이 파일에서 관리 (기존 분산 상태 해소)
 *
 * [2026-04-18 P2 v2] 제목 포맷 변경
 *   · 브랜드 식별자 "[C&R SPACE]" 접두어 제거 (FROM으로 이미 식별 가능)
 *   · 역할 구분(참석자/관리자)을 말머리 대괄호 내부로 이동
 *     before: "[C&R SPACE · 참석자]  [예약확정]  주간회의"
 *     after:  "[예약확정 · 참석자]  주간회의"
 *   · 예약자 제목은 역할 표시 없이 최소 형태: "[예약확정]  주간회의"
 *   · attendee_removed 예외: 말머리에 '참석자' 단어가 있어 역할 표시 생략
 *     "[참석자제외]  주간회의" (중복 방지)
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. 이벤트 타입 정의
// ═══════════════════════════════════════════════════════════════════════════
// 기존 코드에서 쓰던 문자열 그대로 유지 (auto-cancel, checkin-reminder 호환)
// 신규 checkin 이벤트는 일관된 네이밍 적용

export type NotificationType =
  // 예약 생성
  | 'created'                 // 일반 룸 예약 확정
  | 'pending'                 // 에메랄드 승인 요청 접수
  // 예약 변경
  | 'updated'                 // 예약 정보 변경
  | 'attendee_removed'        // 참석자 제거됨 (제거 대상자에게)
  // 예약 취소/거절
  | 'cancelled'               // 취소 (사용자/관리자 공통 — admin_force flag로 구분)
  | 'rejected'                // 관리자 거절
  // 승인 처리
  | 'approved'                // 관리자 승인
  // 자동 처리
  | 'noshow'                  // 노쇼 자동취소
  | 'pending_expiring'        // 승인 기한 10분 전 (Admin 알림)
  | 'pending_expired'         // 승인 기한 초과 자동취소
  // 체크인 관련
  | 'checkin_before_10'       // 시작 10분 전 체크인 안내
  | 'checkin_start'           // 시작 시점 체크인 요청
  | 'checkin_warning_5'       // 시작 5분 후 미체크인 경고
  // 일일 리마인더
  | 'daily_reminder'          // 매일 07:00 KST 당일 예약 안내

// ═══════════════════════════════════════════════════════════════════════════
// 2. 수신자 규칙
// ═══════════════════════════════════════════════════════════════════════════

export type RecipientRule =
  | 'booker_only'              // 예약자 1명만
  | 'booker_and_attendees'     // 예약자 + 참석자들
  | 'admins_only'              // 관리자 전원
  | 'booker_attendees_admins'  // 3자 모두 (pending, pending_expired)
  | 'removed_attendees'        // 제거된 참석자 (attendee_removed 전용)

// ═══════════════════════════════════════════════════════════════════════════
// 3. 헤더 색상 체계 (5색)
// ═══════════════════════════════════════════════════════════════════════════
// Outlook 호환 단색 HEX만 사용 (rgba 금지)

export const COLORS = {
  INDIGO: '#4F46E5',   // 긍정/확정
  AMBER:  '#D97706',   // 주의/대기
  RED:    '#DC2626',   // 취소/거절/실패
  CYAN:   '#0891B2',   // 리마인더/정보
  GRAY:   '#6B7280',   // 중립
} as const

// ═══════════════════════════════════════════════════════════════════════════
// 4. 정책 인터페이스
// ═══════════════════════════════════════════════════════════════════════════

export interface NotificationPolicy {
  /** 이메일 제목 말머리 태그 — [예약확정] 같은 형태 */
  subjectTag: string

  /** 헤더에 표시되는 라벨 — "예약이 확정되었습니다" */
  headerLabel: string

  /** 헤더 배경 색상 */
  headerColor: string

  /** 수신자 규칙 */
  recipients: RecipientRule

  /** 인앱 알림 — DB notifications.type 컬럼 값 */
  inappType: string

  /** 인앱 알림 제목 (예약자용) */
  inappTitleBooker: string

  /** 인앱 알림 제목 (참석자용) — 예약자와 같으면 동일값 */
  inappTitleAttendee: string

  /** 인앱 알림 제목 (관리자용) — 해당 없으면 빈 문자열 */
  inappTitleAdmin: string

  /**
   * 본문에 표시되는 상황 배너 (경고/안내 박스)
   * · 키: 컨텍스트 (booker/attendee/admin/recur)
   * · 값: {bgColor, borderColor, textColor, title, body}
   * · null이면 배너 없음
   */
  contextBanner: {
    booker?:   { bg: string; border: string; text: string; title: string; body?: string }
    attendee?: { bg: string; border: string; text: string; title: string; body?: string }
    admin?:    { bg: string; border: string; text: string; title: string; body?: string }
  } | null

  /**
   * CTA 버튼 정책
   * · null이면 버튼 없음
   * · urlTemplate에 {APP_URL}, {BOOKING_ID} 등 플레이스홀더 사용
   */
  cta: {
    booker?:   { label: string; urlTemplate: string; color: string }
    attendee?: { label: string; urlTemplate: string; color: string }
    admin?:    { label: string; urlTemplate: string; color: string }
  } | null

  /** strikethrough 적용 여부 (취소/거절류) */
  isCancelledStyle: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 배너 프리셋 (색상 조합 재사용)
// ═══════════════════════════════════════════════════════════════════════════

const BANNER_PRESETS = {
  info:      { bg: '#EEF2FF', border: '#4F46E5', text: '#4338CA' },
  warning:   { bg: '#FEF3C7', border: '#D97706', text: '#92400E' },
  danger:    { bg: '#FEF2F2', border: '#DC2626', text: '#991B1B' },
  success:   { bg: '#F0FDF4', border: '#16A34A', text: '#166534' },
  neutral:   { bg: '#F8FAFC', border: '#CBD5E1', text: '#475569' },
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. CTA 프리셋
// ═══════════════════════════════════════════════════════════════════════════

const CTA_APP_ROOT   = { label: '예약 확인하기',      urlTemplate: '{APP_URL}',                                  color: COLORS.INDIGO }
const CTA_NEW        = { label: '새 예약 만들기',      urlTemplate: '{APP_URL}',                                  color: COLORS.INDIGO }
const CTA_CHECKIN    = { label: '체크인하러 가기',     urlTemplate: '{APP_URL}',                                  color: COLORS.CYAN }
const CTA_ADMIN_APPR = { label: '지금 승인 처리하기',  urlTemplate: '{APP_URL}#admin-booking-{BOOKING_ID}',       color: COLORS.AMBER }

// ═══════════════════════════════════════════════════════════════════════════
// 7. 정책 정의 — 이벤트별 전체 매트릭스
// ═══════════════════════════════════════════════════════════════════════════

export const POLICIES: Record<NotificationType, NotificationPolicy> = {

  // ──────────────────────────────────────────────────────────────────────
  // 생성
  // ──────────────────────────────────────────────────────────────────────

  created: {
    subjectTag:         '[예약확정]',
    headerLabel:        '예약이 확정되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',
    inappType:          'booking_created',
    inappTitleBooker:   '예약이 확정되었습니다',
    inappTitleAttendee: '회의 참석자로 초대되었습니다',
    inappTitleAdmin:    '',
    contextBanner:      null,
    cta: {
      booker:   CTA_APP_ROOT,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: false,
  },

  pending: {
    subjectTag:         '[승인요청]',
    headerLabel:        '에메랄드 룸 승인 요청이 접수되었습니다',
    headerColor:        COLORS.AMBER,
    recipients:         'booker_attendees_admins',
    inappType:          'booking_pending',
    inappTitleBooker:   '승인 요청이 접수되었습니다',
    inappTitleAttendee: '참석 예정 회의가 승인 대기 중입니다',
    inappTitleAdmin:    '새 예약 승인 요청이 접수되었습니다',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.warning, title: '에메랄드 룸 예약 승인 요청이 접수되었습니다.',         body: '관리자 검토 후 승인 또는 거절 결과를 이메일로 안내해 드립니다.' },
      attendee: { ...BANNER_PRESETS.warning, title: '참석 예정 회의가 관리자 승인 대기 중입니다.',           body: '승인이 완료되면 별도 안내 메일이 발송됩니다.' },
      admin:    { ...BANNER_PRESETS.warning, title: '아래 버튼을 클릭해 승인 또는 거절해 주세요.',          body: '예약 시작 1분 전까지 처리되지 않으면 자동 취소됩니다.' },
    },
    cta: {
      admin: CTA_ADMIN_APPR,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 변경
  // ──────────────────────────────────────────────────────────────────────

  updated: {
    subjectTag:         '[예약변경]',
    headerLabel:        '예약이 변경되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',
    inappType:          'booking_updated',
    inappTitleBooker:   '예약이 변경되었습니다',
    inappTitleAttendee: '참석 예약이 변경되었습니다',
    inappTitleAdmin:    '',
    contextBanner:      null,
    cta: {
      booker:   CTA_APP_ROOT,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: false,
  },

  attendee_removed: {
    subjectTag:         '[참석자제외]',
    headerLabel:        '해당 예약의 참석자에서 제외되었습니다',
    headerColor:        COLORS.GRAY,
    recipients:         'removed_attendees',
    inappType:          'booking_attendee_removed',
    inappTitleBooker:   '',
    inappTitleAttendee: '회의 참석자 명단에서 제외되었습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      attendee: { ...BANNER_PRESETS.neutral, title: '해당 회의의 참석자 명단에서 제외되었습니다.', body: '예약자가 참석자 목록을 수정하여 본 메일이 발송되었습니다.' },
    },
    cta:                null,
    isCancelledStyle:   true,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 취소/거절
  // ──────────────────────────────────────────────────────────────────────

  cancelled: {
    subjectTag:         '[예약취소]',
    headerLabel:        '예약이 취소되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'booker_and_attendees',
    inappType:          'booking_cancelled',
    inappTitleBooker:   '예약이 취소되었습니다',
    inappTitleAttendee: '참석 예약이 취소되었습니다',
    inappTitleAdmin:    '',
    contextBanner:      null,  // admin_force일 때는 템플릿 엔진이 booking.admin_force flag로 별도 배너 동적 렌더
    cta: {
      booker:   CTA_NEW,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: true,
  },

  rejected: {
    subjectTag:         '[승인거절]',
    headerLabel:        '승인 요청이 거절되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'booker_and_attendees',
    inappType:          'booking_rejected',
    inappTitleBooker:   '예약 요청이 거절되었습니다',
    inappTitleAttendee: '참석 예약 요청이 거절되었습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.danger, title: '거절 사유는 본문에 표시됩니다.', body: '반려된 예약은 자동으로 취소 처리됩니다. 새로운 예약을 생성하여 다시 승인 요청해 주세요.' },
      attendee: { ...BANNER_PRESETS.danger, title: '참석 예정 회의가 거절되었습니다.', body: '예약자에게 사유가 안내되었습니다.' },
    },
    cta: {
      booker:   CTA_NEW,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: true,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 승인
  // ──────────────────────────────────────────────────────────────────────

  approved: {
    subjectTag:         '[예약승인]',
    headerLabel:        '예약 요청이 승인되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',
    inappType:          'booking_approved',
    inappTitleBooker:   '예약이 승인되었습니다',
    inappTitleAttendee: '참석 예약이 승인되었습니다',
    inappTitleAdmin:    '',
    contextBanner:      null,  // 승인 관리자 정보는 템플릿이 booking.admin_name으로 동적 렌더
    cta: {
      booker:   CTA_APP_ROOT,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 자동 처리
  // ──────────────────────────────────────────────────────────────────────

  noshow: {
    subjectTag:         '[자동취소]',
    headerLabel:        '노쇼로 예약이 자동 취소되었습니다',
    headerColor:        COLORS.AMBER,
    recipients:         'booker_and_attendees',
    inappType:          'booking_noshow',
    inappTitleBooker:   '미체크인으로 예약이 자동 취소되었습니다',
    inappTitleAttendee: '참석 예약이 노쇼로 자동 취소되었습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.warning, title: '체크인 미완료로 예약이 자동 취소되었습니다.',    body: '예약 시작 후 10분 이내에 체크인이 없으면 자동 취소됩니다.' },
      attendee: { ...BANNER_PRESETS.warning, title: '예약자가 체크인하지 않아 회의가 자동 취소되었습니다.' },
    },
    cta: {
      booker: CTA_NEW,
    },
    isCancelledStyle: true,
  },

  pending_expiring: {
    subjectTag:         '[승인기한임박]',
    headerLabel:        '에메랄드 룸 승인 기한이 10분 후 만료됩니다',
    headerColor:        COLORS.AMBER,
    recipients:         'admins_only',
    inappType:          'booking_pending_expiring',
    inappTitleBooker:   '',
    inappTitleAttendee: '',
    inappTitleAdmin:    '에메랄드 룸 승인 기한이 10분 후 만료됩니다',
    contextBanner: {
      admin: { ...BANNER_PRESETS.warning, title: '10분 내에 승인 또는 거절하지 않으면 예약이 자동 취소됩니다.', body: '지금 바로 처리해 주세요.' },
    },
    cta: {
      admin: CTA_ADMIN_APPR,
    },
    isCancelledStyle: false,
  },

  pending_expired: {
    subjectTag:         '[기한초과취소]',
    headerLabel:        '승인 기한 초과로 예약이 자동 취소되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'booker_attendees_admins',
    inappType:          'booking_pending_expired',
    inappTitleBooker:   '에메랄드 룸 예약이 기한 초과로 자동 취소되었습니다',
    inappTitleAttendee: '참석 예약이 기한 초과로 자동 취소되었습니다',
    inappTitleAdmin:    '승인 기한 초과로 예약이 자동 취소되었습니다',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.danger, title: '예약 시작 전까지 관리자 승인이 완료되지 않아 자동 취소되었습니다.', body: '새 예약을 생성하여 다시 승인 요청해 주세요.' },
      attendee: { ...BANNER_PRESETS.danger, title: '참석 예정 회의가 기한 초과로 자동 취소되었습니다.' },
      admin:    { ...BANNER_PRESETS.danger, title: '예약 시작 1분 전까지 승인이 완료되지 않아 시스템이 자동 취소 처리했습니다.' },
    },
    cta: {
      booker: CTA_NEW,
    },
    isCancelledStyle: true,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 체크인 리마인더
  // ──────────────────────────────────────────────────────────────────────

  checkin_before_10: {
    subjectTag:         '[회의10분전]',
    headerLabel:        '회의 시작 10분 전입니다',
    headerColor:        COLORS.CYAN,
    recipients:         'booker_only',
    inappType:          'checkin_before_10',
    inappTitleBooker:   '회의 시작 10분 전 — 체크인 준비',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: { ...BANNER_PRESETS.info, title: '예약 시작 10분 전부터 체크인이 가능합니다.', body: '체크인하지 않으면 시작 10분 후 자동 취소됩니다.' },
    },
    cta: {
      booker: CTA_CHECKIN,
    },
    isCancelledStyle: false,
  },

  checkin_start: {
    subjectTag:         '[회의시작]',
    headerLabel:        '회의 시작 시간입니다 — 체크인해 주세요',
    headerColor:        COLORS.CYAN,
    recipients:         'booker_and_attendees',
    inappType:          'checkin_start',
    inappTitleBooker:   '회의 시작 — 체크인해 주세요',
    inappTitleAttendee: '참석 회의가 시작되었습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.info, title: '지금 체크인하지 않으면 10분 후 자동 취소됩니다.' },
      attendee: { ...BANNER_PRESETS.info, title: '회의실로 이동하실 시간입니다.' },
    },
    cta: {
      booker: CTA_CHECKIN,
    },
    isCancelledStyle: false,
  },

  checkin_warning_5: {
    subjectTag:         '[자동취소경고]',
    headerLabel:        '5분 후 예약이 자동 취소됩니다',
    headerColor:        COLORS.AMBER,
    recipients:         'booker_only',
    inappType:          'checkin_warning_5',
    inappTitleBooker:   '미체크인 — 5분 후 자동 취소 예정',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: { ...BANNER_PRESETS.warning, title: '체크인이 없으면 5분 후 예약이 자동 취소됩니다.', body: '지금 즉시 체크인해 주세요.' },
    },
    cta: {
      booker: CTA_CHECKIN,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 일일 리마인더
  // ──────────────────────────────────────────────────────────────────────

  daily_reminder: {
    subjectTag:         '[오늘의예약]',
    headerLabel:        '오늘의 예약 안내',
    headerColor:        COLORS.CYAN,
    recipients:         'booker_and_attendees',
    inappType:          'daily_reminder',
    inappTitleBooker:   '오늘 예약된 회의가 있습니다',
    inappTitleAttendee: '오늘 참석 예정 회의가 있습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.info, title: '예약 시작 10분 전부터 체크인이 가능합니다.', body: '체크인하지 않으면 시작 10분 후 자동 취소됩니다.' },
      attendee: { ...BANNER_PRESETS.info, title: '회의 시작 시간에 맞춰 회의실로 이동해 주세요.' },
    },
    cta: {
      booker:   CTA_CHECKIN,
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: false,
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. 유틸 함수 — 제목 조립
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이메일 제목 조립
 * @param type   이벤트 타입
 * @param title  회의 제목
 * @param role   수신자 역할 ('booker' | 'attendee' | 'admin')
 *
 * 제목 형식:
 *  · booker:   "{subjectTag}  {title}"
 *    예: "[예약확정]  주간회의"
 *  · attendee: "{subjectTag_with_role}  {title}"
 *    예: "[예약확정 · 참석자]  주간회의"
 *  · admin:    "{subjectTag_with_role}  {title}"
 *    예: "[승인요청 · 관리자]  주간회의"
 *
 * 규칙:
 *  · 브랜드 식별자(예: "C&R SPACE") 접두어 없음 — 발신자 FROM으로 이미 식별됨
 *  · 역할 구분자는 말머리 대괄호 내부에 " · {역할}" 형태로 삽입 (Option 4 선정)
 *  · 공백 2칸으로 말머리와 제목 시각적 분리
 *
 * 예외:
 *  · attendee_removed: 말머리에 "참석자"가 이미 포함되어 있으므로 역할 표시 생략
 *    → "[참석자제외]  주간회의" (role 파라미터와 무관하게 동일)
 */
export function getSubject(
  type: NotificationType,
  title: string,
  role: 'booker' | 'attendee' | 'admin',
): string {
  const policy = POLICIES[type]
  if (!policy) return `[예약알림]  ${title}`

  // ← [2026-04-18] 브랜드 식별자 제거, 역할을 말머리 대괄호 내부로 이동
  let tag = policy.subjectTag

  // ← [2026-04-18] attendee_removed 예외: 말머리에 '참석자' 단어가 이미 있어 중복 방지
  //   (role 파라미터가 attendee로 들어와도 역할 표시 생략)
  const skipRoleLabel = type === 'attendee_removed'

  if (!skipRoleLabel) {
    if (role === 'attendee') {
      tag = tag.replace(/\]$/, ' · 참석자]')
    } else if (role === 'admin') {
      tag = tag.replace(/\]$/, ' · 관리자]')
    }
    // role === 'booker'면 원본 subjectTag 그대로 사용 (가장 기본 형태)
  }

  return `${tag}  ${title}`
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. 유틸 함수 — URL 템플릿 치환
// ═══════════════════════════════════════════════════════════════════════════

export function renderUrl(
  template: string,
  context: { APP_URL: string; BOOKING_ID?: string },
): string {
  return template
    .replace('{APP_URL}',    context.APP_URL)
    .replace('{BOOKING_ID}', context.BOOKING_ID ?? '')
}
