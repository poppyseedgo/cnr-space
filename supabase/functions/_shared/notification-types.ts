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
 * [2026-06-12] 예약자(소유권) 변경 알림 2종 추가 (관리자 전용)
 *   · NotificationType: owner_changed, former_booker
 *   · RecipientRule: former_booker (원래 예약자 1명)
 *   · owner_changed: 새 예약자(booker)+참석자(attendee), DB 갱신 후 발사 → resolver 자동 해석
 *     문구 정책 — 새 예약자에겐 "변경" 대신 "지정" 표현("회의 예약자로 지정되었습니다")
 *   · former_booker: 원래 예약자에게만, role='booker'로 렌더(send-notification), 회색 처리
 *
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
 *
 * [2026-04-19 P2 v3] 브랜드 태그 복원 (Option B: 단일 대괄호 통합)
 *   · 증상: Outlook M365에서 발신자가 "You"/"Note to self"로 표시되는 버그
 *   · 원인: @cnrres.com 내부 도메인 + Resend(외부 SMTP) 조합에서
 *          Outlook의 Intelligent Sender Display 휴리스틱이 동작.
 *          Subject에 브랜드 태그가 없으면 "외부 시스템 메일인지 불명확"으로
 *          판단하여 display name을 무시하고 내부 주소 기반 이름으로 대체.
 *   · 검증: 같은 리팩토링 후 코드여도 "[C&R SPACE] ⏰ 승인 기한..." 형태로
 *          브랜드 태그가 남아있던 메일은 C&R SPACE로 정상 표시됨.
 *   · 해결: 모든 제목의 말머리에 "C&R SPACE ·" 브랜드 식별자 통합.
 *     before: "[승인요청 · 관리자]  에메랄드 승인 건"
 *     after:  "[C&R SPACE · 승인요청 · 관리자]  에메랄드 승인 건"
 *   · 설계 유지:
 *     - subjectTag 상수 14개는 그대로 유지 (단일 진실 원천 원칙 불변)
 *     - 브랜드 prefix는 조립 단계(getSubject)에서만 주입
 *     - attendee_removed 예외도 그대로: "[C&R SPACE · 참석자제외]  ..."
 *     - 폴백 경로도 브랜드 prefix 적용 ("[C&R SPACE · 예약알림]  ...")
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. 이벤트 타입 정의
// ═══════════════════════════════════════════════════════════════════════════
// 기존 코드에서 쓰던 문자열 그대로 유지 (auto-cancel, checkin-reminder 호환)
// 신규 checkin 이벤트는 일관된 네이밍 적용

export type NotificationType =
  // 예약 생성
  | 'created'                 // 일반 룸 예약 확정
  | 'created_on_behalf'       // ← [2026-06-12] 관리자 대리 예약 (요청자+참석자에게)
  | 'pending'                 // 에메랄드 승인 요청 접수
  // 예약 변경
  | 'updated'                 // 예약 정보 변경
  | 'attendee_removed'        // 참석자 제거됨 (제거 대상자에게)
  // ← [2026-06-12] 예약자(소유권) 변경 — 관리자 전용 기능
  | 'owner_changed'           // 예약자 변경됨 (새 예약자 + 참석자에게 발송)
  | 'former_booker'           // 예약자에서 변경됨 (원래 예약자에게만 발송)
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
  // ← [2026-05-12 체크인 활성 5분 전 핫픽스]
  //   삭제: checkin_before_10 (시작 10분 전 이동 안내), checkin_start (시작 시점 체크인 요청)
  //   신규: checkin_before_5  (시작 5분 전 체크인 요청 + CTA — 체크인 활성과 동시 발송)
  //   유지: checkin_warning_5 (시작 후 5분 자동취소 경고)
  | 'checkin_before_5'        // 시작 5분 전 체크인 요청 (체크인 활성 시작 시점)
  | 'checkin_warning_5'       // 시작 5분 후 미체크인 경고 (자동취소 5분 전)
  | 'early_end'               // 회의실 조기 반납 ← [P2 v7] 2026-04-19 신규
  // 일일 리마인더
  | 'daily_reminder'          // 매일 07:00 KST 당일 예약 안내
  // ── 도서관 (← [2026-07-20] 신규) ─────────────────────────────────────
  //   수신자는 항상 대여자 본인 1명(book_borrower). 참석자/관리자 개념 없음.
  //   스케줄형 3종(due_tomorrow/due_today/overdue)은 매일 09:00 KST 발송.
  | 'book_borrowed'           // 대여 확정 (관리자가 대여 등록한 즉시)
  | 'book_extended'           // 연장 완료 (사용자 연장 신청 직후)
  | 'book_due_tomorrow'       // 반납 1일 전 09:00 KST
  | 'book_due_today'          // 반납 당일 09:00 KST
  | 'book_overdue'            // 연체중 09:00 KST (매일 반복)

  // ── 도서 대여 신청/승인 (← [2026-07-22] 신규) ────────────────────────
  //   에메랄드룸 승인 패턴 준용. 신청은 관리자 전원에게, 승인/거절은 신청자에게.
  // ── [2026-07-21] 승인 플로우 폐지. 아래 3종은 더 이상 발송되지 않는다.
  //   과거 알림 이력(notifications 테이블)에 타입 문자열이 남아 있으므로
  //   유니온에서 제거하지 않는다 — 제거하면 이력 조회가 타입 에러를 낸다.
  | 'book_requested'          // [폐지]
  | 'book_request_approved'   // [폐지]
  | 'book_request_rejected'   // [폐지]
  | 'book_started'            // 대여 시작일 도래 09:00 KST → 대여자 (← [2026-07-21])
  // ── [2026-07-21] 연체 패널티 ────────────────────────────────────────────
  | 'book_penalty_applied'    // 반납 시 제재 확정 → 대여자
  | 'book_penalty_cleared'    // 제재 해제(만료·관리자) → 대여자

