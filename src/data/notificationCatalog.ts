/**
 * notificationCatalog.ts — 알림 전수 목록 (어드민 '알림 설정' 화면의 원장)
 *
 * [2026-07-23] 신규
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 이 파일이 존재하는 이유
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   알림의 '정의'(문구·수신자 규칙·CTA)는 Edge Function 쪽
 *   supabase/functions/_shared/notification-types.ts 의 POLICIES 가 SSOT 다.
 *   그런데 그 파일은 Deno 런타임 전용이라 프론트에서 import 할 수 없다.
 *
 *   그래서 화면이 필요로 하는 최소 메타(한글 라벨 / 분류 / 발송 시점 / 수신자 /
 *   지원 채널)만 여기에 옮겨 둔다. **문구를 복제하지 않는다** — 라벨은 화면용
 *   설명이고, 실제 메일 제목·본문은 POLICIES 가 그대로 담당한다.
 *
 *   ⚠️ 알림 타입을 추가·폐지하면 이 파일도 함께 고칠 것. 여기 없는 타입은
 *      어드민 화면에 나오지 않아 끄고 켤 수 없다(발송은 정상적으로 된다 —
 *      미설정=켜짐 이므로).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 채널 정의
 * ═══════════════════════════════════════════════════════════════════════════
 *   email : Resend 메일 (space@cnrres.com)
 *   inapp : 헤더 종 아이콘 알림 (notifications 테이블 INSERT)
 *   teams : Teams Adaptive Card — TEAMS_WEBHOOK_URL 미설정 시 자동 무시.
 *           회의실 계열 11종만 대상이고 도서 계열은 애초에 발송하지 않는다.
 */

/** 알림 채널 */
export type NotifChannel = 'email' | 'inapp' | 'teams'

/** 수신자 규칙 — Edge Function 의 RecipientRule 과 1:1 */
export type NotifAudience =
  | 'booker_only'
  | 'booker_and_attendees'
  | 'admins_only'
  | 'booker_attendees_admins'
  | 'removed_attendees'
  | 'former_booker'
  | 'book_borrower'
  | 'book_admins'
  | 'resource_owner'            // ← [2026-08-19 Phase 4]
  | 'resource_admins_and_owner' // ← [2026-08-19 Phase 4]

export interface NotifCatalogItem {
  /** notification_settings.type / POLICIES 키 */
  type:      string
  label:     string
  /** 화면 그룹 */
  group:     '회의실 예약' | '체크인·노쇼' | '노쇼 제재' | '도서관' | '연체 제재' | '자원예약'  // ← [2026-08-19 Phase 4]
  /** 언제 나가는가 (사람이 읽는 문장) */
  trigger:   string
  audience:  NotifAudience
  /** 이 타입이 실제로 쓰는 채널 — 여기 없는 채널은 화면에서 '—' 로 표시 */
  channels:  NotifChannel[]
  /**
   * 관리자에게 가는 알림인가.
   * true 인 것만 '수신자 지정'(notification_recipients)이 의미를 갖는다.
   */
  toAdmins:  boolean
  /** 신규 발송이 없는 폐지 타입 — 과거 이력 렌더링용으로만 남아 있다 */
  retired?:  boolean
  /** 화면 하단 주석 */
  note?:     string
}