// ═══════════════════════════════════════════════════════════════════════════
// 2. 수신자 규칙
// ═══════════════════════════════════════════════════════════════════════════

export type RecipientRule =
  | 'booker_only'              // 예약자 1명만
  | 'booker_and_attendees'     // 예약자 + 참석자들
  | 'admins_only'              // 관리자 전원
  | 'booker_attendees_admins'  // 3자 모두 (pending, pending_expired)
  | 'removed_attendees'        // 제거된 참석자 (attendee_removed 전용)
  | 'former_booker'            // ← [2026-06-12] 원래 예약자 1명 (former_booker 전용)
  | 'book_borrower'            // ← [2026-07-20] 도서 대여자 본인 1명 (도서관 알림 전용)

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
//
// ← [2026-04-19 P2 v7] CTA 설계 공통 규칙 확립
//   · 원칙: "해당 예약에 대한 액션" 버튼은 해당 예약 모달로 직접 연결되어야 함
//     (생성/변경/승인/체크인/조기반납 등 — 예약 id가 유의미한 이벤트)
//   · 딥링크 스킴:
//      · 예약자/참석자용:    #booking-{BOOKING_ID}        → mypage 탭 + DetailModal 자동 오픈
//      · 관리자 승인 작업용: #admin-booking-{BOOKING_ID}  → admin 탭 + 해당 예약 포커스
//      · 이미 취소/거절된 예약, 일일 요약 등은 예외 (홈 { APP_URL } 유지)
//
// 프리셋 목록:
//   · CTA_BOOKING_DETAIL → 해당 예약 모달 직접 오픈 (생성/변경/승인/조기반납)
//   · CTA_CHECKIN        → 체크인하러 가기 (예약 모달 경유) — 이제 deeplink 사용
//   · CTA_NEW            → 홈으로 (취소·거절된 예약에 대한 대안 제시)
//   · CTA_APP_ROOT       → 홈으로 (일일 요약, 당일 여러 건 등 특정 예약 하나로 포커싱 안 되는 경우)
//   · CTA_ADMIN_APPR     → 관리자 승인 화면

const CTA_BOOKING_DETAIL = { label: '예약 확인하기',     urlTemplate: '{APP_URL}#booking-{BOOKING_ID}',       color: COLORS.INDIGO }
const CTA_CHECKIN        = { label: '체크인하러 가기',   urlTemplate: '{APP_URL}#booking-{BOOKING_ID}',       color: COLORS.CYAN   }
const CTA_NEW            = { label: '새 예약 만들기',    urlTemplate: '{APP_URL}',                            color: COLORS.INDIGO }
const CTA_APP_ROOT       = { label: '예약 확인하기',     urlTemplate: '{APP_URL}',                            color: COLORS.INDIGO }
const CTA_ADMIN_APPR     = { label: '지금 승인 처리하기', urlTemplate: '{APP_URL}#admin-booking-{BOOKING_ID}', color: COLORS.AMBER  }