/** 회의실·도서 전 알림 (2026-07-23 기준 29종) */
export const NOTIFICATION_CATALOG: NotifCatalogItem[] = [
  // ── 회의실 예약 ─────────────────────────────────────────────────────────
  { type: 'created',            label: '예약 생성',        group: '회의실 예약',
    trigger: '사용자가 예약을 만든 즉시',            audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'created_on_behalf',  label: '대리 예약 생성',   group: '회의실 예약',
    trigger: '관리자가 타인 명의로 예약한 즉시',     audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'updated',            label: '예약 변경',        group: '회의실 예약',
    trigger: '시간·회의실·참석자가 바뀐 즉시',       audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'cancelled',          label: '예약 취소',        group: '회의실 예약',
    trigger: '사용자 취소 / 관리자 강제 취소',       audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'owner_changed',      label: '예약자 변경(신규)', group: '회의실 예약',
    trigger: '관리자가 예약자를 바꿔 지정한 즉시',   audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'former_booker',      label: '예약자 변경(해제)', group: '회의실 예약',
    trigger: '예약자에서 제외된 원 예약자에게',      audience: 'former_booker',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'attendee_removed',   label: '참석자 제외',      group: '회의실 예약',
    trigger: '참석자 명단에서 빠진 사람에게',        audience: 'removed_attendees',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'daily_reminder',     label: '일일 예약 요약',   group: '회의실 예약',
    trigger: '매일 07:00 KST (daily-reminder)',      audience: 'booker_and_attendees',
    channels: ['email','inapp'], toAdmins: false },

  // ── 승인(에메랄드 룸) ───────────────────────────────────────────────────
  { type: 'pending',            label: '승인 대기 접수',   group: '회의실 예약',
    trigger: '에메랄드 룸 예약이 접수된 즉시',       audience: 'booker_attendees_admins',
    channels: ['email','inapp','teams'], toAdmins: true,
    note: '관리자에게 "승인 처리하세요" 로 나가는 알림. 수신자를 지정하면 그 명단만 받는다.' },
  { type: 'approved',           label: '승인 완료',        group: '회의실 예약',
    trigger: '관리자가 승인한 즉시',                 audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'rejected',           label: '승인 거절',        group: '회의실 예약',
    trigger: '관리자가 거절한 즉시',                 audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'pending_expiring',   label: '승인 만료 임박',   group: '회의실 예약',
    trigger: '승인 기한 임박 (auto-cancel 배치)',    audience: 'admins_only',
    channels: ['email','inapp','teams'], toAdmins: true,
    note: '현재 auto-cancel-bookings 의 해당 블록이 주석 처리되어 실제 발송은 멈춰 있다(v3 재설계 대기).' },
  { type: 'pending_expired',    label: '승인 만료',        group: '회의실 예약',
    trigger: '승인 기한 경과 (auto-cancel 배치)',    audience: 'booker_attendees_admins',
    channels: ['email','inapp','teams'], toAdmins: true,
    note: 'pending_expiring 과 동일하게 발송 경로가 주석 처리된 상태.' },

  // ── 체크인·노쇼 ─────────────────────────────────────────────────────────
  { type: 'checkin_before_5',   label: '체크인 5분 전',    group: '체크인·노쇼',
    trigger: '시작 5분 전 (checkin-reminder)',       audience: 'booker_and_attendees',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'checkin_warning_5',  label: '체크인 미완료 경고', group: '체크인·노쇼',
    trigger: '시작 5분 후 미체크인 (checkin-reminder)', audience: 'booker_and_attendees',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'noshow',             label: '노쇼 자동 취소',   group: '체크인·노쇼',
    trigger: '미체크인 자동 취소 (auto-cancel 배치)', audience: 'booker_and_attendees',
    channels: ['email','inapp','teams'], toAdmins: false },
  { type: 'early_end',          label: '조기 종료',        group: '체크인·노쇼',
    trigger: '사용자가 회의를 일찍 끝낸 즉시',       audience: 'booker_and_attendees',
    channels: ['email','inapp'], toAdmins: false },

  // ── 도서관 ──────────────────────────────────────────────────────────────
  // ── [2026-08-19 Phase 4] 자원예약 5종 — Teams 비대상(도서와 동일) ──────
  { type: 'resource_booking_created', label: '자원 예약 완료', group: '자원예약',
    trigger: '예약 생성 즉시 (본인·대리 공통, 대리는 라벨에 명시)', audience: 'resource_owner',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'resource_booking_cancelled_by_admin', label: '관리자 취소 통지', group: '자원예약',
    trigger: '관리자가 예약을 취소한 즉시 (사유 포함)', audience: 'resource_owner',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'resource_return_confirmed', label: '반납 확인 완료', group: '자원예약',
    trigger: '관리자 반납 확인 즉시', audience: 'resource_owner',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'resource_due_reminder', label: '반납일 안내', group: '자원예약',
    trigger: '반납일 당일 09:00 KST (resource-due-reminder)', audience: 'resource_owner',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'resource_overdue', label: '연체 발생', group: '자원예약',
    trigger: '반납일 경과 09:00 KST 매일 반복 (resource-due-reminder)', audience: 'resource_admins_and_owner',
    channels: ['email','inapp'], toAdmins: true,
    note: '★ 예약자 + 자원 담당(admin_roles resource/super). 수신자 지정 시 관리자 집합만 대체 — 예약자는 항상 수신.' },
  { type: 'book_checkout_created', label: '대여 접수(관리자)', group: '도서관',
    trigger: '대여·예약이 생성된 즉시',              audience: 'book_admins',
    channels: ['email','inapp'], toAdmins: true,
    note: '★ 관리자용. 도서·대여자·대여일·반납기한을 담는다. 수신자 미지정 시 도서 담당(admin_roles book/super) 전원.' },
  { type: 'book_borrowed',      label: '대여 확정',        group: '도서관',
    trigger: '대여가 시작된 즉시 (예약은 제외)',     audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_started',       label: '예약 대여 시작',   group: '도서관',
    trigger: '예약 시작일 09:00 KST (book-due-reminder)', audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_extended',      label: '대여 연장',        group: '도서관',
    trigger: '연장 신청 직후',                       audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_due_tomorrow',  label: '반납 1일 전',      group: '도서관',
    trigger: '매일 09:00 KST (book-due-reminder)',   audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_due_today',     label: '반납 당일',        group: '도서관',
    trigger: '매일 09:00 KST (book-due-reminder)',   audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_overdue',       label: '연체 중',          group: '도서관',
    trigger: '매일 09:00 KST (book-due-reminder)',   audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },

  // ── 연체 제재 ───────────────────────────────────────────────────────────
  { type: 'book_penalty_applied', label: '대여 제한 확정', group: '연체 제재',
    trigger: '반납 처리 시 제재가 생성되면',         audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },
  { type: 'book_penalty_cleared', label: '대여 제한 해제', group: '연체 제재',
    trigger: '기간 만료(배치) 또는 관리자 해제',     audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false },

  // ── 폐지 (과거 이력 렌더링용) ───────────────────────────────────────────
  { type: 'book_requested',        label: '[폐지] 대여 신청 접수', group: '도서관',
    trigger: '승인 플로우 폐지 — 신규 발송 없음',    audience: 'admins_only',
    channels: ['email','inapp'], toAdmins: true, retired: true },
  { type: 'book_request_approved', label: '[폐지] 대여 승인',     group: '도서관',
    trigger: '승인 플로우 폐지 — 신규 발송 없음',    audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false, retired: true },
  { type: 'book_request_rejected', label: '[폐지] 대여 거절',     group: '도서관',
    trigger: '승인 플로우 폐지 — 신규 발송 없음',    audience: 'book_borrower',
    channels: ['email','inapp'], toAdmins: false, retired: true },
]

/** 화면 그룹 표시 순서 */
export const NOTIF_GROUP_ORDER: NotifCatalogItem['group'][] =
  ['회의실 예약', '체크인·노쇼', '노쇼 제재', '도서관', '연체 제재']

/** 수신자 규칙 → 화면 표기 */
export const AUDIENCE_LABEL: Record<NotifAudience, string> = {
  booker_only:             '예약자',
  booker_and_attendees:    '예약자 + 참석자',
  admins_only:             '관리자',
  booker_attendees_admins: '예약자 + 참석자 + 관리자',
  removed_attendees:       '제외된 참석자',
  former_booker:           '이전 예약자',
  book_borrower:           '대여자 본인',
  book_admins:             '도서 담당 관리자',
  resource_owner:            '자원 예약자 본인',                              // ← [2026-08-19 Phase 4]
  resource_admins_and_owner: '예약자 + 자원 담당 관리자 (resource/super)',    // ← [2026-08-19 Phase 4]
}

export const CHANNEL_LABEL: Record<NotifChannel, string> = {
  email: '메일',
  inapp: '인앱',
  teams: 'Teams',
}