// ← [2026-07-20] 도서관 CTA — 마이페이지 '내 대여' 탭으로 딥링크
//   · #myloans : MyPage 진입 + 조회 세그먼트 탭을 '도서 대여'로 자동 선택
//   · 도서관 알림은 특정 예약(BOOKING_ID)이 아니므로 예약 딥링크 스킴을 쓰지 않는다
const CTA_MY_LOANS       = { label: '내 대여 확인하기', urlTemplate: '{APP_URL}#myloans', color: COLORS.INDIGO }
const CTA_MY_LOANS_EXT   = { label: '연장하러 가기',    urlTemplate: '{APP_URL}#myloans', color: COLORS.CYAN   }
const CTA_MY_LOANS_WARN  = { label: '대여 현황 확인',   urlTemplate: '{APP_URL}#myloans', color: COLORS.RED    }
// ← [2026-07-22] 도서 대여 신청 승인 — 관리자용 / 신청자용
const CTA_BOOK_APPROVE   = { label: '신청 승인하러 가기', urlTemplate: '{APP_URL}#library', color: COLORS.AMBER  }

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
    // ← [P2 v7] CTA 공통 규칙: 해당 예약 모달 직접 오픈
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 대리 예약 — 관리자가 다른 사용자를 예약자로 지정해 생성 (← [2026-06-12] 신규)
  // ──────────────────────────────────────────────────────────────────────
  //   recipients: 요청자(booker) + 참석자. 이메일 "처리자" 행에 대리 생성한 관리자 표시
  //   (email-templates.ts L417 조건에 created_on_behalf 추가 + admin_name/admin_avatar 전달)
  created_on_behalf: {
    subjectTag:         '[대리예약]',
    headerLabel:        '관리자가 대신 예약했습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',
    inappType:          'booking_created_on_behalf',
    inappTitleBooker:   '관리자가 회원님을 대신해 예약했습니다',
    inappTitleAttendee: '회의 참석자로 초대되었습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.info, title: '관리자가 회원님을 대신하여 회의실을 예약했습니다.', body: '회원님이 이 예약의 예약자입니다. 마이페이지에서 확인 및 관리할 수 있습니다.' },
      attendee: { ...BANNER_PRESETS.info, title: '회의 참석자로 초대되었습니다.' },
    },
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL,
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
    // ← [P2 v7] CTA 공통 규칙: 해당 예약 모달 직접 오픈
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL,
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
  // 예약자(소유권) 변경 — 관리자 전용 (← [2026-06-12] 신규)
  // ──────────────────────────────────────────────────────────────────────
  //   관리자가 DetailModal에서 예약자를 다른 사용자로 변경하면 App.tsx가
  //   2종 알림을 동시 발사 (attendee_removed 패턴과 동일):
  //     · owner_changed → 새 예약자(booker) + 참석자(attendee)   [DB 갱신 후 발사]
  //     · former_booker → 원래 예약자(payload.former_booker_user_id로 해석)
  //   문구 정책(고지 확정): 새 예약자에겐 "변경"이 아닌 "지정" 표현 사용
  //   (그 사람은 원래 이 예약과 무관했으므로 "예약자로 지정"이 정확)

  owner_changed: {
    subjectTag:         '[예약자변경]',
    headerLabel:        '회의 예약자로 지정되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',  // DB 갱신 후 발사 → resolver가 새 예약자+참석자 해석
    inappType:          'booking_owner_changed',
    inappTitleBooker:   '회의 예약자로 지정되었습니다',          // 새 예약자 (확정 문구 #3)
    inappTitleAttendee: '참석 회의의 예약자가 변경되었습니다',   // 참석자
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.info, title: '관리자가 회원님을 이 회의의 예약자로 지정했습니다.', body: '이제 회원님이 이 예약의 예약자입니다. 마이페이지에서 확인 및 관리할 수 있습니다.' },
      attendee: { ...BANNER_PRESETS.info, title: '참석 예정 회의의 예약자가 변경되었습니다.',           body: '회의 일정·장소·참석자는 변동이 없습니다.' },
    },
    // CTA 공통 규칙: 해당 예약 모달 직접 오픈
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL,
    },
    isCancelledStyle: false,
  },

  former_booker: {
    subjectTag:         '[예약자변경]',
    headerLabel:        '회의 예약자에서 변경되었습니다',
    headerColor:        COLORS.GRAY,
    recipients:         'former_booker',          // payload.former_booker_user_id 1명 해석
    inappType:          'booking_former_booker',
    inappTitleBooker:   '회의 예약자에서 변경되었습니다',   // formerBooker는 role='booker'로 렌더됨
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: { ...BANNER_PRESETS.neutral, title: '관리자에 의해 이 회의의 예약자가 다른 사용자로 변경되었습니다.', body: '회원님은 더 이상 이 예약의 예약자가 아닙니다.' },
    },
    cta:                null,                       // 더 이상 본인 예약이 아니므로 CTA 없음 (attendee_removed와 동일)
    isCancelledStyle:   true,                       // 회색 처리 (소유권 상실)
  },

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
      // ← [2026-04-18 P2 v4] 거절 정책 배너 간소화
      //   · title 제거 ("거절 사유는 본문에 표시됩니다." 삭제) — Figma 디자인 반영
      //   · body만 남김 (하늘색 #DFF3FF 배너에 안내문만 표시)
      //   · 실제 거절 사유는 renderBanner에서 별도의 빨간 배너(#FFF1F1)로 분리 렌더
      booker:   { ...BANNER_PRESETS.danger, title: '', body: '반려된 예약은 자동으로 취소 처리됩니다. 새로운 예약을 생성하여 다시 승인 요청해 주세요.' },
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
    // ← [P2 v7] CTA 공통 규칙: 해당 예약 모달 직접 오픈
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL,
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
      // ← [2026-04-29] 배너 title 공통 변경 (예약자/참석자)
      booker:   { ...BANNER_PRESETS.warning, title: '체크인 하지 않아 예약이 노쇼처리 되었습니다.',    body: '예약 시작 후 10분 이내에 체크인이 없으면 자동 취소됩니다.' },
      attendee: { ...BANNER_PRESETS.warning, title: '체크인 하지 않아 예약이 노쇼처리 되었습니다.' },
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
  // ← [2026-05-12 체크인 활성 5분 전 핫픽스]
  //   기존 정책: ① 10분 전(이동 안내) ② 시작 시점(체크인 요청) ③ 시작+5분(경고)
  //   새 정책:   ① 시작 5분 전(체크인 요청, 활성 동시) ② 시작+5분(경고)
  //   삭제 사유:
  //     · checkin_before_10: 5분 전 체크인 메일에 이동 안내 통합 (메일 중복 발송 부담 감소)
  //     · checkin_start:     체크인 활성 시점이 5분 앞당겨졌으므로 시작 시각 메일은 불필요
  //   유지 사유: checkin_warning_5는 자동취소 임박 경고 — 정책 이미지 "노쇼 경고"와 1:1 매칭

  checkin_before_5: {
    subjectTag:         '[회의5분전]',
    headerLabel:        '회의 시작 5분 전입니다 — 체크인해 주세요',
    headerColor:        COLORS.CYAN,
    recipients:         'booker_and_attendees',
    inappType:          'checkin_before_5',
    inappTitleBooker:   '회의 5분 전 — 체크인해 주세요',
    inappTitleAttendee: '참석 회의 5분 전 — 체크인해 주세요',
    inappTitleAdmin:    '',
    contextBanner: {
      // ← 본문: 신규 정책 문구 (시작 5분 전부터 체크인 가능 + 시작 후 10분 자동 취소)
      //   {NOSHOW_TIME}: email-templates.ts에서 start_at + 10분으로 자동 치환
      booker: {
        ...BANNER_PRESETS.info,
        title: '회의 시작 5분 전부터 체크인 가능합니다.\n체크인하지 않으면 회의 시작 10분 후\n노쇼처리되어 예약이 자동 취소됩니다.',
        body:  '{NOSHOW_TIME}에 자동 취소되니, 지금 체크인해 주세요.',
      },
      attendee: {
        ...BANNER_PRESETS.info,
        title: '회의 시작 5분 전부터 체크인 가능합니다.\n체크인하지 않으면 회의 시작 10분 후\n노쇼처리되어 예약이 자동 취소됩니다.',
        body:  '{NOSHOW_TIME}에 자동 취소되니, 지금 체크인해 주세요.',
      },
    },
    cta: {
      booker:   CTA_CHECKIN,
      attendee: CTA_CHECKIN,
    },
    isCancelledStyle: false,
  },

  checkin_warning_5: {
    subjectTag:         '[자동취소경고]',
    headerLabel:        '5분 후 예약이 자동취소 됩니다.\n체크인 하세요!',  // ← [2026-04-29] 헤더 라벨 변경 (\n → email-templates에서 <br> 변환)
    headerColor:        COLORS.AMBER,
    recipients:         'booker_and_attendees',
    inappType:          'checkin_warning_5',
    inappTitleBooker:   '미체크인 — 5분 후 자동 취소 예정',
    inappTitleAttendee: '미체크인 — 5분 후 자동 취소 예정',
    inappTitleAdmin:    '',
    contextBanner: {
      // ← [2026-04-29] 배너 문구 공통 변경 (예약자/참석자 동일), booker body 제거
      booker:   { ...BANNER_PRESETS.warning, title: '체크인 하지 않으면 5분 후 예약이 자동 취소됩니다.' },
      attendee: { ...BANNER_PRESETS.warning, title: '체크인 하지 않으면 5분 후 예약이 자동 취소됩니다.' },
    },
    cta: {
      booker:   CTA_CHECKIN,
      attendee: CTA_CHECKIN,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 조기 반납 ← [P2 v7] 2026-04-19 신규
  // ──────────────────────────────────────────────────────────────────────

  early_end: {
    subjectTag:         '[반납완료]',
    headerLabel:        '회의실 이용 완료 — 반납 처리되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'booker_and_attendees',  // ← [2026-04-29] booker_only → booker_and_attendees
    inappType:          'booking_early_end',
    inappTitleBooker:   '회의실 반납 완료',
    inappTitleAttendee: '참석 회의실이 조기 반납되었습니다',  // ← [2026-04-29] 참석자 인앱 추가
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.info,
        title: '회의실 이용이 완료되어 반납 처리되었습니다.',
        body:  '원래 종료 시간 이전에 조기 반납되었으며, 다른 사용자가 해당 시간을 예약할 수 있습니다.',
      },
      attendee: {                                               // ← [2026-04-29] 참석자 배너 추가
        ...BANNER_PRESETS.info,
        title: '참석하신 회의실이 조기 반납 처리되었습니다.',
        body:  '원래 종료 시간 이전에 반납되었습니다.',
      },
    },
    cta: {
      booker:   CTA_BOOKING_DETAIL,
      attendee: CTA_BOOKING_DETAIL, // ← [2026-04-29] 참석자 CTA 추가 — 예약 모달 직접 오픈
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 일일 리마인더
  // ──────────────────────────────────────────────────────────────────────

  daily_reminder: {
    // ← [2026-04-20 파일럿 피드백 반영] booker 체크인 관련 워딩 전부 삭제
    //   기존: booker 배너 "예약 시작 10분 전부터 체크인 가능" (정책 오기재) + CTA_CHECKIN
    //         → 아침 07:00 메일에 체크인 링크는 부적절 (실제 체크인은 시작 후 10분만 가능)
    //   변경: booker 배너를 attendee와 동일 문구로 통일, booker CTA 제거
    // ← [2026-04-29] booker CTA_APP_ROOT 추가 (예약자도 예약 확인하기 버튼 수신)
    subjectTag:         '[오늘의예약]',
    headerLabel:        '오늘의 예약 안내',
    headerColor:        COLORS.CYAN,
    recipients:         'booker_and_attendees',
    inappType:          'daily_reminder',
    inappTitleBooker:   '오늘 예약된 회의가 있습니다',
    inappTitleAttendee: '오늘 참석 예정 회의가 있습니다',
    inappTitleAdmin:    '',
    contextBanner: {
      booker:   { ...BANNER_PRESETS.info, title: '회의 시작 시간에 맞춰 회의실로 이동해 주세요.' },
      attendee: { ...BANNER_PRESETS.info, title: '회의 시작 시간에 맞춰 회의실로 이동해 주세요.' },
    },
    cta: {
      booker:   CTA_APP_ROOT,  // ← [2026-04-29] 예약자 CTA 추가
      attendee: CTA_APP_ROOT,
    },
    isCancelledStyle: false,
  },

  // ──────────────────────────────────────────────────────────────────────
  // 도서관 (← [2026-07-20] 신규)
  // ──────────────────────────────────────────────────────────────────────
  //
  // 수신자 정책:
  //   · 전 5종 모두 recipients='book_borrower' — 대여자 본인 1명에게만.
  //     도서 대여는 참석자/관리자 공유 개념이 없으므로 booker 역할로만 렌더한다.
  //     (inappTitleBooker만 채우고 attendee/admin은 빈 문자열)
  //
  // 발송 타이밍:
  //   · book_borrowed  — 관리자가 대여 등록한 즉시 (이벤트 기반)
  //   · book_extended  — 사용자가 연장 신청한 직후 (이벤트 기반)
  //   · book_due_tomorrow / book_due_today / book_overdue
  //       매일 09:00 KST = UTC 00:00 → cron '0 0 * * *' (book-due-reminder)
  //       KST '날짜 단위'로 D-day를 계산해 정확히 1회씩만 발송한다.
  //
  // 문구 정책:
  //   · 도서 제목이 곧 제목 슬롯({title})에 들어간다 (회의 제목 자리 재사용)
  //   · 반납일은 "그 날 반납"이 아니라 "대여일 기준 7일 이내 반납"이 정책이다.
  //     따라서 전 문구를 시점('~까지')이 아닌 기한('~ 이내') 표기로 통일한다.
  //     ← [2026-07-20] 프론트 utils/bookLoan.ts 문구와 반드시 함께 유지할 것.
  //   · 반납은 관리자에게 전달하는 오프라인 행위이므로 "반납해 주세요" 안내만 하고
  //     앱 내 반납 CTA는 제공하지 않는다 (연장 CTA만 유효)

  // ── 대여 신청/승인 (← [2026-07-22]) ──────────────────────────────────
  //   ← [2026-07-21] 승인 폐지로 아래 3종은 발송 경로가 사라졌다.
  //   설정 객체는 과거 이력 렌더링을 위해 남겨 둔다(삭제 시 이력 화면이 깨진다).
  book_requested: {
    subjectTag:         '[대여신청]',
    headerLabel:        '도서 대여 신청이 접수되었습니다',
    headerColor:        COLORS.AMBER,
    recipients:         'admins_only',
    inappType:          'book_requested',
    inappTitleBooker:   '',
    inappTitleAttendee: '',
    inappTitleAdmin:    '도서 대여 신청이 접수되었습니다',
    contextBanner: {
      admin: {
        ...BANNER_PRESETS.warning,
        title: '승인 대기 중인 도서 대여 신청이 있습니다.',
        body:  '도서관 화면에서 승인 또는 거절 처리해 주세요. 승인 시점에 반납기한이 확정됩니다.',
      },
    },
    cta: { admin: CTA_BOOK_APPROVE },
    isCancelledStyle: false,
  },

  book_request_approved: {
    subjectTag:         '[대여승인]',
    headerLabel:        '도서 대여 신청이 승인되었습니다',
    headerColor:        COLORS.INDIGO,   // ← COLORS에 GREEN 없음(INDIGO=긍정/확정)
    recipients:         'book_borrower',
    inappType:          'book_request_approved',
    inappTitleBooker:   '도서 대여 신청이 승인되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.success,
        title: '대여가 확정되었습니다.',
        body:  '반납기한은 승인 시점을 기준으로 확정됩니다. 아래 반납기한 이내에 반납해 주세요. 연장은 1회(7일)까지 마이페이지에서 신청할 수 있습니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  book_request_rejected: {
    subjectTag:         '[대여거절]',
    headerLabel:        '도서 대여 신청이 거절되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'book_borrower',
    inappType:          'book_request_rejected',
    inappTitleBooker:   '도서 대여 신청이 거절되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.danger,
        title: '신청하신 도서 대여가 거절되었습니다.',
        body:  '거절 사유는 본문에 표시됩니다. 문의는 도서관 관리자에게 해주세요.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: true,
  },

  book_borrowed: {
    subjectTag:         '[도서대여]',
    headerLabel:        '도서가 대여되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'book_borrower',
    inappType:          'book_borrowed',
    inappTitleBooker:   '도서가 대여되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.info,
        title: '도서 대여가 완료되었습니다.',
        body:  '아래 반납기한 이내에 반납해 주세요. 연장은 1회(7일)까지 마이페이지에서 신청할 수 있습니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  // ── [2026-07-21] 대여 시작일 도래 알림 ─────────────────────────────────
  //   예약(미래 시작) 건이 시작일에 도달했을 때 1회 발송한다.
  //   이 알림이 없으면 예약자가 책을 찾으러 오지 않는다 — 예약 기능의 전제다.
  //   book_borrowed(즉시 대여 확정)와 문구가 겹치지 않게 "오늘부터"를 강조한다.
  book_started: {
    subjectTag:         '[대여시작]',
    headerLabel:        '오늘부터 대여가 시작됩니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'book_borrower',
    inappType:          'book_started',
    inappTitleBooker:   '예약하신 도서의 대여가 시작되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.info,
        title: '오늘부터 대여가 시작됩니다.',
        body:  '도서관에서 도서를 수령해 주세요. 아래 반납기한 이내에 반납하시면 됩니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  // ── [2026-07-21] 연체 제재 확정 ─────────────────────────────────────────
  //   반납 처리 시 제재가 생성되면 발송한다. 등급·기간은 본문(booking)에서
  //   조립하므로 여기 문구는 등급과 무관하게 성립해야 한다.
  //   "제재되었습니다" 만 있고 언제까지인지 없으면 문의가 그대로 관리자에게 간다.
  book_penalty_applied: {
    subjectTag:         '[대여제한]',
    headerLabel:        '연체로 대여가 제한되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'book_borrower',
    inappType:          'book_penalty_applied',
    inappTitleBooker:   '연체로 대여가 제한되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.warning,
        title: '반납이 늦어져 대여가 제한되었습니다.',
        body:  '제한 기간 동안에는 도서를 대여하거나 예약할 수 없습니다. '
             + '사정이 있는 경우 도서 관리자에게 문의해 주세요.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  // ── [2026-07-21] 제재 해제 ──────────────────────────────────────────────
  //   기간 만료(배치)와 관리자 해제 두 경로가 같은 타입을 쓴다.
  //   수신자 입장에서 "이제 빌릴 수 있다" 는 사실은 동일하고,
  //   해제 사유를 구분해 알릴 실익이 없다.
  book_penalty_cleared: {
    subjectTag:         '[제한해제]',
    headerLabel:        '대여 제한이 해제되었습니다',
    // COLORS 에 GREEN 은 없다. 긍정/확정 계열은 INDIGO 를 쓰는 것이
    //   book_borrowed·book_extended 와 동일한 기존 규칙이다.
    headerColor:        COLORS.INDIGO,
    recipients:         'book_borrower',
    inappType:          'book_penalty_cleared',
    inappTitleBooker:   '대여 제한이 해제되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.success,
        title: '대여 제한이 해제되었습니다.',
        body:  '다시 도서를 대여하실 수 있습니다. 반납기한을 지켜 이용해 주세요.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  book_extended: {
    subjectTag:         '[대여연장]',
    headerLabel:        '대여 기간이 연장되었습니다',
    headerColor:        COLORS.INDIGO,
    recipients:         'book_borrower',
    inappType:          'book_extended',
    inappTitleBooker:   '대여 기간이 연장되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.success,
        title: '대여 기간이 7일 연장되었습니다.',
        body:  '연장은 1회만 가능하며, 변경된 반납기한 이내에 반납해 주세요.',
      },
    },
    cta: { booker: CTA_MY_LOANS },
    isCancelledStyle: false,
  },

  book_due_tomorrow: {
    subjectTag:         '[반납기한]',
    headerLabel:        '도서 반납기한이 내일까지입니다',
    headerColor:        COLORS.CYAN,
    recipients:         'book_borrower',
    inappType:          'book_due_tomorrow',
    inappTitleBooker:   '도서 반납기한이 내일까지입니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.info,
        title: '내일 이내에 도서를 반납해 주세요.',
        body:  '더 필요하시면 오늘 중 마이페이지에서 연장(1회, 7일)을 신청할 수 있습니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS_EXT },
    isCancelledStyle: false,
  },

  book_due_today: {
    subjectTag:         '[반납당일]',
    headerLabel:        '도서 반납기한이 오늘까지입니다',
    headerColor:        COLORS.AMBER,
    recipients:         'book_borrower',
    inappType:          'book_due_today',
    inappTitleBooker:   '도서 반납기한이 오늘까지입니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.warning,
        title: '오늘 이내에 도서를 반납해 주세요.',
        body:  '반납은 관리자에게 도서를 전달하면 처리됩니다. 오늘이 지나면 연체 처리됩니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS_EXT },
    isCancelledStyle: false,
  },

  book_overdue: {
    subjectTag:         '[연체안내]',
    headerLabel:        '도서 반납이 연체되었습니다',
    headerColor:        COLORS.RED,
    recipients:         'book_borrower',
    inappType:          'book_overdue',
    inappTitleBooker:   '도서 반납이 연체되었습니다',
    inappTitleAttendee: '',
    inappTitleAdmin:    '',
    contextBanner: {
      booker: {
        ...BANNER_PRESETS.danger,
        title: '반납기한이 지났습니다. 도서를 반납해 주세요.',
        body:  '연체 7일 이내라면 마이페이지에서 연장(1회, 7일)을 신청할 수 있습니다. 반납은 관리자에게 도서를 전달하면 처리됩니다.',
      },
    },
    cta: { booker: CTA_MY_LOANS_WARN },
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
 * 제목 형식 (Option B: 단일 대괄호 브랜드 통합):
 *  · booker:   "[C&R SPACE · {subjectTag_inner}]  {title}"
 *    예: "[C&R SPACE · 예약확정]  주간회의"
 *  · attendee: "[C&R SPACE · {subjectTag_inner} · 참석자]  {title}"
 *    예: "[C&R SPACE · 예약확정 · 참석자]  주간회의"
 *  · admin:    "[C&R SPACE · {subjectTag_inner} · 관리자]  {title}"
 *    예: "[C&R SPACE · 승인요청 · 관리자]  에메랄드 승인 건"
 *
 * 규칙:
 *  · 브랜드 식별자 "C&R SPACE"를 단일 말머리 대괄호 맨 앞에 고정 배치
 *    → Outlook M365 Intelligent Sender Display 휴리스틱이 "브랜드 시스템 메일"로
 *      인식하여 발신자 display name을 정상 표시 (You/Note to self 방지)
 *  · 역할 구분자는 이벤트 태그 뒤에 " · {역할}" 형태로 삽입
 *  · 공백 2칸으로 말머리와 제목 시각적 분리
 *
 * 예외:
 *  · attendee_removed: 말머리에 "참석자제외"가 이미 포함되어 있으므로 역할 표시 생략
 *    → "[C&R SPACE · 참석자제외]  주간회의" (role 파라미터와 무관하게 동일)
 *
 * 구현 설계:
 *  · subjectTag 상수(14개)는 "[이벤트명]" 형태 그대로 유지 (단일 진실 원천)
 *  · 이 함수에서 "[" 와 "]" 사이 문자열(inner)만 추출하여 재조립
 *  · 방어 코드: 이미 "C&R SPACE" 포함된 태그는 prefix 중복 생략
 */
export function getSubject(
  type: NotificationType,
  title: string,
  role: 'booker' | 'attendee' | 'admin',
): string {
  const policy = POLICIES[type]
  // ← [P2 v3] 폴백 경로에도 브랜드 prefix 적용
  if (!policy) return `[C&R SPACE · 예약알림]  ${title}`

  // ← [P2 v3] subjectTag에서 대괄호 내부 문자열 추출 (예: "[승인요청]" → "승인요청")
  //   정규식 실패 시(예외적) 원본 그대로 사용 (방어적)
  const rawTag = policy.subjectTag
  const innerMatch = rawTag.match(/^\[(.+)\]$/)
  let inner = innerMatch ? innerMatch[1] : rawTag

  // ← [2026-04-18] attendee_removed 예외: 말머리에 '참석자' 단어가 이미 있어 중복 방지
  //   (role 파라미터가 attendee로 들어와도 역할 표시 생략)
  const skipRoleLabel = type === 'attendee_removed'

  if (!skipRoleLabel) {
    if (role === 'attendee') {
      inner = `${inner} · 참석자`
    } else if (role === 'admin') {
      inner = `${inner} · 관리자`
    }
    // role === 'booker'면 inner 그대로 (가장 기본 형태)
  }

  // ← [P2 v3] 방어 코드: 이미 "C&R SPACE" 포함 시 중복 prefix 생략
  //   (현 코드에선 발생하지 않지만, 추후 subjectTag 수정 시 안전망)
  if (inner.includes('C&R SPACE')) {
    return `[${inner}]  ${title}`
  }

  // ← [P2 v3] 브랜드 통합: "[C&R SPACE · ${inner}]  ${title}"
  return `[C&R SPACE · ${inner}]  ${title}`
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
